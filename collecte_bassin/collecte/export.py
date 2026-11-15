"""Écriture des fichiers de l'application (hors ligne, ouverture par double-clic).

Compression de chaque tuile :
  1. quantification sur 1 octet (valeur, drapeau, incertitude) ;
  2. codage DELTA dans le temps : on stocke l'écart avec la période précédente
     (souvent 0 ou presque : forêt stable, eau permanente) ;
  3. gzip (DEFLATE niveau 9), puis base64 pour tenir dans un fichier .js.
Le navigateur fait l'inverse (DecompressionStream, puis somme cumulée).

Fichiers écrits dans app/js/donnees/bassin/ :
  index.js            emprise, périodes, couches, codage, liste des tuiles, réglages
  apercu.js           vue d'ensemble du bassin (cellules de ~5,5 km)
  1km/<ty>_<tx>.js    une tuile de 200 x 200 cellules de 1 km
  80m/<ty>_<tx>.js    une tuile de 500 x 500 cellules de 80 m (zones d'intérêt)
"""
import base64
import gzip
import json
import os
import warnings

import numpy as np

from .comblement import CHAMPS, VIDE
from .reduction import DB_MIN, DB_MAX, SM_MAX

CODAGE = {
    'eau': {'val': [0, 0.5], 'sd': 0.5},                                  # valeur = a + b * octet
    'veg': {'val': [DB_MIN, (DB_MAX - DB_MIN) / 254], 'sd': 0.1},
    'hh': {'val': [DB_MIN, (DB_MAX - DB_MIN) / 254], 'sd': 0.1},
    'sm': {'val': [0, SM_MAX / 254], 'sd': 0.001},
}


def coder(champ, val, drap, sd):
    a, b = CODAGE[champ]['val']
    v = np.full(val.shape, VIDE, np.uint8)
    ok = np.isfinite(val) & (drap != VIDE)
    v[ok] = np.clip(np.rint((val[ok] - a) / b), 0, 254)
    s = np.full(sd.shape, VIDE, np.uint8)
    oks = ok & np.isfinite(sd)
    s[oks] = np.clip(np.rint(sd[oks] / CODAGE[champ]['sd']), 0, 254)
    return v, np.where(ok, drap, VIDE).astype(np.uint8), s


def delta(a):
    """Écart avec la période précédente, modulo 256 (sans perte)."""
    d = a.copy()
    d[1:] = (a[1:].astype(np.int16) - a[:-1].astype(np.int16)) % 256
    return d


def empaqueter(res, forme):
    """{champ: (val, drap, sd)} -> octets compressés + description, et taille brute."""
    champs, morceaux = [], []
    for c in CHAMPS:
        if c not in res:
            continue
        v, d, s = coder(c, *res[c])
        champs.append(c)
        morceaux += [delta(v.reshape(forme)), delta(d.reshape(forme)), delta(s.reshape(forme))]
    brut = np.concatenate([m.ravel() for m in morceaux]).tobytes() if morceaux else b''
    return champs, gzip.compress(brut, 9), len(brut)


def ecrire_js(chemin, cle, contenu, rappel='SAJE_BASSIN_RECEVOIR'):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    texte = (f'// Généré par collecte_bassin/collecter_bassin.py - ne pas modifier à la main\n'
             f'window.{rappel} && window.{rappel}({json.dumps(cle)}, {json.dumps(contenu, ensure_ascii=False, separators=(",", ":"))});\n')
    tmp = chemin + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(texte)
    os.replace(tmp, chemin)
    return len(texte.encode('utf-8'))


def ecrire_tuile(dossier, nv, ty, tx, res, n_p):
    i0, i1, j0, j1 = nv.bornes_tuile(ty, tx)
    forme = (n_p, i1 - i0, j1 - j0)
    champs, gz, brut = empaqueter(res, forme)
    cle = f'{nv.nom}/{ty}_{tx}'
    taille = ecrire_js(os.path.join(dossier, nv.nom, f'{ty}_{tx}.js'), cle,
                       {'champs': champs, 'forme': forme, 'bornes': nv.bornes_geo(i0, i1, j0, j1), 'delta': True, 'b64': base64.b64encode(gz).decode()})
    return {'cle': cle, 'ty': ty, 'tx': tx, 'bornes': nv.bornes_geo(i0, i1, j0, j1), 'champs': champs,
            'octets': taille, 'brut': brut, 'gzip': len(gz)}


class Apercu:
    """Vue d'ensemble : moyenne de f x f cellules de 1 km, drapeau le plus fiable du bloc."""
    def __init__(self, nv, f, n_p):
        self.nv, self.f, self.n_p = nv, f, n_p
        self.H, self.W = -(-nv.ny // f), -(-nv.nx // f)
        self.t = {}

    def ajouter(self, ty, tx, res):
        i0, i1, j0, j1 = self.nv.bornes_tuile(ty, tx)
        f = self.f
        for c, (val, drap, sd) in res.items():
            if c not in self.t:
                self.t[c] = [np.full((self.n_p, self.H, self.W), np.nan, np.float32) for _ in range(2)] + [np.full((self.n_p, self.H, self.W), VIDE, np.uint8)]
            V, S, D = self.t[c]
            h, w = i1 - i0, j1 - j0
            hh, ww = -(-h // f) * f, -(-w // f) * f

            def bloc(a, rempl):
                b = np.full((self.n_p, hh, ww), rempl, a.dtype)
                b[:, :h, :w] = a.reshape(self.n_p, h, w)
                return b.reshape(self.n_p, hh // f, f, ww // f, f)
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', RuntimeWarning)
                v = np.nanmean(bloc(np.where(drap != VIDE, val, np.nan).astype(np.float32), np.nan), axis=(2, 4))
                s = np.nanmean(bloc(np.where(drap != VIDE, sd, np.nan).astype(np.float32), np.nan), axis=(2, 4))
            d = bloc(drap, VIDE).min(axis=(2, 4))            # 0 mesuré < 1 comblé < 2 prévu < 255 vide
            a0, b0 = i0 // f, j0 // f
            V[:, a0:a0 + v.shape[1], b0:b0 + v.shape[2]] = v
            S[:, a0:a0 + v.shape[1], b0:b0 + v.shape[2]] = s
            D[:, a0:a0 + v.shape[1], b0:b0 + v.shape[2]] = d

    def ecrire(self, dossier):
        res = {c: (V.reshape(self.n_p, -1), D.reshape(self.n_p, -1), S.reshape(self.n_p, -1)) for c, (V, S, D) in self.t.items()}
        forme = (self.n_p, self.H, self.W)
        champs, gz, brut = empaqueter(res, forme)
        nv, f = self.nv, self.f
        bornes = [[nv.nord - self.H * f * nv.pas, nv.ouest], [nv.nord, nv.ouest + self.W * f * nv.pas]]
        taille = ecrire_js(os.path.join(dossier, 'apercu.js'), 'apercu',
                           {'champs': champs, 'forme': forme, 'bornes': bornes, 'delta': True, 'b64': base64.b64encode(gz).decode()})
        return {'octets': taille, 'brut': brut, 'gzip': len(gz)}


def ecrire_index(dossier, index):
    tmp = os.path.join(dossier, 'index.js.tmp')
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// Généré par collecte_bassin/collecter_bassin.py - index des données du bassin du Congo\n')
        f.write('window.SAJE_BASSIN_INDEX = ' + json.dumps(index, ensure_ascii=False, separators=(',', ':')) + ';\n')
    os.replace(tmp, os.path.join(dossier, 'index.js'))
