// Tool registry and canvas event routing. Each tool is an object with optional hooks:
//   label, shortcut, hint, readOnlyOk, cancel(), down(ctx), move(ctx), up(ctx), dblclick(ctx), key(e) → handled?, overlay(h)
// ctx = {e, raw (world point), shift, hitId (object under pointer), handle (selection handle under pointer)}

import * as store from '../store.js';
import { view, setView, onViewChange } from '../ui/viewstate.js';
import { svg, worldFromEvent, panBy, zoomAt, zoomBy, fit, render, setOverlay } from '../render/plan.js';
import { status, cursorStatus } from '../ui/status.js';
import { formatLength } from '../units.js';
import { deleteIds } from '../model.js';
import { selectTool } from './select.js';
import { wallTool } from './wall.js';
import { areaTool } from './area.js';
import { openingTool } from './opening.js';
import { deviceTool } from './device.js';
import { assignTool } from './assign.js';
import { DEVICE_TYPES } from '../model.js';

export const TOOLS = {
  select: selectTool,
  extWall: wallTool('exterior'),
  intWall: wallTool('interior'),
  area: areaTool(null),
  stair: areaTool('stair'),
  door: openingTool('door'),
  window: openingTool('window'),
  opening: openingTool('opening'),
  ...Object.fromEntries(DEVICE_TYPES.map(t => [t, deviceTool(t)])),
  assign: assignTool,
};

const current = () => TOOLS[view.tool] ?? selectTool;

export function setTool(name) {
  if (!TOOLS[name]) return;
  if (store.isReadOnly() && !TOOLS[name].readOnlyOk) { status('File is read-only — drawing is disabled.', true); return; }
  current().cancel?.();
  setView({ tool: name });
}

function syncTool() {
  svg.setAttribute('class', `tool-${view.tool}`);
  setOverlay(h => current().overlay?.(h) ?? '');
  status(current().hint ?? '');
  render();
}

onViewChange(patch => {
  if ('tool' in patch) syncTool();
  if ('floorId' in patch) current().cancel?.();
  render();
});
store.subscribe(reason => {
  if (reason === 'load') { current().cancel?.(); requestAnimationFrame(fit); }
  // Drop selected ids that no longer exist (after undo, delete, or opening another file).
  const doc = store.getDoc();
  if (doc && view.selection.length) {
    const all = new Set([...doc.walls, ...doc.openings, ...doc.areas, ...doc.devices].map(o => o.id));
    const kept = view.selection.filter(x => all.has(x));
    if (kept.length !== view.selection.length) { setView({ selection: kept }); return; }
  }
  render();
});

// ---------- pointer routing ----------
let panning = null;     // {x, y} last client position while panning
let spaceDown = false;

function makeCtx(e) {
  const t = e.target instanceof Element ? e.target : null;
  return {
    e,
    raw: worldFromEvent(e),
    shift: e.shiftKey,
    hitId: t?.closest('[data-id]')?.dataset.id ?? null,
    handle: t?.closest('[data-handle]')?.dataset.handle ?? null,
  };
}

svg.addEventListener('pointerdown', e => {
  if (!store.getDoc()) return;
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    panning = { x: e.clientX, y: e.clientY };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('panning');
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  svg.setPointerCapture(e.pointerId);
  current().down?.(makeCtx(e));
});

svg.addEventListener('pointermove', e => {
  if (!store.getDoc()) return;
  if (panning) {
    panBy(e.clientX - panning.x, e.clientY - panning.y);
    panning = { x: e.clientX, y: e.clientY };
    return;
  }
  const ctx = makeCtx(e);
  cursorStatus(`x ${formatLength(ctx.raw.x)}   y ${formatLength(ctx.raw.y)}`);
  current().move?.(ctx);
});

svg.addEventListener('pointerup', e => {
  if (panning) { panning = null; svg.classList.remove('panning'); return; }
  if (e.button === 0) current().up?.(makeCtx(e));
});

svg.addEventListener('dblclick', e => current().dblclick?.(makeCtx(e)));
svg.addEventListener('pointerleave', () => cursorStatus(''));

// Pinch (ctrlKey) or a mouse wheel zooms; two-finger trackpad scrolling pans.
svg.addEventListener('wheel', e => {
  e.preventDefault();
  if (!store.getDoc()) return;
  const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
  if (e.ctrlKey || mouseWheel) zoomAt(e, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  else panBy(-e.deltaX, -e.deltaY);
}, { passive: false });

// ---------- keyboard ----------
const isTyping = e => e.target instanceof Element && e.target.matches('input, textarea, select');

document.addEventListener('keydown', e => {
  if (view.mode !== 'plan' || !store.getDoc() || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (current().key?.(e)) { e.preventDefault(); return; }
  if (e.key === ' ') { spaceDown = true; svg.classList.add('can-pan'); e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (view.selection.length) setView({ selection: [] });
    else if (view.tool !== 'select') setTool('select');
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && view.selection.length && !store.isReadOnly()) {
    const n = view.selection.length;
    store.commit(n === 1 ? 'Delete' : `Delete ${n} items`, doc => deleteIds(doc, view.selection));
    e.preventDefault();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'f') { fit(); return; }
  if (k === '=' || k === '+') { zoomBy(1.25); return; }
  if (k === '-') { zoomBy(0.8); return; }
  for (const [name, t] of Object.entries(TOOLS)) if (t.shortcut === k) { setTool(name); return; }
});

document.addEventListener('keyup', e => {
  if (e.key === ' ') { spaceDown = false; svg.classList.remove('can-pan'); }
});

syncTool();
