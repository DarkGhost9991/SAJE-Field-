"""Lecture en flux d'un fichier HDF5 distant, morceau par morceau.

h5py sert seulement à lire les MÉTADONNÉES (coordonnées, projection, et la
table des morceaux : position et taille de chaque bloc 512 x 512 dans le
fichier). Les données elles-mêmes sont téléchargées en parallèle par plages
HTTP, puis décompressées ici :
    octets -> zlib (DEFLATE) -> « dé-mélange » des octets (filtre shuffle) -> float32
Ce décodage donne exactement les mêmes valeurs que h5py (vérifié), mais
plusieurs morceaux arrivent en même temps au lieu d'un par un.
"""
import threading
import zlib
from concurrent.futures import ThreadPoolExecutor

import fsspec
import h5py
import numpy as np

from .acces import lien_signe, lire_plage

# identifiants des filtres HDF5
FILTRE_DEFLATE, FILTRE_SHUFFLE, FILTRE_FLETCHER = 1, 2, 3


def ouvrir(url):
    """Fichier HDF5 distant ouvert pour ses métadonnées (lien signé, gros blocs de lecture)."""
    fs = fsspec.filesystem('http', block_size=4 * 2 ** 20, cache_type='readahead')
    return h5py.File(fs.open(lien_signe(url), 'rb'), 'r')


def filtres(ds):
    """Liste des filtres du jeu de données, dans l'ordre d'application à l'écriture."""
    pl = ds.id.get_create_plist()
    return [pl.get_filter(i)[0] for i in range(pl.get_nfilters())]


class Morceaux:
    """Table des morceaux d'un tableau 2D : où ils sont dans le fichier et comment les décoder."""
    def __init__(self, ds):
        self.forme, self.taille_morceau, self.type = ds.shape, ds.chunks, ds.dtype
        self.filtres = filtres(ds)
        inconnus = set(self.filtres) - {FILTRE_DEFLATE, FILTRE_SHUFFLE, FILTRE_FLETCHER}
        if inconnus or ds.chunks is None:
            raise ValueError(f'filtres HDF5 non gérés {inconnus} : lecture en flux impossible')
        n = ds.id.get_num_chunks()
        self.index = {}
        for i in range(n):
            c = ds.id.get_chunk_info(i)
            self.index[tuple(c.chunk_offset)] = (c.byte_offset, c.size, c.filter_mask)

    def decoder(self, octets, masque):
        """Octets d'un morceau -> tableau numpy (taille complète du morceau, bords compris)."""
        # les filtres sont défaits dans l'ordre inverse de leur application ; bit i du masque = filtre i sauté
        for i in reversed(range(len(self.filtres))):
            if masque & (1 << i):
                continue
            f = self.filtres[i]
            if f == FILTRE_FLETCHER:
                octets = octets[:-4]
            elif f == FILTRE_DEFLATE:
                octets = zlib.decompress(octets)
            elif f == FILTRE_SHUFFLE:
                t = self.type.itemsize
                octets = np.frombuffer(octets, np.uint8).reshape(t, -1).T.tobytes()
        return np.frombuffer(octets, self.type).reshape(self.taille_morceau)


def lire_paires(url, morceaux_a, morceaux_b, traiter, connexions=8, budget=None, verrou=None):
    """Télécharge et décode en parallèle les morceaux de A (et B à la même position si présent).

    traiter(ligne, colonne, bloc_a, bloc_b) est appelé pour chaque position (sous verrou),
    puis les octets sont oubliés. Renvoie le nombre d'octets téléchargés.
    """
    verrou = verrou or threading.Lock()
    total = [0]
    positions = sorted(morceaux_a.index)

    def tache(pos):
        oa, ta, ma = morceaux_a.index[pos]
        tb = morceaux_b.index[pos][1] if morceaux_b and pos in morceaux_b.index else 0
        if budget:
            budget.prendre(ta + tb)
        try:
            a = morceaux_a.decoder(lire_plage(url, oa, ta), ma)
            b = None
            if tb:
                ob, _, mb = morceaux_b.index[pos]
                b = morceaux_b.decoder(lire_plage(url, ob, tb), mb)
            with verrou:
                total[0] += ta + tb
                traiter(pos[0], pos[1], a, b)
        finally:
            if budget:
                budget.rendre(ta + tb)
    with ThreadPoolExecutor(connexions) as ex:
        for f in [ex.submit(tache, p) for p in positions]:
            f.result()
    return total[0]
