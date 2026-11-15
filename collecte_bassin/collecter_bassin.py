#!/usr/bin/env python3
"""SAJE Field - collecte en flux des données NISAR du bassin du Congo (version 7).

Chaîne complète, en une commande :
  1. CATALOGUE   : liste à jour des produits GCOV et SME2 sur l'emprise (API ASF) ;
  2. SÉLECTION   : seulement les produits pas encore traités (reprise automatique) ;
  3. COLLECTE    : lecture EN FLUX des seuls morceaux utiles, plusieurs cadres
                   et plusieurs connexions en parallèle (bande B du GCOV : 28-44 Mo
                   par cadre au lieu de 2 Go ; SME2 : 5 Mo au lieu de 100 Mo) ;
  4. TRAITEMENT  : filtre anti-chatoiement, décibels, eau (seuil d'Otsu par cadre),
                   humidité fiable seulement, agrégation 1 km (et 80 m sur les zones) ;
  5. STOCKAGE    : couches de 1 octet, rognées, compressées, par tuile ;
  6. COMBLEMENT  : périodes de 12 jours, recalage des orbites, filtre de Kalman
                   + lissage : trous comblés avec leur incertitude, prévision ;
  7. EXPORT      : tuiles .js compressées pour l'application (double-clic).
Aucune donnée brute n'est écrite sur le disque (budget mémoire brute réglable).

Exemples :
  python collecter_bassin.py                                  tout le bassin, reprise là où on s'était arrêté
  python collecter_bassin.py --test-emprise 9.25,-0.65,11,1.08 --max-cadres 6   essai rapide (Estuaire)
  python collecter_bassin.py --depuis 2026-10-01              seulement les produits récents
  python collecter_bassin.py --sans-collecte                  recalculer comblement + export seulement
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)

from collecte import catalogue as CAT  # noqa: E402
from collecte import stockage as ST  # noqa: E402
from collecte import travail as TR  # noqa: E402
from collecte.comblement import traiter_tuile, debut_periode, periode, CHAMPS  # noqa: E402
from collecte.export import ecrire_tuile, Apercu, ecrire_index, CODAGE  # noqa: E402
from collecte.grille import Niveau, intersection  # noqa: E402

VERSION = '7.0'
JOURNAL = []


def dire(*a):
    t = ' '.join(str(x) for x in a)
    print(t, flush=True)
    JOURNAL.append(t)


def fenetres(p, niveaux, emprise, zones, produit):
    """Fenêtres de cellules touchées par le cadre, pour chaque niveau (80 m : zones d'intérêt seulement)."""
    out = []
    b = intersection(p['boite'], emprise)
    if not b:
        return out
    for nv in niveaux.values():
        if nv.nom == '80m':
            if produit != 'GCOV':
                continue                                  # SME2 (200 m) : pas de sens à 80 m
            for z in zones:
                bz = intersection(b, z)
                f = bz and nv.fenetre(bz['ouest'], bz['sud'], bz['est'], bz['nord'])
                if f:
                    out.append((nv, f))
        else:
            f = nv.fenetre(b['ouest'], b['sud'], b['est'], b['nord'])
            if f:
                out.append((nv, f))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--config', default=os.path.join(ICI, 'config_bassin.json'))
    ap.add_argument('--app', default=os.path.join(ICI, '..', 'app'))
    ap.add_argument('--test-emprise', help='ouest,sud,est,nord : limiter à un rectangle (essai)')
    ap.add_argument('--max-cadres', type=int, help='nombre maximal de produits à collecter (essai)')
    ap.add_argument('--produits', default='GCOV,SME2')
    ap.add_argument('--depuis'); ap.add_argument('--jusqua')
    ap.add_argument('--cadres', type=int, help='cadres traités en parallèle')
    ap.add_argument('--sans-collecte', action='store_true', help='ne rien télécharger : comblement + export')
    ap.add_argument('--sans-export', action='store_true')
    a = ap.parse_args()

    with open(a.config, encoding='utf-8') as f:
        cfg = json.load(f)
    cache = os.path.expanduser(cfg['cache'])
    os.makedirs(cache, exist_ok=True)
    cfg['emprise'] = {k: v for k, v in cfg['emprise'].items() if not k.startswith('_')}
    emprise = cfg['emprise']
    if a.test_emprise:
        o, s, e, n = (float(v) for v in a.test_emprise.split(','))
        emprise = intersection(emprise, {'ouest': o, 'sud': s, 'est': e, 'nord': n})
    niveaux = {k: Niveau.depuis(k, cfg['emprise'], v) for k, v in cfg['niveaux'].items()}
    zones = cfg.get('zones_interet', [])
    par = cfg['parallele']
    n_cadres = a.cadres or par['cadres']
    t0 = time.time()
    dire(f"SAJE Field - collecte en flux du bassin du Congo (v{VERSION}) - {datetime.now():%Y-%m-%d %H:%M}")
    dire(f"Emprise : {emprise} · cache réduit : {cache}")

    etat = ST.Etat(cache)
    touchees = set()
    if not a.sans_collecte:
        a_faire = []
        for produit in a.produits.split(','):
            res = CAT.interroger(produit, emprise, cache, dire)
            sel = CAT.selectionner(res, produit, cfg.get('avec_beta', False), emprise)
            sel = [p for p in sel if (not a.depuis or p['date'] >= a.depuis) and (not a.jusqua or p['date'] <= a.jusqua)]
            nouveaux = [p for p in sel if not etat.fait(p)]
            dire(f'  {produit} : {len(sel)} produits retenus, {len(sel) - len(nouveaux)} déjà traités, {len(nouveaux)} à collecter')
            a_faire += [(p, produit) for p in nouveaux]
        a_faire.sort(key=lambda x: x[0]['date'], reverse=True)       # le plus récent d'abord : l'app est vite utile
        if a.max_cadres:
            a_faire = a_faire[:a.max_cadres]
        budget = par['budget_brut_Mo'] * 1e6 / n_cadres
        dire(f'Collecte de {len(a_faire)} produits · {n_cadres} cadres en parallèle × {par["connexions_par_cadre"]} connexions · '
             f'budget brut {par["budget_brut_Mo"]} Mo en mémoire, 0 sur le disque')
        octets_total, faits, t_c = 0, 0, time.time()
        with ProcessPoolExecutor(n_cadres, initializer=TR.initialiser, initargs=(budget,)) as ex:
            futs = {}
            for p, produit in a_faire:
                nvx = fenetres(p, niveaux, emprise, zones, produit)
                if not nvx:
                    etat.noter(p, 'rejete', raison='hors emprise')
                    continue
                futs[ex.submit(TR.traiter, p, produit, nvx, cfg, par['connexions_par_cadre'])] = p
            for fut in as_completed(futs):
                r = fut.result(); p = r['p']; faits += 1
                if r['ok']:
                    for o in r['obs']:
                        touchees.update(ST.enregistrer(cache, niveaux[o['niveau']], o, p, r['produit'], {k: v for k, v in r['info'].items() if k in ('seuil_eau_dB', 'otsu', 'double')}))
                    etat.noter(p, 'ok', produit=r['produit'], **r['info'])
                    octets_total += r['info']['octets']
                    debit = octets_total / max(time.time() - t_c, 1e-6) / 1e6
                    reste = (len(futs) - faits) * (time.time() - t_c) / faits
                    dire(f"  [{faits}/{len(futs)}] {r['produit']} {p['date']} piste {p['piste']} cadre {p['cadre']} : "
                         f"{r['info']['octets'] / 1e6:.1f} Mo lus en {r['info']['duree_s']} s"
                         + (f", eau < {r['info']['seuil_eau_dB']} dB" if r['produit'] == 'GCOV' else '')
                         + f" · débit {debit:.1f} Mo/s · reste ≈ {reste / 60:.0f} min")
                else:
                    etat.noter(p, 'rejete' if r.get('rejete') else 'erreur', raison=r['raison'])
                    dire(f"  [{faits}/{len(futs)}] {r['produit']} {p['date']} cadre {p['cadre']} : {'écarté' if r.get('rejete') else 'ERREUR'} ({r['raison']})")
                if faits % 10 == 0:
                    etat.sauver()
        etat.sauver()
        dire(f'Collecte : {octets_total / 1e9:.2f} Go lus en flux en {(time.time() - t_c) / 60:.1f} min, aucun octet brut écrit sur le disque')

    if a.sans_export:
        return
    # ---------------------------------------------------------------- comblement + prévision + export
    dates = ST.dates_observees(cache)
    if not dates:
        dire('Aucune donnée collectée : rien à exporter.')
        return
    jours, epoque = cfg['periode_jours'], cfg['epoque']
    n_obs_p = max(periode(d, epoque, jours) for d in dates) + 1
    n_p = n_obs_p + 1                                     # + 1 période prévue
    dossier = os.path.join(a.app, 'js', 'donnees', 'bassin')
    dire(f'Comblement et prévision : {n_obs_p} périodes de {jours} jours (+1 prévue), de {debut_periode(0, epoque, jours)} à {debut_periode(n_p - 1, epoque, jours)}')
    index = {'version': VERSION, 'genere_le': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'), 'emprise': cfg['emprise'],
             'periodes': [debut_periode(k, epoque, jours) for k in range(n_p)], 'periode_jours': jours, 'prevue': n_p - 1,
             'champs': {c: {**d, 'codage': CODAGE[c]} for c, d in CHAMPS.items()}, 'drapeaux': {'0': 'mesurée', '1': 'comblée', '2': 'prévue', '255': 'vide'},
             'zones_interet': zones, 'niveaux': {}, 'source': 'NASA-ISRO NISAR (GCOV bande B, SME2) via ASF DAAC'}
    apercu = Apercu(niveaux['1km'], cfg['apercu']['facteur'], n_p)
    stats = {'brut': 0, 'gzip': 0, 'js': 0}
    for nom, nv in niveaux.items():
        tuiles = ST.tuiles_presentes(cache, nom)
        index['niveaux'][nom] = {'pas': nv.pas, 'tuile': nv.tuile, 'ouest': nv.ouest, 'nord': nv.nord, 'nx': nv.nx, 'ny': nv.ny, 'tuiles': []}
        for ty, tx in tuiles:
            t_t = time.time()
            i0, i1, j0, j1 = nv.bornes_tuile(ty, tx)
            res, reglages = traiter_tuile(ST.lire_tuile(cache, nom, ty, tx), (i1 - i0, j1 - j0), epoque, jours, n_obs_p)
            if not res:
                continue
            info = ecrire_tuile(dossier, nv, ty, tx, res, n_p)
            info['reglages'] = reglages
            index['niveaux'][nom]['tuiles'].append(info)
            for k in stats:
                stats[k] += info['octets' if k == 'js' else k]
            if nom == '1km':
                apercu.ajouter(ty, tx, res)
            dire(f"    tuile {info['cle']} : {', '.join(f'{c} {r['mesurees']} mesurées / {r['comblees']} comblées / {r['prevues']} prévues' for c, r in reglages.items())} "
                 f"· {info['octets'] / 1e3:.0f} ko · {time.time() - t_t:.1f} s")
        dire(f'  niveau {nom} : {len(index["niveaux"][nom]["tuiles"])} tuiles')
    ap_info = apercu.ecrire(dossier)
    index['apercu'] = {'facteur': cfg['apercu']['facteur'], **ap_info}
    ecrire_index(dossier, index)
    dire(f"Compression : {stats['brut'] / 1e6:.1f} Mo de couches -> {stats['gzip'] / 1e6:.1f} Mo (delta + gzip) "
         f"-> {stats['js'] / 1e6:.1f} Mo de fichiers .js ; aperçu {ap_info['octets'] / 1e6:.1f} Mo")
    dire(f'Écrit : {dossier}')
    dire(f'Terminé en {(time.time() - t0) / 60:.1f} min')
    with open(os.path.join(cache, 'journal_collecte.txt'), 'a', encoding='utf-8') as f:
        f.write('\n'.join(JOURNAL) + '\n\n')


if __name__ == '__main__':
    main()
