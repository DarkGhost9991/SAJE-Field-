## Mise à jour 6.1 — 15 novembre 2026

### Lancement et jeton

Lancer `lancer_preparation.bat`. Le fichier **`token nasa.txt` situé dans ce dossier** est lu automatiquement, même si le script est lancé depuis un autre répertoire. Il doit contenir le jeton seul sur une ligne ; un préfixe `Bearer ` et un BOM UTF-8 sont acceptés. Le jeton ne figure ni dans les sorties de l'application ni dans le journal.

Ordre de priorité : variable `EDL_TOKEN`, puis `token nasa.txt`, puis jeton enregistré dans `~/.saje_field/jeton_earthdata.txt`, puis saisie masquée si le terminal est interactif. Un jeton refusé n'est pas réutilisé pendant la même exécution ; le fichier utilisateur reste intact. Pour un autre emplacement :

```powershell
python preparer_donnees_prototype.py --token-file "C:\chemin\mon_token.txt"
```

Python 3.10 ou supérieur et les dépendances de `requirements.txt` sont nécessaires. Le lanceur cherche `py`, puis `python`. Un chemin d'interpréteur peut aussi être fourni dans la variable `SAJE_PYTHON`.

### Collecte et qualité

- Le cache est vérifié avec l'identité/version des produits, l'emprise, le pas et la fréquence. Un ancien cache sans signature est relu : **le premier lancement après cette mise à jour peut télécharger de nouveau les extraits nécessaires**. Un cache ancien n'est pas présenté comme à jour si sa nouvelle lecture échoue.
- Une erreur du catalogue est distinguée d'une liste vide. Le journal conserve la cause HTTP/réseau. Un catalogue de secours corrompu est signalé ; une erreur de tunnel/proxy 403 n'invalide pas le jeton.
- La couche SME2 de référence est retenue lorsqu'elle existe. Elle n'est plus mélangée avec les algorithmes candidats. Si elle manque, la moyenne ne combine que les candidats sans alerte, pixel par pixel. Les valeurs et leur indicateur de qualité restent associés lors des mosaïques.
- Les facteurs d'échelle, décalages et valeurs de remplissage HDF5 sont appliqués. La valeur physique zéro n'est plus supprimée.
- Les statistiques utilisent uniquement les pixels dont `retrievalQualityFlag` vaut zéro, avec au moins cinq pixels retenus dans la zone. Une qualité absente, une valeur de remplissage ou un produit BETA ne suffit pas à établir une mesure fiable. Les autres pixels restent visibles en couleurs pâles, à titre qualitatif.
- `sol_mesure_pct` indique la couverture mesurée de la zone ; `sol_fiable_pct` indique la part retenue parmi les pixels mesurés. Les classes sont calculées sur les pixels retenus, pas sur toute la zone. Les seuils 0,20 / 0,35 m³/m³ restent indicatifs, à valider selon le sol.
- Les dates SME2 sans GCOV sont conservées dans les images, séries et cubes, y compris si aucun GCOV n'est exploitable. Les valeurs radar correspondantes restent manquantes ; les modules signalent le produit absent.
- Dans l'application : **Agriculture → Humidité du sol**, courbe d'humidité et colonnes supplémentaires dans l'export CSV. Les dates sans mesure radar ne sont plus assimilées à un faible risque d'inondation.

### Vérification

```powershell
python -m unittest -v test_preparation.py
```

Tests hors réseau : jeton (priorités, refus et confidentialité), cache, panne du catalogue, lecture HDF5, qualité, statistiques et génération SME2 sans GCOV avec reprise du cache. Ces tests ne prouvent pas que le jeton est encore accepté par NASA ni que des produits SME2 sont disponibles sur la zone au moment du lancement.

Vérifications effectuées le 15/11/2026 : 15 tests Python réussis ; syntaxe et intégration JavaScript vérifiées avec des cas SME2 seuls et les données actuelles de l'application. Le vrai fichier `token nasa.txt` a été lu sans afficher son contenu. Un accès distant limité aux huit premiers octets d'un produit NASA du catalogue a renvoyé HTTP 206 et une signature HDF5 correcte. La collecte complète de la province n'a pas été relancée.

Références utilisées pour les règles SME2 : [guide ASF et limites BETA](https://nisar-docs.asf.alaska.edu/product-known-issues/), [spécification SME2, rév. C](https://nisar.asf.earthdatacloud.nasa.gov/NISAR-SAMPLE-DATA/DOCS/NISAR_D-107677_RevC_NASA_SDS_Product_Specification_L3_SME2_Nov8_2024_w-sigs.pdf). Les produits SME2 PROVISIONAL restent soumis aux [limites de calibration publiées par ASF](https://nisar-docs.asf.alaska.edu/provisional-known-issues/).

---

# Préparation des données NISAR pour le prototype statique
**Responsable :** AD · **Mis à jour le :** 2026-11-14 (ajout du niveau province) · À déplacer dans le dépôt Git dès qu'il existe.

## Ce que ça fait
Ce dossier lit les images radar NISAR (GCOV) directement sur les serveurs de la NASA. Seule notre zone est lue, pas les 1,5 Go de chaque fichier. Il produit des fichiers légers, utilisables par un site statique (HTML/JS, sans serveur). Deux niveaux de zoom :

| Niveau | Zone | Orbites | Pixel | Rôle |
|---|---|---|---|---|
| `province` | **Toute la province de l'Estuaire** (lon 9,25–11,00 ; lat −0,65–1,08), contour officiel geoBoundaries | 94 le soir (cadres 88 + 89 = toute la province d'un coup) ; `--toutes-orbites` pour ajouter les autres | 80 m | Vue d'ensemble : zones inondables de toute la province, Kango, Cocobeach, Pongara, Ntoum… |
| `region` | Libreville, Akanda, Cap Estérias, Pointe-Denis, estuaire du Komo jusqu'à Kango (lon 9,25–10,20 ; lat −0,05–0,75) | **toutes** (159 et 58 le matin, 94 et 22 le soir) | 80 m | Série la plus dense (une image tous les 2–3 jours en moyenne), carte des zones inondables |
| `libreville` | Libreville et environs proches (lon 9,30–9,85 ; lat 0,15–0,65) | 159 (HH+HV) | 20 m | Détail : parcelles, quartiers, mangroves |

## Période couverte : ce qui existe vraiment
NISAR a été lancé en juillet 2025. **Il n'existe donc pas plusieurs années de données NISAR.** Sur notre zone (vérifié dans l'archive ASF le 14/11/2026) :
- 3 dates **BETA** (16/11/2025, 10/12/2025, 03/01/2026) : non calibrées, HH seul. Incluses par défaut (option `--sans-beta` pour les exclure). Elles ajoutent la saison des pluies 2025 : c'est la seule façon de remonter avant juin 2026.
- Aucune donnée entre janvier et mi-juin 2026.
- **18/06/2026 → aujourd'hui** : données calibrées, **69 produits sur 4 orbites**, et la série s'allonge de 4 dates tous les 12 jours.

Le script interroge l'archive à chaque lancement. **Il suffit de le relancer** pour ajouter les nouvelles dates : les dates déjà traitées sont reprises du cache.

## Lancer (Windows)
1. Avoir **Python 3.10+** (python.org, cocher « Add to PATH »).
2. Créer un compte **Earthdata Login** : https://urs.earthdata.nasa.gov/
   - Se connecter une fois sur https://search.asf.alaska.edu pour accepter les conditions.
   - Puis **Generate Token** et copier le jeton.
3. Double-cliquer sur **`lancer_preparation.bat`** après avoir placé le jeton seul dans `token nasa.txt`, à côté du script. **C'est tout** : le script récolte automatiquement **toute la province de l'Estuaire, depuis la date la plus ancienne disponible (4 novembre 2025) jusqu'à la plus récente**, puis fabrique les cartes et les courbes.
   - Les dates BETA (novembre 2025 à janvier 2026) sont incluses mais restent qualitatives, car elles ne sont pas calibrées.
   - Autres usages en ligne de commande : `--sans-beta` (à partir de juin 2026 seulement), `--max 3` (essai rapide), `--niveau region`, `--niveau libreville` ou `--niveau tous`.
4. Ouvrir `donnees_traitees/apercu.html` (à la racine du dépôt) (double-clic).

Le cache est gardé dans `C:\Users\<toi>\saje_cache_nisar`, hors de OneDrive.

## Ce qui est produit (`donnees_traitees/`)
| Fichier | Contenu |
|---|---|
| `data_region.js`, `data_libreville.js` | Tout le niveau dans `window.SAJE.region` / `window.SAJE.libreville` → fonctionne en `file://` |
| `meta_<niveau>.json` | Même contenu en JSON : emprise, dates, images, séries par zone, zones |
| `img/<niveau>/<date>_t<orbite>_rgb.webp` | Composition colorée (dates HH+HV) |
| `..._hh.webp` / `_hv.webp` | Rétrodiffusion HH / HV |
| `..._vegetation.webp` | Indice HV−HH → **agriculture** |
| `..._eau.webp` | Eau libre (seuil d'Otsu par date) → **inondations** |
| `..._changement.webp` | Différence HH par rapport à la date sèche de **la même orbite** (la plus proche du 07/07/2026) |
| `..._vegetation_inondee.webp` | Forte hausse de HH : végétation inondée probable |
| `img/<niveau>/frequence_eau.webp` | % des dates (toutes orbites) où le pixel est en eau → **zones à risque** |
| `catalogue_asf_<niveau>.json` | Liste des produits renvoyée par l'archive (sert aussi si l'API ne répond pas) |
| `apercu.html` + `lib/` | Visionneuse de contrôle (niveau, orbite, couche, date, zone + graphique) |

## Utiliser les données dans l'app
```js
// <script src="data_region.js"></script>
const M = window.SAJE.region;
L.imageOverlay(M.dates.at(-1).images.eau, M.bornes_leaflet).addTo(carte);
M.series["Estuaire du Komo (aval)"]   // [{date, orbite, HH_dB, HV_dB, HVmoinsHH_dB, part_eau_pct, ...}]
```
- Toutes les couches d'un niveau partagent `bornes_leaflet` (lat/lon WGS84).
- **Comparer des intensités (HH, HV) seulement au sein d'une même orbite** : l'angle de vue change d'une orbite à l'autre.
- Le % d'eau, lui, peut se comparer entre orbites.

## Réglages (en haut du script)
- `NIVEAUX` : cadres, orbites, résolution.
- `DATE_SECHE` : date de référence pour les changements.
- `ECHELLES`, `SEUIL_*` : couleurs et seuils.
- `zones_libreville.geojson` : **6 zones approximatives, à redessiner** (ex. sur geojson.io) avec de vraies parcelles et de vrais bas-fonds.

## Limites
- Les seuils (eau, végétation inondée) sont des premiers réglages, à vérifier sur les vraies images (comparer avec l'image UAVSAR 2016 et la connaissance du terrain).
- La ville produit aussi de fortes hausses de HH (bâtiments) : ne pas lire la couche « végétation inondée » en zone urbaine.
- PROVISIONAL (avant le 21/10/2026) et VALIDATED : chaînes de traitement différentes.
- Testé sur des fichiers simulés à la structure GCOV officielle (plusieurs orbites, plusieurs cadres, dates HH seul, doublons de version). Pas encore sur les vrais fichiers NISAR : faire l'essai (choix 1) d'abord.

## Corrections des limites (version du 14/11/2026, soir)
| Limite | Correction dans le script |
|---|---|
| La ville ressemble à de la végétation inondée | **Masque urbain** calculé à partir de NISAR : pixels très brillants à toutes les dates (médiane HH > −3 dB) et stables (écart-type < 1,5 dB). Exclus des couches eau, inondation et végétation inondée. Couche `urbain`. |
| Fausses alertes de végétation inondée | Il faut **deux conditions** : HH monte de plus de 3 dB **et** HH − HV monte de plus de 2 dB par rapport à la date sèche, car le double rebond eau-troncs renforce HH plus que HV. Eau permanente et urbain exclus. |
| Surfaces lisses (pistes, sable) classées en eau | L'eau doit être sombre en HH **et** en HV (seuil HV automatique, entre −32 et −20 dB). Les dates en HH seul gardent ce défaut. |
| Seuil d'eau non vérifié | **Zones témoins** (`"temoin": "eau"` / `"terre"` dans les fichiers de zones) : le seuil de chaque date est placé à mi-chemin entre le signal de l'eau sûre et celui de la terre sûre. Sans témoins : méthode d'Otsu. La méthode utilisée est notée dans `meta` (`methode_seuil`). **Vérifier que les témoins tombent bien sur de l'eau et sur de la terre.** |
| Estuaire compté comme inondation | **Eau permanente** = en eau sur ≥ 80 % des dates calibrées. Couche `inondation` = eau de la date moins l'eau permanente. |
| Orbites non comparables | **Écart à la normale** : pour chaque orbite, la médiane de chaque pixel sert de normale. Couche `anomalie` et `anomalie_HH_dB` dans les séries, comparables d'une orbite à l'autre. |
| Bords flous | **Filtre de Lee** à la place de la moyenne simple : lisse le grain, garde les berges et les limites de champs. |
| Dates BETA non calibrées | Exclues du calcul des normales, du masque urbain et de la fréquence d'eau, et pas de carte de changement pour elles. |

Nouvelles valeurs par zone dans `series` : `part_inondation_pct`, `part_vegetation_inondee_pct`, `anomalie_HH_dB`.
Testé sur une province simulée (ville, estuaire, plaine inondée, inondation saisonnière, surface lisse) : chaque cas est correctement classé. **Reste à valider sur les vraies données.**

## Corrections après le premier scan réel (14/11/2026, nuit)
| Problème vu sur les vraies données | Correction |
|---|---|
| 3 dates BETA partielles (04/11/2025, 28/11/2025, 15/01/2026) ne couvrent presque pas la province | **Contrôle qualité** : une date est rejetée si elle couvre moins de 50 % de la zone (`--couverture-min`). Tout est consigné dans `rapport_qualite_<niveau>.csv`, avec la date, la couverture, le statut (gardée, rejetée ou suspecte) et la raison. Une date dont la moyenne HH s'écarte de plus de 3 dB des autres est signalée « suspecte ». |
| La mer fausse les statistiques (zone « Libreville » à 48 % d'eau) et le vent fait varier l'océan | **Masque terre ferme** : le contour officiel de la province (`"masque_terre": true` dans `zones_estuaire.geojson`). Les statistiques par zone, les couches inondation et végétation inondée sont calculées sur la terre ferme seulement (les témoins gardent l'eau). |
| Des mangroves classées « urbain » | Le bâti doit être brillant, stable **et peu végétalisé** (HV − HH < −7,5 dB). Les mangroves, végétalisées, ne sont plus prises pour de la ville. |
| Points roses de « végétation inondée » dans la ville | Trois filtres : (1) il faut de la **végétation au départ** (HV − HH ≥ −7,5 dB) ; (2) le **tissu urbain** est élargi d'un pixel autour du bâti et aux quartiers denses (plus de 20 % de bâti dans un voisinage de 5 × 5 pixels) ; (3) les **pixels isolés** sont retirés (au moins 4 pixels voisins pour la végétation inondée, 3 pour l'inondation). |
| Image en couleurs trop pâle | **Étirement adaptatif** : les couleurs sont étirées entre les 2 % et les 98 % des valeurs réelles (normales de la série), identique pour toutes les dates afin qu'elles restent comparables (`etirement_dB` dans `meta`). |

Relancer `lancer_preparation.bat` suffit : les données déjà récoltées sont reprises du cache, et seuls les calculs sont refaits.
