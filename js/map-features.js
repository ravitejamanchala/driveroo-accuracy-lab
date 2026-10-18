import { ribbonQuads, offsetPoint } from './road-geometry.js';
import { laneInfo } from './net.js';

// Endpoint-preserving corner cutting: controls remain editable; samples drive all renderers.
export function smoothRoad(points, passes = 2) {
  let ps = points.map(p => [...p]);
  for (let n = 0; n < passes; n++) {
    const out = [ps[0]];
    for (let i = 0; i < ps.length - 1; i++) {
      const a = ps[i], b = ps[i + 1];
      out.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
    }
    out.push(ps.at(-1)); ps = out;
  }
  return ps.filter((p, i) => !i || Math.hypot(p[0] - ps[i - 1][0], p[1] - ps[i - 1][1]) >= .15 || i === ps.length - 1);
}
export function polylineEdge(points) {
  const px = points.map(p => p[0]), pz = points.map(p => p[1]), cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]));
  return { px, pz, cum, n: points.length, len: cum.at(-1) };
}
export function dividerPolygon(points, width) {
  const e = polylineEdge(points), left = [], right = [];
  for (const s of e.cum) { const a = offsetPoint(e, s, width / 2), b = offsetPoint(e, s, -width / 2); left.push([a.x, a.z]); right.push([b.x, b.z]); }
  return [...left, ...right.reverse()];
}
export function markingQuads(e, m) {
  const start = Math.max(0, m.s ?? 0), end = Math.min(e.len, start + (m.length ?? e.len));
  const width = m.width ?? .14, offset = m.offset ?? 0, type = m.type || 'dashed';
  const quads = [], line = (a, b, s, t) => quads.push(...ribbonQuads(e, a, b, s, t));
  if (type === 'none') return quads;
  if (type === 'zebra') {
    for (let o = -e.way.w / 2 + .3; o < e.way.w / 2 - .3; o += 1) line(o, Math.min(o + .5, e.way.w / 2 - .3), start, end);
  } else if (type === 'stop') line(-e.way.w / 2 + .2, e.way.w / 2 - .2, start, Math.min(e.len, start + width));
  else if (type === 'double') { for (const o of [offset - width, offset + width]) line(o - width / 2, o + width / 2, start, end); }
  else if (type === 'solid') line(offset - width / 2, offset + width / 2, start, end);
  else for (let s = start; s < end; s += 9) line(offset - width / 2, offset + width / 2, s, Math.min(s + 3, end));
  return quads;
}
export function autoMarkings(e) {
  if (e.way.rb || e.len <= 16) return [];
  const list = [], meta = e.way.meta;
  if (!e.way.oneway && (/^(primary|secondary|tertiary|trunk)/.test(e.way.cls) || e.way.lanes >= 2)) list.push({ type: meta.centreStyle || 'dashed', s: 9, length: e.len - 18, offset: laneInfo(e, 1).boundary });
  for (const dir of e.way.oneway ? [1] : [1, -1]) {
    const L = laneInfo(e, dir);
    for (let k = 1; k < L.n; k++) list.push({ type: meta.laneStyle || 'dashed', s: 8, length: e.len - 16, offset: (L.outer - L.laneW * k) * dir });
  }
  return list;
}
