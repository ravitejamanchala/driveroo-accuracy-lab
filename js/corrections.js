import { smoothRoad } from './map-features.js';
export const DRAFT_KEY = 'driveroo-accuracy-lab:corrections:v1';
export function edgeKey(d, edge) {
  const w = d.ways[edge[2]], f = edge[3];
  // Distinguish separate curves that share endpoints without using area-local IDs.
  let hash = 2166136261;
  for (const ch of JSON.stringify(f)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `${w[11]?.osmId || d.names[w[0]] + ':' + d.classes[w[1]]}|${f[0]},${f[1]}:${f.at(-2)},${f.at(-1)}:${hash.toString(16)}`;
}
export function validateCorrections(c) {
  if (!c || c.version !== 1 || !c.edges || typeof c.edges !== 'object' || Array.isArray(c.edges)) throw Error('Expected corrections version 1 with an edges object.');
  const pointsOK = ps => Array.isArray(ps) && ps.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
  for (const v of Object.values(c.edges)) {
    if (!v || typeof v !== 'object') throw Error('Invalid road correction.');
    if (v.width !== undefined && (!Number.isFinite(v.width) || v.width < 2 || v.width > 40)) throw Error('Road width must be 2–40 metres.');
    for (const k of ['lanesForward', 'lanesBackward']) if (v[k] !== undefined && (!Number.isInteger(v[k]) || v[k] < 0 || v[k] > 8)) throw Error('Lane counts must be whole numbers from 0 to 8.');
    for (const k of ['centreStyle', 'laneStyle']) if (v[k] !== undefined && !['dashed','solid','double','none'].includes(v[k])) throw Error('Invalid marking style.');
    if (v.smooth !== undefined && typeof v.smooth !== 'boolean') throw Error('Invalid curve setting.');
    if (v.points && (!pointsOK(v.points) || v.points.length < 2 || v.points.some((p, i) => i && Math.hypot(p[0] - v.points[i - 1][0], p[1] - v.points[i - 1][1]) < 0.15))) throw Error('Road points must be finite and at least 0.15 metres apart.');
  }
  if (!Array.isArray(c.lamps) || !Array.isArray(c.islands)) throw Error('Expected lamps and islands arrays.');
  if (c.hiddenLamps !== undefined && (!Array.isArray(c.hiddenLamps) || c.hiddenLamps.some(p => ![p.x,p.z].every(Number.isFinite)))) throw Error('Invalid hidden lamp positions.');
  if (c.markings !== undefined && (!Array.isArray(c.markings) || c.markings.some(m => typeof m.edgeKey !== 'string' || !['dashed','solid','double','zebra','stop'].includes(m.type) || ![m.s,m.offset,m.length,m.width].every(Number.isFinite) || m.s < 0 || m.length < .2 || m.length > 2000 || m.width < .05 || m.width > 2 || Math.abs(m.offset) > 40))) throw Error('Invalid road marking dimensions.');
  for (const p of c.lamps) if (![p.x, p.z].every(Number.isFinite)) throw Error('Invalid lamp coordinates.');
  for (const p of c.islands) {
    if (p.height !== undefined && (!Number.isFinite(p.height) || p.height < .05 || p.height > 2)) throw Error('Divider height must be 0.05–2 metres.');
    if (!pointsOK(p.points) || p.points.length < 3) throw Error('An island needs at least three coordinate pairs.');
    const ps = p.points, area = ps.reduce((a, v, i) => { const q = ps[(i + 1) % ps.length]; return a + v[0] * q[1] - q[0] * v[1]; }, 0);
    if (Math.abs(area) < 0.1) throw Error('Island polygon has no usable area.');
    const cross = (a, b, q) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    for (let i = 0; i < ps.length; i++) for (let j = i + 2; j < ps.length; j++) {
      if (i === 0 && j === ps.length - 1) continue;
      const a = ps[i], b = ps[(i + 1) % ps.length], q = ps[j], r = ps[(j + 1) % ps.length];
      if (cross(a, b, q) * cross(a, b, r) <= 0 && cross(q, r, a) * cross(q, r, b) <= 0 && Math.max(Math.min(a[0], b[0]), Math.min(q[0], r[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(q[0], r[0])) && Math.max(Math.min(a[1], b[1]), Math.min(q[1], r[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(q[1], r[1]))) throw Error('Island outline must not cross itself.');
    }
  }
  return c;
}
export function applyCorrections(data, corrections) {
  if (!corrections) return data;
  validateCorrections(corrections);
  const d = structuredClone(data);
  d.edges.forEach((edge, i) => {
    const key = edgeKey(data, data.edges[i]), c = corrections.edges[key];
    if (!c) return;
    const w = d.ways[edge[2]].slice(), meta = { ...(w[11] || {}), correction: true };
    for (const k of ['centreStyle','laneStyle']) if (c[k] !== undefined) meta[k] = c[k];
    if (c.width !== undefined) { w[5] = c.width; meta.widthSource = 'manual'; }
    if (c.lanesForward !== undefined) meta.lanesForward = c.lanesForward;
    if (c.lanesBackward !== undefined) meta.lanesBackward = c.lanesBackward;
    if (Number.isInteger(meta.lanesForward) && Number.isInteger(meta.lanesBackward)) {
      if (meta.lanesForward < 1 || (!w[4] && meta.lanesBackward < 1) || (w[4] && meta.lanesBackward !== 0)) throw Error('Lane directions must agree with this road’s one-way setting.');
      w[7] = meta.lanesForward + meta.lanesBackward;
    }
    const cycles = (w[8] === 1 || w[8] === 2 ? w[10] / 10 : 0) + (w[9] === 1 || w[9] === 2 ? w[10] / 10 : 0);
    if (w[5] - cycles < 2) throw Error('Road width must leave at least 2 metres outside cycle lanes.');
    w[11] = meta; edge[2] = d.ways.length; d.ways.push(w);
    if (c.points) {
      const f = (c.smooth ? smoothRoad(c.points) : c.points).flatMap(p => p.map(v => Math.round(v * 10)));
      // Endpoint movement changes graph connectivity. Edit interior points only in this version.
      if (f[0] !== edge[3][0] || f[1] !== edge[3][1] || f.at(-2) !== edge[3].at(-2) || f.at(-1) !== edge[3].at(-1)) throw Error('Road corrections must retain junction endpoints.');
      // Reproject source stop/crossing positions, rather than retaining stale distances.
      for (const key of ['stops', 'giveways', 'zebras']) for (const feature of d[key] || []) {
        if (feature[0] !== i) continue;
        let s = feature[1], x = edge[3][0], z = edge[3][1];
        for (let j = 0; j < edge[3].length - 2; j += 2) {
          const ax = edge[3][j], az = edge[3][j + 1], dx = edge[3][j + 2] - ax, dz = edge[3][j + 3] - az, length = Math.hypot(dx, dz);
          const t = Math.min(1, s / (length || 1)); x = ax + dx * t; z = az + dz * t;
          if (s <= length) break; s -= length;
        }
        let best = Infinity, distance = 0, accumulated = 0;
        for (let j = 0; j < f.length - 2; j += 2) {
          const dx = f[j + 2] - f[j], dz = f[j + 3] - f[j + 1], length = Math.hypot(dx, dz), t = Math.max(0, Math.min(1, ((x - f[j]) * dx + (z - f[j + 1]) * dz) / (length * length || 1)));
          const squared = (x - f[j] - dx * t) ** 2 + (z - f[j + 1] - dz * t) ** 2;
          if (squared < best) { best = squared; distance = accumulated + t * length; } accumulated += length;
        }
        feature[1] = Math.round(distance);
      }
      edge[3] = f;
    }
  });
  d.manualLamps = corrections.lamps;
  d.islands = corrections.islands;
  return d;
}
