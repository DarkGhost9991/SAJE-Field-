"""Prévision : « que verra probablement NISAR au prochain passage ? »

Les séries sont très courtes (4 à 13 passages calibrés par zone, tous les
12 à 24 jours). On utilise donc de petits modèles SÉQUENTIELS : chacun lit
les passages dans l'ordre et se met à jour en une opération par passage.
Chaque chiffre produit peut être expliqué.

Les 6 modèles, du plus simple au plus riche :
  1. persistance — « comme la dernière fois »
  2. normale     — « comme d'habitude » (médiane des passages déjà vus)
  3. lissage     — lissage exponentiel simple, adapté aux pas irréguliers
  4. theilsen    — tendance robuste de Theil–Sen (médiane des pentes)
  5. holt        — lissage de Holt à tendance amortie
  6. kalman      — filtre de Kalman « niveau + pente »

Méthode :
  a. passages comparables seulement (même orbite, calibrés, bonne
     polarisation, contrôle qualité) et jamais après la date choisie ;
  b. évaluation glissante honnête : pour chaque passage k, le modèle est
     réglé sur 0..k-1 puis prévoit k -> erreur réelle passée ;
  c. choix : plus petite erreur moyenne (MAE) ; un modèle plus riche doit
     faire au moins 5 % mieux qu'un plus simple (parcimonie) ;
  d. intervalle à 95 % : erreur quadratique passée x quantile de Student,
     jamais plus étroit que le bruit plancher de l'indicateur ;
  e. probabilité de sortir de la normale de la zone ;
  f. contrôle a posteriori sur la date choisie.

Ce fichier est le jumeau de app/js/prediction.js : mêmes formules, mêmes
résultats (vérifié par test_prevision.py et tests/parite.html).
"""
import math
from datetime import date, timedelta

from .optimisation import section_doree, grille

CYCLE = 12          # jours entre deux passages de la même orbite
MIN_OBS = 5         # passages comparables nécessaires pour prévoir
DEBUT = 3           # premier passage évalué
PARCIMONIE = 0.95   # un modèle plus riche doit faire au moins 5 % mieux
_EPOQUE = date(1970, 1, 1)

# Indicateurs : copie des réglages de app/js/raisonnement.js (IND)
IND = {
    'inondation': dict(cle='part_inondation_pct', unite='pct', plancher=0.15, effetMin=0.3, besoinHV=False, haut='alerte', libelle='Zones inondées'),
    'vegetation_inondee': dict(cle='part_vegetation_inondee_pct', unite='pct', plancher=0.1, effetMin=0.3, besoinHV=True, haut='attention', libelle='Eau sous la végétation'),
    'eau': dict(cle='part_eau_pct', unite='pct', plancher=0.2, effetMin=0.5, besoinHV=False, haut='attention', libelle='Eau libre'),
    'vegetation': dict(cle='HVmoinsHH_dB', unite='dB', plancher=0.25, effetMin=0.75, besoinHV=True, bas='attention', libelle='Végétation (HV − HH)'),
    'anomalie': dict(cle='anomalie_HH_dB', unite='dB', plancher=0.4, effetMin=1.0, besoinHV=False, libelle='Écart à la normale HH'),
    'humidite': dict(cle='humidite_m3m3', unite='m3', plancher=0.02, effetMin=0.04, besoinHV=False, libelle='Humidité du sol'),
}
ORDRE = ['inondation', 'vegetation_inondee', 'eau', 'vegetation', 'anomalie', 'humidite']


# ---------------------------------------------------------------- outils statistiques
def mediane(a):
    s = sorted(a)
    m = len(s) >> 1
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def moyenne(a):
    return sum(a) / len(a)


_STUDENT = [12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23]


def student(df):
    """Quantile 97,5 % de Student (intervalle à 95 %)."""
    if df < 1:
        return math.inf
    return _STUDENT[df - 1] if df <= 10 else 1.96 + 2.5 / df


def phi(x):
    """Répartition de la loi normale (Abramowitz & Stegun 7.1.26)."""
    s = -1 if x < 0 else 1
    z = abs(x) / math.sqrt(2)
    t = 1 / (1 + 0.3275911 * z)
    e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * math.exp(-z * z)
    return 0.5 * (1 + s * e)


def jours(iso):
    return (date.fromisoformat(iso) - _EPOQUE).days


def iso_de(j):
    return (_EPOQUE + timedelta(days=round(j))).isoformat()


# ---------------------------------------------------------------- les modèles (apprentissage en ligne)
class Persistance:
    def __init__(self, **_):
        self.y = None
    def pret(self): return self.y is not None
    def prevoir(self, t): return self.y
    def apprendre(self, t, y): self.y = y
    def etat(self): return {'derniere': self.y}


class Normale:
    def __init__(self, **_):
        self.v = []
    def pret(self): return len(self.v) >= 2
    def prevoir(self, t): return mediane(self.v)
    def apprendre(self, t, y): self.v.append(y)
    def etat(self): return {'mediane': mediane(self.v) if self.v else None}


class Lissage:
    """Niveau L corrigé d'une fraction a de l'erreur ; a grandit avec l'écart entre passages."""
    def __init__(self, alpha=0.5, **_):
        self.alpha, self.L, self.t0 = alpha, None, None
    def pret(self): return self.L is not None
    def prevoir(self, t): return self.L
    def apprendre(self, t, y):
        if self.L is None:
            self.L, self.t0 = y, t
            return
        a = 1 - math.pow(1 - self.alpha, max(t - self.t0, 1) / CYCLE)
        self.L += a * (y - self.L)
        self.t0 = t
    def etat(self): return {'niveau': self.L}


class TheilSen:
    """Droite dont la pente est la médiane des pentes entre toutes les paires de passages."""
    def __init__(self, **_):
        self.pts, self.a, self.b = [], 0.0, 0.0
    def pret(self): return len(self.pts) >= 3
    def prevoir(self, t): return self.a + self.b * t
    def apprendre(self, t, y):
        self.pts.append((t, y))
        p = self.pts
        s = [(p[j][1] - p[i][1]) / (p[j][0] - p[i][0]) for i in range(len(p)) for j in range(i + 1, len(p)) if p[j][0] != p[i][0]]
        self.b = mediane(s) if s else 0
        self.a = mediane([q[1] - self.b * q[0] for q in p])
    def etat(self):
        return {'niveau': self.a + self.b * self.pts[-1][0] if self.pts else None, 'pente_jour': self.b}


class Holt:
    """Niveau L et pente B (par jour) ; pente amortie par phi."""
    def __init__(self, alpha=0.5, beta=0.2, phi=0.9, **_):
        self.alpha, self.beta, self.phi = alpha, beta, phi
        self.L, self.B, self.t0, self.n = None, 0.0, None, 0
    def pret(self): return self.n >= 2
    def prevoir(self, t): return self.L + self.phi * self.B * (t - self.t0)
    def apprendre(self, t, y):
        self.n += 1
        if self.n == 1:
            self.L, self.t0 = y, t
            return
        dt = max(1, t - self.t0)
        if self.n == 2:
            self.B, self.L, self.t0 = (y - self.L) / dt, y, t
            return
        a = 1 - math.pow(1 - self.alpha, dt / CYCLE)
        b = 1 - math.pow(1 - self.beta, dt / CYCLE)
        p = self.prevoir(t)
        e = y - p
        self.L = p + a * e
        self.B = self.phi * self.B + a * b * e / dt
        self.t0 = t
    def etat(self): return {'niveau': self.L, 'pente_jour': self.phi * self.B}


class Kalman:
    """Filtre de Kalman niveau + pente (pente par cycle de 12 j), bruit de mesure R = 1."""
    def __init__(self, q=1, **_):
        self.q = q
        self.x0, self.x1 = None, 0.0
        self.p00, self.p01, self.p11 = 1.0, 0.0, 1e4
        self.t0 = None
    def pret(self): return self.x0 is not None
    def prevoir(self, t): return self.x0 + self.x1 * (t - self.t0) / CYCLE
    def apprendre(self, t, y):
        if self.x0 is None:
            self.x0, self.t0 = y, t
            return
        u = max(t - self.t0, 1) / CYCLE
        q = self.q
        l = self.x0 + u * self.x1                                   # prédiction de l'état
        a = self.p00 + 2 * u * self.p01 + u * u * self.p11 + q * u   # et de sa variance
        b = self.p01 + u * self.p11
        c = self.p11 + 0.1 * q * u
        S = a + 1                                                   # variance de l'innovation
        k0, k1, e = a / S, b / S, y - l                             # gain de Kalman, erreur
        self.x0 = l + k0 * e
        self.x1 += k1 * e
        self.p00, self.p01, self.p11 = a - k0 * a, b - k0 * b, c - k1 * b
        self.t0 = t
    def etat(self): return {'niveau': self.x0, 'pente_jour': self.x1 / CYCLE}


def _grille_holt():
    return [{'alpha': a, 'beta': b, 'phi': f} for a in (0.2, 0.5, 0.8) for b in (0.05, 0.2, 0.5) for f in (0.8, 0.98)]


MODELES = {
    'persistance': dict(ordre=1, classe=Persistance, nom='Comme la dernière fois', savant='Persistance (prévision naïve)'),
    'normale': dict(ordre=2, classe=Normale, nom='Comme d’habitude', savant='Climatologie robuste (médiane des passages)'),
    'lissage': dict(ordre=3, classe=Lissage, nom='Moyenne qui privilégie le récent', savant='Lissage exponentiel simple (pas irrégulier)',
                    defaut={'alpha': 0.5}, regler=lambda cout: {'alpha': section_doree(lambda a: cout({'alpha': a}), 0.02, 0.98)}),
    'theilsen': dict(ordre=4, classe=TheilSen, nom='Tendance de fond (ligne droite robuste)', savant='Tendance de Theil–Sen (médiane des pentes)'),
    'holt': dict(ordre=5, classe=Holt, nom='Tendance qui s’essouffle', savant='Lissage de Holt à tendance amortie',
                 defaut={'alpha': 0.5, 'beta': 0.2, 'phi': 0.9}, regler=lambda cout: grille(cout, _grille_holt())),
    'kalman': dict(ordre=6, classe=Kalman, nom='Filtre qui sépare le signal du bruit', savant='Filtre de Kalman (niveau + pente)',
                   defaut={'q': 1}, regler=lambda cout: grille(cout, [{'q': q} for q in (0.01, 0.03, 0.1, 0.3, 1, 3, 10)])),
}
IDS = sorted(MODELES, key=lambda k: MODELES[k]['ordre'])


# ---------------------------------------------------------------- moteur séquentiel
def lire(mid, params, obs):
    """Fait lire la série au modèle ; renvoie le modèle à jour et ses prévisions à un pas."""
    m = MODELES[mid]['classe'](**(params or {}))
    preds = []
    for o in obs:
        preds.append(m.prevoir(o['t']) if m.pret() else None)
        m.apprendre(o['t'], o['y'])
    return m, preds


def regler(mid, obs):
    """Paramètres qui minimisent l'erreur quadratique des prévisions à un pas sur ces passages."""
    md = MODELES[mid]
    if 'regler' not in md:
        return {}
    debut = 2 if mid == 'holt' else 1
    if len(obs) - debut < 2:
        return dict(md['defaut'])

    def cout(p):
        _, preds = lire(mid, p, obs)
        return sum((obs[k]['y'] - preds[k]) ** 2 for k in range(debut, len(obs)) if preds[k] is not None)
    return md['regler'](cout)


def evaluer(mid, obs):
    """Évaluation glissante : réglage et prévision du passage k avec 0..k-1 seulement."""
    err = []
    for k in range(DEBUT, len(obs)):
        passe = obs[:k]
        m, _ = lire(mid, regler(mid, passe), passe)
        if m.pret():
            err.append(obs[k]['y'] - m.prevoir(obs[k]['t']))
    return {'id': mid, 'err': err,
            'mae': moyenne([abs(e) for e in err]) if err else math.inf,
            'rmse': math.sqrt(moyenne([e * e for e in err])) if err else math.inf}


def choisir(scores):
    best = scores[0]
    for s in scores[1:]:
        if s['mae'] < best['mae'] * PARCIMONIE - 1e-12:
            best = s
    return best


def observations(serie, ind, d):
    """Passages comparables jusqu'à la date choisie incluse."""
    exclus = {'beta': 0, 'polarisation': 0, 'qualite': 0, 'absent': 0}
    obs = []
    for p in serie:
        if p['date'] > d['date'] or p.get('orbite') != d.get('orbite'):
            continue
        if p.get('maturite') == 'BETA':
            exclus['beta'] += 1
            continue
        if ind['besoinHV'] and not p.get('double_pol'):
            exclus['polarisation'] += 1
            continue
        couv = p.get('couverture_pct')
        pix = p.get('sol_pixels_retenus')
        if (couv if couv is not None else 100) < 50 or (ind['cle'] == 'humidite_m3m3' and (pix if pix is not None else 5) < 5):
            exclus['qualite'] += 1
            continue
        y = p.get(ind['cle'])
        if y is None or not math.isfinite(y):
            exclus['absent'] += 1
            continue
        obs.append({'t': jours(p['date']), 'y': y, 'date': p['date']})
    obs.sort(key=lambda o: o['t'])
    return obs, exclus


def normale(obs, ind):
    if len(obs) < 4:
        return None
    v = [o['y'] for o in obs]
    m = mediane(v)
    s = max(1.4826 * mediane([abs(x - m) for x in v]), ind['plancher'])
    return {'mediane': m, 'sigma': s, 'bas': m - 2 * s, 'haut': m + 2 * s,
            'seuilHaut': max(m + 2 * s, m + ind['effetMin']), 'seuilBas': min(m - 2 * s, m - ind['effetMin'])}


def borner(ind, v):
    if ind['unite'] == 'pct':
        return min(100, max(0, v))
    if ind['unite'] == 'm3':
        return min(1, max(0, v))
    return v


def prevoir_obs(obs, ind, t_cible):
    scores = [evaluer(mid, obs) for mid in IDS]
    choix, ref = choisir(scores), scores[0]
    params = regler(choix['id'], obs)
    m, _ = lire(choix['id'], params, obs)
    brut = m.prevoir(t_cible)
    pas_moyen = moyenne([obs[i + 1]['t'] - obs[i]['t'] for i in range(len(obs) - 1)])
    h = max(1, (t_cible - obs[-1]['t']) / pas_moyen)
    s = max(choix['rmse'], ind['plancher'])
    demi = student(len(choix['err'])) * s * math.sqrt(h)
    return {
        'valeur': borner(ind, brut), 'bas': borner(ind, brut - demi), 'haut': borner(ind, brut + demi),
        'demi': demi, 'sd': demi / 1.96, 'h': h,
        'modele': {'id': choix['id'], 'params': params, 'etat': m.etat()},
        'scores': [{'id': x['id'], 'mae': x['mae'], 'rmse': x['rmse'], 'choisi': x['id'] == choix['id']} for x in scores],
        'mae': choix['mae'], 'rmse': choix['rmse'], 'm': len(choix['err']),
        'competence': 1 - choix['mae'] / ref['mae'] if ref['mae'] > 0 and math.isfinite(ref['mae']) else None,
    }


def risque(ind, nrm, p):
    if not nrm or not p['sd'] > 0:
        return None
    p_haut = 1 - phi((nrm['seuilHaut'] - p['valeur']) / p['sd'])
    p_bas = 0 if ind['unite'] != 'dB' and nrm['seuilBas'] <= 0 else phi((nrm['seuilBas'] - p['valeur']) / p['sd'])
    sens = 'haut' if ind.get('haut') else 'bas' if ind.get('bas') else ('haut' if p_haut >= p_bas else 'bas')
    return {'haut': p_haut, 'bas': p_bas, 'sens': sens, 'p': p_haut if sens == 'haut' else p_bas,
            'seuilHaut': nrm['seuilHaut'], 'seuilBas': nrm['seuilBas']}


def confiance(p, dernier, retro):
    s, f = 1.0, []
    if p['m'] >= 6:
        f.append(['+', f"Méthode testée sur {p['m']} passages passés."])
    elif p['m'] >= 3:
        s *= 0.8
        f.append(['~', f"Méthode testée sur seulement {p['m']} passages passés."])
    else:
        s *= 0.6
        f.append(['−', f"Méthode testée sur {p['m']} passage(s) passé(s) seulement."])
    if p['modele']['id'] == 'persistance':
        s *= 0.9
        f.append(['~', 'Aucune méthode ne fait mieux que « comme la dernière fois ».'])
    elif p['competence'] is not None and p['competence'] >= 0.2:
        f.append(['+', f"Erreur {round(p['competence'] * 100)} % plus faible que « comme la dernière fois »."])
    else:
        f.append(['~', 'Gain modeste par rapport à « comme la dernière fois ».'])
    if dernier == 'PROVISIONAL':
        s *= 0.9
        f.append(['~', 'Dernière mesure provisoire (calibration en cours).'])
    if p['h'] > 2:
        s *= 0.8
        f.append(['~', 'Prévision lointaine : plusieurs passages sans mesure comparable.'])
    if retro and not retro['conforme']:
        s *= 0.8
        f.append(['−', 'Le modèle s’est trompé sur la date choisie (mesure hors de l’intervalle prévu).'])
    elif retro and retro['conforme']:
        f.append(['+', 'La date choisie était bien dans l’intervalle prévu.'])
    niveau = 'bonne' if s >= 0.75 else 'moyenne' if s >= 0.5 else 'faible'
    return {'score': round(s * 100) / 100, 'niveau': niveau, 'facteurs': f}


def prevoir(iid, serie, d):
    """Prévision d'un indicateur pour le passage suivant (même orbite, +12 jours)."""
    ind = IND[iid]
    obs, exclus = observations(serie, ind, d)
    base = {'id': iid, 'n': len(obs), 'exclus': exclus,
            'empreinte': {'n': len(obs), 'depuis': obs[-1]['date'] if obs else None, 'somme': sum(o['y'] for o in obs)}}
    if len(obs) < MIN_OBS:
        r = []
        if exclus['polarisation']:
            r.append(f"{exclus['polarisation']} passage(s) en HH seul ne mesurent pas cet indicateur")
        if exclus['beta']:
            r.append(f"{exclus['beta']} passage(s) bêta non calibrés")
        if exclus['qualite']:
            r.append(f"{exclus['qualite']} passage(s) refusés par le contrôle qualité")
        return {**base, 'ok': False, 'raison': f"{len(obs)} passage(s) comparable(s) seulement, il en faut {MIN_OBS} pour tester une méthode de prévision" + (f" ({', '.join(r)})" if r else '') + '.'}
    t_cible = jours(d['date']) + CYCLE
    p = prevoir_obs(obs, ind, t_cible)
    nrm = normale(obs, ind)
    retro = None
    i_sel = next((i for i, o in enumerate(obs) if o['date'] == d['date']), -1)
    if i_sel >= MIN_OBS:
        r = prevoir_obs(obs[:i_sel], ind, obs[i_sel]['t'])
        y = obs[i_sel]['y']
        retro = {'date': d['date'], 'prevu': r['valeur'], 'bas': r['bas'], 'haut': r['haut'], 'mesure': y,
                 'conforme': r['bas'] <= y <= r['haut'], 'modele': r['modele']['id']}
    dernier = next((x.get('maturite') for x in serie if x['date'] == obs[-1]['date']), None)
    out = {**base, 'ok': True, 'cible': {'date': iso_de(t_cible), 'h': p['h']}, 'depuis': obs[-1]['date'],
           **p, 'normale': nrm, 'risque': risque(ind, nrm, p), 'retro': retro, 'conf': confiance(p, dernier, retro)}
    pente = out['modele']['etat'].get('pente_jour')
    if pente is not None and math.isfinite(pente):
        out['tendanceMois'] = pente * 30
    return out


def toutes(serie, d):
    out = []
    for iid in ORDRE:
        try:
            out.append(prevoir(iid, serie, d))
        except (ValueError, ZeroDivisionError, OverflowError) as e:
            out.append({'id': iid, 'ok': False, 'raison': f'Calcul de prévision impossible pour cet indicateur ({e}).'})
    return out
