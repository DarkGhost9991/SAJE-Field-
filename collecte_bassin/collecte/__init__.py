"""SAJE Field - collecte en flux des données NISAR pour le bassin du Congo.

Chaîne : catalogue ASF -> sélection -> lecture en flux des seuls morceaux
utiles (bande B du GCOV, humidité + qualité du SME2) -> nettoyage, filtrage,
réduction à la grille 1 km (et 80 m sur les zones d'intérêt) -> stockage
compressé par tuiles -> comblement des trous et prévision -> fichiers de
l'application.

Aucune donnée brute n'est écrite sur le disque : chaque morceau téléchargé
est décompressé, réduit puis oublié (budget mémoire brute <= 1 Go).
"""
