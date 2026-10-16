// Print view: choose paper and sheets, preview them, then print / Save as PDF with the browser's
// print dialog. The @page size is set from the chosen paper (always landscape).

import * as store from '../store.js';
import { view, setView, onViewChange } from '../ui/viewstate.js';
import { PAPER, MARGIN, floorSheet, circuitTableSheet, panelScheduleSheet, labelsSheet } from './sheets.js';

const toolbar = document.getElementById('print-toolbar');
const optionsEl = document.getElementById('print-options');
const preview = document.getElementById('print-preview');
const pagesEl = document.getElementById('print-pages');
const pageStyle = document.head.appendChild(document.createElement('style'));

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const opts = () => view.printOpts;
const setOpts = patch => setView({ printOpts: { ...view.printOpts, ...patch } });
// Sheets are on unless switched off, so floors/panels added later are included by default.
const isOn = key => !opts().off.includes(key);

function sheetList(doc) {
  const list = [];
  for (const f of doc.floors.toSorted((a, b) => a.order - b.order)) list.push({ key: `floor:${f.id}`, label: `${f.name} plan`, build: p => floorSheet(doc, f, p, opts()) });
  list.push({ key: 'table', label: 'Circuit table', build: () => circuitTableSheet(doc) });
  for (const panel of doc.panels) list.push({ key: `panel:${panel.id}`, label: `${panel.name} panel schedule`, build: p => panelScheduleSheet(doc, panel, p) });
  list.push({ key: 'labels', label: 'Breaker number labels', build: () => labelsSheet(doc, opts()) });
  return list;
}

function renderToolbar() {
  const o = opts();
  toolbar.innerHTML = `
    <div class="tb-group"><span class="tb-label">Paper</span>
      <div class="seg">${Object.entries(PAPER).map(([k, p]) => `<button data-paper="${k}"${o.paper === k ? ' class="active"' : ''}>${p.name}</button>`).join('')}</div>
      <span class="meta">landscape</span></div>
    <div class="tb-sep"></div>
    <button id="pr-print" class="primary">Print / Save as PDF…</button>
    <div class="tb-spacer"></div>
    <span class="meta">In the print dialog choose <b>Save as PDF</b>, keep margins at <b>Default</b>, and tick <b>Background graphics</b> for circuit colors.</span>`;
}

function renderOptions(doc) {
  const o = opts();
  const list = sheetList(doc);
  optionsEl.innerHTML = `
    <h3>Sheets</h3>
    ${list.map(s => `<label class="opt-check"><input type="checkbox" data-sheet="${s.key}"${isOn(s.key) ? ' checked' : ''}> ${esc(s.label)}</label>`).join('')}
    <h3>Floor plans</h3>
    <label>Text beside devices <select id="pr-tags">
      ${[['numbers', 'Device numbers'], ['both', 'Numbers + details'], ['details', 'Details only'], ['none', 'None']].map(([v, t]) => `<option value="${v}"${o.tagMode === v ? ' selected' : ''}>${t}</option>`).join('')}
    </select></label>
    <label>Plan scale <select id="pr-scale">
      <option value="fit"${o.planScale !== 'standard' ? ' selected' : ''}>Fit to page (with scale bar)</option>
      <option value="standard"${o.planScale === 'standard' ? ' selected' : ''}>Largest standard scale (e.g. 1/8" = 1')</option>
    </select></label>
    <label class="opt-check"><input type="checkbox" id="pr-dims"${o.dims ? ' checked' : ''}> Wall dimensions</label>
    <h3>Breaker labels</h3>
    <label>Label size <select id="pr-lsize">
      <option value="small"${o.labelSize === 'small' ? ' selected' : ''}>Small · ¾" × ½"</option>
      <option value="medium"${o.labelSize === 'medium' ? ' selected' : ''}>Medium · 1" × ⅝"</option>
    </select></label>
    <label class="opt-check"><input type="checkbox" id="pr-prefix"${o.labelPrefix ? ' checked' : ''}> Include panel letter (M7)</label>
    <p class="meta">Tip: use <b>Renumber all devices</b> (House panel on the Plan view) before printing so numbers run room by room.</p>`;
}

function renderPages(doc) {
  const paper = PAPER[opts().paper] ?? PAPER.letter;
  pageStyle.textContent = `@page { size: ${paper.w}in ${paper.h}in; margin: ${MARGIN}in; }`;
  pagesEl.style.setProperty('--sw', `${paper.w}in`);
  pagesEl.style.setProperty('--sh', `${paper.h}in`);
  pagesEl.style.setProperty('--m', `${MARGIN}in`);
  const chosen = sheetList(doc).filter(s => isOn(s.key));
  pagesEl.innerHTML = chosen.length ? chosen.map(s => s.build(paper)).join('') : '<p class="placeholder">No sheets selected.</p>';
  fitPreview();
}

// Scale the preview so a whole sheet width fits the preview pane.
function fitPreview() {
  const paper = PAPER[opts().paper] ?? PAPER.letter;
  const avail = preview.clientWidth - 48;
  pagesEl.style.zoom = String(Math.min(1, Math.max(0.2, avail / (paper.w * 96))));
}

export function renderPrint() {
  if (view.mode !== 'print') return;
  const doc = store.getDoc();
  renderToolbar();
  if (!doc) { optionsEl.innerHTML = ''; pagesEl.innerHTML = '<p class="placeholder">Open a house file first.</p>'; return; }
  renderOptions(doc);
  renderPages(doc);
}

toolbar.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b?.dataset.paper) setOpts({ paper: b.dataset.paper });
  else if (b?.id === 'pr-print') window.print();
});
optionsEl.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.sheet) {
    const off = new Set(opts().off);
    if (t.checked) off.delete(t.dataset.sheet); else off.add(t.dataset.sheet);
    setOpts({ off: [...off] });
  } else if (t.id === 'pr-tags') setOpts({ tagMode: t.value });
  else if (t.id === 'pr-dims') setOpts({ dims: t.checked });
  else if (t.id === 'pr-scale') setOpts({ planScale: t.value });
  else if (t.id === 'pr-lsize') setOpts({ labelSize: t.value });
  else if (t.id === 'pr-prefix') setOpts({ labelPrefix: t.checked });
});

new ResizeObserver(() => { if (view.mode === 'print') fitPreview(); }).observe(preview);
store.subscribe(reason => { if (reason !== 'preview') renderPrint(); });
onViewChange(patch => { if ('mode' in patch || 'printOpts' in patch) renderPrint(); });
