"""Tests hors réseau du programme de prévision : python -m unittest -v test_prevision.py"""
import math
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from algorithmes import prediction as P  # noqa: E402
from algorithmes.optimisation import section_doree, grille  # noqa: E402
from algorithmes.compression import arrondir, quantifier, decoder_cube  # noqa: E402

D0 = '2026-06-20'


def serie(valeurs, cle='part_eau_pct', pas=12, double=True, maturite='PROVISIONAL'):
    return [{'date': P.iso_de(P.jours(D0) + i * pas), 'orbite': 94, 'maturite': maturite, 'double_pol': double,
             'couverture_pct': 100, cle: v} for i, v in enumerate(valeurs)]


class Optimisation(unittest.TestCase):
    def test_section_doree_trouve_le_minimum(self):
        self.assertAlmostEqual(section_doree(lambda x: (x - 0.37) ** 2, 0, 1), 0.37, places=4)

    def test_grille_premier_en_cas_egalite(self):
        self.assertEqual(grille(lambda p: 0, [{'a': 1}, {'a': 2}]), {'a': 1})


class Compression(unittest.TestCase):
    def test_quantification(self):
        self.assertEqual(arrondir(123.456789, 5), 123.46)
        self.assertEqual(quantifier({'a': [0.000123456789]}), {'a': [0.00012346]})

    def test_cube_aller_retour(self):
        import base64, gzip
        self.assertEqual(decoder_cube(base64.b64encode(gzip.compress(b'\x01\x02\xff')).decode()), b'\x01\x02\xff')


class Modeles(unittest.TestCase):
    def test_droite_parfaite(self):
        """Une tendance parfaitement linéaire doit être prolongée exactement par Theil–Sen."""
        s = serie([1 + 0.5 * i for i in range(10)])
        p = P.prevoir('eau', s, s[-1])
        self.assertTrue(p['ok'])
        self.assertAlmostEqual(p['valeur'], 6.0, places=6)
        self.assertIn(p['modele']['id'], ('theilsen', 'holt', 'kalman'))

    def test_serie_constante_persistance(self):
        s = serie([3.0] * 8)
        p = P.prevoir('eau', s, s[-1])
        self.assertEqual(p['modele']['id'], 'persistance')     # parcimonie : le plus simple gagne
        self.assertAlmostEqual(p['valeur'], 3.0)
        self.assertGreater(p['haut'] - p['bas'], 0)              # plancher de bruit : jamais d'intervalle nul

    def test_pas_assez_de_passages(self):
        s = serie([1, 2, 3, 4])
        p = P.prevoir('eau', s, s[-1])
        self.assertFalse(p['ok'])
        self.assertIn('il en faut 5', p['raison'])

    def test_pas_de_regard_vers_avenir(self):
        """Ajouter des passages après la date choisie ne change pas la prévision."""
        s = serie([1, 3, 2, 4, 3, 5, 4])
        a = P.prevoir('eau', s, s[5])
        b = P.prevoir('eau', s + serie([90, 95], pas=12)[0:0] + [dict(s[-1], date='2026-12-01', part_eau_pct=99)], s[5])
        self.assertEqual(a['valeur'], b['valeur'])

    def test_exclusions(self):
        s = serie([1, 2, 3, 4, 5, 6], cle='HVmoinsHH_dB', double=False)
        p = P.prevoir('vegetation', s, s[-1])
        self.assertFalse(p['ok'])
        self.assertEqual(p['exclus']['polarisation'], 6)

    def test_bornes_pourcentage(self):
        s = serie([5, 3, 1, 0.5, 0.2, 0.1, 0.0])
        p = P.prevoir('eau', s, s[-1])
        self.assertGreaterEqual(p['bas'], 0)

    def test_couverture_intervalle(self):
        """Sur du bruit blanc, l'intervalle à 95 % doit contenir la vraie valeur la plupart du temps."""
        rnd = random.Random(1)
        dedans = total = 0
        for _ in range(200):
            v = [10 + rnd.gauss(0, 1) for _ in range(11)]
            s = serie(v)
            p = P.prevoir('eau', s[:10], s[9])
            total += 1
            dedans += p['bas'] <= v[10] <= p['haut']
        self.assertGreater(dedans / total, 0.85)

    def test_risque_et_confiance(self):
        s = serie([1, 1.1, 0.9, 1, 1.05, 0.95, 1, 4, 6])
        p = P.prevoir('eau', s, s[-1])
        self.assertGreater(p['risque']['p'], 0.5)
        self.assertIn(p['conf']['niveau'], ('bonne', 'moyenne', 'faible'))

    def test_pas_irregulier(self):
        s = serie([2, 4, 6, 8, 10, 12, 14], pas=24)
        p = P.prevoir('eau', s, s[-1])
        self.assertAlmostEqual(p['valeur'], 15.0, places=4)    # +2 tous les 24 j -> +1 en 12 j


class Application(unittest.TestCase):
    """Bout en bout sur les vraies données de l'application (si présentes)."""
    APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'js', 'donnees')

    @unittest.skipUnless(os.path.exists(os.path.join(APP, 'data_province.js')), 'données de l’application absentes')
    def test_toutes_les_zones(self):
        from algorithmes.donnees import lire_js, Cube, series_application
        M = lire_js(os.path.join(self.APP, 'data_province.js'))
        zones = series_application(M, Cube(lire_js(os.path.join(self.APP, 'cube_province.js'))))
        self.assertGreaterEqual(len(zones), 2)
        d = M['dates'][-1]
        for nom, z in zones.items():
            for p in P.toutes(z['serie'], d):
                if p['ok']:
                    self.assertTrue(math.isfinite(p['valeur']))
                    self.assertLessEqual(p['bas'], p['valeur'])
                    self.assertLessEqual(p['valeur'], p['haut'])


if __name__ == '__main__':
    unittest.main()
