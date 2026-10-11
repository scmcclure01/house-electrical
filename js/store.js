// Single source of truth for the open document, with snapshot-based undo/redo.
// Every change goes through commit(label, mutator) so it is undoable and marks the doc dirty.

const UNDO_LIMIT = 200;

const listeners = new Set();
const state = {
  doc: null,
  dirty: false,
  readOnly: false,
  undo: [], // [{label, json}]
  redo: [],
};

export function getDoc() { return state.doc; }
export function isDirty() { return state.dirty; }
export function isReadOnly() { return state.readOnly; }
export function canUndo() { return state.undo.length > 0; }
export function canRedo() { return state.redo.length > 0; }
export function undoLabel() { return state.undo.at(-1)?.label ?? ''; }
export function redoLabel() { return state.redo.at(-1)?.label ?? ''; }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(reason) { for (const fn of listeners) fn(reason); }

// Replace the whole document (new/open). Clears history.
export function load(doc, { readOnly = false } = {}) {
  state.doc = doc;
  state.readOnly = readOnly;
  state.dirty = false;
  state.undo = [];
  state.redo = [];
  emit('load');
}

export function commit(label, mutator) {
  if (state.readOnly) throw new Error('Document is read-only.');
  const before = JSON.stringify(state.doc);
  mutator(state.doc);
  if (JSON.stringify(state.doc) === before) return false;
  state.undo.push({ label, json: before });
  if (state.undo.length > UNDO_LIMIT) state.undo.shift();
  state.redo = [];
  state.dirty = true;
  emit('change');
  return true;
}

export function undo() {
  const step = state.undo.pop();
  if (!step) return;
  state.redo.push({ label: step.label, json: JSON.stringify(state.doc) });
  state.doc = JSON.parse(step.json);
  state.dirty = true;
  emit('undo');
}

export function redo() {
  const step = state.redo.pop();
  if (!step) return;
  state.undo.push({ label: step.label, json: JSON.stringify(state.doc) });
  state.doc = JSON.parse(step.json);
  state.dirty = true;
  emit('redo');
}

export function markSaved() { state.dirty = false; emit('saved'); }
