"""Travail d'un processus : un cadre NISAR -> observations réduites (exécuté en parallèle).

Chaque processus a sa propre part du budget mémoire brute. Il ne renvoie au
programme principal que les couches réduites (quelques centaines de ko au plus).
"""
import time
import traceback

from . import reduction as R
from .acces import Budget

_budget = None


def initialiser(budget_octets):
    global _budget
    _budget = Budget(budget_octets)


RESEAU = ('getaddrinfo', 'URLError', 'ClientConnector', 'ClientPayloadError', 'ConnectionAbortedError',
          'ConnectionResetError', 'TimeoutError', 'timed out', 'IncompleteRead', 'réponse incomplète')


def _coupure(e):
    texte = f'{type(e).__name__}: {e}'
    return any(m in texte for m in RESEAU)


def traiter(p, produit, niveaux, cfg, connexions, essais=4):
    t0 = time.time()
    try:
        fn = R.reduire_gcov if produit == 'GCOV' else R.reduire_sme2
        for n in range(essais):
            try:
                obs, info = fn(p, niveaux, cfg, budget=_budget, connexions=connexions)
                break
            except Exception as e:                   # noqa: BLE001
                if not _coupure(e) or n == essais - 1:
                    raise
                time.sleep(30 * (n + 1))             # coupure Internet : on attend qu'elle revienne
        info['essais'] = n + 1
        info['duree_s'] = round(time.time() - t0, 1)
        info['pic_brut_Mo'] = round(_budget.pic / 1e6, 1) if _budget else None
        return {'ok': True, 'p': p, 'produit': produit, 'obs': obs, 'info': info}
    except R.SansBandeB as e:
        return {'ok': False, 'rejete': True, 'p': p, 'produit': produit, 'raison': str(e)}
    except Exception as e:                       # noqa: BLE001 - l'erreur est notée, le produit sera retenté
        return {'ok': False, 'rejete': False, 'p': p, 'produit': produit,
                'raison': f'{type(e).__name__}: {e}'[:300], 'trace': traceback.format_exc()[-1500:]}
