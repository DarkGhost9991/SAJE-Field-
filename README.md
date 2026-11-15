# SAJE Field

**Rendre les données radar NISAR (NASA / ISRO) lisibles par tout le monde.**
Projet de l'équipe **Hope 241** pour le NASA Space Apps Challenge 2026, défi *« Dancing with the SARs »*.

SAJE Field est une application web **statique** (HTML, CSS, JavaScript) : aucun serveur, aucune base de données. Elle fonctionne **hors ligne** par simple double-clic, et peut aussi être publiée telle quelle sur GitHub Pages. Elle suit la province de l'Estuaire (Gabon) et le bassin du Congo : inondations, eau sous la végétation, eau libre, végétation, changements de surface, humidité du sol, avec une prévision pour le prochain passage du satellite.

## Équipe Hope 241
| Membre | Rôle |
|---|---|
| NDOUME Adam Clotaire | Chef de groupe · full stack |
| NGUIMBI MOUITY Sosthène | Data scientist |
| PILA Berracah Jabine | Dev analyste |
| CHATARD Alabama Keynoche | Dev analyste |
| MANGARI KOFFI Tchièsse Elie | Dev web |

## Ouvrir l'application
- **En local :** double-cliquer sur `app/index.html` (ou `index.html` à la racine). Chrome, Edge ou Firefox récents.
- **En ligne :** voir « Publier sur GitHub Pages » ci-dessous.

Seul le fond satellite (ArcGIS World Imagery) demande Internet ; tout le reste (bibliothèques, polices, données, cartes radar) est inclus.

## Organisation du dépôt
```
SAJE-Field-/
├── index.html               redirige vers app/ (page d'accueil GitHub Pages)
├── app/                     l'application web (tout ce qui est publié)
│   ├── index.html
│   ├── css/  fonts/  img/  lib/  (Leaflet, Chart.js)
│   ├── js/                  logique : raisonnement, prédiction, carte, bassin…
│   ├── js/donnees/          données générées par les scripts (province, bassin, prévisions)
│   ├── data/img/            cartes radar WebP
│   ├── tests/parite.html    vérifie que JS et Python donnent les mêmes prévisions
│   └── copier_donnees.bat   recopie donnees_traitees/ → app/
├── preparation_donnees/     récolte NISAR GCOV + SME2 de la province (Python)
├── collecte_bassin/         collecte en flux du bassin du Congo (Python)
├── prevision/               calcul des prévisions (Python)
└── donnees_traitees/        résultats intermédiaires de la préparation (non versionné)
```

## Régénérer les données (facultatif)
L'application contient déjà ses données. Pour les mettre à jour (Windows, Python 3.10+) :

1. **Jeton NASA Earthdata** : créer `preparation_donnees/token nasa.txt` contenant le jeton seul sur une ligne (ou définir la variable `EDL_TOKEN`). Ce fichier est exclu par `.gitignore` : **ne jamais le publier**.
2. `preparation_donnees/lancer_preparation.bat` → installe les modules (`requirements.txt`), récolte la province, écrit dans `donnees_traitees/` puis copie directement dans `app/`.
3. `prevision/lancer_prevision.bat` → recalcule `app/js/donnees/previsions_province.js`.
4. (Optionnel, long) `collecte_bassin/lancer_collecte.bat` → tuiles du bassin du Congo dans `app/js/donnees/bassin/`.

Les caches de téléchargement sont gardés hors du dépôt, dans `~/saje_cache_nisar` et `~/saje_cache_bassin`. Chaque dossier de script a son propre `LISEZ-MOI.md`.

Tests : `python preparation_donnees/test_preparation.py`, `python prevision/test_prevision.py`, `python collecte_bassin/test_collecte.py`.

## Publier sur GitHub Pages
1. Pousser le dépôt sur GitHub (branche `main`).
2. *Settings → Pages → Build and deployment* : Source **Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. L'application est en ligne à https://darkghost9991.github.io/SAJE-Field-/.

## Données et licences
- Données : mission NISAR (NASA / ISRO), produits L2 GCOV et L3 SME2, via ASF DAAC / NASA Earthdata.
- Bibliothèques incluses : [Leaflet](https://leafletjs.com) (BSD-2) et [Chart.js](https://www.chartjs.org) (MIT), licences dans `app/lib/`.
- Fond de carte du monde : Natural Earth (domaine public).
