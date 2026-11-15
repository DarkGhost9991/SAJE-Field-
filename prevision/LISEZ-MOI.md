# Prévisions SAJE Field (programme Python)

**Responsable :** AD · **Créé le :** 15/11/2026 · À déplacer dans le dépôt Git dès qu'il existe.

## Ce que fait le programme
`prevoir.py` lit les données de l'application, prévoit pour chaque zone suivie, chaque passage et chaque indicateur **ce que NISAR devrait mesurer au passage suivant** (12 jours plus tard), puis écrit le résultat dans l'application.

```
preparation_donnees/  ->  app/js/donnees/data_province.js + cube_province.js
                                   |
prevision/prevoir.py  -------------+-->  app/js/donnees/previsions_province.js  ->  tableau de bord « Et ensuite ? »
                                   \-->  prevision/sorties/previsions_province.csv + journal_prevision.txt
```

## Lancer
Double-cliquer sur **`lancer_prevision.bat`**, ou bien `python prevoir.py`. Il faut Python 3.9 ou plus récent, **sans aucune bibliothèque à installer**. Le calcul prend environ 1 seconde.

À relancer après chaque mise à jour des données de l'application. Si on oublie, rien ne casse : l'application voit que les prévisions ne correspondent plus aux données (empreinte) et les recalcule elle-même dans le navigateur.

Options : `--app CHEMIN` (autre dossier d'application), `--sans-cube` (séries précalculées seulement).

## Code
| Fichier | Rôle |
|---|---|
| `prevoir.py` | Programme principal : lecture, calcul, écriture des sorties |
| `algorithmes/prediction.py` | Les 6 modèles séquentiels, l'évaluation glissante, le choix, l'intervalle, le risque, la confiance |
| `algorithmes/optimisation.py` | Réglage des paramètres : section dorée, grille |
| `algorithmes/compression.py` | Décompression du cube (base64 + gzip), quantification des sorties |
| `algorithmes/donnees.py` | Lecture des fichiers de l'app ; séries des zones calculées exactement comme le navigateur (cercles, pixels du cube) |
| `test_prevision.py` | 14 tests hors réseau : `python test_prevision.py -v` |
| `../app/js/prediction.js` | Jumeau JavaScript (zones dessinées par l'utilisateur, secteurs de la carte) |
| `../app/tests/parite.html` | Ouvrir dans le navigateur : vérifie que Python et navigateur donnent les mêmes chiffres |

## Méthode, en bref
1. **Passages comparables seulement** : même orbite, calibrés (pas de BETA), polarisation suffisante, contrôle qualité, jamais après la date choisie.
2. **Six modèles en concurrence** : persistance, médiane, lissage exponentiel, Theil–Sen, Holt amorti, filtre de Kalman.
3. **Évaluation glissante honnête** : chaque modèle est réglé puis prévoit chaque passage passé avec les seuls passages précédents.
4. **Choix** : la plus petite erreur moyenne ; un modèle plus riche doit gagner au moins 5 %.
5. **Intervalle à 95 %** : erreurs passées × quantile de Student, avec le bruit plancher de l'indicateur comme minimum.
6. **Risque** : probabilité de sortir de la normale de la zone (mêmes seuils que le moteur de raisonnement). Une recommandation n'apparaît qu'au-delà de 60 %, avec une confiance moyenne ou bonne.
7. **Pas de prévision sous 5 passages comparables** : la raison est affichée.

## Vérifications faites le 15/11/2026
- 14 tests Python réussis.
- `app/tests/parite.html` dans Edge : **624 prévisions sur 624 identiques** entre Python et navigateur, 624 empreintes valides (écart max 4·10⁻⁴, dû à l'arrondi à 5 chiffres).
- Tableau de bord rendu sans erreur, panneau « Et ensuite ? » alimenté par le calcul Python.

## Limites
Séries de 4 à 10 passages calibrés, sans données de pluie : les prévisions prolongent le passé et un orage peut les démentir. Humidité du sol : aucune prévision possible (aucun pixel SME2 ne passe le contrôle qualité NASA sur la province).
