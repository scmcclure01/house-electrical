// Plan display controls (bottom-left of the canvas): circuit colors vs. the Unassigned view,
// the "only this circuit" filter, and a key for verified / not-verified symbols.

import * as store from '../store.js';
import { view, setView, onViewChange } from './viewstate.js';
import { unassignedDevices, breakerTitle } from '../model.js';

const bar = document.getElementById('display-bar');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function render() {
  const doc = store.getDoc();
  if (!doc) { bar.innerHTML = ''; return; }
  const n = unassignedDevices(doc).length;
  const focus = view.tool !== 'assign' && view.focusBreakerId && doc.breakers.find(b => b.id === view.focusBreakerId);
  bar.innerHTML = `
    <button data-display="circuits" class="${view.display === 'circuits' ? 'active' : ''}" title="Color devices by circuit">Circuits</button>
    <button data-display="unassigned" class="${view.display === 'unassigned' ? 'active' : ''}" title="Highlight devices not on any circuit">Unassigned (${n})</button>
    ${focus ? `<span class="chip">Only ${esc(breakerTitle(doc, focus))}<button id="clear-focus" title="Show all circuits">✕</button></span>` : ''}
    <span class="legend-key"><svg width="14" height="14" viewBox="-7 -7 14 14"><circle r="5.5" fill="#fff" stroke="#1d1f21" stroke-width="1.4"/></svg>verified</span>
    <span class="legend-key"><svg width="14" height="14" viewBox="-7 -7 14 14"><circle r="5.5" fill="#fff" stroke="#1d1f21" stroke-width="1.4" stroke-dasharray="2.6 1.8"/></svg>not verified</span>`;
}

bar.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'clear-focus') setView({ focusBreakerId: null });
  else if (b.dataset.display) setView({ display: b.dataset.display, focusBreakerId: b.dataset.display === 'unassigned' ? null : view.focusBreakerId });
});

store.subscribe(reason => { if (reason !== 'preview') render(); });
onViewChange(render);
render();
