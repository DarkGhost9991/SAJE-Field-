/* =====================================================================
   SAJE Field — carte interactive d'arrivée (« observatoire »)
   ---------------------------------------------------------------------
   • Fond du monde entier, hors ligne (Natural Earth embarqué), dessiné
     sur canevas pour rester fluide au zoom ; satellite en option.
   • La province est couverte de cercles (secteurs de 7, 14 ou 28 km)
     ou des zones suivies (cercles de même surface que la zone).
   • À chaque module ou passage, le moteur de raisonnement analyse en
     arrière-plan chaque cercle à partir des seules données exploitables,
     puis la carte le colore selon la conclusion.
   • Survol : info-bulle courte. Clic : fiche complète. Puis le tableau
     de bord pour aller plus loin.
   • Deux modes : Simple (mots de tous les jours) et Analyste (chiffres,
     écarts z, tableaux, exports).
   ===================================================================== */
(() => {
  'use strict';
  const APP = window.SAJE_APP;
  const M = Donnees.M;
  if (!APP || !M || !window.L) return;
  const R = Raisonnement;
  const { ico, esc, spark, badgeConf, F, N, toast, remplirIcones } = APP.outils;
  const $ = id => document.getElementById(id);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const AN = () => Donnees.analyste();
  const LM = m => Donnees.libMaturite(m), LP = d => Donnees.libPol(d);
  const B = M.bornes_leaflet;
  const ZMAX = 12;

  // ------------------------------------------------------------------ modules
  const MODULES = [
    { id: 'inondation', nom: 'Inondations', icone: 'waves', image: 'inondation', question: 'Y a-t-il de l’eau là où il n’y en a pas d’habitude ?' },
    { id: 'vegetation_inondee', nom: 'Eau sous la végétation', icone: 'drop', image: 'vegetation_inondee', question: 'L’eau se cache-t-elle sous la mangrove ou la forêt ?' },
    { id: 'eau', nom: 'Eau libre', icone: 'waves', image: 'eau', question: 'Y a-t-il plus ou moins d’eau libre que d’habitude ?' },
    { id: 'vegetation', nom: 'Végétation', icone: 'leaf', image: 'vegetation', question: 'La végétation est-elle plus dense ou plus clairsemée que d’habitude ?' },
    { id: 'anomalie', nom: 'Changements de surface', icone: 'radar', image: 'anomalie', question: 'Le sol a-t-il changé : plus humide, plus sec, coupé, récolté ?' },
    { id: 'humidite', nom: 'Humidité du sol', icone: 'drop', image: 'humidite', question: 'Les sols sont-ils secs, humides ou gorgés d’eau ?' },
  ];
  const mod = id => MODULES.find(m => m.id === id);

  // classes de couleur, du plus préoccupant au moins informatif
  const CLASSES = {
    alerte: { col: '#ef4444', op: 0.6, s: 'Alerte', a: 'Alerte' },
    attention: { col: '#f59e0b', op: 0.52, s: 'À surveiller', a: 'À surveiller' },
    ecart: { col: '#38bdf8', op: 0.45, s: 'Un peu différent, sans danger', a: 'Écart sans risque, ou confiance faible' },
    normal: { col: '#22c55e', op: 0.07, s: 'Comme d’habitude', a: 'Dans la normale (|z| < 2)' },
    inconnu: { col: '#a78bfa', op: 0.35, s: 'Pas encore de comparaison possible', a: 'Mesuré, normale impossible (< 4 passages)' },
    na: { col: '#7d8aa0', op: 0, s: 'Pas d’information fiable', a: 'Non exploitable' },
  };
  const libCl = k => AN() ? CLASSES[k].a : CLASSES[k].s;
  const courtCl = k => ({ alerte: 'Alerte', attention: 'À surveiller', ecart: AN() ? 'Écart' : 'Un peu différent', normal: AN() ? 'Normal' : 'Comme d’habitude', inconnu: 'Sans comparaison', na: AN() ? 'Non exploitable' : 'Pas d’info fiable' }[k]);
  const ORDRE_CL = ['alerte', 'attention', 'ecart', 'inconnu', 'normal', 'na'];
  const POIDS = { alerte: 5, attention: 4, ecart: 3, inconnu: 1, normal: 0, na: -1 };

  function classer(a, id) {
    const e = a?.evals.find(x => x.id === id);
    if (!e || !e.exploitable) return 'na';
    if (e.etat === 'inconnu') return 'inconnu';
    const c = a.constats.find(x => x.id === id);
    if (!c) return 'na';
    if (c.niveau === 'alerte' || c.niveau === 'attention') return c.niveau;
    if (c.niveau === 'normal' || e.etat === 'normal') return 'normal';
    return 'ecart';
  }
  /** Couleur continue de l'écart z (mode analyste) : bleu (plus bas) → gris → rouge (plus haut). */
  function couleurZ(z) {
    const t = Math.max(-1, Math.min(1, z / 4));
    const mix = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
    const neutre = [203, 213, 225], bleu = [37, 99, 235], rouge = [220, 38, 38];
    const [r, g, b] = t < 0 ? mix(neutre, bleu, -t) : mix(neutre, rouge, t);
    return `rgb(${r},${g},${b})`;
  }

  // ------------------------------------------------------------------ état
  const O = {
    module: 'inondation', date: M.dates.at(-1), decoupe: 'secteurs', taille: 14, couleur: 'conclusion',
    image: null, sat: false, unites: [], grilles: {}, zones: null, resultats: new Map(), choisie: null, interagi: false, pret: false,
    comparer: false, avant: null, placer: 'apres', lecture: null, legende: false,
  };
  try { O.legende = localStorage.getItem('saje_legende') === '1'; } catch (e) { /* stockage indisponible */ }
  const cle = d => `${d.date}|${d.orbite}|${O.decoupe}|${O.taille}|${AN() ? 'a' : 's'}`;

  // ------------------------------------------------------------------ carte du monde
  const div = $('obsMap');
  const carte = L.map(div, { minZoom: 2, maxZoom: ZMAX, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, keyboard: true, zoomControl: false,
    maxBounds: [[-85, -200], [85, 200]], maxBoundsViscosity: 0.8, fadeAnimation: !reduit, zoomAnimation: !reduit });
  L.control.zoom({ position: 'bottomright', zoomInTitle: 'Zoomer', zoomOutTitle: 'Dézoomer' }).addTo(carte);
  L.control.scale({ position: 'bottomright', imperial: false }).addTo(carte);
  carte.attributionControl.setPrefix(false);
  carte.attributionControl.addAttribution('Fond : Natural Earth · Radar : NASA-ISRO NISAR (ASF DAAC) · Analyse : SAJE Field');
  [['monde', 200], ['sat', 210], ['radar', 300], ['contour', 380], ['unites', 420], ['labels', 460], ['marque', 480]]
    .forEach(([n, z]) => { carte.createPane(n).style.zIndex = z; });
  carte.getPane('labels').style.pointerEvents = 'none';
  carte.fitWorld({ animate: false });

  // fond du monde sur canevas : beaucoup plus léger qu'en SVG au zoom fort
  const couleurs = () => {
    const cs = getComputedStyle($('page-carte'));
    const v = k => cs.getPropertyValue(k).trim();
    return { land: v('--land'), line: v('--land-line'), gabon: v('--gabon'), gline: v('--gabon-line') };
  };
  const rendu = L.canvas({ padding: 0.3, pane: 'monde' });
  let monde = null;
  const styleMonde = f => { const c = couleurs(), g = f.properties.n === 'Gabon';
    return { renderer: rendu, fillColor: g ? c.gabon : c.land, fillOpacity: O.sat ? 0 : 1, color: g ? c.gline : c.line, weight: g ? 1.3 : 0.6, opacity: O.sat ? 0.5 : 1 }; };
  if (window.SAJE_MONDE) monde = L.geoJSON(window.SAJE_MONDE, { pane: 'monde', interactive: false, renderer: rendu, smoothFactor: 1.5, style: styleMonde }).addTo(carte);
  L.polyline([[0, -180], [0, 180]], { pane: 'monde', renderer: rendu, interactive: false, color: '#64748b', opacity: 0.35, weight: 1, dashArray: '4 6' }).addTo(carte);

  // repères géographiques en français, selon le zoom
  const REPERES = [
    ['Afrique', 6, 20, 2, 4.5, 'continent'], ['Europe', 50, 15, 2, 4.5, 'continent'], ['Asie', 45, 90, 2, 4.5, 'continent'],
    ['Amérique du Nord', 45, -100, 2, 4.5, 'continent'], ['Amérique du Sud', -15, -60, 2, 4.5, 'continent'], ['Océanie', -25, 135, 2, 4.5, 'continent'],
    ['Océan Atlantique', 5, -28, 2, 6, 'ocean'], ['Océan Indien', -20, 75, 2, 6, 'ocean'], ['Océan Pacifique', 0, -150, 2, 6, 'ocean'],
    ['Golfe de Guinée', 1.8, 4.2, 5, 9, 'ocean'],
    ['GABON', -1.2, 11.7, 4.5, 8.5, 'pays-lbl fort'], ['CAMEROUN', 5.4, 12.4, 5, 9, 'pays-lbl'], ['GUINÉE ÉQUATORIALE', 1.55, 10.6, 6, 9.5, 'pays-lbl'],
    ['CONGO', -0.9, 15.3, 5, 9, 'pays-lbl'], ['SÃO TOMÉ-ET-PRÍNCIPE', 0.9, 6.9, 6, 9.5, 'pays-lbl'], ['NIGERIA', 9.2, 8.2, 5, 8, 'pays-lbl'],
    ['RD CONGO', -2.8, 23, 5, 8, 'pays-lbl'], ['CENTRAFRIQUE', 6.6, 20.4, 5, 8, 'pays-lbl'], ['ANGOLA', -12, 17.5, 5, 8, 'pays-lbl'],
  ];
  const reperes = REPERES.map(([t, la, lo, zmin, zmax, cls]) => ({ zmin, zmax,
    m: L.marker([la, lo], { pane: 'labels', interactive: false, keyboard: false, icon: L.divIcon({ className: 'geo-lbl ' + cls, html: `<span>${t}</span>`, iconSize: null }) }) }));
  const LIEUX_ = typeof LIEUX !== 'undefined' ? LIEUX : [];
  const groupeVilles = L.layerGroup(LIEUX_.map(([n, la, lo, type, sens]) =>
    L.marker([la, lo], { pane: 'labels', interactive: false, keyboard: false, icon: L.divIcon({ className: 'place-dot', iconSize: [7, 7] }) })
      .bindTooltip(n, { permanent: true, direction: sens || 'right', offset: [sens ? -4 : 4, 0], className: type === 'ville' ? 'city-label' : 'place-label', pane: 'labels' })));

  // emprise NISAR + contour de la province
  const contourProv = (M.zones?.features || []).filter(f => f.properties.masque_terre);
  L.geoJSON({ type: 'FeatureCollection', features: contourProv }, { pane: 'contour', interactive: false, style: { className: 'contour-prov', weight: 2, fill: false } }).addTo(carte);

  // balise visible de loin
  const balise = L.marker(L.latLngBounds(B).getCenter(), { pane: 'marque', keyboard: true, title: 'Province de l’Estuaire : zone analysée par SAJE Field',
    icon: L.divIcon({ className: 'balise', html: '<span class="b-ring"></span><span class="b-ring r2"></span><span class="b-core"></span><span class="b-lbl">Zone analysée · Estuaire, Gabon</span>', iconSize: [22, 22], iconAnchor: [11, 11] }) });
  balise.on('click', () => allerEstuaire());

  // image radar du module : affichée d'office quand on zoome fort (détail à 80 m)
  // deux couches : l'image radar complète (fond, pour garder du détail) et la carte du module par-dessus
  const imgs = { fond: null, module: null };
  const zoomDetail = () => carte.getZoom() >= 9.5;
  const imageVisible = () => O.image ?? zoomDetail();
  function poser(cle, u, op) {
    const l = imgs[cle];
    if (l && l._url === u) return;
    if (l) { l.setOpacity(0); setTimeout(() => carte.removeLayer(l), 400); imgs[cle] = null; }
    if (u) {
      const n = imgs[cle] = L.imageOverlay(u, B, { pane: 'radar', opacity: 0, interactive: false, className: 'img-radar', zIndex: cle === 'fond' ? 1 : 2 }).addTo(carte);
      requestAnimationFrame(() => requestAnimationFrame(() => n.setOpacity(op)));
    }
  }
  function majImage() {
    const m = mod(O.module), vis = imageVisible(), d = O.date;
    const fond = d.images?.rgb || d.images?.hh || M.dates.slice().reverse().find(x => x.images?.rgb)?.images.rgb;
    poser('fond', vis ? Donnees.url(fond) : null, 0.75);
    poser('module', vis && m.image !== 'rgb' ? Donnees.url(d.images?.[m.image]) : null, 0.95);
    $('obsImage').setAttribute('aria-checked', String(vis));
    $('obsImage').querySelector('small').textContent = O.image == null ? 'Automatique quand on zoome' : vis ? 'Toujours affichée' : 'Masquée';
  }

  // fond satellite si Internet répond
  let sat = null;
  function majSat() {
    if (O.sat && !sat) sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { pane: 'sat', maxZoom: 18, attribution: 'Satellite : Esri' }).addTo(carte);
    if (!O.sat && sat) { carte.removeLayer(sat); sat = null; }
    monde?.setStyle(styleMonde);
    $('obsSat').setAttribute('aria-checked', String(O.sat));
  }

  // ------------------------------------------------------------------ cercles d'analyse
  const groupe = L.layerGroup();
  // cercles dessinés sur canevas : fluide même avec 500 cercles et au zoom fort
  const renduUnites = L.canvas({ pane: 'unites', padding: 0.2, tolerance: 2 });
  const LETTRES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function lieuProche(lat, lon) {
    let best = null, dmin = Infinity;
    LIEUX_.forEach(([n, la, lo]) => {
      const d = Math.hypot((la - lat) * Donnees.KM_LAT, (lo - lon) * Donnees.kmLon(lat));
      if (d < dmin) { dmin = d; best = n; }
    });
    if (!best) return '';
    const de = /^[AEIOUYÉ]/.test(best) ? `d’${best}` : `de ${best}`;
    return dmin < 6 ? `à ${best}` : dmin < 25 ? `près ${de}` : `à ${Math.round(dmin / 5) * 5} km ${de}`;
  }
  /** Pixels du cube dont le centre est dans le cercle. */
  function pixelsCercle(c, lat, lon, rKm) {
    const kx = Donnees.kmLon(lat), ky = Donnees.KM_LAT;
    const x0 = Math.max(0, Math.floor((lon - rKm / kx - c.ouest) / c.pas)), x1 = Math.min(c.nx - 1, Math.ceil((lon + rKm / kx - c.ouest) / c.pas));
    const y0 = Math.max(0, Math.floor((c.nord - (lat + rKm / ky)) / c.pas)), y1 = Math.min(c.ny - 1, Math.ceil((c.nord - (lat - rKm / ky)) / c.pas));
    const ids = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = c.ouest + (x + 0.5) * c.pas, py = c.nord - (y + 0.5) * c.pas;
      if (Math.hypot((px - lon) * kx, (py - lat) * ky) <= rKm) ids.push(y * c.nx + x);
    }
    return ids;
  }
  const serieDe = ids => M.dates.map(d => Analyse.stats(ids, d)).filter(p => p && p.pixels > 0);

  async function grille(taille) {
    if (O.grilles[taille]) return O.grilles[taille];
    const c = Analyse.metadata(), r = taille / 2;
    const dy = taille * Math.sqrt(3) / 2;               // rangées en quinconce (nid d'abeille)
    const sud = c.nord - c.ny * c.pas, est = c.ouest + c.nx * c.pas;
    const lignes = Math.ceil((c.nord - sud) * Donnees.KM_LAT / dy) + 1;
    const out = [];
    for (let j = 0; j < lignes; j++) {
      const lat = c.nord - (r + j * dy) / Donnees.KM_LAT;
      const kx = Donnees.kmLon(lat);
      const decal = j % 2 ? taille / 2 : 0;
      for (let i = 0; ; i++) {
        const lon = c.ouest + (r + decal + i * taille) / kx;
        if (lon - r / kx > est) break;
        const ids = pixelsCercle(c, lat, lon, r);
        if (!ids.length) continue;
        const serie = serieDe(ids);
        const maxPix = Math.max(0, ...serie.map(p => p.pixels));
        if (!serie.length || maxPix < ids.length * 0.2) continue;
        const code = `${LETTRES[j] || 'Z' + j}${i + 1}`;
        out.push({ type: 'secteur', code, nom: `Secteur ${code}`, lieu: lieuProche(lat, lon), lat, lon, r, ids, serie,
          surface: Math.max(...serie.map(p => p.surface_observee_km2 || 0)), ordre: (lon - c.ouest) / (est - c.ouest) });
      }
      afficherProgression(true, 'Préparation des données NISAR…', `Placement des cercles de ${taille} km (${out.length})`, (j + 1) / lignes * 0.5);
      await pause();
    }
    out.forEach(creerCalque);
    return (O.grilles[taille] = out);
  }
  function zonesSuivies() {
    if (O.zones) return O.zones;
    const c = Analyse.metadata();
    O.zones = Donnees.zonesSuivies().filter(f => f.properties.cercle).map(f => {
      const { lat, lon, r } = f.properties.cercle, ids = pixelsCercle(c, lat, lon, r), serie = serieDe(ids);
      return { type: 'zone', nom: f.properties.nom, code: '', lieu: '', lat, lon, r, ids, serie, surface: Math.max(0, ...serie.map(p => p.surface_observee_km2 || 0)), ordre: (lon - B[0][1]) / (B[1][1] - B[0][1]) };
    }).filter(u => u.serie.length);
    O.zones.forEach(creerCalque);
    return O.zones;
  }
  const pause = () => new Promise(r => setTimeout(r, 0));
  const boiteCercle = u => [[u.lat - u.r / Donnees.KM_LAT, u.lon - u.r / Donnees.kmLon(u.lat)], [u.lat + u.r / Donnees.KM_LAT, u.lon + u.r / Donnees.kmLon(u.lat)]];

  function creerCalque(u) {
    const l = L.circle([u.lat, u.lon], { radius: u.r * 1000, pane: 'unites', renderer: renduUnites, weight: 1, color: CLASSES.na.col, fillColor: CLASSES.na.col, fillOpacity: 0 });
    u.calque = l;
    l.bindTooltip(() => bulle(u), { sticky: true, direction: 'top', offset: [0, -12], className: 'obs-tip', opacity: 1 });
    l.on('mouseover', () => { l.setStyle({ weight: 3, color: '#ffffff' }); l.bringToFront(); });
    l.on('mouseout', () => { if (O.choisie !== u) peindre(u); });
    l.on('click', e => { L.DomEvent.stopPropagation(e); l.closeTooltip(); ouvrirFiche(u); });
  }

  // ------------------------------------------------------------------ raisonnement en arrière-plan
  let jeton = 0, fondJeton = 0;
  const reglage = () => `${O.decoupe}|${O.taille}|${AN() ? 'a' : 's'}`;
  async function analyserPassage(d, ui = true) {
    const k = cle(d);
    if (O.resultats.has(k)) return O.resultats.get(k);
    const moi = jeton, res = new Map(), t0 = performance.now(), lot = 24;
    for (let i = 0; i < O.unites.length; i += lot) {
      for (const u of O.unites.slice(i, i + lot)) res.set(u.nom, R.analyser(u.nom, u.serie, d, { surfaceKm2: u.surface, prevision: false }));
      if (ui) afficherProgression(true, 'L’algorithme analyse les données…', `${Math.min(O.unites.length, i + lot)} / ${O.unites.length} zones · passage du ${F(d.date)}`, 0.5 + 0.5 * Math.min(1, (i + lot) / O.unites.length));
      await pause();
      if (moi !== jeton) return null;
    }
    const reste = 420 - (performance.now() - t0);   // laisser voir l'étape, sans la rallonger au-delà de 0,4 s
    if (ui && !O.lecture && reste > 0 && !reduit) await new Promise(r => setTimeout(r, reste));
    O.resultats.set(k, res);
    return res;
  }
  /** Analyse de tous les passages en tâche de fond : la frise montre l'évolution, la lecture devient instantanée. */
  async function precalculer() {
    const moi = ++fondJeton, r = reglage();
    const attendre = () => new Promise(ok => (window.requestIdleCallback ? requestIdleCallback(ok, { timeout: 400 }) : setTimeout(ok, 30)));
    for (const d of [...M.dates].reverse()) {
      if (O.resultats.has(cle(d))) continue;
      await attendre();
      if (moi !== fondJeton || r !== reglage()) return;
      const res = new Map(), unites = O.unites;
      for (let i = 0; i < unites.length; i += 30) {
        unites.slice(i, i + 30).forEach(u => res.set(u.nom, R.analyser(u.nom, u.serie, d, { surfaceKm2: u.surface, prevision: false })));
        await attendre();
        if (moi !== fondJeton || r !== reglage() || unites !== O.unites) return;
      }
      O.resultats.set(cle(d), res);
      majFrise();
    }
  }
  function afficherProgression(on, titre, texte, p) {
    $('obsProgress').hidden = !on;
    $('obsScan').hidden = !on || reduit;
    if (!on) return;
    $('obsProgTitle').textContent = titre;
    $('obsProgText').textContent = texte;
    $('obsProgBar').style.width = Math.round((p || 0) * 100) + '%';
    placerScan();
  }
  function placerScan() {
    const el = $('obsScan'); if (el.hidden) return;
    const a = carte.latLngToContainerPoint([B[1][0], B[0][1]]), b = carte.latLngToContainerPoint([B[0][0], B[1][1]]);
    Object.assign(el.style, { left: a.x + 'px', top: a.y + 'px', width: Math.max(0, b.x - a.x) + 'px', height: Math.max(0, b.y - a.y) + 'px' });
  }

  // ------------------------------------------------------------------ comparaison de deux passages
  const CMP = {
    hausse_forte: { col: '#dc2626', op: 0.6, lib: 'Nette hausse' },
    hausse: { col: '#fb923c', op: 0.5, lib: 'Hausse' },
    stable: { col: '#22c55e', op: 0.07, lib: 'Pas de changement net' },
    baisse: { col: '#60a5fa', op: 0.5, lib: 'Baisse' },
    baisse_forte: { col: '#1d4ed8', op: 0.62, lib: 'Nette baisse' },
    na: { col: '#7d8aa0', op: 0, lib: 'Comparaison impossible' },
  };
  const ORDRE_CMP = ['hausse_forte', 'hausse', 'baisse', 'baisse_forte', 'stable', 'na'];
  function comparerUnite(u) {
    const id = O.module;
    const eA = u.analyseA?.evals.find(x => x.id === id), eB = u.analyse?.evals.find(x => x.id === id);
    const essai = [O.avant, O.date].find(d => d.maturite === 'BETA');
    if (essai) return { cl: 'na', eA, eB, raison: AN() ? `${F(essai.date)} : passage bêta non calibré, pas comparable aux passages calibrés.` : `${F(essai.date)} : donnée d’essai, pas assez fiable pour comparer.` };
    if (!eA?.exploitable || !eB?.exploitable) {
      const raison = !eA?.exploitable ? `${F(O.avant.date)} : ${eA?.raisons[0] || 'pas de mesure'}` : `${F(O.date.date)} : ${eB?.raisons[0] || 'pas de mesure'}`;
      return { cl: 'na', raison, eA, eB };
    }
    const ind = eB.ind, delta = eB.valeur - eA.valeur;
    const sigma = eB.normale.ok ? eB.normale.sigma : eA.normale.ok ? eA.normale.sigma : null;
    const seuil = Math.max(ind.effetMin, sigma ? 2 * sigma : ind.effetMin * 2), fort = Math.max(ind.effetMin * 2, sigma ? 3.5 * sigma : ind.effetMin * 4);
    const cl = Math.abs(delta) < seuil ? 'stable' : delta > 0 ? (delta >= fort ? 'hausse_forte' : 'hausse') : (delta <= -fort ? 'baisse_forte' : 'baisse');
    return { cl, eA, eB, delta, zd: sigma ? delta / sigma : null, km2: ind.unite === 'pct' && u.surface ? u.surface * delta / 100 : null, seuil };
  }
  const motCourt = id => id === 'anomalie' && !AN() ? 'écho radar' : R.IND[id].court;
  const deMot = c => /^[aeéèêiouyh]/i.test(c) ? `d’${c}` : `de ${c}`;
  function phraseCmp(c) {
    const m = motCourt(O.module), quand = `qu’au ${F(O.avant.date)}`;
    if (c.cl === 'na') return 'Comparaison impossible';
    if (c.cl === 'stable') return `Pas de changement net depuis le ${F(O.avant.date)}`;
    const plus = c.delta > 0;
    return `${/forte/.test(c.cl) ? 'Nettement ' : ''}${plus ? (/forte/.test(c.cl) ? 'plus' : 'Plus') : (/forte/.test(c.cl) ? 'moins' : 'Moins')} ${deMot(m)} ${quand}`;
  }
  const valSimple = e => e.km2 != null ? (Math.abs(e.km2) < 0.05 ? 'presque rien' : `environ ${km2(e.km2)}`) : null;
  function mesureCmp(c) {
    if (c.cl === 'na') return c.raison;
    const ind = c.eB.ind;
    if (AN()) return `${uni(ind, c.eA.valeur)} → ${uni(ind, c.eB.valeur)} · Δ ${c.delta > 0 ? '+' : ''}${uni(ind, c.delta)}${c.zd != null ? ` · Δ/σ ${N(c.zd, 1)}` : ''}${c.km2 != null ? ` · ${c.km2 > 0 ? '+' : ''}${km2(c.km2)}` : ''}`;
    const a = valSimple(c.eA), b = valSimple(c.eB);
    return a && b ? `${F(O.avant.date)} : ${a} · ${F(O.date.date)} : ${b}` : '';
  }

  // ------------------------------------------------------------------ coloration
  /** Plus on zoome, plus le remplissage s'efface pour laisser voir l'image radar. */
  const facteurZoom = () => { const z = carte.getZoom(); return z < 9 ? 1 : z >= 11 ? 0.3 : 1 - (z - 9) * 0.35; };
  const palette = () => O.comparer ? CMP : CLASSES;
  function couleurDe(u) {
    const cl = u.classe || 'na';
    if (O.comparer) return CMP[cl].col;
    if (O.couleur === 'z' && AN() && cl !== 'na' && cl !== 'inconnu') {
      const e = u.analyse?.evals.find(x => x.id === O.module);
      if (e?.z != null) return couleurZ(e.z);
    }
    return CLASSES[cl].col;
  }
  function peindre(u) {
    const cl = u.classe || 'na', c = palette()[cl] || CLASSES.na, col = couleurDe(u), choisie = O.choisie === u;
    const op = (!O.comparer && O.couleur === 'z' && AN() && cl !== 'na' ? 0.6 : c.op) * facteurZoom();
    const discret = cl === 'na' || cl === 'normal' || cl === 'stable';
    u.calque.setStyle({ fillColor: col, fillOpacity: op, color: choisie ? '#ffffff' : col, weight: choisie ? 3 : discret ? 0.8 : 1.6,
      opacity: choisie ? 1 : cl === 'na' ? 0.3 : discret ? 0.35 : 0.95, dashArray: cl === 'na' ? '2 4' : null });
  }
  const repeindre = () => O.unites.forEach(u => u.classe && peindre(u));
  /** Apparition par vagues d'ouest en est (6 vagues, pas une animation par cercle). */
  let vagues = [];
  function peindreEnVagues() {
    vagues.forEach(clearTimeout); vagues = [];
    if (reduit || O.lecture) return repeindre();
    for (let k = 0; k < 6; k++) vagues.push(setTimeout(() => O.unites.forEach(u => { if (Math.min(5, Math.floor(u.ordre * 6)) === k) peindre(u); }), k * 110));
  }

  async function majAnalyse() {
    const moi = ++jeton;
    if (!O.pret) return;
    majOutils();
    const nouvelles = O.decoupe === 'secteurs' ? await grille(O.taille) : zonesSuivies();
    if (moi !== jeton) return;
    if (nouvelles !== O.unites) {
      if (O.choisie && !nouvelles.includes(O.choisie)) fermerFiche();
      groupe.clearLayers(); nouvelles.forEach(u => groupe.addLayer(u.calque)); O.unites = nouvelles;
      fondJeton++;
    }
    const resB = await analyserPassage(O.date);
    if (moi !== jeton || !resB) return;
    const resA = O.comparer ? await analyserPassage(O.avant) : null;
    if (moi !== jeton || (O.comparer && !resA)) return;
    afficherProgression(false);
    O.unites.forEach(u => {
      u.analyse = resB.get(u.nom);
      if (O.comparer) { u.analyseA = resA.get(u.nom); u.cmp = comparerUnite(u); u.classe = u.cmp.cl; }
      else { u.analyseA = null; u.cmp = null; u.classe = classer(u.analyse, O.module); }
    });
    peindreEnVagues();
    afficherLegende(); afficherClassement(); afficherBandeau(); majFrise();
    if (O.choisie) remplirFiche(O.choisie);
    div.dataset.etat = 'prete';
    precalculer();
  }

  // ------------------------------------------------------------------ textes
  const uni = (ind, v) => v == null ? '—' : ind.unite === 'pct' ? `${N(v)} %` : ind.unite === 'dB' ? `${N(v)} dB` : `${N(v, 3)} m³/m³`;
  const km2 = k => k == null ? '' : `${N(k, Math.abs(k) < 10 ? 1 : 0)} km²`;
  function resume(u, id = O.module) {
    const a = u.analyse, e = a?.evals.find(x => x.id === id), c = a?.constats.find(x => x.id === id);
    if (!e) return { titre: 'Analyse en cours…', mesure: '', cl: 'na' };
    if (!e.exploitable) return { titre: AN() ? 'Indicateur non exploitable' : 'Pas d’information fiable ce jour-là', mesure: e.raisons[0] || '', cl: 'na', e };
    const ind = e.ind;
    let mesure;
    if (AN()) {
      mesure = ind.unite === 'pct' && e.km2 != null ? `${km2(e.km2)} (${uni(ind, e.valeur)})` : uni(ind, e.valeur);
      if (e.normale.ok) mesure += ` · médiane ${uni(ind, e.normale.mediane)} · σ ${uni(ind, e.normale.sigma)} · z ${N(e.z, 1)} · n ${e.normale.n}`;
    } else mesure = c?.preuve || '';
    return { titre: c?.titre || 'Mesuré', texte: c?.texte || '', mesure, cl: classer(a, id), e, c };
  }
  const nomComplet = u => u.type === 'secteur' ? `${u.nom}${u.lieu ? ' · ' + u.lieu : ''}` : u.nom;
  const libClasse = cl => O.comparer ? CMP[cl].lib : courtCl(cl);

  function bulle(u) {
    const col = couleurDe(u);
    if (O.comparer && u.cmp) {
      const c = u.cmp;
      return `<div class="tip-in ${AN() ? 'an' : ''}"><span class="tip-k" style="--c:${col}">${esc(CMP[c.cl].lib)}</span>
        <strong>${esc(nomComplet(u))}</strong><span class="tip-t">${esc(phraseCmp(c))}</span>
        ${mesureCmp(c) ? `<span class="tip-m">${esc(mesureCmp(c))}</span>` : ''}
        <span class="tip-hint">${AN() ? 'Clic : fiche détaillée' : 'Touchez ou cliquez pour en savoir plus'}</span></div>`;
    }
    const r = resume(u);
    return `<div class="tip-in ${AN() ? 'an' : ''}"><span class="tip-k" style="--c:${col}">${esc(courtCl(r.cl))}</span>
      <strong>${esc(nomComplet(u))}</strong>
      <span class="tip-t">${esc(r.titre)}</span>
      ${r.mesure ? `<span class="tip-m">${esc(r.mesure)}</span>` : ''}
      ${r.e?.conf ? `<span class="tip-c">${esc(r.e.conf.libelle)}</span>` : ''}
      <span class="tip-hint">${AN() ? 'Clic : fiche détaillée' : 'Touchez ou cliquez pour en savoir plus'}</span></div>`;
  }

  // ------------------------------------------------------------------ légende rétractable
  function afficherLegende() {
    const m = mod(O.module), z = O.couleur === 'z' && AN() && !O.comparer;
    const pal = palette(), ordre = O.comparer ? ORDRE_CMP : ORDRE_CL;
    const comptes = Object.fromEntries(ordre.map(k => [k, 0]));
    O.unites.forEach(u => { if (u.classe in comptes) comptes[u.classe]++; });
    const lib = k => O.comparer ? pal[k].lib : libCl(k);
    const titre = O.comparer ? `${m.nom} · ${F(O.avant.date)} → ${F(O.date.date)}` : `${m.nom} · ${F(O.date.date)}`;
    const puces = ordre.filter(k => comptes[k]).map(k => `<span class="lg-chip" title="${esc(lib(k))}"><i style="background:${pal[k].col}"></i>${comptes[k]}</span>`).join('');
    $('obsLgToggle').innerHTML = `<span class="lg-t"><small>Légende</small><b>${esc(titre)}</b></span><span class="lg-chips">${z ? '<span class="lg-chip"><i class="ramp"></i>z</span>' : puces}</span>${ico('chevron', 16)}`;
    $('obsLgToggle').setAttribute('aria-expanded', String(O.legende));
    $('obsLegend').classList.toggle('ouverte', O.legende);
    $('obsLgBody').hidden = !O.legende;
    const ind = R.IND[O.module], total = O.unites.length;
    const lignes = z
      ? `<div class="lg-ramp" style="background:linear-gradient(90deg,${couleurZ(-4)},${couleurZ(0)},${couleurZ(4)})"></div>
         <div class="lg-ends"><span>z ≤ −4 · plus bas</span><span>0</span><span>plus haut · z ≥ 4</span></div>
         ${['inconnu', 'na'].map(k => `<div class="lg-row ${comptes[k] ? '' : 'zero'}"><span class="sw" style="background:${CLASSES[k].col}"></span><span>${libCl(k)}</span><b>${comptes[k]}</b></div>`).join('')}`
      : ordre.map(k => `<div class="lg-row ${comptes[k] ? '' : 'zero'}"><span class="sw" style="background:${pal[k].col};opacity:${k === 'na' ? .55 : 1}"></span><span>${lib(k)}</span><b>${comptes[k]}</b></div>`).join('');
    const quoi = O.decoupe === 'secteurs' ? `cercles de ${O.taille} km` : 'zones suivies (cercles de même surface)';
    const note = O.comparer
      ? (AN() ? `${total} ${quoi}. Changement signalé si |Δ| ≥ max(2σ, ${uni(ind, ind.effetMin)}) ; « net » si ≥ 3,5σ. σ = écart robuste de la zone.` : `${total} ${quoi}. Un changement n’est signalé que s’il dépasse les variations habituelles de la zone.`)
      : (AN() ? `${total} ${quoi}. Écart signalé si |z| ≥ 2 et |écart| ≥ ${uni(ind, ind.effetMin)} ; normale = médiane ± 2σ robuste (MAD) des passages calibrés, même orbite.` : `${total} ${quoi} comparés à ce que le satellite voit d’habitude.`);
    $('obsLgBody').innerHTML = `${lignes}<span class="note">${note}</span>`;
  }

  // ------------------------------------------------------------------ classement
  function afficherClassement() {
    const id = O.module;
    let tri;
    if (O.comparer) {
      tri = O.unites.filter(u => u.classe !== 'stable' && u.classe !== 'na').sort((a, b) => Math.abs(b.cmp.zd ?? b.cmp.delta) - Math.abs(a.cmp.zd ?? a.cmp.delta));
      const nS = O.unites.filter(u => u.classe === 'stable').length, nNa = O.unites.filter(u => u.classe === 'na').length;
      $('obsSummary').innerHTML = tri.length
        ? `<b>${tri.length} zone${tri.length > 1 ? 's' : ''}</b> ${tri.length > 1 ? 'ont' : 'a'} changé du ${F(O.avant.date)} au ${F(O.date.date)} · ${nS} sans changement net${nNa ? ` · ${nNa} non comparables` : ''}`
        : nNa === O.unites.length ? 'Comparaison impossible pour ce sujet entre ces deux passages.' : `Pas de changement net : ${nS} zones stables${nNa ? `, ${nNa} non comparables` : ''}.`;
    } else {
      const zDe = u => Math.abs(u.analyse.evals.find(e => e.id === id).z || 0);
      tri = O.unites.filter(u => POIDS[u.classe] >= 3).sort((a, b) => POIDS[b.classe] - POIDS[a.classe] || zDe(b) - zDe(a));
      const nNorm = O.unites.filter(u => u.classe === 'normal').length, nNa = O.unites.filter(u => u.classe === 'na').length;
      const pl = (n, s) => `${n} ${s}${n > 1 ? 's' : ''}`;
      $('obsSummary').innerHTML = tri.length
        ? `<b>${pl(tri.length, 'zone')}</b> ${tri.length > 1 ? 'sortent' : 'sort'} de l’ordinaire · ${nNorm} comme d’habitude${nNa ? ` · ${nNa} sans information fiable` : ''}`
        : nNa === O.unites.length ? 'Aucune information fiable pour ce sujet ce jour-là.' : `Rien d’inhabituel : ${pl(nNorm, 'zone')} comme d’habitude${nNa ? `, ${nNa} sans information fiable` : ''}.`;
    }
    const n = tri.length, pl = n > 1 ? 's' : '';
    $('obsRankTitle').textContent = O.comparer ? (n ? `${n} zone${pl} ${n > 1 ? 'ont' : 'a'} changé` : 'Pas de changement net') : (n ? `${n} zone${pl} à regarder` : 'Rien d’inhabituel');
    $('obsRankList').innerHTML = tri.slice(0, AN() ? 15 : 8).map((u, i) => {
      const titre = O.comparer ? phraseCmp(u.cmp) : resume(u).titre;
      const e = u.analyse.evals.find(x => x.id === id);
      const chiffre = AN() ? (O.comparer ? (u.cmp.zd != null ? `Δ/σ ${N(u.cmp.zd, 1)}` : '') : (e.z != null ? `z ${N(e.z, 1)}` : '')) : (O.comparer && u.cmp.km2 != null && Math.abs(u.cmp.km2) >= 0.05 ? `${u.cmp.km2 > 0 ? '+' : ''}${km2(u.cmp.km2)}` : '');
      return `<li><button class="obs-rank-item" data-u="${esc(u.nom)}" style="--c:${couleurDe(u)}"><span class="n">${i + 1}</span>
        <span><strong>${esc(nomComplet(u))}</strong><span>${esc(titre)}</span></span>${chiffre ? `<span class="z">${chiffre}</span>` : ''}</button></li>`;
    }).join('') || `<li class="muted small obs-rank-empty">Touchez un cercle sur la carte pour lire son analyse.</li>`;
    $('obsExport')?.remove();
    if (AN()) $('obsRankList').insertAdjacentHTML('afterend', `<button class="button small-btn obs-export" id="obsExport">${ico('download', 16)}Exporter toutes les zones (CSV)</button>`);
    $('obsExport')?.addEventListener('click', exporterTout);
    $$('#obsRankList [data-u]').forEach(b => b.onclick = () => { const u = O.unites.find(x => x.nom === b.dataset.u); if (u) { cadrerSur(u); ouvrirFiche(u); } });
  }

  // ------------------------------------------------------------------ bandeau d'explication
  const mesurable = (d, id = O.module) => id !== 'humidite' && (!R.IND[id].besoinHV || d.double_pol);
  function dernierPassagePour(id, sauf) {
    const ind = R.IND[id];
    return [...M.dates].reverse().find(d => d !== sauf && d.maturite !== 'BETA' && mesurable(d, id) && O.unites.some(u => u.serie.some(p => p.date === d.date && p[ind.cle] != null)));
  }
  function afficherBandeau() {
    const el = $('obsBanner'), m = mod(O.module), ind = R.IND[O.module];
    const nNa = O.unites.filter(u => u.classe === 'na').length, partNa = O.unites.length ? nNa / O.unites.length : 1;
    let txt = null, bouton = null;
    if (O.comparer && O.avant === O.date) txt = '<b>Choisissez deux passages différents</b> pour voir ce qui a changé.';
    else if (partNa >= 0.8) {
      if (O.module === 'humidite') txt = AN()
        ? '<b>Humidité du sol : aucune conclusion.</b> Les produits SME2 existent, mais aucun pixel de la province ne passe le contrôle qualité de la NASA. Aucun cercle n’est coloré.'
        : '<b>Humidité du sol : pas de réponse fiable.</b> Le satellite l’a mesurée, mais la NASA juge ces mesures peu fiables ici (forêt dense, pluie). SAJE Field préfère ne rien afficher plutôt qu’un chiffre faux.';
      else {
        const qui = [O.comparer ? O.avant : null, O.date].filter(Boolean).find(d => d.maturite === 'BETA' || !mesurable(d)) || O.date;
        if (ind.besoinHV && !qui.double_pol) txt = AN()
          ? `<b>${esc(m.nom)} : non mesurable le ${F(qui.date)}.</b> Ce passage n’a que la polarisation HH ; il faut HH + HV.`
          : `<b>${esc(m.nom)} : pas visible le ${F(qui.date)}.</b> Ce jour-là, le satellite n’a fait qu’une mesure partielle.`;
        else if (qui.maturite === 'BETA') txt = `<b>${AN() ? 'Passage bêta' : 'Donnée d’essai'} du ${F(qui.date)} :</b> ${AN() ? 'non calibré, l’algorithme ne conclut pas.' : 'pas encore assez fiable pour conclure.'}`;
        else txt = `<b>${esc(m.nom)} :</b> pas assez d’informations fiables ${O.comparer ? 'pour comparer ces deux passages' : 'ce jour-là'}.`;
        const d = dernierPassagePour(O.module, qui);
        if (d) bouton = { txt: O.comparer ? 'Choisir des passages mesurables' : `Voir le ${F(d.date)}`, fn: () => {
          if (!O.comparer) return choisirDate(d);
          const ok = M.dates.filter(x => x.maturite !== 'BETA' && mesurable(x));
          O.avant = ok[0]; O.date = ok.at(-1); majAnalyse();
        } };
      }
    }
    el.hidden = !txt;
    if (!txt) return;
    el.innerHTML = `${ico('info')}<span>${txt}</span>${bouton ? `<button class="button small-btn primary" id="obsJump">${esc(bouton.txt)}</button>` : ''}`;
    if (bouton) $('obsJump').onclick = bouton.fn;
  }

  // ------------------------------------------------------------------ exports (mode analyste)
  const csv = (lignes, nom) => {
    const fmt = v => v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000).replace('.', ',') : `"${String(v).replace(/"/g, '""')}"`;
    const txt = '﻿' + lignes.map(l => l.map(fmt).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = nom;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Fichier CSV téléchargé');
  };
  function exporterTout() {
    if (O.comparer) {
      const t = [['zone', 'lieu', 'latitude', 'longitude', 'rayon_km', 'indicateur', 'avant', 'apres', 'valeur_avant', 'valeur_apres', 'delta', 'delta_sur_sigma', 'delta_km2', 'classe', 'raison']];
      O.unites.forEach(u => { const c = u.cmp; t.push([u.nom, u.lieu, u.lat, u.lon, u.r, O.module, O.avant.date, O.date.date, c.eA?.valeur, c.eB?.valeur, c.delta, c.zd, c.km2, c.cl, c.raison || '']); });
      return csv(t, `saje_field_comparaison_${O.module}_${O.avant.date}_${O.date.date}.csv`);
    }
    const t = [['zone', 'lieu', 'latitude', 'longitude', 'rayon_km', 'surface_km2', 'passage', 'indicateur', 'exploitable', 'valeur', 'mediane', 'sigma', 'z', 'n', 'etat', 'classe', 'confiance', 'raison']];
    O.unites.forEach(u => u.analyse.evals.forEach(e => t.push([u.nom, u.lieu, u.lat, u.lon, u.r, u.surface, O.date.date, e.id, e.exploitable ? 'oui' : 'non', e.valeur, e.normale?.mediane, e.normale?.sigma, e.z, e.normale?.n, e.etat, classer(u.analyse, e.id), e.conf?.score, e.raisons[0] || ''])));
    csv(t, `saje_field_zones_${O.date.date}.csv`);
  }
  function exporterZone(u) {
    const s = R.completer(u.serie), cols = ['date', 'orbite', 'maturite', 'double_pol', 'part_eau_pct', 'part_inondation_pct', 'part_vegetation_inondee_pct', 'HH_dB', 'HV_dB', 'HVmoinsHH_dB', 'anomalie_HH_dB', 'humidite_m3m3', 'couverture_pct', 'pixels'];
    csv([cols, ...s.map(p => cols.map(c => p[c]))], `saje_field_${u.nom.replace(/\W+/g, '_').toLowerCase()}.csv`);
  }

  // ------------------------------------------------------------------ fiche complète
  function ouvrirFiche(u) {
    const ancienne = O.choisie;
    O.choisie = u;
    if (ancienne && ancienne !== u && ancienne.classe) peindre(ancienne);
    if (u.classe) peindre(u);
    u.calque.bringToFront();
    remplirFiche(u);
    const f = $('obsFiche');
    f.hidden = false;
    $('page-carte').classList.add('fiche-on');
    requestAnimationFrame(() => f.classList.add('on'));
    $('ficheTitle')?.focus({ preventScroll: true });
  }
  function fermerFiche() {
    const u = O.choisie; O.choisie = null;
    if (u?.classe) peindre(u);
    const f = $('obsFiche'); f.classList.remove('on');
    $('page-carte').classList.remove('fiche-on');
    setTimeout(() => { if (!O.choisie) f.hidden = true; }, reduit ? 0 : 260);
  }

  function tableauIndicateurs(a) {
    return `<div class="table-scroll"><table class="f-table"><thead><tr><th>Indicateur</th><th>Valeur</th><th>Médiane</th><th>σ</th><th>z</th><th>n</th><th>Conf.</th></tr></thead><tbody>${
      a.evals.map(e => e.exploitable
        ? `<tr><th scope="row">${esc(e.libelle)}</th><td>${uni(e.ind, e.valeur)}</td><td>${e.normale.ok ? uni(e.ind, e.normale.mediane) : '—'}</td><td>${e.normale.ok ? N(e.normale.sigma, 2) : '—'}</td><td class="${Math.abs(e.z || 0) >= 2 ? 'hors' : ''}">${e.z != null ? N(e.z, 1) : '—'}</td><td>${e.normale.n}</td><td>${N(e.conf.score, 2)}</td></tr>`
        : `<tr class="na"><th scope="row">${esc(e.libelle)}</th><td colspan="6">${esc(e.raisons[0] || 'non exploitable')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function tableauSerie(u) {
    const ind = R.IND[O.module], s = R.completer(u.serie);
    return `<details class="f-details"><summary>Série complète : ${esc(ind.libelle)} (${s.length} passages)</summary><div class="table-scroll"><table class="f-table"><thead><tr><th>Passage</th><th>Maturité</th><th>Pol.</th><th>Valeur</th><th>Couverture</th></tr></thead><tbody>${
      s.map(p => `<tr class="${p.date === O.date.date || (O.comparer && p.date === O.avant.date) ? 'sel' : ''}"><td>${Donnees.dmy(p.date)}/${p.date.slice(2, 4)}</td><td>${LM(p.maturite)}</td><td>${p.double_pol ? 'HH+HV' : 'HH'}</td><td>${(!ind.besoinHV || p.double_pol) && p[ind.cle] != null ? uni(ind, p[ind.cle]) : '—'}</td><td>${N(p.couverture_pct, 0)} %</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  /** Évolution de l'indicateur dans le temps, avec les passages choisis marqués. */
  function courbeTemps(u, col) {
    const ind = R.IND[O.module], s = R.completer(u.serie).filter(p => p.maturite !== 'BETA');
    const pts = s.map(p => ({ d: p.date, v: (!ind.besoinHV || p.double_pol) ? p[ind.cle] : null })).filter(p => p.v != null);
    if (pts.length < 2) return '';
    const e = u.analyse?.evals.find(x => x.id === O.module), n = e?.normale;
    let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
    if (n?.ok) { lo = Math.min(lo, ind.unite === 'pct' ? Math.max(0, n.bas) : n.bas); hi = Math.max(hi, n.haut); }
    const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad; if (ind.unite === 'pct') lo = Math.max(0, lo);
    const t = d => new Date(d + 'T12:00:00Z').getTime(), t0 = t(pts[0].d), t1 = t(pts.at(-1).d);
    const W = 320, H = 92, X = d => 6 + (t(d) - t0) / ((t1 - t0) || 1) * (W - 12), Y = v => H - 16 - (v - lo) / (hi - lo) * (H - 26);
    const chemin = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
    const bande = n?.ok ? `<rect x="0" y="${Y(n.haut).toFixed(1)}" width="${W}" height="${Math.max(1, Y(ind.unite === 'pct' ? Math.max(0, n.bas) : n.bas) - Y(n.haut)).toFixed(1)}" class="cb-band"/>` : '';
    const marque = (d, cls, lbl) => { const p = pts.find(x => x.d === d.date); if (!p) return ''; const x = X(p.d), y = Y(p.v);
      return `<line x1="${x}" x2="${x}" y1="6" y2="${H - 14}" class="cb-l ${cls}"/><circle cx="${x}" cy="${y}" r="5" class="cb-p ${cls}"/><text x="${Math.min(W - 14, Math.max(14, x))}" y="${H - 2}" class="cb-t ${cls}" text-anchor="middle">${lbl}</text>`; };
    const points = pts.map(p => `<circle cx="${X(p.d).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="2.6" fill="${col}"><title>${F(p.d)} : ${uni(ind, p.v)}</title></circle>`).join('');
    return `<figure class="f-courbe"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution de ${esc(ind.libelle)} dans le temps pour ${esc(u.nom)}">${bande}<path d="${chemin}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>${points}
      ${O.comparer ? marque(O.avant, 'a', 'avant') : ''}${marque(O.date, 'b', O.comparer ? 'après' : 'choisi')}</svg>
      <figcaption><span>${F(pts[0].d)}</span><span>${AN() ? 'bande : médiane ± 2σ' : 'bande claire : ce qui est habituel'}</span><span>${F(pts.at(-1).d)}</span></figcaption></figure>`;
  }

  function blocComparaison(u) {
    const c = u.cmp, col = couleurDe(u), ind = R.IND[O.module];
    let barres = '';
    if (c.cl !== 'na' && (ind.unite === 'pct' || ind.unite === 'm3')) {
      const max = Math.max(c.eA.valeur, c.eB.valeur) || 1;
      const lig = (d, e, k) => `<div class="cb-row ${k}"><span>${F(d.date)}</span><i style="width:${Math.max(2, e.valeur / max * 100)}%"></i><b>${AN() ? uni(ind, e.valeur) : (valSimple(e) || uni(ind, e.valeur))}</b></div>`;
      barres = `<div class="cb-bars">${lig(O.avant, c.eA, 'a')}${lig(O.date, c.eB, 'b')}</div>`;
    }
    return `<section class="f-main" style="--c:${col}">
        <p class="eyebrow">${ico('compare', 14)} Comparaison · ${esc(mod(O.module).nom)}</p>
        <span class="f-state">${esc(CMP[c.cl].lib)}</span>
        <h3>${esc(phraseCmp(c))}</h3>
        ${barres}
        ${mesureCmp(c) ? `<p class="proof">${esc(mesureCmp(c))}</p>` : ''}
        ${c.cl !== 'na' && c.km2 != null && Math.abs(c.km2) >= 0.05 ? `<p>${c.km2 > 0 ? 'Environ' : 'Environ'} <b>${km2(Math.abs(c.km2))}</b> ${c.km2 > 0 ? 'en plus' : 'en moins'} entre les deux passages.</p>` : ''}
        ${courbeTemps(u, col)}
      </section>`;
  }

  /** Bloc « prochain passage » de la fiche, pour le module choisi. */
  function blocPrevision(a) {
    const p = a.previsions?.find(x => x.id === O.module), ind = R.IND[O.module];
    if (!p) return '';
    const u = v => ind.unite === 'pct' ? `${N(v)} %` : ind.unite === 'dB' ? `${N(v)} dB` : `${N(v, 3)} m³/m³`;
    if (!p.ok) return `<section class="f-sec"><h4>${AN() ? 'Prévision du prochain passage' : 'Et au prochain passage ?'}</h4><p class="muted small">${esc(p.raison)}</p></section>`;
    const val = p.km2 != null ? `${N(p.km2, p.km2 < 10 ? 1 : 0)} km²` : u(p.valeur), de = p.km2 != null ? `${N(p.km2Bas, 1)} et ${N(p.km2Haut, 1)} km²` : `${u(p.bas)} et ${u(p.haut)}`;
    const md = Prediction.modele(p.modele.id);
    const pr = p.risque ? Math.round(p.risque.p * 100) : null;
    return `<section class="f-sec f-prev"><h4>${AN() ? 'Prévision du prochain passage' : 'Et au prochain passage ?'}</h4>
      <p>Vers le <b>${F(p.cible.date)}</b> : <b>${val}</b> <span class="muted">(probablement entre ${de})</span>.</p>
      ${pr != null ? `<p class="small">${pr} % de chances de sortir de ce qui est habituel ici.</p>` : ''}
      <p class="small muted">${AN() ? `${esc(md.savant)} · erreur moyenne passée ${u(p.mae)} sur ${p.m} passages · ` : `Méthode : « ${esc(md.nom)} » · `}${badgeConf({ ...p.conf, libelle: { bonne: 'Fiable', moyenne: 'Assez fiable', faible: 'Peu fiable' }[p.conf.niveau] })}</p></section>`;
  }

  function remplirFiche(u) {
    let a = u.analyse;
    const f = $('obsFiche');
    if (!a) { f.innerHTML = '<p class="muted">Analyse en cours…</p>'; return; }
    // les analyses en lot sont faites sans prévision (rapidité) : la fiche ouverte la calcule
    if (!a.previsions) { a = R.analyser(a.zone, u.serie, a.date, { surfaceKm2: u.surface }); u.analyse = a; }
    const r = resume(u), m = mod(O.module), colJour = O.comparer ? CLASSES[r.cl].col : couleurDe(u);
    const autres = MODULES.map(x => {
      const rx = resume(u, x.id);
      return `<li><button class="f-mod ${x.id === O.module ? 'on' : ''}" data-mod="${x.id}" style="--c:${CLASSES[rx.cl].col}" aria-pressed="${x.id === O.module}">
        <span class="sw" style="background:${CLASSES[rx.cl].col}"></span><span><b>${esc(x.nom)}</b><small>${esc(rx.cl === 'na' ? courtCl('na') : rx.titre)}</small></span></button></li>`;
    }).join('');
    const reco = a.recommandations.map(x => `<li class="reco ${x.niveau}"><span class="lvl" aria-hidden="true"></span><span>${esc(x.texte)}</span></li>`).join('');
    const inconnues = a.inconnues.length ? `<details class="unknowns"><summary>${AN() ? 'Indicateurs non exploitables' : 'Ce que le satellite ne permet pas de dire ici'} (${a.inconnues.length})</summary><ul>${a.inconnues.map(x => `<li><b>${esc(x.libelle)}</b> : ${esc(x.raisons[0])}</li>`).join('')}</ul></details>` : '';
    const diam = `${N(u.r * 2, u.r * 2 < 10 ? 1 : 0)} km`;
    const constat = a.constats.find(x => x.id === O.module);
    const jour = `<section class="${O.comparer ? 'f-sec f-jour' : 'f-main'}" style="--c:${colJour}">
        ${O.comparer ? `<h4>Le ${F(O.date.date)}, comparé à d’habitude</h4>` : `<p class="eyebrow">${ico(m.icone, 14)} ${esc(m.nom)}</p>`}
        <span class="f-state">${esc(courtCl(r.cl))}</span>
        <h3>${esc(r.titre)}</h3>
        ${r.texte ? `<p>${esc(r.texte)}</p>` : ''}
        ${r.e?.exploitable ? `<p class="proof">${esc(constat?.preuve || r.mesure)}</p>${badgeConf(r.e.conf)}` : `<p class="proof">${esc(r.mesure)}</p>`}
        ${AN() && r.e?.conf && !O.comparer ? `<ul class="factors">${r.e.conf.facteurs.map(x => `<li data-s="${x[0]}">${esc(x[1])}</li>`).join('')}</ul>` : ''}
        ${O.comparer ? '' : courbeTemps(u, r.cl === 'na' ? '#94a3b8' : colJour)}
      </section>`;
    f.innerHTML = `
      <div class="f-head">
        <div><p class="eyebrow">${u.type === 'secteur' ? `Cercle de ${diam}` : `Zone suivie · cercle de ${diam}`}${AN() && u.surface ? ` · ${N(u.surface, 0)} km² observés` : ''}</p>
          <h2 id="ficheTitle" tabindex="-1">${esc(u.nom)}</h2>
          ${u.lieu ? `<p class="muted small f-lieu">${ico('pin', 14)} ${esc(u.lieu.replace(/^à /, 'À ').replace(/^près/, 'Près'))}</p>` : ''}
          ${AN() ? `<p class="muted small f-lieu">${N(u.lat, 3)}° · ${N(u.lon, 3)}° · ${u.ids.length} pixels de ${Analyse.resolution()} m</p>` : ''}</div>
        <button class="icon-button" id="ficheClose" aria-label="Fermer la fiche">${ico('close')}</button>
      </div>
      <div class="f-tags">${O.comparer ? `<span class="badge">${F(O.avant.date)} → ${F(O.date.date)}</span>` : `<span class="badge ${O.date.maturite}">${LM(O.date.maturite)}</span><span class="badge">${LP(O.date)}</span><span class="badge">${F(O.date.date)}</span>`}</div>
      ${O.comparer && u.cmp ? blocComparaison(u) : ''}
      ${jour}
      ${O.comparer ? '' : blocPrevision(a)}
      ${AN() ? `<section class="f-sec"><h4>Les 6 indicateurs le ${F(O.date.date)}</h4>${tableauIndicateurs(a)}</section>${tableauSerie(u)}` : ''}
      <section class="f-sec"><h4>${AN() ? 'Verdict de l’algorithme' : 'En résumé'}</h4>
        <div class="f-verdict ${a.verdict.niveau}"><b>${esc(a.verdict.titre)}</b><span>${esc(a.verdict.texte)}</span>
        <small>${AN() ? `${a.exploitables} / ${a.total} indicateurs exploitables · confiance moyenne ${N(a.confiance.score, 2)}` : `${a.exploitables} mesure${a.exploitables > 1 ? 's' : ''} fiable${a.exploitables > 1 ? 's' : ''} sur ${a.total}`}</small></div></section>
      <section class="f-sec"><h4>${AN() ? 'Les 6 modules' : 'Les autres sujets ici'}</h4><ul class="f-mods">${autres}</ul></section>
      ${inconnues}
      <section class="f-sec"><h4>Que faire ?</h4><ul class="reco-list">${reco}</ul></section>
      <div class="f-actions">
        <button class="button primary" id="ficheDash">${ico('grid')}Voir le tableau de bord de cette zone</button>
        <button class="button" id="ficheZoom">${ico('target')}Centrer</button>
        ${AN() ? `<button class="button" id="ficheCsv">${ico('download')}CSV</button>` : ''}
      </div>`;
    $('ficheClose').onclick = fermerFiche;
    $('ficheZoom').onclick = () => cadrerSur(u);
    $('ficheCsv')?.addEventListener('click', () => exporterZone(u));
    $('ficheDash').onclick = () => APP.ouvrirDansTableau(u.type === 'zone' ? { nom: u.nom }
      : { nom: nomComplet(u), ids: u.ids, geometry: Donnees.cercle(u.lat, u.lon, u.r), surface: u.surface, serie: u.serie, cercle: true }, O.date, O.comparer ? O.avant : null);
    $$('#obsFiche [data-mod]').forEach(b => b.onclick = () => choisirModule(b.dataset.mod));
  }

  // ------------------------------------------------------------------ frise des passages
  const tms = d => new Date(d + 'T12:00:00Z').getTime();
  const T0 = tms(M.dates[0].date), T1 = tms(M.dates.at(-1).date);
  const posX = d => T1 > T0 ? 1.5 + (tms(d) - T0) / (T1 - T0) * 97 : 50;
  const fc = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  function construireFrise() {
    const piste = $('obsTrack');
    let h = '<span class="trk-line"></span><span class="trk-range" id="obsRange"></span>';
    for (let i = 1; i < M.dates.length; i++) {
      const a = M.dates[i - 1].date, b = M.dates[i].date;
      if (tms(b) - tms(a) > 30 * 864e5) h += `<span class="trk-gap" style="left:${posX(a) + 1}%;width:${Math.max(0, posX(b) - posX(a) - 2)}%" title="Pas de donnée NISAR publiée entre le ${F(a)} et le ${F(b)}"></span>`;
    }
    h += M.dates.map((d, i) => `<button class="tk" role="option" data-i="${i}" style="left:${posX(d.date)}%"><span class="tk-bar"><i></i></span><span class="tk-pt"></span><span class="tk-lbl">${Donnees.dmy(d.date)}</span></button>`).join('');
    piste.innerHTML = h;
    $('obsT0').textContent = fc(M.dates[0].date); $('obsT1').textContent = fc(M.dates.at(-1).date);
    piste.addEventListener('click', e => {
      const b = e.target.closest('.tk'); if (!b) return;
      arreterLecture();
      const d = M.dates[+b.dataset.i];
      if (O.comparer && O.placer === 'avant' && window.innerWidth >= 900) { O.avant = d; majAnalyse(); } else choisirDate(d);
    });
    piste.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); arreterLecture();
      const i = M.dates.indexOf(O.date), j = e.key === 'Home' ? 0 : e.key === 'End' ? M.dates.length - 1 : Math.max(0, Math.min(M.dates.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      choisirDate(M.dates[j]);
      requestAnimationFrame(() => $('obsTrack').querySelector(`.tk[data-i="${j}"]`)?.focus());
    });
  }
  function majFrise() {
    const id = O.module, ticks = $$('#obsTrack .tk');
    const comptes = M.dates.map(d => {
      const res = O.resultats.get(cle(d)); if (!res) return null;
      let n = 0; res.forEach(a => { const c = classer(a, id); if (c === 'alerte' || c === 'attention') n++; }); return n;
    });
    const max = Math.max(1, ...comptes.filter(x => x != null));
    const faits = comptes.filter(x => x != null).length;
    ticks.forEach((b, i) => {
      const d = M.dates[i], n = comptes[i];
      b.classList.toggle('on', d === O.date);
      b.classList.toggle('a', O.comparer && d === O.avant);
      b.classList.toggle('na', !mesurable(d) && id !== 'humidite');
      b.classList.toggle('beta', d.maturite === 'BETA');
      b.classList.toggle('dual', !!d.double_pol);
      b.setAttribute('aria-selected', String(d === O.date));
      b.tabIndex = d === O.date ? 0 : -1;
      const bar = b.querySelector('.tk-bar i');
      bar.style.height = n == null ? '0' : `${Math.max(n ? 12 : 4, n / max * 100)}%`;
      bar.parentElement.classList.toggle('vide', n === 0);
      const t = `${F(d.date)} · ${LM(d.maturite)} · ${LP(d)}${n != null ? ` · ${n} zone${n > 1 ? 's' : ''} à surveiller ou en alerte` : ''}`;
      b.title = t; b.setAttribute('aria-label', t);
    });
    const r = $('obsRange');
    if (O.comparer) { const a = posX(O.avant.date), z = posX(O.date.date); r.style.left = Math.min(a, z) + '%'; r.style.width = Math.abs(z - a) + '%'; r.hidden = false; } else r.hidden = true;
    $('obsCur').textContent = O.comparer ? `${fc(O.avant.date)} → ${fc(O.date.date)}` : fc(O.date.date);
    $('obsCurInfo').textContent = O.comparer ? 'comparaison de deux passages' : `${LM(O.date.maturite)} · ${LP(O.date)}`;
    $('obsBarsLbl').innerHTML = id === 'humidite' ? '' : faits < M.dates.length ? `<i></i> historique en cours de calcul (${faits}/${M.dates.length})` : `<i></i> zones à surveiller ou en alerte, à chaque passage`;
    $('obsPrev').disabled = O.date === M.dates[0];
    $('obsNext').disabled = O.date === M.dates.at(-1);
    $('obsCompare').setAttribute('aria-pressed', String(O.comparer));
    $('obsCmpBar').hidden = !O.comparer;
    $('obsTime').classList.toggle('cmp', O.comparer);
    $('page-carte').classList.toggle('cmp-on', O.comparer);
    if (O.comparer) {
      $('obsAvant').value = String(M.dates.indexOf(O.avant)); $('obsApres').value = String(M.dates.indexOf(O.date));
      $$('[data-placer]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.placer === O.placer)));
    }
  }

  // lecture automatique
  function suivantLisible(d) {
    let i = M.dates.indexOf(d);
    for (let k = 0; k < M.dates.length; k++) { i = (i + 1) % M.dates.length; const x = M.dates[i]; if ((mesurable(x) || O.module === 'humidite') && (!O.comparer || x !== O.avant)) return x; }
    return d;
  }
  function arreterLecture() {
    if (!O.lecture) return;
    clearTimeout(O.lecture); O.lecture = null;
    $('obsPlay').innerHTML = ico('play'); $('obsPlay').setAttribute('aria-pressed', 'false');
  }
  function lancerLecture() {
    $('obsPlay').innerHTML = ico('pause'); $('obsPlay').setAttribute('aria-pressed', 'true');
    const pas = async () => {
      O.lecture = O.lecture || 1;
      O.date = suivantLisible(O.date);
      await majAnalyse();
      if (O.lecture) O.lecture = setTimeout(pas, 1500);
    };
    O.lecture = setTimeout(pas, 50);
  }

  // ------------------------------------------------------------------ commandes
  function majOutils() {
    const m = mod(O.module);
    $('obsTab').innerHTML = `${ico(m.icone, 18)}<span class="t-lbl"><small>Ce que montre la carte</small><b>${esc(m.nom)}</b></span>${ico('chevron', 16)}`;
    $('obsModPanel').innerHTML = MODULES.map(x => `<button class="obs-mod" data-mod="${x.id}" aria-pressed="${x.id === O.module}" title="${esc(x.question)}">
      <span class="m-ic">${ico(x.icone, 16)}</span><b>${esc(x.nom)}</b><span class="m-ok">${ico('tick', 15)}</span></button>`).join('');
    $$('[data-decoupe]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.decoupe === O.decoupe)));
    $$('[data-taille]').forEach(b => { b.setAttribute('aria-pressed', String(+b.dataset.taille === O.taille)); b.disabled = O.decoupe !== 'secteurs'; });
    $$('[data-couleur]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.couleur === O.couleur)); b.disabled = O.comparer; });
    majImage();
  }
  function popover(id, bouton, ouvert) {
    $(id).hidden = !ouvert;
    $(bouton).setAttribute('aria-expanded', String(ouvert));
    if (ouvert) $(id).querySelector('[aria-pressed=true], button')?.focus();
  }
  const panneau = ouvert => { if (ouvert) popover('obsDisplay', 'obsDispBtn', false); popover('obsModPanel', 'obsTab', ouvert); };
  const affichage = ouvert => { if (ouvert) popover('obsModPanel', 'obsTab', false); popover('obsDisplay', 'obsDispBtn', ouvert); };
  function choisirModule(id) {
    O.module = id; panneau(false);
    if (O.comparer && id !== 'humidite' && [O.avant, O.date].some(d => !mesurable(d) || d.maturite === 'BETA')) {
      const ok = M.dates.filter(x => x.maturite !== 'BETA' && mesurable(x));
      if (ok.length >= 2) {
        if (!ok.includes(O.date)) O.date = ok.at(-1);
        if (!ok.includes(O.avant) || O.avant === O.date) O.avant = ok.find(x => x !== O.date && x.date < O.date.date) || ok.find(x => x !== O.date);
        toast(`${mod(id).nom} : passages ajustés (${F(O.avant.date)} → ${F(O.date.date)})`);
      }
    }
    majAnalyse();
  }
  function choisirDate(d) { O.date = d; majAnalyse(); }
  function basculerComparaison(on) {
    O.comparer = on;
    if (on) {
      const ok = M.dates.filter(x => x.maturite !== 'BETA' && (mesurable(x) || O.module === 'humidite'));
      if (O.date.maturite === 'BETA' || !ok.includes(O.date)) O.date = ok.at(-1) || O.date;
      if (!O.avant || O.avant === O.date || O.avant.maturite === 'BETA') O.avant = ok.find(x => x !== O.date && x.date < O.date.date) || ok.find(x => x !== O.date) || M.dates.find(x => x !== O.date);
    }
    majAnalyse();
  }
  function remplirDates() {
    const opt = (d, i) => new Option(`${fc(d.date)} · ${AN() ? (d.double_pol ? 'HH+HV' : 'HH') : LP(d).toLowerCase()}${d.maturite === 'BETA' ? ` · ${LM('BETA').toLowerCase()}` : ''}`, i);
    ['obsAvant', 'obsApres'].forEach(id => { $(id).innerHTML = ''; M.dates.forEach((d, i) => $(id).add(opt(d, i))); });
  }

  // ------------------------------------------------------------------ zoom, cadrage
  function majVisibilite() {
    const z = carte.getZoom(), proche = z >= 6.25;
    const voir = (g, on) => { if (on && !carte.hasLayer(g)) g.addTo(carte); if (!on && carte.hasLayer(g)) carte.removeLayer(g); };
    voir(groupe, proche);
    voir(groupeVilles, z >= (window.innerWidth < 600 ? 8.75 : 8));
    voir(balise, z < 7.5);
    reperes.forEach(r => voir(r.m, z >= r.zmin && z < r.zmax));
    div.classList.toggle('loin', !proche);
    $('page-carte').classList.toggle('loin', !proche);
    if (proche && !O.interagi) masquerIntro();
    majImage();
    repeindre();
  }
  const marges = () => window.innerWidth < 900
    ? { paddingTopLeft: [10, 130], paddingBottomRight: [10, 150] }
    : window.innerWidth < 1100 ? { paddingTopLeft: [20, 90], paddingBottomRight: [20, 150] }
    : { paddingTopLeft: [40, 80], paddingBottomRight: [340, 120] };
  function cadrerSur(u) { carte.flyToBounds(boiteCercle(u), { maxZoom: u.r < 5 ? 11 : 10, ...marges(), duration: reduit ? 0 : 0.9 }); }
  function allerEstuaire() {
    O.interagi = true; masquerIntro(); affichage(false);
    carte.flyToBounds(B, { ...marges(), duration: reduit ? 0 : 2.4, easeLinearity: 0.2 });
  }
  function vueMonde() { O.interagi = true; fermerFiche(); affichage(false); carte.flyTo([8, 12], 2.6, { duration: reduit ? 0 : 1.6 }); }
  function masquerIntro() { const i = $('obsIntro'); if (!i.hidden) { i.classList.add('out'); setTimeout(() => { i.hidden = true; }, 300); } }

  function lier() {
    $('obsTab').onclick = e => { e.stopPropagation(); panneau($('obsModPanel').hidden); };
    $('obsDispBtn').onclick = e => { e.stopPropagation(); affichage($('obsDisplay').hidden); };
    $('obsModPanel').addEventListener('click', e => { const b = e.target.closest('[data-mod]'); if (b) choisirModule(b.dataset.mod); });
    ['obsModPanel', 'obsDisplay'].forEach(id => $(id).addEventListener('keydown', e => {
      const items = $$(`#${id} button:not([disabled]):not([hidden])`).filter(b => b.offsetParent), i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      if (e.key === 'Escape') { if (id === 'obsModPanel') { panneau(false); $('obsTab').focus(); } else { affichage(false); $('obsDispBtn').focus(); } }
    }));
    document.addEventListener('click', e => {
      if (!$('obsModPanel').hidden && !e.target.closest('#obsModPanel, #obsTab')) panneau(false);
      if (!$('obsDisplay').hidden && !e.target.closest('#obsDisplay, #obsDispBtn')) affichage(false);
    });
    $$('[data-decoupe]').forEach(b => b.onclick = () => { O.decoupe = b.dataset.decoupe; majAnalyse(); });
    $$('[data-taille]').forEach(b => b.onclick = () => { O.taille = +b.dataset.taille; majAnalyse(); });
    $$('[data-couleur]').forEach(b => b.onclick = () => { O.couleur = b.dataset.couleur; majOutils(); repeindre(); afficherLegende(); afficherClassement(); });
    $('obsImage').onclick = () => { O.image = !imageVisible(); majImage(); };
    $('obsSat').onclick = () => { O.sat = !O.sat; majSat(); };
    $('obsWorld').onclick = vueMonde;
    $('obsHome').onclick = allerEstuaire;
    $('obsGo').onclick = allerEstuaire;
    $('obsStay').onclick = () => { O.interagi = true; masquerIntro(); };
    $('obsRankToggle').onclick = () => {
      const o = $('obsRank').classList.toggle('ferme');
      $('obsRankToggle').setAttribute('aria-expanded', String(!o));
    };
    $('obsLgToggle').onclick = () => {
      O.legende = !O.legende;
      try { localStorage.setItem('saje_legende', O.legende ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
      afficherLegende();
    };
    // frise, lecture, comparaison
    construireFrise(); remplirDates();
    $('obsPlay').onclick = () => (O.lecture ? arreterLecture() : lancerLecture());
    $('obsPrev').onclick = () => { arreterLecture(); choisirDate(M.dates[Math.max(0, M.dates.indexOf(O.date) - 1)]); };
    $('obsNext').onclick = () => { arreterLecture(); choisirDate(M.dates[Math.min(M.dates.length - 1, M.dates.indexOf(O.date) + 1)]); };
    $('obsCompare').onclick = () => { arreterLecture(); basculerComparaison(!O.comparer); };
    $('obsAvant').onchange = e => { O.avant = M.dates[+e.target.value]; majAnalyse(); };
    $('obsApres').onchange = e => { arreterLecture(); choisirDate(M.dates[+e.target.value]); };
    $('obsSwap').onclick = () => { arreterLecture(); [O.avant, O.date] = [O.date, O.avant]; majAnalyse(); };
    $$('[data-placer]').forEach(b => b.onclick = () => { O.placer = b.dataset.placer; majFrise(); });
    carte.on('zoomend', majVisibilite);
    carte.on('move zoom resize', placerScan);
    carte.on('click', () => { if (O.choisie) fermerFiche(); });
    carte.on('dragstart zoomstart', () => { O.interagi = true; });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || document.documentElement.dataset.page !== 'carte') return;
      if (!$('obsModPanel').hidden) panneau(false); else if (!$('obsDisplay').hidden) affichage(false); else if (O.choisie) fermerFiche();
    });
    $('obsRank').classList.add('ferme'); $('obsRankToggle').setAttribute('aria-expanded', 'false');
  }

  // ------------------------------------------------------------------ démarrage
  async function demarrer() {
    const hauteurBarre = () => document.documentElement.style.setProperty('--top-h', document.querySelector('.topbar').offsetHeight + 'px');
    hauteurBarre(); window.addEventListener('resize', hauteurBarre);
    // la légende, le zoom et les panneaux se placent au-dessus de la frise, quelle que soit sa hauteur
    const hFrise = () => $('page-carte').style.setProperty('--time-h', $('obsTime').offsetHeight + 'px');
    hFrise(); if (window.ResizeObserver) new ResizeObserver(hFrise).observe($('obsTime'));
    remplirIcones($('page-carte'));
    lier();
    majOutils();
    majFrise();
    majVisibilite();
    $('obsIntro').hidden = false;
    let pret = false;
    setTimeout(() => { if (!O.interagi && document.documentElement.dataset.page === 'carte') allerEstuaire(); }, reduit ? 6000 : 2600);
    try { afficherProgression(true, 'Préparation des données NISAR…', 'Décodage du cube radar embarqué', 0); await Analyse.charger(); pret = true; }
    catch (e) {
      afficherProgression(false);
      $('obsBanner').hidden = false;
      $('obsBanner').innerHTML = `${ico('alert')}<span><b>Analyse impossible dans ce navigateur.</b> Utilisez une version récente de Chrome, Edge ou Firefox.</span>`;
    }
    if (!pret) return;
    O.pret = true;
    majAnalyse();
  }

  window.Observatoire = {
    rafraichir(theme) { carte.invalidateSize(); placerScan(); if (theme) monde?.setStyle(styleMonde); },
    reseau(ok) { $('obsSat').hidden = !ok; if (!ok && O.sat) { O.sat = false; majSat(); } },
    changerMode() {
      if (!AN()) O.couleur = 'conclusion';
      if (!AN() && O.taille !== 14) O.taille = 14;
      remplirDates(); majAnalyse();
    },
  };
  demarrer();
})();
