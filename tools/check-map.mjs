#!/usr/bin/env node
// Invariant checks on a map plus its corrections, run after edits and before export.
// Checks the map as the engine will build it, so a width edit that puts an
// existing lamp into the road is caught here rather than in a drive.
//
//   node tools/check-map.mjs data/cambridge.json [corrections.json]
//
// Exits non-zero if any check fails, so it can gate an export.
import { readFileSync } from 'node:fs';
import { buildNet, nearest } from '../js/net.js';
import { roadClear, pointInPolygon } from '../js/road-geometry.js';
import { applyCorrections, validateCorrections } from '../js/corrections.js';

const [mapPath, corrPath] = process.argv.slice(2);
if (!mapPath) { console.error('usage: check-map.mjs <map.json> [corrections.json]'); process.exit(1); }

const source = JSON.parse(readFileSync(mapPath, 'utf8'));
const corrections = corrPath ? JSON.parse(readFileSync(corrPath, 'utf8')) : null;

const failures = [];
const fail = (check, detail) => failures.push({ check, detail });

// 1. The corrections file is well formed on its own terms.
if (corrections) {
  try { validateCorrections(corrections); } catch (e) { fail('corrections valid', e.message); }
}

// 2. Build the map the way the engine will, corrections included.
let data = source;
try { data = corrections ? applyCorrections(source, corrections) : source; }
catch (e) { fail('corrections apply', e.message); }
const net = buildNet(data);

// 3. No lamp inside a carriageway. Imported and manual lamps bypass the
//    placement check by design, and a later width edit can swallow one.
// applyCorrections folds corrections.lamps into the map, so net.lamps already
// holds them; take the built list and de-duplicate by position.
const lamps = [];
const seenAt = new Set();
for (const p of [...(net.lamps || []), ...(corrections?.lamps || [])]) {
  const k = `${Math.round(p.x * 100)},${Math.round(p.z * 100)}`;
  if (seenAt.has(k)) continue;
  seenAt.add(k); lamps.push(p);
}
const inRoad = [];
for (const p of lamps) {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) { fail('lamp coordinates', JSON.stringify(p)); continue; }
  if (!roadClear(net, p.x, p.z, 0.3)) {
    const n = nearest(net, p.x, p.z);
    inRoad.push({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), road: n?.way.name || '(unnamed)',
      clearance: +(n ? n.d - n.way.w / 2 : 0).toFixed(2), width: n?.way.w,
      source: p.provenance?.source || 'map' });
  }
}
if (inRoad.length) fail('lamps clear of carriageway', `${inRoad.length} of ${lamps.length} lamps stand in a road`);

// 4. Markings must sit within the edge they are keyed to.
let strayMarks = 0;
if (corrections?.markings?.length) {
  const byKey = new Map();
  const { edgeKey } = await import('../js/corrections.js');
  data.edges.forEach((e, i) => byKey.set(edgeKey(data, source.edges[i] || e), net.edges[i]));
  for (const m of corrections.markings) {
    const e = byKey.get(m.edgeKey);
    if (!e) { strayMarks++; continue; }
    if (m.s < 0 || m.s > e.len) strayMarks++;
  }
  if (strayMarks) fail('markings within their road', `${strayMarks} of ${corrections.markings.length} markings fall outside the road they name`);
}

// 5. Islands must not sit on a lane centre a car is expected to drive down.
let blocked = 0;
for (const island of corrections?.islands || []) {
  const poly = island.points;
  for (const e of net.edges) {
    for (let i = 0; i < e.n; i++) if (pointInPolygon(e.px[i], e.pz[i], poly)) { blocked++; i = e.n; }
    if (blocked) break;
  }
}
if (blocked) fail('islands clear of road centrelines', `${blocked} island(s) sit on a centreline`);

// ---- report ----
console.log(`map            ${mapPath}`);
console.log(`corrections    ${corrPath || '(none)'}`);
console.log(`ways/edges     ${data.ways.length} / ${data.edges.length}`);
console.log(`lamps checked  ${lamps.length}`);
console.log('');
if (inRoad.length) {
  console.log(`lamps standing in a carriageway: ${inRoad.length}`);
  const byRoad = {};
  for (const l of inRoad) byRoad[l.road] = (byRoad[l.road] || 0) + 1;
  for (const [road, n] of Object.entries(byRoad).sort((a, b) => b[1] - a[1]).slice(0, 10))
    console.log(`   ${String(road).slice(0, 32).padEnd(32)} ${n}`);
  const worst = inRoad.sort((a, b) => a.clearance - b.clearance)[0];
  console.log(`   deepest intrusion: ${worst.clearance} m inside ${worst.road} (width ${worst.width} m)`);
  console.log('');
}
for (const f of failures) console.log(`FAIL  ${f.check}: ${f.detail}`);
if (!failures.length) console.log('All checks passed.');
process.exit(failures.length ? 1 : 0);
