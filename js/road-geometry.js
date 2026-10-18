// Shared polyline frame. Keep mapped centreline points; do not invent smoother roads.
// At a corner, a capped miter preserves the perpendicular width on both segments.
const normal = (e, i) => {
  const dx = e.px[i + 1] - e.px[i], dz = e.pz[i + 1] - e.pz[i];
  const len = Math.hypot(dx, dz) || 1;
  return { x: dz / len, z: -dx / len };
};
function vertexNormal(e, i) {
  if (!i) return normal(e, 0);
  if (i === e.n - 1) return normal(e, i - 1);
  const a = normal(e, i - 1), b = normal(e, i);
  const x = a.x + b.x, z = a.z + b.z, len = Math.hypot(x, z);
  if (len < 1e-6) return b;
  const nx = x / len, nz = z / len;
  const scale = Math.min(2, 1 / Math.max(0.001, nx * b.x + nz * b.z));
  return { x: nx * scale, z: nz * scale };
}
export function roadFrame(e, distance) {
  const s = Math.max(0, Math.min(e.len, distance));
  let lo = 0, hi = e.n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.cum[m] <= s) lo = m; else hi = m; }
  const len = e.cum[hi] - e.cum[lo] || 1e-6, t = (s - e.cum[lo]) / len;
  const a = vertexNormal(e, lo), b = vertexNormal(e, hi);
  return { x: e.px[lo] + (e.px[hi] - e.px[lo]) * t, z: e.pz[lo] + (e.pz[hi] - e.pz[lo]) * t,
    tx: (e.px[hi] - e.px[lo]) / len, tz: (e.pz[hi] - e.pz[lo]) / len,
    nx: a.x + (b.x - a.x) * t, nz: a.z + (b.z - a.z) * t };
}
export function offsetPoint(e, s, offset) {
  const p = roadFrame(e, s);
  return { ...p, x: p.x + p.nx * offset, z: p.z + p.nz * offset };
}
export function ribbonQuads(e, o1, o2, s0 = 0, s1 = e.len) {
  s0 = Math.max(0, s0); s1 = Math.min(e.len, s1);
  if (s1 <= s0) return [];
  const samples = [s0];
  for (let i = 1; i < e.n - 1; i++) if (e.cum[i] > s0 && e.cum[i] < s1) samples.push(e.cum[i]);
  samples.push(s1);
  return samples.slice(1).map((s, i) => [offsetPoint(e, samples[i], o1), offsetPoint(e, samples[i], o2), offsetPoint(e, s, o2), offsetPoint(e, s, o1)]);
}
export function pointInPolygon(x, z, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i], [xj, zj] = points[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// Check every nearby segment, not just the closest centreline (roads may differ in width).
export function roadClear(net, x, z, clearance = 0.5) {
  const C = net.chunkSize, cx = Math.floor(x / C), cz = Math.floor(z / C), seen = new Set();
  for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
    for (const e of net.chunks.get(net.ck(ix, iz)) || []) {
      if (seen.has(e)) continue; seen.add(e);
      for (let i = 0; i < e.n - 1; i++) {
        const dx = e.px[i + 1] - e.px[i], dz = e.pz[i + 1] - e.pz[i];
        const t = Math.max(0, Math.min(1, ((x - e.px[i]) * dx + (z - e.pz[i]) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(x - e.px[i] - dx * t, z - e.pz[i] - dz * t) < e.way.w / 2 + clearance) return false;
      }
    }
  }
  return true;
}
