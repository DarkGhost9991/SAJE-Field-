"""Accès rapide aux fichiers NISAR sur les serveurs de la NASA (ASF / Earthdata Cloud).

Pourquoi c'est rapide :
1. La redirection Earthdata (nisar.asf.earthdatacloud.nasa.gov -> lien signé
   CloudFront) est résolue UNE fois par fichier, au lieu d'une fois par requête.
   Mesuré : ouverture 42 s -> 3 s + 11 s.
2. Les morceaux (chunks HDF5) sont téléchargés par requêtes HTTP « Range »
   en parallèle (plusieurs connexions), ce qui sature la bande passante.
3. Un sémaphore limite les octets bruts en vol (budget <= 1 Go au total).

Le jeton Earthdata est lu par la classe Jeton du script de préparation
(EDL_TOKEN, puis « token nasa.txt », puis ~/.saje_field) et n'est jamais affiché.
"""
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ICI = os.path.dirname(os.path.abspath(__file__))
PREPARATION = os.path.normpath(os.path.join(ICI, '..', '..', 'preparation_donnees'))

_jeton = None
_verrou_jeton = threading.Lock()


def jeton():
    """Jeton Earthdata (réutilise la gestion sûre du script de préparation)."""
    global _jeton
    with _verrou_jeton:
        if _jeton is None:
            if PREPARATION not in sys.path:
                sys.path.insert(0, PREPARATION)
            from preparer_donnees_prototype import Jeton  # noqa: E402  (lecture sûre, jamais affiché)
            _jeton = Jeton()
        return _jeton.obtenir()


class _SansRedirection(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


_liens = {}
_verrou_liens = threading.Lock()
DUREE_LIEN = 40 * 60      # un lien signé reste valable environ une heure : on le renouvelle avant


def lien_signe(url, forcer=False):
    """Lien direct signé (CloudFront) d'un fichier Earthdata, mis en cache 40 min."""
    with _verrou_liens:
        e = _liens.get(url)
        if e and not forcer and time.time() - e[1] < DUREE_LIEN:
            return e[0]
    u = url
    ouvreur = urllib.request.build_opener(_SansRedirection)
    for _ in range(5):
        entetes = {'Range': 'bytes=0-0'}
        if 'earthdata' in u or 'asf.alaska.edu' in u:
            entetes['Authorization'] = f'Bearer {jeton()}'
        try:
            with ouvreur.open(urllib.request.Request(u, headers=entetes), timeout=60):
                break                               # pas de redirection : lien direct
        except urllib.error.HTTPError as err:
            if err.code in (301, 302, 303, 307, 308):
                u = err.headers['Location']
                continue
            raise
    with _verrou_liens:
        _liens[url] = (u, time.time())
    return u


# ---------------------------------------------------------------- budget mémoire brute
class Budget:
    """Limite les octets bruts téléchargés et pas encore réduits (sémaphore en octets)."""
    def __init__(self, octets):
        self.max, self.utilise, self.pic = octets, 0, 0
        self.cv = threading.Condition()

    def prendre(self, n):
        with self.cv:
            while self.utilise + n > self.max and self.utilise > 0:
                self.cv.wait()
            self.utilise += n
            self.pic = max(self.pic, self.utilise)

    def rendre(self, n):
        with self.cv:
            self.utilise -= n
            self.cv.notify_all()


def lire_plage(url_source, debut, taille, essais=4):
    """Octets [debut, debut+taille) d'un fichier distant, avec reprises et renouvellement du lien."""
    for n in range(essais):
        lien = lien_signe(url_source, forcer=n > 0)
        req = urllib.request.Request(lien, headers={'Range': f'bytes={debut}-{debut + taille - 1}'})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                b = r.read()
            if len(b) != taille:
                raise IOError(f'réponse incomplète ({len(b)} / {taille} octets)')
            return b
        except (urllib.error.URLError, IOError, TimeoutError) as e:
            if n == essais - 1:
                raise
            time.sleep(2 * (n + 1))


def lire_plages(url_source, plages, connexions=8, budget=None, traiter=None):
    """Télécharge des plages en parallèle et appelle traiter(i, octets) dès qu'une plage arrive.

    Les octets bruts sont libérés juste après traiter() : rien n'est gardé.
    Renvoie le nombre d'octets téléchargés.
    """
    total = [0]
    verrou = threading.Lock()

    def tache(i):
        debut, taille = plages[i]
        if budget:
            budget.prendre(taille)
        try:
            b = lire_plage(url_source, debut, taille)
            with verrou:
                total[0] += len(b)
            traiter(i, b)
        finally:
            if budget:
                budget.rendre(taille)
    with ThreadPoolExecutor(connexions) as ex:
        for f in [ex.submit(tache, i) for i in range(len(plages))]:
            f.result()
    return total[0]
