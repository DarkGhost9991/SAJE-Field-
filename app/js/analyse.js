/* Calculs locaux sur le cube NISAR réduit. Aucune requête réseau. */
const Analyse = (() => {
  'use strict';
  let cube, raw, ready;
  const M = () => Donnees.M;
  async function charger() {
    if (ready) return ready;
    ready = (async () => {
      cube = window.SAJE_CUBE?.[M().niveau || 'province'];
      if (!cube || typeof DecompressionStream === 'undefined') throw new Error('Analyse locale indisponible dans ce navigateur ou cube absent.');
      raw = new Uint8Array(await new Response(new Blob([decoder64(cube.gz_b64)]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      if (raw.length !== cube.nx * cube.ny * 4 * cube.dates.length) throw new Error('Le cube de données est incomplet.');
      return cube;
    })();
    return ready;
  }
  /** Décodage base64 rapide (sans fonction appelée pour chaque caractère). */
  function decoder64(b64) {
    const bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function indexDate(d) {
    if (cube.orbites) return cube.dates.findIndex((v, i) => v === d.date && cube.orbites[i] === d.orbite);
    const ids = cube.dates.map((v, i) => v === d.date ? i : -1).filter(i => i >= 0);
    return ids.length === 1 ? ids[0] : -1;
  }
  function tableaux(d) {
    if (!raw) return null;
    const i = indexDate(d), n = cube.nx * cube.ny;
    if (i < 0) return null;
    return Object.fromEntries(['hh', 'hv', 'classe', 'sm'].map((k, j) => [k, raw.subarray((i * 4 + j) * n, (i * 4 + j + 1) * n)]));
  }
  const db = b => b === 255 ? null : cube.codage.dB[0] + b / 254 * (cube.codage.dB[1] - cube.codage.dB[0]);
  function centre(i) { return [cube.ouest + (i % cube.nx + .5) * cube.pas, cube.nord - (Math.floor(i / cube.nx) + .5) * cube.pas]; }
  function dansAnneau(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x, y] = ring[i], [xx, yy] = ring[j];
      if ((y > point[1]) !== (yy > point[1]) && point[0] < (xx - x) * (point[1] - y) / (yy - y) + x) inside = !inside;
    }
    return inside;
  }
  function contient(point, geom) {
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    return polys.some(p => dansAnneau(point, p[0]) && !p.slice(1).some(r => dansAnneau(point, r)));
  }
  /** Pixels dont le centre est dans la géométrie : on ne teste que la boîte englobante. */
  function indices(geometry) {
    if (!cube) return [];
    const pts = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).flatMap(p => p[0]);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const cx0 = Math.max(0, Math.floor((x0 - cube.ouest) / cube.pas)), cx1 = Math.min(cube.nx - 1, Math.ceil((x1 - cube.ouest) / cube.pas));
    const cy0 = Math.max(0, Math.floor((cube.nord - y1) / cube.pas)), cy1 = Math.min(cube.ny - 1, Math.ceil((cube.nord - y0) / cube.pas));
    const out = [];
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) { const i = y * cube.nx + x; if (contient(centre(i), geometry)) out.push(i); }
    return out;
  }
  function point(lat, lon) {
    const x = Math.floor((lon - cube.ouest) / cube.pas), y = Math.floor((cube.nord - lat) / cube.pas);
    return x < 0 || y < 0 || x >= cube.nx || y >= cube.ny ? [] : [y * cube.nx + x];
  }
  function surface(i) { return cube.pas ** 2 * 111.32 * 110.57 * Math.cos(centre(i)[1] * Math.PI / 180); }
  function stats(ids, d, ponctuel = false, opts = {}) {
    const z = tableaux(d); if (!z) return null;
    let terre = 0, h = [], v = [], ratio = [], sm = [], eau = 0, flood = 0, sous = 0, urb = 0, perm = 0, n = 0, mes = 0, sec = 0, humide = 0, sat = 0, area = 0;
    const thresholds = M().sme2?.seuils_m3m3 || { sec_max: .2, sature_min: .35 };
    for (const i of ids) {
      if (!opts.tout && !(z.classe[i] & 32)) continue;
      terre++;
      const hh = db(z.hh[i]), hv = db(z.hv[i]);
      if (hh != null) {
        h.push(hh); n++; area += surface(i);
        eau += !!(z.classe[i] & 1); flood += !!(z.classe[i] & 2); sous += !!(z.classe[i] & 4); urb += !!(z.classe[i] & 8); perm += !!(z.classe[i] & 16);
      }
      if (hv != null) v.push(hv);
      if (hh != null && hv != null) ratio.push(hv - hh);
      if (z.sm[i] !== 255) {
        mes++;
        if ((z.classe[i] & 64) && d.maturite !== 'BETA') {
          const s = z.sm[i] / 254 * cube.codage.sm_max; sm.push(s);
          if (s < thresholds.sec_max) sec++; else if (s < thresholds.sature_min) humide++; else sat++;
        }
      }
    }
    const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
    const good = sm.length >= (ponctuel ? 1 : 5), pct = a => n ? a / n * 100 : null;
    return { date: d.date, orbite: d.orbite, maturite: d.maturite, double_pol: d.double_pol,
      HH_dB: avg(h), HV_dB: avg(v), HVmoinsHH_dB: avg(ratio), part_eau_pct: pct(eau), part_inondation_pct: pct(flood),
      part_vegetation_inondee_pct: d.double_pol ? pct(sous) : null, part_urbain_pct: pct(urb), part_eau_permanente_pct: pct(perm),
      humidite_m3m3: good ? avg(sm) : null, sol_fiable_pct: mes ? sm.length / mes * 100 : null,
      sol_sec_pct: good ? sec / sm.length * 100 : null, sol_humide_pct: good ? humide / sm.length * 100 : null,
      sol_sature_pct: good ? sat / sm.length * 100 : null, sol_pixels_retenus: sm.length,
      couverture_pct: terre ? n / terre * 100 : 0, terre_pct: ids.length ? terre / ids.length * 100 : 0, pixels: n, sol_mesure_pct: n ? mes / n * 100 : null, surface_observee_km2: area, approx: true };
  }
  function comparer(ids, avant, apres, seuil = 3) {
    if (!avant || avant.orbite !== apres.orbite || avant.date >= apres.date || [avant, apres].some(d => d.maturite === 'BETA')) return null;
    const a = tableaux(avant), b = tableaux(apres); if (!a || !b) return null;
    let perte = 0, gain = 0, total = 0, n = 0;
    for (const i of ids) {
      if (!(a.classe[i] & 32) || !(b.classe[i] & 32) || (a.classe[i] & 8) || (b.classe[i] & 8)) continue;
      const x = db(a.hv[i]), y = db(b.hv[i]); if (x == null || y == null) continue;
      const area = surface(i); total += area; n++;
      if (y - x <= -seuil) perte += area;
      if (y - x >= seuil) gain += area;
    }
    return n ? { perte, gain, total, n, seuil } : null;
  }
  return { charger, tableaux, centre, contient, indices, point, stats, comparer, db, surface,
    resolution: () => cube ? Math.round(cube.pas * 111000) : null, metadata: () => cube };
})();
