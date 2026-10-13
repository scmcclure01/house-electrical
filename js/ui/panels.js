// Panels view: each panel drawn like the real thing (odd slots left, even right, numbered top to
// bottom; 2-pole breakers span two rows), plus an editor for the selected breaker or panel.

import * as store from '../store.js';
import { view, setView, onViewChange } from './viewstate.js';
import { setTool } from '../tools/index.js';
import { notify, status } from './status.js';
import {
  id, slotsOf, slotRow, slotSide, slotProblem, breakerName, fedPanel, nextColor, circuitStats,
  unassignedDevices, deleteIds, DEVICE_NAMES, BREAKER_TYPES, nextPanelCode, deviceCode,
} from '../model.js';

const wrap = document.getElementById('panels-wrap');
const toolbar = document.getElementById('panels-toolbar');
const side = document.getElementById('panel-inspector');
const AMPS = [15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 125];
const MAIN_AMPS = [60, 100, 125, 150, 200, 225, 320, 400];
const TYPE_BADGE = { gfci: 'GFCI', afci: 'AFCI', dual: 'DF' };

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- panel diagrams ----------
function panelCard(doc, panel, stats) {
  const rows = Math.ceil(panel.spaces / 2);
  const feeder = panel.fedFromBreakerId && doc.breakers.find(b => b.id === panel.fedFromBreakerId);
  const used = new Set();
  let cells = '';
  for (const b of doc.breakers.filter(x => x.panelId === panel.id)) {
    slotsOf(b).forEach(s => used.add(s));
    const st = stats.get(b.id);
    const feeds = fedPanel(doc, b.id);
    const sel = view.panelSel?.kind === 'breaker' && view.panelSel.id === b.id;
    const count = feeds ? `→ feeds ${esc(feeds.name)}` : st.total ? `${plural(st.total, 'device')} · ${st.verified} ✓` : 'no devices';
    cells += `<button class="breaker${sel ? ' selected' : ''}${feeds ? ' feeder' : ''}" data-breaker="${b.id}"
      style="grid-row: ${slotRow(b.position)} / span ${b.poles}; grid-column: ${slotSide(b.position) === 'left' ? 2 : 3}; --c: ${b.color}">
      <span class="b-top"><span class="b-swatch"></span><span class="b-label">${esc(b.label) || '<i>unlabeled</i>'}</span>${TYPE_BADGE[b.type] ? `<span class="b-type">${TYPE_BADGE[b.type]}</span>` : ''}<span class="b-amps">${b.amps}A${b.poles === 2 ? ' 2P' : ''}</span></span>
      <span class="b-count">${count}</span></button>`;
  }
  for (let s = 1; s <= panel.spaces; s++) {
    const row = slotRow(s), col = slotSide(s) === 'left' ? 2 : 3;
    cells += `<span class="slot-num" style="grid-row:${row}; grid-column:${col === 2 ? 1 : 4}">${s}</span>`;
    if (!used.has(s)) cells += `<button class="slot-empty" data-panel="${panel.id}" data-pos="${s}" style="grid-row:${row}; grid-column:${col}" title="Add a breaker in slot ${s}">+</button>`;
  }
  const sel = view.panelSel?.kind === 'panel' && view.panelSel.id === panel.id;
  return `<div class="panel-card">
    <button class="panel-head${sel ? ' selected' : ''}" data-panel-head="${panel.id}" title="Edit panel">
      <span class="ph-name"><span class="ph-code">${esc(panel.code)}</span>${esc(panel.name)} panel <span class="ph-kind">${feeder ? 'subpanel' : 'main'}</span></span>
      <span class="ph-meta">${[`${panel.spaces} spaces`, panel.mainAmps ? `${panel.mainAmps}A main` : '', [panel.brand, panel.model].filter(Boolean).map(esc).join(' '),
        panel.location ? esc(panel.location) : '', feeder ? `fed from ${esc(breakerName(doc, feeder))}` : ''].filter(Boolean).join(' · ')}</span>
    </button>
    <div class="panel-grid" style="grid-template-rows: repeat(${rows}, 40px)">${cells}</div>
  </div>`;
}

// ---------- side editor ----------
function sideHelp(doc) {
  const n = unassignedDevices(doc).length;
  side.innerHTML = `
    <h3>Panels</h3>
    <p class="meta">Click a <b>+</b> slot to add a breaker there. Click a breaker to edit it, or a panel's header to edit the panel (name, code, spaces, what feeds it, manufacturer).</p>
    <p class="meta">Use <b>+ Add panel</b> in the toolbar for another subpanel.</p>
    <p class="meta">Slots are numbered odd on the left, even on the right, top to bottom — matching the labels you'll print in Phase 5.</p>
    <p class="meta">${doc.breakers.length ? plural(doc.breakers.length, 'breaker') : 'No breakers yet'} · ${plural(n, 'device')} not on a circuit</p>
    ${n ? '<button id="pi-unassigned">Show unassigned devices on the plan</button>' : ''}`;
  side.querySelector('#pi-unassigned')?.addEventListener('click', () => setView({ mode: 'plan', display: 'unassigned', focusBreakerId: null }));
}

// keepSide: don't rebuild the editor after this edit (keeps focus when tabbing between fields).
let keepSide = false;
function bindChange(sel, fn, opts = {}) {
  const el = side.querySelector(sel);
  if (!el) return;
  el.disabled = store.isReadOnly();
  el.addEventListener('change', () => {
    keepSide = !!opts.keepSide;
    try { fn(el); } finally { keepSide = false; }
  });
}
const KEEP = { keepSide: true };

function sideBreaker(doc, b, stats) {
  const panel = doc.panels.find(p => p.id === b.panelId);
  const st = stats.get(b.id);
  const feeds = fedPanel(doc, b.id);
  // Panels this breaker could feed: not its own panel, and not one upstream of it (that would be a loop).
  const others = doc.panels.filter(p => p.fedFromBreakerId !== b.id && !isDownstream(doc, panel, p));
  const positions = [];
  for (let s = 1; s <= panel.spaces; s++) if (s === b.position || !slotProblem(doc, b.panelId, s, b.poles, b.id)) positions.push(s);
  const lower = s => s.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase()); // 'Outlet' → 'outlet', keep '240V'
  // This circuit's devices, ordered by number (type, floor, sequence).
  const devs = doc.devices.filter(d => d.breakerId === b.id).sort((x, y) => (x.num ?? '').localeCompare(y.num ?? '', undefined, { numeric: true }));
  const types = Object.entries(st.byType).map(([t, n]) => `${n} ${lower(DEVICE_NAMES[t])}${n > 1 ? 's' : ''}`).join(', ');
  side.innerHTML = `
    <h3><span class="b-swatch" style="--c:${b.color}"></span> ${esc(breakerName(doc, b))}</h3>
    <label>Label <input id="pi-label" value="${esc(b.label)}" placeholder="e.g. Kitchen counter"></label>
    <div class="field-row">
      <label>Amps <select id="pi-amps">${AMPS.concat(AMPS.includes(b.amps) ? [] : [b.amps]).map(a => `<option${a === b.amps ? ' selected' : ''}>${a}</option>`).join('')}</select></label>
      <label>Poles <select id="pi-poles"><option value="1"${b.poles === 1 ? ' selected' : ''}>1 (120V)</option><option value="2"${b.poles === 2 ? ' selected' : ''}>2 (240V)</option></select></label>
    </div>
    <div class="field-row">
      <label>Slot <select id="pi-pos">${positions.map(s => `<option value="${s}"${s === b.position ? ' selected' : ''}>${slotsOf({ position: s, poles: b.poles }).join('/')}</option>`).join('')}</select></label>
      <label>Color <input id="pi-color" type="color" value="${b.color}"></label>
    </div>
    ${b.poles === 2 && (feeds || others.length) ? `<label>Feeds subpanel <select id="pi-feeds"><option value="">— no —</option>
      ${(feeds ? [feeds] : []).concat(others).map(p => `<option value="${p.id}"${feeds?.id === p.id ? ' selected' : ''}>${esc(p.name)} panel</option>`).join('')}</select></label>` : ''}
    <div class="field-row">
      <label>Breaker type <select id="pi-type">${Object.entries(BREAKER_TYPES).map(([v, t]) => `<option value="${v}"${v === b.type ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    <label>Brand / model <input id="pi-model" value="${esc(b.model)}" placeholder="e.g. Square D HOM120"></label>
    <label>Notes <textarea id="pi-notes" placeholder="e.g. Trips when the microwave and toaster run together">${esc(b.notes)}</textarea></label>
    ${feeds ? `<p class="meta">This breaker feeds the ${esc(feeds.name)} panel, so devices can't be assigned to it.</p>` : `
      <p class="meta"><b>${plural(st.total, 'device')}</b>${st.total ? ` · ${st.verified} verified` : ''}${types ? `<br>${types}` : ''}${st.rooms.length ? `<br>Rooms: ${st.rooms.map(esc).join(', ')}` : ''}</p>
      ${devs.length ? `<div class="code-list">${devs.map(d => `<span class="code-chip${d.verified ? '' : ' unverified'}" title="${esc(DEVICE_NAMES[d.type])}${d.label ? ` — ${esc(d.label)}` : ''}${d.verified ? '' : ' (not verified)'}">${esc(deviceCode(doc, d))}</span>`).join('')}</div>` : ''}
      <div class="btn-col">
        <button id="pi-assign" class="primary">Assign devices on the plan…</button>
        <button id="pi-show"${st.total ? '' : ' disabled'}>Show only this circuit on the plan</button>
      </div>`}
    <button id="pi-delete" class="danger">Delete breaker</button>`;

  const edit = (label, fn) => store.commit(label, d => fn(d.breakers.find(x => x.id === b.id), d));
  bindChange('#pi-label', el => edit('Label breaker', x => { x.label = el.value.trim(); }), KEEP);
  bindChange('#pi-amps', el => edit('Set breaker amps', x => { x.amps = Number(el.value); }), KEEP);
  bindChange('#pi-color', el => edit('Set circuit color', x => { x.color = el.value; }), KEEP);
  bindChange('#pi-notes', el => edit('Edit breaker notes', x => { x.notes = el.value; }), KEEP);
  bindChange('#pi-type', el => edit('Set breaker type', x => { x.type = el.value; }), KEEP);
  bindChange('#pi-model', el => edit('Set breaker model', x => { x.model = el.value.trim(); }), KEEP);
  bindChange('#pi-pos', el => edit('Move breaker', x => { x.position = Number(el.value); }));
  bindChange('#pi-poles', el => {
    const poles = Number(el.value);
    const problem = slotProblem(doc, b.panelId, b.position, poles, b.id);
    if (problem) { status(`Can't make it ${poles}-pole here: ${problem}. Move it to a slot with a free space below first.`, true); el.value = b.poles; return; }
    edit('Change breaker poles', (x, d) => {
      x.poles = poles;
      if (poles === 1) for (const p of d.panels) if (p.fedFromBreakerId === x.id) p.fedFromBreakerId = null;
    });
  });
  bindChange('#pi-feeds', el => edit('Set subpanel feeder', (x, d) => {
    for (const p of d.panels) if (p.fedFromBreakerId === x.id) p.fedFromBreakerId = null;
    if (el.value) {
      const p = d.panels.find(q => q.id === el.value);
      p.fedFromBreakerId = x.id;
      if (!x.label) x.label = `${p.name} panel feed`;
      for (const dev of d.devices) if (dev.breakerId === x.id) { dev.breakerId = null; dev.verified = false; }
    }
  }));
  side.querySelector('#pi-assign')?.addEventListener('click', () => {
    setView({ mode: 'plan', assignBreakerId: b.id, focusBreakerId: null, display: 'circuits' });
    setTool('assign');
  });
  side.querySelector('#pi-show')?.addEventListener('click', () => setView({ mode: 'plan', focusBreakerId: b.id, display: 'circuits' }));
  side.querySelector('#pi-delete').disabled = store.isReadOnly();
  side.querySelector('#pi-delete').addEventListener('click', () => {
    if (st.total && !confirm(`Delete ${breakerName(doc, b)}? Its ${plural(st.total, 'device')} will become unassigned.`)) return;
    store.commit('Delete breaker', d => deleteIds(d, [b.id]));
    setView({ panelSel: null });
  });
}

// Is panel `x` fed (directly or through other subpanels) from panel `root`?
function isDownstream(doc, x, root) {
  for (let p = x, guard = 0; p && guard < 20; guard++) {
    if (p.id === root.id) return true;
    const feeder = doc.breakers.find(b => b.id === p.fedFromBreakerId);
    p = feeder && doc.panels.find(q => q.id === feeder.panelId);
  }
  return false;
}

function sidePanel(doc, panel) {
  const maxUsed = Math.max(0, ...doc.breakers.filter(b => b.panelId === panel.id).flatMap(slotsOf));
  // Feeder candidates: 2-pole breakers in panels that aren't this one or fed from it, and not already feeding another panel.
  const feeders = doc.breakers.filter(b => {
    if (b.poles !== 2) return false;
    const owner = doc.panels.find(p => p.id === b.panelId);
    if (!owner || isDownstream(doc, owner, panel)) return false;
    const fed = fedPanel(doc, b.id);
    return !fed || fed.id === panel.id;
  });
  const nBreakers = doc.breakers.filter(b => b.panelId === panel.id).length;
  const opt = (v, cur, t) => `<option value="${v}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${t}</option>`;
  side.innerHTML = `
    <h3><span class="ph-code dark">${esc(panel.code)}</span> ${esc(panel.name)} panel</h3>
    <div class="field-row">
      <label style="flex:2">Name <input id="pp-name" value="${esc(panel.name)}"></label>
      <label>Code <input id="pp-code" value="${esc(panel.code)}" maxlength="3" title="Short letters used in breaker and device codes, e.g. M7, M7-R103"></label>
    </div>
    <label>Fed from <select id="pp-fed">
      ${opt('', panel.fedFromBreakerId, '— utility service (this is a main panel) —')}
      ${feeders.map(b => opt(b.id, panel.fedFromBreakerId, `${esc(breakerName(doc, b))} · ${b.amps}A${b.label ? ` · ${esc(b.label)}` : ''}`)).join('')}
    </select></label>
    ${feeders.length || panel.fedFromBreakerId ? '' : '<p class="meta">To feed this panel from another, first add a 2-pole breaker in that panel.</p>'}
    <div class="field-row">
      <label>Spaces <input id="pp-spaces" type="number" min="${Math.max(2, maxUsed)}" max="84" value="${panel.spaces}"></label>
      <label>Main breaker <select id="pp-main">${opt('', panel.mainAmps, '—')}${MAIN_AMPS.concat(MAIN_AMPS.includes(panel.mainAmps) || !panel.mainAmps ? [] : [panel.mainAmps]).map(a => opt(a, panel.mainAmps, `${a}A`)).join('')}</select></label>
    </div>
    <div class="field-row">
      <label>Brand <input id="pp-brand" value="${esc(panel.brand)}" placeholder="e.g. Square D"></label>
      <label>Bus rating (A) <input id="pp-bus" type="number" min="0" value="${panel.busAmps ?? ''}" placeholder="e.g. 225"></label>
    </div>
    <label>Model / catalog number <input id="pp-model" value="${esc(panel.model)}" placeholder="e.g. HOM3060M200PC"></label>
    <label>Location <input id="pp-loc" value="${esc(panel.location)}" placeholder="e.g. Garage, east wall"></label>
    <label>Notes <textarea id="pp-notes" placeholder="Install date, label inside the door, grounding…">${esc(panel.notes)}</textarea></label>
    <p class="meta">Spaces = number of single-pole positions, both columns together.</p>
    <button id="pp-delete" class="danger"${doc.panels.length < 2 ? ' disabled title="A house needs at least one panel"' : ''}>Delete panel</button>`;
  const edit = (label, fn) => store.commit(label, d => fn(d.panels.find(x => x.id === panel.id), d));
  bindChange('#pp-name', el => { if (el.value.trim()) edit('Rename panel', x => { x.name = el.value.trim(); }); }, KEEP);
  bindChange('#pp-code', el => {
    const code = el.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const clash = doc.panels.find(p => p.code === code && p.id !== panel.id);
    if (!/^[A-Z][A-Z0-9]{0,2}$/.test(code) || clash) {
      status(clash ? `Code ${code} is already used by the ${clash.name} panel.` : 'Panel code: 1–3 letters/digits starting with a letter.', true);
      el.value = panel.code; return;
    }
    edit('Set panel code', x => { x.code = code; });
  });
  bindChange('#pp-fed', el => edit('Set panel feed', (x, d) => {
    x.fedFromBreakerId = el.value || null;
    const b = el.value && d.breakers.find(q => q.id === el.value);
    if (b) {
      if (!b.label) b.label = `${x.name} panel feed`;
      for (const dev of d.devices) if (dev.breakerId === b.id) { dev.breakerId = null; dev.verified = false; }
    }
  }));
  bindChange('#pp-main', el => edit('Set main breaker size', x => { x.mainAmps = el.value ? Number(el.value) : null; }), KEEP);
  bindChange('#pp-bus', el => edit('Set bus rating', x => { x.busAmps = el.value ? Math.round(Number(el.value)) : null; }), KEEP);
  bindChange('#pp-brand', el => edit('Set panel brand', x => { x.brand = el.value.trim(); }), KEEP);
  bindChange('#pp-model', el => edit('Set panel model', x => { x.model = el.value.trim(); }), KEEP);
  bindChange('#pp-loc', el => edit('Set panel location', x => { x.location = el.value.trim(); }), KEEP);
  bindChange('#pp-notes', el => edit('Edit panel notes', x => { x.notes = el.value; }), KEEP);
  bindChange('#pp-spaces', el => {
    const n = Math.round(Number(el.value));
    if (!(n >= 2) || n < maxUsed) { status(`A breaker uses slot ${maxUsed}; the panel needs at least ${maxUsed} spaces.`, true); el.value = panel.spaces; return; }
    edit('Set panel spaces', x => { x.spaces = n; });
  });
  side.querySelector('#pp-delete').addEventListener('click', () => {
    if (store.isReadOnly() || doc.panels.length < 2) return;
    const fedHere = doc.panels.filter(p => doc.breakers.some(b => b.panelId === panel.id && b.id === p.fedFromBreakerId));
    const warn = [nBreakers ? `its ${plural(nBreakers, 'breaker')} (their devices become unassigned)` : '',
      fedHere.length ? `the feed to ${fedHere.map(p => p.name).join(', ')}` : ''].filter(Boolean).join(' and ');
    if (!confirm(`Delete the ${panel.name} panel${warn ? `, including ${warn}` : ''}?`)) return;
    store.commit('Delete panel', d => deleteIds(d, [panel.id]));
    setView({ panelSel: null });
  });
}

function renderToolbar(doc) {
  if (!doc) { toolbar.innerHTML = ''; return; }
  const n = unassignedDevices(doc).length;
  toolbar.innerHTML = `
    <div class="tb-group"><span class="tb-label">Panels</span>
      <button id="pt-add" class="primary"${store.isReadOnly() ? ' disabled' : ''}>+ Add panel</button></div>
    <div class="tb-sep"></div>
    <span class="meta">${plural(doc.panels.length, 'panel')} · ${plural(doc.breakers.length, 'breaker')} · ${plural(n, 'device')} not on a circuit</span>
    <div class="tb-spacer"></div>
    <span class="meta">Click a <b>+</b> slot to add a breaker · click a panel header to edit the panel</span>`;
}

toolbar.addEventListener('click', e => {
  if (e.target.closest('#pt-add')) {
    const newId = id('p');
    store.commit('Add panel', d => {
      const name = d.panels.some(p => p.name === 'Sub') ? `Sub ${d.panels.length}` : 'Sub';
      d.panels.push({ id: newId, name, code: nextPanelCode(d, name), spaces: 20, location: '', notes: '', brand: '', model: '', mainAmps: null, busAmps: null, fedFromBreakerId: null });
    });
    setView({ panelSel: { kind: 'panel', id: newId } });
    notify('Added a panel. Set what feeds it on the right.');
  }
});

// ---------- render & events ----------
export function renderPanels() {
  const doc = store.getDoc();
  if (view.mode !== 'panels') return;
  if (!doc) { wrap.innerHTML = '<p class="placeholder">Open a house file first.</p>'; side.innerHTML = ''; renderToolbar(null); return; }
  renderToolbar(doc);
  const stats = circuitStats(doc);
  wrap.innerHTML = doc.panels.map(p => panelCard(doc, p, stats)).join('');
  if (keepSide) return;
  const sel = view.panelSel;
  const b = sel?.kind === 'breaker' && doc.breakers.find(x => x.id === sel.id);
  const p = sel?.kind === 'panel' && doc.panels.find(x => x.id === sel.id);
  if (b) sideBreaker(doc, b, stats);
  else if (p) sidePanel(doc, p);
  else sideHelp(doc);
  if (sel?.focusLabel) { const el = side.querySelector('#pi-label'); el?.focus(); delete sel.focusLabel; }
}

wrap.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.breaker) setView({ panelSel: { kind: 'breaker', id: t.dataset.breaker } });
  else if (t.dataset.panelHead) setView({ panelSel: { kind: 'panel', id: t.dataset.panelHead } });
  else if (t.dataset.pos) {
    if (store.isReadOnly()) return;
    const newId = id('b');
    const panelId = t.dataset.panel, position = Number(t.dataset.pos);
    store.commit('Add breaker', d => {
      d.breakers.push({ id: newId, panelId, position, poles: 1, amps: 20, label: '', notes: '', color: nextColor(d), type: 'standard', model: '' });
    });
    setView({ panelSel: { kind: 'breaker', id: newId, focusLabel: true } });
    notify(`Added breaker in slot ${position}. Type its label on the right.`);
  }
});

// Enter in a text field commits it.
side.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });

store.subscribe(reason => { if (reason !== 'preview') renderPanels(); });
onViewChange(patch => { if ('mode' in patch || 'panelSel' in patch) renderPanels(); });
