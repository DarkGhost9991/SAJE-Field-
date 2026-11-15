"""Comblement des trous et prévision, cellule par cellule, sur une grille de périodes de 12 jours.

1. Périodes : NISAR repasse sur la même orbite tous les 12 jours ; on range
   chaque observation dans sa période de 12 jours (depuis l'époque du réglage).
2. Recalage des orbites (couches en dB) : un même lieu vu par deux orbites
   différentes (angle différent) n'a pas le même écho. Pour chaque cellule,
   on retire à chaque orbite son écart médian à la référence de la cellule
   (il faut au moins 3 passages de l'orbite sur la cellule).
3. Filtre de Kalman « niveau local » (marche aléatoire + bruit de mesure),
   calculé pour toutes les cellules à la fois, puis lissage de
   Rauch-Tung-Striebel (passage arrière) : chaque trou entre deux mesures
   reçoit la valeur la plus probable compte tenu des mesures avant ET après,
   avec son incertitude.
4. Réglage : le rapport λ = changement réel / bruit de mesure est choisi par
   maximum de vraisemblance (section dorée sur log λ) pour chaque tuile et
   chaque couche ; le bruit de mesure r en découle.
5. Prévision : la période qui suit la dernière période observée.

Règles d'honnêteté (comme le moteur de prévision de l'application) :
  - au moins 3 mesures dans la cellule pour combler, au moins 5 pour prévoir ;
  - pas de comblement avant la première mesure de la cellule ;
  - chaque valeur porte un drapeau : 0 mesurée, 1 comblée, 2 prévue, 255 vide.
"""
import math
import os
import sys
from datetime import date, timedelta

import numpy as np

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'prevision')))
from algorithmes.optimisation import section_doree  # noqa: E402  (même optimiseur que le moteur de prévision)

from .reduction import DB_MIN, DB_MAX, SM_MAX, VIDE  # noqa: E402

MESURE, COMBLE, PREVU = 0, 1, 2
MIN_COMBLER, MIN_PREVOIR = 3, 5

# couches finales : (source, décodage, recalage par orbite, bornes physiques)
CHAMPS = {
    'eau': {'libelle': 'Eau (part de la cellule, %)', 'unite': '%', 'bornes': (0, 100), 'recaler': False},
    'veg': {'libelle': 'Végétation (HV − HH, dB)', 'unite': 'dB', 'bornes': (-30, 5), 'recaler': True},
    'hh': {'libelle': 'Écho radar HH (dB)', 'unite': 'dB', 'bornes': (-35, 5), 'recaler': True},
    'sm': {'libelle': 'Humidité du sol (m³/m³)', 'unite': 'm3', 'bornes': (0, SM_MAX), 'recaler': False},
}


def decoder(nom, v):
    v = v.astype(np.float32)
    out = np.full(v.shape, np.nan, np.float32)
    ok = v != VIDE
    if nom in ('hh', 'hv'):
        out[ok] = DB_MIN + v[ok] / 254 * (DB_MAX - DB_MIN)
    elif nom in ('eau', 'couv', 'sm_fiable'):
        out[ok] = v[ok] / 2
    elif nom == 'sm':
        out[ok] = v[ok] / 254 * SM_MAX
    return out


def periode(iso, epoque, jours):
    return (date.fromisoformat(iso) - date.fromisoformat(epoque)).days // jours


def debut_periode(k, epoque, jours):
    return (date.fromisoformat(epoque) + timedelta(days=k * jours)).isoformat()


# ---------------------------------------------------------------- 1-2. observations -> périodes
def series(observations, forme, epoque, jours, couverture_min=50):
    """{champ: (liste de (période, piste, valeurs (H*W)))} à partir des observations d'une tuile."""
    H, W = forme
    out = {c: [] for c in CHAMPS}
    for meta, couches in observations:
        k = periode(meta['date'], epoque, jours)
        a0, a1, b0, b1 = meta['fenetre']

        def plein(v):
            g = np.full((H, W), np.nan, np.float32)
            g[a0:a1, b0:b1] = v
            return g.ravel()
        if meta['produit'] == 'GCOV':
            couv = decoder('couv', couches['couv'])
            assez = couv >= couverture_min
            hh = np.where(assez, decoder('hh', couches['hh']), np.nan)
            out['eau'].append((k, meta['piste'], plein(np.where(assez, decoder('eau', couches['eau']), np.nan))))
            out['hh'].append((k, meta['piste'], plein(hh)))
            if 'hv' in couches:
                out['veg'].append((k, meta['piste'], plein(np.where(assez, decoder('hv', couches['hv']), np.nan) - hh)))
        else:
            out['sm'].append((k, meta['piste'], plein(decoder('sm', couches['sm']))))
    return out


def recaler(obs):
    """Retire à chaque orbite son écart médian à la référence de la cellule (>= 3 passages requis)."""
    if not obs:
        return obs
    tout = np.stack([v for _, _, v in obs])
    with np.errstate(all='ignore'):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', RuntimeWarning)
            ref = np.nanmedian(tout, axis=0)
            res = []
            for piste in {p for _, p, _ in obs}:
                idx = [i for i, (_, p, _) in enumerate(obs) if p == piste]
                bloc = tout[idx]
                n = np.isfinite(bloc).sum(0)
                ecart = np.nanmedian(bloc, axis=0) - ref
                ecart = np.where(n >= 3, ecart, np.nan)          # orbite trop rare ici : mesures écartées
                for i in idx:
                    res.append((obs[i][0], piste, tout[i] - ecart))
    return res


def par_periode(obs, n_periodes, C):
    s = np.zeros((n_periodes, C)); n = np.zeros((n_periodes, C))
    for k, _, v in obs:
        if 0 <= k < n_periodes:
            ok = np.isfinite(v)
            s[k, ok] += v[ok]; n[k, ok] += 1
    with np.errstate(invalid='ignore'):
        return np.where(n > 0, s / np.maximum(n, 1), np.nan)


# ---------------------------------------------------------------- 3-4. Kalman niveau local, toutes cellules à la fois
def filtrer(Y, lam):
    """Filtre (bruit de mesure r = 1, process λ). Renvoie m_f, P_f, P_pred, e²/S cumulés, log S, nombre."""
    T, C = Y.shape
    m = np.full(C, np.nan); P = np.full(C, np.nan)
    mf = np.full((T, C), np.nan); Pf = np.full((T, C), np.nan); Pp = np.full((T, C), np.nan)
    ss = ls = 0.0; nb = 0
    for t in range(T):
        init = np.isfinite(m)
        P = np.where(init, P + lam, P)
        Pp[t] = P
        y = Y[t]; obs = np.isfinite(y)
        u = obs & init
        if u.any():
            S = P[u] + 1; e = y[u] - m[u]; K = P[u] / S
            m[u] += K * e; P[u] = P[u] * (1 - K)
            ss += float(np.sum(e * e / S)); ls += float(np.sum(np.log(S))); nb += int(u.sum())
        nouv = obs & ~init
        m[nouv] = y[nouv]; P[nouv] = 1.0
        mf[t] = m; Pf[t] = P
    return mf, Pf, Pp, ss, ls, nb


def regler(Y, echantillon=20000):
    """λ du maximum de vraisemblance (r concentré) ; renvoie λ, r.

    λ est un réglage de la tuile entière : on l'estime sur un échantillon de cellules
    ayant au moins 3 mesures (20 000 au plus, tirage fixe), ce qui suffit et va 10 fois plus vite.
    """
    utiles = np.where(np.isfinite(Y).sum(0) >= MIN_COMBLER)[0]
    if utiles.size > echantillon:
        utiles = np.sort(np.random.default_rng(0).choice(utiles, echantillon, replace=False))
    if utiles.size:
        Y = Y[:, utiles]

    def cout(log_lam):
        _, _, _, ss, ls, nb = filtrer(Y, 10 ** log_lam)
        return math.inf if nb < 10 else nb * math.log(max(ss / nb, 1e-12)) + ls
    log_lam = section_doree(cout, -3, 1, iterations=14)
    _, _, _, ss, _, nb = filtrer(Y, 10 ** log_lam)
    return 10 ** log_lam, (ss / nb if nb else float('nan'))


def combler(Y, bornes, n_prevues=1):
    """Y (T, C) avec NaN -> valeurs (T+n, C), drapeaux, écart-type (même unité que Y), λ, r."""
    T, C = Y.shape
    n_obs = np.isfinite(Y).sum(0)
    if np.isfinite(Y).sum() < 10:
        lam, r = 1.0, float('nan')
    else:
        lam, r = regler(Y)
    mf, Pf, Pp, *_ = filtrer(Y, lam)
    # lissage arrière (Rauch-Tung-Striebel) pour la marche aléatoire
    ms, Ps = mf.copy(), Pf.copy()
    for t in range(T - 2, -1, -1):
        ok = np.isfinite(mf[t]) & np.isfinite(ms[t + 1])
        G = np.where(ok, Pf[t] / np.where(ok, Pp[t + 1], 1), 0)
        ms[t] = np.where(ok, mf[t] + G * (ms[t + 1] - mf[t]), ms[t])
        Ps[t] = np.where(ok, Pf[t] + G * G * (Ps[t + 1] - Pp[t + 1]), Ps[t])
    val = np.full((T + n_prevues, C), np.nan, np.float32)
    sd = np.full((T + n_prevues, C), np.nan, np.float32)
    drap = np.full((T + n_prevues, C), VIDE, np.uint8)
    rr = r if np.isfinite(r) else 0.0
    obs = np.isfinite(Y)
    val[:T][obs] = Y[obs]; drap[:T][obs] = MESURE; sd[:T][obs] = math.sqrt(rr)
    premier = np.where(n_obs > 0, np.argmax(obs, axis=0), T)
    apres_premier = np.arange(T)[:, None] >= premier[None, :]
    trou = ~obs & apres_premier & (n_obs >= MIN_COMBLER)[None, :] & np.isfinite(ms)
    val[:T][trou] = ms[trou]; drap[:T][trou] = COMBLE; sd[:T][trou] = np.sqrt((Ps[trou] + 1) * rr)
    peut = n_obs >= MIN_PREVOIR
    for h in range(1, n_prevues + 1):
        v = mf[T - 1]; P = Pf[T - 1] + lam * h
        ok = peut & np.isfinite(v)
        val[T - 1 + h][ok] = v[ok]; drap[T - 1 + h][ok] = PREVU; sd[T - 1 + h][ok] = np.sqrt((P[ok] + 1) * rr)
    val = np.where(np.isfinite(val), np.clip(val, *bornes), np.nan)
    return val, drap, sd, lam, r


def traiter_tuile(observations, forme, epoque, jours, n_periodes):
    """Tuile -> {champ: (valeurs, drapeaux, écart-type)} sur n_periodes + 1 (prévision), et réglages."""
    H, W = forme
    sr = series(observations, forme, epoque, jours)
    res, reglages = {}, {}
    for c, d in CHAMPS.items():
        obs = recaler(sr[c]) if d['recaler'] else sr[c]
        Y = par_periode(obs, n_periodes, H * W)
        if not np.isfinite(Y).any():
            continue
        val, drap, sd, lam, r = combler(Y, d['bornes'])
        res[c] = (val, drap, sd)
        reglages[c] = {'lambda': round(lam, 4), 'bruit_mesure': None if not np.isfinite(r) else round(math.sqrt(r), 4),
                       'mesurees': int((drap == MESURE).sum()), 'comblees': int((drap == COMBLE).sum()), 'prevues': int((drap == PREVU).sum())}
    return res, reglages
