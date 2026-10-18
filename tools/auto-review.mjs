#!/usr/bin/env node
// Applies a Mapillary detection export to a map in bulk, producing a corrections
// file the editor can open. Every acceptance goes through the same rules the
// review inspector applies by hand, so a bulk run and a manual run agree.
//
//   node tools/auto-review.mjs data/cambridge.json data/reference/mapillary.json out.json
//   node tools/auto-review.mjs ... --lamps-only
//
// Nothing here invents a position: a detection either passes the carriageway,
// distance and duplicate checks or it is reported as rejected, with the reason.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildNet, nearest, ll2xz } from '../js/net.js';
import { roadClear } from '../js/road-geometry.js';
import { importMapillary, acceptLampSuggestion } from '../js/mapillary-import.js';
import { edgeKey, validateCorrections } from '../js/corrections.js';

const args = process.argv.slice(2);
const lampsOnly = args.includes('--lamps-only');
const [mapPath, featPath, outPath] = args.filter(a => !a.startsWith('--'));
if (!mapPath || !featPath || !outPath) {
  console.error('usage: auto-review.mjs <map.json> <detections.json> <out-corrections.json> [--lamps-only]');
  process.exit(1);
}

const data = JSON.parse(readFileSync(mapPath, 'utf8'));
const net = buildNet(data);
const raw = JSON.parse(readFileSync(featPath, 'utf8'));
const collection = raw.type === 'FeatureCollection' ? raw : { type: 'FeatureCollection', features: raw.features || raw };
const features = importMapillary(collection);

// net.edges is built from data.edges in order; index back to the raw edge for its key.
if (net.edges.length !== data.edges.length) throw new Error('edge arrays are not parallel; cannot key corrections');
const edgeIndex = new Map(net.edges.map((e, i) => [e, i]));

const corrections = { version: 1, edges: {}, lamps: [], islands: [], markings: [], hiddenLamps: [], review: { accepted: [], dismissed: [] } };
const reject = {};
const note = r => { reject[r] = (reject[r] || 0) + 1; };

let lamps = 0;
for (const f of features.filter(f => f.kind === 'lamp')) {
  try { acceptLampSuggestion(net, corrections, f); lamps++; }
  catch (e) { note(e.message.replace(/\s+/g, ' ').slice(0, 60)); }
}

// Painted markings. The renderer spans the carriageway itself for these two
// types, so only the position along the road and its depth are needed.
const MARK = {
  'marking--discrete--crosswalk-zebra': { type: 'zebra', length: 4, width: 0.5 },
  'marking--discrete--stop-line': { type: 'stop', length: 0.4, width: 0.4 },
};
let marks = 0;
if (!lampsOnly) {
  for (const f of features.filter(f => f.kind === 'marking')) {
    const spec = MARK[f.value];
    if (!spec) { note('marking type not supported'); continue; }
    const p = ll2xz(net, f.lat, f.lon), n = nearest(net, p.x, p.z);
    if (!n || n.d > n.way.w / 2 + 2) { note('marking not on a carriageway'); continue; }
    const i = edgeIndex.get(n.e);
    if (i === undefined) { note('edge not in the source map'); continue; }
    const key = edgeKey(data, data.edges[i]);
    const s = Math.max(0, Math.min(n.e.len - spec.length, n.s));
    if (corrections.markings.some(m => m.edgeKey === key && Math.abs(m.s - s) < 2 && m.type === spec.type)) { note('duplicate marking'); continue; }
    corrections.markings.push({ edgeKey: key, type: spec.type, s: +s.toFixed(2), offset: 0,
      length: spec.length, width: spec.width,
      provenance: { source: 'Mapillary', featureId: f.id, lastSeen: f.lastSeen, value: f.value } });
    corrections.review.accepted.push(f.id);
    marks++;
  }
}

validateCorrections(corrections);
writeFileSync(outPath, JSON.stringify(corrections, null, 1));

const kinds = features.reduce((a, f) => (a[f.kind] = (a[f.kind] || 0) + 1, a), {});
console.log(`detections      ${features.length}  ${JSON.stringify(kinds)}`);
console.log(`lamps accepted  ${lamps}`);
console.log(`markings added  ${marks}`);
console.log('rejected:');
for (const [why, n] of Object.entries(reject).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)}  ${why}`);
console.log(`\nwrote ${outPath}`);
