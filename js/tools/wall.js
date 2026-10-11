// Wall tool: click a start point, then click each corner. Walls chain until Esc, Enter,
// a double-click, or clicking back on the chain's first point.
// Typed lengths: while drawing, type e.g. 12'6 and press Enter to add a wall of exactly that
// length, heading toward the cursor (rounded to the nearest 45°).

import * as store from '../store.js';
import { view } from '../ui/viewstate.js';
import { render } from '../render/plan.js';
import { status } from '../ui/status.js';
import { id } from '../model.js';
import { add, scale, same, dist, roundPt, snappedDirection } from '../geometry.js';
import { parseLength, formatLength } from '../units.js';
import { snapPoint, snapMarker } from './snap.js';

const LENGTH_CHARS = /^[0-9'".\- ]$/;

export function wallTool(kind) {
  let start = null;       // current chain point
  let chainStart = null;  // first point of the chain (clicking it closes the loop)
  let snap = null;        // last snapped cursor
  let buffer = '';        // typed length

  const hint = () => start
    ? `Click the next corner, or type a length (e.g. 12'6) and press Enter. Shift = 45° lock. Esc/double-click to finish.`
    : `Click to start a ${kind} wall. Corners snap to the 6" grid and to existing corners.`;

  function reset() { start = null; chainStart = null; buffer = ''; }

  function addWall(a, b) {
    if (same(a, b)) return;
    store.commit(`Draw ${kind} wall`, doc => {
      doc.walls.push({ id: id('w'), floorId: view.floorId, kind, a: { ...a }, b: { ...b }, thicknessIn: doc.settings.defaultWallIn[kind] });
    });
    if (chainStart && same(b, chainStart)) { reset(); status('Closed the loop. ' + hint()); }
    else start = { ...b };
  }

  function typedEnd() {
    const L = parseLength(buffer);
    if (!L || !start || !snap) return null;
    const toward = same(snap.pt, start) ? add(start, { x: 1, y: 0 }) : snap.pt;
    return roundPt(add(start, scale(snappedDirection(start, toward), L)));
  }

  return {
    label: kind === 'exterior' ? 'Exterior wall' : 'Interior wall',
    shortcut: kind === 'exterior' ? 'w' : 'i',
    get hint() { return hint(); },
    cancel() { reset(); snap = null; },

    move(ctx) {
      snap = snapPoint(ctx.raw, { from: start, shift: ctx.shift });
      render();
    },

    down(ctx) {
      const p = snapPoint(ctx.raw, { from: start, shift: ctx.shift }).pt;
      if (!start) { start = p; chainStart = p; status(hint()); }
      else addWall(start, p);
      buffer = '';
      render();
    },

    dblclick() { reset(); status(hint()); render(); },

    key(e) {
      if (!start) return false;
      if (LENGTH_CHARS.test(e.key) && (e.key !== ' ' || buffer)) { buffer += e.key; render(); return true; }
      if (e.key === 'Backspace' && buffer) { buffer = buffer.slice(0, -1); render(); return true; }
      if (e.key === 'Enter') {
        if (buffer) {
          const end = typedEnd();
          if (!end) { status(`Couldn't read "${buffer}" as a length. Try 12'6, 12 6, or 150.`, true); buffer = ''; render(); return true; }
          addWall(start, end);
          buffer = '';
        } else reset();
        status(hint());
        render();
        return true;
      }
      if (e.key === 'Escape') {
        if (buffer) buffer = ''; else reset();
        status(hint());
        render();
        return true;
      }
      return false;
    },

    overlay(h) {
      let out = snapMarker(h, snap);
      if (!start || !snap) return out;
      const end = (buffer && typedEnd()) || snap.pt;
      out += h.line(start, end, `preview-wall preview-${kind}`, `stroke-width="${store.getDoc().settings.defaultWallIn[kind]}"`);
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      out += `<text x="${h.f(mid.x)}" y="${h.f(mid.y - h.px(10))}" font-size="${h.f(h.px(12))}" class="preview-dim">${formatLength(dist(start, end))}</text>`;
      if (buffer) {
        out += `<text x="${h.f(snap.pt.x + h.px(14))}" y="${h.f(snap.pt.y + h.px(24))}" font-size="${h.f(h.px(13))}" class="typed-length">${buffer} ↵</text>`;
      }
      return out;
    },
  };
}
