/* =====================================================================
   SAJE Field — interface (statique, hors ligne, sans framework)
   Relie les données (Donnees), le moteur de raisonnement (Raisonnement),
   les calculs locaux sur le cube (Analyse) et la carte (creerCarte).
   ===================================================================== */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const M = Donnees.M;
  const R = Raisonnement;
  const N = Donnees.nombre;
  const LM = m => Donnees.libMaturite(m), LP = d => Donnees.libPol(d);
  const F = iso => Donnees.formatDate(iso);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const expert = () => document.documentElement.dataset.detail === 'expert';
  const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, def) { try { const v = localStorage.getItem('saje_' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem('saje_' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
  };

  // ------------------------------------------------------------------ icônes
  const ICONES = {
    grid: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
    book: '<path d="M4 19V6a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M8 8h7M8 12h5"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
    play: '<path d="M7 5v14l12-7z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
    polygon: '<path d="M5 7 12 3l7 5-2 10H7z"/><circle cx="5" cy="7" r="1.5"/><circle cx="12" cy="3" r="1.5"/><circle cx="19" cy="8" r="1.5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    leaf: '<path d="M12 22V12"/><path d="M12 12C12 7 8 4 4 4c0 5 3 8 8 8zM12 14c0-4 3-7 8-7 0 4-3 7-8 7z"/>',
    waves: '<path d="M2 8c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 13c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 18c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>',
    radar: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
    sprout: '<path d="M12 21v-8"/><path d="M12 13c0-4-3-6-7-6 0 4 3 6 7 6zM12 11c0-3 2.5-5 6-5 0 3-2.5 5-6 5z"/>',
    satellite: '<path d="m13 7 4 4M4 20l5-5"/><rect x="9" y="5" width="6" height="10" rx="1" transform="rotate(45 12 10)"/><path d="M5 11a6 6 0 0 0 8 8"/>',
    swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    compare: '<rect x="3" y="5" width="7" height="14" rx="1.5"/><rect x="14" y="5" width="7" height="14" rx="1.5"/><path d="M12 3v18"/>',
    dots: '<circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    tick: '<path d="m5 12 5 5 9-10"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
  };
  const svg = (n, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n] || ''}</svg>`;
  const ico = (n, s = 18) => `<span class="ico" style="width:${s}px;height:${s}px">${svg(n, s)}</span>`;
  const remplirIcones = (root = document) => $$('[data-icon]', root).forEach(el => { if (!el.innerHTML.trim()) el.innerHTML = svg(el.dataset.icon); });

  // ------------------------------------------------------------------ thèmes de la carte
  const THEMES = {
    eau: { titre: 'Eau & inondations', icone: 'waves', defaut: 'inondation', couches: [
      { id: 'inondation', nom: 'Zones inondées', question: 'Où y a-t-il de l’eau là où il n’y en a pas d’habitude ?', legende: { titre: 'Zones inondées', lignes: [['#00dcff', 'Eau hors des cours d’eau permanents']] } },
      { id: 'vegetation_inondee', nom: 'Eau sous la végétation', question: 'L’eau se cache-t-elle sous la mangrove ou la forêt ?', legende: { titre: 'Eau sous la végétation', lignes: [['#ff3ca0', 'Double rebond eau + troncs (HH ↑)']], lignesS: [['#ff3ca0', 'Eau cachée sous les arbres']], note: 'Mesurable seulement les jours HH + HV.', noteS: 'Visible seulement les jours de mesure complète.' } },
      { id: 'eau', nom: 'Eau libre', question: 'Où se trouve l’eau ce jour-là ?', legende: { titre: 'Eau libre', lignes: [['#1e78ff', 'Estuaire, rivières, lacs, crues']] } },
      { id: 'frequence_eau', nom: 'Fréquence d’inondation', globale: true, question: 'Quels lieux sont souvent sous l’eau ?', legende: { titre: 'Fréquence d’inondation', rampe: ['#ffffff', '#96c8ff', '#1450dc', '#0a1478'], bornes: ['Rarement', 'Souvent'], note: 'Part des passages calibrés où le lieu était sous l’eau.' } },
      { id: 'eau_permanente', nom: 'Eau permanente', globale: true, question: 'Où l’eau est-elle toujours présente ?', legende: { titre: 'Eau permanente', lignes: [['#0a288c', 'En eau sur au moins 80 % des passages']] } },
    ] },
    agriculture: { titre: 'Agriculture & végétation', icone: 'sprout', defaut: 'vegetation', couches: [
      { id: 'vegetation', nom: 'Végétation', question: 'Où la végétation est-elle dense ou clairsemée ?', legende: { titre: 'Densité de végétation (HV − HH)', titreS: 'Densité de végétation', rampe: ['#785028', '#e6d278', '#28963c', '#0a501e'], bornes: ['Sol nu', 'Dense'], note: 'Mesurable seulement les jours HH + HV.', noteS: 'Visible seulement les jours de mesure complète.' } },
      { id: 'anomalie', nom: 'Écart à la normale', question: 'Où la surface a-t-elle changé par rapport à d’habitude ?', legende: { titre: 'Écart à la normale (HH)', rampe: ['#1e5ac8', '#f5f5f5', '#c82828'], bornes: ['Plus sombre', 'Plus brillant'], note: 'Bleu : plus sec, récolte. Rouge : plus humide, pousse.' } },
      { id: 'changement', nom: 'Depuis la saison sèche', question: 'Qu’est-ce qui a changé depuis juillet 2026 ?', legende: { titre: 'Changement depuis le 2 juillet 2026', rampe: ['#1e5ac8', '#f5f5f5', '#c82828'], bornes: ['Baisse', 'Hausse'] } },
      { id: 'humidite', nom: 'Humidité du sol (SME2)', nomS: 'Humidité du sol', question: 'Les sols sont-ils secs ou saturés ?', legende: { titre: 'Humidité du sol SME2', titreS: 'Humidité du sol', lignes: [['#d6a448', 'Sec (< 0,20 m³/m³)'], ['#4fbeaa', 'Humide'], ['#3878e6', 'Saturé (≥ 0,35)']], note: 'Couleurs pâles : pixel refusé par le contrôle qualité NASA. Sur l’Estuaire, aucun pixel ne passe ce contrôle : aperçu seulement.', noteS: 'Couleurs pâles : mesure jugée peu fiable par la NASA. Ici, aucune mesure n’est fiable : simple aperçu.' } },
      { id: 'urbain', nom: 'Zones urbaines', globale: true, question: 'Où se trouve le bâti (exclu des calculs) ?', legende: { titre: 'Zones urbaines', lignes: [['#ffaa00', 'Bâti détecté par le radar']] } },
    ] },
    radar: { titre: 'Image radar', icone: 'radar', defaut: 'rgb', couches: [
      { id: 'rgb', nom: 'Couleurs radar', question: 'À quoi ressemble la province vue par NISAR ?', legende: { titre: 'Composition colorée HH / HV', titreS: 'Couleurs du radar', lignes: [['#2fa34a', 'Forêt et cultures'], ['#f0c8f0', 'Ville'], ['#10141c', 'Eau calme']], note: 'Disponible les jours HH + HV.', noteS: 'Disponible les jours de mesure complète.' } },
      { id: 'hh', nom: 'Polarisation HH', expert: true, question: 'Signal HH brut (filtre de Lee).', legende: { titre: 'Polarisation HH', rampe: ['#000', '#fff'], bornes: ['Faible', 'Fort'] } },
      { id: 'hv', nom: 'Polarisation HV', expert: true, question: 'Signal HV brut, lié à la végétation.', legende: { titre: 'Polarisation HV', rampe: ['#000', '#fff'], bornes: ['Faible', 'Fort'] } },
    ] },
  };
  const coucheDe = (t, id) => THEMES[t].couches.find(c => c.id === id);
  const dispo = (c, d) => c?.globale ? !!M.globales?.[c.id] : !!d?.images?.[c?.id];
  function legende(l) {
    if (!l) return '';
    const an = expert();
    let h = `<strong>${an ? l.titre : l.titreS || l.titre}</strong>`;
    const lignes = an ? l.lignes : l.lignesS || l.lignes, note = an ? l.note : l.noteS || l.note;
    if (lignes) h += lignes.map(([c, t]) => `<div class="row"><span class="sw" style="background:${c}"></span>${t}</div>`).join('');
    if (l.rampe) h += `<div class="ramp" style="background:linear-gradient(90deg,${l.rampe.join(',')})"></div><div class="row" style="justify-content:space-between"><span>${l.bornes[0]}</span><span>${l.bornes[1]}</span></div>`;
    if (note) h += `<span class="note">${note}</span>`;
    return h;
  }

  // ------------------------------------------------------------------ état
  const SUIVIES = Donnees.nomsZones();
  const PROVINCE = SUIVIES.find(n => /Province/.test(n)) || SUIVIES[0];
  const calibrees = M.dates.filter(d => d.maturite !== 'BETA');
  const S = {
    page: 'carte', zone: PROVINCE, date: M.dates.at(-1), theme: 'eau', couche: 'inondation',
    comparer: true, avant: null, metrique: 'inondation', beta: false, analyse: null,
    perso: store.get('zones', []), point: null, outil: null, enLigne: false,
  };
  const cache = { series: {}, ids: {} };

  const geometrieDe = nom => Donnees.zonesSuivies().find(f => f.properties.nom === nom)?.geometry || S.perso.find(z => z.nom === nom)?.geometry || (S.point?.nom === nom ? S.point.geometry : null);
  const surfaceDe = nom => (/Province/.test(nom) ? M.surfaces_km2?.[nom] : null) ?? Donnees.surfaces[nom] ?? S.perso.find(z => z.nom === nom)?.surface ?? (S.point?.nom === nom ? S.point.surface : null);
  const estPerso = nom => S.perso.some(z => z.nom === nom) || S.point?.nom === nom;

  /** Série d'une zone : précalculée (zones suivies) ou calculée sur le cube (zones dessinées, points). */
  async function serieDe(nom) {
    if (M.series?.[nom] && /Province/.test(nom)) return M.series[nom];
    if (cache.series[nom]) return cache.series[nom];
    await Analyse.charger();
    let ids, opts = {};
    if (S.point?.nom === nom) { ids = S.point.ids; opts = S.point.opts || { tout: true }; }
    else ids = cache.ids[nom] ||= Analyse.indices(geometrieDe(nom));
    const serie = M.dates.map(d => Analyse.stats(ids, d, S.point?.nom === nom && S.point.ponctuel !== false, opts)).filter(p => p && p.pixels > 0);
    cache.series[nom] = serie;
    const z = S.perso.find(x => x.nom === nom);
    if (z && !z.surface && serie.length) { z.surface = serie.at(-1).surface_observee_km2; store.set('zones', S.perso); }
    if (S.point?.nom === nom && serie.length) S.point.surface = serie.at(-1).surface_observee_km2;
    return serie;
  }

  // ------------------------------------------------------------------ petits outils d'affichage
  function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2400); }
  function compter(el, vers, dec = 1, suffixe = '') {
    if (vers == null || Number.isNaN(vers)) { el.textContent = '—'; return; }
    if (reduit) { el.innerHTML = N(vers, dec) + suffixe; return; }
    const t0 = performance.now(), de = 0, dur = 700;
    const pas = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.innerHTML = N(de + (vers - de) * e, dec) + suffixe; if (k < 1) requestAnimationFrame(pas); };
    requestAnimationFrame(pas);
  }
  /** Petite courbe avec la bande de normale de la zone. */
  function spark(vals, couleur, band) {
    const v = vals.map(x => x == null ? null : +x);
    const ok = v.filter(x => x != null);
    if (ok.length < 2) return '<div class="spark"></div>';
    let min = Math.min(...ok), max = Math.max(...ok);
    if (band) { min = Math.min(min, band[0]); max = Math.max(max, band[1]); }
    const e = (max - min) || 1, W = 100, H = 40, y = x => H - 4 - ((x - min) / e) * (H - 10);
    const pts = v.map((x, i) => x == null ? null : [i / (v.length - 1) * W, y(x)]).filter(Boolean);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const b = band ? `<rect x="0" y="${y(band[1]).toFixed(1)}" width="${W}" height="${Math.max(1, y(band[0]) - y(band[1])).toFixed(1)}" fill="${couleur}" opacity=".12"/>` : '';
    const fin = pts.at(-1);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${b}<path d="${d}" fill="none" stroke="${couleur}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle cx="${fin[0]}" cy="${fin[1]}" r="2.6" fill="${couleur}"/></svg>`;
  }
  const ETATS = { normal: 'Dans la normale', haut: 'Au-dessus de la normale', tres_haut: 'Bien au-dessus', bas: 'En dessous de la normale', tres_bas: 'Bien en dessous', inconnu: 'Sans normale' };
  const badgeConf = c => c ? `<span class="badge ${c.niveau}" title="${esc(c.facteurs.map(f => f[1]).join(' · '))}">${esc(c.libelle)}</span>` : '';
  const libDate = d => `${F(d.date)} · ${LM(d.maturite)} · ${d.gcov_disponible === false ? (expert() ? 'SME2 seul' : 'humidité seule') : LP(d)}`;

  // ------------------------------------------------------------------ carte
  // Le tableau de bord n'a plus de carte : la carte interactive est la page d'arrivée.
  // Les appels restants à « carte » deviennent sans effet.
  const carte = new Proxy({}, { get: (_, k) => k === 'dessin' ? { debut() {}, ajouter() {}, fin: () => [], annuler() {}, nb: () => 0 } : () => {} });

  function majCarte() {
    frise.maj(x => x.gcov_disponible !== false);
    const cal = M.dates.filter(d => d.maturite !== 'BETA');
    $('passesInfo').textContent = expert()
      ? `${M.dates.length} passages · orbite ${M.dates[0].orbite} · ${cal.length} calibrés · ${M.dates.filter(d => d.double_pol).length} en HH + HV`
      : `${M.dates.length} passages, dont ${cal.length} fiables · un passage tous les 12 jours`;
  }
  function ongletsThemes() {
    if (!$('themeTabs')) return;
    $('themeTabs').innerHTML = Object.entries(THEMES).map(([id, t]) =>
      `<button class="tab" role="tab" data-theme="${id}" aria-selected="${id === S.theme}">${ico(t.icone)}<span>${t.titre}</span></button>`).join('');
  }

  // ------------------------------------------------------------------ frise des passages
  const frise = (() => {
    const el = $('timeline');
    const ts = d => new Date(d + 'T12:00:00Z').getTime();
    const t0 = ts(M.dates[0].date), t1 = ts(M.dates.at(-1).date);
    const x = d => t1 > t0 ? (ts(d) - t0) / (t1 - t0) * 100 : 50;
    let minuteur = null, ok = () => true;
    el.innerHTML = `<button class="play" id="play" aria-label="Lire les passages les uns après les autres" aria-pressed="false">${ico('play')}</button>
      <button class="icon-button" id="prev" aria-label="Passage précédent">${ico('left')}</button>
      <div class="tl-mid"><div class="tl-cap"><strong id="tlCur"></strong><span id="tlPos"></span></div><div class="track" id="track"><span class="fill" id="tlFill"></span></div>
        <div class="tl-ends"><span>${F(M.dates[0].date)}</span><span>${F(M.dates.at(-1).date)}</span></div></div>
      <button class="icon-button" id="next" aria-label="Passage suivant">${ico('right')}</button>`;
    const piste = $('track');
    for (let i = 1; i < M.dates.length; i++) {
      const a = M.dates[i - 1].date, b = M.dates[i].date;
      if (ts(b) - ts(a) > 30 * 864e5) {
        const g = document.createElement('span');
        g.className = 'gap'; g.style.left = x(a) + 1.2 + '%'; g.style.width = Math.max(0, x(b) - x(a) - 2.4) + '%';
        g.title = `Aucune donnée NISAR publiée entre le ${F(a)} et le ${F(b)}`;
        piste.appendChild(g);
      }
    }
    const pts = M.dates.map((d, i) => {
      const b = document.createElement('button');
      b.className = 'tdot' + (d.maturite === 'VALIDATED' ? ' v' : '') + (d.maturite === 'BETA' ? ' b' : '') + (d.double_pol ? ' dual' : '');
      b.style.left = x(d.date) + '%';
      b.setAttribute('aria-label', libDate(d));
      b.title = libDate(d);
      b.onclick = () => { arreter(); choisirDate(d); };
      piste.appendChild(b);
      return b;
    });
    const idx = () => M.dates.indexOf(S.date);
    function maj(f) {
      if (f) ok = f;
      const i = idx();
      const dA = S.comparer ? M.dates.find(d => d.date + '|' + d.orbite === S.avant) : null;
      pts.forEach((p, k) => { p.classList.toggle('on', k === i); p.classList.toggle('a', M.dates[k] === dA); p.classList.toggle('na', !ok(M.dates[k])); p.setAttribute('aria-current', k === i ? 'true' : 'false'); });
      $('tlFill').style.width = x(S.date.date) + '%';
      $('tlCur').textContent = F(S.date.date);
      $('tlPos').textContent = `passage ${i + 1} / ${M.dates.length} · ${LM(S.date.maturite)}`;
      $('prev').disabled = i === 0; $('next').disabled = i === M.dates.length - 1;
    }
    function arreter() { clearInterval(minuteur); minuteur = null; $('play').innerHTML = ico('play'); $('play').setAttribute('aria-pressed', 'false'); }
    $('play').onclick = () => {
      if (minuteur) return arreter();
      $('play').innerHTML = ico('pause'); $('play').setAttribute('aria-pressed', 'true');
      minuteur = setInterval(() => {
        let j = idx();
        for (let k = 0; k < M.dates.length; k++) { j = (j + 1) % M.dates.length; if (ok(M.dates[j])) break; }
        choisirDate(M.dates[j]);
      }, 1500);
    };
    $('prev').onclick = () => { arreter(); choisirDate(M.dates[Math.max(0, idx() - 1)]); };
    $('next').onclick = () => { arreter(); choisirDate(M.dates[Math.min(M.dates.length - 1, idx() + 1)]); };
    return { maj, arreter };
  })();

  // ------------------------------------------------------------------ verdict + indicateurs
  function afficherVerdict(a) {
    const v = a.verdict;
    const icone = { normal: 'check', attention: 'alert', alerte: 'alert', info: 'info', inconnu: 'question' }[v.niveau] || 'info';
    const pc = Math.round(a.confiance.score * 100);
    $('verdict').dataset.niveau = v.niveau;
    $('verdict').innerHTML = `
      <div class="v-icon">${ico(icone, 32)}</div>
      <div class="v-body">
        <p class="eyebrow">${esc(R.a(a.zone).replace(/^./, c => c.toUpperCase()))} · ${F(a.date.date)}</p>
        <h2 id="verdictTitle">${esc(v.titre)}</h2>
        <p>${esc(v.texte)}</p>
        <div class="v-tags"><span class="badge ${a.date.maturite}">${LM(a.date.maturite)}</span><span class="badge">${LP(a.date)}</span>
          <span class="badge">${expert() ? `${a.exploitables} / ${a.total} indicateurs exploitables` : `${a.exploitables} mesure${a.exploitables > 1 ? 's' : ''} fiable${a.exploitables > 1 ? 's' : ''} sur ${a.total}`}</span>
          <button class="link-btn" id="whyBtn">Pourquoi cette conclusion ? ↓</button></div>
      </div>
      <div class="v-side"><div class="gauge" style="--p:${pc}" role="img" aria-label="Confiance moyenne des indicateurs : ${pc} sur 100"><span>${pc}<small>CONFIANCE</small></span></div></div>`;
    $('whyBtn').onclick = () => { if (!$('reasoning').classList.contains('ouvert')) $('reasonToggle').click(); $('reasoning').scrollIntoView({ behavior: reduit ? 'auto' : 'smooth', block: 'start' }); };
  }

  function dernierDouble(serie, d) {
    return [...M.dates].reverse().find(x => x.date <= d.date && x.double_pol && x.maturite !== 'BETA' && serie.some(p => p.date === x.date && p.HVmoinsHH_dB != null)) || null;
  }

  function afficherMetriques(a, serie) {
    const ev = id => a.evals.find(e => e.id === id);
    const NIV = { alerte: 'tres_haut', attention: 'haut', info: 'info', normal: 'normal' };
    const cls = id => NIV[a.constats.find(c => c.id === id)?.niveau] || 'inconnu';
    const cal = serie.filter(p => p.maturite !== 'BETA');
    const carteM = (o) => `<article class="metric" style="--m-col:${o.col}">
      <div class="m-top"><span class="m-ico">${ico(o.icone)}</span><span class="m-lbl">${o.lbl}</span></div>
      <div class="m-val ${o.na ? 'na' : ''}" data-val="${o.val ?? ''}" data-dec="${o.dec ?? 1}" data-suf="${esc(o.suf || '')}">${o.na ? esc(o.naTxt) : '—'}</div>
      <div class="m-sub">${o.sub || '&nbsp;'}</div>
      ${o.spark || ''}
      <div class="m-foot">${o.pill ? `<span class="state-pill ${o.etat}">${o.pill}</span>` : ''}${o.conf ? badgeConf(o.conf) : ''}</div></article>`;
    const pctKm = (e, cle, id, lbl, icone, col) => {
      if (!e.exploitable) return carteM({ lbl, icone, col, na: true, naTxt: 'Non mesuré', sub: esc(e.raisons[0]), spark: spark(cal.map(p => p[cle]), col) });
      const n = e.normale;
      return carteM({ lbl, icone, col, val: e.km2 ?? e.valeur, dec: (e.km2 ?? 0) < 10 ? 1 : 0, suf: e.km2 != null ? '<small>km²</small>' : '<small>%</small>',
        sub: n.ok ? `normale ≈ ${N(e.km2Normale ?? n.mediane, (e.km2Normale ?? 0) < 10 ? 1 : 0)} ${e.km2Normale != null ? 'km²' : '%'} · ${N(e.valeur)} % de la zone` : `${N(e.valeur)} % de la zone`,
        spark: spark(cal.map(p => (!e.ind.besoinHV || p.double_pol) ? p[cle] : null), col, n.ok ? [Math.max(0, n.bas), n.haut] : null),
        pill: ETATS[e.etat], etat: cls(id), conf: e.conf });
    };
    const out = [];
    out.push(pctKm(ev('inondation'), 'part_inondation_pct', 'inondation', 'Zones inondées', 'waves', '#38bdf8'));
    out.push(pctKm(ev('vegetation_inondee'), 'part_vegetation_inondee_pct', 'vegetation_inondee', 'Eau sous la végétation', 'drop', '#22d3ee'));
    // végétation : la dernière mesure HH + HV si ce passage n'en a pas
    let ve = { ...ev('vegetation'), date: S.date }, note = '';
    if (!ve.exploitable) {
      const dd = dernierDouble(serie, S.date);
      if (dd) { ve = { ...R.evaluer('vegetation', R.completer(serie), dd, null), date: dd }; note = `Dernière mesure : ${F(dd.date)}`; }
    }
    if (ve.exploitable) {
      const lib = { normal: 'Stable', haut: 'Plus dense', tres_haut: 'Bien plus dense', bas: 'Clairsemée', tres_bas: 'Très clairsemée', inconnu: 'Mesurée' }[ve.etat];
      out.push(carteM({ lbl: 'Végétation', icone: 'leaf', col: '#4ade80', na: true, naTxt: lib, sub: (note ? note + ' · ' : '') + (expert() ? `HV − HH ${N(ve.valeur)} dB` : 'densité comparée à d’habitude'),
        spark: spark(serie.filter(p => p.double_pol && p.maturite !== 'BETA').map(p => p.HVmoinsHH_dB), '#4ade80', ve.normale.ok ? [ve.normale.bas, ve.normale.haut] : null),
        pill: ETATS[ve.etat], etat: ve.date === S.date ? cls('vegetation') : (/bas/.test(ve.etat) ? 'haut' : 'normal'), conf: ve.conf }));
    } else out.push(carteM({ lbl: 'Végétation', icone: 'leaf', col: '#4ade80', na: true, naTxt: 'Non mesurée', sub: esc(ve.raisons[0]) }));
    const hu = ev('humidite');
    if (hu.exploitable) out.push(carteM({ lbl: 'Humidité du sol', icone: 'drop', col: '#a78bfa', val: hu.valeur, dec: 2, suf: '<small>m³/m³</small>', sub: `sols majoritairement ${hu.classes.dominante}s`, pill: ETATS[hu.etat], etat: cls('humidite'), conf: hu.conf }));
    else {
      const p = hu.point;
      out.push(carteM({ lbl: 'Humidité du sol', icone: 'drop', col: '#a78bfa', na: true, naTxt: expert() ? 'Non exploitable' : 'Pas fiable ici',
        sub: expert() ? (p?.sol_mesure_pct ? `SME2 présent sur ${N(p.sol_mesure_pct, 0)} % de la zone, 0 pixel fiable` : 'Pas de produit SME2 ce jour-là')
          : (p?.sol_mesure_pct ? 'Mesurée, mais jugée peu fiable par la NASA (forêt dense, pluie)' : 'Pas mesurée ce jour-là'),
        pill: 'Pas de conclusion', etat: 'inconnu' }));
    }
    $('metrics').innerHTML = out.join('');
    $$('#metrics .m-val[data-val]').forEach(el => { if (el.dataset.val !== '') compter(el, +el.dataset.val, +el.dataset.dec, ' ' + el.dataset.suf); });
  }

  // ------------------------------------------------------------------ inspecteur
  function afficherInspecteur(a) {
    $('inspTitle').textContent = a.zone;
    const liste = a.constats.length ? a.constats : [];
    $('constats').innerHTML = liste.length ? liste.map((c, i) => `
      <article class="constat ${c.niveau}" style="animation-delay:${i * 40}ms">
        <h3>${esc(c.titre)}</h3>
        <p>${esc(c.texte)}</p>
        <p class="proof">${esc(c.preuve)}</p>
        ${badgeConf(c.conf)}
        <ul class="factors expert-only">${c.conf.facteurs.map(f => `<li data-s="${f[0]}">${esc(f[1])}</li>`).join('')}</ul>
      </article>`).join('')
      : `<article class="constat"><h3>Aucun indicateur exploitable</h3><p>Pour ce passage et cette zone, aucune donnée ne remplit les conditions de qualité. SAJE Field ne tire donc aucune conclusion.</p></article>`;
    const u = a.inconnues;
    $('unknowns').hidden = !u.length;
    $('unknowns').innerHTML = `<summary>Ce que les données ne permettent pas de dire (${u.length})</summary><ul>${u.map(x => `<li><b>${esc(x.libelle)}</b> : ${esc(x.raisons[0])}</li>`).join('')}</ul>`;
  }

  // ------------------------------------------------------------------ raisonnement
  function plage(e) {
    const n = e.normale, ind = e.ind;
    const vals = [e.valeur, n.bas, n.haut, n.min, n.max].filter(x => x != null);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (ind.unite === 'pct') lo = Math.max(0, lo);
    const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
    if (ind.unite === 'pct') lo = Math.max(0, lo);
    const p = x => Math.max(0, Math.min(100, (x - lo) / (hi - lo) * 100));
    const u = ind.unite === 'pct' ? ' %' : ind.unite === 'dB' ? ' dB' : '';
    const out = e.etat !== 'normal';
    return `<div class="range-row"><span class="lbl"><span>${esc(ind.libelle)}</span><span><b>${N(e.valeur)}${u}</b> <span class="muted">· normale ${N(n.mediane)}${u}</span></span></span>
      <div class="range" role="img" aria-label="${esc(ind.libelle)} : ${N(e.valeur)}${u}, normale entre ${N(Math.max(ind.unite === 'pct' ? 0 : -99, n.bas))} et ${N(n.haut)}${u}">
        <span class="band" style="left:${p(Math.max(lo, n.bas))}%;width:${p(n.haut) - p(Math.max(lo, n.bas))}%"></span><span class="med" style="left:${p(n.mediane)}%"></span>
        <span class="cur ${out ? 'out' : ''}" style="left:${p(e.valeur)}%"></span></div></div>`;
  }
  function afficherRaisonnement(a) {
    const e1 = a.evals.map(e => e.exploitable
      ? `<li><span class="ok">${ico('check', 16)}</span><span><b>${esc(e.libelle)}</b><small>utilisé · ${esc(e.conf.libelle.toLowerCase())}</small></span></li>`
      : `<li><span class="ko">${ico('close', 16)}</span><span><b>${esc(e.libelle)}</b><small>écarté : ${esc(e.raisons[0])}</small></span></li>`).join('');
    const avecNormale = a.evals.filter(e => e.exploitable && e.normale.ok);
    const e2 = avecNormale.length ? avecNormale.map(plage).join('') + `<p class="muted small">Bande verte : normale de la zone (médiane ± 2 écarts robustes, ${avecNormale[0].normale.n} passages calibrés de la même orbite). Point orange : hors de la normale.</p>`
      : '<p class="muted">Pas assez de passages comparables pour établir une normale.</p>';
    const e3 = `<ul class="reco-list">${a.recommandations.map(r => `<li class="reco ${r.niveau}"><span class="lvl" aria-hidden="true"></span><span>${esc(r.texte)}</span></li>`).join('')}</ul>`;
    $('reasonSteps').innerHTML = `
      <li class="step"><h3>Vérifier chaque donnée</h3><ul class="ind-list">${e1}</ul></li>
      <li class="step"><h3>Comparer à la normale ${esc(R.de(a.zone))}</h3>${e2}</li>
      <li class="step"><h3>Conclure et recommander</h3>${e3}</li>`;
  }

  // ------------------------------------------------------------------ prévision du prochain passage
  const PM = id => Prediction.modele(id) || { nom: id, savant: id, comment: '' };
  const uni = (ind, v) => v == null ? '—' : ind.unite === 'pct' ? `${N(v)} %` : ind.unite === 'dB' ? `${N(v)} dB` : `${N(v, 3)} m³/m³`;
  const km2 = v => `${N(v, Math.abs(v) < 10 ? 1 : 0)} km²`;
  /** Valeur prévue et intervalle, en km² quand c'est possible (plus parlant que des %). */
  function fourchette(p) {
    if (p.km2 != null) return { val: km2(p.km2), de: km2(p.km2Bas), a: km2(p.km2Haut) };
    return { val: uni(p.ind, p.valeur), de: uni(p.ind, p.bas), a: uni(p.ind, p.haut) };
  }
  const SENS = { haut: { inondation: 'plus d’eau que d’habitude hors des cours d’eau', vegetation_inondee: 'plus d’eau sous la végétation que d’habitude', eau: 'plus d’eau libre que d’habitude', vegetation: 'une végétation plus dense que d’habitude', anomalie: 'une surface plus « brillante » que d’habitude', humidite: 'des sols plus humides que d’habitude' },
    bas: { inondation: 'moins d’eau que d’habitude', vegetation_inondee: 'moins d’eau sous la végétation', eau: 'moins d’eau libre que d’habitude', vegetation: 'une végétation plus clairsemée que d’habitude', anomalie: 'une surface plus « sombre » que d’habitude', humidite: 'des sols plus secs que d’habitude' } };
  function cartePrevision(p) {
    const f = fourchette(p), r = p.risque, md = PM(p.modele.id), an = expert();
    const pr = r ? Math.round(r.p * 100) : null;
    const etat = pr == null ? 'inconnu' : pr >= 60 ? 'haut' : pr >= 30 ? 'info' : 'normal';
    const risqueTxt = pr == null ? (an ? 'Normale indisponible (< 4 passages)' : 'Pas encore de comparaison possible')
      : `${pr} % de chances d’observer ${SENS[r.sens][p.id]}`;
    const meilleurs = [...p.scores].sort((a, b) => a.mae - b.mae);
    const pers = p.scores.find(x => x.id === 'persistance');
    const pourquoi = an
      ? `${md.savant}${Object.keys(p.modele.params || {}).length ? ' (' + Object.entries(p.modele.params).map(([k, v]) => `${k} = ${N(v, 2)}`).join(', ') + ')' : ''} · erreur moyenne passée ${uni(p.ind, p.mae)} sur ${p.m} passages${pers && p.modele.id !== 'persistance' ? ` (persistance : ${uni(p.ind, pers.mae)})` : ''}`
      : `Méthode retenue : « ${md.nom} », celle qui s’est le moins trompée sur les ${p.m} derniers passages.`;
    const tendance = p.tendanceMois != null && p.modele.id !== 'persistance' && p.modele.id !== 'normale' && p.modele.id !== 'lissage'
      ? `<p class="small muted">Tendance estimée : ${p.tendanceMois > 0 ? '+' : ''}${uni(p.ind, p.tendanceMois)} par mois.</p>` : '';
    const rt = p.retro;
    const retro = rt ? `<p class="fc-retro ${rt.conforme ? 'ok' : 'ko'}">${ico(rt.conforme ? 'check' : 'alert', 14)}<span>${an ? 'Contrôle a posteriori' : 'Vérification'} : pour le ${F(rt.date)}, la méthode prévoyait ${uni(p.ind, rt.prevu)} (de ${uni(p.ind, rt.bas)} à ${uni(p.ind, rt.haut)}) ; mesuré : ${uni(p.ind, rt.mesure)}. ${rt.conforme ? 'Prévision juste.' : 'Mesure hors de la fourchette : changement inattendu.'}</span></p>` : '';
    const tableau = `<details class="fc-models expert-only"><summary>Les 6 méthodes testées</summary><table><thead><tr><th>Méthode</th><th>Erreur moyenne</th></tr></thead><tbody>${
      meilleurs.map(x => `<tr class="${x.choisi ? 'sel' : ''}"><td>${esc(PM(x.id).savant)}${x.choisi ? ' ✓' : ''}</td><td>${Number.isFinite(x.mae) ? (p.ind.unite === "m3" ? uni(p.ind, x.mae) : `${N(x.mae, 3)} ${p.ind.unite === "pct" ? "%" : "dB"}`) : '—'}</td></tr>`).join('')}</tbody></table>
      <p class="small muted">Chaque méthode a prévu chaque passage passé en ne connaissant que les précédents. Calcul : ${p.source === 'python' ? 'programme Python (prevision/prevoir.py)' : 'navigateur'}.</p></details>`;
    return `<article class="fc-card" data-etat="${etat}" data-unite="${p.ind.unite}">
      <div class="fc-top"><span class="m-lbl">${esc(p.ind.libelle)}</span>${badgeConf({ ...p.conf, libelle: an ? `Confiance ${p.conf.niveau} (${N(p.conf.score, 2)})` : { bonne: 'Fiable', moyenne: 'Assez fiable', faible: 'Peu fiable' }[p.conf.niveau] })}</div>
      <div class="fc-val">${f.val}</div>
      <div class="m-sub">${an ? 'intervalle à 95 %' : 'probablement'} entre ${f.de} et ${f.a}</div>
      <span class="state-pill ${etat}">${esc(risqueTxt)}</span>
      <p class="small fc-why">${esc(pourquoi)}</p>${tendance}${retro}${tableau}
    </article>`;
  }
  function afficherPrevisions(a) {
    const liste = a.previsions || [];
    const ok = liste.filter(p => p.ok), non = liste.filter(p => !p.ok);
    const cible = ok[0]?.cible.date;
    const py = ok.find(p => p.source === 'python');
    $('forecastSub').textContent = !ok.length ? '' : `Passage attendu vers le ${F(cible)} · ${py ? `calculé par le programme Python le ${(py.calculeLe || '').replace('T', ' à ').replace('Z', ' UTC')}` : 'calculé dans le navigateur'}`;
    $('exportForecast').hidden = !ok.length;
    $('forecastCards').innerHTML = ok.length ? ok.map(cartePrevision).join('')
      : `<article class="constat"><h3>Pas de prévision possible ici</h3><p>Il faut au moins ${Prediction.MIN_OBS} passages comparables pour tester une méthode de prévision. SAJE Field préfère ne rien annoncer.</p></article>`;
    $('forecastNo').hidden = !non.length;
    $('forecastNo').innerHTML = `<summary>${expert() ? 'Indicateurs sans prévision' : 'Ce qu’on ne peut pas encore prévoir'} (${non.length})</summary><ul>${non.map(p => `<li><b>${esc(p.ind.libelle)}</b> : ${esc(p.raison)}</li>`).join('')}</ul>`;
    remplirIcones($('forecast'));
  }
  function methodePrevision() {
    $('forecastMethod').innerHTML = `<ol class="algo">
      <li><b>Des passages comparables seulement</b>Même orbite, données calibrées, polarisation suffisante, contrôle qualité validé, et jamais de passage postérieur à la date choisie.</li>
      <li><b>Six méthodes simples, en concurrence</b>${Prediction.IDS.map(id => `« ${esc(PM(id).nom)} »`).join(', ')}. Chacune lit les passages dans l’ordre et se met à jour à chaque nouveau passage.</li>
      <li><b>Un test honnête sur le passé</b>Chaque méthode prévoit chaque passage passé en ne connaissant que les précédents ; ses réglages (α, β, φ, q) sont optimisés de la même façon (section dorée ou grille).</li>
      <li><b>La plus juste, à simplicité égale</b>On garde la méthode qui s’est le moins trompée. Une méthode plus compliquée doit faire au moins 5 % mieux pour être choisie.</li>
      <li><b>Une fourchette, pas un chiffre magique</b>L’intervalle à 95 % vient des erreurs passées de la méthode, élargi quand il y a peu de passages (loi de Student).</li>
      <li><b>Une prévision qui reste prudente</b>Seules les prévisions de confiance moyenne ou bonne, avec au moins 60 % de chances de sortir de la normale, deviennent une recommandation.</li>
    </ol><p class="muted">Ces prévisions sont statistiques : elles prolongent ce que le radar a vu, sans modèle météo. Une forte pluie imprévue peut les démentir.</p>`;
  }

  // ------------------------------------------------------------------ courbe
  let graphe = null;
  function afficherCourbe(serie) {
    const ind = R.IND[S.metrique];
    const s = R.completer(serie).filter(p => S.beta || p.maturite !== 'BETA');
    const val = p => (ind.besoinHV && !p.double_pol) ? null : p[ind.cle];
    const has = s.some(p => val(p) != null);
    const css = getComputedStyle(document.documentElement);
    const C = k => css.getPropertyValue(k).trim();
    const nrm = R.normale(R.completer(serie), ind, { orbite: S.date.orbite, date: '—' });
    $('chartEmpty').hidden = has;
    if (!has) {
      const e = R.evaluer(S.metrique, R.completer(serie), S.date, null);
      $('chartEmpty').innerHTML = `<div><b>${esc(ind.libelle)} : aucune valeur exploitable.</b><br><span>${esc(e.raisons[0] || 'Aucune mesure fiable dans la série.')}</span></div>`;
    }
    // axe des dates : les passages, plus la date du passage prévu si elle n'en fait pas partie
    const pv = S.analyse?.previsions?.find(p => p.id === S.metrique && p.ok);
    const dates = [...new Set([...s.map(p => p.date), ...(pv ? [pv.cible.date] : [])])].sort();
    const parDate = Object.fromEntries(s.map(p => [p.date, p]));
    const lab = dates.map(x => Donnees.dmy(x) + (parDate[x] ? '' : ' (prév.)'));
    const col = { inondation: '#38bdf8', vegetation_inondee: '#22d3ee', eau: '#60a5fa', vegetation: '#4ade80', anomalie: '#f5b94a', humidite: '#a78bfa' }[S.metrique];
    const iSel = dates.indexOf(S.date.date);
    const jeux = [];
    if (nrm.ok) {
      const lo = ind.unite === 'pct' ? Math.max(0, nrm.bas) : nrm.bas;
      jeux.push({ label: 'Normale (haut)', data: dates.map(() => nrm.haut), borderColor: 'transparent', pointRadius: 0, fill: '+1', backgroundColor: 'rgba(74,222,128,.14)' });
      jeux.push({ label: 'Normale (bas)', data: dates.map(() => lo), borderColor: 'transparent', pointRadius: 0, fill: false });
      jeux.push({ label: 'Médiane', data: dates.map(() => nrm.mediane), borderColor: 'rgba(74,222,128,.7)', borderDash: [4, 4], borderWidth: 1.2, pointRadius: 0 });
    }
    if (pv) {
      // segment pointillé du dernier passage utilisé jusqu'au passage prévu, et son intervalle à 95 %
      const i0 = dates.indexOf(pv.depuis), i1 = dates.indexOf(pv.cible.date), y0 = parDate[pv.depuis]?.[ind.cle];
      const serieP = v => dates.map((x, i) => i === i0 ? y0 : i === i1 ? v : null);
      jeux.push({ label: 'Prévision (haut)', data: serieP(pv.haut), borderColor: 'transparent', pointRadius: 0, fill: '+1', backgroundColor: 'rgba(245,185,74,.16)', spanGaps: true });
      jeux.push({ label: 'Prévision (bas)', data: serieP(pv.bas), borderColor: 'transparent', pointRadius: 0, fill: false, spanGaps: true });
      jeux.push({ label: 'Prévision', data: serieP(pv.valeur), borderColor: '#f5b94a', backgroundColor: '#f5b94a', borderDash: [6, 4], borderWidth: 2, spanGaps: true,
        pointRadius: dates.map((x, i) => i === i1 ? 6 : 0), pointStyle: 'rectRot' });
    }
    jeux.push({ label: ind.libelle, data: dates.map(x => parDate[x] ? val(parDate[x]) : null), borderColor: col, backgroundColor: col, tension: 0.35, spanGaps: true, borderWidth: 2.5,
      pointRadius: dates.map((x, i) => !parDate[x] ? 0 : i === iSel ? 7 : parDate[x].maturite === 'BETA' ? 3 : 4), pointBackgroundColor: dates.map(x => parDate[x]?.maturite === 'BETA' ? 'transparent' : col), pointBorderColor: col, pointBorderWidth: 2 });
    if (graphe) graphe.destroy();
    graphe = new Chart($('trendChart'), {
      type: 'line', data: { labels: lab, datasets: jeux },
      options: {
        responsive: true, maintainAspectRatio: false, animation: reduit ? false : { duration: 500 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: C('--muted'), boxWidth: 12, font: { size: 11 }, filter: l => !/Normale|Prévision \(/.test(l.text) } },
          tooltip: { filter: i => !/Normale|Prévision \(/.test(i.dataset.label) && !(i.dataset.label === 'Prévision' && i.dataIndex !== dates.indexOf(pv?.cible.date)), callbacks: { label: c => ` ${c.dataset.label} : ${c.parsed.y == null ? '—' : N(c.parsed.y, ind.unite === 'm3' ? 3 : 2)}${ind.unite === 'pct' ? ' %' : ind.unite === 'dB' ? ' dB' : ''}` } },
        },
        scales: {
          x: { ticks: { color: C('--muted'), maxRotation: 0, autoSkip: true }, grid: { color: C('--line2') } },
          y: { ticks: { color: C('--muted'), callback: v => ind.unite === 'pct' ? v + ' %' : v }, grid: { color: C('--line2') }, beginAtZero: ind.unite === 'pct' },
        },
      },
    });
    $('chartTable').innerHTML = `<table><thead><tr><th>Passage</th><th>Maturité</th><th>Polarisations</th><th>${esc(ind.libelle)}</th></tr></thead><tbody>${
      s.map(p => `<tr><td>${F(p.date)}</td><td>${LM(p.maturite)}</td><td>${LP(p)}</td><td>${val(p) == null ? '—' : N(val(p), ind.unite === 'm3' ? 3 : 2)}</td></tr>`).join('')}${
      pv ? `<tr class="fc-row"><td>${F(pv.cible.date)} (prévision)</td><td colspan="2">entre ${N(pv.bas, 2)} et ${N(pv.haut, 2)}</td><td>${N(pv.valeur, ind.unite === 'm3' ? 3 : 2)}</td></tr>` : ''}</tbody></table>`;
  }

  // ------------------------------------------------------------------ classement
  async function afficherClassement() {
    const zones = [];
    for (const n of SUIVIES.filter(n => n !== PROVINCE)) zones.push({ nom: n, serie: await serieDe(n).catch(() => []), surface: surfaceDe(n) });
    const cl = R.classer(zones, S.date);
    $('ranking').innerHTML = cl.map((r, i) => {
      const c = r.constat, niv = c ? c.niveau : 'normal';
      return `<li><button class="rank-item ${niv}" data-zone="${esc(r.zone)}" aria-current="${r.zone === S.zone}"><span class="rank-n">${i + 1}</span>
        <span><strong>${esc(r.zone)}</strong><span>${esc(c ? c.titre : 'Aucun indicateur exploitable')}</span></span></button></li>`;
    }).join('');
    $$('#ranking [data-zone]').forEach(b => b.onclick = () => choisirZone(b.dataset.zone, true));
    return cl;
  }

  // ------------------------------------------------------------------ comparaison
  // ------------------------------------------------------------------ tableau de bord complet
  const COUL = { alerte: '#ef4444', attention: '#f59e0b', ecart: '#38bdf8', normal: '#22c55e', inconnu: '#a78bfa', na: '#64748b' };
  const LIB_ET = cl => ({ alerte: 'Alerte', attention: 'À surveiller', ecart: expert() ? 'Écart sans risque' : 'Un peu différent', normal: expert() ? 'Dans la normale' : 'Comme d’habitude', inconnu: 'Sans comparaison', na: expert() ? 'Non exploitable' : 'Pas d’info fiable' })[cl];
  /** Même classement que sur la carte interactive. */
  function etatDe(a, id) {
    const e = a?.evals.find(x => x.id === id);
    if (!e || !e.exploitable) return 'na';
    if (e.etat === 'inconnu') return 'inconnu';
    const c = a.constats.find(x => x.id === id);
    if (!c) return 'na';
    if (c.niveau === 'alerte' || c.niveau === 'attention') return c.niveau;
    if (c.niveau === 'normal' || e.etat === 'normal') return 'normal';
    return 'ecart';
  }
  const valeurLisible = e => {
    if (!e?.exploitable) return '—';
    if (expert()) return e.km2 != null ? `${km2(e.km2)} · ${uni(e.ind, e.valeur)}` : uni(e.ind, e.valeur);
    return e.km2 != null ? (Math.abs(e.km2) < 0.05 ? 'presque rien' : km2(e.km2)) : null;
  };
  /** Petite courbe : passages calibrés, bande de normale, passage choisi marqué. */
  function miniCourbe(serie, ind, e, col) {
    const s = R.completer(serie).filter(p => p.maturite !== 'BETA');
    const pts = s.map(p => ({ d: p.date, v: (!ind.besoinHV || p.double_pol) ? p[ind.cle] : null })).filter(p => p.v != null);
    if (pts.length < 2) return `<div class="mini-vide">${expert() ? 'Pas assez de passages exploitables' : 'Pas assez de mesures fiables'}</div>`;
    const n = e?.normale;
    let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
    if (n?.ok) { lo = Math.min(lo, ind.unite === 'pct' ? Math.max(0, n.bas) : n.bas); hi = Math.max(hi, n.haut); }
    const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad; if (ind.unite === 'pct') lo = Math.max(0, lo);
    const t = d => new Date(d + 'T12:00:00Z').getTime(), t0 = t(pts[0].d), t1 = t(pts.at(-1).d);
    const W = 240, H = 64, X = d => 4 + (t(d) - t0) / ((t1 - t0) || 1) * (W - 8), Y = v => H - 6 - (v - lo) / (hi - lo) * (H - 12);
    const bande = n?.ok ? `<rect x="0" y="${Y(n.haut).toFixed(1)}" width="${W}" height="${Math.max(1, Y(ind.unite === 'pct' ? Math.max(0, n.bas) : n.bas) - Y(n.haut)).toFixed(1)}" class="mc-band"/>` : '';
    const sel = pts.find(p => p.d === S.date.date);
    return `<svg class="mini-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${bande}
      <path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      ${sel ? `<circle cx="${X(sel.d)}" cy="${Y(sel.v)}" r="4" fill="${col}" stroke="var(--panel)" stroke-width="2"/>` : ''}</svg>`;
  }
  function afficherMultiples(a, serie) {
    $('miniGrid').innerHTML = R.ORDRE.map(id => {
      const e = a.evals.find(x => x.id === id), c = a.constats.find(x => x.id === id), cl = etatDe(a, id), ind = R.IND[id];
      const v = valeurLisible(e);
      const titre = e?.exploitable ? (c?.titre || 'Mesuré') : (e?.raisons[0] || 'Pas de mesure');
      return `<button class="mini-card ${S.metrique === id ? 'on' : ''}" data-metric="${id}" style="--c:${COUL[cl]}" aria-label="${esc(ind.libelle)} : ${esc(titre)}. Afficher le graphique détaillé.">
        <span class="mini-top"><b>${esc(ind.libelle)}</b><span class="mini-pill">${LIB_ET(cl)}</span></span>
        ${v ? `<span class="mini-val">${v}${expert() && e?.z != null ? ` <small>z ${N(e.z, 1)}</small>` : ''}</span>` : ''}
        <span class="mini-t">${esc(titre)}</span>
        ${miniCourbe(serie, ind, e, COUL[cl] === COUL.na ? '#94a3b8' : COUL[cl])}
      </button>`;
    }).join('');
    $$('#miniGrid [data-metric]').forEach(b => b.onclick = () => {
      S.metrique = b.dataset.metric; $('chartMetric').value = S.metrique;
      serieDe(S.zone).then(afficherCourbe);
      $$('#miniGrid .mini-card').forEach(x => x.classList.toggle('on', x === b));
      document.querySelector('.chart-panel').scrollIntoView({ behavior: reduit ? 'auto' : 'smooth', block: 'center' });
    });
  }
  function afficherEtats(serie) {
    const surf = surfaceDe(S.zone);
    const parDate = M.dates.map(d => ({ d, a: R.analyser(S.zone, serie, d, { surfaceKm2: surf }) }));
    const tete = parDate.map(({ d }) => `<th scope="col" class="${d === S.date ? 'sel' : ''} ${d.maturite === 'BETA' ? 'beta' : ''}" title="${esc(libDate(d))}"><span>${Donnees.dmy(d.date)}</span></th>`).join('');
    const lignes = R.ORDRE.map(id => `<tr><th scope="row">${esc(R.IND[id].libelle)}</th>${parDate.map(({ d, a }) => {
      const cl = etatDe(a, id), c = a.constats.find(x => x.id === id), e = a.evals.find(x => x.id === id);
      const t = `${F(d.date)} · ${R.IND[id].libelle} : ${cl === 'na' ? (e?.raisons[0] || 'pas de mesure') : (c?.titre || LIB_ET(cl))}`;
      return `<td class="${d === S.date ? 'sel' : ''}"><button class="et-cell ${cl}" style="--c:${COUL[cl]}" data-i="${M.dates.indexOf(d)}" data-id="${id}" title="${esc(t)}" aria-label="${esc(t)}"></button></td>`;
    }).join('')}</tr>`).join('');
    $('etatsGrid').innerHTML = `<table class="etats"><thead><tr><th></th>${tete}</tr></thead><tbody>${lignes}</tbody></table>`;
    $('etatsLeg').innerHTML = ['alerte', 'attention', 'ecart', 'normal', 'inconnu', 'na'].map(k => `<span><i class="et-cell ${k}" style="--c:${COUL[k]}"></i>${LIB_ET(k)}</span>`).join('')
      + `<span class="muted">${expert() ? 'Colonnes grisées : passages bêta' : 'Colonnes pâles : données d’essai'} · clic sur une case = ce passage</span>`;
    $$('#etatsGrid [data-i]').forEach(b => b.onclick = () => { S.metrique = b.dataset.id; $('chartMetric').value = S.metrique; choisirDate(M.dates[+b.dataset.i]); });
  }
  async function afficherZones() {
    const cols = ['inondation', 'vegetation_inondee', 'eau', 'vegetation', 'anomalie', 'humidite'];
    const lignes = [];
    for (const z of SUIVIES) {
      let serie; try { serie = await serieDe(z); } catch (e) { serie = []; }
      lignes.push({ z, a: R.analyser(z, serie, S.date, { surfaceKm2: surfaceDe(z) }) });
    }
    const NIVC = { alerte: COUL.alerte, attention: COUL.attention, normal: COUL.normal, info: COUL.ecart, inconnu: COUL.na };
    $('zonesTable').innerHTML = `<table class="zones-t"><thead><tr><th scope="col">Zone</th><th scope="col">${expert() ? 'Verdict' : 'En bref'}</th>${cols.map(id => `<th scope="col">${esc(R.IND[id].libelle)}</th>`).join('')}</tr></thead><tbody>${
      lignes.map(({ z, a }) => `<tr class="${z === S.zone ? 'sel' : ''}" data-z="${esc(z)}" tabindex="0" title="Voir le tableau de bord de ${esc(z)}">
        <th scope="row">${esc(z)}</th>
        <td class="zt-v"><i style="background:${NIVC[a.verdict.niveau] || COUL.na}"></i>${esc(a.verdict.titre.replace(/ (à|dans|en|sur) .*$/, ''))}</td>
        ${cols.map(id => { const cl = etatDe(a, id), e = a.evals.find(x => x.id === id);
          const txt = expert() ? (e?.exploitable ? `${e.km2 != null ? km2(e.km2) : uni(e.ind, e.valeur)}${e.z != null ? ` <small>z ${N(e.z, 1)}</small>` : ''}` : '—') : LIB_ET(cl);
          return `<td><span class="zt-c" style="--c:${COUL[cl]}">${txt}</span></td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
    $$('#zonesTable tr[data-z]').forEach(r => {
      r.onclick = () => choisirZone(r.dataset.z);
      r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choisirZone(r.dataset.z); } };
    });
  }

  async function afficherComparaison(serie) {
    const box = $('compareResult');
    const dA = M.dates.find(x => x.date + '|' + x.orbite === S.avant);
    if (!dA || dA === S.date) { box.innerHTML = '<p class="muted small">Choisissez un passage différent du passage affiché.</p>'; return; }
    if (dA.maturite === 'BETA' || S.date.maturite === 'BETA') { box.innerHTML = `<p class="muted small">${expert() ? 'Passage bêta non calibré : pas comparable aux passages calibrés.' : 'L’un des deux passages est une donnée d’essai : pas assez fiable pour comparer.'}</p>`; return; }
    const s = R.completer(serie), surf = surfaceDe(S.zone);
    const plus = { inondation: 'Plus d’eau', vegetation_inondee: 'Plus d’eau sous la végétation', eau: 'Plus d’eau libre', vegetation: 'Végétation plus dense', anomalie: expert() ? 'Signal plus fort' : 'Sol plus humide ou plus de végétation', humidite: 'Sols plus humides' };
    const moins = { inondation: 'Moins d’eau', vegetation_inondee: 'Moins d’eau sous la végétation', eau: 'Moins d’eau libre', vegetation: 'Végétation plus clairsemée', anomalie: expert() ? 'Signal plus faible' : 'Sol plus sec ou végétation coupée', humidite: 'Sols plus secs' };
    const lignes = R.ORDRE.map(id => {
      const ind = R.IND[id], eA = R.evaluer(id, s, dA, surf), eB = R.evaluer(id, s, S.date, surf);
      if (!eA.exploitable || !eB.exploitable) {
        const r = !eA.exploitable ? `${F(dA.date)} : ${eA.raisons[0]}` : `${F(S.date.date)} : ${eB.raisons[0]}`;
        return `<tr class="na"><th scope="row">${esc(ind.libelle)}</th><td>—</td><td>—</td><td><span class="cmp-tag" style="--c:${COUL.na}">${expert() ? 'Non comparable' : 'Pas comparable'}</span><small>${esc(r)}</small></td></tr>`;
      }
      const d = eB.valeur - eA.valeur, sig = eB.normale.ok ? eB.normale.sigma : eA.normale.ok ? eA.normale.sigma : null;
      const seuil = Math.max(ind.effetMin, sig ? 2 * sig : ind.effetMin * 2), fort = Math.max(ind.effetMin * 2, sig ? 3.5 * sig : ind.effetMin * 4);
      const cl = Math.abs(d) < seuil ? 'stable' : Math.abs(d) >= fort ? 'net' : 'oui';
      const col = cl === 'stable' ? COUL.normal : d > 0 ? (cl === 'net' ? '#dc2626' : '#fb923c') : (cl === 'net' ? '#1d4ed8' : '#60a5fa');
      const lib = cl === 'stable' ? 'Pas de changement net' : `${cl === 'net' ? 'Nettement : ' : ''}${(d > 0 ? plus : moins)[id].toLowerCase()}`;
      const v = e => expert() ? uni(ind, e.valeur) : (e.km2 != null ? (Math.abs(e.km2) < 0.05 ? 'presque rien' : km2(e.km2)) : '');
      const detail = expert() ? `Δ ${d > 0 ? '+' : ''}${uni(ind, d)}${sig ? ` · Δ/σ ${N(d / sig, 1)}` : ''}${eA.km2 != null ? ` · ${eB.km2 - eA.km2 > 0 ? '+' : ''}${km2(eB.km2 - eA.km2)}` : ''}`
        : (eA.km2 != null && cl !== 'stable' ? `${eB.km2 - eA.km2 > 0 ? '+' : '−'}${km2(Math.abs(eB.km2 - eA.km2))}` : '');
      return `<tr><th scope="row">${esc(ind.libelle)}</th><td>${v(eA)}</td><td>${v(eB)}</td><td><span class="cmp-tag" style="--c:${col}">${esc(lib.replace(/^./, c => c.toUpperCase()))}</span>${detail ? `<small>${detail}</small>` : ''}</td></tr>`;
    }).join('');
    let veg = '';
    const geom = geometrieDe(S.zone);
    if (geom && dA.double_pol && S.date.double_pol) {
      try {
        await Analyse.charger();
        const ids = S.point?.nom === S.zone ? S.point.ids : (cache.ids[S.zone] ||= Analyse.indices(geom));
        const [d1, d2] = dA.date < S.date.date ? [dA, S.date] : [S.date, dA];
        const r = Analyse.comparer(ids, d1, d2);
        if (r) veg = `<p class="small cmp-veg">${ico('leaf', 14)} Sur ${N(r.total, 0)} km² comparables : <b>${N(r.perte, 1)} km²</b> de végétation en net recul et <b>${N(r.gain, 1)} km²</b> en progression${expert() ? ` (HV ±${r.seuil} dB)` : ''}.</p>`;
      } catch (e) { /* cube indisponible */ }
    }
    box.innerHTML = `<table class="cmp-t"><thead><tr><th></th><th scope="col">${F(dA.date)}</th><th scope="col">${F(S.date.date)}</th><th scope="col">Changement</th></tr></thead><tbody>${lignes}</tbody></table>${veg}
      <p class="muted small">${expert() ? 'Changement signalé si |Δ| ≥ max(2σ, effet minimal) ; « net » si ≥ 3,5σ (σ : écart robuste de la zone).' : 'Un changement n’est signalé que s’il dépasse les variations habituelles de la zone.'}</p>`;
  }

  // ------------------------------------------------------------------ mise à jour générale
  let jeton = 0;
  // le tableau de bord n'est calculé que quand on l'affiche (la carte d'arrivée reste fluide)
  const PAGES_ANALYSE = ['accueil'];
  let enAttente = true;
  async function majTout() {
    if (!PAGES_ANALYSE.includes(S.page)) { enAttente = true; return; }
    enAttente = false;
    const moi = ++jeton;
    majCarte();
    $('dateSelect').value = M.dates.indexOf(S.date);
    $('dateMeta').innerHTML = `<span class="badge ${S.date.maturite}">${LM(S.date.maturite)}</span><span class="badge">${LP(S.date)}</span>${expert() ? `${S.date.humidite ? '<span class="badge">SME2</span>' : ''}<span>orbite ${S.date.orbite} · ${M.pixel_m} m</span>` : ''}`;
    let serie;
    try { serie = await serieDe(S.zone); }
    catch (e) { toast('Calcul local indisponible dans ce navigateur.'); serie = []; }
    if (moi !== jeton) return;
    const a = R.analyser(S.zone, serie, S.date, { surfaceKm2: surfaceDe(S.zone) });
    S.analyse = a;
    afficherVerdict(a); afficherMetriques(a, serie); afficherInspecteur(a); afficherRaisonnement(a); afficherPrevisions(a); afficherCourbe(serie);
    afficherMultiples(a, serie); afficherEtats(serie);
    await afficherClassement(); if (moi !== jeton) return; afficherComparaison(serie); afficherZones();
    $('resetZone').hidden = S.zone === PROVINCE;
  }

  function remplirZones() {
    const sel = $('zoneSelect');
    sel.innerHTML = '';
    const g1 = document.createElement('optgroup'); g1.label = 'Territoires suivis';
    SUIVIES.forEach(n => g1.appendChild(new Option(n, n)));
    sel.appendChild(g1);
    if (S.perso.length || S.point) {
      const g2 = document.createElement('optgroup'); g2.label = 'Mes zones';
      S.perso.forEach(z => g2.appendChild(new Option(z.nom, z.nom)));
      if (S.point) g2.appendChild(new Option(S.point.nom, S.point.nom));
      sel.appendChild(g2);
    }
    sel.value = S.zone;
  }
  const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  function telecharger(contenu, nom, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([contenu], { type }));
    a.download = nom; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function choisirZone(nom, versCarte) {
    if (!nom) return;
    S.zone = nom;
    $('zoneSelect').value = nom;
    carte.surligner(nom);
    carte.dessinerPerso(S.point?.cercle ? [...S.perso, S.point] : S.perso, nom);
    const g = /Province/.test(nom) ? null : geometrieDe(nom);
    carte.zoom(g);
    majTout();
    if (versCarte) document.querySelector('.map-section').scrollIntoView({ behavior: reduit ? 'auto' : 'smooth', block: 'start' });
  }
  function choisirDate(d) { S.date = d; majTout(); }

  // ------------------------------------------------------------------ outils de l'explorateur
  function outil(nom) {
    S.outil = S.outil === nom ? null : nom;
    $('toolPoint').setAttribute('aria-pressed', String(S.outil === 'point'));
    $('toolDraw').setAttribute('aria-pressed', String(S.outil === 'draw'));
    $('drawBar').hidden = S.outil !== 'draw';
    document.querySelector('.map-frame').classList.toggle('drawing', !!S.outil);
    if (S.outil === 'draw') { carte.dessin.debut(); majDessin(); }
    else carte.dessin.annuler();
    carte.onClic(S.outil ? clicOutil : null);
    majCarte();
  }
  function majDessin() {
    const n = carte.dessin.nb();
    $('drawInfo').textContent = n < 3 ? `Cliquez sur la carte pour placer les sommets (${n} placé${n > 1 ? 's' : ''}, 3 minimum).` : `${n} sommets. Continuez ou terminez la zone.`;
    $('drawFinish').disabled = n < 3;
  }
  async function clicOutil(ll) {
    if (S.outil === 'draw') { carte.dessin.ajouter(ll); majDessin(); return; }
    if (S.outil === 'point') {
      try { await Analyse.charger(); } catch (e) { toast('Inspection locale indisponible dans ce navigateur.'); return; }
      const c = Analyse.metadata();
      const x = Math.floor((ll.lng - c.ouest) / c.pas), y = Math.floor((c.nord - ll.lat) / c.pas);
      if (x < 1 || y < 1 || x >= c.nx - 1 || y >= c.ny - 1) { toast('Ce point est hors de l’emprise des données.'); return; }
      const ids = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ids.push((y + dy) * c.nx + x + dx);
      const nom = `Point ${N(ll.lat, 3)}° N · ${N(ll.lng, 3)}° E`;
      if (S.point) delete cache.series[S.point.nom];
      const h = c.pas / 2 * 3;
      S.point = { nom, ids, surface: null, geometry: { type: 'Polygon', coordinates: [[[ll.lng - h, ll.lat - h], [ll.lng + h, ll.lat - h], [ll.lng + h, ll.lat + h], [ll.lng - h, ll.lat + h], [ll.lng - h, ll.lat - h]]] } };
      carte.marquerPoint(ll.lat, ll.lng);
      remplirZones();
      S.zone = nom; $('zoneSelect').value = nom;
      majTout();
      toast('Point inspecté : 9 pixels radar autour du clic');
    }
  }
  async function creerZone(nom, coords) {
    let base = nom || `Ma zone ${S.perso.length + 1}`, k = 2;
    while (S.perso.some(z => z.nom === base) || SUIVIES.includes(base)) base = `${nom || 'Ma zone'} (${k++})`;
    const z = { nom: base, geometry: { type: 'Polygon', coordinates: [coords] } };
    try {
      await Analyse.charger();
      const ids = Analyse.indices(z.geometry);
      if (!ids.length) { toast('Cette zone est hors de l’emprise des données.'); return; }
      cache.ids[base] = ids;
    } catch (e) { toast('Calcul local indisponible dans ce navigateur.'); return; }
    S.perso.push(z); store.set('zones', S.perso);
    remplirZones(); choisirZone(base);
    toast(`« ${base} » analysée et enregistrée sur cet appareil`);
  }

  // ------------------------------------------------------------------ pages de contenu
  function pageComprendre() {
    const ex = (S.apprendre ?? (expert() ? 'expert' : 'debutant')) === 'expert';
    const T = (deb, exp) => ex ? exp : deb;
    const echo = (titre, texte, dessin, coul, lib) => `<article class="panel echo"><svg viewBox="0 0 240 120" role="img" aria-label="${esc(titre)}">${dessin}</svg><h3>${titre}</h3><p>${texte}</p>${coul ? `<span class="swatch"><i style="background:${coul}"></i>${lib}</span>` : ''}</article>`;
    const sat = '<rect class="sat" x="18" y="10" width="26" height="14" rx="3"/><rect class="sat" x="4" y="13" width="12" height="8"/><rect class="sat" x="46" y="13" width="12" height="8"/>';
    const nDual = M.dates.filter(d => d.double_pol).length, nCal = M.dates.filter(d => d.maturite !== 'BETA').length;
    let nChap = 0;
    const chap = (id, num, titre, corps) => `<section class="chap" id="${id}" aria-labelledby="${id}-t"><p class="chap-n">${String(++nChap).padStart(2, '0')}</p><h2 class="h2" id="${id}-t">${titre}</h2>${corps}</section>`;
    const QUIZ = ex ? [
      ['Sur quoi repose la valeur ajoutée de SAJE Field ?', ['Un nouveau traitement radar', 'La couche de raisonnement : normale par zone, double seuil, confiance, non-exploitables', 'Des données inédites'], 1, 'Le traitement radar est classique ; l’apport est l’interprétation prudente et explicite, utilisable par des non-spécialistes.'],
      ['Quel usage est hors du périmètre de SAJE Field ?', ['Prioriser des inspections après de fortes pluies', 'Une alerte de crue en temps réel', 'Suivre une mangrove sur plusieurs mois'], 1, 'Cycle de 12 jours et délai de publication : SAJE Field éclaire une décision, il ne remplace pas un système d’alerte.'],
      ['Sur une image en HH, une mangrove inondée apparaît…', ['Très sombre', 'Très brillante', 'Identique à la forêt sèche'], 1, 'Double rebond eau + tronc : l’onde revient vers le satellite, HH augmente fortement.'],
      ['Pourquoi HV sert-il d’indicateur de végétation ?', ['Il mesure la chlorophylle', 'La diffusion de volume dans le feuillage dépolarise l’onde', 'Il est insensible à l’eau'], 1, 'Les branches orientées dans tous les sens renvoient une part de l’onde dans l’autre polarisation.'],
      ['SAJE Field signale un écart quand…', ['|z| ≥ 2 seulement', '|z| ≥ 2 et l’écart dépasse un effet minimal utile', 'La valeur dépasse la moyenne'], 1, 'Double condition : statistique (2 écarts robustes) et pratique (effet minimal), pour éviter les fausses alertes.'],
      ['L’humidité SME2 n’est pas exploitable sur l’Estuaire car…', ['Le satellite ne passe pas', 'Le contrôle qualité rejette les pixels (forêt dense, pluie)', 'La bande L ne voit pas le sol'], 1, 'Sous un couvert dense, l’inversion est jugée non fiable par l’indicateur de qualité du produit.'],
    ] : [
      ['À quoi sert d’abord SAJE Field ?', ['À prévoir la météo', 'À dire, en mots simples, ce qui change dans la province et si on peut s’y fier', 'À photographier les maisons'], 1, 'SAJE Field traduit les mesures du satellite en phrases simples, avec leur niveau de fiabilité.'],
      ['SAJE Field peut-il vous prévenir d’une inondation à l’heure près ?', ['Oui', 'Non : le satellite passe tous les 12 jours', 'Seulement la nuit'], 1, 'Ce n’est pas une alerte en temps réel : il aide à voir, comparer et anticiper, pas à donner l’alarme minute par minute.'],
      ['Le radar NISAR peut-il voir le sol quand il y a des nuages ?', ['Non, comme un appareil photo', 'Oui, de jour comme de nuit', 'Seulement le jour'], 1, 'Le radar envoie sa propre onde, qui traverse les nuages : il ne dépend ni du soleil ni du ciel.'],
      ['Sur une image radar, l’eau calme apparaît…', ['Sombre', 'Très brillante', 'Rouge'], 0, 'L’eau agit comme un miroir : l’onde repart au loin et presque rien ne revient vers le satellite.'],
      ['Un cercle vert sur la carte veut dire…', ['Danger', 'Comme d’habitude', 'Pas de données'], 1, 'Vert : la mesure ressemble à ce que le satellite voit d’habitude dans cette zone.'],
      ['Pourquoi SAJE Field n’affiche-t-il pas l’humidité du sol ?', ['Il a oublié', 'Les mesures ne sont pas assez fiables ici', 'Le Gabon n’est pas couvert'], 1, 'La NASA juge ces mesures peu fiables sous la forêt dense : SAJE Field préfère ne rien afficher plutôt qu’un chiffre faux.'],
    ];
    $('page-comprendre').innerHTML = `
      <div class="learn-head">
        <p class="muted">${T('À quoi sert SAJE Field, qui peut s’en servir, jusqu’où il peut aider, et comment lire le radar : tout est expliqué simplement, en quelques minutes.', 'Finalité, périmètre et chaîne de traitement de SAJE Field, puis les principes physiques, les produits NISAR et les choix statistiques, sans raccourci.')}</p>
        <div class="seg lvl-switch" role="group" aria-label="Niveau des explications">
          <button data-niveau="debutant" aria-pressed="${!ex}">${ico('user', 15)} Débutant</button>
          <button data-niveau="expert" aria-pressed="${ex}">${ico('chart', 15)} Expert</button>
        </div>
      </div>
      <nav class="learn-toc" id="learnToc" aria-label="Sommaire"></nav>

      <p class="part" id="p-projet">Partie 1 · Le projet</p>
      ${chap('c-saje', '', 'SAJE Field en bref', T(`
        <div class="prose"><p>Des satellites de la NASA observent le Gabon en continu, mais leurs données sont des fichiers techniques que presque personne ne sait lire. <b>SAJE Field les traduit en phrases simples</b> : est-ce qu’il y a plus d’eau que d’habitude ? La végétation recule-t-elle ? Peut-on se fier à ce chiffre ?</p>
        <p>L’application regarde la <b>province de l’Estuaire</b> (Libreville, Owendo, Akanda, Ntoum, Kango, Cocobeach…) à travers les nuages, passage après passage, et dit ce qui change, ce qui est normal, et ce qu’elle ne peut pas savoir.</p></div>`, `
        <div class="prose"><p>SAJE Field est une application web <b>statique et hors ligne</b> qui transforme les produits radar NISAR (GCOV et SME2) de l’orbite ${M.dates[0].orbite} en indicateurs interprétés, sur ${M.dates.length} passages (${F(M.dates[0].date)} → ${F(M.dates.at(-1).date)}).</p>
        <p>Sa particularité n’est pas le traitement radar en lui-même, qui reste classique, mais la <b>couche de raisonnement</b> : normale robuste propre à chaque zone, double seuil (statistique et pratique), confiance explicite, liste de ce qui n’est pas exploitable, prévision évaluée sur le passé. L’objectif : qu’un non-spécialiste puisse s’en servir sans être induit en erreur.</p></div>`))}

      ${chap('c-but', '', 'À quoi ça sert, précisément', `
        <div class="uses">
          ${[['waves', T('Repérer l’eau qui n’est pas là d’habitude', 'Détecter l’eau anormale'), T('Après de fortes pluies, voir quels quartiers ou bas-fonds sont plus inondés que d’habitude, même sous les nuages.', 'Part de surface en eau hors eau permanente, comparée à la normale de la zone ; détection par seuil d’Otsu sur HH.')],
             ['drop', T('Voir l’eau cachée sous la mangrove', 'Suivre l’inondation sous couvert'), T('Suivre l’état des mangroves d’Akanda et de Pongara, invisibles pour les satellites ordinaires.', 'Double rebond tronc-eau (HH ↑) : seule la bande L le permet sous canopée fermée.')],
             ['leaf', T('Suivre la végétation', 'Suivre la densité de végétation'), T('Repérer une forêt qui recule, une récolte, un défrichement autour de Ntoum ou de Kango.', 'HV − HH sur les passages en double polarisation ; surfaces perdues / gagnées entre deux dates.')],
             ['radar', T('Voir les changements du sol', 'Détecter les anomalies de surface'), T('Savoir si le sol paraît plus sec ou plus humide qu’à l’habitude.', 'Anomalie de HH par rapport à la médiane de la même orbite.')],
             ['calendar', T('Anticiper le prochain passage', 'Prévoir à 12 jours'), T('Estimer ce que le satellite devrait voir dans 12 jours, avec une fourchette.', 'Six modèles évalués en validation glissante ; intervalle à 95 % et probabilité de sortir de la normale.')],
             ['shield', T('Dire honnêtement ce qu’on ne sait pas', 'Expliciter l’incertitude'), T('Si une mesure n’est pas fiable (comme l’humidité du sol ici), SAJE Field le dit au lieu d’inventer un chiffre.', 'Indicateurs non exploitables listés avec leur raison ; confiance faible = jamais d’alerte.')]]
            .map(([i, t, d]) => `<article class="use">${ico(i, 20)}<b>${t}</b><span>${d}</span></article>`).join('')}
        </div>`)}

      ${chap('c-qui', '', 'Qui peut s’en servir, et pour quoi faire', `
        <div class="who">
          ${[['Habitants et quartiers', T('Savoir si son quartier est plus inondé que d’habitude, et le montrer à la mairie avec une fiche imprimée.', 'Preuve datée et sourcée d’une anomalie locale (fiche PDF, résumé copié).')],
             ['Agriculteurs et coopératives', T('Repérer les bas-fonds trop mouillés ou au contraire très secs avant de planter ; suivre ses cultures dans le temps.', 'Suivi de la végétation et de l’eau par zone ; l’humidité du sol n’est pas encore exploitable sur l’Estuaire.')],
             ['Mairies, ministères, protection civile', T('Savoir où envoyer une équipe en priorité après de fortes pluies ; suivre l’avancée de la ville sur la mangrove.', 'Classement des zones par écart et par confiance ; comparaison avant / après ; export des données.')],
             ['Parcs nationaux et ONG', T('Surveiller les mangroves d’Akanda et de Pongara sans aller sur place à chaque fois.', 'Série temporelle de l’eau sous végétation et de la densité de végétation par zone.')],
             ['Chercheurs, enseignants, étudiants', T('Apprendre à lire le radar avec de vraies données du Gabon.', 'Méthode transparente, données exportables (CSV), calculs reproductibles (Python et navigateur identiques).')],
             ['Entreprises, assureurs, BTP', T('Vérifier si un terrain est souvent sous l’eau avant d’y construire ou d’y investir.', 'Fréquence de l’eau sur les passages calibrés ; historique des états de la zone.')]]
            .map(([q, d]) => `<div class="who-i"><b>${q}</b><span>${d}</span></div>`).join('')}
        </div>`)}

      ${chap('c-niveaux', '', 'Jusqu’où SAJE Field peut vous aider', `
        <ol class="levels">
          ${[['Voir', T('Où se passe quelque chose ? La carte ne colore que les zones qui sortent de l’ordinaire.', 'Carte des écarts par cercles de 7 à 28 km ; légende par classe ou par écart z.')],
             ['Comprendre', T('Pourquoi ? Chaque conclusion vient avec ses preuves et son niveau de fiabilité.', 'Raisonnement en 3 étapes, preuve chiffrée, facteurs de confiance.')],
             ['Comparer', T('Qu’est-ce qui a changé depuis le mois dernier ? Quelle zone va le plus mal ?', 'Avant / après sur 6 indicateurs, historique des états, toutes les zones côte à côte.')],
             ['Anticiper', T('Que montrera probablement le prochain passage ?', 'Prévision à 12 jours avec intervalle à 95 % et contrôle a posteriori.')],
             ['Agir', T('Que faire ? Des recommandations prudentes, à vérifier sur le terrain.', 'Recommandations conditionnées à une confiance moyenne ou bonne ; exports CSV et fiche PDF.')]]
            .map(([t, d], i) => `<li><span class="lv-n">${i + 1}</span><div><b>${t}</b><span>${d}</span></div></li>`).join('')}
        </ol>
        <div class="cannot">
          <b>${T('Ce que SAJE Field ne fait pas', 'Hors du périmètre')}</b>
          <ul>
            <li>${T('Ce n’est <b>pas une alerte en temps réel</b> : le satellite passe tous les 12 jours.', '<b>Pas de temps réel</b> : cycle de 12 jours, données publiées avec quelques jours de délai.')}</li>
            <li>${T('Il ne lit <b>pas une parcelle</b> : il lit une zone de plusieurs kilomètres.', '<b>Pas d’échelle parcellaire</b> : cube à ' + M.pixel_m + ' m, zones de 7 à 28 km.')}</li>
            <li>${T('Il ne <b>remplace pas</b> une visite sur le terrain ni les services officiels.', '<b>Pas de validation in situ</b> : outil d’aide à la décision, à croiser avec le terrain.')}</li>
            <li>${T('Ce n’est <b>pas une prévision météo</b>.', '<b>Pas de modèle physique</b> : la prévision est statistique, sans pluviométrie.')}</li>
          </ul>
        </div>`)}

      ${chap('c-chaine', '', 'Comment fonctionne le projet', `
        <ol class="pipe">
          ${[['satellite', 'Le satellite', T('NISAR passe au-dessus de l’Estuaire tous les 12 jours et mesure l’écho radar.', `Acquisitions GCOV (HH, HV) et SME2 sur l’orbite ${M.dates[0].orbite}.`)],
             ['download', 'Les données', T('L’équipe télécharge gratuitement les fichiers sur le site de la NASA.', 'Recherche et téléchargement via l’API de l’ASF DAAC (compte Earthdata).')],
             ['layers', 'La préparation', T('Un programme les nettoie et les allège pour qu’elles tiennent dans l’application.', 'Script Python : conversion en dB, filtre de Lee, seuil d’Otsu, classification, statistiques par zone, images WebP et cube compressé.')],
             ['shield', 'Le raisonnement', T('L’application compare chaque mesure à l’habitude de la zone et décide si c’est normal.', 'Moteur JavaScript : normale robuste, double seuil, confiance, non-exploitables, recommandations.')],
             ['calendar', 'La prévision', T('Elle estime le passage suivant à partir des précédents.', 'Six modèles, évaluation glissante, intervalle de Student ; parité Python / navigateur.')],
             ['grid', 'L’affichage', T('Carte, tableau de bord et fiches, sans Internet, sur ordinateur ou téléphone.', 'Page HTML statique (Leaflet, Chart.js), ouverte directement depuis le fichier.')]]
            .map(([i, t, d]) => `<li>${ico(i, 18)}<b>${t}</b><span>${d}</span></li>`).join('')}
        </ol>`)}

      ${chap('c-usage', '', 'Utiliser SAJE Field en 3 gestes', `
        <ol class="algo">
          <li><b>Regarder la carte</b>${T('Choisissez un sujet (inondations, végétation…). Seules les zones inhabituelles se colorent. Touchez un cercle pour lire sa fiche.', 'Module, passage, découpage et couleur (conclusion ou écart z) se règlent depuis la carte ; la frise anime les passages et le bouton Comparer passe en mode avant / après.')}</li>
          <li><b>Ouvrir le tableau de bord</b>${T('Depuis la fiche d’une zone : la conclusion, les chiffres, l’évolution et la comparaison avec les autres zones.', 'Verdict, indicateurs, historique des états, tableau des zones, raisonnement, prévision, exports.')}</li>
          <li><b>Partager</b>${T('Copiez le résumé ou imprimez la fiche pour la montrer.', 'Résumé texte, CSV des séries et des prévisions, fiche PDF ; en mode Analyste, CSV de toutes les zones depuis la carte.')}</li>
        </ol>`)}

      <p class="part" id="p-radar">Partie 2 · Le radar et la méthode</p>
      ${chap('c-radar', '01', T('Le radar en une minute', 'Le radar à synthèse d’ouverture (RSO / SAR)'), T(`
        <div class="prose"><p>Imaginez que vous criez dans une vallée et que vous écoutez l’<b>écho</b>. Selon ce qu’il y a en face (une falaise, une forêt, un lac), l’écho revient fort, faible ou pas du tout.</p>
        <p>Le radar fait la même chose avec une onde invisible. Le satellite envoie l’onde vers le sol et mesure ce qui revient. Comme il produit <b>sa propre « lumière »</b>, il voit <b>la nuit et à travers les nuages</b>, ce qu’aucun appareil photo ne peut faire. Au Gabon, où le ciel est souvent couvert, c’est un énorme avantage.</p></div>`, `
        <div class="prose"><p>Un SAR est un capteur <b>actif</b> à visée latérale : il émet des impulsions micro-ondes et enregistre l’amplitude et la phase de l’onde rétrodiffusée. La « synthèse d’ouverture » combine les échos reçus le long de la trajectoire pour simuler une antenne de plusieurs kilomètres, d’où une résolution fine dans le sens du vol.</p>
        <p>SAJE Field utilise la <b>rétrodiffusion normalisée</b> γ⁰ des produits GCOV, exprimée en décibels (10·log₁₀). Elle dépend de la <b>rugosité</b> de la surface à l’échelle de la longueur d’onde, de sa <b>constante diélectrique</b> (l’eau la fait monter fortement), de la <b>géométrie</b> (angle d’incidence, pente) et de la <b>structure</b> de la végétation.</p></div>`))}

      ${chap('c-nisar', '02', 'La mission NISAR', `
        <div class="facts">
          <div class="fact"><span class="big">2</span><div><b>Agences</b><span class="muted small">NASA (États-Unis) et ISRO (Inde)</span></div></div>
          <div class="fact"><span class="big">24 cm</span><div><b>Bande L</b><span class="muted small">${T('une onde assez longue pour traverser le feuillage', 'radar NASA ; un radar en bande S (~10 cm) est fourni par l’ISRO')}</span></div></div>
          <div class="fact"><span class="big">12 j</span><div><b>${T('Un passage tous les 12 jours', 'Cycle orbital de 12 jours')}</b><span class="muted small">${T('même orbite, même angle : on peut comparer', 'orbite héliosynchrone ~747 km ; passages montants et descendants')}</span></div></div>
          <div class="fact"><span class="big">${M.dates.length}</span><div><b>Passages sur l’Estuaire</b><span class="muted small">${ex ? `orbite ${M.dates[0].orbite} · ${nCal} calibrés · ${nDual} en HH + HV` : `${F(M.dates[0].date)} → ${F(M.dates.at(-1).date)}`}</span></div></div>
        </div>
        <div class="prose"><p>${T('Lancé en juillet 2025 depuis l’Inde, NISAR photographie presque toutes les terres et les glaces de la planète deux fois tous les 12 jours. Ses données sont gratuites pour tout le monde.',
          'Lancé le 30 juillet 2025 depuis Sriharikota, NISAR porte une antenne réflecteur déployable de 12 m et un mode de balayage (SweepSAR) qui couvre une fauchée d’environ 240 km. Les produits sont distribués gratuitement par l’ASF DAAC. SAJE Field utilise GCOV (rétrodiffusion géocodée, HH et HV) et SME2 (humidité du sol à 200 m, avec indicateur de qualité par pixel).')}</p></div>`)}

      ${chap('c-echo', '03', 'Ce que l’onde raconte', `
        <div class="echo-grid">
          ${echo('L’eau calme : un miroir', T('L’onde rebondit plus loin, comme une balle sur un sol lisse : presque rien ne revient. L’eau apparaît <b>sombre</b>.', '<b>Réflexion spéculaire</b> : la surface est lisse à l’échelle de 24 cm, l’énergie part à l’opposé du capteur. γ⁰ HH tombe vers −20 dB et en dessous : SAJE Field en tire un seuil eau / non-eau (méthode d’Otsu, bornée entre −24 et −16 dB).'), sat + '<path class="wave dash" d="M31 24 L120 100"/><path class="wave" d="M120 100 L210 30"/><path class="water" d="M60 104 Q120 98 200 104 L200 118 L60 118Z"/>', '#1e3a8a', T('sombre', 'γ⁰ faible'))}
          ${echo('La végétation : un écho diffus', T('Feuilles et branches renvoient l’onde dans tous les sens. Plus la végétation est dense, plus l’écho est fort.', '<b>Diffusion de volume</b> : les éléments du couvert dépolarisent l’onde, ce qui fait monter HV. SAJE Field suit HV − HH comme indice de densité de végétation, sur les seuls passages HH + HV.'), sat + '<path class="wave dash" d="M31 24 L120 80"/><circle cx="120" cy="80" r="16" class="tree"/><circle cx="104" cy="88" r="10" class="tree"/><path class="wave" d="M120 80 L60 30 M120 80 L200 40 M120 80 L40 60"/>', '#16a34a', T('gris clair', 'HV ↑'))}
          ${echo('L’eau sous les arbres : le double rebond', T('L’onde touche l’eau, rebondit sur un tronc et revient tout droit : l’écho devient <b>très fort</b>. C’est ainsi qu’on voit l’eau cachée sous la mangrove.', '<b>Double rebond</b> : réflexion sur l’eau puis sur un tronc vertical (réflecteur dièdre) ; l’onde revient vers le capteur sans changer de polarisation, d’où un HH très élevé. Signature typique des mangroves et forêts inondées.'), sat + '<path class="wave dash" d="M31 24 L110 104 L130 60 L40 28"/><rect x="128" y="50" width="6" height="54" class="trunk"/><path class="water" d="M70 104 Q120 100 190 104 L190 118 L70 118Z"/>', '#db2777', T('très brillant', 'HH ↑↑'))}
          ${echo('Le sol humide : un écho plus fort', T('Un sol mouillé renvoie davantage l’onde qu’un sol sec.', 'L’eau du sol élève la <b>constante diélectrique</b> et donc la rétrodiffusion. SME2 inverse ce signal en humidité volumique (m³/m³), mais l’inversion échoue sous un couvert dense : ici, aucun pixel ne passe le contrôle qualité.'), sat + '<path class="wave dash" d="M31 24 L120 98"/><path class="wave" d="M120 98 L44 30"/><path class="soil" d="M50 100 L210 100 L210 118 L50 118Z"/>', '#a78bfa', T('plus clair', 'ε ↑'))}
        </div>`)}

      ${chap('c-pol', '04', T('HH et HV : deux façons de regarder', 'Polarisations HH et HV'), T(`
        <div class="prose"><p>Le satellite envoie son onde « à plat » (H, comme horizontal). Au retour, il écoute de deux façons : l’onde qui revient « à plat » (<b>HH</b>) et celle qui revient « debout » (<b>HV</b>).</p>
        <ul><li><b>HH</b> est très bon pour repérer l’eau, la ville et l’eau sous les arbres.</li><li><b>HV</b> est très bon pour mesurer la végétation : seules les branches et les feuilles « tournent » l’onde.</li></ul>
        <p>Certains jours, le satellite n’écoute qu’en HH. SAJE Field ne peut alors pas parler de la végétation, et il le dit.</p></div>`, `
        <div class="prose"><p><b>HH</b> (co-polarisation) est dominé par la diffusion de surface et le double rebond ; <b>HV</b> (polarisation croisée) par la diffusion de volume. Le rapport HV/HH (soit HV − HH en dB) normalise une partie des effets d’humidité et de géométrie, ce qui en fait un indicateur de densité de végétation plus robuste que HV seul.</p>
        <p>Sur l’orbite ${M.dates[0].orbite}, seuls <b>${nDual} passages sur ${M.dates.length}</b> sont en double polarisation : les indicateurs qui demandent HV ne sont évalués que sur ceux-là, et leur normale n’utilise que ces passages.</p></div>`))}

      ${chap('c-bande', '05', 'Pourquoi la bande L', `
        <div class="bands" role="img" aria-label="Plus la longueur d’onde est grande, plus l’onde pénètre la végétation">
          ${[['X', '3 cm', 18, 'surface du feuillage'], ['C', '5,6 cm', 34, T('haut de la canopée', 'Sentinel-1')], ['S', '~10 cm', 55, T('au milieu des arbres', 'NISAR (ISRO)')], ['L', '24 cm', 92, T('jusqu’aux troncs et au sol', 'NISAR (NASA)')]]
            .map(([b, l, p, t]) => `<div class="band ${b === 'L' ? 'on' : ''}"><b>${b}</b><span class="bl">${l}</span><span class="bar"><i style="width:${p}%"></i></span><span class="bt">${t}</span></div>`).join('')}
        </div>
        <div class="prose"><p>${T('Plus l’onde est longue, plus elle traverse le feuillage. Avec 24 cm, la bande L « voit » sous les arbres : c’est ce qui permet de suivre les mangroves et l’eau cachée sous la forêt, si importantes au Gabon.',
          'La profondeur de pénétration croît avec la longueur d’onde. En bande L, la rétrodiffusion reste sensible à la biomasse plus longtemps qu’en bande C (saturation vers ~100 t/ha contre quelques dizaines), et le double rebond tronc-eau reste observable sous canopée fermée. Limite : en forêt très dense, le signal finit tout de même par saturer.')}</p></div>`)}

      ${chap('c-lire', '06', 'Lire une image radar', `
        <div class="read-grid">
          ${[['Sombre', '#0f172a', T('eau calme, route, piste', 'surface lisse, réflexion spéculaire')], ['Gris', '#64748b', T('herbe, cultures basses, sol nu', 'diffusion de surface, rugosité modérée')], ['Clair', '#cbd5e1', T('forêt', 'diffusion de volume (HV élevé)')], ['Très brillant', '#f8fafc', T('ville, bateaux, mangrove inondée', 'double rebond, réflecteurs dièdres')]]
            .map(([t, c, d]) => `<div class="read"><i style="background:${c}"></i><b>${t}</b><span>${d}</span></div>`).join('')}
        </div>
        <div class="prose"><p>${T('L’image radar a toujours un aspect « granuleux » : c’est normal, ce n’est pas une erreur. SAJE Field lisse ce grain avant d’analyser.',
          'Le <b>chatoiement</b> (speckle) vient des interférences entre diffuseurs d’une même cellule ; il est multiplicatif. SAJE Field applique un filtre de Lee et une moyenne spatiale avant de calculer les indicateurs. En relief, attention au repliement et aux zones d’ombre radar (peu présents sur l’Estuaire, très plat).')}</p></div>`)}

      ${chap('c-algo', '07', 'Comment SAJE Field raisonne', T(`
        <ol class="algo">
          <li><b>Il vérifie chaque donnée</b>Si une mesure n’est pas fiable, elle est mise de côté et l’application dit pourquoi.</li>
          <li><b>Il apprend ce qui est habituel</b>Pour chaque zone, à partir de ses propres passages précédents.</li>
          <li><b>Il ne signale que les vrais changements</b>Un petit écart n’est pas une alerte : il faut que ça sorte nettement de l’habitude.</li>
          <li><b>Il dit s’il est sûr de lui</b>« Fiable », « assez fiable » ou « peu fiable », selon la qualité des données.</li>
          <li><b>Il dit ce qu’il ne sait pas</b>Jamais de chiffre inventé.</li>
          <li><b>Il conseille, avec prudence</b>Seulement quand il est assez sûr.</li>
          <li><b>Il anticipe</b>Il estime ce que le prochain passage devrait montrer, avec une fourchette.</li>
        </ol>`, `
        <ol class="algo">
          <li><b>Filtrage des données</b>Produit présent, polarisations requises, indicateur de qualité SME2, couverture ≥ 50 % de la partie terrestre ; sinon l’indicateur est « non exploitable » avec sa raison.</li>
          <li><b>Normale robuste par zone</b>Passages calibrés de la même orbite (sans bêta, sans le passage évalué) : médiane m et σ = 1,4826 × MAD, avec un plancher par indicateur ; aucune normale sous 4 passages.</li>
          <li><b>Détection</b>z = (x − m) / σ ; écart signalé si |z| ≥ 2 <i>et</i> |x − m| ≥ effet minimal ; alerte au-delà de |z| ≥ 3,5 selon l’indicateur.</li>
          <li><b>Confiance</b>Produit de facteurs : Validé 1 · Provisoire 0,82 · Bêta 0,45 · HH seul 0,85 · moins de 6 passages 0,85 · sans normale 0,6 · petite zone 0,7 → bonne ≥ 0,75, moyenne ≥ 0,5. Une confiance faible ne déclenche jamais d’alerte.</li>
          <li><b>Comparaison de deux passages</b>Δ = x₂ − x₁ ; changement si |Δ| ≥ max(2σ, effet minimal), « net » si ≥ 3,5σ ; passages bêta exclus.</li>
          <li><b>Prévision</b>Six modèles (persistance, médiane, lissage exponentiel, Theil–Sen, Holt amorti, filtre de Kalman) évalués en validation glissante ; le meilleur (erreur absolue moyenne) prévoit le passage suivant, avec un intervalle à 95 % (loi de Student) et une probabilité de sortir de la normale.</li>
          <li><b>Reproductibilité</b>Le calcul du navigateur et le programme Python donnent les mêmes prévisions (test de parité).</li>
        </ol>`))}

      ${chap('c-limites', '08', 'Les limites à connaître', `
        <ul class="limits">
          <li>${T('<b>Pas de mesures sur le terrain</b> pour vérifier : ce sont des indications, pas des certitudes.', '<b>Aucune vérité terrain</b> : pas de validation in situ, ni de pluviométrie ou d’optique croisées à ce stade.')}</li>
          <li>${T('<b>Un passage tous les 12 jours</b> : une crue de quelques heures peut passer inaperçue.', '<b>Échantillonnage temporel</b> de 12 jours et heure de passage fixe : marée et crues brèves mal capturées.')}</li>
          <li>${T('<b>Peu de recul</b> : la mission est récente, l’« habitude » est apprise sur quelques mois seulement.', `<b>Séries courtes</b> : ${nCal} passages calibrés, une seule saison sèche ; la normale n’intègre pas encore le cycle annuel.`)}</li>
          <li>${T('<b>L’humidité du sol</b> n’est pas fiable sous la forêt dense de l’Estuaire.', '<b>SME2</b> : 0 pixel valide sur la province (couvert dense, pluie, produit provisoire).')}</li>
          <li>${T('<b>Des zones de 14 km</b> : on lit un quartier, pas une parcelle.', `<b>Résolution</b> : analyse sur un cube de ${M.pixel_m} m, images à 80 m ; cercles de 7 à 28 km.`)}</li>
        </ul>`)}

      ${chap('c-quiz', '09', 'Testez-vous', `
        <div class="quiz" id="quiz">${QUIZ.map(([q, rep, bon, expl], i) => `
          <fieldset class="q" data-bon="${bon}"><legend><span>${i + 1}</span>${esc(q)}</legend>
            <div class="q-rep">${rep.map((r, k) => `<button type="button" data-k="${k}">${esc(r)}</button>`).join('')}</div>
            <p class="q-expl" hidden>${esc(expl)}</p></fieldset>`).join('')}
          <p class="q-score" id="quizScore" aria-live="polite"></p>
        </div>`)}

      ${chap('c-lex', '10', 'Lexique', `
        <section class="panel glossary"><dl>
          <div><dt>Radar (RSO / SAR)</dt><dd>${T('Instrument qui envoie une onde et écoute son écho.', 'Radar à synthèse d’ouverture : capteur actif à visée latérale, résolution obtenue par traitement le long de l’orbite.')}</dd></div>
          <div><dt>HH / HV</dt><dd>${T('Deux façons d’écouter l’écho : « à plat » ou « debout ».', 'Co-polarisation et polarisation croisée (émission H, réception H ou V).')}</dd></div>
          <div><dt>dB (décibel)</dt><dd>${T('Force de l’écho. Vers −20 : très peu (eau calme) ; vers −5 : beaucoup (forêt, ville).', 'Échelle logarithmique de γ⁰ : 10·log₁₀(γ⁰).')}</dd></div>
          <div><dt>Normale</dt><dd>${T('Ce qu’on observe d’habitude dans la zone.', 'Médiane des passages calibrés et intervalle médiane ± 2σ robuste.')}</dd></div>
          <div><dt>${T('Donnée validée / provisoire / d’essai', 'Validé / Provisoire / Bêta')}</dt><dd>${T('Niveau de fiabilité des données publiées par la NASA.', 'Maturité des produits NISAR, de non calibré (bêta) à validé.')}</dd></div>
          <div><dt>Prévision</dt><dd>${T('Estimation de ce que le prochain passage devrait montrer. Ce n’est pas une prévision météo.', 'Estimation statistique du passage n+1 à partir de la série de la zone, avec intervalle à 95 %.')}</dd></div>
          ${ex ? `<div><dt>γ⁰ (gamma nought)</dt><dd>Rétrodiffusion normalisée par la surface projetée perpendiculaire au faisceau ; réduit l’effet de l’angle d’incidence.</dd></div>
          <div><dt>GCOV / SME2</dt><dd>Produits NISAR : covariance géocodée (rétrodiffusion HH, HV…) et humidité du sol à 200 m avec indicateur de qualité.</dd></div>
          <div><dt>MAD</dt><dd>Écart absolu médian ; ×1,4826 il estime l’écart-type, sans être perturbé par les valeurs extrêmes.</dd></div>
          <div><dt>z</dt><dd>Écart à la médiane exprimé en nombre d’écarts robustes.</dd></div>
          <div><dt>Chatoiement (speckle)</dt><dd>Grain multiplicatif propre aux images radar, réduit par filtrage (Lee) et moyenne.</dd></div>
          <div><dt>Otsu</dt><dd>Méthode qui choisit automatiquement le seuil séparant deux classes (eau / terre) dans l’histogramme.</dd></div>` : ''}
        </dl></section>`)}`;
    $('learnToc').innerHTML = [...$('page-comprendre').querySelectorAll('.part, .chap')].map(el => el.classList.contains('part')
      ? `<span class="toc-part">${esc(el.textContent.replace(/^Partie \d · /, ''))}</span>`
      : `<a href="#${el.id}" data-ancre="${el.id}"><span>${el.querySelector('.chap-n').textContent}</span>${esc(el.querySelector('h2').textContent)}</a>`).join('');
    $$('#page-comprendre [data-niveau]').forEach(b => b.onclick = () => { S.apprendre = b.dataset.niveau; pageComprendre(); $('page-comprendre').querySelector('.lvl-switch [aria-pressed=true]')?.focus(); });
    $$('#page-comprendre [data-ancre]').forEach(a => a.onclick = e => { e.preventDefault(); $(a.dataset.ancre).scrollIntoView({ behavior: reduit ? 'auto' : 'smooth', block: 'start' }); });
    let bons = 0, faits = 0;
    $$('#quiz .q').forEach(q => q.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      if (q.classList.contains('fait')) return;
      q.classList.add('fait'); faits++;
      const ok = +b.dataset.k === +q.dataset.bon; if (ok) bons++;
      b.classList.add(ok ? 'ok' : 'ko'); q.querySelector(`[data-k="${q.dataset.bon}"]`).classList.add('ok');
      q.querySelector('.q-expl').hidden = false;
      if (faits === $$('#quiz .q').length) $('quizScore').textContent = `Score : ${bons} / ${faits}. ${bons === faits ? 'Bravo, vous savez lire le radar !' : 'Relisez les chapitres au-dessus, puis réessayez en changeant de niveau.'}`;
    }));
  }

  function pageSources() {
    const q = M.qualite || [];
    const mat = R.matrice(M.series[PROVINCE], M.dates);
    const abr = { bonne: '✓', moyenne: '✓', faible: '!' };
    $('page-sources').innerHTML = `
      <div class="facts">
        <div class="fact"><span class="big">${q.filter(x => x.statut !== 'rejetee').length}</span><div><b>Passages utilisés</b><span class="muted small">sur ${q.length} examinés (${q.filter(x => x.statut === 'rejetee').length} rejetés)</span></div></div>
        <div class="fact"><span class="big">${M.dates.filter(d => d.double_pol).length}</span><div><b>Passages HH + HV</b><span class="muted small">les seuls où la végétation est mesurable</span></div></div>
        <div class="fact"><span class="big">${M.sme2?.dates ?? 0}</span><div><b>Produits SME2</b><span class="muted small">0 pixel fiable sur la province</span></div></div>
        <div class="fact"><span class="big">${M.pixel_m} m</span><div><b>Résolution</b><span class="muted small">${esc(M.source)}</span></div></div>
      </div>
      <section class="panel"><div class="section-head"><div><p class="eyebrow">Exploitabilité</p><h2>Ce que chaque passage permet de dire (province)</h2></div>
        <div class="mx-legend"><span><i class="cell bonne"></i>confiance bonne</span><span><i class="cell moyenne"></i>moyenne</span><span><i class="cell faible"></i>faible</span><span><i class="cell non"></i>écarté</span></div></div>
        <div class="table-scroll"><table class="matrix"><thead><tr><th>Indicateur</th>${M.dates.map(d => `<th title="${esc(libDate(d))}">${Donnees.dmy(d.date)}<br><span class="muted">${d.date.slice(2, 4)}</span></th>`).join('')}</tr></thead><tbody>
        ${mat.map(r => `<tr><th scope="row">${esc(r.libelle)}</th>${r.cases.map(c => `<td><span class="cell ${c.ok ? c.niveau : 'non'}" title="${esc(c.ok ? 'Exploitable · confiance ' + c.niveau : c.raison)}">${c.ok ? abr[c.niveau] : '—'}</span></td>`).join('')}</tr>`).join('')}
        </tbody></table></div></section>
      <section class="panel"><div class="section-head"><div><p class="eyebrow">Contrôle qualité</p><h2>Passages NISAR examinés</h2></div><span class="muted small">Données préparées le ${esc((M.genere_le || '').replace('T', ' à ').replace('Z', ' UTC'))}</span></div>
        <div class="table-scroll"><table><thead><tr><th>Date</th><th>Maturité</th><th>Polarisations</th><th>Couverture</th><th>Seuil eau</th><th>SME2</th><th>Statut</th></tr></thead><tbody>
        ${q.map(x => { const d = M.dates.find(y => y.date === x.date); return `<tr class="${x.statut === 'rejetee' ? 'rej' : ''}"><td>${F(x.date)}</td><td><span class="badge ${x.maturite}">${LM(x.maturite)}</span></td><td>${d ? LP(d) : '—'}</td><td>${x.couverture_pct != null ? Math.round(x.couverture_pct) + ' %' : '—'}</td><td>${d?.seuil_eau_dB != null ? N(d.seuil_eau_dB) + ' dB' : '—'}</td><td>${x.humidite_SME2 === 'oui' ? 'présent' : '—'}</td><td>${x.statut === 'rejetee' ? '✗ ' + esc(x.raison || 'rejeté') : '✓ utilisé'}</td></tr>`; }).join('')}
        </tbody></table></div></section>
      <div class="two-col">
        <section class="panel prose"><h2 class="h2">Limites à garder en tête</h2><ul>
          <li>Les données « provisoires » (avant le 21 octobre 2026) et « validées » viennent de chaînes de traitement différentes : on ne compare les intensités qu’entre passages de la même orbite. Les passages « bêta » (novembre 2025 à janvier 2026) ne sont pas calibrés.</li>
          <li>Humidité du sol : les produits SME2 existent mais aucun pixel de la province ne passe le contrôle qualité NASA. SAJE Field ne conclut donc rien sur l’humidité.</li>
          <li>Les passages en HH seul ne mesurent ni la végétation ni l’eau sous couvert.</li>
          <li>La marée et le vent changent l’aspect de l’eau dans l’estuaire.</li>
          <li>Pixel de ${M.pixel_m} m : une petite parcelle n’est pas visible individuellement.</li>
          <li>Les crues de quelques heures peuvent passer entre deux passages.</li>
          <li>Les zones suivies sont approximatives : à redessiner avec la connaissance du terrain.</li>
          <li>Prévisions : 4 à 10 passages par série seulement, sans données de pluie. Elles prolongent le passé et peuvent être démenties par un orage ; aucune prévision sous 5 passages comparables.</li></ul></section>
        <section class="panel prose"><h2 class="h2">Réglages et crédits</h2><ul>
          <li>Filtre ${esc(M.seuils?.filtre || 'Lee')} (ENL ${M.seuils?.ENL ?? 5}) · seuil d’eau calé sur des zones témoins (chenal de l’estuaire, forêt).</li>
          <li>Eau permanente : présente sur ${Math.round((M.seuils?.eau_permanente_frequence ?? .8) * 100)} % des passages · bâti masqué : ${M.part_urbain_pct ?? '—'} % de la province.</li>
          <li>Moteur de raisonnement : normale robuste par zone (médiane ± 2 MAD), effet minimal, confiance calculée.</li>
          <li>Prévisions : programme Python <code>prevision/prevoir.py</code> (persistance, médiane, lissage exponentiel, Theil–Sen, Holt amorti, filtre de Kalman ; évaluation glissante, section dorée, intervalle de Student). ${window.SAJE_PREVISIONS?.province ? `Dernier calcul : ${esc(window.SAJE_PREVISIONS.province.genere_le.replace('T', ' à ').replace('Z', ' UTC'))}.` : 'Pas encore lancé : les prévisions sont calculées dans le navigateur.'}</li>
          <li>Données : NASA-ISRO NISAR, ASF DAAC · limite de province : geoBoundaries (CC BY-SA 3.0).</li>
          <li>Logiciels libres : bibliothèque cartographique Leaflet (licence BSD-2), graphiques Chart.js (licence MIT), polices Inter, Space Grotesk, JetBrains Mono (SIL OFL).</li></ul></section>
      </div>`;
  }

  // ------------------------------------------------------------------ navigation
  const PAGES = {
    carte: { crumb: 'Carte interactive', titre: 'Carte interactive', intro: '' },
    accueil: { crumb: 'Tableau de bord', titre: 'L’Estuaire, vu par le radar<span class="accent">.</span>', intro: 'Les observations NISAR lues pour vous : ce qui est normal, ce qui change, et ce qu’on ne peut pas encore dire.' },
    comprendre: { crumb: 'Comprendre', titre: 'Comprendre SAJE Field<span class="accent">.</span>', intro: 'Une onde de 24 cm, émise par le satellite, qui traverse les nuages et revient différemment selon ce qu’elle touche.' },
    sources: { crumb: 'Sources & qualité', titre: 'D’où viennent les chiffres<span class="accent">.</span>', intro: 'Chaque passage, chaque contrôle qualité, et ce que chaque donnée permet vraiment de dire.' },
    bassin: { crumb: 'Bassin du Congo', titre: 'Le bassin du Congo, vu par le radar<span class="accent">.</span>', intro: 'Eau, végétation et humidité du sol sur tout le bassin, tous les 12 jours : mesuré, comblé quand le satellite n’est pas passé, et prévu pour la période suivante.' },
  };
  function aller(page, focus = true) {
    if (!PAGES[page]) page = 'carte';
    S.page = page;
    document.documentElement.dataset.page = page;
    $$('[data-pages]').forEach(el => { el.hidden = !el.dataset.pages.split(' ').includes(page); });
    $$('.nav-link').forEach(b => b.dataset.pageLink === page ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
    $('crumbPage').textContent = PAGES[page].crumb;
    $('pageTitle').innerHTML = PAGES[page].titre;
    $('pageIntro').textContent = PAGES[page].intro;
    document.title = `SAJE Field · ${PAGES[page].crumb}`;
    $('sidebar').classList.remove('open'); $('scrim').hidden = true; $('menuToggle').setAttribute('aria-expanded', 'false');
    if (location.hash !== '#' + page) history.replaceState(null, '', '#' + page);
    if (page !== 'explorer' && S.outil) outil(S.outil);
    setTimeout(() => { carte.rafraichir(); window.Observatoire?.rafraichir(); }, 60);
    if (page === 'carte') focus = false;
    if (PAGES_ANALYSE.includes(page) && enAttente) majTout();
    if (page === 'bassin') window.Bassin?.afficher();
    if (focus) { window.scrollTo({ top: 0, behavior: 'auto' }); $('main').focus({ preventScroll: true }); }
  }

  // ------------------------------------------------------------------ visite guidée
  let etape = 0, classementTour = [];
  async function visite(i) {
    etape = i;
    const dlg = $('tour');
    if (!dlg.open) dlg.show();
    $('tourDots').innerHTML = [0, 1, 2].map(k => `<span class="${k <= i ? 'on' : ''}"></span>`).join('');
    $('tourPrev').disabled = i === 0;
    $('tourNext').textContent = i === 2 ? 'Explorer la carte' : 'Suivant';
    if (i === 0) {
      aller('carte', false);
      $('tourStep').textContent = 'Étape 1 / 3 · Que voit-on ?';
      $('tourTitle').textContent = 'La province, à travers les nuages';
      $('tourText').innerHTML = `<p>Le radar NISAR voit le sol de jour comme de nuit, même sous les nuages. Sur la carte, chaque cercle est une zone de 14 km : il ne se colore que si quelque chose sort de l’ordinaire.</p><p class="muted small">Survolez un cercle pour un résumé, cliquez pour la fiche complète. La frise en bas fait défiler les ${M.dates.length} passages.</p>`;
    } else if (i === 1) {
      classementTour = await afficherClassement();
      const top = classementTour[0];
      aller('accueil', false); S.date = M.dates.at(-1); choisirZone(top.zone);
      await new Promise(r => setTimeout(r, 120));
      const c = top.constat;
      $('tourStep').textContent = 'Étape 2 / 3 · Pourquoi ?';
      $('tourTitle').textContent = `${top.zone} : ${c ? c.titre.toLowerCase() : 'rien à signaler'}`;
      $('tourText').innerHTML = `<p>SAJE Field compare chaque mesure à la <b>normale de la zone</b>, apprise sur ses propres passages. Il ne parle d’un changement que s’il sort nettement de cette normale, et il dit quand il ne peut pas conclure.</p><p class="muted small">Le tableau de bord montre les 6 indicateurs dans le temps, l’historique des états et toutes les zones côte à côte.</p>`;
      $('verdict').scrollIntoView({ behavior: reduit ? 'auto' : 'smooth', block: 'center' });
    } else {
      const a = S.analyse;
      $('tourStep').textContent = 'Étape 3 / 3 · Et alors ?';
      $('tourTitle').textContent = 'Des actions concrètes, avec prudence';
      $('tourText').innerHTML = a.recommandations.slice(0, 3).map(r => `<p>• ${esc(r.texte)}</p>`).join('') + '<p class="muted small">La page « Comprendre » explique tout cela, pour les débutants comme pour les experts.</p>';
      $('forecast').scrollIntoView({ behavior: reduit ? 'auto' : 'smooth', block: 'center' });
    }
  }

  // ------------------------------------------------------------------ liaisons
  function lier() {
    remplirIcones();
    $$('[data-page-link]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); aller(b.dataset.pageLink); }));
    window.addEventListener('hashchange', () => aller(location.hash.slice(1) || 'carte'));
    // menu burger (navigation)
    const menu = ouvert => {
      $('sidebar').classList.toggle('open', ouvert); $('scrim').hidden = !ouvert;
      $('menuToggle').setAttribute('aria-expanded', String(ouvert));
      if (ouvert) $('sidebar').querySelector('.nav-link[aria-current]')?.focus();
    };
    $('menuToggle').onclick = () => menu(!$('sidebar').classList.contains('open'));
    $('scrim').onclick = () => menu(false);
    // menu « trois points » (réglages)
    const reglages = ouvert => {
      $('moreMenu').hidden = !ouvert; $('moreBtn').setAttribute('aria-expanded', String(ouvert));
      if (ouvert) $('moreMenu').querySelector('[aria-checked=true]')?.focus();
    };
    $('moreBtn').onclick = e => { e.stopPropagation(); reglages($('moreMenu').hidden); };
    document.addEventListener('click', e => { if (!$('moreMenu').hidden && !e.target.closest('.more')) reglages(false); });
    $('moreMenu').addEventListener('keydown', e => {
      const items = $$('#moreMenu [role^=menuitem]'), i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      if (e.key === 'Escape') { reglages(false); $('moreBtn').focus(); }
    });
    const majReglages = () => {
      const h = document.documentElement;
      $$('#moreMenu [data-detail]').forEach(x => x.setAttribute('aria-checked', String(x.dataset.detail === h.dataset.detail)));
      $('themeToggle').setAttribute('aria-checked', String(h.dataset.theme === 'dark'));
      $('modeChip').innerHTML = expert() ? `${ico('chart', 14)} Mode analyste` : `${ico('user', 14)} Mode simple`;
      $('modeChip').classList.toggle('an', expert());
    };
    $('themeToggle').onclick = () => {
      const h = document.documentElement; h.dataset.theme = h.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('saje_theme', h.dataset.theme); } catch (e) { /* ignoré */ }
      majReglages(); majTout(); window.Observatoire?.rafraichir(true);
    };
    $$('#moreMenu [data-detail]').forEach(b => b.onclick = () => {
      document.documentElement.dataset.detail = b.dataset.detail;
      try { localStorage.setItem('saje_detail', b.dataset.detail); } catch (e) { /* ignoré */ }
      if (!expert() && coucheDe(S.theme, S.couche)?.expert) S.couche = THEMES[S.theme].defaut;
      majReglages(); remplirDates(); reglages(false);
      toast(expert() ? 'Mode analyste : chiffres, statistiques et exports' : 'Mode simple : l’essentiel, en mots de tous les jours');
      majTout(); pageComprendre(); pageSources(); window.Observatoire?.changerMode();
    });
    majReglages();
    $('zoneSelect').onchange = e => choisirZone(e.target.value);
    $('dateSelect').onchange = e => { frise.arreter(); choisirDate(M.dates[+e.target.value]); };
    $('resetZone').onclick = () => choisirZone(PROVINCE);
    $('beforeSelect').onchange = e => { S.avant = e.target.value; majTout(); };
    $('chartMetric').onchange = e => { S.metrique = e.target.value; serieDe(S.zone).then(afficherCourbe); };
    $('includeBeta').onchange = e => { S.beta = e.target.checked; serieDe(S.zone).then(afficherCourbe); };
    $('copySummary').onclick = async () => {
      const a = S.analyse; if (!a) return;
      const txt = [`SAJE Field · ${a.zone} · ${F(a.date.date)} (${LM(a.date.maturite)})`, `${a.verdict.titre}. ${a.verdict.texte}`, '',
        ...a.constats.map(c => `• ${c.titre} : ${c.texte} [${c.conf.libelle}]`), '', 'Non exploitable :', ...a.inconnues.map(u => `• ${u.libelle} : ${u.raisons[0]}`), '',
        'Recommandations :', ...a.recommandations.map(r => `• ${r.texte}`), '',
        ...((a.previsions || []).some(p => p.ok) ? ['Prévision du prochain passage :', ...a.previsions.filter(p => p.ok).map(p => { const f = fourchette(p); return `• ${p.ind.libelle} vers le ${F(p.cible.date)} : ${f.val} (entre ${f.de} et ${f.a})${p.risque ? `, ${Math.round(p.risque.p * 100)} % de chances de sortir de la normale` : ''} [méthode : ${PM(p.modele.id).nom}]`; }), ''] : []),
        'Source : NASA-ISRO NISAR (ASF DAAC) · SAJE Field, équipe Hope 241'].join('\n');
      try { await navigator.clipboard.writeText(txt); }
      catch (e) { const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
      toast('Résumé copié');
    };
    $('exportCsv').onclick = async () => {
      const s = R.completer(await serieDe(S.zone));
      const cols = ['date', 'orbite', 'maturite', 'double_pol', 'part_eau_pct', 'part_inondation_pct', 'part_vegetation_inondee_pct', 'HH_dB', 'HV_dB', 'HVmoinsHH_dB', 'anomalie_HH_dB', 'humidite_m3m3', 'sol_mesure_pct', 'sol_fiable_pct', 'couverture_pct'];
      const fmt = v => v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000).replace('.', ',') : v;
      telecharger('﻿' + [cols.join(';'), ...s.map(p => cols.map(c => fmt(p[c])).join(';'))].join('\n'), `saje_field_${slug(S.zone)}.csv`, 'text/csv');
      toast('Fichier CSV téléchargé');
    };
    $('exportForecast').onclick = () => {
      const a = S.analyse; if (!a?.previsions) return;
      const fmt = v => v == null ? '' : typeof v === 'number' ? String(Math.round(v * 10000) / 10000).replace('.', ',') : String(v).replace(/;/g, ',');
      const cols = ['zone', 'passage_choisi', 'indicateur', 'prevision_possible', 'passage_prevu', 'prevision', 'bas_95', 'haut_95', 'prevision_km2', 'proba_hors_normale', 'sens', 'methode', 'erreur_moyenne_passee', 'passages_testes', 'confiance', 'calcul', 'raison'];
      const lignes = a.previsions.map(p => p.ok
        ? [a.zone, a.date.date, p.id, 'oui', p.cible.date, p.valeur, p.bas, p.haut, p.km2, p.risque?.p, p.risque?.sens, PM(p.modele.id).savant, p.mae, p.m, p.conf.niveau, p.source, '']
        : [a.zone, a.date.date, p.id, 'non', '', '', '', '', '', '', '', '', '', '', '', p.source, p.raison]);
      telecharger('﻿' + [cols.join(';'), ...lignes.map(l => l.map(fmt).join(';'))].join('\n'), `saje_field_previsions_${slug(a.zone)}_${a.date.date}.csv`, 'text/csv');
      toast('Prévisions téléchargées (CSV)');
    };
    $('printSheet').onclick = () => window.print();
    $$('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).close());
    $('tourStart').onclick = () => visite(0);
    $('helpToggle').onclick = () => { reglages(false); visite(0); };
    // raisonnement : replié en mode simple, ouvert en mode analyste
    $('reasonToggle').onclick = () => {
      const o = $('reasoning').classList.toggle('ouvert');
      $('reasonToggle').setAttribute('aria-expanded', String(o));
      $('reasonToggle').firstElementChild.textContent = o ? 'Masquer le raisonnement' : 'Voir le raisonnement';
    };
    $('tourPrev').onclick = () => visite(Math.max(0, etape - 1));
    $('tourNext').onclick = () => { if (etape === 2) { $('tour').close(); aller('carte'); } else visite(etape + 1); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('tour').open) $('tour').close(); });
  }

  function remplirDates() {
    $('dateSelect').innerHTML = ''; $('beforeSelect').innerHTML = '';
    M.dates.forEach((d, i) => $('dateSelect').add(new Option(libDate(d), i)));
    M.dates.forEach(d => $('beforeSelect').add(new Option(libDate(d), d.date + '|' + d.orbite)));
    $('dateSelect').value = M.dates.indexOf(S.date); $('beforeSelect').value = S.avant;
    $('chartMetric').innerHTML = ''; R.ORDRE.forEach(id => $('chartMetric').add(new Option(R.IND[id].libelle, id))); $('chartMetric').value = S.metrique;
    $('latestBadge').textContent = LM(M.dates.at(-1).maturite);
    $$('#timeline .tdot').forEach((b, i) => { b.title = libDate(M.dates[i]); b.setAttribute('aria-label', libDate(M.dates[i])); });
  }

  // ------------------------------------------------------------------ démarrage
  function demarrer() {
    if (!M) { $('main').innerHTML = '<div class="notice">Données absentes : copiez <code>js/donnees/data_province.js</code> puis rechargez.</div>'; return; }
    const der = M.dates.at(-1);
    $('latestDate').textContent = F(der.date);
    $('latestBadge').textContent = LM(der.maturite); $('latestBadge').className = 'badge ' + der.maturite;
    if (M.dates.some(d => d.maturite === 'BETA')) {
      $('dataNotice').hidden = false;
      $('dataNotice').innerHTML = `${ico('info')}<span>Les passages de novembre 2025 à janvier 2026 sont des <b>données d’essai</b> (version « bêta », non calibrée, cercles vides sur la frise) : SAJE Field les affiche mais ne s’en sert pas pour juger ce qui est habituel. <a href="#sources" data-page-link="sources">Voir la qualité des données</a></span>`;
    }
    const ref = M.dates.find(d => d.date === der.reference) || M.dates.find(d => d.double_pol && d.maturite !== 'BETA') || M.dates[0];
    S.avant = ref.date + '|' + ref.orbite;
    remplirDates();
    ongletsThemes(); remplirZones(); lier();
    pageComprendre(); pageSources(); methodePrevision();
    carte.dessinerPerso(S.perso, null);
    aller((location.hash || '#carte').slice(1), false);
    majTout();
    const reseau = () => testerInternet(ok => {
      S.enLigne = ok;
      if ($('moreNetTxt')) { $('moreNetTxt').textContent = ok ? 'En ligne : fond satellite disponible' : 'Hors ligne : tout fonctionne sans Internet'; $('moreNet').classList.toggle('ok', ok); }
      window.Observatoire?.reseau(ok);
      $('netChip').classList.toggle('online', ok);
      $('netText').textContent = ok ? 'En ligne' : 'Hors ligne';
      $('netChip').title = ok ? 'Fond satellite disponible' : 'Hors ligne : toutes les données radar restent disponibles';
      if (!ok && S.sat) { S.sat = false; carte.satellite(false); }
      majCarte();
    });
    window.addEventListener('online', reseau); window.addEventListener('offline', reseau);
    reseau();
  }

  /** Ouvre une zone de la carte interactive dans le tableau de bord. */
  function ouvrirDansTableau(z, d, avant) {
    if (d) S.date = d;
    S.comparer = !!avant;
    if (avant) S.avant = avant.date + '|' + avant.orbite;
    $('compareToggle').checked = S.comparer; $('compareBox').hidden = !S.comparer;
    if (avant) $('beforeSelect').value = S.avant;
    if (!SUIVIES.includes(z.nom) && !S.perso.some(x => x.nom === z.nom)) {
      if (S.point) delete cache.series[S.point.nom];
      S.point = { nom: z.nom, ids: z.ids, geometry: z.geometry, surface: z.surface, ponctuel: false, opts: {}, cercle: !!z.cercle };
      if (z.serie) cache.series[z.nom] = z.serie;
      carte.effacerPoint();
      remplirZones();
    }
    aller('accueil');
    choisirZone(z.nom);
  }
  window.SAJE_APP = {
    S, aller, ouvrirDansTableau, enLigne: () => S.enLigne,
    outils: { ico, svg, esc, spark, badgeConf, ETATS, F, N, toast, remplirIcones },
  };
  demarrer();
})();
