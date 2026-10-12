// Plan view renderer: draws the current floor into the #plan SVG. World units are inches;
// pan/zoom is done with the SVG viewBox so geometry keeps real sizes (wall thickness etc.).

import { getDoc } from '../store.js';
import { view } from '../ui/viewstate.js';
import { add, sub, scale as mul, unit, normal, cross, labelPoint, polygonArea, bounds } from '../geometry.js';
import { formatLength } from '../units.js';

export const svg = document.getElementById('plan');

// Camera: world point at the centre of the canvas, and pixels per inch.
const camera = { cx: 240, cy: 180, scale: 1.5 };
const MIN_SCALE = 0.15, MAX_SCALE = 20;

let overlayFn = null;      // tool-supplied function returning overlay SVG markup

export function setOverlay(fn) { overlayFn = fn; }
export function pxToWorld(px) { return px / camera.scale; }
export function getScale() { return camera.scale; }

export function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------- camera ----------
function viewRect() {
  const w = svg.clientWidth || 800, h = svg.clientHeight || 600;
  const ww = w / camera.scale, wh = h / camera.scale;
  return { x: camera.cx - ww / 2, y: camera.cy - wh / 2, w: ww, h: wh };
}

export function worldFromEvent(e) {
  const r = svg.getBoundingClientRect();
  const v = viewRect();
  return { x: v.x + (e.clientX - r.left) / camera.scale, y: v.y + (e.clientY - r.top) / camera.scale };
}

export function panBy(dxPx, dyPx) {
  camera.cx -= dxPx / camera.scale;
  camera.cy -= dyPx / camera.scale;
  render();
}

export function zoomAt(e, factor) {
  const before = worldFromEvent(e);
  camera.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));
  const after = worldFromEvent(e);
  camera.cx += before.x - after.x;
  camera.cy += before.y - after.y;
  render();
}

export function zoomBy(factor) {
  camera.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));
  render();
}

// Fit all floors (so both floors share the same framing when switching tabs).
export function fit() {
  const doc = getDoc();
  const pts = [];
  if (doc) {
    for (const w of doc.walls) pts.push(w.a, w.b);
    for (const a of doc.areas) pts.push(...a.points);
  }
  const b = pts.length ? bounds(pts) : { minX: -24, minY: -24, maxX: 480, maxY: 360 };
  const pad = 48;
  const w = svg.clientWidth || 800, h = svg.clientHeight || 600;
  camera.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE,
    Math.min(w / (b.maxX - b.minX + pad * 2), h / (b.maxY - b.minY + pad * 2))));
  camera.cx = (b.minX + b.maxX) / 2;
  camera.cy = (b.minY + b.maxY) / 2;
  render();
}

// ---------- geometry used by renderer and tools ----------
export function openingGeom(wall, o) {
  const u = unit(sub(wall.b, wall.a));
  const n = normal(u);
  const p0 = add(wall.a, mul(u, o.offsetIn));
  const p1 = add(wall.a, mul(u, o.offsetIn + o.widthIn));
  return { u, n, p0, p1, t: wall.thicknessIn };
}

// ---------- drawing ----------
const px = n => n / camera.scale; // screen pixels → world inches (for constant-size marks)
const f = n => Math.round(n * 100) / 100;
const line = (a, b, cls, extra = '') => `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" class="${cls}" ${extra}/>`;
const ptsAttr = pts => pts.map(p => `${f(p.x)},${f(p.y)}`).join(' ');

function gridMarkup(v, gridIn) {
  const levels = [
    { step: gridIn, cls: 'grid-minor' },
    { step: 12, cls: 'grid-foot' },
    { step: 60, cls: 'grid-major' },
  ];
  let out = '';
  for (const { step, cls } of levels) {
    if (step * camera.scale < 7) continue; // too dense to be useful
    let d = '';
    for (let x = Math.ceil(v.x / step) * step; x <= v.x + v.w; x += step) d += `M${f(x)} ${f(v.y)}V${f(v.y + v.h)}`;
    for (let y = Math.ceil(v.y / step) * step; y <= v.y + v.h; y += step) d += `M${f(v.x)} ${f(y)}H${f(v.x + v.w)}`;
    out += `<path d="${d}" class="${cls}"/>`;
  }
  out += line({ x: v.x, y: 0 }, { x: v.x + v.w, y: 0 }, 'grid-axis') + line({ x: 0, y: v.y }, { x: 0, y: v.y + v.h }, 'grid-axis');
  return out;
}

function areaMarkup(a, ghost) {
  let out = `<polygon points="${ptsAttr(a.points)}" class="area area-${a.kind}" ${ghost ? '' : `data-id="${a.id}"`}/>`;
  if (ghost) return out;
  if (a.kind === 'stair') return out + stairMarkup(a);
  const lp = labelPoint(a.points);
  const b = bounds(a.points);
  // Shrink the label for narrow rooms so it stays inside (down to 7px on screen).
  const fs = Math.max(px(7), Math.min(px(12), ((b.maxX - b.minX) * 0.9) / (Math.max(a.name.length, 4) * 0.62)));
  const sqft = Math.abs(polygonArea(a.points)) / 144;
  const sub2 = a.kind === 'exterior' ? '' : `<tspan x="${f(lp.x)}" dy="${f(fs * 1.2)}" class="area-sqft">${Math.round(sqft)} sq ft</tspan>`;
  return out + `<text x="${f(lp.x)}" y="${f(lp.y)}" font-size="${f(fs)}" class="area-label">${esc(a.name)}${sub2}</text>`;
}

// Stair: arrow along the long side pointing toward the top of the run, with UP/DN at its tail.
function stairMarkup(a) {
  const b = bounds(a.points);
  const fs = px(11);
  const horiz = b.maxX - b.minX > b.maxY - b.minY;
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const inset = horiz ? (b.maxX - b.minX) * 0.12 : (b.maxY - b.minY) * 0.12;
  const tail = fs * 1.8; // room for the UP/DN text
  const p0 = horiz ? { x: b.minX + inset + tail, y: cy } : { x: cx, y: b.maxY - inset - tail };
  const p1 = horiz ? { x: b.maxX - inset, y: cy } : { x: cx, y: b.minY + inset };
  const u = unit(sub(p1, p0)), n = normal(u), h = px(8);
  const head = [p1, add(sub(p1, mul(u, h)), mul(n, h * 0.6)), sub(sub(p1, mul(u, h)), mul(n, h * 0.6))];
  const label = a.stairDir === 'down' ? 'DN' : 'UP';
  const lp = horiz ? { x: b.minX + inset + tail / 2, y: cy + fs * 0.35 } : { x: cx, y: b.maxY - inset - fs * 0.3 };
  return line(p0, p1, 'stair-arrow') + `<polygon points="${ptsAttr(head)}" class="stair-head"/>` +
    `<text x="${f(lp.x)}" y="${f(lp.y)}" font-size="${f(fs)}" class="area-label stair-label">${label}</text>`;
}

function wallMarkup(w, ghost) {
  const cls = `wall wall-${w.kind}`;
  return line(w.a, w.b, cls, `stroke-width="${w.thicknessIn}" ${ghost ? '' : `data-id="${w.id}"`}`);
}

function openingMarkup(o, wall) {
  const g = openingGeom(wall, o);
  const half = mul(g.n, g.t / 2 + 0.5);
  let out = `<g data-id="${o.id}" class="opening opening-${o.kind}">`;
  out += line(g.p0, g.p1, 'opening-gap', `stroke-width="${g.t + 1.5}"`);
  out += line(sub(g.p0, half), add(g.p0, half), 'opening-jamb') + line(sub(g.p1, half), add(g.p1, half), 'opening-jamb');
  if (o.kind === 'window') {
    const q = mul(g.n, g.t / 2);
    out += line(add(g.p0, q), add(g.p1, q), 'window-line') + line(sub(g.p0, q), sub(g.p1, q), 'window-line') + line(g.p0, g.p1, 'window-line');
  } else if (o.kind === 'door') {
    const hinge = o.hinge === 'b' ? g.p1 : g.p0;
    const other = o.hinge === 'b' ? g.p0 : g.p1;
    const side = o.swing === 'right' ? mul(g.n, -1) : g.n;
    const leafEnd = add(hinge, mul(side, o.widthIn));
    const sweep = cross(sub(leafEnd, hinge), sub(other, hinge)) > 0 ? 1 : 0;
    out += line(hinge, leafEnd, 'door-leaf');
    out += `<path d="M${f(leafEnd.x)} ${f(leafEnd.y)} A${o.widthIn} ${o.widthIn} 0 0 ${sweep} ${f(other.x)} ${f(other.y)}" class="door-arc"/>`;
  }
  // Fat invisible hit target so thin symbols are easy to click.
  out += line(g.p0, g.p1, 'hit', `stroke-width="${Math.max(g.t + 4, px(10))}"`);
  return out + '</g>';
}

function dimMarkup(w) {
  const u = unit(sub(w.b, w.a));
  let n = normal(u);
  const mid = mul(add(w.a, w.b), 0.5);
  let ang = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  if (ang > 90 || ang <= -90) { ang += 180; n = mul(n, -1); }
  const p = add(mid, mul(n, -(w.thicknessIn / 2 + px(5))));
  const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  return `<text x="${f(p.x)}" y="${f(p.y)}" font-size="${f(px(11))}" class="dim" transform="rotate(${f(ang)} ${f(p.x)} ${f(p.y)})">${formatLength(L)}</text>`;
}

function selectionMarkup(doc, floorId) {
  const sel = new Set(view.selection);
  const r = px(5);
  let out = '';
  for (const w of doc.walls) {
    if (w.floorId !== floorId || !sel.has(w.id)) continue;
    out += line(w.a, w.b, 'sel-line');
    out += `<circle cx="${w.a.x}" cy="${w.a.y}" r="${f(r)}" class="handle" data-handle="${w.id}|a"/>`;
    out += `<circle cx="${w.b.x}" cy="${w.b.y}" r="${f(r)}" class="handle" data-handle="${w.id}|b"/>`;
    out += `<text x="${f(w.a.x + px(7))}" y="${f(w.a.y - px(7))}" font-size="${f(px(11))}" class="end-label">A</text>`;
    if (!view.showDims) out += dimMarkup(w);
  }
  for (const a of doc.areas) {
    if (a.floorId !== floorId || !sel.has(a.id)) continue;
    out += `<polygon points="${ptsAttr(a.points)}" class="sel-area"/>`;
    a.points.forEach((p, i) => { out += `<rect x="${f(p.x - r)}" y="${f(p.y - r)}" width="${f(r * 2)}" height="${f(r * 2)}" class="handle" data-handle="${a.id}|${i}"/>`; });
  }
  for (const o of doc.openings) {
    if (!sel.has(o.id)) continue;
    const wall = doc.walls.find(w => w.id === o.wallId);
    if (!wall || wall.floorId !== floorId) continue;
    const g = openingGeom(wall, o);
    out += line(g.p0, g.p1, 'sel-line sel-opening');
    out += `<text x="${f(wall.a.x + px(7))}" y="${f(wall.a.y - px(7))}" font-size="${f(px(11))}" class="end-label">A</text>`;
  }
  return out;
}

export function render() {
  const doc = getDoc();
  const v = viewRect();
  svg.setAttribute('viewBox', `${f(v.x)} ${f(v.y)} ${f(v.w)} ${f(v.h)}`);
  if (!doc || view.mode !== 'plan') { svg.innerHTML = ''; return; }
  const fl = view.floorId;
  const wallsById = new Map(doc.walls.map(w => [w.id, w]));
  let out = `<defs>
    <pattern id="stair-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" class="hatch-line"/></pattern>
    <pattern id="attic-hatch" patternUnits="userSpaceOnUse" width="16" height="16" patternTransform="rotate(-45)">
      <line x1="0" y1="0" x2="0" y2="16" class="attic-line"/></pattern>
  </defs>`;
  out += `<g class="layer-grid">${gridMarkup(v, doc.settings.gridIn)}</g>`;
  out += '<g class="layer-areas">';
  // Larger areas first so small rooms drawn inside them stay clickable.
  for (const a of doc.areas.filter(a => a.floorId === fl).sort((p, q) => Math.abs(polygonArea(q.points)) - Math.abs(polygonArea(p.points)))) out += areaMarkup(a, false);
  out += '</g><g class="layer-walls">';
  for (const w of doc.walls) if (w.floorId === fl) out += wallMarkup(w, false);
  out += '</g><g class="layer-openings">';
  for (const o of doc.openings) {
    const w = wallsById.get(o.wallId);
    if (w && w.floorId === fl) out += openingMarkup(o, w);
  }
  out += '</g>';
  // Ghost of the other floor(s) goes ON TOP as faint outlines; underneath, room fills would hide it.
  if (view.ghost) {
    out += '<g class="layer-ghost">';
    for (const a of doc.areas) if (a.floorId !== fl) out += areaMarkup(a, true);
    for (const w of doc.walls) if (w.floorId !== fl) out += wallMarkup(w, true);
    out += '</g>';
  }
  if (view.showDims) {
    out += '<g class="layer-dims">';
    for (const w of doc.walls) if (w.floorId === fl) out += dimMarkup(w);
    out += '</g>';
  }
  out += `<g class="layer-selection">${selectionMarkup(doc, fl)}</g>`;
  out += `<g class="layer-overlay">${overlayFn ? overlayFn({ px, f, line, ptsAttr }) : ''}</g>`;
  svg.innerHTML = out;
}

new ResizeObserver(() => render()).observe(svg);
