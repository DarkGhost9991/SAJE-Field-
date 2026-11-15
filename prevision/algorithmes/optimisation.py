"""Optimisation : régler les paramètres d'un modèle de prévision.

Le critère à minimiser est toujours le même et s'explique simplement :
« la somme des carrés des erreurs que le modèle aurait faites s'il avait
prévu chaque passage passé à partir des seuls passages précédents ».

Deux algorithmes, choisis parce qu'ils sont rapides, déterministes et
lisibles (pas de hasard, pas de dérivée à calculer) :

- section_doree : un seul paramètre continu (α du lissage exponentiel).
  À chaque étape on garde la partie de l'intervalle qui contient le
  minimum ; l'intervalle se réduit de 38 % par étape (nombre d'or).
- grille : quelques paramètres pris dans une petite liste de valeurs
  (Holt : α, β, φ ; Kalman : q). On essaie tout, on garde le meilleur.
"""
import math

NOMBRE_OR = (math.sqrt(5) - 1) / 2


def section_doree(f, a, b, iterations=22):
    """Minimum d'une fonction unimodale f sur [a, b] (~25 évaluations de f)."""
    c, d = b - NOMBRE_OR * (b - a), a + NOMBRE_OR * (b - a)
    fc, fd = f(c), f(d)
    for _ in range(iterations):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - NOMBRE_OR * (b - a)
            fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a + NOMBRE_OR * (b - a)
            fd = f(d)
    return c if fc < fd else d


def grille(f, points):
    """Meilleur jeu de paramètres d'une liste (le premier en cas d'égalité)."""
    meilleur, fm = points[0], math.inf
    for p in points:
        v = f(p)
        if v < fm:
            fm, meilleur = v, p
    return meilleur
