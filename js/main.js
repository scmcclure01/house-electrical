// App boot: wires the top bar, file commands, keyboard shortcuts and view switching.

import { newHouse, migrate, validate } from './model.js';
import * as store from './store.js';
import * as fileio from './fileio.js';
import { view, setView, onViewChange } from './ui/viewstate.js';
import { renderInspector } from './ui/inspector.js';
import { status } from './ui/status.js';
import './tools/index.js';
import './ui/toolrail.js';

const $ = sel => document.querySelector(sel);

// ---------- top bar rendering ----------
function renderTopbar() {
  const doc = store.getDoc();
  $('#file-name').textContent = doc
    ? (fileio.currentFileName() ?? 'Untitled (not saved)') + (store.isReadOnly() ? ' — read-only' : '')
    : 'No file';
  $('#dirty-dot').hidden = !store.isDirty();
  $('#btn-undo').disabled = !store.canUndo();
  $('#btn-redo').disabled = !store.canRedo();
  $('#btn-undo').title = store.canUndo() ? `Undo ${store.undoLabel()} (⌘Z)` : 'Undo (⌘Z)';
  $('#btn-redo').title = store.canRedo() ? `Redo ${store.redoLabel()} (⇧⌘Z)` : 'Redo (⇧⌘Z)';
  $('#empty-state').hidden = !!doc;

  const tabs = $('#floor-tabs');
  tabs.innerHTML = '';
  for (const f of doc?.floors.toSorted((a, b) => a.order - b.order) ?? []) {
    const b = document.createElement('button');
    b.textContent = f.name;
    b.classList.toggle('active', f.id === view.floorId);
    b.onclick = () => setView({ floorId: f.id, selection: [] });
    tabs.append(b);
  }
  document.querySelectorAll('#view-switch button').forEach(b => b.classList.toggle('active', b.dataset.view === view.mode));
}

function renderAll() {
  renderTopbar();
  renderInspector();
  document.title = store.getDoc() ? `${store.getDoc().meta.name || 'House'} — House Electrical` : 'House Electrical';
}

store.subscribe(reason => { if (reason !== 'preview') renderAll(); });
onViewChange(patch => {
  if ('mode' in patch) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view.mode}`));
  }
  renderAll();
});

// ---------- file commands ----------
function confirmDiscard() {
  return !store.isDirty() || confirm('You have unsaved changes. Discard them?');
}

function afterOpen({ doc, readOnly, warning, problems, name }) {
  store.load(doc, { readOnly });
  setView({ floorId: doc.floors[0]?.id ?? 'F1', selection: [] });
  if (warning) status(warning, true);
  else if (problems.length) status(`Opened ${name} with ${problems.length} problem(s): ${problems[0]}`, true);
  else status(`Opened ${name}`);
  refreshReopen();
}

const commands = {
  async new() {
    if (!confirmDiscard()) return;
    fileio.clearHandle();
    store.load(newHouse());
    setView({ floorId: 'F1', selection: [] });
    status('New house — use Save as… to choose where to keep it.');
  },
  async open() {
    if (!confirmDiscard()) return;
    afterOpen(await fileio.openFile());
  },
  async reopen() {
    if (!confirmDiscard()) return;
    afterOpen(await fileio.reopenLast());
  },
  async sample() {
    if (!confirmDiscard()) return;
    const raw = await (await fetch('samples/sample-house.json', { cache: 'no-store' })).json();
    const { doc } = migrate(raw);
    fileio.clearHandle();
    store.load(doc);
    setView({ floorId: 'F1', selection: [] });
    const problems = validate(doc);
    status(problems.length ? `Sample loaded with problems: ${problems[0]}` : 'Sample loaded (not linked to a file — Save as… to keep a copy).', problems.length > 0);
  },
  async save() {
    if (!store.getDoc() || store.isReadOnly()) return;
    document.activeElement?.blur(); // commit any field being edited
    const name = await fileio.saveFile(store.getDoc());
    store.markSaved();
    status(`Saved ${name} at ${new Date().toLocaleTimeString()}`);
  },
  async saveAs() {
    if (!store.getDoc()) return;
    document.activeElement?.blur();
    const name = await fileio.saveFileAs(store.getDoc());
    store.markSaved();
    status(`Saved ${name}`);
    refreshReopen();
  },
};

async function run(cmd) {
  try {
    await commands[cmd]();
  } catch (err) {
    if (err?.name === 'AbortError') return; // user cancelled a picker
    console.error(err);
    status(err.message || String(err), true);
  }
}

async function refreshReopen() {
  const name = await fileio.lastFileName();
  const btn = $('#cmd-reopen');
  btn.disabled = !name || !fileio.supported;
  btn.textContent = name ? `Reopen ${name}` : 'Reopen last';
}

// ---------- wiring ----------
const fileMenu = $('#file-menu');
fileMenu.querySelector('.menu-btn').addEventListener('click', e => { e.stopPropagation(); fileMenu.classList.toggle('open'); });
document.addEventListener('click', () => fileMenu.classList.remove('open'));
fileMenu.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => { fileMenu.classList.remove('open'); run(b.dataset.cmd); }));

document.querySelectorAll('#view-switch button').forEach(b => b.addEventListener('click', () => setView({ mode: b.dataset.view })));
$('#ghost-floor').addEventListener('change', e => setView({ ghost: e.target.checked }));
$('#btn-undo').addEventListener('click', () => store.undo());
$('#btn-redo').addEventListener('click', () => store.redo());

document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); run(e.shiftKey ? 'saveAs' : 'save'); }
  else if (k === 'o') { e.preventDefault(); run('open'); }
  else if (k === 'z' && !isTyping(e)) { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
  else if (k === 'y' && !isTyping(e)) { e.preventDefault(); store.redo(); }
});
function isTyping(e) { return e.target.matches('input, textarea, select'); }

window.addEventListener('beforeunload', e => { if (store.isDirty()) { e.preventDefault(); e.returnValue = ''; } });

if (!fileio.supported) {
  $('#unsupported').hidden = false;
  document.querySelectorAll('[data-cmd="open"], [data-cmd="reopen"], [data-cmd="save"], [data-cmd="saveAs"]').forEach(b => { b.disabled = true; });
}

refreshReopen();
renderAll();
