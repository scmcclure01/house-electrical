// Select tool: click to select, Shift-click to add/remove, drag to move, drag on empty space
// to box-select, drag square handles to reshape. Corners shared by walls stay connected.

import * as store from '../store.js';
import { view, setView } from '../ui/viewstate.js';
import { render, getScale } from '../render/plan.js';
import { add, sub, same, unit, snapToGrid, bounds, inRect } from '../geometry.js';
import { wallLength } from '../model.js';
import { snapPoint } from './snap.js';

const DRAG_START_PX = 3;
const clone = o => JSON.parse(JSON.stringify(o));

// Move the selected objects by d (inches), starting from the `orig` snapshot.
// Unselected walls whose ends touch a moved wall end are stretched to stay connected.
function moveSelection(doc, orig, d, rawDelta) {
  const sel = new Set(view.selection);
  const movedEnds = [];
  orig.walls.forEach((ow, i) => {
    if (!sel.has(ow.id)) return;
    doc.walls[i].a = add(ow.a, d);
    doc.walls[i].b = add(ow.b, d);
    movedEnds.push(ow.a, ow.b);
  });
  orig.walls.forEach((ow, i) => {
    if (sel.has(ow.id) || ow.floorId !== view.floorId) return;
    if (movedEnds.some(p => same(p, ow.a))) doc.walls[i].a = add(ow.a, d);
    if (movedEnds.some(p => same(p, ow.b))) doc.walls[i].b = add(ow.b, d);
  });
  orig.areas.forEach((oa, i) => {
    if (sel.has(oa.id)) doc.areas[i].points = oa.points.map(p => add(p, d));
  });
  orig.openings.forEach((oo, i) => {
    if (!sel.has(oo.id) || sel.has(oo.wallId)) return;
    const w = orig.walls.find(x => x.id === oo.wallId);
    const u = unit(sub(w.b, w.a));
    const off = Math.round(oo.offsetIn + rawDelta.x * u.x + rawDelta.y * u.y);
    doc.openings[i].offsetIn = Math.max(0, Math.min(Math.floor(wallLength(w) - oo.widthIn), off));
  });
  clampOpenings(doc);
}

// Keep openings inside their (possibly shortened) walls.
function clampOpenings(doc) {
  for (const o of doc.openings) {
    const w = doc.walls.find(x => x.id === o.wallId);
    if (!w) continue;
    const L = Math.floor(wallLength(w));
    o.widthIn = Math.min(o.widthIn, L);
    o.offsetIn = Math.max(0, Math.min(L - o.widthIn, o.offsetIn));
  }
}

function itemsInRect(doc, r) {
  const ids = [];
  for (const w of doc.walls) if (w.floorId === view.floorId && inRect(w.a, r) && inRect(w.b, r)) ids.push(w.id);
  for (const a of doc.areas) if (a.floorId === view.floorId && a.points.every(p => inRect(p, r))) ids.push(a.id);
  return ids;
}

let drag = null;

export const selectTool = {
  label: 'Select',
  shortcut: 'v',
  readOnlyOk: true,
  hint: 'Click to select · Shift-click to add · drag to move · drag empty space to box-select · Delete removes · Space-drag or two-finger scroll pans · F fits',
  cancel() { if (drag?.moved && drag.type !== 'marquee') store.cancelGesture(); drag = null; },

  down(ctx) {
    if (ctx.handle) {
      const [objId, which] = ctx.handle.split('|');
      drag = { type: 'handle', objId, which, startRaw: ctx.raw, moved: false };
    } else if (ctx.hitId) {
      if (ctx.shift) {
        const sel = view.selection.includes(ctx.hitId) ? view.selection.filter(x => x !== ctx.hitId) : [...view.selection, ctx.hitId];
        setView({ selection: sel });
        drag = null;
        return;
      }
      if (!view.selection.includes(ctx.hitId)) setView({ selection: [ctx.hitId] });
      drag = { type: 'move', startRaw: ctx.raw, moved: false };
    } else {
      if (!ctx.shift && view.selection.length) setView({ selection: [] });
      drag = { type: 'marquee', startRaw: ctx.raw, cur: ctx.raw, additive: ctx.shift, moved: false };
    }
  },

  move(ctx) {
    if (!drag) return;
    const raw = ctx.raw;
    if (!drag.moved) {
      const dpx = Math.hypot(raw.x - drag.startRaw.x, raw.y - drag.startRaw.y) * getScale();
      if (dpx < DRAG_START_PX) return;
      drag.moved = true;
      if (drag.type !== 'marquee') {
        if (!store.beginGesture(drag.type === 'handle' ? 'Reshape' : 'Move')) { drag = null; return; }
        drag.orig = clone(store.getDoc());
        if (drag.type === 'handle') prepareHandle(drag);
      }
    }
    if (drag.type === 'marquee') { drag.cur = raw; render(); return; }
    if (drag.type === 'move') {
      const grid = store.getDoc().settings.gridIn;
      const rawDelta = sub(raw, drag.startRaw);
      const d = snapToGrid(rawDelta, grid);
      store.updateGesture(doc => moveSelection(doc, drag.orig, d, rawDelta));
      return;
    }
    // handle drag: move the grabbed corner (and any corners sitting on top of it)
    const p = snapPoint(raw, { from: drag.anchor, shift: ctx.shift, exclude: drag.livePoints }).pt;
    store.updateGesture(doc => {
      for (const lp of drag.livePoints) { lp.x = p.x; lp.y = p.y; }
      clampOpenings(doc);
    });
  },

  up() {
    if (!drag) return;
    if (drag.type === 'marquee' && drag.moved) {
      const r = bounds([drag.startRaw, drag.cur]);
      const ids = itemsInRect(store.getDoc(), r);
      setView({ selection: drag.additive ? [...new Set([...view.selection, ...ids])] : ids });
    } else if (drag.moved) {
      store.endGesture();
    }
    drag = null;
    render();
  },

  key(e) {
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!arrows[e.key] || !view.selection.length || store.isReadOnly()) return false;
    const step = e.shiftKey ? 1 : store.getDoc().settings.gridIn;
    const d = { x: arrows[e.key][0] * step, y: arrows[e.key][1] * step };
    const orig = clone(store.getDoc());
    store.commit('Nudge', doc => moveSelection(doc, orig, d, d));
    return true;
  },

  overlay(h) {
    if (drag?.type !== 'marquee' || !drag.moved) return '';
    const r = bounds([drag.startRaw, drag.cur]);
    return `<rect x="${h.f(r.minX)}" y="${h.f(r.minY)}" width="${h.f(r.maxX - r.minX)}" height="${h.f(r.maxY - r.minY)}" class="marquee"/>`;
  },
};

// Collect the live point objects a handle drag will move, plus the anchor for Shift angle-lock.
function prepareHandle(d) {
  const doc = store.getDoc();
  const wall = doc.walls.find(w => w.id === d.objId);
  if (wall) {
    const grabbed = { ...wall[d.which] };
    d.anchor = { ...wall[d.which === 'a' ? 'b' : 'a'] };
    d.livePoints = new Set();
    for (const w of doc.walls) {
      if (w.floorId !== wall.floorId) continue;
      if (same(w.a, grabbed)) d.livePoints.add(w.a);
      if (same(w.b, grabbed)) d.livePoints.add(w.b);
    }
    return;
  }
  const area = doc.areas.find(a => a.id === d.objId);
  const i = Number(d.which);
  d.livePoints = new Set([area.points[i]]);
  d.anchor = { ...area.points[(i - 1 + area.points.length) % area.points.length] };
}
