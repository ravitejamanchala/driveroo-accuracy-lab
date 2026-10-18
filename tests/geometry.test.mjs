import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildNet, laneInfo, laneCentre, along, buildRoute, snapWaypoint } from '../js/net.js';
import { ribbonQuads, offsetPoint, roadClear, pointInPolygon } from '../js/road-geometry.js';
import { applyCorrections, edgeKey, validateCorrections } from '../js/corrections.js';
import { lampPlacements } from '../js/street-furniture.js';
import { ROUTES } from '../js/config.js';
import { LESSONS } from '../js/course.js';
import { PUZZLES } from '../js/puzzles.js';

const fixture = (points = [0, 0, 0, 1000], meta = {}) => ({ origin: [0, 0], kx: 1, kz: 1, names: ['Test'], classes: ['primary'], ways: [[0, 0, 30, 0, 0, 9, 0, 3, 0, 0, 15, meta]], nodes: [points[0], points[1], ...points.slice(-2)], edges: [[0, 1, 0, points]], stops: [], zebras: [], giveways: [], minis: [], rbs: [] });
const correction = () => ({ version: 1, edges: {}, lamps: [], islands: [] });
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.0001, `${a} ≈ ${b}`);

test('a 2+1 road has three equal-width lanes and a shifted opposing-flow boundary', () => {
  const e = buildNet(fixture(undefined, { lanesForward: 2, lanesBackward: 1 })).edges[0];
  assert.equal(laneInfo(e, 1).n, 2); assert.equal(laneInfo(e, -1).n, 1);
  close(laneInfo(e, 1).laneW, 3); close(laneInfo(e, -1).laneW, 3);
  close(laneInfo(e, 1).boundary, -1.5);
  close(laneCentre(e, 1, 0), 3); close(laneCentre(e, 1, 1), 0); close(laneCentre(e, -1, 0), 3);
});
test('cycle lanes are excluded from both sides of a one-way motor carriageway', () => {
  const d = fixture(); d.ways[0][4] = 1; d.ways[0][7] = 2; d.ways[0][8] = 1; d.ways[0][9] = 2;
  const L = laneInfo(buildNet(d).edges[0], 1); close(L.inner, -3); close(L.outer, 3); close(L.laneW, 3);
});
test('unknown odd lane counts are retained and marked as inferred', () => {
  const e = buildNet(fixture()).edges[0]; assert.equal(laneInfo(e, 1).n + laneInfo(e, -1).n, 3); assert.equal(laneInfo(e, 1).inferred, true);
});
test('90-degree corner miter keeps constant perpendicular width', () => {
  const e = buildNet(fixture([0, 0, 100, 0, 100, 100])).edges[0], p = offsetPoint(e, 10, 2);
  close(p.x, 12); close(p.z, -2);
  const qs = ribbonQuads(e, -2, 2); assert.equal(qs.length, 2); assert.deepEqual(qs[0][2], qs[1][1]);
});
test('a dash spanning a corner uses the same split geometry as its road', () => {
  const e = buildNet(fixture([0, 0, 100, 0, 100, 100])).edges[0];
  assert.equal(ribbonQuads(e, 1.9, 2.1, 9, 12).length, 2);
  const p = offsetPoint(e, 10, 2), q = along(e, 10, 1, 2); close(p.x, q.x); close(p.z, q.z);
  const backwards = along(e, 10, -1, -2); close(p.x, backwards.x); close(p.z, backwards.z);
});
test('sharp bends have bounded finite offsets', () => {
  const e = buildNet(fixture([0, 0, 100, 0, 1, 1])).edges[0];
  const p = offsetPoint(e, 10, 2); assert.ok(Number.isFinite(p.x)); assert.ok(Math.hypot(p.x - 10, p.z) <= 4.001);
});
test('corrections leave the source unchanged and keys survive area reindexing', () => {
  const d = fixture(), c = correction(), key = edgeKey(d, d.edges[0]); c.edges[key] = { width: 8, lanesForward: 1, lanesBackward: 1 };
  const n = buildNet(d, c); assert.equal(n.edges[0].way.w, 8); assert.equal(d.ways[0][5], 9);
  const sub = structuredClone(d); sub.names.unshift('Other'); sub.ways[0][0] = 1; assert.equal(edgeKey(sub, sub.edges[0]), key);
});
test('a width-only correction accepts imported unknown lane metadata', () => {
  const d = fixture(undefined, { lanesForward: null, lanesBackward: null }), c = correction();
  c.edges[edgeKey(d, d.edges[0])] = { width: 10 }; assert.equal(buildNet(d, c).edges[0].way.w, 10);
});
test('reshaping a road reprojects a crossing and retains graph endpoints', () => {
  const d = fixture([0, 0, 100, 0, 200, 0]); d.zebras = [[0, 150]];
  const c = correction(); c.edges[edgeKey(d, d.edges[0])] = { points: [[0, 0], [10, 10], [20, 0]] };
  const updated = applyCorrections(d, c); assert.ok(updated.zebras[0][1] > 150); assert.equal(d.zebras[0][1], 150);
  c.edges[edgeKey(d, d.edges[0])].points[0] = [1, 0]; assert.throws(() => buildNet(d, c), /endpoints/);
});
test('bad widths, zero-length segments and self-crossing islands are rejected', () => {
  const c = correction(); c.edges.bad = { width: -2 }; assert.throws(() => validateCorrections(c), /width/);
  c.edges.bad = { points: [[0, 0], [0, 0]] }; assert.throws(() => validateCorrections(c), /apart/);
  c.edges = {}; c.islands = [{ points: [[0, 0], [3, 3], [0, 3], [3, 0]] }]; assert.throws(() => validateCorrections(c));
});
test('procedural lamps clear crossing roads and mapped lamps suppress fallback nearby', () => {
  const d = fixture([0, 0, 0, 1500]); d.nodes.push(-200, 100, 200, 100); d.edges.push([2, 3, 0, [-200, 100, 200, 100]]);
  const n = buildNet(d); assert.equal(roadClear(n, 5.7, 10, 0.7), false);
  const points = lampPlacements(n, n.edges, { cx: 0, cz: 0, size: 400 });
  assert.ok(points.every(p => roadClear(n, p.x, p.z, 0.7)));
  d.lamps = [[57, 1000]]; const m = buildNet(d), placed = lampPlacements(m, m.edges, { cx: 0, cz: 0, size: 400 });
  assert.ok(placed.some(p => p.source === 'mapped')); assert.ok(placed.filter(p => p.source === 'inferred').every(p => Math.hypot(p.x - 5.7, p.z - 100) >= 25));
  m.proceduralLamps = false; assert.equal(lampPlacements(m, m.edges, { cx: 0, cz: 0, size: 400 }).length, 1);
});
test('island polygon identifies the actual interior rather than its bounding box', () => {
  const ps = [[0, 0], [5, 0], [0, 5]]; assert.equal(pointInPolygon(1, 1, ps), true); assert.equal(pointInPolygon(4, 4, ps), false);
});
test('existing Cambridge routes, lessons and puzzles still build with finite lane geometry', () => {
  const d = JSON.parse(fs.readFileSync(new URL('../data/cambridge.json', import.meta.url))), net = buildNet(d, correction());
  for (const e of net.edges) for (const dir of e.way.oneway ? [1] : [1, -1]) { const L = laneInfo(e, dir); assert.ok(Number.isFinite(L.laneW) && L.laneW > 0); }
  for (const plan of [...ROUTES, ...LESSONS.filter(l => l.waypoints), ...PUZZLES]) {
    const route = buildRoute(net, plan.waypoints.map(w => snapWaypoint(net, w))); assert.ok(route.steps.length > 0, plan.id); assert.ok(Number.isFinite(route.len), plan.id);
  }
});

test('smoothed road retains graph endpoints and editable source control polygon', async () => {
  const {smoothRoad}=await import('../js/map-features.js');
  const points=[[0,0],[20,0],[20,20]],sampled=smoothRoad(points);
  assert.deepEqual(sampled[0],points[0]);assert.deepEqual(sampled.at(-1),points.at(-1));assert.ok(sampled.length>points.length);
  const d=fixture([0,0,200,0,200,200]),c=correction();c.edges[edgeKey(d,d.edges[0])]={points,smooth:true};
  const net=buildNet(d,c);assert.ok(net.edges[0].n>3);assert.equal(c.edges[edgeKey(d,d.edges[0])].points.length,3);
});
test('road marking settings and custom markings survive engine correction loading', async()=>{
  const {markingQuads,autoMarkings}=await import('../js/map-features.js');const d=fixture(),c=correction(),key=edgeKey(d,d.edges[0]);
  c.edges[key]={centreStyle:'none',laneStyle:'solid'};c.markings=[{edgeKey:key,type:'double',s:10,length:12,width:.14,offset:0}];
  const n=buildNet(d,c);assert.equal(n.markings.length,1);assert.equal(markingQuads(n.edges[0],autoMarkings(n.edges[0])[0]).length,0);assert.equal(markingQuads(n.edges[0],n.markings[0]).length,2);
});
test('deleting inferred lamps persists and moving nearby does not hide the manual replacement',()=>{
  const d=fixture(),c=correction(),n=buildNet(d),bounds={cx:-1,cz:0,size:400};
  const p=lampPlacements(n,n.edges,bounds).find(p=>p.source==='inferred');assert.ok(p);
  c.hiddenLamps=[{x:p.x,z:p.z}];let edited=buildNet(d,c);assert.ok(!lampPlacements(edited,edited.edges,bounds).some(q=>Math.hypot(q.x-p.x,q.z-p.z)<.1));
  c.lamps=[{x:p.x-.2,z:p.z}];edited=buildNet(d,c);assert.ok(lampPlacements(edited,edited.edges,bounds).some(q=>q.source==='manual'));
});
test('divider path produces a valid raised polygon and rejects a crossing outline',async()=>{
  const {dividerPolygon}=await import('../js/map-features.js');const c=correction();c.islands=[{points:dividerPolygon([[0,0],[0,20],[10,30]],1.2),height:.4}];assert.doesNotThrow(()=>validateCorrections(c));assert.ok(pointInPolygon(0,10,c.islands[0].points));c.islands[0].height=-1;assert.throws(()=>validateCorrections(c));
});
test('map package roundtrip preserves edits and rejects unsupported formats and unsafe URLs',async()=>{
  const {createMapPackage,validateMapPackage,resolveMapURL,loadMapPackage}=await import('../js/map-package.js');const d=fixture(),c=correction();c.edges[edgeKey(d,d.edges[0])]={width:12};
  const pack=createMapPackage(d,c),copy=validateMapPackage(JSON.parse(JSON.stringify(pack)));assert.equal(buildNet(copy.data,copy.corrections).edges[0].way.w,12);assert.throws(()=>validateMapPackage({...pack,version:7}));assert.throws(()=>resolveMapURL('javascript:alert(1)','https://example.com'));
  assert.equal(resolveMapURL('maps/v1/map.json','https://example.com/lab/'),'https://example.com/lab/maps/v1/map.json');
  const fetched=await loadMapPackage('https://example.com/map.json',async()=>({ok:true,headers:new Headers(),text:async()=>JSON.stringify(pack)}));assert.equal(fetched.format,'driveroo-map');
});
