// Panels view: each panel drawn like the real thing (odd slots left, even right, numbered top to
// bottom; 2-pole breakers span two rows), plus an editor for the selected breaker or panel.

import * as store from '../store.js';
import { view, setView, onViewChange } from './viewstate.js';
import { setTool } from '../tools/index.js';
import { notify, status } from './status.js';
import {
  id, slotsOf, slotRow, slotSide, slotProblem, breakerName, fedPanel, nextColor, circuitStats,
  unassignedDevices, deleteIds, DEVICE_NAMES,
} from '../model.js';

const wrap = document.getElementById('panels-wrap');
const side = document.getElementById('panel-inspector');
const AMPS = [15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 125];

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
      <span class="b-top"><span class="b-swatch"></span><span class="b-label">${esc(b.label) || '<i>unlabeled</i>'}</span><span class="b-amps">${b.amps}A${b.poles === 2 ? ' 2P' : ''}</span></span>
      <span class="b-count">${count}</span></button>`;
  }
  for (let s = 1; s <= panel.spaces; s++) {
    const row = slotRow(s), col = slotSide(s) === 'left' ? 2 : 3;
    cells += `<span class="slot-num" style="grid-row:${row}; grid-column:${col === 2 ? 1 : 4}">${s}</span>`;
    if (!used.has(s)) cells += `<button class="slot-empty" data-panel="${panel.id}" data-pos="${s}" style="grid-row:${row}; grid-column:${col}" title="Add a breaker in slot ${s}">+</button>`;
  }
  const sel = view.panelSel?.kind === 'panel' && view.panelSel.id === panel.id;
  return `<div class="panel-card">
    <button class="panel-head${sel ? ' selected' : ''}" data-panel-head="${panel.id}">
      <span class="ph-name">${esc(panel.name)} panel</span>
      <span class="ph-meta">${panel.spaces} spaces${panel.location ? ` · ${esc(panel.location)}` : ''}${feeder ? ` · fed from ${esc(breakerName(doc, feeder))}` : ''}</span>
    </button>
    <div class="panel-grid" style="grid-template-rows: repeat(${rows}, 40px)">${cells}</div>
  </div>`;
}

// ---------- side editor ----------
function sideHelp(doc) {
  const n = unassignedDevices(doc).length;
  side.innerHTML = `
    <h3>Panels</h3>
    <p class="meta">Click a <b>+</b> slot to add a breaker there. Click a breaker to edit it, or a panel's name to edit the panel.</p>
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
  const others = doc.panels.filter(p => p.id !== b.panelId && p.fedFromBreakerId !== b.id);
  const positions = [];
  for (let s = 1; s <= panel.spaces; s++) if (s === b.position || !slotProblem(doc, b.panelId, s, b.poles, b.id)) positions.push(s);
  const lower = s => s.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase()); // 'Outlet' → 'outlet', keep '240V'
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
    <label>Notes <textarea id="pi-notes" placeholder="e.g. Tandem? Brand, AFCI/GFCI breaker, tripped often…">${esc(b.notes)}</textarea></label>
    ${feeds ? `<p class="meta">This breaker feeds the ${esc(feeds.name)} panel, so devices can't be assigned to it.</p>` : `
      <p class="meta"><b>${plural(st.total, 'device')}</b>${st.total ? ` · ${st.verified} verified` : ''}${types ? `<br>${types}` : ''}${st.rooms.length ? `<br>Rooms: ${st.rooms.map(esc).join(', ')}` : ''}</p>
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

function sidePanel(doc, panel) {
  const maxUsed = Math.max(0, ...doc.breakers.filter(b => b.panelId === panel.id).flatMap(slotsOf));
  side.innerHTML = `
    <h3>${esc(panel.name)} panel</h3>
    <label>Name <input id="pp-name" value="${esc(panel.name)}"></label>
    <label>Spaces <input id="pp-spaces" type="number" min="${Math.max(2, maxUsed)}" max="84" value="${panel.spaces}"></label>
    <label>Location <input id="pp-loc" value="${esc(panel.location)}" placeholder="e.g. Garage, east wall"></label>
    <label>Notes <textarea id="pp-notes" placeholder="Brand, main breaker size, bus rating…">${esc(panel.notes)}</textarea></label>
    <p class="meta">Count spaces as the number of single-pole positions (both columns).</p>`;
  const edit = (label, fn) => store.commit(label, d => fn(d.panels.find(x => x.id === panel.id)));
  bindChange('#pp-name', el => { if (el.value.trim()) edit('Rename panel', x => { x.name = el.value.trim(); }); });
  bindChange('#pp-loc', el => edit('Set panel location', x => { x.location = el.value.trim(); }), KEEP);
  bindChange('#pp-notes', el => edit('Edit panel notes', x => { x.notes = el.value; }), KEEP);
  bindChange('#pp-spaces', el => {
    const n = Math.round(Number(el.value));
    if (!(n >= 2) || n < maxUsed) { status(`A breaker uses slot ${maxUsed}; the panel needs at least ${maxUsed} spaces.`, true); el.value = panel.spaces; return; }
    edit('Set panel spaces', x => { x.spaces = n; });
  });
}

// ---------- render & events ----------
export function renderPanels() {
  const doc = store.getDoc();
  if (view.mode !== 'panels') return;
  if (!doc) { wrap.innerHTML = '<p class="placeholder">Open a house file first.</p>'; side.innerHTML = ''; return; }
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
      d.breakers.push({ id: newId, panelId, position, poles: 1, amps: 20, label: '', notes: '', color: nextColor(d) });
    });
    setView({ panelSel: { kind: 'breaker', id: newId, focusLabel: true } });
    notify(`Added breaker in slot ${position}. Type its label on the right.`);
  }
});

// Enter in a text field commits it.
side.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });

store.subscribe(reason => { if (reason !== 'preview') renderPanels(); });
onViewChange(patch => { if ('mode' in patch || 'panelSel' in patch) renderPanels(); });
