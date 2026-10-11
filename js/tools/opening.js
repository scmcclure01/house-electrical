// Door / window / opening tool: hover a wall and click to place. Width, position and swing
// are then adjusted in the inspector.

import * as store from '../store.js';
import { view, setView } from '../ui/viewstate.js';
import { render, pxToWorld, openingGeom } from '../render/plan.js';
import { id, wallLength } from '../model.js';
import { projectOnSegment } from '../geometry.js';

export const DEFAULT_WIDTH = { door: 32, window: 36, opening: 36 };
const NAMES = { door: 'door', window: 'window', opening: 'opening' };

// Nearest wall on the current floor within reach of p, with the opening offset centred on p.
function placement(raw, kind) {
  const doc = store.getDoc();
  const reach = Math.max(12, pxToWorld(12));
  let best = null;
  for (const w of doc.walls) {
    if (w.floorId !== view.floorId) continue;
    const pr = projectOnSegment(raw, w.a, w.b);
    if (pr.d <= reach && (!best || pr.d < best.d)) best = { wall: w, ...pr };
  }
  if (!best) return null;
  const L = wallLength(best.wall);
  const width = Math.min(DEFAULT_WIDTH[kind], Math.floor(L));
  const grid = doc.settings.gridIn;
  const offset = Math.max(0, Math.min(Math.floor(L - width), Math.round((best.along - width / 2) / grid) * grid));
  return { wall: best.wall, offsetIn: offset, widthIn: width };
}

export function openingTool(kind) {
  let place = null;
  return {
    label: kind[0].toUpperCase() + kind.slice(1),
    shortcut: { door: 'd', window: 'n', opening: 'o' }[kind],
    hint: `Hover a wall and click to add a ${NAMES[kind]}. Adjust width and position in the panel on the right.`,
    cancel() { place = null; },

    move(ctx) { place = placement(ctx.raw, kind); render(); },

    down(ctx) {
      const p = placement(ctx.raw, kind);
      if (!p) return;
      const newId = id('o');
      store.commit(`Add ${NAMES[kind]}`, doc => {
        doc.openings.push({ id: newId, wallId: p.wall.id, kind, offsetIn: p.offsetIn, widthIn: p.widthIn, hinge: 'a', swing: 'left' });
      });
      setView({ selection: [newId] });
    },

    overlay(h) {
      if (!place) return '';
      const g = openingGeom(place.wall, place);
      return h.line(place.wall.a, place.wall.b, 'target-wall') +
        h.line(g.p0, g.p1, 'preview-opening', `stroke-width="${place.wall.thicknessIn + 4}"`);
    },
  };
}
