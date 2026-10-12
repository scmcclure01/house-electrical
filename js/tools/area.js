// Area tool: click corners to outline a room, garage, attic, exterior area or stair opening.
// Click the first corner again (or press Enter) to close. Backspace removes the last corner.

import * as store from '../store.js';
import { view, setView } from '../ui/viewstate.js';
import { render } from '../render/plan.js';
import { status } from '../ui/status.js';
import { id } from '../model.js';
import { same } from '../geometry.js';
import { snapPoint, snapMarker } from './snap.js';

const DEFAULT_NAMES = { room: 'Room', garage: 'Garage', attic: 'Attic', exterior: 'Exterior', stair: 'Stairs' };

// fixedKind: 'stair' for the Stair tool; null means use view.areaKind (chosen in the tool options).
export function areaTool(fixedKind) {
  let pts = [];
  let snap = null;
  const kind = () => fixedKind ?? view.areaKind;

  function finish() {
    if (pts.length < 3) return;
    const k = kind();
    const newId = id('a');
    store.commit(`Draw ${k}`, doc => {
      const n = doc.areas.filter(a => a.kind === k).length;
      const area = { id: newId, floorId: view.floorId, name: k === 'room' ? `Room ${n + 1}` : DEFAULT_NAMES[k], kind: k, points: pts.map(p => ({ ...p })) };
      if (k === 'stair') area.stairDir = view.floorId === 'F1' ? 'up' : 'down';
      doc.areas.push(area);
    });
    pts = [];
    setView({ selection: [newId] });
    // Put the cursor in the Name field so the user can type the room name right away.
    requestAnimationFrame(() => { const el = document.getElementById('ins-name'); el?.focus(); el?.select(); });
  }

  return {
    label: fixedKind === 'stair' ? 'Stair opening' : 'Area',
    shortcut: fixedKind === 'stair' ? 't' : 'a',
    get hint() {
      return pts.length
        ? 'Click the next corner. Click the first corner or press Enter to close. Backspace = undo corner, Esc = cancel.'
        : `Click the first corner of the ${kind() === 'stair' ? 'stair opening' : kind()}. Corners snap to walls and the grid.`;
    },
    cancel() { pts = []; snap = null; },

    move(ctx) { snap = snapPoint(ctx.raw, { from: pts.at(-1), shift: ctx.shift }); render(); },

    down(ctx) {
      const p = snapPoint(ctx.raw, { from: pts.at(-1), shift: ctx.shift }).pt;
      if (pts.length >= 3 && same(p, pts[0])) { finish(); return; }
      if (pts.length && same(p, pts.at(-1))) return;
      pts.push(p);
      status(this.hint);
      render();
    },

    key(e) {
      if (!pts.length) return false;
      if (e.key === 'Enter') { finish(); status(this.hint); render(); return true; }
      if (e.key === 'Backspace') { pts.pop(); render(); return true; }
      if (e.key === 'Escape') { pts = []; status(this.hint); render(); return true; }
      return false;
    },

    overlay(h) {
      let out = snapMarker(h, snap);
      if (!pts.length) return out;
      const all = snap ? [...pts, snap.pt] : pts;
      out += `<polygon points="${h.ptsAttr(all)}" class="preview-area"/>`;
      out += `<circle cx="${pts[0].x}" cy="${pts[0].y}" r="${h.f(h.px(6))}" class="preview-first"/>`;
      return out;
    },
  };
}
