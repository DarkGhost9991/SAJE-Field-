#!/usr/bin/env python3
"""SAJE Field : calcul des prévisions pour l'application.

Lit les données de l'application (app/js/donnees/data_province.js et
cube_province.js), reconstitue la série de chaque zone suivie exactement
comme le navigateur, puis, pour chaque passage NISAR et chaque indicateur,
prévoit le passage suivant avec les algorithmes de algorithmes/.

Sorties :
  app/js/donnees/previsions_province.js   lu par l'application (hors ligne, file://)
  prevision/sorties/previsions_province.csv  une ligne par zone × passage × indicateur
  prevision/sorties/journal_prevision.txt    ce qui a été fait, et les choix de modèles

Usage :
  python prevoir.py                 (chemins par défaut : ../app)
  python prevoir.py --app CHEMIN    (autre dossier d'application)
  python prevoir.py --sans-cube     (séries précalculées seulement, plus rapide mais
                                     différentes de celles de l'application hors province)
Aucune dépendance : Python 3.9 ou plus récent suffit.
"""
import argparse
import csv
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)

from algorithmes import prediction as P  # noqa: E402
from algorithmes.compression import quantifier, json_compact, bilan  # noqa: E402
from algorithmes.donnees import lire_js, Cube, series_application  # noqa: E402

VERSION = '1.0'


def calculer(M, cube, journal):
    zones = series_application(M, cube)
    resultat, lignes, choix = {}, [], Counter()
    for nom, z in zones.items():
        journal(f'  {nom} : {len(z["serie"])} passages ({z["source"]})')
        par_date = {}
        for d in M['dates']:
            prev = P.toutes(z['serie'], d)
            par_date[f"{d['date']}|{d['orbite']}"] = prev
            for p in prev:
                if p['ok']:
                    choix[p['modele']['id']] += 1
                lignes.append(ligne_csv(nom, d, p, z['surface']))
        resultat[nom] = par_date
    return resultat, lignes, choix


def ligne_csv(nom, d, p, surface):
    ind = P.IND[p['id']]
    base = [nom, d['date'], d['orbite'], p['id'], 'oui' if p['ok'] else 'non']
    if not p['ok']:
        return base + [''] * 13 + [p.get('raison', '')]
    km = (lambda v: surface * v / 100) if ind['unite'] == 'pct' and surface else (lambda v: None)
    r = p['risque'] or {}
    retro = p['retro'] or {}
    return base + [p['cible']['date'], p['valeur'], p['bas'], p['haut'], km(p['valeur']), r.get('p'), r.get('sens'),
                   p['modele']['id'], p['mae'], p['m'], p['competence'], p['conf']['niveau'],
                   '' if not retro else ('oui' if retro['conforme'] else 'non'), '']


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--app', default=os.path.join(ICI, '..', 'app'), help='dossier de l’application (défaut : ../app)')
    ap.add_argument('--niveau', default='province')
    ap.add_argument('--sortie', default=os.path.join(ICI, 'sorties'))
    ap.add_argument('--sans-cube', action='store_true', help='ne pas recalculer les séries sur le cube')
    a = ap.parse_args()

    t0 = time.time()
    os.makedirs(a.sortie, exist_ok=True)
    notes = []

    def journal(t):
        print(t)
        notes.append(t)

    dossier = os.path.join(a.app, 'js', 'donnees')
    journal(f'SAJE Field - prévisions (prevoir.py v{VERSION}) - {datetime.now():%Y-%m-%d %H:%M}')
    M = lire_js(os.path.join(dossier, f'data_{a.niveau}.js'))
    journal(f"Données : {M.get('titre')} · {len(M['dates'])} passages · préparées le {M.get('genere_le')}")
    cube = None
    if not a.sans_cube:
        try:
            cube = Cube(lire_js(os.path.join(dossier, f'cube_{a.niveau}.js')))
            journal(f'Cube radar décompressé : {len(cube.raw) / 1e6:.1f} Mo ({cube.nx} × {cube.ny} pixels × {len(cube.c["dates"])} passages)')
        except (OSError, ValueError) as e:
            journal(f'Cube indisponible ({e}) : séries précalculées utilisées.')

    journal('Calcul des prévisions (évaluation glissante de 6 modèles par zone, passage et indicateur) :')
    res, lignes, choix = calculer(M, cube, journal)

    sortie = {'version': VERSION, 'genere_le': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
              'donnees_du': M.get('genere_le'), 'source': 'prevision/prevoir.py', 'zones': res}
    texte = json_compact(quantifier(sortie))
    js = ('// Généré par prevision/prevoir.py - prévisions du prochain passage NISAR (ne pas modifier à la main)\n'
          'window.SAJE_PREVISIONS = window.SAJE_PREVISIONS || {};\n'
          f'window.SAJE_PREVISIONS["{a.niveau}"] = {texte};\n')
    chemin_js = os.path.join(dossier, f'previsions_{a.niveau}.js')
    with open(chemin_js, 'w', encoding='utf-8', newline='\n') as f:
        f.write(js)
    brut_avant, _ = bilan(json_compact(sortie))
    brut, gz = bilan(js)

    entetes = ['zone', 'passage', 'orbite', 'indicateur', 'prevision_possible', 'passage_prevu', 'prevision', 'bas_95', 'haut_95',
               'prevision_km2', 'proba_hors_normale', 'sens', 'modele', 'erreur_moyenne_passee', 'passages_testes', 'gain_vs_persistance',
               'confiance', 'date_choisie_dans_intervalle', 'raison']
    with open(os.path.join(a.sortie, f'previsions_{a.niveau}.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(entetes)
        for l in lignes:
            w.writerow(['' if v is None else str(round(v, 4)).replace('.', ',') if isinstance(v, float) else v for v in l])

    ok = sum(1 for l in lignes if l[4] == 'oui')
    journal(f'Prévisions possibles : {ok} sur {len(lignes)} (les autres manquent de passages comparables)')
    journal('Modèles retenus : ' + ', '.join(f'{P.MODELES[k]["savant"]} {v}' for k, v in choix.most_common()))
    journal(f'Compression : {brut_avant / 1e3:.0f} ko -> {brut / 1e3:.0f} ko après quantification ({gz / 1e3:.0f} ko en gzip)')
    journal(f'Écrit : {chemin_js}')
    journal(f'Terminé en {time.time() - t0:.1f} s')
    with open(os.path.join(a.sortie, 'journal_prevision.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(notes) + '\n')


if __name__ == '__main__':
    main()
