/* =====================================================================
   SAJE Field — moteur de raisonnement
   ---------------------------------------------------------------------
   Principe : l'application ne conclut QUE sur des données exploitables.

   Pour chaque indicateur (eau, inondation, eau sous la végétation,
   végétation, écart à la normale, humidité du sol), le moteur :
     1. vérifie que la donnée existe et qu'elle est exploitable
        (produit présent, polarisation nécessaire, contrôle qualité NASA,
        couverture, maturité BETA / PROVISIONAL / VALIDATED) ;
     2. calcule la « normale » de la zone à partir de SES PROPRES passages
        calibrés de la même orbite (médiane + écart robuste, MAD) ;
     3. ne parle d'un changement que s'il dépasse à la fois le bruit
        naturel de la zone (≥ 2 écarts robustes) ET un effet minimal
        utile sur le terrain ;
     4. donne un niveau de confiance calculé, avec ses raisons ;
     5. range ce qu'il ne peut pas dire dans « Ce que les données ne
        permettent pas de dire », avec la raison.
   Aucune valeur n'est inventée : sans donnée exploitable, pas de phrase.
   ===================================================================== */
const Raisonnement = (() => {
  'use strict';

  const N = (v, n = 1) => Donnees.nombre(v, n);
  /** Mode d'affichage : « simple » pour tout le monde, « analyste » pour les spécialistes. */
  const AN = () => document.documentElement.dataset.detail === 'expert';
  const T = (simple, analyste) => AN() ? analyste : simple;
  const F = iso => Donnees.formatDate(iso);

  // ------------------------------------------------------------------ noms de lieux dans les phrases
  const court = z => z.split(' - ')[0].trim();
  const voyelle = s => /^[aeiouyhéèêàâîôûAEIOUYHÉ]/.test(s);
  /** « à Ntoum », « dans la province de l’Estuaire », « dans « Ma zone » » */
  const secteur = z => z.match(/^Secteur (\w+)(?: · (.+))?$/);
  function a(z) {
    const sc = secteur(z);
    if (sc) return `dans le secteur ${sc[1]}${sc[2] ? ` (${sc[2]})` : ''}`;
    if (/^Province/i.test(z)) return 'dans la province de l’Estuaire';
    if (/^Estuaire du Komo/i.test(z)) return 'dans l’estuaire du Komo';
    if (/^(Point|Zone|Ma zone|Ma )/i.test(z) || z.length > 34) return `dans « ${z} »`;
    return `à ${court(z)}`;
  }
  /** « de Ntoum », « d’Akanda », « de la province » */
  function de(z) {
    const sc = secteur(z);
    if (sc) return `du secteur ${sc[1]}`;
    if (/^Province/i.test(z)) return 'de la province';
    if (/^Estuaire du Komo/i.test(z)) return 'de l’estuaire du Komo';
    if (/^(Point|Zone|Ma zone|Ma )/i.test(z) || z.length > 34) return `de « ${z} »`;
    const c = court(z);
    return voyelle(c) ? `d’${c}` : `de ${c}`;
  }

  // ------------------------------------------------------------------ indicateurs
  const IND = {
    inondation: {
      cle: 'part_inondation_pct', libelle: 'Zones inondées', court: 'inondation', unite: 'pct', theme: 'eau',
      plancher: 0.15, effetMin: 0.3, besoinHV: false, haut: 'alerte',
      question: 'Y a-t-il de l’eau là où il n’y en a pas d’habitude ?',
    },
    vegetation_inondee: {
      cle: 'part_vegetation_inondee_pct', libelle: 'Eau sous la végétation', court: 'eau sous la végétation', unite: 'pct', theme: 'eau',
      plancher: 0.1, effetMin: 0.3, besoinHV: true, haut: 'attention',
      question: 'L’eau se cache-t-elle sous la mangrove ou les arbres ?',
    },
    eau: {
      cle: 'part_eau_pct', libelle: 'Eau libre', court: 'eau libre', unite: 'pct', theme: 'eau',
      plancher: 0.2, effetMin: 0.5, besoinHV: false, haut: 'attention',
      question: 'Quelle part du territoire est couverte d’eau ?',
    },
    vegetation: {
      cle: 'HVmoinsHH_dB', get libelle() { return T('Végétation', 'Densité de végétation (HV − HH)'); }, court: 'végétation', unite: 'dB', theme: 'agriculture',
      plancher: 0.25, effetMin: 0.75, besoinHV: true, bas: 'attention',
      question: 'La végétation est-elle plus dense ou plus clairsemée que d’habitude ?',
    },
    anomalie: {
      cle: 'anomalie_HH_dB', get libelle() { return T('Changements de surface', 'Écart à la normale du signal HH'); }, court: 'signal radar', unite: 'dB', theme: 'agriculture',
      plancher: 0.4, effetMin: 1.0, besoinHV: false,
      question: 'La surface renvoie-t-elle plus ou moins d’écho que d’habitude ?',
    },
    humidite: {
      cle: 'humidite_m3m3', libelle: 'Humidité du sol', court: 'humidité du sol', unite: 'm3', theme: 'agriculture',
      plancher: 0.02, effetMin: 0.04, besoinHV: false,
      question: 'Les sols sont-ils secs, humides ou saturés ?',
    },
  };
  const ORDRE = ['inondation', 'vegetation_inondee', 'eau', 'vegetation', 'anomalie', 'humidite'];

  // ------------------------------------------------------------------ outils statistiques
  const mediane = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mad = (a, m) => mediane(a.map(x => Math.abs(x - m)));

  /** Complète une série (zone dessinée ou point) : écart à la normale de HH si absent. */
  function completer(serie) {
    if (!serie.length || serie.some(p => p.anomalie_HH_dB != null)) return serie;
    const parOrbite = {};
    serie.forEach(p => { if (p.maturite !== 'BETA' && p.HH_dB != null) (parOrbite[p.orbite] ||= []).push(p.HH_dB); });
    return serie.map(p => {
      const ref = parOrbite[p.orbite];
      return { ...p, anomalie_HH_dB: p.HH_dB != null && ref?.length >= 3 ? p.HH_dB - mediane(ref) : null };
    });
  }

  /** Normale robuste de l'indicateur pour la zone (passages calibrés, même orbite, hors date évaluée). */
  function normale(serie, ind, d) {
    const vals = serie.filter(p => p.maturite !== 'BETA' && p.orbite === d.orbite && p.date !== d.date && p[ind.cle] != null && (!ind.besoinHV || p.double_pol)).map(p => p[ind.cle]);
    if (vals.length < 4) return { n: vals.length, ok: false };
    const m = mediane(vals);
    const s = Math.max(1.4826 * mad(vals, m), ind.plancher);
    return { n: vals.length, ok: true, mediane: m, sigma: s, bas: m - 2 * s, haut: m + 2 * s, min: Math.min(...vals), max: Math.max(...vals) };
  }

  /** Raisons d'exclusion d'un indicateur pour un point de série donné. */
  function exclusions(ind, p, d, id) {
    const r = [];
    if (!p) { r.push(T('Le satellite n’a pas mesuré cette zone ce jour-là.', 'Aucune mesure de cette zone pour ce passage.')); return r; }
    if (d.gcov_disponible === false && id !== 'humidite') r.push(T('Pas d’image radar ce jour-là.', 'Pas d’image radar GCOV pour ce passage (seulement l’humidité SME2).'));
    if ((p.couverture_pct ?? 100) < 50) r.push(T(`Le satellite n’a vu que ${N(p.couverture_pct, 0)} % de la zone ce jour-là.`, `Le passage ne couvre que ${N(p.couverture_pct, 0)} % de la zone.`));
    if (id === 'humidite') {
      if (!d.images?.humidite && p.humidite_m3m3 == null) r.push(T('Pas de mesure d’humidité du sol ce jour-là.', 'Pas de produit SME2 (humidité du sol) pour ce passage.'));
      else if (p.humidite_m3m3 == null || (p.sol_pixels_retenus ?? 0) < 5) {
        const mes = p.sol_mesure_pct;
        r.push(mes ? T('L’humidité du sol a été mesurée, mais la NASA a jugé ces mesures peu fiables ici (forêt trop dense ou pluie pendant le passage).',
          `Le produit SME2 couvre ${N(mes, 0)} % de la zone, mais ${p.sol_fiable_pct ? 'trop peu de' : 'aucun'} pixel ne passe le contrôle qualité de la NASA (indicateur de qualité de l’inversion) : forêt dense, pluie au moment du passage ou produit encore provisoire.`)
          : T('Pas de mesure d’humidité fiable dans cette zone.', 'Aucune valeur d’humidité exploitable dans cette zone.'));
      }
      return r;
    }
    if (ind.besoinHV && !d.double_pol) r.push(T('Ce jour-là, le satellite n’a fait qu’une mesure partielle, qui ne permet pas de voir la végétation.', 'Il faut les deux polarisations (HH et HV) ; ce passage n’a que HH.'));
    else if (p[ind.cle] == null) r.push(T('Pas de mesure utilisable ce jour-là.', ind.besoinHV ? 'Valeur non calculée pour ce passage (référence de saison sèche ou HV manquante).' : 'Valeur absente pour ce passage.'));
    return r;
  }

  /** Confiance calculée (0–1) avec ses facteurs lisibles. */
  function confiance(ind, d, nrm, p, id) {
    let s = 1;
    const f = [];
    if (d.maturite === 'VALIDATED') f.push(['+', 'Produit « validé » par la NASA et l’ISRO.']);
    else if (d.maturite === 'PROVISIONAL') { s *= 0.82; f.push(['~', 'Produit « provisoire » : calibration encore en cours.']); }
    else if (d.maturite === 'BETA') { s *= 0.45; f.push(['−', 'Produit « bêta » : non calibré, recalé sur la forêt, à confirmer.']); }
    if (id === 'humidite') { s *= 0.8; f.push(['~', 'Humidité du sol SME2 : pixel de 200 m, produit provisoire.']); }
    if (!ind.besoinHV && id !== 'humidite') {
      if (d.double_pol) f.push(['+', 'Deux polarisations (HH et HV) : eau mieux séparée des surfaces lisses.']);
      else { s *= 0.85; f.push(['~', 'HH seul : une piste ou du sable lisse peut ressembler à de l’eau.']); }
    }
    if (nrm.ok) {
      if (nrm.n >= 6) f.push(['+', `Normale de la zone calculée sur ${nrm.n} passages comparables.`]);
      else { s *= 0.85; f.push(['~', `Normale calculée sur seulement ${nrm.n} passages.`]); }
    } else { s *= 0.6; f.push(['−', `Pas assez de passages comparables (${nrm.n}) pour définir une normale.`]); }
    if (p?.pixels != null && p.pixels < 25) { s *= 0.7; f.push(['−', `Zone très petite : ${p.pixels} pixel(s) radar seulement.`]); }
    const niveau = s >= 0.75 ? 'bonne' : s >= 0.5 ? 'moyenne' : 'faible';
    const sc = Math.round(s * 100) / 100;
    const libelle = AN() ? `Confiance ${niveau} (${N(sc, 2)})` : { bonne: 'Fiable', moyenne: 'Assez fiable', faible: 'Peu fiable' }[niveau];
    return { score: sc, niveau, libelle, facteurs: f };
  }

  /** Point précédent comparable (même orbite, calibré, valeur présente). */
  function precedent(serie, ind, d) {
    const avant = serie.filter(p => p.date < d.date && p.orbite === d.orbite && p.maturite !== 'BETA' && p[ind.cle] != null && (!ind.besoinHV || p.double_pol));
    return avant.at(-1) || null;
  }

  // ------------------------------------------------------------------ évaluation d'un indicateur
  function evaluer(id, serie, d, surfaceKm2) {
    const ind = IND[id];
    const p = serie.find(x => x.date === d.date && x.orbite === d.orbite);
    const raisons = exclusions(ind, p, d, id);
    const nrm = normale(serie, ind, d);
    const base = { id, ind, libelle: ind.libelle, question: ind.question, point: p, normale: nrm };
    if (raisons.length) return { ...base, exploitable: false, raisons };

    const v = p[ind.cle];
    const out = { ...base, exploitable: true, raisons: [], valeur: v, conf: confiance(ind, d, nrm, p, id) };
    if (ind.unite === 'pct' && surfaceKm2) out.km2 = surfaceKm2 * v / 100;
    if (nrm.ok) {
      const ecart = v - nrm.mediane, z = ecart / nrm.sigma;
      out.ecart = ecart; out.z = z;
      if (ind.unite === 'pct' && surfaceKm2) { out.km2Normale = surfaceKm2 * nrm.mediane / 100; out.km2Ecart = surfaceKm2 * ecart / 100; }
      const utile = Math.abs(ecart) >= ind.effetMin;
      out.etat = !utile || Math.abs(z) < 2 ? 'normal' : z > 0 ? (z >= 3.5 ? 'tres_haut' : 'haut') : (z <= -3.5 ? 'tres_bas' : 'bas');
    } else out.etat = 'inconnu';
    const pr = precedent(serie, ind, d);
    if (pr) {
      const delta = v - pr[ind.cle];
      const seuil = Math.max(ind.effetMin, nrm.ok ? 2 * nrm.sigma : ind.effetMin * 2);
      out.precedent = { date: pr.date, valeur: pr[ind.cle], delta, significatif: Math.abs(delta) >= seuil };
    }
    if (id === 'humidite') {
      const sec = p.sol_sec_pct, hum = p.sol_humide_pct, sat = p.sol_sature_pct;
      const cl = [['sec', sec], ['humide', hum], ['saturé', sat]].sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1));
      out.classes = { sec, humide: hum, sature: sat, dominante: cl[0][0], fiablePct: p.sol_fiable_pct };
    }
    return out;
  }

  // ------------------------------------------------------------------ phrases
  const unite = (ind, v, signe = false) => {
    const s = signe && v > 0 ? '+' : '';
    if (ind.unite === 'pct') return `${s}${N(v)} %`;
    if (ind.unite === 'dB') return `${s}${N(v)} dB`;
    return `${s}${N(v, 3)} m³/m³`;
  };
  const surf = (k, signe = false) => k == null ? '' : `${signe && k > 0 ? '+' : ''}${N(k, Math.abs(k) < 10 ? 1 : 0)} km²`;

  /** Preuve en langage courant : ce qu'on a vu, et ce qu'on voit d'habitude. */
  function preuveSimple(e) {
    const ind = e.ind, n = e.normale;
    const env = k => k == null ? null : Math.abs(k) < 0.05 ? 'presque rien' : `environ ${surf(k)}`;
    const vu = ind.unite === 'pct' && e.km2 != null ? env(e.km2) : null;
    const hab = ind.unite === 'pct' ? env(e.km2Normale) : null;
    if (vu) return n.ok ? `Vu ce jour-là : ${vu}. D’habitude : ${hab}.` : `Vu ce jour-là : ${vu}. Pas encore assez de passages pour savoir ce qui est habituel.`;
    return n.ok ? `Comparé à ${n.n} autres passages du satellite au-dessus de cette zone.` : 'Pas encore assez de passages pour savoir ce qui est habituel.';
  }

  function constat(e, zone, d) {
    const ind = e.ind, normal = e.etat === 'normal', haut = /haut/.test(e.etat), bas = /bas/.test(e.etat), fort = /tres/.test(e.etat);
    const prv = e.precedent;
    const evo = prv ? (prv.significatif ? (prv.delta > 0 ? ` En hausse depuis le ${F(prv.date)}.` : ` En baisse depuis le ${F(prv.date)}.`) : ` Stable depuis le ${F(prv.date)}.`) : '';
    const preuve = !AN() ? preuveSimple(e)
      : e.normale.ok
      ? `Mesuré : ${unite(ind, e.valeur)}${e.km2 != null ? ` (${surf(e.km2)})` : ''} · normale : ${unite(ind, e.normale.mediane)} (de ${unite(ind, e.normale.bas < 0 && ind.unite === 'pct' ? 0 : e.normale.bas)} à ${unite(ind, e.normale.haut)}) · σ robuste ${unite(ind, e.normale.sigma)} · z = ${N(e.z, 1)} · ${e.normale.n} passages`
      : `Mesuré : ${unite(ind, e.valeur)} · normale impossible à établir (${e.normale.n} passages comparables)`;
    let niveau = 'info', titre = '', texte = '';
    switch (e.id) {
      case 'inondation':
        if (haut) { niveau = fort ? 'alerte' : 'attention'; titre = `Plus d’eau que d’habitude hors des cours d’eau`; texte = `${surf(e.km2Ecart, true)} d’eau en plus que la normale ${de(zone)}, en dehors de l’estuaire et des rivières permanentes.`; }
        else if (bas) { titre = 'Moins de zones inondées que d’habitude'; texte = `Les bas-fonds ${de(zone)} sont plus secs que d’habitude.`; }
        else if (normal) { niveau = 'normal'; titre = 'Inondation dans la normale'; texte = `Aucune inondation inhabituelle détectée ${a(zone)}.`; }
        else { titre = 'Zones inondées mesurées'; texte = `${surf(e.km2)} d’eau hors des cours d’eau permanents.`; }
        break;
      case 'vegetation_inondee':
        if (haut) { niveau = 'attention'; titre = 'Eau cachée sous la végétation'; texte = T(`Le satellite voit plus d’eau que d’habitude sous la mangrove ou la forêt : environ ${surf(e.km2)}.`, `Le radar (bande L) détecte plus d’eau que d’habitude sous la mangrove ou la forêt : ${surf(e.km2)}.`); }
        else if (normal) { niveau = 'normal'; titre = 'Pas d’eau inhabituelle sous la végétation'; texte = `L’eau sous le couvert végétal reste dans la normale ${de(zone)}.`; }
        else { titre = 'Eau sous la végétation'; texte = `${surf(e.km2)} détectés sous le couvert.`; }
        break;
      case 'eau':
        if (haut) { niveau = 'attention'; titre = 'Plus d’eau libre que d’habitude'; texte = `${surf(e.km2Ecart, true)} d’eau libre par rapport à la normale.`; }
        else if (bas) { titre = 'Moins d’eau libre que d’habitude'; texte = 'Niveau bas : marée, saison sèche ou décrue.'; }
        else if (normal) { niveau = 'normal'; titre = 'Eau libre dans la normale'; texte = `L’eau libre couvre ${surf(e.km2)} ${a(zone)}, comme d’habitude.`; }
        else { titre = 'Eau libre mesurée'; texte = `L’eau libre couvre ${surf(e.km2)} ${a(zone)}.`; }
        break;
      case 'vegetation':
        if (bas) { niveau = fort ? 'alerte' : 'attention'; titre = 'Végétation plus clairsemée que d’habitude'; texte = T('Il y a nettement moins de végétation que d’habitude : récolte, défrichement ou coupe possible.', 'Le signal de végétation (HV − HH) baisse nettement : récolte, défrichement ou coupe possible.'); }
        else if (haut) { titre = 'Végétation plus dense que d’habitude'; texte = 'Le couvert végétal se renforce : cultures ou végétation en croissance.'; }
        else if (normal) { niveau = 'normal'; titre = 'Végétation dans la normale'; texte = `La densité de végétation ${de(zone)} reste stable.`; }
        else { titre = 'Végétation mesurée'; texte = 'Indice de végétation disponible, sans normale de comparaison.'; }
        break;
      case 'anomalie':
        if (haut) { titre = T('Sol plus humide ou végétation qui pousse', 'Surface plus « brillante » que d’habitude'); texte = T('Le sol paraît plus humide, ou la végétation a poussé.', 'Sol plus humide, végétation qui pousse ou eau sous le couvert.'); }
        else if (bas) { niveau = 'attention'; titre = T('Sol plus sec ou végétation coupée', 'Surface plus « sombre » que d’habitude'); texte = T('Le sol paraît plus sec, ou des arbres et cultures ont été coupés ou récoltés.', 'Sol plus sec, récolte ou défrichement possible.'); }
        else { niveau = 'normal'; titre = T('Pas de changement visible', 'Signal radar dans la normale'); texte = T('La surface ressemble à ce que le satellite voit d’habitude.', 'L’écho de la surface ressemble aux autres passages.'); }
        break;
      case 'humidite': {
        const c = e.classes;
        titre = `Sols majoritairement ${c.dominante}s`;
        texte = `Sur les pixels fiables : ${N(c.sec, 0)} % secs, ${N(c.humide, 0)} % humides, ${N(c.sature, 0)} % saturés (${N(c.fiablePct, 0)} % des pixels mesurés sont fiables).`;
        niveau = c.dominante === 'saturé' ? 'attention' : 'info';
        break;
      }
    }
    // une conclusion de confiance faible ne déclenche jamais d'alerte
    if (e.conf.niveau === 'faible' && (niveau === 'alerte' || niveau === 'attention')) niveau = 'info';
    return { id: e.id, theme: e.ind.theme, niveau, titre, texte: texte + (normal || e.etat === 'inconnu' ? '' : evo), preuve, conf: e.conf, etat: e.etat, z: e.z };
  }

  const POIDS = { alerte: 3, attention: 2, info: 1, normal: 0 };

  function recommandations(constats, zone, d, kind, previsions) {
    const out = [];
    const a = id => constats.find(c => c.id === id && (c.niveau === 'alerte' || c.niveau === 'attention') && c.conf.niveau !== 'faible');
    if (a('inondation')) out.push({ niveau: 'alerte', texte: `Éviter les bas-fonds ${de(zone)} ; vérifier routes, habitations et cultures proches de l’eau.` });
    if (a('vegetation_inondee')) out.push({ niveau: 'attention', texte: `Ne pas installer de nouvelles parcelles dans les zones humides ${de(zone)} (eau sous le couvert).` });
    if (a('vegetation')) out.push({ niveau: 'attention', texte: `Vérifier sur le terrain ${a(zone)} : récolte normale ou défrichement ?` });
    if (a('anomalie') && !a('vegetation')) out.push({ niveau: 'attention', texte: `Surface plus sèche ou dégagée ${a(zone)} : à confirmer au prochain passage.` });
    if (a('humidite')) out.push({ niveau: 'attention', texte: `Sols saturés ${a(zone)} : prévoir le drainage avant les semis.` });
    if (!out.length) out.push({ niveau: 'normal', texte: `Rien d’inhabituel à signaler ${a(zone)} avec les données exploitables de ce passage.` });
    // prévisions : seulement une méthode fiable, avec au moins 60 % de chances de sortir de la normale
    const ANTICIPER = {
      inondation: z => `anticiper une possible inondation inhabituelle ${a(z)} (bas-fonds, routes, cultures proches de l’eau)`,
      vegetation_inondee: z => `s’attendre à plus d’eau sous la végétation ${a(z)}`,
      eau: z => `s’attendre à plus d’eau libre que d’habitude ${a(z)}`,
      vegetation: z => `surveiller une baisse de la végétation ${a(z)} (récolte ou défrichement)`,
      humidite: z => `s’attendre à des sols plus humides que d’habitude ${a(z)}`,
    };
    (previsions || []).filter(p => p.ok && p.risque && ANTICIPER[p.id] && p.conf.niveau !== 'faible' && p.risque.p >= 0.6 && (p.id !== 'humidite' || p.risque.sens === 'haut'))
      .forEach(p => out.push({ niveau: 'attention', prevision: true, texte: `Prévision pour le passage du ${F(p.cible.date)} (${Math.round(p.risque.p * 100)} % de chances) : ${ANTICIPER[p.id](zone)}.` }));
    const prochain = new Date(new Date(d.date + 'T12:00:00Z').getTime() + 12 * 864e5).toISOString().slice(0, 10);
    out.push({ niveau: 'info', texte: `Suivi : NISAR repasse sur la même orbite tous les 12 jours (passage suivant vers le ${F(prochain)}).` });
    return out;
  }

  // ------------------------------------------------------------------ analyse complète d'une zone à une date
  /**
   * @param {string} zone   nom affiché
   * @param {Array} serie   points {date, orbite, maturite, double_pol, ...}
   * @param {object} d      passage choisi (entrée de M.dates)
   * @param {object} opts   {surfaceKm2, kind, prevision} — prevision:false évite le calcul des prévisions (analyses en lot)
   */
  function analyser(zone, serie, d, opts = {}) {
    serie = completer(serie);
    const evals = ORDRE.map(id => evaluer(id, serie, d, opts.surfaceKm2));
    const previsions = opts.prevision !== false && typeof Prediction !== 'undefined' ? Prediction.toutes(serie, d, IND, ORDRE, opts.surfaceKm2, zone) : null;
    const ok = evals.filter(e => e.exploitable);
    const constats = ok.map(e => constat(e, zone, d))
      .sort((a, b) => POIDS[b.niveau] - POIDS[a.niveau] || b.conf.score - a.conf.score);
    const inconnues = evals.filter(e => !e.exploitable).map(e => ({ id: e.id, libelle: e.libelle, raisons: e.raisons }));
    const top = constats.find(c => c.niveau === 'alerte' || c.niveau === 'attention');
    const confGlobale = ok.length ? ok.reduce((s, e) => s + e.conf.score, 0) / ok.length : 0;
    const verdict = !ok.length
      ? { niveau: 'inconnu', titre: T(`Pas assez d’informations fiables ${a(zone)}`, `Pas assez de données exploitables ${a(zone)}`), texte: T('Ce jour-là, le satellite n’a rien mesuré de fiable ici : SAJE Field préfère ne rien affirmer.', 'Aucun indicateur ne remplit les conditions de qualité pour ce passage : SAJE Field préfère ne rien conclure.') }
      : top
        ? { niveau: top.niveau, titre: top.titre, texte: top.texte }
        : { niveau: 'normal', titre: `Rien d’inhabituel ${a(zone)}`, texte: T(`Tout ce que le satellite a pu mesurer le ${F(d.date)} ressemble à d’habitude.`, `Les ${ok.length} indicateurs exploitables du ${F(d.date)} restent dans la normale ${de(zone)}.`) };
    if (d.maturite === 'BETA') verdict.texte += T(' Mesure d’essai : à confirmer.', ' Passage bêta non calibré : conclusion à confirmer.');
    return {
      zone, date: d, evals, constats, inconnues, verdict,
      confiance: { score: confGlobale, niveau: confGlobale >= 0.75 ? 'bonne' : confGlobale >= 0.5 ? 'moyenne' : 'faible' },
      recommandations: recommandations(constats, zone, d, opts.kind, previsions),
      previsions,
      exploitables: ok.length, total: evals.length,
    };
  }

  /** Classement des zones suivies pour un passage (points d'attention de la province). */
  function classer(zones, d) {
    return zones.map(z => {
      const a = analyser(z.nom, z.serie, d, { surfaceKm2: z.surface });
      const pire = a.constats[0];
      const score = pire ? POIDS[pire.niveau] * 10 + Math.min(9, Math.abs(pire.z || 0)) * pire.conf.score : -1;
      return { zone: z.nom, analyse: a, score, constat: pire };
    }).sort((a, b) => b.score - a.score);
  }

  /** Matrice d'exploitabilité (indicateur × passage) pour la page Sources & qualité. */
  function matrice(serie, dates) {
    serie = completer(serie);
    return ORDRE.map(id => ({ id, libelle: IND[id].libelle, cases: dates.map(d => {
      const e = evaluer(id, serie, d, null);
      return { date: d.date, ok: e.exploitable, niveau: e.exploitable ? e.conf.niveau : null, raison: e.raisons[0] || '' };
    }) }));
  }

  return { IND, ORDRE, analyser, evaluer, classer, matrice, normale, completer, a, de, court };
})();
