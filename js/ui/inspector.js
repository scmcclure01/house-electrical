// Right-hand properties panel. Shows house properties when nothing is selected.

import { getDoc, commit, isReadOnly } from '../store.js';
import { view } from './viewstate.js';

const el = document.getElementById('inspector');

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Set while the inspector itself is committing, so it doesn't rebuild its own inputs mid-edit
// (rebuilding would drop focus when the user tabs between fields).
let selfCommit = false;

// Bind an input so edits commit to the doc once, on change (not per keystroke).
function bindField(input, label, apply) {
  input.disabled = isReadOnly();
  input.addEventListener('change', () => {
    selfCommit = true;
    try { commit(label, doc => apply(doc, input.value)); } finally { selfCommit = false; }
  });
}

function renderHouse(doc) {
  const counts = `${doc.walls.length} walls · ${doc.areas.length} areas · ${doc.devices.length} devices · ${doc.breakers.length} breakers`;
  el.innerHTML = `
    <h3>House</h3>
    <label>Name <input id="ins-house-name" value="${esc(doc.meta.name)}"></label>
    <label>Notes <textarea id="ins-house-notes">${esc(doc.meta.notes)}</textarea></label>
    <p class="meta">${counts}</p>
    <p class="meta">Schema v${doc.schemaVersion} · last saved ${doc.meta.modified ? new Date(doc.meta.modified).toLocaleString() : '—'}</p>`;
  bindField(el.querySelector('#ins-house-name'), 'Rename house', (d, v) => { d.meta.name = v.trim(); });
  bindField(el.querySelector('#ins-house-notes'), 'Edit house notes', (d, v) => { d.meta.notes = v; });
}

export function renderInspector() {
  const doc = getDoc();
  if (selfCommit) return;
  if (!doc) { el.innerHTML = ''; return; }
  if (view.selection.length === 0) renderHouse(doc);
}
