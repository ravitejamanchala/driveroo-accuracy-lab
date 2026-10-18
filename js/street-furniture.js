import { roadFrame, roadClear } from './road-geometry.js';
import { nearest } from './net.js';

export function lampPlacements(net, edges, bounds) {
  const lamps = [], { cx, cz, size } = bounds;
  const inside = (x, z) => Math.floor(x / size) === cx && Math.floor(z / size) === cz;
  const hidden = (x,z) => (net.hiddenLamps || []).some(p => Math.hypot(p.x-x,p.z-z) < 1);
  const occupied = (x, z, radius) => lamps.some(p => Math.hypot(p.x - x, p.z - z) < radius);
  // Explicit locations take precedence. Never shift a mapped point to disguise bad source data.
  for (const p of net.lamps || []) {
    if (p.source !== 'manual' && hidden(p.x,p.z) || !inside(p.x, p.z) || occupied(p.x, p.z, 1)) continue;
    const nr = nearest(net, p.x, p.z); if (!nr) continue;
    const f = roadFrame(nr.e, nr.s), len = Math.hypot(f.x - p.x, f.z - p.z) || 1;
    lamps.push({ ...p, dx: (f.x - p.x) / len, dz: (f.z - p.z) / len });
  }
  if (net.proceduralLamps === false) return lamps;
  for (const e of edges) {
    if (e.way.rb || !/^(primary|secondary|tertiary)/.test(e.way.cls)) continue;
    const setback = v => net.inc[v].length >= 3 ? Math.max(12, ...net.inc[v].map(o => o.e.way.w / 2 + 4)) : 6;
    const start = Math.max(10, setback(e.a)), end = e.len - setback(e.b);
    for (let s = start, i = 0; s < end; s += 34, i++) {
      const p = roadFrame(e, s), side = i % 2 ? 1 : -1, offset = (e.way.w / 2 + 1.2) * side;
      const x = p.x + p.nx * offset, z = p.z + p.nz * offset;
      if (hidden(x,z) || !inside(x, z) || occupied(x, z, 10) || (net.lamps || []).some(q => Math.hypot(q.x - x, q.z - z) < 25) || !roadClear(net, x, z, 0.7)) continue;
      const len = Math.hypot(p.x - x, p.z - z) || 1;
      lamps.push({ x, z, dx: (p.x - x) / len, dz: (p.z - z) / len, source: 'inferred' });
    }
  }
  return lamps;
}
