// donnees.js — acces aux donnees NISAR (js/donnees/data_province.js, genere par preparer_donnees_prototype.py)
const Donnees = (() => {
  const D = window.SAJE || {};
  const M = D.province || D[Object.keys(D)[0]] || null;

  // les images sont dans data/ (meme arborescence que donnees_traitees/)
  const url = chemin => chemin ? 'data/' + chemin : null;

  // ---------------------------------------------------------------- zones en cercles
  // Chaque zone suivie est représentée par un cercle de même surface, centré sur la zone.
  // Les calculs se font sur ce cercle (cube radar), pour que ce qui est dessiné soit ce qui est analysé.
  const KM_LAT = 110.57, kmLon = lat => 111.32 * Math.cos(lat * Math.PI / 180);
  function cercle(lat, lon, rKm, n = 72) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = (i % n) / n * 2 * Math.PI;
      pts.push([+(lon + rKm * Math.cos(t) / kmLon(lat)).toFixed(5), +(lat + rKm * Math.sin(t) / KM_LAT).toFixed(5)]);
    }
    return { type: 'Polygon', coordinates: [pts] };
  }
  function boite(geom) {
    const pts = (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates).flatMap(p => p[0]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  let _suivies = null;
  const zonesSuivies = () => _suivies ||= (M?.zones?.features || []).filter(f => !f.properties.temoin).map(f => {
    if (f.properties.masque_terre) return f;
    const [x0, y0, x1, y1] = boite(f.geometry), lat = (y0 + y1) / 2, lon = (x0 + x1) / 2;
    const r = Math.max(2.5, Math.sqrt(surfaceKm2(f.geometry) / Math.PI));
    return { ...f, geometry: cercle(lat, lon, r), properties: { ...f.properties, cercle: { lat, lon, r } } };
  });
  const nomsZones = () => zonesSuivies().map(f => f.properties.nom).filter(n => (M.series?.[n] || []).length);

  // surface approximative d'un polygone (km2), suffisante pour convertir des % en km2
  function surfaceKm2(geom) {
    const anneau = r => {
      const lat0 = r.reduce((s, p) => s + p[1], 0) / r.length * Math.PI / 180;
      let a = 0;
      for (let i = 0; i < r.length - 1; i++) {
        const [x1, y1] = r[i], [x2, y2] = r[i + 1];
        a += (x1 * y2 - x2 * y1);
      }
      return Math.abs(a / 2) * 111.32 * Math.cos(lat0) * 110.57;
    };
    const poly = p => anneau(p[0]) - p.slice(1).reduce((s, t) => s + anneau(t), 0);
    if (!geom) return null;
    if (geom.type === 'Polygon') return poly(geom.coordinates);
    if (geom.type === 'MultiPolygon') return geom.coordinates.reduce((s, p) => s + poly(p), 0);
    return null;
  }
  const surfaces = {};
  zonesSuivies().forEach(f => { surfaces[f.properties.nom] = surfaceKm2(f.geometry); });

  const serie = zone => M.series?.[zone] || [];
  const point = (zone, date, orbite) => serie(zone).find(p => p.date === date && (orbite == null || p.orbite === orbite));
  const precedent = (zone, date, cle, orbite) => {
    const s = serie(zone), i = s.findIndex(p => p.date === date && (orbite == null || p.orbite === orbite));
    for (let k = i - 1; k >= 0; k--) if (s[k][cle] != null && s[k].maturite !== 'BETA' && (orbite == null || s[k].orbite === orbite)) return s[k];
    return null;
  };

  // mise en forme des dates mise en cache (toLocaleDateString est lent et appelé des milliers de fois)
  const _dates = new Map();
  function formatDate(iso, court = false) {
    const k = iso + (court ? 'c' : '');
    let v = _dates.get(k);
    if (v == null) {
      v = new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', court ? { day: '2-digit', month: 'short' } : { day: 'numeric', month: 'long', year: 'numeric' });
      _dates.set(k, v);
    }
    return v;
  }
  const dmy = iso => iso.split('-').reverse().slice(0, 2).join('/');
  const _fmt = [];
  const nombre = (v, n = 1) => v == null || Number.isNaN(v) ? '—'
    : (_fmt[n] ||= new Intl.NumberFormat('fr-FR', { maximumFractionDigits: n, minimumFractionDigits: n })).format(v);

  // niveau de confiance d'une date : VALIDATED + double polarisation = bonne
  function confiance(d) {
    if (!d) return { cle: 'none', txt: 'Inconnue' };
    if (d.gcov_disponible === false) return { cle: 'moyenne', txt: 'SME2 : ' + d.maturite + ' (sans image radar)' };
    if (d.maturite === 'BETA') return { cle: 'faible', txt: 'Confiance faible (bêta)' };
    if (!d.double_pol) return { cle: 'moyenne', txt: 'Confiance moyenne (HH seul)' };
    if (d.maturite === 'VALIDATED') return { cle: 'bonne', txt: 'Confiance bonne' };
    return { cle: 'moyenne', txt: 'Confiance moyenne (provisoire)' };
  }

  // ---------------------------------------------------------------- libellés selon le mode
  const analyste = () => document.documentElement.dataset.detail === 'expert';
  const libMaturite = m => analyste()
    ? ({ VALIDATED: 'Validé', PROVISIONAL: 'Provisoire', BETA: 'Bêta' }[m] || m)
    : ({ VALIDATED: 'Donnée validée', PROVISIONAL: 'Donnée provisoire', BETA: 'Donnée d’essai' }[m] || m);
  const libPol = d => analyste() ? (d.double_pol ? 'HH + HV' : 'HH seul') : (d.double_pol ? 'Mesure complète' : 'Mesure partielle');

  return { M, url, zonesSuivies, cercle, KM_LAT, kmLon, analyste, libMaturite, libPol, nomsZones, surfaces, serie, point, precedent, formatDate, dmy, nombre, confiance };
})();
