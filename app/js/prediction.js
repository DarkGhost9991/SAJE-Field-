/* =====================================================================
   SAJE Field — moteur de prévision (rapide, séquentiel, explicable)
   ---------------------------------------------------------------------
   Question : « que verra probablement NISAR au prochain passage ? »

   Contraintes des données : 4 à 13 passages calibrés par zone, espacés
   de 12 à 24 jours (trous quand le passage est en HH seul), valeurs
   parfois nulles. On ne peut donc utiliser que de très petits modèles,
   qui se mettent à jour passage après passage (séquentiels) et dont on
   peut expliquer chaque chiffre.

   Les 6 modèles candidats (du plus simple au plus riche) :
     1. persistance   — « comme la dernière fois »
     2. normale       — « comme d'habitude » (médiane des passages passés)
     3. lissage       — lissage exponentiel simple, pas de temps irrégulier
     4. theilsen      — tendance robuste de Theil–Sen (médiane des pentes)
     5. holt          — lissage de Holt à tendance amortie
     6. kalman        — filtre de Kalman « niveau + pente »

   Méthode (identique pour chaque zone et chaque indicateur) :
     a. on garde les passages comparables : même orbite, calibrés (pas
        BETA), polarisation suffisante, contrôle qualité, et JAMAIS de
        passage postérieur à la date choisie (pas de regard vers l'avenir) ;
     b. évaluation glissante : à chaque passage k, chaque modèle est
        réglé (section dorée ou grille) sur les passages 0..k-1 seulement,
        puis prévoit le passage k. On obtient l'erreur réelle qu'il aurait
        faite dans le passé ;
     c. on choisit le modèle de plus petite erreur moyenne (MAE), en
        préférant le plus simple si un modèle plus riche ne gagne pas
        au moins 5 % (parcimonie) ;
     d. intervalle à 95 % : erreur quadratique de l'évaluation glissante
        × quantile de Student (peu de points = intervalle plus large),
        jamais plus étroit que le bruit plancher de l'indicateur ;
     e. probabilité de sortir de la normale de la zone (même seuils que
        le moteur de raisonnement : ±2 écarts robustes ET effet utile) ;
     f. contrôle a posteriori : ce que le modèle aurait prévu pour la
        date choisie, comparé à ce qui a été mesuré.
   Sans au moins 5 passages comparables : aucune prévision (et on dit pourquoi).
   ===================================================================== */
const Prediction = (() => {
  'use strict';

  const JOUR = 864e5;
  const CYCLE = 12;          // jours entre deux passages de la même orbite
  const MIN_OBS = 5;         // passages comparables nécessaires pour prévoir
  const DEBUT = 3;           // premier passage évalué (les modèles ont vu 3 passages)
  const PARCIMONIE = 0.95;   // un modèle plus riche doit faire au moins 5 % mieux

  const jours = iso => Date.parse(iso + 'T00:00:00Z') / JOUR;
  const isoDe = j => new Date(Math.round(j) * JOUR).toISOString().slice(0, 10);

  // ------------------------------------------------------------------ outils statistiques
  const mediane = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const moyenne = a => a.reduce((s, x) => s + x, 0) / a.length;
  /** Quantile 97,5 % de Student (intervalle à 95 %) selon le nombre d'erreurs mesurées. */
  const STUDENT = [12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23];
  const student = df => df < 1 ? Infinity : df <= 10 ? STUDENT[df - 1] : 1.96 + 2.5 / df;
  /** Fonction de répartition de la loi normale (Abramowitz & Stegun 7.1.26, erreur < 1,5e-7). */
  function phi(x) {
    const s = x < 0 ? -1 : 1, z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
    const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return 0.5 * (1 + s * e);
  }

  // ------------------------------------------------------------------ optimisation (réglage des paramètres)
  /** Recherche par section dorée d'un minimum sur [a, b] (fonction unimodale, ~25 évaluations). */
  function sectionDoree(f, a, b, iter = 22) {
    const g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
    for (let i = 0; i < iter; i++) {
      if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
      else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
    }
    return fc < fd ? c : d;
  }
  /** Meilleur point d'une grille (liste de jeux de paramètres). */
  function grille(f, points) {
    let best = points[0], fb = Infinity;
    for (const p of points) { const v = f(p); if (v < fb) { fb = v; best = p; } }
    return best;
  }

  // ------------------------------------------------------------------ les modèles (apprentissage en ligne)
  // Chaque modèle expose : pret(), prevoir(t), apprendre(t, y), etat().
  // apprendre() ne coûte qu'une mise à jour : le modèle lit la série une seule fois, dans l'ordre.
  const MODELES = {
    persistance: {
      ordre: 1, nom: 'Comme la dernière fois', savant: 'Persistance (prévision naïve)',
      comment: 'Prévoit la dernière valeur mesurée. C’est la référence que les autres méthodes doivent battre.',
      creer() {
        let y0 = null;
        return { pret: () => y0 != null, prevoir: () => y0, apprendre: (t, y) => { y0 = y; }, etat: () => ({ derniere: y0 }) };
      },
    },
    normale: {
      ordre: 2, nom: 'Comme d’habitude', savant: 'Climatologie robuste (médiane des passages)',
      comment: 'Prévoit la médiane de tous les passages déjà vus : la zone revient à son état habituel.',
      creer() {
        const v = [];
        return { pret: () => v.length >= 2, prevoir: () => mediane(v), apprendre: (t, y) => { v.push(y); }, etat: () => ({ mediane: v.length ? mediane(v) : null }) };
      },
    },
    lissage: {
      ordre: 3, nom: 'Moyenne qui privilégie le récent', savant: 'Lissage exponentiel simple (pas irrégulier)',
      comment: 'Chaque nouveau passage corrige le niveau d’une fraction α de l’erreur ; plus l’écart entre deux passages est long, plus la correction est forte.',
      defaut: { alpha: 0.5 },
      regler: (cout) => ({ alpha: sectionDoree(a => cout({ alpha: a }), 0.02, 0.98) }),
      creer({ alpha }) {
        let L = null, t0 = null;
        return {
          pret: () => L != null, prevoir: () => L,
          apprendre(t, y) {
            if (L == null) { L = y; t0 = t; return; }
            const a = 1 - Math.pow(1 - alpha, Math.max(t - t0, 1) / CYCLE);
            L += a * (y - L); t0 = t;
          },
          etat: () => ({ niveau: L }),
        };
      },
    },
    theilsen: {
      ordre: 4, nom: 'Tendance de fond (ligne droite robuste)', savant: 'Tendance de Theil–Sen (médiane des pentes)',
      comment: 'Trace la droite dont la pente est la médiane de toutes les pentes entre deux passages : un passage aberrant ne la fait pas dévier.',
      creer() {
        const pts = []; let a = 0, b = 0;
        return {
          pret: () => pts.length >= 3, prevoir: t => a + b * t,
          apprendre(t, y) {
            pts.push([t, y]);
            const s = [];
            for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[j][0] !== pts[i][0]) s.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
            b = s.length ? mediane(s) : 0;
            a = mediane(pts.map(p => p[1] - b * p[0]));
          },
          etat: () => ({ niveau: pts.length ? a + b * pts.at(-1)[0] : null, pente_jour: b }),
        };
      },
    },
    holt: {
      ordre: 5, nom: 'Tendance qui s’essouffle', savant: 'Lissage de Holt à tendance amortie',
      comment: 'Suit un niveau et une pente, chacun corrigé à chaque passage (α, β) ; la pente est amortie (φ) pour ne pas prolonger une tendance indéfiniment.',
      defaut: { alpha: 0.5, beta: 0.2, phi: 0.9 },
      regler: (cout) => grille(cout, [0.2, 0.5, 0.8].flatMap(alpha => [0.05, 0.2, 0.5].flatMap(beta => [0.8, 0.98].map(phi => ({ alpha, beta, phi }))))),
      creer({ alpha, beta, phi }) {
        let L = null, B = 0, t0 = null, n = 0;
        const f = t => L + phi * B * (t - t0);
        return {
          pret: () => n >= 2, prevoir: f,
          apprendre(t, y) {
            n++;
            if (n === 1) { L = y; t0 = t; return; }
            const dt = Math.max(1, t - t0);
            if (n === 2) { B = (y - L) / dt; L = y; t0 = t; return; }
            const a = 1 - Math.pow(1 - alpha, dt / CYCLE), b = 1 - Math.pow(1 - beta, dt / CYCLE);
            const p = f(t), e = y - p;
            L = p + a * e; B = phi * B + a * b * e / dt; t0 = t;
          },
          etat: () => ({ niveau: L, pente_jour: phi * B }),
        };
      },
    },
    kalman: {
      ordre: 6, nom: 'Filtre qui sépare le signal du bruit', savant: 'Filtre de Kalman (niveau + pente)',
      comment: 'Estime à chaque passage un niveau et une pente, et pèse la nouvelle mesure selon le rapport q entre changement réel et bruit de mesure.',
      defaut: { q: 1 },
      regler: (cout) => grille(cout, [0.01, 0.03, 0.1, 0.3, 1, 3, 10].map(q => ({ q }))),
      creer({ q }) {
        // état : niveau l, pente s (par cycle de 12 j) ; variances exprimées en unités de bruit de mesure (R = 1)
        let x0 = null, x1 = 0, p00 = 1, p01 = 0, p11 = 1e4, t0 = null;
        return {
          pret: () => x0 != null, prevoir: t => x0 + x1 * (t - t0) / CYCLE,
          apprendre(t, y) {
            if (x0 == null) { x0 = y; t0 = t; return; }
            const u = Math.max(t - t0, 1) / CYCLE;
            // prédiction
            const l = x0 + u * x1;
            const a = p00 + 2 * u * p01 + u * u * p11 + q * u, b = p01 + u * p11, c = p11 + 0.1 * q * u;
            // correction
            const S = a + 1, k0 = a / S, k1 = b / S, e = y - l;
            x0 = l + k0 * e; x1 += k1 * e;
            p00 = a - k0 * a; p01 = b - k0 * b; p11 = c - k1 * b; t0 = t;
          },
          etat: () => ({ niveau: x0, pente_jour: x1 / CYCLE }),
        };
      },
    },
  };
  const IDS = Object.keys(MODELES).sort((a, b) => MODELES[a].ordre - MODELES[b].ordre);

  // ------------------------------------------------------------------ moteur séquentiel
  /** Fait lire la série au modèle, dans l'ordre ; renvoie le modèle à jour et ses prévisions à un pas. */
  function lire(id, params, obs) {
    const m = MODELES[id].creer(params || {});
    const preds = obs.map(o => { const p = m.pret() ? m.prevoir(o.t) : null; m.apprendre(o.t, o.y); return p; });
    return { m, preds };
  }
  /** Réglage des paramètres sur les seuls passages fournis (erreur quadratique des prévisions à un pas). */
  function regler(id, obs) {
    const md = MODELES[id];
    if (!md.regler) return {};
    const debut = id === 'holt' ? 2 : 1;
    if (obs.length - debut < 2) return { ...md.defaut };
    const cout = p => { const { preds } = lire(id, p, obs); let s = 0; for (let k = debut; k < obs.length; k++) if (preds[k] != null) s += (obs[k].y - preds[k]) ** 2; return s; };
    return md.regler(cout);
  }
  /** Évaluation glissante honnête : réglage puis prévision du passage k avec les passages 0..k-1 seulement. */
  function evaluer(id, obs) {
    const err = [];
    for (let k = DEBUT; k < obs.length; k++) {
      const passe = obs.slice(0, k), p = regler(id, passe), { m } = lire(id, p, passe);
      if (m.pret()) err.push(obs[k].y - m.prevoir(obs[k].t));
    }
    const abs = err.map(Math.abs);
    return { id, err, mae: abs.length ? moyenne(abs) : Infinity, rmse: err.length ? Math.sqrt(moyenne(err.map(e => e * e))) : Infinity };
  }
  /** Choix du modèle : plus petite erreur moyenne, à parcimonie égale le plus simple. */
  function choisir(scores) {
    let best = scores[0];
    for (const s of scores.slice(1)) if (s.mae < best.mae * PARCIMONIE - 1e-12) best = s;
    return best;
  }

  /** Passages comparables pour un indicateur, jusqu'à la date choisie incluse. */
  function observations(serie, ind, d) {
    const exclus = { beta: 0, polarisation: 0, qualite: 0, absent: 0 };
    const obs = [];
    for (const p of serie) {
      if (p.date > d.date || p.orbite !== d.orbite) continue;
      if (p.maturite === 'BETA') { exclus.beta++; continue; }
      if (ind.besoinHV && !p.double_pol) { exclus.polarisation++; continue; }
      if ((p.couverture_pct ?? 100) < 50 || (ind.cle === 'humidite_m3m3' && (p.sol_pixels_retenus ?? 5) < 5)) { exclus.qualite++; continue; }
      const y = p[ind.cle];
      if (y == null || !Number.isFinite(y)) { exclus.absent++; continue; }
      obs.push({ t: jours(p.date), y, date: p.date });
    }
    obs.sort((a, b) => a.t - b.t);
    return { obs, exclus };
  }

  /** Normale robuste (même règle que le moteur de raisonnement : médiane ± 2 × max(1,4826 MAD, plancher)). */
  function normale(obs, ind) {
    if (obs.length < 4) return null;
    const v = obs.map(o => o.y), m = mediane(v);
    const s = Math.max(1.4826 * mediane(v.map(x => Math.abs(x - m))), ind.plancher);
    return { mediane: m, sigma: s, bas: m - 2 * s, haut: m + 2 * s, seuilHaut: Math.max(m + 2 * s, m + ind.effetMin), seuilBas: Math.min(m - 2 * s, m - ind.effetMin) };
  }

  const borner = (ind, v) => ind.unite === 'pct' ? Math.min(100, Math.max(0, v)) : ind.unite === 'm3' ? Math.min(1, Math.max(0, v)) : v;

  /** Prévision brute à la date tCible à partir des observations (sélection + intervalle). */
  function prevoirObs(obs, ind, tCible) {
    const scores = IDS.map(id => evaluer(id, obs));
    const choix = choisir(scores), ref = scores[0];
    const params = regler(choix.id, obs), { m } = lire(choix.id, params, obs);
    const brut = m.prevoir(tCible);
    const ecarts = obs.slice(1).map((o, i) => o.t - obs[i].t), pasMoyen = moyenne(ecarts);
    const h = Math.max(1, (tCible - obs.at(-1).t) / pasMoyen);
    const s = Math.max(choix.rmse, ind.plancher);
    const demi = student(choix.err.length) * s * Math.sqrt(h);
    return {
      valeur: borner(ind, brut), bas: borner(ind, brut - demi), haut: borner(ind, brut + demi), demi, sd: demi / 1.96, h,
      modele: { id: choix.id, params, etat: m.etat() },
      scores: scores.map(x => ({ id: x.id, mae: x.mae, rmse: x.rmse, choisi: x.id === choix.id })),
      mae: choix.mae, rmse: choix.rmse, m: choix.err.length,
      competence: ref.mae > 0 && Number.isFinite(ref.mae) ? 1 - choix.mae / ref.mae : null,
    };
  }

  /** Probabilité que le prochain passage sorte de la normale (au-dessus / en dessous). */
  function risque(ind, nrm, p) {
    if (!nrm || !(p.sd > 0)) return null;
    const pHaut = 1 - phi((nrm.seuilHaut - p.valeur) / p.sd);
    const pBas = ind.unite !== 'dB' && nrm.seuilBas <= 0 ? 0 : phi((nrm.seuilBas - p.valeur) / p.sd);
    const sens = ind.haut ? 'haut' : ind.bas ? 'bas' : (pHaut >= pBas ? 'haut' : 'bas');
    return { haut: pHaut, bas: pBas, sens, p: sens === 'haut' ? pHaut : pBas, seuilHaut: nrm.seuilHaut, seuilBas: nrm.seuilBas };
  }

  /** Confiance de la prévision (0–1) et ses raisons, sur le modèle du moteur de raisonnement. */
  function confiance(p, dernier, retro) {
    let s = 1; const f = [];
    if (p.m >= 6) f.push(['+', `Méthode testée sur ${p.m} passages passés.`]);
    else if (p.m >= 3) { s *= 0.8; f.push(['~', `Méthode testée sur seulement ${p.m} passages passés.`]); }
    else { s *= 0.6; f.push(['−', `Méthode testée sur ${p.m} passage(s) passé(s) seulement.`]); }
    if (p.modele.id === 'persistance') { s *= 0.9; f.push(['~', 'Aucune méthode ne fait mieux que « comme la dernière fois ».']); }
    else if (p.competence != null && p.competence >= 0.2) f.push(['+', `Erreur ${Math.round(p.competence * 100)} % plus faible que « comme la dernière fois ».`]);
    else f.push(['~', 'Gain modeste par rapport à « comme la dernière fois ».']);
    if (dernier === 'PROVISIONAL') { s *= 0.9; f.push(['~', 'Dernière mesure provisoire (calibration en cours).']); }
    if (p.h > 2) { s *= 0.8; f.push(['~', 'Prévision lointaine : plusieurs passages sans mesure comparable.']); }
    if (retro && !retro.conforme) { s *= 0.8; f.push(['−', 'Le modèle s’est trompé sur la date choisie (mesure hors de l’intervalle prévu).']); }
    else if (retro?.conforme) f.push(['+', 'La date choisie était bien dans l’intervalle prévu.']);
    const niveau = s >= 0.75 ? 'bonne' : s >= 0.5 ? 'moyenne' : 'faible';
    return { score: Math.round(s * 100) / 100, niveau, facteurs: f };
  }

  // ------------------------------------------------------------------ API
  /**
   * Prévision d'un indicateur pour le prochain passage de la même orbite après la date choisie.
   * @param {string} id      identifiant de l'indicateur (Raisonnement.IND)
   * @param {object} ind     définition de l'indicateur (cle, unite, besoinHV, plancher, effetMin, haut/bas)
   * @param {Array}  serie   points de la zone {date, orbite, maturite, double_pol, …}
   * @param {object} d       passage choisi {date, orbite, maturite}
   * @param {number} [surfaceKm2]
   */
  function prevoir(id, ind, serie, d, surfaceKm2) {
    const { obs, exclus } = observations(serie, ind, d);
    const base = { id, ind, n: obs.length, exclus };
    if (obs.length < MIN_OBS) {
      const r = [];
      if (exclus.polarisation) r.push(`${exclus.polarisation} passage(s) en HH seul ne mesurent pas cet indicateur`);
      if (exclus.beta) r.push(`${exclus.beta} passage(s) bêta non calibrés`);
      if (exclus.qualite) r.push(`${exclus.qualite} passage(s) refusés par le contrôle qualité`);
      return { ...base, ok: false, raison: `${obs.length} passage(s) comparable(s) seulement, il en faut ${MIN_OBS} pour tester une méthode de prévision${r.length ? ' (' + r.join(', ') + ')' : ''}.` };
    }
    const tCible = jours(d.date) + CYCLE;
    const p = prevoirObs(obs, ind, tCible);
    const nrm = normale(obs, ind);
    // contrôle a posteriori : la date choisie était-elle prévisible ?
    let retro = null;
    const iSel = obs.findIndex(o => o.date === d.date);
    if (iSel >= MIN_OBS) {
      const r = prevoirObs(obs.slice(0, iSel), ind, obs[iSel].t), y = obs[iSel].y;
      retro = { date: d.date, prevu: r.valeur, bas: r.bas, haut: r.haut, mesure: y, conforme: y >= r.bas && y <= r.haut, modele: r.modele.id };
    }
    const dernier = serie.find(x => x.date === obs.at(-1).date)?.maturite;
    const out = {
      ...base, ok: true, cible: { date: isoDe(tCible), h: p.h }, depuis: obs.at(-1).date,
      ...p, normale: nrm, risque: risque(ind, nrm, p), retro,
      conf: confiance(p, dernier, retro),
    };
    if (ind.unite === 'pct' && surfaceKm2) { out.km2 = surfaceKm2 * out.valeur / 100; out.km2Bas = surfaceKm2 * out.bas / 100; out.km2Haut = surfaceKm2 * out.haut / 100; }
    const pente = out.modele.etat.pente_jour;
    if (pente != null && Number.isFinite(pente)) out.tendanceMois = pente * 30;
    return out;
  }

  // ------------------------------------------------------------------ prévisions calculées par le programme Python
  // prevision/prevoir.py écrit js/donnees/previsions_province.js (window.SAJE_PREVISIONS).
  // On ne les utilise que si elles portent sur exactement les mêmes passages que ceux de l'application
  // (empreinte : nombre de passages, dernier passage, somme des valeurs). Sinon, ou pour une zone
  // dessinée, le navigateur refait le même calcul (mêmes formules que le Python).
  function precalculee(id, ind, serie, d, zone, surfaceKm2) {
    const P = window.SAJE_PREVISIONS?.[Donnees.M?.niveau || 'province'];
    const p = P?.zones?.[zone]?.[d.date + '|' + d.orbite]?.find(x => x.id === id);
    if (!p?.empreinte) return null;
    const { obs } = observations(serie, ind, d), e = p.empreinte, somme = obs.reduce((s, o) => s + o.y, 0);
    if (e.n !== obs.length || e.depuis !== (obs.at(-1)?.date ?? null) || Math.abs(e.somme - somme) > 1e-3 * (1 + Math.abs(somme))) return null;
    const out = { ...p, ind, source: 'python', calculeLe: P.genere_le };
    if (p.ok && ind.unite === 'pct' && surfaceKm2) { out.km2 = surfaceKm2 * p.valeur / 100; out.km2Bas = surfaceKm2 * p.bas / 100; out.km2Haut = surfaceKm2 * p.haut / 100; }
    return out;
  }

  /** Prévisions de tous les indicateurs d'une zone (Python si à jour, sinon calcul dans le navigateur). */
  function toutes(serie, d, IND, ORDRE, surfaceKm2, zone) {
    return ORDRE.map(id => {
      try { return (zone && precalculee(id, IND[id], serie, d, zone, surfaceKm2)) || { ...prevoir(id, IND[id], serie, d, surfaceKm2), source: 'navigateur' }; }
      catch (e) { return { id, ind: IND[id], ok: false, raison: 'Calcul de prévision impossible pour cet indicateur.', source: 'navigateur' }; }
    });
  }

  const modele = id => MODELES[id];
  return { prevoir, toutes, modele, MODELES, IDS, CYCLE, MIN_OBS, interne: { sectionDoree, grille, lire, regler, evaluer, choisir, observations, normale, phi, student, mediane } };
})();
