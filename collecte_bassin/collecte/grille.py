"""Grilles régulières en latitude / longitude, découpées en tuiles.

Une cellule (i, j) d'un niveau couvre :
    longitude [ouest + j*pas, ouest + (j+1)*pas[ ,  latitude ]nord - (i+1)*pas, nord - i*pas]
Une tuile regroupe « tuile » x « tuile » cellules ; son identifiant est « ty_tx ».
"""
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Niveau:
    nom: str
    ouest: float
    nord: float
    pas: float
    nx: int
    ny: int
    tuile: int

    @classmethod
    def depuis(cls, nom, emprise, cfg):
        pas = cfg['pas']
        return cls(nom, emprise['ouest'], emprise['nord'], pas,
                   int(round((emprise['est'] - emprise['ouest']) / pas)),
                   int(round((emprise['nord'] - emprise['sud']) / pas)), cfg['tuile'])

    def fenetre(self, ouest, sud, est, nord):
        """Cellules (i0, i1, j0, j1) couvrant un rectangle, bornées à la grille (i1, j1 exclus)."""
        j0 = max(0, math.floor((ouest - self.ouest) / self.pas))
        j1 = min(self.nx, math.ceil((est - self.ouest) / self.pas))
        i0 = max(0, math.floor((self.nord - nord) / self.pas))
        i1 = min(self.ny, math.ceil((self.nord - sud) / self.pas))
        return (i0, i1, j0, j1) if i1 > i0 and j1 > j0 else None

    def tuiles(self, f):
        """Tuiles touchées par une fenêtre de cellules."""
        i0, i1, j0, j1 = f
        return [(ty, tx) for ty in range(i0 // self.tuile, (i1 - 1) // self.tuile + 1)
                for tx in range(j0 // self.tuile, (j1 - 1) // self.tuile + 1)]

    def bornes_tuile(self, ty, tx):
        """(i0, i1, j0, j1) de la tuile, bornée à la grille."""
        t = self.tuile
        return ty * t, min(self.ny, (ty + 1) * t), tx * t, min(self.nx, (tx + 1) * t)

    def bornes_geo(self, i0, i1, j0, j1):
        """[[sud, ouest], [nord, est]] pour Leaflet."""
        return [[self.nord - i1 * self.pas, self.ouest + j0 * self.pas], [self.nord - i0 * self.pas, self.ouest + j1 * self.pas]]


def intersection(a, b):
    o, e = max(a['ouest'], b['ouest']), min(a['est'], b['est'])
    s, n = max(a['sud'], b['sud']), min(a['nord'], b['nord'])
    return {'ouest': o, 'est': e, 'sud': s, 'nord': n} if o < e and s < n else None


def boite_wkt(wkt):
    """Rectangle englobant d'un POLYGON WKT du catalogue."""
    nombres = [float(v) for v in wkt.replace('(', ' ').replace(')', ' ').replace(',', ' ').split()[1:]]
    xs, ys = nombres[0::2], nombres[1::2]
    return {'ouest': min(xs), 'est': max(xs), 'sud': min(ys), 'nord': max(ys)}
