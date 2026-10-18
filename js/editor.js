import { buildNet, laneInfo, nearest } from './net.js';
import { ribbonQuads, offsetPoint, roadClear } from './road-geometry.js';
import { lampPlacements } from './street-furniture.js';
import { DRAFT_KEY, validateCorrections } from './corrections.js';

const $ = id => document.getElementById(id), canvas = $('map'), ctx = canvas.getContext('2d');
let data, net, original, selected = 0, view = { x: 0, z: 0, scale: 3 }, size = { w: 0, h: 0 };
let corrections, mode = 'select', baseline = false, polygon = [], drag = null, lamps = [], dirty = true;
const history = [];
const status = message => { $('status').textContent = message; };
const world = (x, y) => ({ x: (x - size.w / 2) / view.scale + view.x, z: (y - size.h / 2) / view.scale + view.z });
const screen = (x, z) => ({ x: (x - view.x) * view.scale + size.w / 2, y: (z - view.z) * view.scale + size.h / 2 });
function beforeEdit() { history.push(structuredClone(corrections)); if (history.length > 60) history.shift(); }
function save() {
  try { validateCorrections(corrections); net = buildNet(data, corrections); localStorage.setItem(DRAFT_KEY, JSON.stringify(corrections)); dirty = true; refreshForm(); status(`Saved locally · ${Object.keys(corrections.edges).length} corrected sections · ${corrections.lamps.length} manual lamps · ${corrections.islands.length} islands`); }
  catch (e) { status(e.message); throw e; }
}
function rebuildLamps() {
  lamps = []; const C = net.chunkSize, x0 = Math.floor((view.x - size.w / view.scale / 2) / C), x1 = Math.floor((view.x + size.w / view.scale / 2) / C), z0 = Math.floor((view.z - size.h / view.scale / 2) / C), z1 = Math.floor((view.z + size.h / view.scale / 2) / C);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) lamps.push(...lampPlacements(net, net.chunks.get(net.ck(x, z)) || [], { cx: x, cz: z, size: C }));
  dirty = false;
}
function refreshForm() {
  const e = net.edges[selected]; if (!e) return;
  const f = laneInfo(e, 1), b = laneInfo(e, -1);
  $('width').value = e.way.w; $('forward').value = f.n; $('backward').value = e.way.oneway ? 0 : b.n; $('backward').disabled = !!e.way.oneway;
  $('procedural').checked = corrections.proceduralLamps !== false;
  $('road').value = String(selected);
  $('roadMeta').textContent = `${Math.round(e.len)} m · ${e.way.oneway ? 'One way' : 'Two way'} · Width: ${e.way.meta.widthSource || 'inferred'} · Lanes: ${f.inferred ? 'inferred' : 'specified'}`;
}
function roadOptions() {
  const q = $('search').value.toLowerCase(), matches = net.edges.filter(e => e.way.name.toLowerCase().includes(q));
  $('road').replaceChildren(...matches.slice(0, 400).map(e => new Option(`${e.way.name || 'Unnamed road'} · section ${e.id}`, e.id)));
  if (matches.length && !matches.some(e => e.id === selected)) selected = matches[0].id;
  refreshForm();
}
function centre() {
  const e = net.edges[selected], xs = [...e.px], zs = [...e.pz];
  view.x = (Math.min(...xs) + Math.max(...xs)) / 2; view.z = (Math.min(...zs) + Math.max(...zs)) / 2;
  view.scale = Math.max(0.2, Math.min(8, Math.min(size.w / (Math.max(...xs) - Math.min(...xs) + 75), size.h / (Math.max(...zs) - Math.min(...zs) + 75)))); dirty = true;
}
function trace(points, fill, stroke) {
  ctx.beginPath(); points.forEach((p, i) => { const s = screen(p.x, p.z); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
function strip(e, a, b, colour, start = 0, end = e.len) { for (const q of ribbonQuads(e, a, b, start, end)) trace(q, colour); }
function visible(e) { return [...e.px].some((x, i) => Math.abs(x - view.x) < size.w / view.scale / 2 + 150 && Math.abs(e.pz[i] - view.z) < size.h / view.scale / 2 + 150); }
function draw() {
  requestAnimationFrame(draw); if (!net) return;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); ctx.clearRect(0, 0, size.w, size.h);
  ctx.fillStyle = '#152631'; ctx.fillRect(0, 0, size.w, size.h);
  const shown = baseline ? original : net, edges = shown.edges.filter(visible);
  for (const e of edges) strip(e, -e.way.w / 2 - 2.6, e.way.w / 2 + 2.6, '#41505a');
  for (const e of edges) {
    strip(e, -e.way.w / 2, e.way.w / 2, e.id === selected ? '#315c60' : '#263944');
    if (!e.way.oneway && e.len > 18) for (let s = 9; s < e.len - 9; s += 9) strip(e, laneInfo(e, 1).boundary - 0.07, laneInfo(e, 1).boundary + 0.07, '#cfdbd9', s, s + 3.2);
    for (const dir of e.way.oneway ? [1] : [1, -1]) {
      const L = laneInfo(e, dir);
      for (let k = 1; k < L.n; k++) for (let s = 8; s < e.len - 8; s += 9) { const o = (L.outer - L.laneW * k) * dir; strip(e, o - 0.07, o + 0.07, '#9cb9be', s, s + 3); }
    }
  }
  if (!baseline) {
    for (const island of net.islands) trace(island.points.map(([x, z]) => ({ x, z })), '#819081', '#dce7d7');
    if (dirty) rebuildLamps();
    for (const p of lamps) { const s = screen(p.x, p.z); ctx.beginPath(); ctx.arc(s.x, s.y, p.source === 'inferred' ? 2.5 : 4, 0, Math.PI * 2); ctx.fillStyle = p.source === 'inferred' ? '#f8ce70' : '#d9f5ff'; ctx.fill(); }
  }
  const e = shown.edges[selected];
  if (e) {
    ctx.beginPath(); for (let i = 0; i < e.n; i++) { const p = screen(e.px[i], e.pz[i]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); } ctx.strokeStyle = '#51dfc5'; ctx.lineWidth = 1.5; ctx.stroke();
    if (!baseline) for (let i = 0; i < e.n; i++) { const p = screen(e.px[i], e.pz[i]); ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, 2 * Math.PI); ctx.fillStyle = i === 0 || i === e.n - 1 ? '#8b9caa' : '#51dfc5'; ctx.fill(); }
  }
  if (polygon.length) trace(polygon.map(([x, z]) => ({ x, z })), '#a6bb8c44', '#d8f4c4');
  const bar = 50 * view.scale; ctx.fillStyle = '#d4e8eb'; ctx.fillRect(size.w - bar - 20, size.h - 70, bar, 2); ctx.font = '11px system-ui'; ctx.fillText('50 m', size.w - bar - 20, size.h - 77);
}
function setMode(next) { mode = next; polygon = []; $('finishIsland').style.display = next === 'island' ? 'block' : 'none'; document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === next))); $('hint').textContent = { select: 'Drag teal interior points. Double-click a segment to add a point. Junction endpoints stay fixed.', pan: 'Drag to move the map. Scroll or use + / − to zoom.', lamp: 'Click a clear pavement to add a lamp. Drag a manual lamp to move it. Undo removes the last edit.', island: 'Click the corners of an island or central reservation, then choose Finish island. Verify its position before driving.' }[next]; }
function eventPoint(event) { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
canvas.addEventListener('pointerdown', ev => {
  if (!net) return; const mouse = eventPoint(ev), p = world(mouse.x, mouse.y); canvas.setPointerCapture(ev.pointerId);
  if (mode === 'pan' || ev.button === 1 || ev.shiftKey) { drag = { type: 'pan', mouse, x: view.x, z: view.z }; return; }
  if (baseline) { status('Switch back to the edited geometry to make changes.'); return; }
  if (mode === 'island') { polygon.push([p.x, p.z]); return; }
  if (mode === 'lamp') {
    const i = corrections.lamps.findIndex(l => Math.hypot(l.x - p.x, l.z - p.z) * view.scale < 10);
    if (i >= 0) { beforeEdit(); drag = { type: 'lamp', index: i }; return; }
    if (!roadClear(net, p.x, p.z, 0.5)) { status('That point is inside a carriageway. Place the lamp on a clear pavement.'); return; }
    beforeEdit(); corrections.lamps.push({ x: p.x, z: p.z }); save(); return;
  }
  const e = net.edges[selected];
  for (let i = 1; i < e.n - 1; i++) if (Math.hypot(e.px[i] - p.x, e.pz[i] - p.z) * view.scale < 10) { beforeEdit(); drag = { type: 'point', index: i, key: e.key }; return; }
  const n = nearest(net, p.x, p.z); if (n && n.d < Math.max(10, 15 / view.scale)) { selected = n.e.id; $('search').value = n.way.name; roadOptions(); refreshForm(); }
});
canvas.addEventListener('pointermove', ev => {
  if (!drag) return; const mouse = eventPoint(ev), p = world(mouse.x, mouse.y);
  if (drag.type === 'pan') { view.x = drag.x - (mouse.x - drag.mouse.x) / view.scale; view.z = drag.z - (mouse.y - drag.mouse.y) / view.scale; dirty = true; return; }
  if (drag.type === 'lamp') { if (!roadClear(net, p.x, p.z, 0.5)) return; corrections.lamps[drag.index] = { x: p.x, z: p.z }; }
  else {
    const e = net.edges[selected], c = corrections.edges[e.key] ||= {};
    c.points ||= Array.from(e.px, (x, i) => [x, e.pz[i]]);
    if ([c.points[drag.index - 1], c.points[drag.index + 1]].some(q => Math.hypot(q[0] - p.x, q[1] - p.z) < 0.3)) return;
    c.points[drag.index] = [p.x, p.z];
  }
  net = buildNet(data, corrections); dirty = true;
});
function endDrag() { if (drag && drag.type !== 'pan') save(); drag = null; }
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('dblclick', ev => {
  if (mode !== 'select' || baseline) return; const mouse = eventPoint(ev), p = world(mouse.x, mouse.y), e = net.edges[selected];
  let best = null;
  for (let i = 0; i < e.n - 1; i++) {
    const dx = e.px[i + 1] - e.px[i], dz = e.pz[i + 1] - e.pz[i], t = Math.max(0, Math.min(1, ((p.x - e.px[i]) * dx + (p.z - e.pz[i]) * dz) / (dx * dx + dz * dz || 1))), x = e.px[i] + t * dx, z = e.pz[i] + t * dz, distance = Math.hypot(x - p.x, z - p.z);
    if (t > 0.01 && t < 0.99 && (!best || distance < best.distance)) best = { i, x, z, distance };
  }
  if (best && best.distance * view.scale < 16) { beforeEdit(); const c = corrections.edges[e.key] ||= {}; c.points ||= Array.from(e.px, (x, i) => [x, e.pz[i]]); c.points.splice(best.i + 1, 0, [best.x, best.z]); save(); }
});
canvas.addEventListener('wheel', ev => { ev.preventDefault(); const m = eventPoint(ev), p = world(m.x, m.y); view.scale = Math.min(15, Math.max(0.2, view.scale * Math.exp(-ev.deltaY * 0.001))); const q = world(m.x, m.y); view.x += p.x - q.x; view.z += p.z - q.z; dirty = true; }, { passive: false });
$('search').addEventListener('input', roadOptions); $('road').addEventListener('change', () => { selected = Number($('road').value); refreshForm(); centre(); });
$('fit').onclick = centre; $('zoomIn').onclick = () => { view.scale = Math.min(15, view.scale * 1.4); dirty = true; }; $('zoomOut').onclick = () => { view.scale = Math.max(0.2, view.scale / 1.4); dirty = true; };
$('baseline').onclick = () => { baseline = !baseline; $('baseline').setAttribute('aria-pressed', String(baseline)); $('baseline').textContent = baseline ? 'Return to edited geometry' : 'Show original geometry'; status(baseline ? 'Original centreline and dimensions. This is a geometry comparison, not a full original-renderer replay.' : 'Showing edited geometry.'); };
document.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => setMode(b.dataset.mode); });
$('apply').onclick = () => { const candidate = structuredClone(corrections), e = net.edges[selected]; candidate.edges[e.key] = { ...(candidate.edges[e.key] || {}), width: Number($('width').value), lanesForward: Number($('forward').value), lanesBackward: Number($('backward').value) }; try { validateCorrections(candidate); buildNet(data, candidate); beforeEdit(); corrections = candidate; save(); } catch (error) { status(error.message); } };
$('procedural').onchange = () => { beforeEdit(); corrections.proceduralLamps = $('procedural').checked; save(); };
$('undo').onclick = () => { if (history.length) { corrections = history.pop(); polygon = []; save(); } else status('No edits to undo in this session.'); };
$('resetRoad').onclick = () => { beforeEdit(); delete corrections.edges[net.edges[selected].key]; save(); };
$('finishIsland').onclick = () => { if (polygon.length < 3) { status('Choose at least three corners.'); return; } const candidate = structuredClone(corrections); candidate.islands.push({ points: polygon }); try { validateCorrections(candidate); beforeEdit(); corrections = candidate; polygon = []; save(); } catch (e) { status(e.message); } };
$('export').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(corrections, null, 2)], { type: 'application/json' })), a = document.createElement('a'); a.href = url; a.download = 'corrections.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
$('import').onclick = () => $('file').click();
$('file').onchange = async () => { try { const file = $('file').files[0]; if (!file) return; const c = validateCorrections(JSON.parse(await file.text())); buildNet(data, c); beforeEdit(); corrections = c; save(); } catch (e) { status('Import rejected: ' + e.message); } $('file').value = ''; };
new ResizeObserver(() => { const r = canvas.getBoundingClientRect(); size = { w: r.width, h: r.height }; canvas.width = r.width * devicePixelRatio; canvas.height = r.height * devicePixelRatio; dirty = true; }).observe(canvas);
try {
  const responses = await Promise.all([fetch('data/cambridge.json'), fetch('data/corrections.json')]);
  if (responses.some(r => !r.ok)) throw Error('Map or corrections could not be loaded.');
  [data, corrections] = await Promise.all(responses.map(r => r.json()));
  const draft = localStorage.getItem(DRAFT_KEY); if (draft) corrections = JSON.parse(draft);
  validateCorrections(corrections); original = buildNet(data); net = buildNet(data, corrections);
  selected = Math.max(0, net.edges.findIndex(e => e.way.name === 'Milton Road' && e.len > 100));
  $('search').value = net.edges[selected].way.name; roadOptions(); centre(); draw(); status('Ready. Select a road or edit the highlighted section.');
} catch (e) { status('Unable to load the editor: ' + e.message); }
