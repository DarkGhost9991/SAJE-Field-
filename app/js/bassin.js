/* =====================================================================
   SAJE Field — page « Bassin du Congo »
   ---------------------------------------------------------------------
   Données : collecte_bassin/collecter_bassin.py écrit js/donnees/bassin/
     index.js        description (périodes, couches, codage, tuiles)
     apercu.js       tout le bassin, cellules de ~5,5 km
     1km/*.js        tuiles de 200 × 200 cellules de ~1,1 km
     80m/*.js        tuiles de 500 × 500 cellules de ~80 m (zones d'intérêt)
   Chaque tuile est chargée à la demande (balise <script> : fonctionne en
   double-clic, sans serveur), décompressée (gzip + delta dans le temps),
   puis dessinée sur un canevas.
   Chaque valeur porte un drapeau : mesurée, comblée (le satellite n'est pas
   passé ou la mesure a été écartée), prévue, vide.
   ===================================================================== */
(() => {
  'use strict';
  const IX = window.SAJE_BASSIN_INDEX;
  const $ = id => document.getElementById(id);
  const N = (v, n = 1) => v == null || Number.isNaN(v) ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: n, minimumFractionDigits: n }).format(v);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const F = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const AN = () => document.documentElement.dataset.detail === 'expert';
  const VIDE = 255, MESURE = 0, COMBLE = 1, PREVU = 2;

  // palettes (du bas vers le haut de l'échelle) et bornes d'affichage
  const AFFICHAGE = {
    eau: { nom: 'Eau', bornes: [0, 60], rampe: [[245, 248, 252], [150, 200, 255], [30, 90, 220], [10, 20, 120]], bas: 'Sec', haut: 'En eau', dec: 0, unite: ' %' },
    veg: { nom: 'Végétation', bornes: [-14, -4], rampe: [[120, 80, 40], [230, 210, 120], [40, 150, 60], [10, 80, 30]], bas: 'Sol nu', haut: 'Dense', dec: 1, unite: ' dB' },
    hh: { nom: 'Écho radar', bornes: [-22, -2], rampe: [[0, 0, 0], [255, 255, 255]], bas: 'Faible', haut: 'Fort', dec: 1, unite: ' dB', expert: true },
    sm: { nom: 'Humidité du sol', bornes: [0.05, 0.5], rampe: [[214, 164, 72], [79, 190, 170], [56, 120, 230]], bas: 'Sec', haut: 'Saturé', dec: 2, unite: ' m³/m³' },
  };
  const S = { champ: 'eau', p: null, montrer: true, carte: null, calques: new Map(), tuiles: new Map(), attente: new Map(), choix: null, graphe: null };

  // ------------------------------------------------------------------ chargement et décodage des tuiles
  window.SAJE_BASSIN_RECEVOIR = (cle, d) => { const r = S.attente.get(cle); if (r) { S.attente.delete(cle); r(d); } };
  function charger(cle, chemin) {
    if (S.tuiles.has(cle)) return S.tuiles.get(cle);
    const pr = new Promise((ok, ko) => {
      S.attente.set(cle, d => decoder(d).then(ok, ko));
      const s = document.createElement('script');
      s.src = chemin; s.onerror = () => { S.attente.delete(cle); ko(new Error('tuile absente : ' + chemin)); };
      s.onload = () => s.remove();
      document.head.appendChild(s);
    });
    S.tuiles.set(cle, pr);
    return pr;
  }
  async function decoder(d) {
    const bin = atob(d.b64), gz = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
    const brut = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    const [P, H, W] = d.forme, n = H * W, bloc = P * n;
    const tab = {};
    d.champs.forEach((c, k) => {
      const t = ['val', 'drap', 'sd'].map((_, j) => {
        const a = brut.slice((k * 3 + j) * bloc, (k * 3 + j + 1) * bloc);
        if (d.delta) for (let p = 1; p < P; p++) for (let i = p * n, f = i + n; i < f; i++) a[i] = (a[i] + a[i - n]) & 255;   // somme cumulée
        return a;
      });
      tab[c] = { val: t[0], drap: t[1], sd: t[2] };
    });
    return { ...d, P, H, W, tab };
  }
  const valeur = (c, o) => o === VIDE ? null : IX.champs[c].codage.val[0] + o * IX.champs[c].codage.val[1];
  const ecart = (c, o) => o === VIDE ? null : o * IX.champs[c].codage.sd;

  // ------------------------------------------------------------------ dessin d'une tuile
  function couleur(c, v) {
    const a = AFFICHAGE[c], r = a.rampe, t = Math.max(0, Math.min(1, (v - a.bornes[0]) / (a.bornes[1] - a.bornes[0]))) * (r.length - 1);
    const i = Math.min(r.length - 2, Math.floor(t)), f = t - i;
    return r[i].map((x, k) => Math.round(x + (r[i + 1][k] - x) * f));
  }
  function image(t, c, p) {
    const x = t.tab[c]; if (!x) return null;
    const cv = document.createElement('canvas'); cv.width = t.W; cv.height = t.H;
    const g = cv.getContext('2d'), im = g.createImageData(t.W, t.H), n = t.W * t.H, o = p * n;
    let vu = 0;
    for (let i = 0; i < n; i++) {
      const dr = x.drap[o + i];
      if (dr === VIDE || (!S.montrer && dr !== MESURE)) continue;
      const [r, gg, b] = couleur(c, valeur(c, x.val[o + i]));
      im.data.set([r, gg, b, dr === MESURE ? 235 : dr === COMBLE ? 150 : 190], i * 4);
      vu++;
    }
    if (!vu) return null;
    g.putImageData(im, 0, 0);
    return cv.toDataURL();
  }

  // ------------------------------------------------------------------ niveaux affichés selon le zoom
  function tuilesVisibles(niveau) {
    const b = S.carte.getBounds();
    return (IX.niveaux[niveau]?.tuiles || []).filter(t => t.champs.includes(S.champ) || niveau === 'apercu')
      .filter(t => !(t.bornes[1][0] < b.getSouth() || t.bornes[0][0] > b.getNorth() || t.bornes[1][1] < b.getWest() || t.bornes[0][1] > b.getEast()));
  }
  let jeton = 0;
  async function redessiner() {
    if (!S.carte) return;
    const moi = ++jeton, z = S.carte.getZoom();
    const voulues = [{ cle: 'apercu', chemin: 'js/donnees/bassin/apercu.js' }];
    if (z >= 7) tuilesVisibles('1km').slice(0, 40).forEach(t => voulues.push({ cle: t.cle, chemin: `js/donnees/bassin/${t.cle}.js` }));
    if (z >= 10) tuilesVisibles('80m').slice(0, 16).forEach(t => voulues.push({ cle: t.cle, chemin: `js/donnees/bassin/${t.cle}.js` }));
    $('bsNiveau').textContent = z >= 10 && voulues.some(v => v.cle.startsWith('80m')) ? 'Détail ~80 m' : z >= 7 ? 'Cellules de ~1 km' : 'Vue d’ensemble (~5,5 km)';
    const garder = new Set(voulues.map(v => v.cle));
    for (const [cle, l] of S.calques) if (!garder.has(cle)) { S.carte.removeLayer(l); S.calques.delete(cle); }
    for (const v of voulues) {
      let t;
      try { t = await charger(v.cle, v.chemin); } catch (e) { continue; }
      if (moi !== jeton) return;
      const url = image(t, S.champ, S.p);
      const ancien = S.calques.get(v.cle);
      if (ancien) { S.carte.removeLayer(ancien); S.calques.delete(v.cle); }
      if (url) S.calques.set(v.cle, L.imageOverlay(url, t.bornes, { pane: v.cle === 'apercu' ? 'bsApercu' : 'bsDetail', interactive: false }).addTo(S.carte));
    }
  }

  // ------------------------------------------------------------------ fiche d'une cellule
  async function cellule(lat, lng) {
    // niveau le plus fin chargé à cet endroit
    const cles = [...S.calques.keys()].sort((a, b) => (b.startsWith('80m') - a.startsWith('80m')) || (b.startsWith('1km') - a.startsWith('1km')));
    for (const cle of cles) {
      const t = await S.tuiles.get(cle); const [[s, w], [n, e]] = t.bornes;
      if (lat < s || lat > n || lng < w || lng > e) continue;
      const i = Math.floor((n - lat) / (n - s) * t.H), j = Math.floor((lng - w) / (e - w) * t.W);
      if (i < 0 || j < 0 || i >= t.H || j >= t.W) continue;
      const x = t.tab[S.champ]; if (!x) continue;
      const k = i * t.W + j, nn = t.H * t.W;
      const serie = Array.from({ length: t.P }, (_, p) => ({ p, d: x.drap[p * nn + k], v: valeur(S.champ, x.val[p * nn + k]), sd: ecart(S.champ, x.sd[p * nn + k]) }));
      if (serie.every(q => q.d === VIDE)) continue;
      return { cle, lat, lng, serie, pas: cle === 'apercu' ? '~5,5 km' : cle.startsWith('80m') ? '~80 m' : '~1 km' };
    }
    return null;
  }
  async function fiche(lat, lng) {
    const c = await cellule(lat, lng), box = $('bsFiche');
    if (!c) { box.innerHTML = '<p class="muted">Pas de donnée à cet endroit (hors des passages collectés).</p>'; return; }
    S.choix = { lat, lng };
    const a = AFFICHAGE[S.champ], ch = IX.champs[S.champ], u = a.unite;
    const cur = c.serie[S.p], prev = c.serie[IX.prevue];
    const nb = k => c.serie.filter(q => q.d === k).length;
    const etat = d => ({ [MESURE]: 'mesurée', [COMBLE]: 'comblée', [PREVU]: 'prévue', [VIDE]: 'pas de donnée' })[d];
    const fourchette = q => q.sd != null && q.d !== MESURE ? ` (entre ${N(Math.max(ch.bornes[0], q.v - 1.96 * q.sd), a.dec)} et ${N(Math.min(ch.bornes[1], q.v + 1.96 * q.sd), a.dec)}${u})` : '';
    box.innerHTML = `<p class="eyebrow">${N(lat, 3)}° · ${N(lng, 3)}° · cellule ${c.pas}</p>
      <h3>${esc(a.nom)} : ${cur.d === VIDE ? 'pas de donnée' : `${N(cur.v, a.dec)}${u}`}</h3>
      <p class="small">${F(IX.periodes[S.p])} : valeur ${etat(cur.d)}${fourchette(cur)}.</p>
      ${prev && prev.d === PREVU ? `<p class="small"><b>Prévision</b> pour la période du ${F(IX.periodes[IX.prevue])} : ${N(prev.v, a.dec)}${u}${fourchette(prev)}.</p>` : '<p class="small muted">Pas de prévision ici : il faut au moins 5 mesures dans la cellule.</p>'}
      <div class="bs-chart"><canvas id="bsChart" role="img" aria-label="Évolution dans le temps"></canvas></div>
      <p class="small muted">${nb(MESURE)} période(s) mesurée(s), ${nb(COMBLE)} comblée(s)${AN() ? ' par filtre de Kalman + lissage (Rauch-Tung-Striebel), fourchette à 95 %' : ' à partir des mesures d’avant et d’après'}.</p>`;
    const lab = IX.periodes.map(x => new Date(x + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
    const sel = k => c.serie.map(q => q.d === k ? q.v : null);
    const lien = c.serie.map(q => q.d === VIDE ? null : q.v);
    const haut = c.serie.map(q => q.d !== VIDE && q.d !== MESURE && q.sd != null ? Math.min(ch.bornes[1], q.v + 1.96 * q.sd) : null);
    const bas = c.serie.map(q => q.d !== VIDE && q.d !== MESURE && q.sd != null ? Math.max(ch.bornes[0], q.v - 1.96 * q.sd) : null);
    if (S.graphe) S.graphe.destroy();
    S.graphe = new Chart($('bsChart'), {
      type: 'line',
      data: { labels: lab, datasets: [
        { label: 'Fourchette (haut)', data: haut, borderColor: 'transparent', pointRadius: 0, fill: '+1', backgroundColor: 'rgba(245,185,74,.18)', spanGaps: false },
        { label: 'Fourchette (bas)', data: bas, borderColor: 'transparent', pointRadius: 0, fill: false, spanGaps: false },
        { label: 'Série', data: lien, borderColor: 'rgba(148,163,184,.6)', borderDash: [4, 4], borderWidth: 1.2, pointRadius: 0, spanGaps: true },
        { label: 'Mesurée', data: sel(MESURE), borderColor: '#38bdf8', backgroundColor: '#38bdf8', showLine: false, pointRadius: 4 },
        { label: 'Comblée', data: sel(COMBLE), borderColor: '#94a3b8', backgroundColor: 'transparent', showLine: false, pointRadius: 4, pointBorderWidth: 2 },
        { label: 'Prévue', data: sel(PREVU), borderColor: '#f5b94a', backgroundColor: '#f5b94a', showLine: false, pointRadius: 6, pointStyle: 'rectRot' },
      ] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { filter: l => !/Fourchette|Série/.test(l.text), boxWidth: 10, font: { size: 11 } } },
          tooltip: { filter: i => !/Fourchette|Série/.test(i.dataset.label), callbacks: { label: x => ` ${x.dataset.label} : ${N(x.parsed.y, a.dec)}${u}` } } },
        scales: { x: { ticks: { maxRotation: 0, autoSkip: true, font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } } },
    });
  }

  // ------------------------------------------------------------------ interface
  function legende() {
    const a = AFFICHAGE[S.champ];
    $('bsLegende').innerHTML = `<strong>${esc(a.nom)}</strong><div class="ramp" style="background:linear-gradient(90deg,${a.rampe.map(c => `rgb(${c})`).join(',')})"></div>
      <div class="row" style="justify-content:space-between"><span>${a.bas} (${N(a.bornes[0], a.dec)}${a.unite})</span><span>${a.haut} (${N(a.bornes[1], a.dec)}${a.unite})</span></div>
      <div class="bs-drap"><span><i style="opacity:.92"></i>mesurée</span><span><i style="opacity:.6"></i>comblée</span><span><i style="opacity:.75;outline:1px dashed #f5b94a"></i>prévue</span></div>`;
  }
  function majPeriode() {
    const p = S.p, prevue = p === IX.prevue;
    $('bsDate').innerHTML = `${F(IX.periodes[p])} → ${F(new Date(Date.parse(IX.periodes[p] + 'T12:00:00Z') + (IX.periode_jours - 1) * 864e5).toISOString().slice(0, 10))}${prevue ? ' <span class="badge PROVISIONAL">prévision</span>' : ''}`;
    redessiner();
    if (S.choix) fiche(S.choix.lat, S.choix.lng);
  }
  function construire() {
    const sec = $('page-bassin');
    const n1 = IX.niveaux['1km']?.tuiles.length || 0, n80 = IX.niveaux['80m']?.tuiles.length || 0;
    sec.innerHTML = `
      <div class="panel bs-barre">
        <label class="field-label">Couche<select id="bsChamp">${Object.keys(AFFICHAGE).filter(c => IX.champs[c]).map(c => `<option value="${c}"${AFFICHAGE[c].expert ? ' class="expert-only"' : ''}>${esc(AFFICHAGE[c].nom)}</option>`).join('')}</select></label>
        <div class="bs-temps"><span class="field-label">Période de 12 jours</span><input type="range" id="bsPeriode" min="0" max="${IX.periodes.length - 1}" step="1"><span id="bsDate"></span></div>
        <label class="check"><input type="checkbox" id="bsMontrer" checked>Montrer les valeurs comblées et prévues</label>
        <span class="badge" id="bsNiveau"></span>
      </div>
      <div class="bs-grille">
        <div class="panel bs-carte-panel"><div id="bsCarte" class="bs-carte"></div><div class="map-legend bs-legende" id="bsLegende"></div></div>
        <aside class="panel bs-fiche" id="bsFiche"><p class="muted">Cliquez sur la carte pour voir l’évolution d’un lieu : mesures, trous comblés et prévision.</p></aside>
      </div>
      <p class="muted small">Données collectées le ${esc((IX.genere_le || '').replace('T', ' à ').replace('Z', ' UTC'))} · ${n1} tuile(s) de 1 km, ${n80} tuile(s) de 80 m · ${esc(IX.source)}.
        Une valeur « comblée » est estimée à partir des mesures d’avant et d’après (le satellite n’est pas passé, ou la mesure a été écartée) ; elle est plus pâle sur la carte.
        L’humidité du sol ne s’affiche que là où la NASA juge la mesure fiable.</p>`;
    S.p = Math.max(0, IX.prevue - 1);
    $('bsPeriode').value = S.p;
    $('bsChamp').onchange = e => { S.champ = e.target.value; legende(); redessiner(); if (S.choix) fiche(S.choix.lat, S.choix.lng); };
    $('bsPeriode').oninput = e => { S.p = +e.target.value; majPeriode(); };
    $('bsMontrer').onchange = e => { S.montrer = e.target.checked; redessiner(); };
    const E = IX.emprise;
    S.carte = L.map('bsCarte', { zoomSnap: 0.5, minZoom: 4, maxZoom: 13, attributionControl: true }).fitBounds([[E.sud, E.ouest], [E.nord, E.est]]);
    S.carte.createPane('bsApercu').style.zIndex = 300;
    S.carte.createPane('bsDetail').style.zIndex = 310;
    S.carte.getPanes().bsApercu.style.imageRendering = S.carte.getPanes().bsDetail.style.imageRendering = 'pixelated';
    if (window.SAJE_MONDE) L.geoJSON(window.SAJE_MONDE, { interactive: false, style: { color: '#64748b', weight: 0.8, fillColor: '#1e293b', fillOpacity: 0.35 } }).addTo(S.carte);
    S.carte.attributionControl.addAttribution('Radar : NASA-ISRO NISAR (ASF DAAC) · Fond : Natural Earth');
    (IX.zones_interet || []).forEach(z => L.rectangle([[z.sud, z.ouest], [z.nord, z.est]], { color: '#f5b94a', weight: 1, fill: false, dashArray: '4 4', interactive: false }).bindTooltip(z.nom).addTo(S.carte));
    S.carte.on('moveend zoomend', redessiner);
    S.carte.on('click', e => fiche(e.latlng.lat, e.latlng.lng));
    legende(); majPeriode();
  }

  window.Bassin = {
    afficher() {
      if (!IX) {
        $('page-bassin').innerHTML = `<div class="notice">Pas encore de données du bassin. Lancer <code>collecte_bassin/lancer_collecte.bat</code> puis recharger la page.</div>`;
        return;
      }
      if (!S.carte) construire();
      setTimeout(() => S.carte.invalidateSize(), 80);
    },
  };
  if (location.hash === '#bassin') setTimeout(() => window.Bassin.afficher(), 300);
})();
