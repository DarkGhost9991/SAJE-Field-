#!/usr/bin/env python3
"""
SAJE Field - Recolte et preparation des donnees NISAR pour l'application (version 6.1)
Equipe Hope 241 - NASA Space Apps 2026 - defi "Dancing with the SARs"

CE QUE FAIT LE SCRIPT, DANS L'ORDRE
  1. Il lit la TABLE DES BESOINS (plus bas) : pour chaque module de l'application, quels produits NISAR il faut.
       Eau & inondations        -> GCOV (retrodiffusion radar HH / HV)
       Agriculture & vegetation -> GCOV + SME2 (humidite du sol)
       Image radar              -> GCOV
  2. Il demande au catalogue de l'archive ASF (NASA) la liste A JOUR de ces produits sur la zone (sans compte).
  3. Il compare cette liste avec ce qu'il a deja dans son cache : seules les dates nouvelles sont lues.
  4. Il lit A DISTANCE uniquement le morceau utile de chaque fichier (jeton Earthdata), pas les 1,5 Go entiers.
  5. Il controle (couverture, valeurs aberrantes), nettoie (filtre de Lee), convertit (dB), classe (eau, inondation,
     vegetation inondee, ville, sol sec / humide / sature) et calcule les chiffres par zone.
  6. Il ecrit des fichiers legers pour l'application : images WebP, data_<niveau>.js, cube_<niveau>.js,
     rapport de qualite, journal. Si le dossier de l'application existe, il les y copie directement.

Il est "intelligent" au sens ou il s'adapte tout seul :
  - il reprend la ou il s'est arrete (coupure de courant ou de connexion) ;
  - il refait les essais reseau, detecte un fichier de cache abime et le relit ;
  - il travaille sans Internet si tout est deja en cache ; il ne demande le jeton que s'il en a besoin ;
  - il explore la structure des fichiers SME2 pour trouver lui-meme les bonnes variables ;
  - il recale les dates BETA (non calibrees) sur la foret, cible stable, pour pouvoir les comparer aux autres ;
  - il rejette les passages incomplets et signale les dates suspectes.

Niveaux : province (defaut, orbite 94, pixel 80 m) | region | libreville (orbite 159, pixel 20 m) | tous
Prerequis : pip install -r requirements.txt   +  jeton Earthdata Login
Exemples :
  python preparer_donnees_prototype.py                      (province, tout, de la date la plus ancienne a aujourd'hui)
  python preparer_donnees_prototype.py --max 3              (essai rapide sur 3 dates)
  python preparer_donnees_prototype.py --modules eau        (seulement ce qu'il faut pour le module Eau)
  python preparer_donnees_prototype.py --sans-beta          (exclure nov. 2025 - janv. 2026)
"""
import argparse, base64, getpass, gzip, hashlib, json, os, re, shutil, sys, time, urllib.parse, urllib.request, warnings
from datetime import datetime, timezone, date
from pathlib import Path

import numpy as np

try:
    import h5py
    from pyproj import Transformer
    from PIL import Image
except ImportError as e:
    sys.exit(f"Module manquant ({e.name}). Lancer : pip install -r requirements.txt")

VERSION = "6.1"
ICI = Path(__file__).resolve().parent
RACINE_DEPOT = ICI.parent                            # racine du depot saje-field (app/, preparation_donnees/, ...)
SOUS_DOSSIER_SORTIE = "donnees_traitees"             # resultats intermediaires (ignores par git)
API_ASF = "https://api.daac.asf.alaska.edu/services/search/param"
DOSSIER_JETON = Path.home() / ".saje_field"          # hors OneDrive : le jeton ne doit pas etre partage

# ================================================================ TABLE DES BESOINS
# C'est ici que le script "sait" de quelles donnees l'application a besoin.
# Ajouter un module ou un produit = ajouter une ligne ici ; le reste du script suit.
PRODUITS = {
    "GCOV": {"niveau_asf": "GCOV", "role": "retrodiffusion radar HH / HV, 20 a 80 m",
             "variables": ["HHHH", "HVHV (si double polarisation)"]},
    "SME2": {"niveau_asf": "SME2", "role": "humidite du sol estimee, 200 m",
             "variables": ["humidite du sol (m3/m3)", "drapeau de qualite"]},
}
BESOINS = {
    "eau": {"titre": "Eau & inondations", "produits": ["GCOV"],
            "couches": ["inondation", "vegetation_inondee", "eau", "frequence_eau", "eau_permanente"]},
    "agriculture": {"titre": "Agriculture & vegetation", "produits": ["GCOV", "SME2"],
                    "couches": ["vegetation", "humidite", "anomalie", "changement", "urbain"]},
    "radar": {"titre": "Image radar", "produits": ["GCOV"], "couches": ["rgb", "hh", "hv"]},
}

# ================================================================ PARAMETRES
NIVEAUX = {
    "province": {"titre": "Province de l'Estuaire",
                 "aoi": {"ouest": 9.25, "est": 11.00, "sud": -0.65, "nord": 1.08},
                 "freq": "B", "pas": 0.00072, "tracks": {94},      # orbite 94 : cadres 88 + 89 = toute la province
                 "double_pol_seulement": False, "zones": "zones_estuaire.geojson"},
    "region": {"titre": "Region de Libreville et estuaire du Komo",
               "aoi": {"ouest": 9.25, "est": 10.20, "sud": -0.05, "nord": 0.75},
               "freq": "B", "pas": 0.00072, "tracks": None,
               "double_pol_seulement": False, "zones": "zones_libreville.geojson"},
    "libreville": {"titre": "Libreville et environs proches",
                   "aoi": {"ouest": 9.30, "est": 9.85, "sud": 0.15, "nord": 0.65},
                   "freq": "A", "pas": 0.00018, "tracks": {159},
                   "double_pol_seulement": True, "zones": "zones_libreville.geojson"},
}
DATE_SECHE = "2026-07-07"           # pour chaque orbite, la reference = date la plus proche de celle-ci
FILTRE = {"A": 5, "B": 3}           # taille du filtre anti-chatoiement (pixels)
ECHELLES = {"HH": (-25.0, 0.0), "HV": (-32.0, -8.0), "VEG": (-18.0, -4.0), "DELTA": (-6.0, 6.0)}
SEUIL_EAU_BORNES = (-24.0, -11.0)   # seuil HH de l'eau, borne a cet intervalle
SEUIL_EAU_PLANCHER = -16.0          # avec temoins : jamais plus bas (l'eau calme des rivieres est toujours en dessous)
SEUIL_EAU_HV_BORNES = (-32.0, -20.0)  # seuil HV de l'eau (l'eau est sombre en HH ET en HV)
SEUIL_VEG_INONDEE = 3.0             # hausse de HH (dB) par rapport a la date seche...
SEUIL_VEG_INONDEE_RATIO = 2.0       # ... ET hausse de HH-HV (dB) : le double rebond eau-troncs renforce HH plus que HV
URBAIN_MEDIANE_DB = -3.0            # pixel tres brillant a toutes les dates...
URBAIN_ECART_TYPE_DB = 1.5          # ... et qui varie peu = batiments (double rebond permanent)
EAU_PERMANENTE = 0.8                # en eau sur >= 80 % des dates = eau permanente (estuaire, rivieres)
ENL = 5.0                           # nombre de vues equivalent suppose pour le filtre de Lee
URBAIN_VEG_MAX_DB = -7.5            # brillant et stable mais HV-HH >= -7.5 dB = vegetation (mangrove), pas bati
URBAIN_DENSITE = 0.20               # > 20 % de bati dans un voisinage de 5 x 5 pixels = tissu urbain
VEG_MIN_REFERENCE_DB = -7.5         # vegetation inondee seulement la ou il y a de la vegetation
PIXELS_MIN_INONDATION = 3           # un pixel d'inondation doit avoir >= 3 voisins inondes (fenetre 3 x 3)
PIXELS_MIN_VEG_INONDEE = 4          # idem pour la vegetation inondee
COUVERTURE_MIN_PCT = 50.0           # date rejetee si moins de 50 % de la zone est couverte
ECART_SUSPECT_DB = 3.0              # date "suspecte" si sa moyenne HH s'ecarte de plus de 3 dB des autres
RECALAGE_MAX_DB = 8.0               # dates BETA : recalage sur la foret accepte jusqu'a +/- 8 dB
LARGEUR_WEB = 1600                  # largeur max des images (px)
# --- humidite du sol (SME2)
PAS_SME2 = 0.0018                   # ~200 m
SOL_SEC_MAX = 0.20                  # m3/m3 : en dessous = sol sec
SOL_SATURE_MIN = 0.35               # m3/m3 : au-dessus = sol sature
# --- cube pour "Radar Insight" (clic sur un point de la carte)
CUBE_FACTEUR = 8                    # 8 pixels de 80 m -> cellule d'environ 640 m
CUBE_DB = (-35.0, 5.0)              # codage des dB sur un octet
CUBE_SM_MAX = 0.635                 # codage de l'humidite sur un octet

JOURNAL = []
SECRETS = set()


def message_sur(e):
    texte = str(e) or type(e).__name__
    for secret in SECRETS:
        texte = texte.replace(secret, "[jeton masque]")
    return texte


def dire(*args, fin="\n"):
    """Affiche et garde une trace pour journal_recolte.txt."""
    txt = message_sur(" ".join(str(x) for x in args))
    print(txt, end=fin, flush=True)
    JOURNAL.append(txt + fin)


# ================================================================ JETON EARTHDATA
class JetonManquant(Exception):
    pass


class Jeton:
    """Le jeton n'est demande que si un telechargement est vraiment necessaire."""

    def __init__(self, fichier_token=None):
        self.valeur, self.origine = None, None
        self.fichier = DOSSIER_JETON / "jeton_earthdata.txt"
        self.fichier_token = Path(fichier_token) if fichier_token else ICI / "token nasa.txt"
        self.refuses = set()

    @staticmethod
    def normaliser(texte):
        texte = texte.lstrip("\ufeff").strip()
        if texte.lower().startswith("bearer "):
            texte = texte[7:].strip()
        if texte and any(c.isspace() for c in texte):
            raise JetonManquant("Le fichier du jeton doit contenir uniquement le jeton sur une ligne.")
        return texte

    def obtenir(self):
        if self.valeur:
            return self.valeur
        def candidats():
            yield "variable EDL_TOKEN", os.environ.get("EDL_TOKEN", "")
            for origine, chemin in (("token nasa.txt", self.fichier_token), ("jeton enregistre sur ce PC", self.fichier)):
                if chemin.exists():
                    try:
                        yield origine, chemin.read_text(encoding="utf-8-sig")
                    except (OSError, UnicodeError):
                        raise JetonManquant(f"Impossible de lire le fichier du jeton : {chemin.name}") from None
        for origine, texte in candidats():
            valeur = self.normaliser(texte)
            if valeur and valeur not in self.refuses:
                self.valeur, self.origine = valeur, origine
                SECRETS.add(valeur)
                dire(f"Jeton Earthdata charge depuis : {origine} (contenu masque).")
                return valeur
        if sys.stdin and sys.stdin.isatty():
            print("\nDe nouvelles donnees sont a telecharger : il faut le jeton Earthdata Login.")
            print("  https://urs.earthdata.nasa.gov/  >  Generate Token  (valable 60 jours)")
            self.valeur = self.normaliser(getpass.getpass("Colle ton jeton puis Entree (il ne s'affiche pas) : "))
            self.origine = "saisie"
        if not self.valeur or self.valeur in self.refuses:
            self.valeur = None
            raise JetonManquant("Jeton Earthdata absent ou refuse : mettre a jour token nasa.txt, EDL_TOKEN ou --token-file.")
        SECRETS.add(self.valeur)
        return self.valeur

    def confirmer(self):
        """Apres une premiere lecture reussie : proposer d'enregistrer le jeton hors du dossier partage."""
        if self.origine != "saisie":
            return
        self.origine = "saisie (confirmee)"
        try:
            rep = input("Enregistrer ce jeton sur ce PC pour les prochaines fois (hors OneDrive) ? [O/n] ").strip().lower()
            if rep in ("", "o", "oui", "y"):
                DOSSIER_JETON.mkdir(exist_ok=True)
                self.fichier.write_text(self.valeur, encoding="utf-8")
                print(f"Jeton enregistre dans {self.fichier}")
        except Exception:
            pass

    def invalider(self):
        if self.valeur:
            self.refuses.add(self.valeur)
        self.valeur = None


# ================================================================ CATALOGUE ASF
def wkt_aoi(aoi):
    o, e, s, n = aoi["ouest"], aoi["est"], aoi["sud"], aoi["nord"]
    return f"POLYGON(({o} {s},{e} {s},{e} {n},{o} {n},{o} {s}))"


def interroger_asf(aoi, produit, fichier_secours):
    """Liste a jour des produits qui touchent la zone (API publique ASF). Renvoie (liste, en_ligne)."""
    q = urllib.parse.urlencode({"dataset": "NISAR", "processingLevel": PRODUITS[produit]["niveau_asf"],
                                "intersectsWith": wkt_aoi(aoi), "output": "jsonlite", "maxResults": 2000})
    derniere = None
    for essai in range(2):
        try:
            with urllib.request.urlopen(f"{API_ASF}?{q}", timeout=60) as r:
                res = json.load(r)["results"]
            res = [x for x in res if f"_{produit}_" in (x.get("fileName") or "")]
            fichier_secours.write_text(json.dumps(res), encoding="utf-8")
            dire(f"Catalogue ASF a jour : {len(res)} produits {produit} sur la zone")
            return res, True
        except Exception as e:
            derniere = e
            time.sleep(3)
    if fichier_secours.exists():
        dire(f"Catalogue ASF inaccessible ({type(derniere).__name__}: {message_sur(derniere)}) -> tentative du catalogue {produit} enregistre")
        try:
            res = json.loads(fichier_secours.read_text(encoding="utf-8"))
            if not isinstance(res, list):
                raise ValueError("format du catalogue invalide")
            return res, False
        except (OSError, ValueError) as e:
            dire(f"Catalogue de secours inutilisable : {message_sur(e)}")
    dire(f"Catalogue ASF injoignable et aucun catalogue {produit} enregistre : {derniere}")
    return None, False


RE_NOM = re.compile(r"NISAR_L\d_PR_([A-Z0-9]+)_(\d{3})_(\d{3})_([AD])_(\d{3})_(\w{4})_(\w{4})_[A-Z]_"
                    r"(\d{8}T\d{6})_(\d{8}T\d{6})_([A-Z]\d{5})_")


def maturite(texte):
    return "BETA" if "BETA" in texte else ("PROVISIONAL" if "PROVISIONAL" in texte else "VALIDATED")


def decrire_produit(x):
    """Fiche d'un produit du catalogue. Le nom du fichier sert de secours si un champ manque."""
    nom = x.get("fileName") or ""
    m = RE_NOM.search(nom)
    if not nom.endswith(".h5") or not m:
        return None
    _, _, piste, sens, cadre, _, pol, debut, _, crid = m.groups()
    nis = x.get("nisar") or {}
    pols = nis.get("mainBandPolarization") or []
    t = x.get("startTime") or f"{debut[:4]}-{debut[4:6]}-{debut[6:8]}T{debut[9:11]}:{debut[11:13]}:{debut[13:15]}Z"
    return {"fichier": nom, "url": x.get("downloadUrl"), "date_utc": t,
            "piste": int(x.get("path") or piste), "cadre": int(x.get("frame") or cadre),
            "sens": x.get("flightDirection") or ("DESCENDING" if sens == "D" else "ASCENDING"),
            "double": ("HV" in pols) if pols else pol.startswith("D"),
            "maturite": maturite((x.get("collectionName") or "") + " " + (x.get("downloadUrl") or "")),
            "crid": nis.get("crid") or crid, "cle": re.sub(r"_[A-Z]\d{5}_.*$", "", nom)}


def preparer_groupes(res, cfg, avec_beta, double_seulement=False):
    """Garde la derniere version (CRID) de chaque produit, puis groupe par (date, orbite)."""
    meilleurs = {}
    for x in res or []:
        p = decrire_produit(x)
        if p is None or (p["maturite"] == "BETA" and not avec_beta):
            continue
        if double_seulement and not p["double"]:
            continue
        if cfg["tracks"] and p["piste"] not in cfg["tracks"]:
            continue
        if p["cle"] not in meilleurs or p["crid"] > meilleurs[p["cle"]]["crid"]:
            meilleurs[p["cle"]] = p
    groupes = {}
    for p in meilleurs.values():
        groupes.setdefault((p["date_utc"][:10], p["piste"]), []).append(p)
    return dict(sorted(groupes.items()))


# ================================================================ CACHE SUR (ecriture atomique, detection de fichier abime)
def sauver_npz(chemin, **tableaux):
    tmp = Path(str(chemin) + ".tmp.npz")
    np.savez_compressed(tmp, **tableaux)
    os.replace(tmp, chemin)              # le fichier n'apparait que s'il est complet


def charger_npz(chemin, cles=()):
    """Charge un fichier du cache ; s'il est abime ou incomplet, il est supprime et on renvoie None."""
    if not Path(chemin).exists():
        return None
    try:
        with np.load(chemin, allow_pickle=False) as z:
            d = {k: z[k] for k in z.files}
        if any(k not in d for k in cles):
            dire("(calculs d'une ancienne version -> refaits)", fin=" ")
            return None
        return d
    except Exception as e:
        dire(f"(cache abime : {Path(chemin).name} [{type(e).__name__}] -> il sera refait)", fin=" ")
        try:
            Path(chemin).unlink()
        except OSError:
            pass
        return None


def empreinte(objet):
    return hashlib.sha1(json.dumps(objet, sort_keys=True, default=str).encode()).hexdigest()[:16]


def signature_source(produits, cfg, pas, traitement):
    return empreinte({"produits": sorted((p["fichier"], p["crid"]) for p in produits),
                      "aoi": cfg["aoi"], "pas": pas, "freq": cfg["freq"], "traitement": traitement})


def cache_source(chemin, cles, signature):
    z = charger_npz(chemin, cles)
    if z is not None and str(z.get("signature_source", "")) != signature:
        dire("(cache ancien ou source modifiee -> nouvelle lecture)", fin=" ")
        return None
    return z


# ================================================================ LECTURE A DISTANCE
def ouvrir_h5(source, jeton):
    if str(source).startswith("http"):
        import fsspec
        fs = fsspec.filesystem("http", headers={"Authorization": f"Bearer {jeton.obtenir()}"},
                               cache_type="background", block_size=4 * 1024 * 1024)
        return h5py.File(fs.open(source, "rb"), "r")
    return h5py.File(source, "r")


def erreur_jeton(e):
    msg = str(e)
    if "tunnel" in msg.lower() or "proxy" in msg.lower():
        return False
    return bool(re.search(r"\b(?:401|403)\b", msg)) or isinstance(e, PermissionError)


def lire_avec_reprises(fonction, source, jeton, *args, essais=3):
    """Relance la lecture en cas de coupure reseau ; redemande le jeton s'il est refuse."""
    for n in range(1, essais + 1):
        try:
            res = fonction(source, jeton, *args)
            if str(source).startswith("http"):
                jeton.confirmer()
            return res
        except JetonManquant:
            raise
        except Exception as e:
            distant = str(source).startswith("http")
            if distant and erreur_jeton(e):
                dire("\n  Acces refuse (401/403) : verifier le jeton et les autorisations Earthdata/ASF.")
                jeton.invalider()
                if n < essais:
                    continue
            if not distant or n == essais or isinstance(e, (KeyError, ValueError)):
                raise
            dire(f"(coupure reseau, nouvel essai {n + 1}/{essais})", fin=" ")
            time.sleep(5 * n)


def tranche(coords, a, b):
    lo, hi = min(a, b), max(a, b)
    idx = np.where((coords >= lo) & (coords <= hi))[0]
    if idx.size == 0:
        return None
    return slice(int(idx[0]), int(idx[-1]) + 1)


def lire_gcov(source, jeton, cfg):
    """Lit la fenetre utile d'un produit GCOV et la place sur la grille lat/lon du niveau."""
    aoi, pas, freq = cfg["aoi"], cfg["pas"], cfg["freq"]
    lon = np.arange(aoi["ouest"], aoi["est"], pas) + pas / 2
    lat = np.arange(aoi["nord"], aoi["sud"], -pas) - pas / 2
    out = {"HH": np.full((lat.size, lon.size), np.nan, np.float32), "HV": None}
    with ouvrir_h5(source, jeton) as f:
        g = f[f"/science/LSAR/GCOV/grids/frequency{freq}"]
        x = g["xCoordinates"][...]; y = g["yCoordinates"][...]
        epsg = int(np.asarray(g["projection"][()]).ravel()[0])
        vers = Transformer.from_crs(4326, epsg, always_xy=True)
        X, Y = vers.transform([aoi["ouest"], aoi["est"], aoi["ouest"], aoi["est"]],
                              [aoi["sud"], aoi["sud"], aoi["nord"], aoi["nord"]])
        sx = tranche(x, min(X) - 500, max(X) + 500)
        sy = tranche(y, min(Y) - 500, max(Y) + 500)
        if sx is None or sy is None:
            return out
        x, y = x[sx], y[sy]
        brut = {"HH": g["HHHH"][sy, sx].astype(np.float32)}
        if "HVHV" in g:
            brut["HV"] = g["HVHV"][sy, sx].astype(np.float32)
    dx, dy = x[1] - x[0], y[1] - y[0]
    for i0 in range(0, lat.size, 512):                       # par blocs de lignes (memoire)
        LON, LAT = np.meshgrid(lon, lat[i0:i0 + 512])
        XX, YY = vers.transform(LON, LAT)
        ix = np.rint((XX - x[0]) / dx).astype(int); iy = np.rint((YY - y[0]) / dy).astype(int)
        ok = (ix >= 0) & (ix < x.size) & (iy >= 0) & (iy < y.size)
        for k, a in brut.items():
            if out[k] is None:
                out[k] = np.full((lat.size, lon.size), np.nan, np.float32)
            bloc = out[k][i0:i0 + 512]
            v = np.full(LON.shape, np.nan, np.float32)
            v[ok] = a[iy[ok], ix[ok]]
            v[~(v > 0)] = np.nan
            out[k][i0:i0 + 512] = np.where(np.isnan(bloc), v, bloc)
    return out


def assembler(grilles, cles=("HH", "HV")):
    """Mosaique des cadres d'une meme orbite/date (le premier valide l'emporte)."""
    res = {k: None for k in cles}
    for g in grilles:
        for k in res:
            if g.get(k) is None:
                continue
            res[k] = g[k] if res[k] is None else np.where(np.isnan(res[k]), g[k], res[k])
    return res


# ---------------------------------------------------------------- SME2 : le script explore le fichier lui-meme
EASE2_DEMI_LARGEUR, EASE2_HAUT = 17367530.445161, 7314540.830639
EASE2_CELLULE_200 = 2 * EASE2_DEMI_LARGEUR / 173520          # grille EASE-2 mondiale a 200 m : 173 520 colonnes


def explorer_h5(f):
    """Inventaire de tous les tableaux du fichier : (chemin, forme, type)."""
    items = []

    def visite(nom, obj):
        if isinstance(obj, h5py.Dataset):
            items.append(("/" + nom, tuple(obj.shape), str(obj.dtype)))
    f.visititems(visite)
    return items


def reperer_sme2(items):
    """Retrouve les variables utiles par leur NOM (insensible a la casse et aux separateurs),
    car l'organisation interne du produit peut changer d'une version a l'autre."""
    def cle(chemin):
        return re.sub(r"[^a-z0-9]", "", chemin.rsplit("/", 1)[-1].lower())
    st = {"algos": {}, "lat": None, "lon": None, "ligne": None, "colonne": None, "x": None, "y": None,
          "proj": None, "eau_frac": None}
    flags = {}
    for chemin, forme, _ in items:
        c, parent = cle(chemin), chemin.rsplit("/", 1)[0]
        if len(forme) == 2 and "soilmoisture" in c and not any(k in c for k in ("uncert", "std", "err", "flag", "qual")):
            nom_algo = parent.rsplit("/", 1)[-1] if c == "soilmoisture" else chemin.rsplit("/", 1)[-1]
            st["algos"][nom_algo] = {"sm": chemin, "parent": parent, "forme": forme}
        elif len(forme) == 2 and "retrieval" in c and ("flag" in c or "qual" in c):
            flags[parent] = chemin
        elif c in ("latitude", "latitudes", "lat") and st["lat"] is None:
            st["lat"] = chemin
        elif c in ("longitude", "longitudes", "lon") and st["lon"] is None:
            st["lon"] = chemin
        elif "rowindex" in c:
            st["ligne"] = chemin
        elif "columnindex" in c or "colindex" in c:
            st["colonne"] = chemin
        elif c == "xcoordinates":
            st["x"] = chemin
        elif c == "ycoordinates":
            st["y"] = chemin
        elif c in ("projection", "epsg"):
            st["proj"] = chemin
        elif "waterbodyfraction" in c:
            st["eau_frac"] = chemin
    for a in st["algos"].values():
        a["qflag"] = flags.get(a["parent"])
    # La couche de reference est deja une estimation produite par NISAR : ne pas
    # la moyenner avec ses algorithmes candidats (guide ASF, SME2 known issues).
    reference = {n: a for n, a in st["algos"].items()
                 if a["sm"].rstrip("/").lower().endswith("/sme2/grids/soilmoisture")}
    if not reference:
        reference = {n: a for n, a in st["algos"].items()
                     if "/algorithmcandidates/" not in a["sm"].lower()}
    if reference:
        st["algos"] = reference
    return st


def axes_sme2(f, st, forme):
    """Latitude de chaque ligne et longitude de chaque colonne de la grille du produit."""
    def propre(a):
        a = np.asarray(a, np.float64)
        a[(np.abs(a) > 400)] = np.nan
        return a
    lat = lon = None
    if st["lat"] and st["lon"]:
        la, lo = propre(f[st["lat"]][...]), propre(f[st["lon"]][...])
        if la.ndim == 2:                                   # grille cylindrique : lat constante par ligne
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                la, lo = np.nanmedian(la, axis=1), np.nanmedian(lo, axis=0)
        lat, lon = la, lo
    elif st["ligne"] and st["colonne"]:
        vers = Transformer.from_crs(6933, 4326, always_xy=True)
        y = EASE2_HAUT - (np.asarray(f[st["ligne"]][...], np.float64) + 0.5) * EASE2_CELLULE_200
        x = -EASE2_DEMI_LARGEUR + (np.asarray(f[st["colonne"]][...], np.float64) + 0.5) * EASE2_CELLULE_200
        lat = np.asarray(vers.transform(np.zeros_like(y), y)[1]); lon = np.asarray(vers.transform(x, np.zeros_like(x))[0])
    elif st["x"] and st["y"]:
        epsg = int(np.asarray(f[st["proj"]][()]).ravel()[0]) if st["proj"] else 6933
        if epsg != 6933:
            raise ValueError(f"projection SME2 inattendue (EPSG {epsg})")
        vers = Transformer.from_crs(6933, 4326, always_xy=True)
        x, y = np.asarray(f[st["x"]][...], np.float64), np.asarray(f[st["y"]][...], np.float64)
        lat = np.asarray(vers.transform(np.zeros_like(y), y)[1]); lon = np.asarray(vers.transform(x, np.zeros_like(x))[0])
    if lat is None:
        raise ValueError("coordonnees du produit SME2 introuvables")
    if (lat.size, lon.size) == forme:
        return lat, lon, False
    if (lon.size, lat.size) == forme:
        return lat, lon, True                               # tableau range (colonnes, lignes)
    raise ValueError(f"coordonnees SME2 ({lat.size}, {lon.size}) incompatibles avec les donnees {forme}")


def plus_proche(source, cible):
    """Indice du point de `source` le plus proche de chaque valeur de `cible` (-1 si trop loin)."""
    ok = np.isfinite(source)
    idx = np.where(ok)[0]
    s = source[ok]
    ordre = np.argsort(s)
    s, idx = s[ordre], idx[ordre]
    if s.size == 0:
        return np.full(np.asarray(cible).shape, -1, dtype=int)
    if s.size == 1:
        return np.where(np.abs(cible - s[0]) <= 0.01, idx[0], -1)
    pos = np.clip(np.searchsorted(s, cible), 1, s.size - 1)
    gauche = np.abs(cible - s[pos - 1]) <= np.abs(cible - s[pos])
    pos = np.where(gauche, pos - 1, pos)
    tol = 1.5 * float(np.nanmedian(np.abs(np.diff(s)))) if s.size > 1 else 0.01
    return np.where(np.abs(cible - s[pos]) <= tol, idx[pos], -1)


def lire_sme2(source, jeton, aoi, pas, rapport):
    """Lit l'humidite du sol d'un produit SME2 sur la zone et la place sur une grille lat/lon reguliere."""
    ny, nx = int(round((aoi["nord"] - aoi["sud"]) / pas)), int(round((aoi["est"] - aoi["ouest"]) / pas))
    latc = aoi["nord"] - (np.arange(ny) + 0.5) * pas
    lonc = aoi["ouest"] + (np.arange(nx) + 0.5) * pas
    out = {}
    with ouvrir_h5(source, jeton) as f:
        items = explorer_h5(f)
        st = reperer_sme2(items)
        if rapport is not None and not rapport.get("ecrit"):
            rapport["ecrit"] = True
            rapport["texte"] = (f"Structure du produit SME2 (fichier {Path(str(source)).name})\n"
                                + "\n".join(f"  {c}  {fo}  {t}" for c, fo, t in items)
                                + "\n\nVariables retenues par le script :\n" + json.dumps(st, indent=1, default=str) + "\n")
        if not st["algos"]:
            raise ValueError("aucune variable d'humidite du sol trouvee dans le fichier SME2 (voir structure_sme2.txt)")
        forme = next(iter(st["algos"].values()))["forme"]
        lat, lon, transpose = axes_sme2(f, st, forme)
        m = 3 * pas
        il = np.where((lat >= aoi["sud"] - m) & (lat <= aoi["nord"] + m))[0]
        ic = np.where((lon >= aoi["ouest"] - m) & (lon <= aoi["est"] + m))[0]
        if il.size == 0 or ic.size == 0:
            return {"st": st, "algos": {}}
        sl, sc = slice(int(il[0]), int(il[-1]) + 1), slice(int(ic[0]), int(ic[-1]) + 1)

        def fenetre(chemin):
            ds = f[chemin]
            a = ds[sc, sl].T if transpose else ds[sl, sc]
            return np.asarray(a), ds.attrs.get("_FillValue")
        for nom, a in st["algos"].items():
            if a["forme"] != forme:
                continue
            sm, vide = fenetre(a["sm"])
            sm = sm.astype(np.float32)
            if vide is not None:
                sm[sm == np.float32(np.asarray(vide).ravel()[0])] = np.nan
            ds = f[a["sm"]]
            sm = sm * float(ds.attrs.get("scale_factor", 1)) + float(ds.attrs.get("add_offset", 0))
            sm[~((sm >= 0.0) & (sm <= 1.0))] = np.nan       # hors plage physique (m3/m3)
            q = None
            if a.get("qflag"):
                q, vide_q = fenetre(a["qflag"])
                q = q.astype(np.int32)
                if vide_q is not None:
                    q[q == int(np.asarray(vide_q).ravel()[0])] = -1
            out[nom] = (sm, q)
    ii, jj = plus_proche(lat[sl], latc), plus_proche(lon[sc], lonc)
    ok = (ii[:, None] >= 0) & (jj[None, :] >= 0)
    res = {}
    for nom, (sm, q) in out.items():
        g = np.where(ok, sm[np.ix_(np.maximum(ii, 0), np.maximum(jj, 0))], np.nan).astype(np.float32)
        gq = None
        if q is not None:
            gq = np.where(ok, q[np.ix_(np.maximum(ii, 0), np.maximum(jj, 0))], -1)
        res[nom] = (g, gq)
    return {"st": st, "algos": res}


# ================================================================ OUTILS DE TRAITEMENT
def filtre_moyen(a, k):
    if k <= 1:
        return a
    v = np.isfinite(a)
    z = np.where(v, a, 0.0).astype(np.float64)
    p = k // 2
    z = np.pad(z, p, mode="edge"); n = np.pad(v.astype(np.float64), p, mode="edge")

    def boite(m):
        c = np.pad(m.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
        return c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    with np.errstate(invalid="ignore", divide="ignore"):
        out = boite(z) / boite(n)
    out[~v] = np.nan
    return out.astype(np.float32)


def filtre_lee(a, k, enl=None):
    """Filtre de Lee : lisse le chatoiement dans les zones homogenes, garde les contours (berges, champs)."""
    enl = enl or ENL
    if k <= 1:
        return a
    m = filtre_moyen(a, k)
    m2 = filtre_moyen(a * a, k)
    var = np.maximum(m2 - m * m, 0)
    cu2 = 1.0 / enl
    with np.errstate(invalid="ignore", divide="ignore"):
        ci2 = var / (m * m)
        w = np.clip(1.0 - cu2 / ci2, 0.0, 1.0)
    w[~np.isfinite(w)] = 0.0
    out = m + w * (a - m)
    out[~np.isfinite(a)] = np.nan
    return out.astype(np.float32)


def en_db(p):
    with np.errstate(divide="ignore", invalid="ignore"):
        d = 10.0 * np.log10(p)
    d[~np.isfinite(d)] = np.nan
    return d.astype(np.float32)


def otsu(valeurs, bornes):
    v = valeurs[np.isfinite(valeurs)]
    v = v[(v > -40) & (v < 10)]
    if v.size < 1000:
        return float(np.mean(bornes))
    h, e = np.histogram(v, bins=256)
    c = (e[:-1] + e[1:]) / 2
    w0 = np.cumsum(h); w1 = w0[-1] - w0
    m0 = np.cumsum(h * c) / np.maximum(w0, 1)
    m1 = (np.sum(h * c) - np.cumsum(h * c)) / np.maximum(w1, 1)
    return float(np.clip(c[np.argmax(w0 * w1 * (m0 - m1) ** 2)], *bornes))


def etirer(a, vmin, vmax):
    return np.nan_to_num(np.clip((a - vmin) / (vmax - vmin), 0, 1) * 255).astype(np.uint8)


def palette(a, vmin, vmax, couleurs):
    t = np.nan_to_num(np.clip((a - vmin) / (vmax - vmin), 0, 1))
    cs = np.array(couleurs, dtype=np.float32)
    pos = t * (len(cs) - 1)
    i = np.clip(np.floor(pos).astype(int), 0, len(cs) - 2)
    f = (pos - i)[..., None]
    rgb = cs[i] * (1 - f) + cs[i + 1] * f
    return np.dstack([rgb.astype(np.uint8), np.where(np.isfinite(a), 255, 0).astype(np.uint8)])


def sauver(arr, chemin, perte=True):
    mode = "L" if arr.ndim == 2 else ("RGBA" if arr.shape[2] == 4 else "RGB")
    im = Image.fromarray(arr, mode)
    if im.width > LARGEUR_WEB:
        im = im.resize((LARGEUR_WEB, round(im.height * LARGEUR_WEB / im.width)), Image.BOX if perte else Image.NEAREST)
    chemin = Path(chemin).with_suffix(".webp")
    tmp = chemin.with_suffix(".tmp")
    im.save(tmp, "WEBP", **({"quality": 80, "method": 4} if perte else {"lossless": True, "method": 4}))
    os.replace(tmp, chemin)
    return chemin.name


def masque_polygone(geom, shape, aoi, pas):
    ny, nx = shape
    LON, LAT = np.meshgrid(aoi["ouest"] + (np.arange(nx) + 0.5) * pas, aoi["nord"] - (np.arange(ny) + 0.5) * pas)
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    dedans = np.zeros(shape, bool)
    for poly in polys:
        inside = np.zeros(shape, bool)
        pts = [tuple(p[:2]) for p in poly[0]]
        for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
            if y1 == y2:
                continue
            with np.errstate(divide="ignore", invalid="ignore"):
                xint = (x2 - x1) * (LAT - y1) / (y2 - y1) + x1
            inside ^= ((y1 > LAT) != (y2 > LAT)) & (LON < xint)
        dedans |= inside
    return dedans


def moyenne(a, m, nd=2):
    if a is None:
        return None
    v = a[m & np.isfinite(a)]
    return None if v.size < 20 else round(float(np.mean(v)), nd)


def compter_voisins(masque, k):
    """Nombre de pixels vrais dans la fenetre k x k centree sur chaque pixel (images integrales)."""
    p = k // 2
    m = np.pad(masque.astype(np.int32), p, mode="constant")
    c = np.pad(m.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    return c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]


def nettoyer_isoles(masque, minimum):
    """Supprime les pixels isoles : garde un pixel s'il a au moins `minimum` pixels vrais dans sa fenetre 3 x 3."""
    return masque & (compter_voisins(masque, 3) >= minimum)


def valeurs_temoins(hh, masques, noms):
    morceaux = [hh[masques[n] & np.isfinite(hh)] for n in noms if masques.get(n) is not None]
    return np.concatenate(morceaux) if morceaux else np.array([], np.float32)


def seuils_temoins(hh, masques, temoins):
    """Seuil HH de l'eau regle sur les zones temoins du jour (eau sure / terre sure).
    Le seuil passe juste au-dessus de 90 % des pixels du temoin eau (l'estuaire peut etre agite par le vent),
    sans descendre sous le plancher (eau calme des rivieres) et sans jamais approcher le temoin terre."""
    eau, terre = valeurs_temoins(hh, masques, temoins["eau"]), valeurs_temoins(hh, masques, temoins["terre"])
    if eau.size >= 50:
        s = max(float(np.percentile(eau, 90)) + 0.5, SEUIL_EAU_PLANCHER)
        if terre.size >= 50:
            s = min(s, float(np.percentile(terre, 2)) - 1.0)
        return float(np.clip(s, *SEUIL_EAU_BORNES)), ("temoins eau + terre" if terre.size >= 50 else "temoin eau")
    return None, None


def charger_masque_terre(zones, shape, aoi, pas):
    """Terre ferme = zone(s) marquee(s) "masque_terre" (contour officiel de la province). Sinon : tout."""
    feats = [z for z in zones if z["properties"].get("masque_terre")]
    if not feats and (ICI / "zones_estuaire.geojson").exists():
        try:
            feats = [z for z in json.load(open(ICI / "zones_estuaire.geojson", encoding="utf-8"))["features"]
                     if z["properties"].get("masque_terre")]
        except Exception:
            feats = []
    if not feats:
        return np.ones(shape, bool), False
    terre = np.zeros(shape, bool)
    for z in feats:
        terre |= masque_polygone(z["geometry"], shape, aoi, pas)
    return terre, True


def reduire(a, f, fonction=np.nanmean):
    """Regroupe les pixels par blocs f x f (pour le cube leger de Radar Insight)."""
    ny, nx = a.shape[0] // f, a.shape[1] // f
    blocs = a[:ny * f, :nx * f].reshape(ny, f, nx, f)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return fonction(blocs, axis=(1, 3))


def octet_db(a):
    lo, hi = CUBE_DB
    o = np.clip(np.rint((a - lo) / (hi - lo) * 254), 0, 254)
    return np.where(np.isfinite(a), o, 255).astype(np.uint8)


# ================================================================ ETAPE A : GCOV (lecture, controle, filtre, seuils)
def recolter_gcov(nom, cfg, a, jeton, sortie, cache, zones, bilan):
    res, en_ligne = interroger_asf(cfg["aoi"], "GCOV", sortie / f"catalogue_asf_{nom}.json")
    if res is None:
        dire("GCOV : catalogue inaccessible et aucun secours utilisable ; tentative des autres produits.")
    groupes = preparer_groupes(res, cfg, a.beta, cfg["double_pol_seulement"])
    if a.max:
        groupes = dict(list(groupes.items())[: a.max])
    deja = sum(1 for (d, p) in groupes if (cache / f"{d}_t{p}.npz").exists())
    dire(f"\n=== {cfg['titre']} : {len(groupes)} passages GCOV au catalogue, {deja} deja en cache, "
         f"{len(groupes) - deja} a lire (pixel ~{round(cfg['pas'] * 111000)} m) ===")
    bilan["GCOV"] = {"catalogue": len(groupes), "cache": 0, "lus": 0, "rejetes": 0, "erreurs": int(res is None), "en_ligne": en_ligne}

    pas, aoi, k = cfg["pas"], cfg["aoi"], FILTRE[cfg["freq"]]
    noms_zones = [z["properties"]["nom"] for z in zones]
    temoins = {"eau": [z["properties"]["nom"] for z in zones if z["properties"].get("temoin") == "eau"],
               "terre": [z["properties"]["nom"] for z in zones if z["properties"].get("temoin") == "terre"]}
    sig_filtre = empreinte([VERSION, k, ENL, pas, aoi])          # change -> le filtrage est refait
    signature = empreinte([sig_filtre, SEUIL_EAU_BORNES, SEUIL_EAU_HV_BORNES, SEUIL_EAU_PLANCHER,
                           [z["geometry"] for z in zones if z["properties"].get("temoin")]])   # change -> seuils refaits
    masques, terre, a_terre, dates, qualite = None, None, False, [], []

    for i, ((d_iso, piste), prods) in enumerate(groupes.items(), 1):
        tag = f"{d_iso}_t{piste}"
        cpath, dbpath = cache / f"{tag}.npz", cache / f"{tag}_db.npz"
        t0 = time.time()
        ligne_q = {"date": d_iso, "orbite": piste, "maturite": prods[0]["maturite"], "cadres": len(prods)}
        dire(f"[{i}/{len(groupes)}] {d_iso} orbite {piste} ({len(prods)} cadre(s), {prods[0]['maturite']}) ...", fin=" ")
        try:
            sig_source = signature_source(prods, cfg, cfg["pas"], "gcov-v1")
            z = cache_source(cpath, ("HH",), sig_source)
            if z is not None:
                gr = {"HH": z["HH"], "HV": z.get("HV")}
                dire("cache", fin=" ")
                bilan["GCOV"]["cache"] += 1
            else:
                lus = []
                for p in prods:
                    src = (Path(a.local) / p["fichier"]) if a.local else p["url"]
                    lus.append(lire_avec_reprises(lire_gcov, src, jeton, cfg))
                gr = assembler(lus)
                sauver_npz(cpath, signature_source=sig_source, **{kk: v for kk, v in gr.items() if v is not None})
                bilan["GCOV"]["lus"] += 1
        except Exception as e:
            msg = message_sur(e)
            if not a.local and erreur_jeton(e):
                msg += "  -> jeton Earthdata invalide/expire, ou conditions ASF non acceptees (se connecter une fois sur https://search.asf.alaska.edu)"
            dire(f"ECHEC : {msg}")
            qualite.append({**ligne_q, "couverture_pct": None, "statut": "erreur", "raison": msg[:200]})
            bilan["GCOV"]["erreurs"] += 1
            continue
        if gr["HH"] is None or not np.isfinite(gr["HH"]).any():
            dire("hors zone, ignoree")
            qualite.append({**ligne_q, "couverture_pct": 0.0, "statut": "rejetee", "raison": "aucun pixel sur la zone"})
            bilan["GCOV"]["rejetes"] += 1
            continue

        reprise, filtre_ok = None, None
        if dbpath.exists() and dbpath.stat().st_mtime >= cpath.stat().st_mtime:
            zdb = charger_npz(dbpath, ("hh", "eau", "signature", "sig_filtre", "s_hh", "methode"))
            if zdb is not None and str(zdb["sig_filtre"]) == sig_filtre:
                filtre_ok = zdb                    # filtrage deja fait : on le garde
                if str(zdb["signature"]) == signature:
                    reprise = zdb                  # seuils de l'eau deja calcules avec les memes reglages
        if filtre_ok is not None:
            hh = filtre_ok["hh"].astype(np.float32)
            hv = filtre_ok["hv"].astype(np.float32) if "hv" in filtre_ok else None
        else:
            hh = en_db(filtre_lee(gr["HH"], k))
            hv = en_db(filtre_lee(gr["HV"], k)) if gr["HV"] is not None and np.isfinite(gr["HV"]).any() else None
        valide = np.isfinite(hh)
        if masques is None:
            masques = {zn: masque_polygone(z["geometry"], hh.shape, aoi, pas) for zn, z in zip(noms_zones, zones)}
            terre, a_terre = charger_masque_terre(zones, hh.shape, aoi, pas)
        couv = 100 * float((valide & terre).sum()) / max(int(terre.sum()), 1)
        ligne_q["couverture_pct"] = round(couv, 1)
        if couv < a.couverture_min:
            dire(f"rejetee (couverture {couv:.1f} % < {a.couverture_min} %)")
            qualite.append({**ligne_q, "statut": "rejetee", "raison": f"couverture insuffisante ({couv:.1f} %)"})
            bilan["GCOV"]["rejetes"] += 1
            continue
        if reprise is not None:
            s_hh, methode = float(reprise["s_hh"]), str(reprise["methode"])
            s_hv = float(reprise["s_hv"]) if "s_hv" in reprise else None
        else:
            s_hh, methode = seuils_temoins(hh, masques, temoins)
            if s_hh is None:
                s_hh, methode = otsu(hh, SEUIL_EAU_BORNES), "Otsu"
            s_hv = otsu(hv, SEUIL_EAU_HV_BORNES) if hv is not None else None
            eau_brute = (hh < s_hh) & valide
            if hv is not None:
                eau_brute &= ~(hv >= s_hv)          # l'eau doit etre sombre aussi en HV (evite routes, pistes, sable)
            sauver_npz(dbpath, hh=hh.astype(np.float16), eau=eau_brute, signature=signature, sig_filtre=sig_filtre,
                       s_hh=s_hh, methode=methode,
                       **({"hv": hv.astype(np.float16), "s_hv": s_hv} if hv is not None else {}))
        dates.append({"date": d_iso, "date_utc": prods[0]["date_utc"], "orbite": piste, "sens": prods[0]["sens"],
                      "double_pol": hv is not None, "maturite": prods[0]["maturite"],
                      "seuil_eau_dB": round(s_hh, 2), "seuil_eau_HV_dB": None if s_hv is None else round(s_hv, 2),
                      "methode_seuil": methode, "couverture_pct": round(couv, 1),
                      "images": {}, "produits": [p["fichier"] for p in prods], "_tag": tag})
        qualite.append({**ligne_q, "statut": "gardee", "raison": "", "seuil_eau_dB": round(s_hh, 2), "methode_seuil": methode})
        dire(f"ok ({time.time() - t0:.0f} s, couverture {couv:.1f} %, seuil eau {s_hh:.1f} dB [{methode}]"
             f"{', calculs repris' if reprise is not None else (', filtrage repris' if filtre_ok is not None else '')})")
    return {"dates": dates, "qualite": qualite, "masques": masques, "terre": terre, "a_terre": a_terre,
            "temoins": temoins, "noms_zones": noms_zones}


# ================================================================ ETAPE B : analyse de la serie (references, classes, images, chiffres)
def analyser_gcov(nom, cfg, a, sortie, cache, zones, g):
    dimg = sortie / "img" / nom
    dates, qualite, masques, terre = g["dates"], g["qualite"], g["masques"], g["terre"]
    temoins, noms_zones = g["temoins"], g["noms_zones"]
    pas, aoi = cfg["pas"], cfg["aoi"]
    est_temoin = {z["properties"]["nom"]: bool(z["properties"].get("temoin")) for z in zones}

    def charger(d):
        z = np.load(cache / f"{d['_tag']}_db.npz")
        return (z["hh"].astype(np.float32), z["hv"].astype(np.float32) if "hv" in z.files else None, z["eau"])

    calibrees = [d for d in dates if d["maturite"] != "BETA"] or dates   # les references viennent des dates calibrees
    shape = terre.shape
    # cible stable pour recaler les dates BETA : le temoin foret (sinon toute la terre ferme)
    cible = np.zeros(shape, bool)
    for n in temoins["terre"]:
        cible |= masques[n]
    if cible.sum() < 200:
        cible = terre.copy()

    sig = empreinte([VERSION, DATE_SECHE, ECHELLES, SEUIL_VEG_INONDEE, SEUIL_VEG_INONDEE_RATIO, URBAIN_MEDIANE_DB,
                     URBAIN_ECART_TYPE_DB, EAU_PERMANENTE, URBAIN_VEG_MAX_DB, URBAIN_DENSITE, VEG_MIN_REFERENCE_DB,
                     PIXELS_MIN_INONDATION, PIXELS_MIN_VEG_INONDEE, RECALAGE_MAX_DB, LARGEUR_WEB, CUBE_FACTEUR, CUBE_DB,
                     pas, aoi, [z["geometry"] for z in zones], [z["properties"] for z in zones],
                     [(d["_tag"], d["seuil_eau_dB"], d["seuil_eau_HV_dB"], d["maturite"]) for d in dates]])

    # ---- references de la serie : normale de chaque orbite, masque urbain, eau permanente, etirement des couleurs
    gpath = cache / "_globales.npz"
    G = charger_npz(gpath, ("sig", "urbain", "permanente", "freq_eau", "etir", "ref_cible"))
    pistes_cal = sorted({d["orbite"] for d in calibrees})
    if G is not None and str(G["sig"]) == sig:
        dire("References de la serie : reprises du cache")
        urbain, permanente, freq_eau = G["urbain"], G["permanente"], G["freq_eau"].astype(np.float32)
        etir = {k: tuple(v) for k, v in json.loads(str(G["etir"])).items()}
        medianes = {p: G[f"med_{p}"].astype(np.float32) for p in pistes_cal if f"med_{p}" in G}
        med_veg = {p: G[f"mv_{p}"].astype(np.float32) for p in pistes_cal if f"mv_{p}" in G}
        ref_cible = json.loads(str(G["ref_cible"]))
    else:
        dire("References de la serie : calcul (normale de chaque orbite, ville, eau permanente) ...", fin=" ")
        t0 = time.time()
        coeur_urbain = np.zeros(shape, bool)
        medianes, med_veg, ref_cible = {}, {}, {}
        p_hh, p_hv = [], []
        for piste in pistes_cal:
            ds = [d for d in calibrees if d["orbite"] == piste]
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                pile = np.stack([charger(d)[0] for d in ds])
                med = np.nanmedian(pile, axis=0)
                et = np.nanstd(pile, axis=0) if pile.shape[0] >= 3 else np.full(shape, np.inf, np.float32)
                ref_cible[str(piste)] = float(np.nanmedian(med[cible])) if np.isfinite(med[cible]).any() else None
                del pile
                vv = [charger(d) for d in ds if d["double_pol"]]
                mv = np.nanmedian(np.stack([hv_ - hh_ for hh_, hv_, _ in vv]), axis=0) if vv else None
                mhv = np.nanmedian(np.stack([hv_ for _, hv_, _ in vv]), axis=0) if vv else None
                del vv
            medianes[piste] = med.astype(np.float32)
            if mv is not None:
                med_veg[piste] = mv.astype(np.float32)
                p_hv.append(mhv[np.isfinite(mhv)])
            p_hh.append(med[np.isfinite(med)])
            brillant_stable = (med > URBAIN_MEDIANE_DB) & (et < URBAIN_ECART_TYPE_DB)
            if mv is not None:     # les mangroves sont brillantes et stables mais VEGETALISEES : pas des batiments
                brillant_stable &= ~(mv >= URBAIN_VEG_MAX_DB)
            coeur_urbain |= brillant_stable
        urbain = (compter_voisins(coeur_urbain, 3) > 0) | (compter_voisins(coeur_urbain, 5) / 25.0 > URBAIN_DENSITE)

        def bornes(listes, defaut):
            v = np.concatenate(listes) if listes else np.array([])
            if v.size < 1000:
                return defaut
            lo, hi = np.percentile(v, [2, 98])
            return (round(float(lo), 1), round(float(hi), 1))
        etir = {"HH": bornes(p_hh, ECHELLES["HH"]), "HV": bornes(p_hv, ECHELLES["HV"])}
        # frequence de l'eau : TOUTES les dates comptent, BETA comprises (le seuil de l'eau est regle date par date)
        n_eau = np.zeros(shape, np.uint16); n_val = np.zeros(shape, np.uint16)
        for d in dates:
            hh, _, eau = charger(d)
            n_eau += eau & ~urbain; n_val += np.isfinite(hh)
        with np.errstate(invalid="ignore", divide="ignore"):
            freq_eau = np.where(n_val > 0, n_eau / np.maximum(n_val, 1), np.nan).astype(np.float32)
        permanente = (freq_eau >= EAU_PERMANENTE) & (n_val >= 3)
        sauver_npz(gpath, sig=sig, urbain=urbain, permanente=permanente, freq_eau=freq_eau.astype(np.float16),
                   etir=json.dumps(etir), ref_cible=json.dumps(ref_cible),
                   **{f"med_{p}": m.astype(np.float16) for p, m in medianes.items()},
                   **{f"mv_{p}": m.astype(np.float16) for p, m in med_veg.items()})
        dire(f"ok ({time.time() - t0:.0f} s)")
    veg_ref = None
    if med_veg:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            veg_ref = np.nanmean(np.stack(list(med_veg.values())), axis=0)

    globales = {}
    img = palette(freq_eau, 0, 1, [(255, 255, 255), (150, 200, 255), (20, 80, 220), (10, 20, 120)])
    img[..., 3] = np.where(freq_eau > 0.05, 220, 0).astype(np.uint8)
    globales["frequence_eau"] = f"img/{nom}/" + sauver(img, dimg / "frequence_eau")
    img = np.zeros(shape + (4,), np.uint8); img[permanente] = (10, 40, 140, 210)
    globales["eau_permanente"] = f"img/{nom}/" + sauver(img, dimg / "eau_permanente", perte=False)
    img = np.zeros(shape + (4,), np.uint8); img[urbain] = (255, 170, 0, 200)
    globales["urbain"] = f"img/{nom}/" + sauver(img, dimg / "urbain", perte=False)

    # ---- chaque date : images, eau corrigee, inondation, changements, anomalies, chiffres par zone, cube
    seche = date.fromisoformat(DATE_SECHE)
    refs = {}
    for piste in sorted({d["orbite"] for d in dates}):
        ds = [d for d in calibrees if d["orbite"] == piste] or [d for d in dates if d["orbite"] == piste]
        refs[piste] = min(ds, key=lambda d: abs((date.fromisoformat(d["date"]) - seche).days))
    series = {zn: [] for zn in noms_zones}
    moy_terre, cube = {}, {}
    f = CUBE_FACTEUR
    for n, d in enumerate(dates, 1):
        piste, tag = d["orbite"], d["_tag"]
        ppath, cpath = cache / f"{tag}_p3.json", cache / f"{tag}_cube.npz"
        if ppath.exists():
            try:
                rec = json.loads(ppath.read_text(encoding="utf-8"))
                zc = charger_npz(cpath, ("hh", "hv", "classe"))
                if (rec.get("sig") == sig and zc is not None
                        and all((sortie / p).exists() for p in rec["maj"]["images"].values())):
                    d.update(rec["maj"])
                    for zn, ligne in rec["series"].items():
                        series[zn].append(ligne)
                    moy_terre[tag] = rec["moy_terre"]
                    cube[tag] = zc
                    dire(f"  produits {n}/{len(dates)} {d['date']} : repris")
                    continue
            except Exception:
                pass
        t0 = time.time()
        hh, hv, eau = charger(d)
        valide = np.isfinite(hh)
        # --- dates BETA : recalage sur la cible stable (foret) pour les rendre comparables aux dates calibrees
        comparable = True
        if d["maturite"] == "BETA":
            ref_c = ref_cible.get(str(piste))
            v = hh[cible & valide]
            if ref_c is not None and v.size >= 200:
                decalage = float(ref_c - np.median(v))
                if abs(decalage) <= RECALAGE_MAX_DB:
                    hh = hh + np.float32(decalage)
                    d["recalage_dB"] = round(decalage, 2)
                else:
                    comparable = False
                    d["recalage_dB"] = None
            else:
                comparable = False
                d["recalage_dB"] = None
        alpha = np.where(valide, 255, 0).astype(np.uint8)
        im = {}
        g8 = etirer(hh, *etir["HH"])
        im["hh"] = f"img/{nom}/" + sauver(np.dstack([g8] * 3 + [alpha]), dimg / f"{tag}_hh")
        veg = None
        if hv is not None:
            veg = hv - hh
            v8 = etirer(hv, *etir["HV"])
            im["rgb"] = f"img/{nom}/" + sauver(np.dstack([g8, v8, g8, alpha]), dimg / f"{tag}_rgb")
            im["hv"] = f"img/{nom}/" + sauver(np.dstack([v8] * 3 + [alpha]), dimg / f"{tag}_hv")
            im["vegetation"] = f"img/{nom}/" + sauver(palette(veg, *ECHELLES["VEG"],
                                                  [(120, 80, 40), (230, 210, 120), (40, 150, 60), (10, 80, 30)]),
                                                  dimg / f"{tag}_vegetation")
        eau = eau & ~urbain
        inond = nettoyer_isoles(eau & ~permanente & terre, PIXELS_MIN_INONDATION)
        e = np.zeros(hh.shape + (4,), np.uint8); e[eau] = (30, 120, 255, 200)
        im["eau"] = f"img/{nom}/" + sauver(e, dimg / f"{tag}_eau", perte=False)
        e = np.zeros(hh.shape + (4,), np.uint8); e[inond] = (0, 220, 255, 220)
        im["inondation"] = f"img/{nom}/" + sauver(e, dimg / f"{tag}_inondation", perte=False)

        anomalie = None
        if piste in medianes and comparable:
            anomalie = hh - medianes[piste]
            im["anomalie"] = f"img/{nom}/" + sauver(
                palette(anomalie, *ECHELLES["DELTA"], [(30, 90, 200), (245, 245, 245), (200, 40, 40)]), dimg / f"{tag}_anomalie")

        ref = refs[piste]
        veg_in = np.zeros(hh.shape, bool)
        if d is not ref and comparable:
            rhh, rhv, _ = charger(ref)
            delta = hh - rhh
            im["changement"] = f"img/{nom}/" + sauver(
                palette(delta, *ECHELLES["DELTA"], [(30, 90, 200), (245, 245, 245), (200, 40, 40)]), dimg / f"{tag}_changement")
            veg_in = delta > SEUIL_VEG_INONDEE
            if hv is not None and rhv is not None:
                veg_in &= ((hh - hv) - (rhh - rhv)) > SEUIL_VEG_INONDEE_RATIO
            vegetalise = med_veg.get(piste, veg_ref)       # il faut de la vegetation au depart
            if vegetalise is not None:
                veg_in &= vegetalise >= VEG_MIN_REFERENCE_DB
            veg_in &= ~urbain & ~permanente & valide & terre
            veg_in = nettoyer_isoles(veg_in, PIXELS_MIN_VEG_INONDEE)
            vi = np.zeros(delta.shape + (4,), np.uint8); vi[veg_in] = (255, 60, 160, 210)
            im["vegetation_inondee"] = f"img/{nom}/" + sauver(vi, dimg / f"{tag}_vegetation_inondee", perte=False)

        utile = valide & ~urbain & terre
        maj = {"images": im, "reference": ref["date"],
               "part_eau_pct": round(100 * float(eau[utile].mean()), 1) if utile.any() else None,
               "part_inondation_pct": round(100 * float(inond[utile].mean()), 1) if utile.any() else None,
               "part_vegetation_inondee_pct": round(100 * float(veg_in[utile].mean()), 2) if utile.any() else None}
        if "recalage_dB" in d:
            maj["recalage_dB"] = d["recalage_dB"]
        d.update(maj)
        moy_terre[tag] = float(np.nanmean(hh[valide & terre])) if (valide & terre).any() else None
        lignes = {}
        for zn, m in masques.items():
            mz = m if est_temoin[zn] else (m & terre)            # statistiques sur la terre ferme (pas la mer)
            mv = mz & valide & ~urbain
            if mv.sum() < 20:
                continue
            lignes[zn] = {"date": d["date"], "orbite": piste, "sens": d["sens"], "double_pol": hv is not None,
                          "maturite": d["maturite"],
                          "HH_dB": moyenne(hh, mz & ~urbain), "HV_dB": moyenne(hv, mz & ~urbain),
                          "HVmoinsHH_dB": moyenne(veg, mz & ~urbain),
                          "anomalie_HH_dB": moyenne(anomalie, mz & ~urbain),
                          "part_eau_pct": round(100 * float(eau[mv].mean()), 1),
                          "part_inondation_pct": round(100 * float(inond[mv].mean()), 1),
                          "part_vegetation_inondee_pct": round(100 * float(veg_in[mv].mean()), 1) if comparable else None,
                          "part_urbain_pct": round(100 * float((urbain & mz).sum() / max(int(mz.sum()), 1)), 1),
                          "couverture_pct": round(100 * float((mz & valide).sum() / max(int(mz.sum()), 1)), 1)}
            series[zn].append(lignes[zn])
        # --- cube leger pour le clic sur la carte : moyenne par cellule + classes
        classe = ((reduire(eau.astype(np.float32), f) >= 0.30) * 1 + (reduire(inond.astype(np.float32), f) >= 0.15) * 2
                  + (reduire(veg_in.astype(np.float32), f) >= 0.15) * 4 + (reduire(urbain.astype(np.float32), f) >= 0.30) * 8
                  + (reduire(permanente.astype(np.float32), f) >= 0.50) * 16
                  + (reduire(terre.astype(np.float32), f) >= 0.50) * 32).astype(np.uint8)
        zc = {"hh": octet_db(reduire(hh, f)),
              "hv": octet_db(reduire(hv, f)) if hv is not None else np.full(classe.shape, 255, np.uint8), "classe": classe}
        sauver_npz(cpath, **zc)
        cube[tag] = zc
        tmp = ppath.with_suffix(".tmp")
        tmp.write_text(json.dumps({"sig": sig, "maj": maj, "series": lignes, "moy_terre": moy_terre[tag]}), encoding="utf-8")
        os.replace(tmp, ppath)
        dire(f"  produits {n}/{len(dates)} {d['date']} : ok ({time.time() - t0:.0f} s"
             f"{', recalage BETA ' + format(d['recalage_dB'], '+.1f') + ' dB' if d.get('recalage_dB') is not None else ''})")

    # ---- controle qualite : dates dont la moyenne HH (terre) s'ecarte fortement des autres dates de la meme orbite
    for piste in {d["orbite"] for d in dates}:
        vals = [moy_terre[d["_tag"]] for d in dates if d["orbite"] == piste and moy_terre.get(d["_tag"]) is not None]
        if len(vals) < 3:
            continue
        mediane = float(np.median(vals))
        for d in dates:
            m = moy_terre.get(d["_tag"])
            if d["orbite"] == piste and m is not None and abs(m - mediane) > ECART_SUSPECT_DB:
                d["suspecte"] = f"moyenne HH {m - mediane:+.1f} dB par rapport aux autres dates"
                for q in qualite:
                    if q["date"] == d["date"] and q["orbite"] == piste:
                        q["statut"] = "gardee (suspecte)"; q["raison"] = d["suspecte"]
    for q in qualite:
        d = next((x for x in dates if x["date"] == q["date"] and x["orbite"] == q["orbite"]), None)
        if d is not None and d.get("recalage_dB") is not None:
            q["recalage_dB"] = d["recalage_dB"]

    cellule_km2 = (pas * 111.32) * (pas * 110.57)
    surfaces = {}
    for zn, m in masques.items():
        mz = m if est_temoin[zn] else (m & terre)
        lat_moy = (aoi["nord"] + aoi["sud"]) / 2
        surfaces[zn] = round(float(mz.sum()) * cellule_km2 * float(np.cos(np.radians(lat_moy))), 1)
    return {"globales": globales, "series": series, "etir": etir, "urbain": urbain, "permanente": permanente,
            "calibrees": calibrees, "cube": cube, "surfaces": surfaces}


# ================================================================ ETAPE C : SME2 (humidite du sol)
def fusionner_sme2(lus, beta=False):
    """Mosaïque avec valeurs/qualite inseparables ; seuls les pixels sans alerte
    contribuent a une moyenne fiable. Les autres restent un apercu qualitatif.
    NISAR D-107677 Rev C : retrievalQualityFlag=0 signifie sans anomalie.
    Les indicateurs BETA ne sont pas pleinement implementes (guide ASF).
    """
    noms = sorted({n for l in lus for n in l["algos"]})
    if not noms:
        raise ValueError("aucun pixel SME2 sur la zone")
    couches, fiables, connue = [], [], False
    for n in noms:
        g = bon = None
        for l in lus:
            if n not in l["algos"]:
                continue
            v, q = l["algos"][n]
            valide = np.isfinite(v)
            fiable = valide & (q == 0) if q is not None and not beta else np.zeros(v.shape, bool)
            connue |= q is not None and not beta and bool(np.any(valide & (q >= 0)))
            if g is None:
                g, bon = v.copy(), fiable.copy()
            else:
                prendre = valide & (~np.isfinite(g) | (~bon & fiable))
                g[prendre], bon[prendre] = v[prendre], fiable[prendre]
        couches.append(g)
        fiables.append(bon)
    pile, bons = np.stack(couches), np.stack(fiables)
    fiable = np.any(bons, axis=0)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        qualitatif = np.nanmean(pile, axis=0)
        retenu = np.nanmean(np.where(bons, pile, np.nan), axis=0)
    sm = np.where(fiable, retenu, qualitatif).astype(np.float32)
    return sm, fiable, {"noms": noms, "qualite_connue": bool(connue),
                        "politique": "reference NISAR si presente ; sinon moyenne des candidats sans alerte ; BETA qualitatif"}


def statistiques_sme2(sm, fiable, masque, terre, qualite_connue):
    zone = masque & terre
    mesure = zone & np.isfinite(sm)
    retenu = mesure & fiable
    v = sm[retenu]
    suffisant = v.size >= 5
    return {"humidite_m3m3": round(float(v.mean()), 3) if suffisant else None,
            "sol_sec_pct": round(100 * float((v < SOL_SEC_MAX).mean()), 1) if suffisant else None,
            "sol_humide_pct": round(100 * float(((v >= SOL_SEC_MAX) & (v < SOL_SATURE_MIN)).mean()), 1) if suffisant else None,
            "sol_sature_pct": round(100 * float((v >= SOL_SATURE_MIN).mean()), 1) if suffisant else None,
            "sol_mesure_pct": round(100 * int(mesure.sum()) / max(int(zone.sum()), 1), 1),
            "sol_fiable_pct": round(100 * int(retenu.sum()) / int(mesure.sum()), 1) if qualite_connue and mesure.any() else None,
            "sol_pixels_retenus": int(retenu.sum())}


def recolter_sme2(nom, cfg, a, jeton, sortie, cache, zones, dates, series, bilan):
    """Ajoute l'humidite du sol aux dates et aux zones. Ne bloque jamais le reste : en cas de souci, on explique et on continue."""
    info = {"statut": "indisponible", "raison": "", "dates": 0, "algorithmes": [],
            "seuils_m3m3": {"sec_max": SOL_SEC_MAX, "sature_min": SOL_SATURE_MIN}, "pixel_m": round(PAS_SME2 * 111000)}
    bilan["SME2"] = {"catalogue": 0, "cache": 0, "lus": 0, "rejetes": 0, "erreurs": 0, "en_ligne": False}
    res, en_ligne = interroger_asf(cfg["aoi"], "SME2", sortie / f"catalogue_asf_{nom}_SME2.json")
    bilan["SME2"]["en_ligne"] = en_ligne
    if res is None:
        info["raison"] = "catalogue SME2 inaccessible et aucun secours utilisable ; voir le journal pour la cause reseau/HTTP"
        bilan["SME2"]["erreurs"] += 1
        return info, {}
    groupes = preparer_groupes(res, cfg, a.beta)
    if a.max:
        groupes = dict(list(groupes.items())[: a.max])
    bilan["SME2"]["catalogue"] = len(groupes)
    cs = cache / "sme2"
    cs.mkdir(exist_ok=True)
    dimg = sortie / "img" / nom
    aoi, pas = cfg["aoi"], PAS_SME2
    deja = sum(1 for (d, p) in groupes if (cs / f"{d}_t{p}.npz").exists())
    dire(f"\n--- Humidite du sol (SME2) : {len(groupes)} passages au catalogue, {deja} deja en cache ---")
    rapport = {}
    masques, terre = None, None
    par_date = {(d["date"], d["orbite"]): d for d in dates}
    cube_sm, n_ok, algos_vus, erreurs = {}, 0, set(), []
    for i, ((d_iso, piste), prods) in enumerate(groupes.items(), 1):
        tag = f"{d_iso}_t{piste}"
        cpath = cs / f"{tag}.npz"
        dire(f"[{i}/{len(groupes)}] SME2 {d_iso} orbite {piste} ({prods[0]['maturite']}) ...", fin=" ")
        try:
            sig_source = signature_source(prods, cfg, pas, "sme2-v6.1")
            z = cache_source(cpath, ("sm", "fiable", "algos"), sig_source)
            if z is not None:
                sm, fiable, algos = z["sm"].astype(np.float32), z["fiable"], json.loads(str(z["algos"]))
                dire("cache", fin=" ")
                bilan["SME2"]["cache"] += 1
            else:
                lus = []
                for p in prods:
                    src = (Path(a.local) / p["fichier"]) if a.local else p["url"]
                    lus.append(lire_avec_reprises(lire_sme2, src, jeton, aoi, pas, rapport))
                sm, fiable, algos = fusionner_sme2(lus, beta=any(p["maturite"] == "BETA" for p in prods))
                sauver_npz(cpath, sm=sm, fiable=fiable, algos=json.dumps(algos), signature_source=sig_source)
                bilan["SME2"]["lus"] += 1
        except JetonManquant as e:
            dire(f"en attente : {e}")
            erreurs.append(message_sur(e)); bilan["SME2"]["erreurs"] += 1
            continue
        except Exception as e:
            dire(f"ECHEC : {str(e) or type(e).__name__}")
            erreurs.append(message_sur(e)); bilan["SME2"]["erreurs"] += 1
            continue
        valide = np.isfinite(sm)
        if masques is None:
            masques = {z["properties"]["nom"]: masque_polygone(z["geometry"], sm.shape, aoi, pas) for z in zones}
            terre, _ = charger_masque_terre(zones, sm.shape, aoi, pas)
        couv = 100 * float((valide & terre).sum()) / max(int(terre.sum()), 1)
        if couv < 1.0:
            dire(f"rejetee (aucune mesure exploitable sur la zone : {couv:.1f} %)")
            bilan["SME2"]["rejetes"] += 1
            continue
        algos_vus.update(algos["noms"])
        # image : sec / humide / sature ; couleurs pales = estimation peu fiable (vegetation dense, pluie...)
        img = np.zeros(sm.shape + (4,), np.uint8)
        img[valide & (sm < SOL_SEC_MAX)] = (214, 164, 72, 235)
        img[valide & (sm >= SOL_SEC_MAX) & (sm < SOL_SATURE_MIN)] = (79, 190, 170, 235)
        img[valide & (sm >= SOL_SATURE_MIN)] = (56, 120, 230, 235)
        img[..., 3] = np.where(valide & ~fiable, 120, img[..., 3]).astype(np.uint8)
        img[~terre] = 0
        chemin = f"img/{nom}/" + sauver(img, dimg / f"{tag}_humidite", perte=False)
        d = par_date.get((d_iso, piste))
        stats = {}
        for zn, m in masques.items():
            stats[zn] = statistiques_sme2(sm, fiable, m, terre, algos["qualite_connue"])
        if d is None:
            d = {"date": d_iso, "date_utc": prods[0]["date_utc"], "orbite": piste,
                 "sens": prods[0]["sens"], "double_pol": False, "maturite": prods[0]["maturite"],
                 "gcov_disponible": False, "couverture_pct": round(couv, 1),
                 "images": {}, "produits": [], "_tag": tag}
            dates.append(d)
            par_date[(d_iso, piste)] = d
        d["images"]["humidite"] = chemin
        d["humidite"] = {"couverture_pct": round(couv, 1), "algorithmes": algos["noms"], "maturite": prods[0]["maturite"],
                         "qualite_connue": algos["qualite_connue"],
                         "couverture_fiable_pct": round(100 * int((fiable & terre).sum()) / max(int(terre.sum()), 1), 1),
                         "produits": [p["fichier"] for p in prods]}
        for zn, st in stats.items():
            ligne = next((l for l in series.get(zn, []) if l["date"] == d_iso and l["orbite"] == piste), None)
            if ligne is None:
                ligne = {"date": d_iso, "orbite": piste, "maturite": d["maturite"], "double_pol": d["double_pol"]}
                series.setdefault(zn, []).append(ligne)
            ligne.update(st)
            ligne["maturite_sme2"] = prods[0]["maturite"]
        # cube : humidite a la resolution du cube (plus proche voisin)
        fct = cfg["pas"] * CUBE_FACTEUR / pas
        ny, nx = int(round((aoi["nord"] - aoi["sud"]) / cfg["pas"])) // CUBE_FACTEUR, int(round((aoi["est"] - aoi["ouest"]) / cfg["pas"])) // CUBE_FACTEUR
        ii = np.clip(((np.arange(ny) + 0.5) * fct).astype(int), 0, sm.shape[0] - 1)
        jj = np.clip(((np.arange(nx) + 0.5) * fct).astype(int), 0, sm.shape[1] - 1)
        s = np.where(terre, sm, np.nan)[np.ix_(ii, jj)]
        o = np.where(np.isfinite(s), np.clip(np.rint(s / CUBE_SM_MAX * 254), 0, 254), 255).astype(np.uint8)
        cube_sm[d["_tag"]] = (o, (fiable & terre)[np.ix_(ii, jj)])
        n_ok += 1
        dire(f"ok (mesure sur {couv:.0f} % de la terre, algorithmes : {', '.join(algos['noms'])})")
    if rapport.get("texte"):
        (sortie / "structure_sme2.txt").write_text(rapport["texte"], encoding="utf-8")
    info["dates"], info["algorithmes"] = n_ok, sorted(algos_vus)
    if n_ok:
        info["statut"] = "ok"
    else:
        info["raison"] = (erreurs[0] if erreurs else "aucun passage SME2 exploitable sur la zone")[:300]
    return info, cube_sm


# ================================================================ ETAPE D : fichiers pour l'application
DESCRIPTION_COUCHES = {
    "rgb": "Composition R=HH, V=HV, B=HH : vegetation en vert, urbain clair, eau sombre (dates HH+HV seulement)",
    "hh": "Retrodiffusion HH (dB, filtre de Lee) : eau libre tres sombre, vegetation inondee et ville tres claires",
    "hv": "Retrodiffusion HV (dB) : augmente avec la biomasse / la vegetation",
    "vegetation": "Indice HV - HH (dB) : brun = sol nu, vert fonce = vegetation dense -> agriculture",
    "humidite": "Humidite du sol SME2 (200 m) : sec / humide / sature ; couleurs pales = estimation peu fiable",
    "eau": "Eau libre de la date : sombre en HH (et en HV quand disponible), zones urbaines exclues",
    "inondation": "Eau presente a cette date, hors eau permanente et hors mer, pixels isoles retires",
    "changement": "Difference HH par rapport a la date seche de reference de la meme orbite (rouge = hausse, bleu = baisse)",
    "anomalie": "Ecart de HH a la normale (mediane) de l'orbite",
    "vegetation_inondee": "HH +3 dB ET HH-HV +2 dB par rapport a la date seche, sur des pixels vegetalises, hors ville",
    "frequence_eau": "Part des dates ou le pixel est en eau -> zones inondables / a risque",
    "eau_permanente": "En eau sur au moins 80 % des dates : estuaire, rivieres, lacs",
    "urbain": "Tissu urbain : pixels tres brillants, stables et peu vegetalises (exclus des couches eau et inondation)",
}


def ecrire_cube(nom, cfg, dates, cube, cube_sm, sortie):
    """cube_<niveau>.js : pour chaque date, 4 octets par cellule (HH, HV, classes, humidite), compresse (gzip + base64)."""
    if not cube and not cube_sm:
        return None
    forme = next(iter(cube.values()))["classe"].shape if cube else next(iter(cube_sm.values()))[0].shape
    vide = {"hh": np.full(forme, 255, np.uint8), "hv": np.full(forme, 255, np.uint8), "classe": np.zeros(forme, np.uint8)}
    morceaux = []
    for d in dates:
        sm, fiable = cube_sm.get(d["_tag"], (np.full(forme, 255, np.uint8), np.zeros(forme, bool)))
        zc = cube.get(d["_tag"], {**vide, "classe": np.where(sm != 255, 32, 0).astype(np.uint8)})
        classe = zc["classe"] | (fiable.astype(np.uint8) * 64)
        morceaux += [zc["hh"].tobytes(), zc["hv"].tobytes(), classe.tobytes(), sm.tobytes()]
    brut = b"".join(morceaux)
    meta = {"nx": int(forme[1]), "ny": int(forme[0]), "pas": cfg["pas"] * CUBE_FACTEUR,
            "ouest": cfg["aoi"]["ouest"], "nord": cfg["aoi"]["nord"], "dates": [d["date"] for d in dates],
            "orbites": [d["orbite"] for d in dates], "champs": ["hh", "hv", "classe", "sm"],
            "codage": {"dB": list(CUBE_DB), "sm_max": CUBE_SM_MAX, "vide": 255,
                       "classe_bits": {"eau": 1, "inondation": 2, "vegetation_inondee": 4, "urbain": 8,
                                       "eau_permanente": 16, "terre": 32, "humidite_fiable": 64}},
            "gz_b64": base64.b64encode(gzip.compress(brut, 9)).decode("ascii")}
    chemin = sortie / f"cube_{nom}.js"
    with open(chemin, "w", encoding="utf-8") as fo:
        fo.write("// Genere par preparer_donnees_prototype.py - histoire de chaque point de la carte (Radar Insight)\n")
        fo.write("window.SAJE_CUBE = window.SAJE_CUBE || {};\n")
        fo.write(f"window.SAJE_CUBE[{json.dumps(nom)}] = " + json.dumps(meta) + ";\n")
    return chemin


def verifier_sorties(meta, sortie):
    """Auto-controle final : chaque image annoncee existe et n'est pas vide."""
    manquantes = []
    chemins = list(meta["globales"].values()) + [p for d in meta["dates"] for p in d["images"].values()]
    for p in chemins:
        f = sortie / p
        if not f.exists() or f.stat().st_size == 0:
            manquantes.append(p)
    return len(chemins), manquantes


def copier_vers_application(racine, sortie, noms, chemin_app):
    """Rend les donnees directement exploitables : copie dans l'application si elle est presente."""
    app = Path(chemin_app) if chemin_app else racine / "app"
    if not (app / "index.html").exists():
        return None
    (app / "js" / "donnees").mkdir(parents=True, exist_ok=True)
    n = 0
    for nom in noms:
        for f in (sortie / f"data_{nom}.js", sortie / f"cube_{nom}.js"):
            if f.exists():
                shutil.copy2(f, app / "js" / "donnees" / f.name)
        src, dst = sortie / "img" / nom, app / "data" / "img" / nom
        dst.mkdir(parents=True, exist_ok=True)
        if src.exists():
            for f in src.glob("*.webp"):
                cible = dst / f.name
                if not cible.exists() or cible.stat().st_size != f.stat().st_size or cible.stat().st_mtime < f.stat().st_mtime:
                    shutil.copy2(f, cible)
                    n += 1
    return app, n


def traiter_niveau(nom, cfg, a, jeton, racine, zones, produits_requis):
    sortie = racine / SOUS_DOSSIER_SORTIE
    (sortie / "img" / nom).mkdir(parents=True, exist_ok=True)
    cache = Path(a.cache) / nom
    cache.mkdir(parents=True, exist_ok=True)
    bilan = {}

    g = recolter_gcov(nom, cfg, a, jeton, sortie, cache, zones, bilan)
    gcov_ok = bool(g["dates"])
    if gcov_ok:
        r = analyser_gcov(nom, cfg, a, sortie, cache, zones, g)
    else:
        r = {"series": {}, "cube": {}, "globales": {}, "calibrees": [],
             "urbain": None, "permanente": None, "etir": {}, "surfaces": {}}
    dates, series = g["dates"], r["series"]

    sme2, cube_sm = {"statut": "non demande", "raison": "", "dates": 0, "algorithmes": []}, {}
    if "SME2" in produits_requis:
        try:
            sme2, cube_sm = recolter_sme2(nom, cfg, a, jeton, sortie, cache, zones, dates, series, bilan)
        except Exception as e:                      # le SME2 ne doit jamais faire echouer le reste
            sme2 = {"statut": "indisponible", "raison": f"{type(e).__name__} : {message_sur(e)}"[:300], "dates": 0, "algorithmes": []}
            dire(f"SME2 : etape abandonnee ({sme2['raison']})")

    if not dates:
        dire("Aucune date exploitable pour ce niveau. Les sorties existantes sont conservees.")
        return None, bilan

    # ---- rapport de qualite
    qualite = g["qualite"]
    for d in dates:
        if d.get("gcov_disponible") is False:
            qualite.append({"date": d["date"], "orbite": d["orbite"], "maturite": d["maturite"],
                            "couverture_pct": d["couverture_pct"], "statut": "gardee_SME2",
                            "raison": "humidite seulement ; aucun GCOV exploitable"})
    with open(sortie / f"rapport_qualite_{nom}.csv", "w", encoding="utf-8-sig") as fo:
        fo.write("date;orbite;maturite;cadres;couverture_pct;statut;raison;seuil_eau_dB;methode_seuil;recalage_dB;humidite_SME2\n")
        for q in sorted(qualite, key=lambda q: (q["date"], q["orbite"])):
            d = next((x for x in dates if x["date"] == q["date"] and x["orbite"] == q["orbite"]), None)
            q["humidite_SME2"] = "oui" if d is not None and "humidite" in d["images"] else "non"
            fo.write(";".join(str(q.get(c, "") if q.get(c) is not None else "") for c in
                              ("date", "orbite", "maturite", "cadres", "couverture_pct", "statut", "raison",
                               "seuil_eau_dB", "methode_seuil", "recalage_dB", "humidite_SME2")) + "\n")
    n_rej = sum(1 for q in qualite if not q["statut"].startswith("gardee"))
    dire(f"\nControle qualite : {len(dates)} dates gardees, {n_rej} ecartee(s) -> rapport_qualite_{nom}.csv")

    dates.sort(key=lambda d: d["date_utc"])
    chemin_cube = ecrire_cube(nom, cfg, dates, r["cube"], cube_sm, sortie)
    for d in dates:
        d.pop("_tag", None)
    for v in series.values():
        v.sort(key=lambda p: p["date"])
    aoi = cfg["aoi"]
    modules = {}
    for cle, b in BESOINS.items():
        disponibles = {"GCOV": gcov_ok, "SME2": sme2["statut"] == "ok"}
        pret = all(disponibles[p] for p in b["produits"])
        modules[cle] = {"titre": b["titre"], "produits": b["produits"], "couches": b["couches"],
                        "complet": pret, "manque": [p for p in b["produits"] if not disponibles[p]]}
    meta = {
        "niveau": nom, "titre": cfg["titre"], "version_script": VERSION,
        "genere_le": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "source": "NASA/ISRO NISAR " + " + ".join(p for p, ok in (("L2 GCOV", gcov_ok), ("L3 SME2", sme2["statut"] == "ok")) if ok) + " via ASF DAAC",
        "frequence": cfg["freq"], "pixel_m": round(cfg["pas"] * 111000),
        "bornes_leaflet": [[aoi["sud"], aoi["ouest"]], [aoi["nord"], aoi["est"]]],
        "periode": [dates[0]["date"], dates[-1]["date"]],
        "orbites": sorted({d["orbite"] for d in dates}),
        "globales": r["globales"], "frequence_eau": r["globales"].get("frequence_eau"),
        "nb_dates_calibrees": len(r["calibrees"]), "nb_dates_beta": sum(1 for d in dates if d["maturite"] == "BETA"),
        "part_urbain_pct": round(100 * float(r["urbain"].mean()), 2) if gcov_ok else None,
        "part_eau_permanente_pct": round(100 * float(r["permanente"].mean()), 2) if gcov_ok else None,
        "masque_terre": bool(g["a_terre"]), "etirement_dB": r["etir"], "surfaces_km2": r["surfaces"],
        "temoins": g["temoins"], "qualite": sorted(qualite, key=lambda q: (q["date"], q["orbite"])),
        "modules": modules, "sme2": sme2, "cube": chemin_cube.name if chemin_cube else None,
        "dates": dates, "series": series,
    }
    return meta, bilan


# ================================================================ PROGRAMME PRINCIPAL
def main():
    from projections import calculer_projections

    global LARGEUR_WEB
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--niveau", choices=["province", "region", "libreville", "tous"], default="province")
    ap.add_argument("--modules", default=",".join(BESOINS),
                    help="modules de l'application a alimenter (defaut : tous) : " + ", ".join(BESOINS))
    ap.add_argument("--zones", default=None, help="fichier GeoJSON de zones (defaut : celui du niveau)")
    ap.add_argument("--toutes-orbites", action="store_true", help="province : utiliser toutes les orbites, pas seulement la 94")
    ap.add_argument("--cache", default=str(Path.home() / "saje_cache_nisar"))
    ap.add_argument("--max", type=int, default=0, help="ne traiter que les N premieres dates (essai)")
    ap.add_argument("--sans-beta", action="store_true",
                    help="exclure les dates BETA (nov. 2025 - janv. 2026). Par defaut elles sont prises en compte")
    ap.add_argument("--beta", action="store_true", help=argparse.SUPPRESS)   # ancienne option, gardee pour compatibilite
    ap.add_argument("--local", default=None, help="dossier de .h5 deja telecharges")
    ap.add_argument("--token-file", default=None, help="fichier du jeton (defaut : token nasa.txt a cote du script)")
    ap.add_argument("--racine", default=None, help="racine du depot saje-field (defaut : dossier parent du script)")
    ap.add_argument("--app", default=None, help="dossier de l'application (detecte automatiquement)")
    ap.add_argument("--largeur", type=int, default=1600)
    ap.add_argument("--couverture-min", type=float, default=COUVERTURE_MIN_PCT,
                    help="rejeter les dates qui couvrent moins de ce pourcentage de la zone (defaut 50)")
    a = ap.parse_args()
    a.beta = not a.sans_beta
    LARGEUR_WEB = a.largeur
    t_debut = time.time()

    modules = [m.strip() for m in a.modules.split(",") if m.strip() in BESOINS]
    if not modules:
        sys.exit("Aucun module reconnu. Choix : " + ", ".join(BESOINS))
    produits_requis = sorted({p for m in modules for p in BESOINS[m]["produits"]})
    dire(f"SAJE Field - recolte NISAR (script v{VERSION})")
    dire("Besoins de l'application :")
    for m in modules:
        dire(f"  - {BESOINS[m]['titre']:<26} -> {' + '.join(BESOINS[m]['produits'])}")
    dire(f"Produits a recolter : {', '.join(produits_requis)} ; dates BETA : {'prises en compte' if a.beta else 'exclues'}\n")

    racine = Path(a.racine) if a.racine else RACINE_DEPOT
    sortie = racine / SOUS_DOSSIER_SORTIE
    sortie.mkdir(parents=True, exist_ok=True)
    jeton = Jeton(a.token_file)

    niveaux = ["province", "region", "libreville"] if a.niveau == "tous" else [a.niveau]
    faits = []
    for nom in niveaux:
        cfg = dict(NIVEAUX[nom])
        if nom == "province" and a.toutes_orbites:
            cfg["tracks"] = None
        fz = Path(a.zones) if a.zones else ICI / cfg["zones"]
        zones = json.load(open(fz, encoding="utf-8"))["features"] if fz.exists() else []
        meta, bilan = traiter_niveau(nom, cfg, a, jeton, racine, zones, produits_requis)
        if meta is None:
            continue
        meta["couches"] = DESCRIPTION_COUCHES
        meta["seuils"] = {"echelles_dB": ECHELLES, "eau_bornes_dB": SEUIL_EAU_BORNES, "eau_HV_bornes_dB": SEUIL_EAU_HV_BORNES,
                          "vegetation_inondee_dB": SEUIL_VEG_INONDEE, "vegetation_inondee_ratio_dB": SEUIL_VEG_INONDEE_RATIO,
                          "urbain_mediane_dB": URBAIN_MEDIANE_DB, "urbain_ecart_type_dB": URBAIN_ECART_TYPE_DB,
                          "eau_permanente_frequence": EAU_PERMANENTE, "filtre": "Lee", "ENL": ENL,
                          "urbain_veg_max_dB": URBAIN_VEG_MAX_DB, "urbain_densite": URBAIN_DENSITE,
                          "vegetation_reference_min_dB": VEG_MIN_REFERENCE_DB, "couverture_min_pct": a.couverture_min,
                          "eau_plancher_dB": SEUIL_EAU_PLANCHER,
                          "pixels_min_inondation": PIXELS_MIN_INONDATION, "pixels_min_vegetation_inondee": PIXELS_MIN_VEG_INONDEE,
                          "recalage_beta_max_dB": RECALAGE_MAX_DB, "sol_sec_max_m3m3": SOL_SEC_MAX, "sol_sature_min_m3m3": SOL_SATURE_MIN}
        meta["avertissement"] = ("Donnees PROVISIONAL (avant le 21/10/2026) et VALIDATED : chaines de traitement differentes. "
                                 "Comparer les intensites seulement au sein d'une meme orbite.")
        if meta["nb_dates_beta"]:
            meta["avertissement"] += (" Dates BETA (nov. 2025 - janv. 2026) : non calibrees et en HH seul ; elles sont recalees "
                                      "sur la foret (cible stable) pour etre comparees aux autres, avec une confiance plus faible."
                                      " Aucune donnee publiee entre mi-janvier et mi-juin 2026.")
        meta["zones"] = {"type": "FeatureCollection", "features": zones}
        meta["projections"] = calculer_projections(meta["series"])
        if meta["projections"]["version"] is None:
            dire("Optuna indisponible : pip install -r requirements.txt pour regler les projections.")
        json.dump(meta, open(sortie / f"meta_{nom}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        tmp = sortie / f"data_{nom}.js.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write("// Genere par preparer_donnees_prototype.py - utilisable en file:// sans serveur\n")
            f.write("window.SAJE = window.SAJE || {};\n")
            f.write(f"window.SAJE[{json.dumps(nom)}] = " + json.dumps(meta, ensure_ascii=False) + ";\n")
        os.replace(tmp, sortie / f"data_{nom}.js")
        n_img, manquantes = verifier_sorties(meta, sortie)
        faits.append(nom)

        dire(f"\n================ BILAN {cfg['titre']} ================")
        dire(f"Periode : {meta['periode'][0]} -> {meta['periode'][1]} ; {len(meta['dates'])} dates "
             f"(dont {meta['nb_dates_beta']} BETA) ; orbites {meta['orbites']}")
        for p, b in bilan.items():
            dire(f"  {p} : {b['catalogue']} passages au catalogue {'(a jour)' if b['en_ligne'] else '(catalogue enregistre)'} ; "
                 f"{b['lus']} nouveaux lus, {b['cache']} repris du cache, {b['rejetes']} rejetes, {b['erreurs']} en erreur")
        for cle, m in meta["modules"].items():
            if cle in modules:
                dire(f"  Module {m['titre']:<26} : {'complet' if m['complet'] else 'partiel - manque ' + ', '.join(m['manque'])}")
        if meta["sme2"]["statut"] != "ok" and "SME2" in produits_requis:
            dire(f"  Humidite du sol : indisponible ({meta['sme2']['raison']})")
        dire(f"  Auto-controle : {n_img} images annoncees, " + ("toutes presentes" if not manquantes else f"{len(manquantes)} MANQUANTES : {manquantes[:3]}"))

    for f in ("apercu.html",):
        if (ICI / f).exists():
            (sortie / f).write_bytes((ICI / f).read_bytes())
    if (ICI / "lib").exists():
        shutil.copytree(ICI / "lib", sortie / "lib", dirs_exist_ok=True)
    if faits:
        copie = copier_vers_application(racine, sortie, faits, a.app)
        if copie:
            dire(f"\nApplication mise a jour : {copie[0]} ({copie[1]} image(s) copiee(s)). Ouvrir index.html.")
        else:
            dire("\nApplication non trouvee : lancer app/copier_donnees.bat pour y copier les donnees.")
    taille = sum(p.stat().st_size for p in sortie.rglob("*") if p.is_file()) / 1e6
    dire(f"Termine en {time.time() - t_debut:.0f} s -> {sortie} ({taille:.1f} Mo)")
    try:
        (sortie / "journal_recolte.txt").write_text(
            f"Recolte du {datetime.now().strftime('%Y-%m-%d %H:%M')}\n" + "".join(JOURNAL), encoding="utf-8")
    except OSError:
        pass
    return 0 if faits else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nInterrompu. Relancer le script : il reprendra la ou il s'est arrete.")
