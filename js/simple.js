// A plain-language road editor. Same map, same corrections file and same local
// draft as editor.html, so the two are interchangeable -- this one just asks
// fewer questions. Tap a road, press + or -, drive it.
import { buildNet, nearest, laneInfo } from './net.js';
import { ribbonQuads } from './road-geometry.js';
import { DRAFT_KEY, validateCorrections } from './corrections.js';

const $ = id => document.getElementById(id);
const canvas = $('map'), ctx = canvas.getContext('2d');

let data, net, corrections, chosen = null;
let view = { x: 0, z: 0, scale: 2.2 }, size = { w: 0, h: 0 };
const history = [];

const screen = (x, z) => ({ x: (x - view.x) * view.scale + size.w / 2, y: (z - view.z) * view.scale + size.h / 2 });
const world = (px, py) => ({ x: (px - size.w / 2) / view.scale + view.x, z: (py - size.h / 2) / view.scale + view.z });

function toast(text, bad) {
  const t = $('toast'); t.textContent = text; t.classList.toggle('bad', !!bad); t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- drawing ----------
function fit() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  size = { w: canvas.clientWidth, h: canvas.clientHeight };
  canvas.width = Math.round(size.w * dpr); canvas.height = Math.round(size.h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function shape(points, fill) {
  ctx.beginPath();
  points.forEach((p, i) => { const s = screen(p.x, p.z); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
function visible(e) {
  const mx = size.w / view.scale / 2 + 60, mz = size.h / view.scale / 2 + 60;
  for (let i = 0; i < e.n; i++) if (Math.abs(e.px[i] - view.x) < mx && Math.abs(e.pz[i] - view.z) < mz) return true;
  return false;
}
function draw() {
  requestAnimationFrame(draw);
  if (!net) return;
  ctx.setTransform(Math.min(2, devicePixelRatio || 1), 0, 0, Math.min(2, devicePixelRatio || 1), 0, 0);
  ctx.fillStyle = '#16303d'; ctx.fillRect(0, 0, size.w, size.h);
  const edges = net.edges.filter(visible);
  for (const e of edges) for (const q of ribbonQuads(e, -e.way.w / 2 - 2.2, e.way.w / 2 + 2.2)) shape(q, '#20404f');
  for (const e of edges) {
    const picked = chosen && e === chosen;
    for (const q of ribbonQuads(e, -e.way.w / 2, e.way.w / 2)) shape(q, picked ? '#2bbfa6' : '#36606f');
  }
  if (view.scale > 1.1) labels(edges);
  if (chosen && visible(chosen)) {           // a dashed centre line so lanes read
    const L = laneInfo(chosen, 1);
    if (!chosen.way.oneway) for (const q of ribbonQuads(chosen, -0.14, 0.14)) shape(q, '#dff6f1');
    for (let i = 1; i < L.n; i++) for (const q of ribbonQuads(chosen, L.outer - L.laneW * i - .1, L.outer - L.laneW * i + .1)) shape(q, '#bfe8df');
  }
}

// Road names, drawn once per road along the middle of the longest piece on screen.
function labels(edges) {
  const done = new Set();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 13px system-ui, sans-serif';
  for (const e of edges.slice().sort((a, b) => b.len - a.len)) {
    const name = e.way.name;
    if (!name || done.has(name) || e.len < 26) continue;
    done.add(name);
    const i = Math.floor(e.n / 2) || 0, j = Math.min(e.n - 1, i + 1);
    const a = screen(e.px[i], e.pz[i]), b = screen(e.px[j], e.pz[j]);
    if (a.x < -60 || a.x > size.w + 60 || a.y < -30 || a.y > size.h + 30) continue;
    let angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;   // never upside down
    ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(angle);
    ctx.lineWidth = 3.5; ctx.strokeStyle = '#0d222c'; ctx.strokeText(name, 0, 0);
    ctx.fillStyle = e === chosen ? '#eafff9' : '#b9d4dd'; ctx.fillText(name, 0, 0);
    ctx.restore();
  }
}

// ---------- edits ----------
function keyOf(edge) { return edge.key; }
function entry() {
  const k = keyOf(chosen);
  return corrections.edges[k] || (corrections.edges[k] = {});
}
function change(fn, said) {
  const before = structuredClone(corrections);
  try {
    fn();
    validateCorrections(corrections);
    const rebuilt = buildNet(data, corrections);
    history.push(before); if (history.length > 40) history.shift();
    const id = chosen?.id;
    net = rebuilt; chosen = id == null ? null : net.edges[id];
    save(); refresh(); $('undo').disabled = false;
    if (said) toast(said);
  } catch (e) {
    corrections = before; net = buildNet(data, corrections);
    chosen = chosen == null ? null : net.edges[chosen.id];
    refresh(); toast(e.message.replace(/\.$/, ''), true);
  }
}
function save() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(corrections)); } catch (_) {} }

const WIDTH_STEP = 0.5, MIN_W = 3, MAX_W = 24;
function setWidth(delta) {
  change(() => {
    const now = chosen.way.w;
    const next = Math.round((now + delta) * 2) / 2;
    if (next < MIN_W || next > MAX_W) throw Error(`Keep the width between ${MIN_W} and ${MAX_W} metres`);
    entry().width = next;
  }, delta > 0 ? 'Wider' : 'Narrower');
}
function setLanes(side, delta) {
  change(() => {
    const f = laneInfo(chosen, 1).n, b = chosen.way.oneway ? 0 : laneInfo(chosen, -1).n;
    const e = entry();
    e.lanesForward = side === 'f' ? f + delta : f;
    e.lanesBackward = side === 'b' ? b + delta : b;
    if (e.lanesForward < 1) throw Error('A road needs at least one lane each way');
    if (!chosen.way.oneway && e.lanesBackward < 1) throw Error('A road needs at least one lane each way');
    if (e.lanesForward + e.lanesBackward > 8) throw Error('Eight lanes is the most');
    // Keep the road wide enough for the lanes it now has.
    const need = (e.lanesForward + e.lanesBackward) * 3.1;
    if (chosen.way.w < need) e.width = Math.min(MAX_W, Math.round(need * 2) / 2);
  }, delta > 0 ? 'One more lane' : 'One fewer lane');
}

// Round a sharp corner: guard points keep the curve at the corner instead of
// bending the whole road. Mirrors tools/smooth-corners.mjs.
const turnAt = (p, q, r) => {
  const ax = q[0] - p[0], az = q[1] - p[1], bx = r[0] - q[0], bz = r[1] - q[1];
  return Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
};
const SHARP = 25 * Math.PI / 180, RADIUS = 6;
function cornerPoints(e) {
  const pts = Array.from({ length: e.n }, (_, i) => [e.px[i], e.pz[i]]);
  const out = [pts[0]];
  let found = false;
  for (let k = 1; k < pts.length - 1; k++) {
    const p = pts[k - 1], q = pts[k], r = pts[k + 1];
    if (turnAt(p, q, r) < SHARP) { out.push(q); continue; }
    found = true;
    const put = (from, to) => {
      const dx = to[0] - from[0], dz = to[1] - from[1], L = Math.hypot(dx, dz) || 1e-9;
      const t = Math.min(RADIUS, L / 2.5) / L;
      return [from[0] + dx * t, from[1] + dz * t];
    };
    const a = put(q, p), b = put(q, r);
    if (Math.hypot(a[0] - out.at(-1)[0], a[1] - out.at(-1)[1]) >= .15) out.push(a);
    out.push(q);
    if (Math.hypot(b[0] - q[0], b[1] - q[1]) >= .15) out.push(b);
  }
  out.push(pts.at(-1));
  return found ? out : null;
}

// ---------- the card ----------
function refresh() {
  const card = $('card');
  if (!chosen) { card.classList.remove('up'); $('hint').style.opacity = 1; return; }
  card.classList.add('up'); $('hint').style.opacity = 0;
  const w = chosen.way, f = laneInfo(chosen, 1).n, b = w.oneway ? 0 : laneInfo(chosen, -1).n;
  $('name').textContent = w.name || 'Unnamed road';
  $('sub').textContent = `${Math.round(chosen.len)} metres long · ${w.oneway ? 'one way' : 'two way'}`;
  $('wVal').textContent = `${w.w} m`;
  $('fVal').textContent = f; $('bVal').textContent = b;
  $('backRow').style.display = w.oneway ? 'none' : 'flex';
  $('wNarrow').disabled = w.w <= MIN_W; $('wWide').disabled = w.w >= MAX_W;
  $('fDown').disabled = f <= 1; $('bDown').disabled = b <= 1;
  $('fUp').disabled = $('bUp').disabled = f + b >= 8;
  $('round').style.display = cornerPoints(chosen) ? '' : 'none';
  $('reset').style.display = corrections.edges[keyOf(chosen)] ? '' : 'none';
}

// ---------- input ----------
let drag = null, moved = 0;
canvas.addEventListener('pointerdown', ev => {
  canvas.setPointerCapture(ev.pointerId);
  drag = { x: ev.clientX, y: ev.clientY }; moved = 0;
  canvas.classList.add('grabbing');
});
canvas.addEventListener('pointermove', ev => {
  if (!drag) return;
  const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  moved += Math.abs(dx) + Math.abs(dy);
  view.x -= dx / view.scale; view.z -= dy / view.scale;
  drag = { x: ev.clientX, y: ev.clientY };
});
canvas.addEventListener('pointerup', ev => {
  canvas.classList.remove('grabbing');
  const wasDrag = moved > 6; drag = null;
  if (wasDrag) return;
  const r = canvas.getBoundingClientRect(), p = world(ev.clientX - r.left, ev.clientY - r.top);
  const hit = nearest(net, p.x, p.z);
  if (hit && hit.d < hit.way.w / 2 + 14 / view.scale) { chosen = hit.e; refresh(); clearOfCard(); }
  else { chosen = null; refresh(); }
});
// The card covers the lower half on a phone. If the road we just picked sits
// behind it, slide the map up so you can still see what you are changing.
function clearOfCard() {
  const card = document.getElementById('card').getBoundingClientRect();
  const mid = screen(chosen.px[Math.floor(chosen.n / 2)], chosen.pz[Math.floor(chosen.n / 2)]);
  const overlap = mid.y - (card.top - 24);
  if (overlap > 0) view.z += overlap / view.scale;
}

canvas.addEventListener('wheel', ev => {
  ev.preventDefault();
  const r = canvas.getBoundingClientRect(), before = world(ev.clientX - r.left, ev.clientY - r.top);
  view.scale = Math.max(.35, Math.min(14, view.scale * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
  const after = world(ev.clientX - r.left, ev.clientY - r.top);
  view.x += before.x - after.x; view.z += before.z - after.z;
}, { passive: false });

const zoomBy = k => { view.scale = Math.max(.35, Math.min(14, view.scale * k)); };
$('zin').onclick = () => zoomBy(1.4);
$('zout').onclick = () => zoomBy(1 / 1.4);
$('close').onclick = () => { chosen = null; refresh(); };

$('wNarrow').onclick = () => setWidth(-WIDTH_STEP);
$('wWide').onclick = () => setWidth(WIDTH_STEP);
$('fDown').onclick = () => setLanes('f', -1);
$('fUp').onclick = () => setLanes('f', 1);
$('bDown').onclick = () => setLanes('b', -1);
$('bUp').onclick = () => setLanes('b', 1);
$('round').onclick = () => {
  const pts = cornerPoints(chosen);
  if (!pts) return;
  change(() => { const e = entry(); e.points = pts; e.smooth = true; }, 'Corners rounded');
};
$('reset').onclick = () => change(() => { delete corrections.edges[keyOf(chosen)]; }, 'Back to how it was');
$('undo').onclick = () => {
  const previous = history.pop();
  if (!previous) return;
  corrections = previous; net = buildNet(data, corrections);
  chosen = chosen == null ? null : net.edges[chosen.id];
  save(); refresh(); $('undo').disabled = !history.length; toast('Undone');
};
$('drive').onclick = () => { save(); window.open('index.html', '_blank', 'noopener'); };
$('save').onclick = () => {
  const blob = new Blob([JSON.stringify(corrections, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'my-roads.json';
  a.click(); URL.revokeObjectURL(a.href);
  toast('Saved to your downloads');
};
addEventListener('resize', fit);

// ---------- start ----------
(async () => {
  try {
    const [m, c] = await Promise.all([fetch('data/cambridge.json'), fetch('data/corrections.json')]);
    if (!m.ok || !c.ok) throw Error('The map could not load.');
    data = await m.json(); corrections = await c.json();
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) try { corrections = validateCorrections(JSON.parse(draft)); } catch (_) { toast('Saved changes looked wrong, starting fresh', true); }
    corrections.edges ||= {}; corrections.lamps ||= []; corrections.islands ||= [];
    net = buildNet(data, corrections);
    const start = net.edges.find(e => e.way.name === 'Milton Road' && e.len > 100) || net.edges[0];
    view.x = start.px[0]; view.z = start.pz[0];
    fit(); requestAnimationFrame(draw);
  } catch (e) { $('hint').textContent = e.message; }
})();
