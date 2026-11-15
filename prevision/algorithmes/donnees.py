"""Lecture des données de l'application et séries des zones.

Le navigateur n'analyse pas les zones suivies sur leur contour exact :
il les remplace par un cercle de même surface et calcule leurs valeurs
sur le cube radar (js/donnees.js + js/analyse.js). Pour que les
prévisions portent sur exactement les mêmes chiffres que ceux affichés,
ce module refait le même calcul en Python :
  - cercle de même surface (rayon >= 2,5 km), 72 sommets arrondis à 1e-5 ;
  - pixels du cube dont le centre est dans le cercle ;
  - mêmes statistiques que Analyse.stats() ;
  - la province, elle, utilise la série précalculée (comme l'app).
"""
import json
import math
import re

from .compression import decoder_cube
from .prediction import mediane

KM_LAT = 110.57


def km_lon(lat):
    return 111.32 * math.cos(lat * math.pi / 180)


def lire_js(chemin):
    """Objet JSON d'un fichier « window.X["cle"] = {...}; » produit par le script de préparation."""
    with open(chemin, encoding='utf-8') as f:
        texte = f.read()
    m = re.search(r'^window\.[A-Z_]+\[[^\]]+\]\s*=\s*', texte, re.M)
    if not m:
        raise ValueError(f'{chemin} : affectation window.…[…] = {{…}} introuvable')
    corps = texte[m.end():].strip()
    if corps.endswith(';'):
        corps = corps[:-1]
    return json.loads(corps)


# ---------------------------------------------------------------- géométrie (copie de js/donnees.js)
def _js_fixed5(x):
    """Équivalent de +x.toFixed(5) en JavaScript (arrondi au plus proche, demi vers l'infini)."""
    return math.floor(abs(x) * 1e5 + 0.5) / 1e5 * (1 if x >= 0 else -1)


def cercle(lat, lon, r_km, n=72):
    pts = []
    for i in range(n + 1):
        t = (i % n) / n * 2 * math.pi
        pts.append([_js_fixed5(lon + r_km * math.cos(t) / km_lon(lat)), _js_fixed5(lat + r_km * math.sin(t) / KM_LAT)])
    return {'type': 'Polygon', 'coordinates': [pts]}


def _anneaux(geom):
    return [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']


def boite(geom):
    pts = [p for poly in _anneaux(geom) for p in poly[0]]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def surface_km2(geom):
    def anneau(r):
        lat0 = sum(p[1] for p in r) / len(r) * math.pi / 180
        a = sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1))
        return abs(a / 2) * 111.32 * math.cos(lat0) * 110.57
    return sum(anneau(p[0]) - sum(anneau(t) for t in p[1:]) for p in _anneaux(geom))


def zones_suivies(M):
    out = []
    for f in M.get('zones', {}).get('features', []):
        pr = f['properties']
        if pr.get('temoin'):
            continue
        if pr.get('masque_terre'):
            out.append({'nom': pr['nom'], 'geometry': f['geometry'], 'surface': surface_km2(f['geometry'])})
            continue
        x0, y0, x1, y1 = boite(f['geometry'])
        lat, lon = (y0 + y1) / 2, (x0 + x1) / 2
        r = max(2.5, math.sqrt(surface_km2(f['geometry']) / math.pi))
        g = cercle(lat, lon, r)
        out.append({'nom': pr['nom'], 'geometry': g, 'surface': surface_km2(g)})
    return out


# ---------------------------------------------------------------- cube (copie de js/analyse.js)
class Cube:
    def __init__(self, meta):
        self.c = meta
        self.raw = decoder_cube(meta['gz_b64'])
        self.nx, self.ny, self.pas = meta['nx'], meta['ny'], meta['pas']
        self.ouest, self.nord = meta['ouest'], meta['nord']
        if len(self.raw) != self.nx * self.ny * 4 * len(meta['dates']):
            raise ValueError('Le cube de données est incomplet.')

    def index_date(self, d):
        for i, (v, o) in enumerate(zip(self.c['dates'], self.c.get('orbites') or [None] * len(self.c['dates']))):
            if v == d['date'] and (o is None or o == d['orbite']):
                return i
        return -1

    def db(self, b):
        lo, hi = self.c['codage']['dB']
        return None if b == 255 else lo + b / 254 * (hi - lo)

    def centre(self, i):
        return self.ouest + (i % self.nx + .5) * self.pas, self.nord - (i // self.nx + .5) * self.pas

    @staticmethod
    def _dans(pt, ring):
        dedans, j = False, len(ring) - 1
        for i in range(len(ring)):
            x, y = ring[i]
            xx, yy = ring[j]
            if (y > pt[1]) != (yy > pt[1]) and pt[0] < (xx - x) * (pt[1] - y) / (yy - y) + x:
                dedans = not dedans
            j = i
        return dedans

    def contient(self, pt, geom):
        return any(self._dans(pt, p[0]) and not any(self._dans(pt, r) for r in p[1:]) for p in _anneaux(geom))

    def indices(self, geom):
        x0, y0, x1, y1 = boite(geom)
        cx0 = max(0, math.floor((x0 - self.ouest) / self.pas))
        cx1 = min(self.nx - 1, math.ceil((x1 - self.ouest) / self.pas))
        cy0 = max(0, math.floor((self.nord - y1) / self.pas))
        cy1 = min(self.ny - 1, math.ceil((self.nord - y0) / self.pas))
        return [y * self.nx + x for y in range(cy0, cy1 + 1) for x in range(cx0, cx1 + 1) if self.contient(self.centre(y * self.nx + x), geom)]

    def stats(self, ids, d, seuils):
        i = self.index_date(d)
        if i < 0:
            return None
        n = self.nx * self.ny
        hh_a, hv_a, cl_a, sm_a = (self.raw[(i * 4 + j) * n:(i * 4 + j + 1) * n] for j in range(4))
        sm_max = self.c['codage']['sm_max']
        terre = nn = eau = flood = sous = mes = 0
        h, v, ratio, sm = [], [], [], []
        for k in ids:
            c = cl_a[k]
            if not c & 32:
                continue
            terre += 1
            hh, hv = self.db(hh_a[k]), self.db(hv_a[k])
            if hh is not None:
                h.append(hh)
                nn += 1
                eau += bool(c & 1)
                flood += bool(c & 2)
                sous += bool(c & 4)
            if hv is not None:
                v.append(hv)
            if hh is not None and hv is not None:
                ratio.append(hv - hh)
            if sm_a[k] != 255:
                mes += 1
                if c & 64 and d['maturite'] != 'BETA':
                    sm.append(sm_a[k] / 254 * sm_max)
        avg = lambda a: sum(a) / len(a) if a else None
        pct = lambda a: a / nn * 100 if nn else None
        bon = len(sm) >= 5
        return {'date': d['date'], 'orbite': d['orbite'], 'maturite': d['maturite'], 'double_pol': d.get('double_pol'),
                'HH_dB': avg(h), 'HV_dB': avg(v), 'HVmoinsHH_dB': avg(ratio),
                'part_eau_pct': pct(eau), 'part_inondation_pct': pct(flood),
                'part_vegetation_inondee_pct': pct(sous) if d.get('double_pol') else None,
                'humidite_m3m3': avg(sm) if bon else None, 'sol_pixels_retenus': len(sm),
                'couverture_pct': nn / terre * 100 if terre else 0, 'pixels': nn}


def completer(serie):
    """Écart à la normale de HH si absent (copie de Raisonnement.completer)."""
    if not serie or any(p.get('anomalie_HH_dB') is not None for p in serie):
        return serie
    ref = {}
    for p in serie:
        if p.get('maturite') != 'BETA' and p.get('HH_dB') is not None:
            ref.setdefault(p['orbite'], []).append(p['HH_dB'])
    return [{**p, 'anomalie_HH_dB': p['HH_dB'] - mediane(ref[p['orbite']]) if p.get('HH_dB') is not None and len(ref.get(p['orbite'], [])) >= 3 else None} for p in serie]


def series_application(M, cube):
    """Séries des zones suivies, telles que l'application les calcule."""
    seuils = (M.get('sme2') or {}).get('seuils_m3m3') or {'sec_max': .2, 'sature_min': .35}
    out = {}
    for z in zones_suivies(M):
        if not M.get('series', {}).get(z['nom']):
            continue
        if 'Province' in z['nom'] or cube is None:
            s = M['series'][z['nom']]
            source = 'serie_precalculee'
        else:
            ids = cube.indices(z['geometry'])
            s = [p for p in (cube.stats(ids, d, seuils) for d in M['dates']) if p and p['pixels'] > 0]
            source = f'cube ({len(ids)} pixels)'
        out[z['nom']] = {'serie': completer(s), 'surface': z['surface'], 'source': source}
    return out
