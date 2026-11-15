"""Réduction en flux : un cadre NISAR -> quelques couches légères par cellule de grille.

GCOV (bande B, ~60-80 m), pour chaque morceau 512 x 512 reçu :
  1. pixels valides (puissance > 0) ;
  2. filtre anti-chatoiement : moyenne 3 x 3 en puissance linéaire ;
  3. conversion en décibels, histogramme du cadre (pour le seuil d'eau) ;
  4. coordonnées : projection UTM du produit -> longitude / latitude
     (calcul exact sur une grille de points tous les 16 pixels, interpolée) ;
  5. cumul dans les cellules : somme des puissances HH et HV, nombre de pixels,
     nombre de pixels « eau » pour 7 seuils candidats ;
  6. le morceau est oublié.
Fin du cadre : seuil d'eau choisi par la méthode d'Otsu sur l'histogramme du
cadre (bornée), puis couches finales : HH et HV moyens (dB), part d'eau (%),
couverture. Chaque couche est codée sur 1 octet.

SME2 (200 m) : humidité du sol des seuls pixels validés par le contrôle
qualité NASA (retrievalQualityFlag = 0), moyennée par cellule de 1 km, et
part des pixels mesurés qui sont fiables.
"""
import math

import numpy as np
from pyproj import Transformer

from . import flux_hdf5 as FH

DB_MIN, DB_MAX = -35.0, 5.0
SM_MAX = 0.635
VIDE = 255


# ---------------------------------------------------------------- codage sur un octet (compression avec perte contrôlée)
def coder_db(v):
    o = np.full(v.shape, VIDE, np.uint8)
    ok = np.isfinite(v)
    o[ok] = np.clip(np.rint((v[ok] - DB_MIN) / (DB_MAX - DB_MIN) * 254), 0, 254)
    return o


def coder_pct(v):           # 0..100 % -> 0..200 (pas de 0,5 %)
    o = np.full(v.shape, VIDE, np.uint8)
    ok = np.isfinite(v)
    o[ok] = np.clip(np.rint(v[ok] * 2), 0, 200)
    return o


def coder_sm(v):
    o = np.full(v.shape, VIDE, np.uint8)
    ok = np.isfinite(v)
    o[ok] = np.clip(np.rint(v[ok] / SM_MAX * 254), 0, 254)
    return o


# ---------------------------------------------------------------- outils
def moyenne_3x3(a):
    """Moyenne 3 x 3 qui ignore les pixels vides (NaN)."""
    ok = np.isfinite(a)
    v = np.where(ok, a, 0.0).astype(np.float64)
    pv, pn = np.pad(v, 1), np.pad(ok.astype(np.float64), 1)
    s = sum(pv[i:i + a.shape[0], j:j + a.shape[1]] for i in range(3) for j in range(3))
    n = sum(pn[i:i + a.shape[0], j:j + a.shape[1]] for i in range(3) for j in range(3))
    with np.errstate(invalid='ignore', divide='ignore'):
        return np.where(ok & (n > 0), s / n, np.nan)


def otsu(hist, centres, bornes):
    """Seuil qui sépare le mieux deux classes de l'histogramme (variance inter-classes maximale)."""
    sel = (centres >= bornes[0] - 10) & (centres <= bornes[1] + 10)
    h, c = hist[sel].astype(np.float64), centres[sel]
    if h.sum() < 100:
        return None
    w0 = np.cumsum(h); w1 = h.sum() - w0
    m0 = np.cumsum(h * c) / np.maximum(w0, 1)
    m1 = (np.sum(h * c) - np.cumsum(h * c)) / np.maximum(w1, 1)
    var = w0 * w1 * (m0 - m1) ** 2
    ok = (c >= bornes[0]) & (c <= bornes[1])
    if not ok.any():
        return None
    return float(c[ok][np.argmax(var[ok])])


class Accumulateur:
    """Cumuls d'un niveau de grille sur la fenêtre de cellules touchée par le cadre."""
    def __init__(self, niveau, fenetre, k_seuils, sm=False):
        self.niveau, self.f = niveau, fenetre
        i0, i1, j0, j1 = fenetre
        forme = (i1 - i0, j1 - j0)
        noms = ['s_sm', 'n_sm', 'n_mes'] if sm else ['s_hh', 's_hv', 'n_hh', 'n_hv']
        self.t = {k: np.zeros(forme, np.float64) for k in noms}
        if not sm:
            self.t['eau'] = np.zeros((k_seuils,) + forme, np.float32)

    def ajouter(self, lon, lat, valeurs):
        """valeurs : {nom: tableau de même forme que lon} ; NaN ignorés par la cellule (via masque fourni)."""
        nv, (i0, i1, j0, j1) = self.niveau, self.f
        i = np.floor((nv.nord - lat) / nv.pas).astype(np.int64) - i0
        j = np.floor((lon - nv.ouest) / nv.pas).astype(np.int64) - j0
        dedans = (i >= 0) & (i < i1 - i0) & (j >= 0) & (j < j1 - j0)
        if not dedans.any():
            return
        i, j = i[dedans], j[dedans]
        a0, a1, b0, b1 = i.min(), i.max() + 1, j.min(), j.max() + 1        # sous-fenêtre du morceau
        loc = (i - a0) * (b1 - b0) + (j - b0)
        n = (a1 - a0) * (b1 - b0)
        for nom, v in valeurs.items():
            v = v[dedans] if v.ndim == 1 else v[:, dedans]
            if v.ndim == 1:
                self.t[nom][a0:a1, b0:b1] += np.bincount(loc, weights=v, minlength=n).reshape(a1 - a0, b1 - b0)
            else:                                   # (k, pixels) : un cumul par seuil candidat
                for k in range(v.shape[0]):
                    self.t[nom][k, a0:a1, b0:b1] += np.bincount(loc, weights=v[k], minlength=n).reshape(a1 - a0, b1 - b0)


def coords_interpolees(xs, ys, vers):
    """Longitude / latitude de chaque pixel : projection exacte tous les 16 pixels, interpolation entre."""
    pas = 16
    ix = np.unique(np.r_[np.arange(0, xs.size, pas), xs.size - 1])
    iy = np.unique(np.r_[np.arange(0, ys.size, pas), ys.size - 1])
    X, Y = np.meshgrid(xs[ix], ys[iy])
    lo, la = vers.transform(X, Y)

    def interp(g):
        # interpolation séparable : d'abord le long des colonnes, puis des lignes
        t = np.empty((iy.size, xs.size))
        for r in range(iy.size):
            t[r] = np.interp(np.arange(xs.size), ix, g[r])
        out = np.empty((ys.size, xs.size))
        for c in range(xs.size):
            out[:, c] = np.interp(np.arange(ys.size), iy, t[:, c])
        return out
    return interp(np.asarray(lo)), interp(np.asarray(la))


# ---------------------------------------------------------------- GCOV
class SansBandeB(Exception):
    pass


def reduire_gcov(p, niveaux, cfg, budget=None, connexions=8):
    """Réduit un cadre GCOV. niveaux : [(Niveau, fenetre)] déjà limités à l'emprise / aux zones."""
    eau_cfg = cfg['eau']
    seuils = np.array(eau_cfg['seuils_HH_dB'], np.float64)
    with FH.ouvrir(p['url']) as f:
        racine = '/science/LSAR/GCOV/grids/'
        if racine + 'frequencyB/HHHH' not in f:
            raise SansBandeB('pas de bande B (5 MHz) dans ce produit')
        g = f[racine + 'frequencyB']
        xs, ys = g['xCoordinates'][...], g['yCoordinates'][...]
        epsg = int(np.asarray(g['projection'][()]).ravel()[0])
        mh = FH.Morceaux(g['HHHH'])
        mv = FH.Morceaux(g['HVHV']) if 'HVHV' in g else None
    vers = Transformer.from_crs(epsg, 4326, always_xy=True)
    acc = [Accumulateur(nv, fen, seuils.size) for nv, fen in niveaux]
    bords = np.arange(DB_MIN, DB_MAX + 0.25, 0.25)
    hist = np.zeros(bords.size - 1)
    stats = {'pixels': 0}
    T = mh.taille_morceau

    def traiter(r0, c0, a, b):
        h, w = min(T[0], ys.size - r0), min(T[1], xs.size - c0)
        a = a[:h, :w].astype(np.float64)
        a[~(a > 0)] = np.nan
        af = moyenne_3x3(a)
        ok = np.isfinite(af)
        if not ok.any():
            return
        db_h = 10 * np.log10(np.where(ok, af, 1))
        hist[:] += np.histogram(db_h[ok], bords)[0]
        vals = {'s_hh': np.where(ok, af, 0.0), 'n_hh': ok.astype(np.float64)}
        if b is not None:
            b = b[:h, :w].astype(np.float64)
            b[~(b > 0)] = np.nan
            bf = moyenne_3x3(b)
            okv = np.isfinite(bf)
            db_v = 10 * np.log10(np.where(okv, bf, 1))
            vals['s_hv'], vals['n_hv'] = np.where(okv, bf, 0.0), okv.astype(np.float64)
            sombre_hv = ~okv | (db_v < eau_cfg['seuil_HV_dB'])
        else:
            sombre_hv = np.ones_like(ok)
        vals['eau'] = np.stack([(ok & (db_h < s) & sombre_hv).astype(np.float32) for s in seuils])
        lon, lat = coords_interpolees(xs[c0:c0 + w], ys[r0:r0 + h], vers)
        sel = ok.ravel()
        lon, lat = lon.ravel()[sel], lat.ravel()[sel]
        for x in acc:
            x.ajouter(lon, lat, {k: (v.reshape(v.shape[0], -1)[:, sel] if v.ndim == 3 else v.ravel()[sel]) for k, v in vals.items()})
        stats['pixels'] += int(ok.sum())

    octets = FH.lire_paires(p['url'], mh, mv, traiter, connexions=connexions, budget=budget)
    centres = (bords[:-1] + bords[1:]) / 2
    s_otsu = otsu(hist, centres, eau_cfg['bornes_otsu'])
    # Otsu collé à une borne = il sépare autre chose que l'eau et la terre (forêt / savane) : seuil par défaut
    if s_otsu is not None and min(abs(s_otsu - b) for b in eau_cfg['bornes_otsu']) < 0.3:
        s_otsu = None
    seuil = s_otsu if s_otsu is not None else eau_cfg['seuil_HH_defaut']
    k = int(np.argmin(np.abs(seuils - seuil)))
    surface_pixel = abs((xs[1] - xs[0]) * (ys[1] - ys[0]))
    obs = []
    for x in acc:
        t, nv = x.t, x.niveau
        if not (t['n_hh'] > 0).any():
            continue
        with np.errstate(invalid='ignore', divide='ignore'):
            n = t['n_hh']
            hh = np.where(n > 0, 10 * np.log10(t['s_hh'] / np.maximum(n, 1)), np.nan)
            hv = np.where(t['n_hv'] > 0, 10 * np.log10(t['s_hv'] / np.maximum(t['n_hv'], 1)), np.nan)
            eau = np.where(n > 0, t['eau'][k] / np.maximum(n, 1) * 100, np.nan)
            lat_c = nv.nord - (x.f[0] + np.arange(n.shape[0])[:, None] + 0.5) * nv.pas
            cellule = (nv.pas * 111320 * np.cos(np.radians(lat_c))) * (nv.pas * 110574)
            couv = np.where(n > 0, np.minimum(100, n * surface_pixel / cellule * 100), np.nan)
        obs.append({'niveau': nv.nom, 'fenetre': x.f, 'couches': {'hh': coder_db(hh), 'hv': coder_db(hv) if mv else None,
                    'eau': coder_pct(eau), 'couv': coder_pct(couv)}})
    return obs, {'octets': octets, 'seuil_eau_dB': round(seuil, 2), 'otsu': s_otsu is not None, 'pixels': stats['pixels'], 'double': mv is not None}


# ---------------------------------------------------------------- SME2
_structure = {}


def reduire_sme2(p, niveaux, cfg, budget=None, connexions=8):
    """Réduit un cadre SME2 (humidité du sol) au niveau 1 km."""
    import sys
    from .acces import PREPARATION
    if PREPARATION not in sys.path:
        sys.path.insert(0, PREPARATION)
    import preparer_donnees_prototype as PREP          # réutilise la détection des variables SME2 d'Adam
    with FH.ouvrir(p['url']) as f:
        st = _structure.get('st')
        if not st or not all(c in f for c in (st['algos'][next(iter(st['algos']))]['sm'], st['lat'], st['lon'])):
            st = PREP.reperer_sme2(PREP.explorer_h5(f))
            _structure['st'] = st
        if not st['algos'] or not st['lat'] or not st['lon']:
            raise ValueError('variables SME2 introuvables')
        a = next(iter(st['algos'].values()))
        ds = f[a['sm']]
        lat = np.asarray(f[st['lat']][...], np.float64)
        lon = np.asarray(f[st['lon']][...], np.float64)
        vide = ds.attrs.get('_FillValue')
        echelle, decalage = float(ds.attrs.get('scale_factor', 1)), float(ds.attrs.get('add_offset', 0))
        msm = FH.Morceaux(ds)
        mq = FH.Morceaux(f[a['qflag']]) if a.get('qflag') else None
        vide_q = f[a['qflag']].attrs.get('_FillValue') if mq else None
    if (lat.ndim, lon.ndim) != (1, 1) or (lat.size, lon.size) != msm.forme:
        raise ValueError(f'grille SME2 inattendue {lat.shape} {lon.shape} {msm.forme}')
    acc = [Accumulateur(nv, fen, 0, sm=True) for nv, fen in niveaux]
    T = msm.taille_morceau

    def traiter(r0, c0, s, q):
        h, w = min(T[0], lat.size - r0), min(T[1], lon.size - c0)
        s = s[:h, :w].astype(np.float64)
        if vide is not None:
            s[s == float(np.asarray(vide).ravel()[0])] = np.nan
        s = s * echelle + decalage
        s[~((s >= 0) & (s <= 1))] = np.nan
        mes = np.isfinite(s)
        if not mes.any():
            return
        if q is not None:
            q = q[:h, :w].astype(np.int64)
            fiable = mes & (q == 0) & (q != (int(np.asarray(vide_q).ravel()[0]) if vide_q is not None else -999))
        else:
            fiable = np.zeros_like(mes)
        LO, LA = np.meshgrid(lon[c0:c0 + w], lat[r0:r0 + h])
        sel = mes.ravel()
        for x in acc:
            x.ajouter(LO.ravel()[sel], LA.ravel()[sel], {'s_sm': np.where(fiable, s, 0).ravel()[sel],
                                                          'n_sm': fiable.ravel()[sel].astype(np.float64),
                                                          'n_mes': np.ones(int(sel.sum()))})

    octets = FH.lire_paires(p['url'], msm, mq, traiter, connexions=connexions, budget=budget)
    obs = []
    for x in acc:
        t = x.t
        if not (t['n_mes'] > 0).any():
            continue
        with np.errstate(invalid='ignore', divide='ignore'):
            sm = np.where(t['n_sm'] > 0, t['s_sm'] / np.maximum(t['n_sm'], 1), np.nan)
            fia = np.where(t['n_mes'] > 0, t['n_sm'] / t['n_mes'] * 100, np.nan)
        obs.append({'niveau': x.niveau.nom, 'fenetre': x.f, 'couches': {'sm': coder_sm(sm), 'sm_fiable': coder_pct(fia)}})
    return obs, {'octets': octets, 'pixels_fiables': int(sum(x.t['n_sm'].sum() for x in acc))}
