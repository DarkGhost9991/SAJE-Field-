"""Tests hors reseau : python -m unittest -v test_preparation.py"""
import base64
import gzip
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import h5py
import numpy as np
import preparer_donnees_prototype as p


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.stdin = patch.object(p.sys, 'stdin', None)
        self.stdin.start()
        self.addCleanup(self.stdin.stop)

    def jeton(self):
        j = p.Jeton(self.root / 'token nasa.txt')
        j.fichier = self.root / 'saved.txt'
        return j

    def test_token_file_bom_bearer_and_no_log_leak(self):
        j = self.jeton()
        j.fichier_token.write_text('\ufeffBearer fake.secret.token\n', encoding='utf-8')
        with patch('sys.stdout', new_callable=io.StringIO) as out:
            self.assertEqual(j.obtenir(), 'fake.secret.token')
            p.dire('failure fake.secret.token')
        self.assertNotIn('fake.secret.token', out.getvalue())
        self.assertEqual(j.origine, 'token nasa.txt')

    def test_token_environment_priority(self):
        j = self.jeton()
        j.fichier_token.write_text('invalid multiple lines\ntext', encoding='utf-8')
        os.environ['EDL_TOKEN'] = 'env-token'
        self.assertEqual(j.obtenir(), 'env-token')

    def test_token_rejected_not_reused_or_deleted(self):
        j = self.jeton()
        j.fichier_token.write_text('expired-test-token', encoding='utf-8')
        j.obtenir()
        j.invalider()
        with self.assertRaises(p.JetonManquant):
            j.obtenir()
        self.assertTrue(j.fichier_token.exists())
        j.fichier_token.write_text('replacement-test-token', encoding='utf-8')
        self.assertEqual(j.obtenir(), 'replacement-test-token')

    def test_empty_missing_multiline_tokens(self):
        j = self.jeton()
        for value in ('', 'two tokens\n'):
            j.fichier_token.write_text(value, encoding='utf-8')
            with self.assertRaises(p.JetonManquant):
                j.obtenir()

    def test_auth_failure_is_not_proxy_failure(self):
        self.assertFalse(p.erreur_jeton(RuntimeError('Tunnel connection failed: 403 Forbidden')))
        self.assertTrue(p.erreur_jeton(RuntimeError('401 Unauthorized')))

    def test_catalogue_fallback_and_corruption(self):
        f = self.root / 'catalogue.json'
        f.write_text('[{"fileName":"saved.h5"}]', encoding='utf-8')
        with patch.object(p.urllib.request, 'urlopen', side_effect=OSError('network test')), patch.object(p.time, 'sleep'):
            self.assertEqual(p.interroger_asf(p.NIVEAUX['province']['aoi'], 'SME2', f)[0][0]['fileName'], 'saved.h5')
            f.write_text('{broken', encoding='utf-8')
            self.assertEqual(p.interroger_asf(p.NIVEAUX['province']['aoi'], 'SME2', f), (None, False))

    def test_cache_invalidated_by_source_and_aoi(self):
        cfg = p.NIVEAUX['province']
        prods = [{'fichier': 'one.h5', 'crid': 'P00001'}]
        sig = p.signature_source(prods, cfg, cfg['pas'], 'test')
        f = self.root / 'cache.npz'
        p.sauver_npz(f, sm=np.ones((2, 2)), signature_source=sig)
        self.assertIsNotNone(p.cache_source(f, ('sm',), sig))
        prods[0]['crid'] = 'P00002'
        changed = p.signature_source(prods, cfg, cfg['pas'], 'test')
        self.assertIsNone(p.cache_source(f, ('sm',), changed))
        self.assertNotEqual(sig, p.signature_source(prods, {**cfg, 'aoi': {}}, cfg['pas'], 'test'))
        p.sauver_npz(f, sm=np.ones((2, 2)))
        self.assertIsNone(p.cache_source(f, ('sm',), sig))

    def test_bad_algorithm_cannot_contaminate_good_average(self):
        sm, good, _ = p.fusionner_sme2([{'algos': {
            'a': (np.full((2, 2), .2), np.zeros((2, 2), int)),
            'b': (np.full((2, 2), .9), np.ones((2, 2), int))}}])
        np.testing.assert_allclose(sm, .2)
        self.assertTrue(good.all())

    def test_mosaic_keeps_quality_aligned_with_value(self):
        first = {'algos': {'a': (np.array([[np.nan, .8]]), np.array([[0, 1]]))}}
        second = {'algos': {'a': (np.array([[.3, .2]]), np.array([[1, 0]]))}}
        sm, good, _ = p.fusionner_sme2([first, second])
        np.testing.assert_allclose(sm, [[.3, .2]])
        np.testing.assert_array_equal(good, [[False, True]])

    def test_unknown_and_beta_are_not_reliable(self):
        for flag, beta in ((None, False), (np.zeros((2, 2), int), True)):
            _, good, algos = p.fusionner_sme2([{'algos': {'a': (np.ones((2, 2)) * .2, flag)}}], beta=beta)
            self.assertFalse(good.any())
            self.assertFalse(algos['qualite_connue'])

    def test_stats_use_only_good_pixels_and_preserve_coverage(self):
        sm = np.array([[.2] * 5 + [.9] * 5])
        good = np.array([[True] * 5 + [False] * 5])
        zone = np.ones_like(good)
        s = p.statistiques_sme2(sm, good, zone, zone, True)
        self.assertEqual(s['humidite_m3m3'], .2)
        self.assertEqual(s['sol_fiable_pct'], 50.)
        self.assertEqual(s['sol_mesure_pct'], 100.)
        self.assertIsNone(p.statistiques_sme2(sm, np.zeros_like(good), zone, zone, False)['humidite_m3m3'])

    def test_nearest_empty_and_single_coordinates(self):
        np.testing.assert_array_equal(p.plus_proche(np.array([np.nan]), np.array([1.])), [-1])
        np.testing.assert_array_equal(p.plus_proche(np.array([1.]), np.array([1., 2.])), [0, -1])

    def fixture_sme2(self):
        f = self.root / 'sme2.h5'
        with h5py.File(f, 'w') as h:
            g = h.create_group('science/LSAR/SME2/grids')
            g.create_dataset('latitude', data=[.003, .001])
            g.create_dataset('longitude', data=[.001, .003])
            sm = g.create_dataset('soilMoisture', data=np.array([[20, -9999], [0, 120]], dtype='int16'))
            sm.attrs['_FillValue'] = -9999
            sm.attrs['scale_factor'] = .01
            q = g.create_dataset('retrievalQualityFlag', data=np.array([[0, -9999], [1, 0]]))
            q.attrs['_FillValue'] = -9999
            candidate = g.create_group('algorithmCandidates/DSG')
            candidate.create_dataset('soilMoisture', data=np.ones((2, 2)) * .8)
            candidate.create_dataset('retrievalQualityFlag', data=np.zeros((2, 2), int))
        return f

    def test_real_hdf_baseline_scale_fill_and_flags(self):
        f = self.fixture_sme2()
        r = p.lire_sme2(f, self.jeton(), {'ouest': 0, 'est': .004, 'sud': 0, 'nord': .004}, .002, {})
        self.assertEqual(list(r['algos']), ['grids'])
        sm, q = r['algos']['grids']
        np.testing.assert_allclose(sm, [[.2, np.nan], [0., np.nan]], equal_nan=True)
        np.testing.assert_array_equal(q, [[0, -1], [1, 0]])

    def test_flags_never_borrowed_from_other_algorithm(self):
        st = p.reperer_sme2([('science/LSAR/SME2/grids/soilMoisture', (2, 2), 'float32'),
                            ('science/LSAR/SME2/grids/algorithmCandidates/DSG/retrievalQualityFlag', (2, 2), 'int16')])
        self.assertIsNone(st['algos']['grids']['qflag'])

    def test_sme2_only_pipeline_and_cube(self):
        cfg = {**p.NIVEAUX['province'], 'aoi': {'ouest': 0, 'est': .018, 'sud': 0, 'nord': .018}, 'pas': .0018, 'tracks': None}
        a = SimpleNamespace(cache=str(self.root/'cache'), beta=False, max=0, local=None, couverture_min=0)
        nom = 'NISAR_L3_PR_SME2_001_094_D_088_0000_DHDH_A_20261101T000000_20261101T000100_P05036_test.h5'
        catalogue = [{'fileName': nom, 'downloadUrl': 'https://example.invalid/test', 'collectionName': 'PROVISIONAL'}]
        zones = [{'type': 'Feature', 'properties': {'nom': 'Test', 'masque_terre': True}, 'geometry': {'type': 'Polygon', 'coordinates': [[[0,0],[.018,0],[.018,.018],[0,.018],[0,0]]]}}]
        def catalogue_test(aoi, produit, chemin):
            return (catalogue if produit == 'SME2' else []), True
        fake = {'algos': {'grids': (np.ones((10, 10), np.float32)*.25, np.zeros((10, 10), int))}}
        with patch.object(p, 'interroger_asf', side_effect=catalogue_test), patch.object(p, 'lire_avec_reprises', return_value=fake):
            meta, bilan = p.traiter_niveau('province', cfg, a, self.jeton(), self.root, zones, ['GCOV', 'SME2'])
        self.assertEqual(meta['sme2']['dates'], 1)
        self.assertFalse(meta['dates'][0]['gcov_disponible'])
        self.assertEqual(meta['series']['Test'][0]['humidite_m3m3'], .25)
        self.assertEqual(meta['modules']['agriculture']['manque'], ['GCOV'])
        sortie = self.root/p.SOUS_DOSSIER_SORTIE
        self.assertEqual(p.verifier_sorties(meta, sortie)[1], [])
        cube = json.loads((sortie/'cube_province.js').read_text().split('window.SAJE_CUBE["province"] = ')[1].rstrip(';\n'))
        raw = gzip.decompress(base64.b64decode(cube['gz_b64']))
        self.assertEqual(list(raw[:2]), [255, 255])
        self.assertEqual(raw[3], 100)
        # Deuxieme lancement : le cache evite toute nouvelle lecture du produit.
        with patch.object(p, 'interroger_asf', side_effect=catalogue_test), patch.object(p, 'lire_avec_reprises', side_effect=AssertionError('cache non utilise')):
            meta, bilan = p.traiter_niveau('province', cfg, a, self.jeton(), self.root, zones, ['GCOV', 'SME2'])
        self.assertEqual(bilan['SME2']['cache'], 1)


if __name__ == '__main__':
    unittest.main()
