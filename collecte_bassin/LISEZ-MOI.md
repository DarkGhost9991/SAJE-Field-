# Collecte en flux du bassin du Congo (v7)

**Responsable :** AD · **Créé le :** 15/11/2026 · À déplacer dans le dépôt Git dès qu'il existe.

Ce programme étend SAJE Field de la province de l'Estuaire à **tout le bassin du Congo** (lon 8,5 → 31,5 ; lat −13,5 → 9,5), sans jamais stocker de données brutes.

## Lancer
Double-cliquer sur **`lancer_collecte.bat`**. Le jeton Earthdata est lu dans `../preparation_donnees/token nasa.txt`, comme pour le script de la province. Relancer quand on veut : seuls les produits NASA nouveaux sont lus, et une coupure ne fait rien perdre.

```
py -3.13 collecter_bassin.py                                   tout le bassin
py -3.13 collecter_bassin.py --test-emprise 9.25,-0.65,11,1.08  une sous-zone (essai)
py -3.13 collecter_bassin.py --max-cadres 20                    essai rapide
py -3.13 collecter_bassin.py --depuis 2026-10-01                produits récents seulement
py -3.13 collecter_bassin.py --sans-collecte                    recalculer comblement + export
```
Puis ouvrir `../app/index.html` → **Bassin du Congo**.

## Ce que fait le programme, dans l'ordre
| Étape | Comment | Pourquoi c'est rapide / léger |
|---|---|---|
| 1. Catalogue | API ASF par fenêtres de 15 jours, coupées en deux si le serveur refuse | Le bassin entier dépasse les limites d'une requête |
| 2. Sélection | Dernière version (CRID) de chaque produit, pas encore traitée (`etat.json`) | Reprise et mise à jour incrémentale |
| 3. Collecte | Lien signé résolu une fois, table des morceaux HDF5, téléchargement parallèle (4 cadres × 8 connexions) | Bande B du GCOV : **22 à 48 Mo par cadre au lieu de 2 Go** ; SME2 : **5 Mo au lieu de 100 Mo** |
| 4. Décodage | zlib + « shuffle » faits par le programme (identique à h5py, testé) | Plusieurs morceaux décodés pendant que d'autres arrivent |
| 5. Traitement | Moyenne 3 × 3 (chatoiement), dB, eau = HH < seuil ET HV < −22 dB, seuil d'Otsu par cadre (−16 dB par défaut), humidité seulement si `retrievalQualityFlag = 0` | Fait morceau par morceau, en mémoire |
| 6. Agrégation | Cellules de ~1,1 km sur tout le bassin, ~80 m sur les zones d'intérêt | Puissances moyennées en linéaire (multi-vues) |
| 7. Stockage | Couches de 1 octet, rognées, compressées, une par tuile et par cadre, dans `~/saje_cache_bassin` (hors OneDrive) | Quelques dizaines de ko par cadre et par tuile |
| 8. Comblement | Périodes de 12 jours ; recalage des orbites ; filtre de Kalman + lissage de Rauch-Tung-Striebel ; λ par maximum de vraisemblance (section dorée) | Chaque trou reçoit une valeur **et une incertitude** |
| 9. Prévision | Période suivante, à partir du filtre | Au moins 5 mesures dans la cellule |
| 10. Export | Quantification + **codage delta dans le temps** + gzip → tuiles `.js` | L'app charge seulement les tuiles visibles, en double-clic |

**Aucune donnée brute n'est écrite sur le disque.** Les octets téléchargés restent en mémoire le temps d'être réduits, dans la limite du budget `budget_brut_Mo` (1 000 Mo par défaut, réglable dans `config_bassin.json`).

## Volumes (mesurés sur le catalogue ASF le 15/11/2026)
| | Produits sur le bassin | Taille d'origine | Lu en flux | Temps (connexion ~3 Mo/s) |
|---|---|---|---|---|
| GCOV | ~3 200 | ≈ 6,3 To | ≈ 127 Go (bande B seule) | ~11 h pour tout l'historique, ~1 h par cycle de 12 jours |
| SME2 | ~2 600 | ≈ 0,26 To | ≈ 13 Go | ~1 h, ~7 min par cycle |

Le premier passage complet peut se faire en plusieurs fois (le programme reprend tout seul). Pour aller 10 à 50 fois plus vite, le même programme peut tourner sur une machine dans la région AWS us-west-2, où sont stockées les données NASA.

## Réglages (`config_bassin.json`)
Emprise, finesse des niveaux, **zones d'intérêt à 80 m** (ajouter un rectangle pour la Cuvette centrale, un parc…), période (12 jours), seuils d'eau, parallélisme, budget mémoire, dossier de cache.

## Code
| Fichier | Rôle |
|---|---|
| `collecter_bassin.py` | Programme principal (les 10 étapes) |
| `collecte/catalogue.py` | Catalogue ASF découpé, sélection des versions |
| `collecte/acces.py` | Jeton (réutilise celui de la préparation), lien signé, plages HTTP, budget mémoire |
| `collecte/flux_hdf5.py` | Table des morceaux HDF5 et décodage zlib + shuffle |
| `collecte/reduction.py` | Traitement d'un cadre GCOV / SME2 jusqu'aux cellules |
| `collecte/grille.py` | Grilles 1 km / 80 m et tuiles |
| `collecte/stockage.py` | Cache réduit compressé, état de la collecte |
| `collecte/comblement.py` | Périodes, recalage des orbites, Kalman + lissage, prévision |
| `collecte/export.py` | Tuiles `.js`, aperçu du bassin, index |
| `collecte/travail.py` | Exécution d'un cadre dans un processus parallèle |
| `test_collecte.py` | Tests hors réseau : `py -3.13 test_collecte.py -v` |
| `../app/js/bassin.js` | Page « Bassin du Congo » de l'application |

## Limites
- Le GCOV bande B (5 MHz) est plus grossier que la bande A (20 MHz, ~20 m), ce qui suffit pour des cellules de 1 km et de 80 m. Les produits sans bande B (~7 %) sont écartés et notés dans `etat.json`.
- Le seuil d'eau par défaut (−16 dB) vient des zones témoins de l'Estuaire. Il reste à vérifier sur la Cuvette centrale (forêts inondées, tourbières).
- Les produits BETA sont exclus par défaut (`avec_beta`).
- Pas encore d'« eau sous la végétation » à l'échelle du bassin : il faut une date sèche de référence par orbite. C'est la prochaine étape.
- Le script de la province (`../preparation_donnees/`) reste la référence à 80 m pour l'Estuaire, avec ses zones témoins et ses calculs détaillés.
