# SAJE Field — application (statique, hors ligne)

Responsable : Adam (AD). HTML + CSS + JavaScript. Aucun serveur, aucune base de données, aucun Internet nécessaire.

## Ouvrir
Double-cliquer sur `index.html` (Chrome, Edge ou Firefox récents). Tout est local : bibliothèques (`lib/`), polices (`fonts/`), logo (`img/`), données (`js/donnees/`) et cartes radar (`data/img/province/`).
Seul le **fond satellite** demande Internet ; il apparaît automatiquement dans les calques quand la connexion répond.

## Parcours
1. **Carte interactive** (page d’arrivée) : le monde entier, hors ligne (Natural Earth embarqué). La carte plonge ensuite vers la province de l’Estuaire.
2. On choisit un **module** (Inondations, Eau sous la végétation, Eau libre, Végétation, Changements de surface, Humidité du sol) et un **passage NISAR**.
3. L’algorithme analyse **en arrière-plan** chaque zone (137 cercles de 14 km, ou les 7 zones suivies) avec `js/raisonnement.js`, puis la carte les **colore** : alerte, à surveiller, écart sans risque, dans la normale, sans normale, non exploitable.
4. **Survol** d’une zone : info-bulle courte. **Clic** : fiche complète (constat, preuve, courbe avec la normale, verdict, les 6 modules, ce qu’on ne peut pas dire, que faire).
5. Bouton **« Ouvrir dans le tableau de bord »** : le tableau de bord complet de cette zone.

Le panneau « Où regarder en priorité » donne les mêmes informations au clavier.

## Observer dans le temps et comparer (frise en bas de la carte)
- **Frise des 13 passages** : un clic sur une date recolore la carte. Au-dessus de chaque date, une barre indique combien de zones sont à surveiller ou en alerte ce jour-là. Tous les passages sont analysés en tâche de fond.
- **Lecture ▶** : fait défiler les passages automatiquement. Pour la végétation, les jours sans mesure complète sont sautés.
- **Comparer** : choisir un passage « avant » et un « après ». Les cercles se colorent selon le changement (nette hausse, hausse, pas de changement net, baisse, nette baisse). Un changement n’est signalé que s’il dépasse les variations habituelles de la zone. Les données d’essai (bêta) ne sont pas comparées.
- La fiche d’une zone montre son évolution dans le temps, avec les deux passages marqués.
- La **légende** se replie en une ligne de pastilles. Les réglages de la carte sont dans le bouton **Affichage**.

## Réglages (menu ⋮ en haut à droite)
- **Mode simple** : pour tout le monde, en mots de tous les jours (« Donnée validée », « Mesure complète », « Comme d’habitude »…), sans chiffres techniques.
- **Mode analyste** : valeurs, médiane, σ robuste, écart z, nombre de passages, facteurs de confiance, coloration par écart z, cercles de 7 / 14 / 28 km, tableaux et exports CSV.
- **Thème sombre** (ou clair).
- **Visite guidée**.
La navigation est dans le menu burger (☰) en haut à gauche.

## Zones en cercles
Les secteurs sont des cercles disposés en nid d’abeille, et chaque zone suivie est un cercle de même surface que la zone d’origine, centré sur elle. Les calculs portent exactement sur ces cercles, sur la partie terrestre seulement.

## Ce qui est nouveau par rapport à l’ancienne version
| | |
|---|---|
| **Moteur de raisonnement** (`js/raisonnement.js`) | Ne conclut qu’à partir des données exploitables. Pour chaque indicateur : vérification (produit, polarisations, contrôle qualité NASA, couverture, maturité), **normale propre à chaque zone** (médiane ± 2 écarts robustes MAD sur les passages calibrés de la même orbite), écart signalé seulement s’il dépasse le bruit de la zone **et** un effet utile, confiance calculée avec ses raisons, liste de « ce que les données ne permettent pas de dire ». |
| **Verdict** | Une phrase en tête de page, avec jauge de confiance. |
| **Panneau « Comment SAJE Field est arrivé à cette conclusion »** | 1) données utilisées / écartées, 2) mesure placée dans la bande de normale, 3) recommandations. |
| **Courbes** | La bande de normale de la zone est dessinée ; tableau des valeurs pour l’accessibilité. |
| **Points d’attention** | Classement automatique des zones suivies pour le passage choisi. |
| **Tableau de bord (sans carte)** | Verdict, 4 indicateurs clés, frise des passages, « Lire la zone », **avant / après** en tableau (6 indicateurs, changement signalé seulement s’il dépasse la variabilité de la zone, km² de végétation perdue / gagnée), **les 6 indicateurs dans le temps** (mini-courbes avec bande de normale), **historique des états** (indicateur × passage, clic = ce passage), **toutes les zones suivies côte à côte**, raisonnement, prévision, courbe détaillée, points d’attention. La carte est la page d’arrivée ; la page « Explorer » a été retirée le 15/11. |
| **Comprendre** | Page d’apprentissage à deux niveaux (Débutant / Expert). Partie 1, le projet : SAJE Field en bref, à quoi il sert, qui peut s’en servir, jusqu’où il peut aider (voir, comprendre, comparer, anticiper, agir) et ce qu’il ne fait pas, comment fonctionne la chaîne de traitement, utiliser l’application en 3 gestes. Partie 2 : le radar, la mission NISAR, ce que l’onde raconte, HH et HV, pourquoi la bande L, lire une image, comment SAJE Field raisonne, limites, quiz de 6 questions, lexique. |
| **Visite guidée** | 3 étapes « Que voit-on ? / Pourquoi ? / Et alors ? » construites à partir des données. |
| **Sources & qualité** | Matrice d’exploitabilité indicateur × passage, contrôle qualité, limites, crédits. |
| **Accessibilité** | Navigation clavier, lien d’évitement, libellés ARIA, contrastes, alternative tableau aux graphiques, mouvement réduit respecté, thème clair/sombre, version téléphone. |
| **Exports** | Résumé copié, CSV, fiche PDF (impression). |

## Ce que dit honnêtement l’application
- L’humidité du sol SME2 existe sur 9 passages, mais **aucun pixel de la province ne passe le contrôle qualité NASA** (`retrievalQualityFlag`) : l’application ne conclut rien sur l’humidité et l’explique.
- Végétation et eau sous la végétation : seulement les passages HH + HV (6 sur 13).
- Les passages BETA sont affichés mais exclus du calcul des normales.

## Prévisions (nouveau, 15/11/2026)
Panneau **« Et ensuite ? Ce que le prochain passage devrait montrer »** dans le tableau de bord, bloc « Et au prochain passage ? » dans la fiche de la carte d'arrivée, prévision dessinée sur la courbe, recommandation quand le risque dépasse 60 % (confiance moyenne ou bonne), export « Prévisions (CSV) ».
Les prévisions des zones suivies sont calculées par le programme Python `../prevision/prevoir.py` (voir son LISEZ-MOI) et lues dans `js/donnees/previsions_province.js`. Pour une zone dessinée, ou si ce fichier est absent ou périmé (empreinte différente), `js/prediction.js` fait le même calcul dans le navigateur. Vérification : ouvrir `tests/parite.html`.

## Mettre à jour les données
Comme pour `app/` : `preparation_donnees/lancer_preparation.bat`, puis copier `data_province.js` et `cube_province.js` dans `js/donnees/` et les images dans `data/img/province/`. **Ensuite, lancer `../prevision/lancer_prevision.bat`** pour recalculer les prévisions.

## Code
```
app/
├── index.html
├── css/saje.css         design (sombre / clair, impression)
├── js/donnees.js        accès aux données (repris de app/)
├── js/analyse.js        calculs locaux sur le cube (zones dessinées, points)
├── js/raisonnement.js   moteur de raisonnement
├── js/prediction.js     moteur de prévision (jumeau de ../prevision/, lit previsions_province.js)
├── tests/parite.html    vérifie que Python et navigateur donnent les mêmes prévisions
├── js/observatoire.js   carte interactive d’arrivée (monde, secteurs, info-bulles, fiche)
├── js/donnees/monde.js  fond du monde hors ligne (Natural Earth, domaine public)
├── js/carte.js          carte Leaflet hors ligne, rideau, dessin
├── js/interface.js      pages, verdict, indicateurs, courbes, visite guidée
└── js/donnees/, data/img/province/, lib/, fonts/, img/
```
