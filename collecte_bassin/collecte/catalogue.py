"""Catalogue ASF : quels produits NISAR existent sur l'emprise, et lesquels sont nouveaux.

Sur le bassin entier, une seule requête dépasse les limites du serveur
(erreur 502). On découpe donc par fenêtres de temps, et une fenêtre refusée
est coupée en deux, jusqu'à 1 jour (recherche dichotomique).
"""
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

from .grille import boite_wkt

API = 'https://api.daac.asf.alaska.edu/services/search/param'
DEBUT_MISSION = date(2025, 10, 1)


def _requete(niveau_asf, wkt, debut, fin):
    q = urllib.parse.urlencode({'dataset': 'NISAR', 'processingLevel': niveau_asf, 'intersectsWith': wkt,
                                'start': f'{debut}T00:00:00Z', 'end': f'{fin}T00:00:00Z', 'output': 'jsonlite', 'maxResults': 2000})
    with urllib.request.urlopen(f'{API}?{q}', timeout=180) as r:
        return json.load(r)['results']


def _fenetre(niveau_asf, wkt, debut, fin, dire, profondeur=0):
    for essai in range(2):
        try:
            res = _requete(niveau_asf, wkt, debut, fin)
            if len(res) >= 2000 and (fin - debut).days > 1:
                raise ValueError('fenêtre pleine')
            return res
        except Exception as e:                        # noqa: BLE001 - toute erreur réseau : on découpe
            derniere = e
            time.sleep(2)
    if (fin - debut).days <= 1:
        raise RuntimeError(f'catalogue ASF : fenêtre {debut} refusée ({derniere})')
    milieu = debut + timedelta(days=(fin - debut).days // 2)
    return _fenetre(niveau_asf, wkt, debut, milieu, dire, profondeur + 1) + _fenetre(niveau_asf, wkt, milieu, fin, dire, profondeur + 1)


def interroger(produit, emprise, cache, dire):
    """Liste à jour des produits (fenêtres de 15 jours) ; catalogue enregistré en secours."""
    o, e, s, n = emprise['ouest'], emprise['est'], emprise['sud'], emprise['nord']
    wkt = f'POLYGON(({o} {s},{e} {s},{e} {n},{o} {n},{o} {s}))'
    secours = os.path.join(cache, f'catalogue_{produit}.json')
    try:
        res, d = [], DEBUT_MISSION
        fin = datetime.now(timezone.utc).date() + timedelta(days=1)
        while d < fin:
            f = min(fin, d + timedelta(days=15))
            res += _fenetre(produit, wkt, d, f, dire)
            d = f
        vus, uniques = set(), []
        for x in res:
            if x.get('fileName') not in vus:
                vus.add(x.get('fileName'))
                uniques.append(x)
        with open(secours, 'w', encoding='utf-8') as fh:
            json.dump(uniques, fh)
        dire(f'Catalogue ASF {produit} : {len(uniques)} produits sur l’emprise')
        return uniques
    except Exception as e:                             # noqa: BLE001
        if os.path.exists(secours):
            dire(f'Catalogue ASF injoignable ({e}) : catalogue enregistré utilisé')
            with open(secours, encoding='utf-8') as fh:
                return json.load(fh)
        raise


def selectionner(resultats, produit, avec_beta, emprise):
    """Dernière version (CRID) de chaque produit .h5, avec sa fiche (date, piste, cadre, maturité…)."""
    meilleurs = {}
    for x in resultats:
        nom = x.get('fileName') or ''
        if not nom.endswith('.h5') or f'_{produit}_' not in nom:
            continue
        url = x.get('downloadUrl') or ''
        mat = 'BETA' if 'BETA' in url else 'PROVISIONAL' if 'PROVISIONAL' in url else 'VALIDATED'
        if mat == 'BETA' and not avec_beta:
            continue
        nis = x.get('nisar') or {}
        p = {'fichier': nom, 'url': url, 'date': (x.get('startTime') or '')[:10], 'heure': x.get('startTime'),
             'piste': int(x.get('path') or 0), 'cadre': int(x.get('frame') or 0),
             'sens': x.get('flightDirection') or '', 'maturite': mat,
             'double': 'HV' in (nis.get('mainBandPolarization') or []),
             'bande_b': '+' in str((nis.get('rangeBandwidth') or [''])[0]) if produit == 'GCOV' else None,
             'crid': nis.get('crid') or '', 'boite': boite_wkt(x.get('wkt') or 'POLYGON((0 0,0 0))')}
        b = p['boite']
        if b['est'] < emprise['ouest'] or b['ouest'] > emprise['est'] or b['nord'] < emprise['sud'] or b['sud'] > emprise['nord']:
            continue
        cle = (p['date'], p['piste'], p['cadre'], p['heure'])
        if cle not in meilleurs or p['crid'] > meilleurs[cle]['crid']:
            meilleurs[cle] = p
    return sorted(meilleurs.values(), key=lambda p: (p['date'], p['piste'], p['cadre']))
