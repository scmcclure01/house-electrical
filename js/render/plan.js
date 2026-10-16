// Plan view renderer: draws the current floor into the #plan SVG. World units are inches;
// pan/zoom is done with the SVG viewBox so geometry keeps real sizes (wall thickness etc.).

import { getDoc } from '../store.js';
import { view } from '../ui/viewstate.js';
import { add, sub, scale as mul, unit, normal, cross, labelPoint, polygonArea, bounds } from '../geometry.js';
import { formatLength } from '../units.js';
import { R, symbolMarkup, deviceCenter, deviceTags, facing } from './symbols.js';
import { LOW_VOLTAGE, deviceCode, groupOf } from '../model.js';

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
    for (const d of doc.devices) pts.push(d);
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

function areaMarkup(a, ghost, devices = []) {
  let out = `<polygon points="${ptsAttr(a.points)}" class="area area-${a.kind}" ${ghost ? '' : `data-id="${a.id}"`}/>`;
  if (ghost) return out;
  if (a.kind === 'stair') return out + stairMarkup(a);
  const lp = labelPoint(a.points);
  // A ceiling light at the room centre would cover the name: lift the label above it.
  const symR = R * symScale();
  if (devices.some(d => !d.wallId && Math.abs(d.x - lp.x) < symR * 3 && Math.abs(d.y - lp.y) < symR * 2.5)) lp.y -= symR * 3.2;
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

// Symbols are real-size (R inches) but never smaller than ~15px across on screen.
export const symScale = () => Math.max(1, px(7.5) / R);
// Text tags only once zoomed in enough to read them without overlap (selected devices always show theirs).
const TAGS_MIN_SCALE = 1.6; // screen px per inch

// Circuit display state for the current render: breaker colors and which circuit (if any) is in focus.
let breakerColor = new Map();
let focusId = null;
let docRef = null;

// Text next to a symbol, per the Labels setting: device code, details (flags/label/port), both, or none.
function tagText(d) {
  const code = d.num && docRef ? deviceCode(docRef, d) : '';
  const details = deviceTags(d);
  const parts = { numbers: [code], details, both: [code, ...details], none: [] }[view.tagMode] ?? [code];
  return parts.filter(Boolean).join(' · ');
}

// How a device is emphasised under the current display mode: 'dim', 'halo', 'alert' (unassigned) or ''.
function emphasis(d) {
  const lowV = LOW_VOLTAGE.has(d.type);
  if (view.display === 'unassigned') return lowV || d.breakerId ? 'dim' : 'alert';
  if (!focusId) return '';
  if (d.breakerId === focusId) return 'halo';
  // While assigning, unassigned devices stay fully visible (they're the ones left to do).
  return view.tool === 'assign' && !d.breakerId && !lowV ? '' : 'dim';
}

// extraCls: e.g. 'preview' for a tool's ghost symbol (no data-id, so it isn't clickable).
export function deviceMarkup(d, extraCls = '') {
  const s = symScale();
  const c = deviceCenter(d, s);
  const idAttr = extraCls ? '' : `data-id="${d.id}"`;
  const lowV = LOW_VOLTAGE.has(d.type);
  const color = d.breakerId && breakerColor.get(d.breakerId);
  const em = extraCls ? '' : emphasis(d);
  const cls = ['device', `device-${d.type}`, extraCls, color ? 'assigned' : '', lowV ? 'lowvolt' : d.verified ? 'verified' : 'unverified', em === 'dim' ? 'dim' : '']
    .filter(Boolean).join(' ');
  const halo = em === 'halo' || em === 'alert' ? `<circle r="${R * 2}" class="halo${em === 'alert' ? ' halo-alert' : ''}"/>` : '';
  let out = `<g ${idAttr} class="${cls}"${color ? ` style="--c:${color}"` : ''} transform="translate(${f(c.x)} ${f(c.y)}) scale(${f(s)})">` +
    `${halo}${symbolMarkup(d)}<circle r="${R * 1.5}" class="dev-hit"/></g>`;
  const tag = extraCls ? deviceTags(d).join(' · ') : tagText(d);
  if (tag && (camera.scale >= TAGS_MIN_SCALE || extraCls || view.selection.includes(d.id))) {
    const fs = px(10);
    const u = d.wallId ? facing(d) : { x: 0, y: 1 };
    const dist = R * s * (d.wallId ? 1.6 : 1.4) + fs * 0.9;
    const p = add(c, mul(u, dist));
    out += `<text x="${f(p.x)}" y="${f(p.y + fs * 0.35)}" font-size="${f(fs)}" class="device-tag ${extraCls}">${esc(tag)}</text>`;
  }
  return out;
}

// Switch links: dashed lines from each switch to the loads it controls (and between a 3-way pair),
// for the switch the Link tool is working on, or for selected switches / selected loads.
function linkMarkup(doc, fl) {
  const groups = new Set();
  const focusIds = view.tool === 'link' ? (view.linkSwitchId ? [view.linkSwitchId] : []) : view.selection;
  for (const fid of focusIds) {
    const g = groupOf(doc, fid);
    if (g) groups.add(g);
    else if (view.tool !== 'link') for (const x of doc.switchGroups) if (x.loadIds.includes(fid)) groups.add(x);
  }
  if (!groups.size && !(view.tool === 'link' && view.linkSwitchId)) return '';
  const byId = new Map(doc.devices.map(d => [d.id, d]));
  const s = symScale();
  const center = d => deviceCenter(d, s);
  let out = '';
  for (const g of groups) {
    const sws = g.switchIds.map(i => byId.get(i)).filter(Boolean);
    const loads = g.loadIds.map(i => byId.get(i)).filter(Boolean);
    const here = sws.filter(d => d.floorId === fl), loadsHere = loads.filter(d => d.floorId === fl);
    for (const sw of here) for (const l of loadsHere) out += line(center(sw), center(l), 'link-line');
    if (here.length === 2) out += line(center(here[0]), center(here[1]), 'link-pair');
    for (const l of loadsHere) out += `<circle cx="${f(center(l).x)}" cy="${f(center(l).y)}" r="${f(R * s * 1.9)}" class="link-load"/>`;
    // Anything linked on another floor gets a note beside the first item drawn here.
    const away = [...sws, ...loads].filter(d => d.floorId !== fl);
    const anchor = here[0] ?? loadsHere[0];
    if (away.length && anchor) {
      const floors = [...new Set(away.map(d => doc.floors.find(x => x.id === d.floorId)?.name ?? '?'))].join(', ');
      const c = center(anchor);
      out += `<text x="${f(c.x + R * s * 2)}" y="${f(c.y - R * s * 2)}" font-size="${f(px(11))}" class="link-away">+${away.length} on ${esc(floors)}</text>`;
    }
  }
  if (view.tool === 'link' && view.linkSwitchId) {
    const sw = byId.get(view.linkSwitchId);
    if (sw?.floorId === fl) out += `<circle cx="${f(center(sw).x)}" cy="${f(center(sw).y)}" r="${f(R * s * 2.1)}" class="link-active"/>`;
  }
  return out;
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
  const s = symScale();
  for (const d of doc.devices) {
    if (d.floorId !== floorId || !sel.has(d.id)) continue;
    const c = deviceCenter(d, s);
    out += `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(R * s * 1.7)}" class="sel-device"/>`;
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
  const floorDevices = doc.devices.filter(d => d.floorId === fl);
  breakerColor = new Map(doc.breakers.map(b => [b.id, b.color]));
  docRef = doc;
  focusId = view.tool === 'assign' ? view.assignBreakerId : view.focusBreakerId;
  out += '<g class="layer-areas">';
  // Larger areas first so small rooms drawn inside them stay clickable.
  for (const a of doc.areas.filter(a => a.floorId === fl).sort((p, q) => Math.abs(polygonArea(q.points)) - Math.abs(polygonArea(p.points)))) out += areaMarkup(a, false, floorDevices);
  out += '</g><g class="layer-walls">';
  for (const w of doc.walls) if (w.floorId === fl) out += wallMarkup(w, false);
  out += '</g><g class="layer-openings">';
  for (const o of doc.openings) {
    const w = wallsById.get(o.wallId);
    if (w && w.floorId === fl) out += openingMarkup(o, w);
  }
  out += '</g><g class="layer-devices">';
  for (const d of floorDevices) out += deviceMarkup(d);
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
  out += `<g class="layer-links">${linkMarkup(doc, fl)}</g>`;
  out += `<g class="layer-selection">${selectionMarkup(doc, fl)}</g>`;
  out += `<g class="layer-overlay">${overlayFn ? overlayFn({ px, f, line, ptsAttr }) : ''}</g>`;
  svg.innerHTML = out;
}

new ResizeObserver(() => render()).observe(svg);
