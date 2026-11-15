/* =====================================================================
   SAJE Field — carte Leaflet 100 % hors ligne
   Fond : l'image radar NISAR elle-même (locale). Fond satellite Esri en
   option, seulement si Internet répond.
   ===================================================================== */
const LIEUX = [
  ['Libreville', 0.392, 9.454, 'ville'], ['Owendo', 0.291, 9.504], ['Akanda', 0.500, 9.430], ['Ntoum', 0.390, 9.761],
  ['Kango', 0.172, 10.121], ['Cocobeach', 1.000, 9.583], ['Pointe Denis', 0.300, 9.330, '', 'left'], ['Cap Estérias', 0.617, 9.322],
];

function creerCarte(idDiv, opts = {}) {
  const M = Donnees.M;
  const B = M.bornes_leaflet;
  const carte = L.map(idDiv, { zoomControl: true, attributionControl: true, minZoom: 7, maxZoom: 14, zoomSnap: 0.25, keyboard: true });
  carte.attributionControl.setPrefix(false);
  carte.attributionControl.addAttribution('Radar : NASA-ISRO NISAR (ASF DAAC) · Traitement : SAJE Field');
  [['fond', 250], ['avant', 401], ['apres', 402], ['zones', 450], ['outils', 470], ['lieux', 460]].forEach(([n, z]) => { carte.createPane(n).style.zIndex = z; });
  carte.fitBounds(B, { animate: false });
  carte.setMaxBounds(L.latLngBounds(B).pad(0.5));

  let fond = null, sat = null, apres = null, avant = null, opacite = 0.9;
  let surClicZone = () => {}, surClicCarte = null;

  // ---------------- fond radar local
  function setFond(chemin) {
    const u = Donnees.url(chemin);
    if (fond && fond._url === u) return;
    const ancien = fond;
    fond = u ? L.imageOverlay(u, B, { pane: 'fond', opacity: 1 }).addTo(carte) : null;
    if (ancien) setTimeout(() => carte.removeLayer(ancien), 350);
  }
  function satellite(actif) {
    if (actif && !sat) {
      sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Fond : Esri World Imagery' }).addTo(carte);
      carte.getPane('fond').style.display = 'none';
    } else if (!actif && sat) { carte.removeLayer(sat); sat = null; carte.getPane('fond').style.display = ''; }
  }

  // ---------------- contour, zones, lieux
  const contour = (M.zones?.features || []).filter(f => f.properties.masque_terre);
  L.geoJSON({ type: 'FeatureCollection', features: contour }, { pane: 'zones', interactive: false,
    style: { color: '#7dd3fc', weight: 1.6, fill: false, dashArray: '6 5', opacity: .85 } }).addTo(carte);
  const styleZone = actif => ({ color: actif ? '#38bdf8' : '#fcd34d', weight: actif ? 3 : 1.5, dashArray: actif ? null : '5 5', fillColor: '#38bdf8', fillOpacity: actif ? 0.08 : 0.02 });
  const calques = {};
  const zonesCalque = L.geoJSON({ type: 'FeatureCollection', features: Donnees.zonesSuivies().filter(f => !f.properties.masque_terre) }, {
    pane: 'zones', style: () => styleZone(false),
    onEachFeature: (f, l) => {
      calques[f.properties.nom] = l;
      l.bindTooltip(f.properties.nom, { sticky: true, className: 'zone-tip' });
      l.on('click', e => { if (surClicCarte) return; L.DomEvent.stopPropagation(e); surClicZone(f.properties.nom); });
      l.on('keypress', e => { if (e.originalEvent.key === 'Enter') surClicZone(f.properties.nom); });
    },
  }).addTo(carte);
  L.layerGroup(LIEUX.map(([n, la, lo, type, sens]) =>
    L.marker([la, lo], { pane: 'lieux', interactive: false, keyboard: false, icon: L.divIcon({ className: 'place-dot', iconSize: [7, 7] }) })
      .bindTooltip(n, { permanent: true, direction: sens || 'right', offset: [sens ? -4 : 4, 0], className: type === 'ville' ? 'city-label' : 'place-label', pane: 'lieux' })
  )).addTo(carte);
  let zoneActive = null;
  function surligner(nom) {
    if (zoneActive && calques[zoneActive]) calques[zoneActive].setStyle(styleZone(false));
    zoneActive = nom;
    if (calques[nom]) { calques[nom].setStyle(styleZone(true)); calques[nom].bringToFront(); }
  }

  // ---------------- couches thématiques (fondu enchaîné)
  function remplacer(ancien, url, pane) {
    if (ancien && ancien._url === url) { ancien.setOpacity(opacite); return ancien; }
    const nouveau = url ? L.imageOverlay(url, B, { pane, opacity: 0, interactive: false }).addTo(carte) : null;
    if (nouveau) requestAnimationFrame(() => requestAnimationFrame(() => nouveau.setOpacity(opacite)));
    if (ancien) { ancien.setOpacity(0); setTimeout(() => carte.removeLayer(ancien), 480); }
    return nouveau;
  }
  function afficher(urlApres, urlAvant) {
    apres = remplacer(apres, urlApres, 'apres');
    avant = remplacer(avant, urlAvant, 'avant');
    decoupe();
  }
  function setOpacite(v) { opacite = v; apres?.setOpacity(v); avant?.setOpacity(v); }

  // ---------------- rideau avant / après
  let pos = 0.5;
  const rideau = opts.rideau ? document.getElementById(opts.rideau) : null;
  if (rideau) {
    let glisse = false;
    const bouger = x => { const r = carte.getContainer().getBoundingClientRect(); pos = Math.min(.97, Math.max(.03, (x - r.left) / r.width)); decoupe(); };
    rideau.addEventListener('pointerdown', e => { glisse = true; rideau.setPointerCapture(e.pointerId); e.preventDefault(); });
    rideau.addEventListener('pointermove', e => glisse && bouger(e.clientX));
    rideau.addEventListener('pointerup', () => { glisse = false; });
    L.DomEvent.disableClickPropagation(rideau);
  }
  function decoupe() {
    const pa = carte.getPane('apres'), pv = carte.getPane('avant');
    const actif = rideau && avant;
    if (rideau) rideau.hidden = !actif;
    opts.surRideau?.(actif ? pos : null);
    if (!actif) { pa.style.clip = pv.style.clip = ''; return; }
    const t = carte.getSize(), x = t.x * pos;
    rideau.style.left = x + 'px';
    const nw = carte.containerPointToLayerPoint([0, 0]), se = carte.containerPointToLayerPoint(t);
    const xc = carte.containerPointToLayerPoint([x, 0]).x;
    pv.style.clip = `rect(${nw.y}px, ${xc}px, ${se.y}px, ${nw.x}px)`;
    pa.style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${xc}px)`;
  }
  function setPosRideau(p) { pos = p; decoupe(); }
  carte.on('move zoom resize', decoupe);

  // ---------------- outils : point, dessin, zones personnelles
  const outils = L.layerGroup().addTo(carte);
  let marqueur = null;
  function marquerPoint(lat, lon) {
    if (marqueur) outils.removeLayer(marqueur);
    marqueur = L.marker([lat, lon], { pane: 'outils', keyboard: false, icon: L.divIcon({ className: '', html: '<div class="pin-pulse"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(outils);
  }
  let perso = L.layerGroup().addTo(carte);
  function dessinerPerso(zones, active) {
    perso.clearLayers();
    zones.forEach(z => {
      const l = L.geoJSON(z.geometry, { pane: 'zones', style: { color: z.nom === active ? '#38bdf8' : '#a78bfa', weight: z.nom === active ? 3 : 2, fillOpacity: 0.08 } });
      l.on('click', e => { if (surClicCarte) return; L.DomEvent.stopPropagation(e); surClicZone(z.nom); });
      l.bindTooltip(z.nom, { sticky: true, className: 'zone-tip' });
      perso.addLayer(l);
    });
  }
  let trace = null, sommets = [];
  const dessin = {
    debut() { sommets = []; this.maj(); },
    ajouter(ll) { sommets.push([ll.lat, ll.lng]); this.maj(); },
    maj() {
      if (trace) outils.removeLayer(trace);
      trace = sommets.length ? L.layerGroup([
        L.polygon(sommets, { pane: 'outils', color: '#f5b94a', weight: 2, dashArray: '6 4', fillOpacity: 0.12 }),
        ...sommets.map(s => L.marker(s, { pane: 'outils', interactive: false, icon: L.divIcon({ className: 'vertex', iconSize: [12, 12] }) })),
      ]).addTo(outils) : null;
    },
    fin() { const s = sommets; sommets = []; this.maj(); return s; },
    annuler() { sommets = []; this.maj(); },
    nb: () => sommets.length,
  };
  carte.on('click', e => { if (surClicCarte) surClicCarte(e.latlng); });

  // ---------------- cadrage (la carte peut être créée cachée)
  let cible = null;
  function cadrer(geom) {
    carte.invalidateSize();
    const t = carte.getSize();
    if (!t.x || !t.y) return false;
    if (geom) carte.flyToBounds(L.geoJSON(geom).getBounds(), { maxZoom: 11.5, padding: [40, 40], duration: 0.8 });
    else carte.flyToBounds(B, { duration: 0.8 });
    return true;
  }
  let enAttente = true;
  new ResizeObserver(() => { carte.invalidateSize(); if (enAttente) enAttente = !cadrer(cible); decoupe(); }).observe(carte.getContainer());

  return {
    carte, setFond, satellite, afficher, setOpacite, setPosRideau, surligner, marquerPoint, dessinerPerso, dessin,
    zoom(geom) { cible = geom; enAttente = !cadrer(geom); },
    onZone(f) { surClicZone = f; },
    onClic(f) { surClicCarte = f; },
    effacerPoint() { if (marqueur) outils.removeLayer(marqueur); marqueur = null; },
    rafraichir() { carte.invalidateSize(); decoupe(); },
  };
}

/** Le fond satellite n'est proposé que si Internet répond. */
function testerInternet(cb) {
  if (!navigator.onLine) return cb(false);
  const img = new Image(); let fini = false;
  const fin = ok => { if (!fini) { fini = true; cb(ok); } };
  img.onload = () => fin(true); img.onerror = () => fin(false);
  setTimeout(() => fin(false), 4000);
  img.src = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/0/1?t=' + Date.now();
}
