"""Tests hors réseau de la collecte du bassin : py -3.13 test_collecte.py -v"""
import base64
import gzip
import os
import sys
import tempfile
import unittest
import zlib

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from collecte import comblement as CB  # noqa: E402
from collecte import export as EX  # noqa: E402
from collecte import reduction as R  # noqa: E402
from collecte import flux_hdf5 as FH  # noqa: E402
from collecte.grille import Niveau  # noqa: E402


class Decodage(unittest.TestCase):
    def test_morceaux_identiques_a_h5py(self):
        """Le décodeur maison (zlib + shuffle) redonne exactement les valeurs de h5py."""
        import h5py
        a = np.random.default_rng(0).random((700, 600)).astype(np.float32)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 't.h5')
            with h5py.File(p, 'w') as f:
                f.create_dataset('x', data=a, chunks=(512, 512), compression='gzip', compression_opts=1, shuffle=True)
            with h5py.File(p, 'r') as f:
                m = FH.Morceaux(f['x'])
            with open(p, 'rb') as fh:
                brut = fh.read()
        for (r, c), (off, taille, masque) in m.index.items():
            bloc = m.decoder(brut[off:off + taille], masque)
            h, w = min(512, 700 - r), min(512, 600 - c)
            np.testing.assert_array_equal(bloc[:h, :w], a[r:r + h, c:c + w])


class Traitement(unittest.TestCase):
    def test_moyenne_3x3_ignore_les_vides(self):
        a = np.ones((5, 5)); a[2, 2] = np.nan
        m = R.moyenne_3x3(a)
        self.assertTrue(np.isnan(m[2, 2]))
        self.assertAlmostEqual(m[1, 1], 1.0)

    def test_otsu_bimodal(self):
        c = np.arange(-35, 5, 0.25) + 0.125
        h = np.exp(-((c + 22) / 1.5) ** 2) * 1000 + np.exp(-((c + 8) / 1.5) ** 2) * 3000
        s = R.otsu(h, c, (-22, -11))
        self.assertTrue(-18 < s < -11)

    def test_accumulateur_cellules(self):
        nv = Niveau('1km', 10.0, 1.0, 0.01, 100, 100, 50)
        acc = R.Accumulateur(nv, (0, 10, 0, 10), 2)
        lon = np.array([10.005, 10.006, 10.015]); lat = np.array([0.995, 0.994, 0.995])
        acc.ajouter(lon, lat, {'s_hh': np.array([1., 3., 5.]), 'n_hh': np.ones(3), 'eau': np.array([[1, 0, 1], [1, 1, 1]], np.float32)})
        self.assertEqual(acc.t['n_hh'][0, 0], 2)
        self.assertEqual(acc.t['s_hh'][0, 1], 5)
        self.assertEqual(acc.t['eau'][1, 0, 0], 2)

    def test_codage_aller_retour(self):
        v = np.array([-20.0, np.nan, 3.0])
        d = CB.decoder('hh', R.coder_db(v))
        self.assertAlmostEqual(d[0], -20, delta=0.1)
        self.assertTrue(np.isnan(d[1]))


class Comblement(unittest.TestCase):
    def test_trou_comble_entre_deux_mesures(self):
        rng = np.random.default_rng(1)
        T, C = 20, 300
        vrai = np.cumsum(rng.normal(0, 0.3, (T, C)), 0) + 10
        Y = vrai + rng.normal(0, 0.5, (T, C))
        Y[8:12] = np.nan                                      # trou de 4 périodes
        val, drap, sd, lam, r = CB.combler(Y, (-100, 100))
        self.assertTrue((drap[8:12] == CB.COMBLE).all())
        self.assertTrue((drap[T] == CB.PREVU).all())
        err = np.abs(val[8:12] - vrai[8:12])
        self.assertLess(np.median(err / sd[8:12]), 1.5)        # incertitude réaliste
        self.assertTrue((sd[9] > sd[3]).all())                  # plus incertain au milieu du trou

    def test_regles_honnetete(self):
        Y = np.full((10, 3), np.nan)
        Y[[1, 5], 0] = 1.0                                     # 2 mesures : ni comblement ni prévision
        Y[[0, 2, 4, 6, 8], 1] = 2.0                            # 5 mesures : comblement + prévision
        val, drap, sd, *_ = CB.combler(Y, (-10, 10))
        self.assertFalse((drap[:, 0] == CB.COMBLE).any())
        self.assertEqual(drap[10, 0], 255)
        self.assertEqual(drap[3, 1], CB.COMBLE)
        self.assertEqual(drap[10, 1], CB.PREVU)
        self.assertEqual(drap[0, 2], 255)                      # jamais mesurée : vide

    def test_recalage_orbites(self):
        base = np.array([-10.0, -12.0])
        obs = [(k, 94, base + 0.0) for k in range(4)] + [(k, 159, base + 2.0) for k in range(4)]
        res = CB.recaler(obs)
        np.testing.assert_allclose(np.stack([v for *_, v in res]).std(0), 0, atol=1e-6)


class Compression(unittest.TestCase):
    def test_delta_sans_perte(self):
        a = np.random.default_rng(2).integers(0, 256, (6, 10, 10)).astype(np.uint8)
        d = EX.delta(a)
        r = np.cumsum(d.astype(np.int64), 0) % 256
        np.testing.assert_array_equal(r, a)

    def test_empaquetage_aller_retour(self):
        T, H, W = 4, 3, 2
        val = np.linspace(0, 50, T * H * W).reshape(T, H * W).astype(np.float32)
        drap = np.zeros((T, H * W), np.uint8); sd = np.ones((T, H * W), np.float32)
        champs, gz, brut = EX.empaqueter({'eau': (val, drap, sd)}, (T, H, W))
        octets = np.frombuffer(gzip.decompress(gz), np.uint8).reshape(3, T, H, W)
        v = np.cumsum(octets[0].astype(np.int64), 0) % 256 * 0.5
        np.testing.assert_allclose(v.reshape(T, -1), val, atol=0.25)


if __name__ == '__main__':
    unittest.main()
