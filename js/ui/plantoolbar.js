// The second toolbar row. On the Plan view: Floor · Show (Circuits / Unassigned) · Labels · verified key ·
// Dimensions + zoom. Panels and Print views get their own rows (filled by those modules); this file
// only switches which row is visible.

import * as store from '../store.js';
import { view, setView, onViewChange } from './viewstate.js';
import { unassignedDevices, breakerTitle } from '../model.js';
import { zoomBy, fit } from '../render/plan.js';

const bar = document.getElementById('plan-toolbar');
const rows = { plan: bar, panels: document.getElementById('panels-toolbar'), print: document.getElementById('print-toolbar') };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const KEY_SOLID = '<svg width="14" height="14" viewBox="-7 -7 14 14"><circle r="5.5" fill="#fff" stroke="#1d1f21" stroke-width="1.4"/></svg>';
const KEY_DASHED = '<svg width="14" height="14" viewBox="-7 -7 14 14"><circle r="5.5" fill="#fff" stroke="#1d1f21" stroke-width="1.4" stroke-dasharray="2.6 1.8"/></svg>';

function render() {
  for (const [mode, el] of Object.entries(rows)) el.hidden = mode !== view.mode;
  const doc = store.getDoc();
  if (!doc) { bar.innerHTML = ''; return; }
  const n = unassignedDevices(doc).length;
  const focus = view.tool !== 'assign' && view.focusBreakerId && doc.breakers.find(b => b.id === view.focusBreakerId);
  const floors = doc.floors.toSorted((a, b) => a.order - b.order);
  const on = c => (c ? ' class="active"' : '');
  bar.innerHTML = `
    <div class="tb-group">
      <span class="tb-label">Floor</span>
      <div class="seg">${floors.map(f => `<button data-floor="${f.id}"${on(f.id === view.floorId)}>${esc(f.name)}</button>`).join('')}</div>
      <label class="tb-check" title="Show the other floor as a faint outline"><input type="checkbox" id="tb-ghost"${view.ghost ? ' checked' : ''}> Ghost</label>
    </div>
    <div class="tb-sep"></div>
    <div class="tb-group">
      <span class="tb-label">Show</span>
      <div class="seg">
        <button data-display="circuits"${on(view.display === 'circuits')} title="Color devices by circuit">Circuits</button>
        <button data-display="unassigned"${on(view.display === 'unassigned')} title="Highlight devices not on any circuit">Unassigned <span class="badge${n ? ' warn' : ''}">${n}</span></button>
      </div>
      ${focus ? `<span class="chip" title="Only this circuit is shown">${esc(breakerTitle(doc, focus))}<button id="tb-clear-focus" title="Show all circuits">✕</button></span>` : ''}
    </div>
    <div class="tb-sep"></div>
    <div class="tb-group">
      <span class="tb-label">Labels</span>
      <select id="tb-tags" title="Text shown next to device symbols (when zoomed in)">
        ${[['numbers', 'Numbers'], ['details', 'Details'], ['both', 'Both'], ['none', 'Off']]
          .map(([v, t]) => `<option value="${v}"${v === view.tagMode ? ' selected' : ''}>${t}</option>`).join('')}
      </select>
      <span class="legend-key">${KEY_SOLID} verified</span>
      <span class="legend-key">${KEY_DASHED} not verified</span>
    </div>
    <div class="tb-spacer"></div>
    <div class="tb-group">
      <label class="tb-check"><input type="checkbox" id="tb-dims"${view.showDims ? ' checked' : ''}> Dimensions</label>
      <div class="seg">
        <button id="tb-zoom-out" title="Zoom out (−)">−</button>
        <button id="tb-fit" title="Fit house (F)">Fit</button>
        <button id="tb-zoom-in" title="Zoom in (+)">+</button>
      </div>
    </div>`;
}

bar.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.floor) setView({ floorId: b.dataset.floor, selection: [] });
  else if (b.dataset.display) setView({ display: b.dataset.display, focusBreakerId: b.dataset.display === 'unassigned' ? null : view.focusBreakerId });
  else if (b.id === 'tb-clear-focus') setView({ focusBreakerId: null });
  else if (b.id === 'tb-zoom-out') zoomBy(0.8);
  else if (b.id === 'tb-zoom-in') zoomBy(1.25);
  else if (b.id === 'tb-fit') fit();
});
bar.addEventListener('change', e => {
  if (e.target.id === 'tb-ghost') setView({ ghost: e.target.checked });
  else if (e.target.id === 'tb-dims') setView({ showDims: e.target.checked });
  else if (e.target.id === 'tb-tags') setView({ tagMode: e.target.value });
});

store.subscribe(reason => { if (reason !== 'preview') render(); });
onViewChange(patch => { if (!('selection' in patch) || Object.keys(patch).length > 1) render(); });
render();
