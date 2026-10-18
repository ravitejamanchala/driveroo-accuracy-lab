#!/usr/bin/env node
// Rounds the sharp corners OSM traces as two straight legs meeting at a point.
//
//   node tools/smooth-corners.mjs data/cambridge.json out.json [--bend 45] [--max-points 6]
//   node tools/smooth-corners.mjs data/cambridge.json out.json --in data/corrections.json
//
// This INVENTS geometry: Chaikin corner-cutting pulls the road inside the corner,
// off the line OSM surveyed. It makes a drive feel right; it is not an accuracy
// improvement and must not be counted as one. Endpoints are pinned, so junction
// connectivity is unchanged, and the displacement is reported so the cost is visible.
import { readFileSync, writeFileSync } from 'node:fs';
import { edgeKey, validateCorrections } from '../js/corrections.js';
import { smoothRoad } from '../js/map-features.js';

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf('--' + name); return i < 0 ? dflt : args[i + 1]; };
const [mapPath, outPath] = args.filter((a, i) => !a.startsWith('--') && !String(args[i - 1] || '').startsWith('--'));
if (!mapPath || !outPath) { console.error('usage: smooth-corners.mjs <map.json> <out.json> [--bend 45] [--max-points 6] [--in corrections.json]'); process.exit(1); }

const BEND = Number(flag('bend', 45)) * Math.PI / 180;
const MAXP = Number(flag('max-points', 6));
// How far from a corner the rounding is allowed to reach. Without this, Chaikin
// cuts the whole leg and a 90 deg corner moves by more than a road width.
const RADIUS = Number(flag('radius', 6));
const inPath = flag('in', null);

const data = JSON.parse(readFileSync(mapPath, 'utf8'));
const corrections = inPath
  ? validateCorrections(JSON.parse(readFileSync(inPath, 'utf8')))
  : { version: 1, edges: {}, lamps: [], islands: [], markings: [], hiddenLamps: [], review: { accepted: [], dismissed: [] } };

const turn = (p, q, r) => {
  const ax = q[0] - p[0], az = q[1] - p[1], bx = r[0] - q[0], bz = r[1] - q[1];
  return Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
};
// Furthest the smoothed line strays from the original, sampled at the original vertices.
const strayed = (before, after) => {
  let worst = 0;
  for (const p of before) {
    let near = Infinity;
    for (let i = 0; i < after.length - 1; i++) {
      const a = after[i], b = after[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
      near = Math.min(near, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t));
    }
    worst = Math.max(worst, near);
  }
  return worst;
};

// Put a point on each leg a short way from a sharp corner, so the smoothing that
// follows rounds only the corner itself and leaves the straight run where it was.
function withGuards(pts) {
  const out = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) {
    const p = pts[k - 1], q = pts[k], r = pts[k + 1];
    if (turn(p, q, r) < BEND) { out.push(q); continue; }
    const put = (from, to) => {
      const dx = to[0] - from[0], dz = to[1] - from[1], L = Math.hypot(dx, dz) || 1e-9;
      const t = Math.min(RADIUS, L / 2.5) / L;            // never past the midpoint of a leg
      return [from[0] + dx * t, from[1] + dz * t];
    };
    const a = put(q, p), b = put(q, r);
    if (Math.hypot(a[0] - out.at(-1)[0], a[1] - out.at(-1)[1]) >= .15) out.push(a);
    out.push(q);
    if (Math.hypot(b[0] - q[0], b[1] - q[1]) >= .15) out.push(b);
  }
  out.push(pts.at(-1));
  return out;
}

let touched = 0, skippedEdited = 0, worstAll = 0;
const moved = [];
data.edges.forEach((edge, i) => {
  const f = edge[3], n = f.length / 2;
  if (n < 3 || n > MAXP) return;
  const pts = Array.from({ length: n }, (_, k) => [f[2 * k] / 10, f[2 * k + 1] / 10]);
  let worstBend = 0;
  for (let k = 1; k < n - 1; k++) worstBend = Math.max(worstBend, turn(pts[k - 1], pts[k], pts[k + 1]));
  if (worstBend < BEND) return;

  const key = edgeKey(data, edge);
  const existing = corrections.edges[key];
  // Never overwrite a road someone has already shaped by hand.
  if (existing && (existing.points || existing.smooth)) { skippedEdited++; return; }

  const guarded = withGuards(pts);
  const d = strayed(pts, smoothRoad(guarded));
  worstAll = Math.max(worstAll, d);
  moved.push({ d, name: data.names[data.ways[edge[2]][0]] || '(unnamed)', deg: worstBend * 180 / Math.PI });
  corrections.edges[key] = { ...(existing || {}), points: guarded, smooth: true };
  touched++;
});

validateCorrections(corrections);
writeFileSync(outPath, JSON.stringify(corrections, null, 1));

moved.sort((a, b) => b.d - a.d);
console.log(`corners smoothed   ${touched}   (bend > ${Math.round(BEND * 180 / Math.PI)} deg, <= ${MAXP} points)`);
console.log(`left alone         ${skippedEdited} already edited by hand`);
console.log(`road moved by      median ${moved.length ? moved[Math.floor(moved.length / 2)].d.toFixed(2) : 0} m, worst ${worstAll.toFixed(2)} m`);
console.log('\nfurthest moved:');
for (const m of moved.slice(0, 8)) console.log(`   ${m.d.toFixed(2)} m   ${Math.round(m.deg)} deg   ${m.name}`);
console.log(`\nwrote ${outPath}`);
