// Right-hand properties panel: house properties when nothing is selected, otherwise a form
// for the selected wall, opening or area (or a summary for a multi-selection).

import { getDoc, commit, isReadOnly } from '../store.js';
import { view, setView } from './viewstate.js';
import { findById, deleteIds, wallLength, areaAt, normalizeDevice, WALL_KINDS, AREA_KINDS, OPENING_KINDS,
  DEVICE_TYPES, DEVICE_NAMES, LIGHT_KINDS, LOW_VOLTAGE, assignableBreakers, breakerTitle, deviceCode, nextDeviceNum,
  renumberDevices, groupOf, switchesFor, toggleLoad, unpairSwitch, cleanSwitchGroups, isSwitchable } from '../model.js';
import { setTool } from '../tools/index.js';
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
    <p class="meta tip">Tip: select something on the plan to edit it here.</p>
    <h3 class="sub-head">Device numbers</h3>
    <p class="meta">Each device gets a permanent number: type letter + floor + sequence (R103 = 3rd outlet on floor 1).
      Once it's on a breaker the full code adds the panel and slot: <b>M7-R103</b>.<br>
      R outlet · V 240V · E hardwired · S switch · L light/fan · TV cable · D data</p>
    <button id="ins-renumber">Renumber all devices…</button>`;
  bind('#ins-house-name', 'Rename house', (d, v) => { d.meta.name = v.trim(); });
  bind('#ins-house-notes', 'Edit house notes', (d, v) => { d.meta.notes = v; });
  button('#ins-renumber', () => {
    if (!confirm('Renumber every device room by room (top-to-bottom, left-to-right)? Numbers you have already written on labels will change.')) return;
    commit('Renumber devices', renumberDevices);
  });
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

// ---------- circuit picker (shared by single and multi device forms) ----------
function circuitOptions(doc, value, { mixed = false } = {}) {
  const groups = new Map();
  for (const b of assignableBreakers(doc)) {
    const panel = doc.panels.find(p => p.id === b.panelId);
    if (!groups.has(panel.name)) groups.set(panel.name, []);
    groups.get(panel.name).push(`<option value="${b.id}"${b.id === value ? ' selected' : ''}>${esc(breakerTitle(doc, b))}</option>`);
  }
  return (mixed ? '<option value="__mixed" selected>— mixed —</option>' : '') +
    `<option value=""${!value && !mixed ? ' selected' : ''}>— not assigned —</option>` +
    [...groups].map(([name, opts]) => `<optgroup label="${esc(name)} panel">${opts.join('')}</optgroup>`).join('');
}

function circuitFields(doc, d) {
  if (LOW_VOLTAGE.has(d.type)) return '<p class="meta">Low-voltage drop — not on a breaker.</p>';
  if (!doc.breakers.length) return '<p class="meta">No breakers yet. Add them in the <b>Panels</b> view, then assign devices here or with the Assign tool (B).</p>';
  const b = d.breakerId && doc.breakers.find(x => x.id === d.breakerId);
  return `
    <label>Circuit <span class="circuit-row">${b ? `<span class="b-swatch" style="--c:${b.color}"></span>` : ''}<select id="ins-breaker">${circuitOptions(doc, d.breakerId)}</select></span></label>
    <div class="check-row"><label title="Confirmed by switching the breaker off and testing"><input type="checkbox" id="ins-verified"${d.verified ? ' checked' : ''}${d.breakerId ? '' : ' disabled'}> Verified by testing</label></div>`;
}

// ---------- switch links ----------
function codeItem(doc, x, removeAttr = '') {
  const name = DEVICE_NAMES[x.type].replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());
  const floor = doc.floors.find(f => f.id === x.floorId);
  const away = floor && x.floorId !== view.floorId ? ` · ${esc(floor.name)}` : '';
  return `<li><span class="mono">${esc(deviceCode(doc, x))}</span> <span class="meta">${name}${x.label ? ` — ${esc(x.label)}` : ''}${away}</span>
    ${removeAttr ? `<button class="link-x" ${removeAttr} title="Unlink">✕</button>` : ''}</li>`;
}

function linkFields(doc, d) {
  const byId = new Map(doc.devices.map(x => [x.id, x]));
  if (d.type === 'switch') {
    const g = groupOf(doc, d.id);
    const loads = (g?.loadIds ?? []).map(i => byId.get(i)).filter(Boolean);
    const partner = g?.switchIds.filter(s => s !== d.id).map(i => byId.get(i)).filter(Boolean)[0];
    return `
      <h3 class="sub-head">Controls</h3>
      ${loads.length ? `<ul class="link-list">${loads.map(x => codeItem(doc, x, `data-unlink="${x.id}"`)).join('')}</ul>` : '<p class="meta">Nothing linked yet.</p>'}
      ${partner ? `<p class="meta">3-way with <span class="mono">${esc(deviceCode(doc, partner))}</span>${partner.label ? ` (${esc(partner.label)})` : ''} <button id="ins-unpair" class="link-btn">Unpair</button></p>` : ''}
      <button id="ins-link">Link lights &amp; outlets…</button>`;
  }
  if (!isSwitchable(d)) return '';
  const sws = switchesFor(doc, d.id).map(i => byId.get(i)).filter(Boolean);
  return `
    <h3 class="sub-head">Controlled by</h3>
    ${sws.length ? `<ul class="link-list">${sws.map(x => codeItem(doc, x)).join('')}</ul>` : '<p class="meta">No switch (always on, or not linked yet).</p>'}`;
}

// ---------- device ----------
const LABEL_HINTS = {
  outlet: 'e.g. Counter left', receptacle240: 'e.g. Dryer', hardwired: 'e.g. Dishwasher, Furnace',
  switch: 'e.g. Entry', light: 'e.g. Pendant over island', cable: 'e.g. Living room TV', ethernet: 'e.g. Office desk',
};

function renderDevice(d, doc) {
  const room = areaAt(doc, d.floorId, d);
  const named = (list, names, value) => list.map(v => `<option value="${v}"${v === value ? ' selected' : ''}>${names[v] ?? cap(v)}</option>`).join('');
  let typeFields = '';
  if (d.type === 'outlet') {
    typeFields = `<div class="check-row">
      <label><input type="checkbox" id="ins-gfci"${d.gfci ? ' checked' : ''}> GFCI</label>
      <label><input type="checkbox" id="ins-afci"${d.afci ? ' checked' : ''}> AFCI</label></div>`;
  } else if (d.type === 'switch') {
    typeFields = `<label>Switch type <select id="ins-switchkind">${named(['single', '3way'], { single: 'Single-pole', '3way': '3-way' }, d.switchKind)}</select></label>`;
  } else if (d.type === 'light') {
    typeFields = `<label>Light type <select id="ins-lightkind">${options(LIGHT_KINDS, d.lightKind)}</select></label>`;
  } else if (d.type === 'cable' || d.type === 'ethernet') {
    typeFields = `<label>Port / jack number <input id="ins-port" value="${esc(d.port)}" placeholder="e.g. 12 or A3"></label>`;
  }
  el.innerHTML = `
    <h3 class="dev-head">${DEVICE_NAMES[d.type]} <span class="dev-code">${esc(deviceCode(doc, d))}</span></h3>
    <p class="meta">${room ? `In <b>${esc(room.name)}</b>` : 'Not inside any area'} · ${d.wallId ? 'on a wall' : 'free-standing'}</p>
    <div class="field-row">
      <label>Number <input id="ins-num" value="${esc(d.num)}" title="Type letter + floor + sequence, e.g. R103. The breaker part (M7-) is added automatically."></label>
      <label>Type <select id="ins-type">${named(DEVICE_TYPES, DEVICE_NAMES, d.type)}</select></label>
    </div>
    ${typeFields}
    <label>Label <input id="ins-label" value="${esc(d.label)}" placeholder="${LABEL_HINTS[d.type]}"></label>
    <label>Notes <textarea id="ins-notes" placeholder="Anything worth remembering — box location, wire color, tested on…">${esc(d.notes)}</textarea></label>
    ${d.wallId ? '' : '<div class="btn-row"><button id="ins-rotate">Rotate 90°</button></div>'}
    ${circuitFields(doc, d)}
    ${linkFields(doc, d)}
    ${deleteBtn}`;
  const edit = fn => doc2 => fn(doc2.devices.find(x => x.id === d.id));
  bind('#ins-type', 'Change device type', (doc2, v) => { edit(x => { x.type = v; normalizeDevice(x); x.num = nextDeviceNum(doc2, v, x.floorId); })(doc2); cleanSwitchGroups(doc2); }, { rerender: true });
  el.querySelectorAll('[data-unlink]').forEach(b => {
    b.disabled = isReadOnly();
    b.addEventListener('click', () => commit('Unlink', doc2 => { toggleLoad(doc2, d.id, b.dataset.unlink); }));
  });
  button('#ins-unpair', () => commit('Unpair 3-way', doc2 => unpairSwitch(doc2, d.id)));
  button('#ins-link', () => { setView({ linkSwitchId: d.id }); setTool('link'); });
  bind('#ins-num', 'Renumber device', (doc2, v, input) => {
    const num = v.trim().toUpperCase();
    const clash = doc2.devices.find(x => x.num === num && x.id !== d.id);
    if (!num || clash) { status(clash ? `${num} is already used by another ${DEVICE_NAMES[clash.type].toLowerCase()}.` : 'A device needs a number.', true); input.value = d.num; return; }
    edit(x => { x.num = num; })(doc2);
  }, { rerender: true });
  bind('#ins-gfci', 'Toggle GFCI', (doc2, v, input) => edit(x => { x.gfci = input.checked; })(doc2));
  bind('#ins-afci', 'Toggle AFCI', (doc2, v, input) => edit(x => { x.afci = input.checked; })(doc2));
  bind('#ins-switchkind', 'Change switch type', (doc2, v) => edit(x => { x.switchKind = v; })(doc2));
  bind('#ins-lightkind', 'Change light type', (doc2, v) => edit(x => { x.lightKind = v; })(doc2), { rerender: true });
  bind('#ins-port', 'Set port', (doc2, v) => edit(x => { x.port = v.trim(); })(doc2));
  bind('#ins-label', 'Label device', (doc2, v) => edit(x => { x.label = v.trim(); })(doc2));
  bind('#ins-notes', 'Edit device notes', (doc2, v) => edit(x => { x.notes = v; })(doc2));
  button('#ins-rotate', () => commit('Rotate device', edit(x => { x.rot = ((x.rot ?? 0) + 90) % 360; })));
  // A new circuit assignment hasn't been tested yet, so it starts unverified.
  bind('#ins-breaker', 'Set circuit', (doc2, v) => edit(x => { if (x.breakerId !== (v || null)) { x.breakerId = v || null; x.verified = false; } })(doc2), { rerender: true });
  bind('#ins-verified', 'Toggle verified', (doc2, v, input) => edit(x => { x.verified = input.checked && !!x.breakerId; })(doc2));
  bindDelete([d.id]);
}

// ---------- multiple ----------
function renderMulti(items, doc) {
  const counts = {};
  for (const { kind } of items) counts[kind] = (counts[kind] ?? 0) + 1;
  const summary = Object.entries(counts).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ');
  // Bulk circuit editing for the line-voltage devices in the selection.
  const devs = items.filter(i => i.kind === 'device' && !LOW_VOLTAGE.has(i.obj.type)).map(i => i.obj);
  const ids = new Set(devs.map(d => d.id));
  const same = devs.length && devs.every(d => d.breakerId === devs[0].breakerId);
  const nVer = devs.filter(d => d.verified).length;
  const bulk = devs.length && doc.breakers.length ? `
    <label>Circuit for ${devs.length} device${devs.length > 1 ? 's' : ''} <select id="ins-bulk-breaker">${circuitOptions(doc, same ? devs[0].breakerId : null, { mixed: !same })}</select></label>
    <p class="meta">${nVer} of ${devs.length} verified</p>
    <div class="btn-row"><button id="ins-bulk-verify">Mark verified</button><button id="ins-bulk-unverify">Mark not verified</button></div>` : '';
  el.innerHTML = `
    <h3>${items.length} selected</h3>
    <p class="meta">${summary}</p>
    ${bulk}
    <p class="meta">Drag to move them together, or use the arrow keys (Shift = 1").</p>
    ${deleteBtn}
    <button id="ins-clear">Clear selection</button>`;
  bind('#ins-bulk-breaker', 'Set circuit', (d2, v) => {
    if (v === '__mixed') return;
    for (const x of d2.devices) if (ids.has(x.id) && x.breakerId !== (v || null)) { x.breakerId = v || null; x.verified = false; }
  }, { rerender: true });
  button('#ins-bulk-verify', () => commit('Mark verified', d2 => { for (const x of d2.devices) if (ids.has(x.id) && x.breakerId) x.verified = true; }));
  button('#ins-bulk-unverify', () => commit('Mark not verified', d2 => { for (const x of d2.devices) if (ids.has(x.id)) x.verified = false; }));
  bindDelete(items.map(i => i.obj.id));
  el.querySelector('#ins-clear').addEventListener('click', () => setView({ selection: [] }));
}

export function renderInspector() {
  if (selfCommit) return;
  const doc = getDoc();
  if (!doc) { el.innerHTML = ''; return; }
  const items = view.selection.map(x => findById(doc, x)).filter(Boolean);
  if (items.length === 0) renderHouse(doc);
  else if (items.length > 1) renderMulti(items, doc);
  else if (items[0].kind === 'wall') renderWall(items[0].obj);
  else if (items[0].kind === 'opening') renderOpening(items[0].obj, doc);
  else if (items[0].kind === 'area') renderArea(items[0].obj);
  else if (items[0].kind === 'device') renderDevice(items[0].obj, doc);
}
