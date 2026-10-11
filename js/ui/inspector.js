// Right-hand properties panel: house properties when nothing is selected, otherwise a form
// for the selected wall, opening or area (or a summary for a multi-selection).

import { getDoc, commit, isReadOnly } from '../store.js';
import { view, setView } from './viewstate.js';
import { findById, deleteIds, wallLength, WALL_KINDS, AREA_KINDS, OPENING_KINDS } from '../model.js';
import { add, sub, scale, unit, same, polygonArea } from '../geometry.js';
import { parseLength, formatLength } from '../units.js';
import { status } from './status.js';

const el = document.getElementById('inspector');

// Enter in a single-line field commits it and hands the keyboard back to the plan (so tool shortcuts work).
el.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();
});

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const cap = s => s[0].toUpperCase() + s.slice(1);
const options = (list, value) => list.map(v => `<option value="${v}"${v === value ? ' selected' : ''}>${cap(v)}</option>`).join('');

// Set while the inspector itself is committing a text edit, so it doesn't rebuild its own inputs
// mid-edit (rebuilding would drop focus when the user tabs between fields).
let selfCommit = false;

// Bind an input so edits commit once, on change (not per keystroke).
// rerender: rebuild the panel afterwards (for fields that change what else is shown).
function bind(selector, label, apply, { rerender = false } = {}) {
  const input = el.querySelector(selector);
  if (!input) return;
  input.disabled = isReadOnly();
  input.addEventListener('change', () => {
    selfCommit = !rerender;
    try { commit(label, doc => apply(doc, input.value, input)); } finally { selfCommit = false; }
  });
}

// Like bind(), but parses a feet-inches length; rejects bad input and restores the old value.
function bindLength(selector, label, current, apply) {
  bind(selector, label, (doc, v, input) => {
    const n = parseLength(v);
    if (n === null || n <= 0) { status(`Couldn't read "${v}" as a length. Try 12'6, 12 6, or 150.`, true); input.value = formatLength(current); return; }
    apply(doc, n);
  });
}

function button(selector, fn) {
  const b = el.querySelector(selector);
  if (!b) return;
  b.disabled = isReadOnly();
  b.addEventListener('click', fn);
}

const deleteBtn = '<button id="ins-delete" class="danger">Delete</button>';
function bindDelete(ids) {
  button('#ins-delete', () => commit(ids.length === 1 ? 'Delete' : `Delete ${ids.length} items`, doc => deleteIds(doc, ids)));
}

// ---------- house ----------
function renderHouse(doc) {
  const counts = `${doc.walls.length} walls · ${doc.areas.length} areas · ${doc.devices.length} devices · ${doc.breakers.length} breakers`;
  el.innerHTML = `
    <h3>House</h3>
    <label>Name <input id="ins-house-name" value="${esc(doc.meta.name)}"></label>
    <label>Notes <textarea id="ins-house-notes">${esc(doc.meta.notes)}</textarea></label>
    <p class="meta">${counts}</p>
    <p class="meta">Schema v${doc.schemaVersion} · last saved ${doc.meta.modified ? new Date(doc.meta.modified).toLocaleString() : '—'}</p>
    <p class="meta tip">Tip: select something on the plan to edit it here.</p>`;
  bind('#ins-house-name', 'Rename house', (d, v) => { d.meta.name = v.trim(); });
  bind('#ins-house-notes', 'Edit house notes', (d, v) => { d.meta.notes = v; });
}

// ---------- wall ----------
function renderWall(w) {
  const L = wallLength(w);
  el.innerHTML = `
    <h3>Wall</h3>
    <label>Type <select id="ins-kind">${options(WALL_KINDS, w.kind)}</select></label>
    <label>Length <input id="ins-length" value="${formatLength(L)}"></label>
    <label>Thickness (inches) <input id="ins-thick" type="number" min="1" max="24" value="${w.thicknessIn}"></label>
    <p class="meta">Changing the length moves the end opposite the <b>A</b> marker; walls joined there move with it.</p>
    ${deleteBtn}`;
  bind('#ins-kind', 'Change wall type', (d, v) => { const x = d.walls.find(o => o.id === w.id); x.kind = v; x.thicknessIn = d.settings.defaultWallIn[v]; }, { rerender: true });
  bindLength('#ins-length', 'Set wall length', L, (d, n) => {
    const x = d.walls.find(o => o.id === w.id);
    const oldB = { ...x.b };
    const newB = add(x.a, scale(unit(sub(x.b, x.a)), n));
    const nb = { x: Math.round(newB.x), y: Math.round(newB.y) };
    for (const o of d.walls) {
      if (o.floorId !== x.floorId) continue;
      if (same(o.a, oldB)) o.a = { ...nb };
      if (same(o.b, oldB)) o.b = { ...nb };
    }
  });
  bind('#ins-thick', 'Set wall thickness', (d, v) => { const n = Math.round(Number(v)); if (n > 0) d.walls.find(o => o.id === w.id).thicknessIn = n; });
  bindDelete([w.id]);
}

// ---------- opening ----------
function renderOpening(o, doc) {
  const wall = doc.walls.find(w => w.id === o.wallId);
  const L = wallLength(wall);
  const isDoor = o.kind === 'door';
  el.innerHTML = `
    <h3>${cap(o.kind)}</h3>
    <label>Type <select id="ins-kind">${options(OPENING_KINDS, o.kind)}</select></label>
    <label>Width <input id="ins-width" value="${formatLength(o.widthIn)}"></label>
    <label>Distance from wall end <b>A</b> <input id="ins-offset" value="${formatLength(o.offsetIn)}"></label>
    <p class="meta">Wall is ${formatLength(L)} long; ${formatLength(L - o.offsetIn - o.widthIn)} remains past this ${o.kind}.</p>
    ${isDoor ? '<div class="btn-row"><button id="ins-hinge">Flip hinge side</button><button id="ins-swing">Flip swing</button></div>' : ''}
    ${deleteBtn}`;
  const edit = fn => d => fn(d.openings.find(x => x.id === o.id));
  bind('#ins-kind', 'Change opening type', (d, v) => edit(x => { x.kind = v; })(d), { rerender: true });
  bindLength('#ins-width', 'Set opening width', o.widthIn, (d, n) => edit(x => { x.widthIn = Math.min(n, Math.floor(L)); x.offsetIn = Math.min(x.offsetIn, Math.floor(L - x.widthIn)); })(d));
  bind('#ins-offset', 'Move opening', (d, v, input) => {
    const n = parseLength(v);
    if (n === null) { status(`Couldn't read "${v}" as a length.`, true); input.value = formatLength(o.offsetIn); return; }
    edit(x => { x.offsetIn = Math.max(0, Math.min(Math.floor(L - x.widthIn), n)); })(d);
  });
  button('#ins-hinge', () => commit('Flip door hinge', edit(x => { x.hinge = x.hinge === 'b' ? 'a' : 'b'; })));
  button('#ins-swing', () => commit('Flip door swing', edit(x => { x.swing = x.swing === 'right' ? 'left' : 'right'; })));
  bindDelete([o.id]);
}

// ---------- area ----------
function renderArea(a) {
  const sqft = Math.abs(polygonArea(a.points)) / 144;
  el.innerHTML = `
    <h3>${a.kind === 'stair' ? 'Stair opening' : 'Area'}</h3>
    <label>Name <input id="ins-name" value="${esc(a.name)}"></label>
    <label>Type <select id="ins-kind">${options(AREA_KINDS, a.kind)}</select></label>
    ${a.kind === 'stair' ? `<label>Direction <select id="ins-stairdir">${options(['up', 'down'], a.stairDir ?? 'up')}</select></label>` : ''}
    <p class="meta">${Math.round(sqft)} sq ft · ${a.points.length} corners</p>
    <p class="meta">Drag the square handles to reshape.</p>
    ${deleteBtn}`;
  const edit = fn => d => fn(d.areas.find(x => x.id === a.id));
  bind('#ins-name', 'Rename area', (d, v) => edit(x => { x.name = v.trim(); })(d));
  bind('#ins-kind', 'Change area type', (d, v) => edit(x => {
    x.kind = v;
    if (v === 'stair') x.stairDir ??= 'up'; else delete x.stairDir;
  })(d), { rerender: true });
  bind('#ins-stairdir', 'Change stair direction', (d, v) => edit(x => { x.stairDir = v; })(d));
  bindDelete([a.id]);
}

// ---------- multiple ----------
function renderMulti(items) {
  const counts = {};
  for (const { kind } of items) counts[kind] = (counts[kind] ?? 0) + 1;
  const summary = Object.entries(counts).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ');
  el.innerHTML = `
    <h3>${items.length} selected</h3>
    <p class="meta">${summary}</p>
    <p class="meta">Drag to move them together, or use the arrow keys (Shift = 1").</p>
    ${deleteBtn}
    <button id="ins-clear">Clear selection</button>`;
  bindDelete(items.map(i => i.obj.id));
  el.querySelector('#ins-clear').addEventListener('click', () => setView({ selection: [] }));
}

export function renderInspector() {
  if (selfCommit) return;
  const doc = getDoc();
  if (!doc) { el.innerHTML = ''; return; }
  const items = view.selection.map(x => findById(doc, x)).filter(Boolean);
  if (items.length === 0) renderHouse(doc);
  else if (items.length > 1) renderMulti(items);
  else if (items[0].kind === 'wall') renderWall(items[0].obj);
  else if (items[0].kind === 'opening') renderOpening(items[0].obj, doc);
  else if (items[0].kind === 'area') renderArea(items[0].obj);
}
