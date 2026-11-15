"""Stockage compressé des observations réduites, tuile par tuile, et état de la collecte.

Pour chaque cadre traité et chaque tuile touchée, on garde seulement :
  - le rectangle de cellules réellement couvert (rognage) ;
  - quelques couches codées sur 1 octet (HH, HV, eau, couverture ou humidité) ;
  - compressées (DEFLATE) dans un petit fichier .npz.
Une observation de 1 km pèse quelques dizaines de ko, contre ~2 Go pour le produit d'origine.

etat.json retient chaque produit déjà traité (nom + version CRID) : la collecte
reprend là où elle s'est arrêtée et ne relit jamais deux fois le même produit.
"""
import json
import os

import numpy as np

VIDE = 255


def _ecrire_atomique(chemin, ecrire):
    tmp = chemin + '.tmp'
    ecrire(tmp)
    os.replace(tmp, chemin)


class Etat:
    def __init__(self, dossier):
        self.chemin = os.path.join(dossier, 'etat.json')
        self.d = {}
        if os.path.exists(self.chemin):
            with open(self.chemin, encoding='utf-8') as f:
                self.d = json.load(f)

    def fait(self, p):
        e = self.d.get(p['fichier'])
        return bool(e and e.get('statut') in ('ok', 'rejete'))

    def noter(self, p, statut, **info):
        self.d[p['fichier']] = {'statut': statut, 'date': p['date'], 'piste': p['piste'], 'cadre': p['cadre'], **info}

    def sauver(self):
        def ecrire(t):
            with open(t, 'w', encoding='utf-8') as f:
                json.dump(self.d, f)
        _ecrire_atomique(self.chemin, ecrire)


def dossier_tuile(cache, niveau, ty, tx):
    d = os.path.join(cache, 'obs', niveau, f'{ty}_{tx}')
    os.makedirs(d, exist_ok=True)
    return d


def enregistrer(cache, nv, obs, p, produit, info):
    """Découpe une observation (fenêtre de niveau) en tuiles rognées ; renvoie les tuiles écrites."""
    i0, i1, j0, j1 = obs['fenetre']
    ecrites = []
    couches = {k: v for k, v in obs['couches'].items() if v is not None}
    for ty, tx in nv.tuiles(obs['fenetre']):
        a0, a1, b0, b1 = nv.bornes_tuile(ty, tx)
        r0, r1, c0, c1 = max(i0, a0), min(i1, a1), max(j0, b0), min(j1, b1)
        if r0 >= r1 or c0 >= c1:
            continue
        morceaux = {k: v[r0 - i0:r1 - i0, c0 - j0:c1 - j0] for k, v in couches.items()}
        plein = np.zeros((r1 - r0, c1 - c0), bool)
        for v in morceaux.values():
            plein |= v != VIDE
        if not plein.any():
            continue
        lignes, cols = np.where(plein.any(1))[0], np.where(plein.any(0))[0]
        y0, y1, x0, x1 = lignes[0], lignes[-1] + 1, cols[0], cols[-1] + 1
        meta = {'produit': produit, 'date': p['date'], 'piste': p['piste'], 'cadre': p['cadre'], 'sens': p['sens'],
                'maturite': p['maturite'], 'fichier': p['fichier'], **info,
                'fenetre': [int(r0 - a0 + y0), int(r0 - a0 + y1), int(c0 - b0 + x0), int(c0 - b0 + x1)]}
        chemin = os.path.join(dossier_tuile(cache, nv.nom, ty, tx), f"{produit}_{p['date']}_{p['piste']}_{p['cadre']}.npz")
        tableaux = {k: v[y0:y1, x0:x1] for k, v in morceaux.items()}
        def ecrire(t, meta=meta, tableaux=tableaux):
            with open(t, 'wb') as fh:              # fichier fermé avant le renommage (Windows)
                np.savez_compressed(fh, meta=np.frombuffer(json.dumps(meta).encode(), np.uint8), **tableaux)
        _ecrire_atomique(chemin, ecrire)
        ecrites.append((nv.nom, ty, tx))
    return ecrites


def lire_tuile(cache, niveau, ty, tx):
    """Toutes les observations d'une tuile : [(meta, {couche: uint8})]."""
    d = os.path.join(cache, 'obs', niveau, f'{ty}_{tx}')
    out = []
    if not os.path.isdir(d):
        return out
    for nom in sorted(os.listdir(d)):
        if not nom.endswith('.npz'):
            continue
        try:
            with np.load(os.path.join(d, nom)) as z:
                meta = json.loads(bytes(z['meta']).decode())
                out.append((meta, {k: z[k] for k in z.files if k != 'meta'}))
        except (OSError, ValueError, KeyError):
            os.remove(os.path.join(d, nom))           # fichier abîmé : le produit sera relu
    return out


def dates_observees(cache):
    """Dates de toutes les observations réduites (lues dans les noms de fichiers « PRODUIT_AAAA-MM-JJ_piste_cadre.npz »)."""
    out = set()
    racine = os.path.join(cache, 'obs')
    for dossier, _, fichiers in os.walk(racine):
        for f in fichiers:
            if f.endswith('.npz'):
                out.add(f.split('_')[1])
    return sorted(out)


def tuiles_presentes(cache, niveau):
    d = os.path.join(cache, 'obs', niveau)
    if not os.path.isdir(d):
        return []
    return sorted(tuple(int(v) for v in n.split('_')) for n in os.listdir(d) if os.listdir(os.path.join(d, n)))
