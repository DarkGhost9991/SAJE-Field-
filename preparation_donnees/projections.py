"""Projections NISAR par zone, calculees hors ligne pendant la preparation."""
import argparse
import json
import math
import re
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from statistics import mean
from tempfile import NamedTemporaryFile

try:
    import optuna
except ModuleNotFoundError as exc:
    if exc.name != "optuna":
        raise
    optuna = None

HORIZON = timedelta(days=12)
MIN_REGLAGE = 3
MIN_TEST = 3
PENTES = [0.25, 0.5, 0.75, 1.0]
INDICATEURS = {
    "eau": ("part_eau_pct", 0, 100),
    "vegetation": ("HVmoinsHH_dB", None, None),
    "humidite": ("humidite_m3m3", 0, 1),
}


def observation(ligne, indicateur):
    champ, bas, haut = INDICATEURS[indicateur]
    valeur = ligne.get(champ)
    if valeur is None or not math.isfinite(valeur):
        return None
    if bas is not None and not bas <= valeur <= haut:
        return None
    if indicateur == "humidite":
        if (ligne.get("sol_pixels_retenus") or 0) <= 0:
            return None
        maturite = ligne.get("maturite_sme2")
        mode = "SME2"
    else:
        double = ligne.get("double_pol")
        if (ligne.get("couverture_pct") or 0) < 80 or double is None:
            return None
        if indicateur == "vegetation" and not double:
            return None
        maturite = ligne.get("maturite")
        mode = "HH+HV" if double else "HH"
    if maturite not in {"PROVISIONAL", "VALIDATED"}:
        return None
    return (maturite, mode), valeur


def estimer(precedent, dernier, pente, bornes):
    jour_precedent, valeur_precedente = precedent
    jour, valeur = dernier
    estimation = valeur + pente * (valeur - valeur_precedente) * (HORIZON / (jour - jour_precedent))
    bas, haut = bornes
    return estimation if bas is None else min(haut, max(bas, estimation))


def ajuster(par_date, bornes):
    points = sorted(par_date.items())
    dernier = points[-1]
    bilan = {"observe_le": dernier[0].isoformat(), "observations": len(points)}
    essais = [
        (precedent, courant, par_date[courant[0] + HORIZON])
        for precedent, courant in zip(points, points[1:])
        if courant[0] - precedent[0] <= 2 * HORIZON and courant[0] + HORIZON in par_date
    ]
    bilan["paires"] = len(essais)
    if len(essais) < MIN_REGLAGE + MIN_TEST or dernier[0] - points[-2][0] > 2 * HORIZON:
        return {**bilan, "statut": "historique_insuffisant"}
    if optuna is None:
        return {**bilan, "statut": "optuna_indisponible"}

    reglage, test = essais[:-MIN_TEST], essais[-MIN_TEST:]

    def erreur(serie, pente):
        return mean(abs(estimer(precedent, courant, pente, bornes) - mesure)
                    for precedent, courant, mesure in serie)

    study = optuna.create_study(
        sampler=optuna.samplers.GridSampler({"pente": PENTES}, seed=241),
        direction="minimize",
    )
    study.optimize(lambda trial: erreur(reglage, trial.suggest_categorical("pente", PENTES)),
                   n_trials=len(PENTES))
    pente = study.best_params["pente"]
    mae = erreur(test, pente)
    reference = erreur(test, 0)
    bilan.update(tests=len(test), mae=round(mae, 5), mae_reference=round(reference, 5))
    if mae >= reference - 1e-9:
        return {**bilan, "statut": "reference_meilleure"}

    return {
        **bilan, "statut": "ok", "pente": pente,
        "date_projection": (dernier[0] + HORIZON).isoformat(),
        "valeur": round(estimer(points[-2], dernier, pente, bornes), 5),
    }


def calculer_projections(series):
    """Garde l'orbite, la maturite et le mode du dernier passage exploitable."""
    if optuna is not None:
        optuna.logging.set_verbosity(optuna.logging.WARNING)
    projections = {}
    for zone, lignes in series.items():
        projections[zone] = {}
        for indicateur, (_, bas, haut) in INDICATEURS.items():
            groupes = defaultdict(dict)
            for ligne in lignes:
                mesure = observation(ligne, indicateur)
                if mesure:
                    (maturite, mode), valeur = mesure
                    groupe = groupes[ligne["orbite"]].setdefault((maturite, mode), {})
                    groupe[date.fromisoformat(ligne["date"])] = valeur
            resultats = {}
            for orbite, cohortes in groupes.items():
                (maturite, mode), points = max(cohortes.items(), key=lambda groupe: max(groupe[1]))
                resultats[str(orbite)] = {**ajuster(points, (bas, haut)), "maturite": maturite, "mode": mode}
            projections[zone][indicateur] = resultats
    return {"moteur": "Optuna", "version": optuna.__version__ if optuna is not None else None,
            "horizon_jours": HORIZON.days,
            "zones": projections}


def actualiser_export(chemin):
    """Recalcule a partir d'un data_*.js existant, sans relancer la collecte NASA."""
    contenu = chemin.read_text(encoding="utf-8")
    export = re.fullmatch(r'(.*?^window\.SAJE\["[^"]+"\] = )(\{[^\n]*\})(;\s*)',
                          contenu, flags=re.MULTILINE | re.DOTALL)
    if not export:
        raise ValueError(f"Export SAJE Field non reconnu : {chemin}")
    meta = json.loads(export[2])
    meta["projections"] = calculer_projections(meta["series"])
    nouveau = export[1] + json.dumps(meta, ensure_ascii=False) + export[3]
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=chemin.parent, delete=False) as fichier:
        temporaire = Path(fichier.name)
        try:
            fichier.write(nouveau)
        except OSError:
            fichier.close()
            temporaire.unlink(missing_ok=True)
            raise
    try:
        temporaire.replace(chemin)
    finally:
        temporaire.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=actualiser_export.__doc__)
    parser.add_argument("export", type=Path, help="chemin du fichier data_*.js")
    args = parser.parse_args()
    actualiser_export(args.export)
    print(f"Projections Optuna actualisees : {args.export}")
