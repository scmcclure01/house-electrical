// Shared snapping: existing corners first, then 45° constraint (Shift), then the grid.

import { getDoc } from '../store.js';
import { view } from '../ui/viewstate.js';
import { pxToWorld } from '../render/plan.js';
import { dist, snapToGrid, snapAngle } from '../geometry.js';

const SNAP_PX = 10;

// Corner points on the current floor (wall ends + area vertices), as live object references.
export function cornerPoints() {
  const doc = getDoc();
  const pts = [];
  for (const w of doc.walls) if (w.floorId === view.floorId) pts.push(w.a, w.b);
  for (const a of doc.areas) if (a.floorId === view.floorId) pts.push(...a.points);
  return pts;
}

// opts.from: anchor for Shift angle-lock. opts.exclude: Set of point objects to ignore (ones being dragged).
// Returns {pt, kind: 'point'|'angle'|'grid'}.
export function snapPoint(raw, { from = null, shift = false, exclude = null } = {}) {
  const grid = getDoc().settings.gridIn;
  if (shift && from) return { pt: snapAngle(from, raw, grid), kind: 'angle' };
  const tol = pxToWorld(SNAP_PX);
  let best = null, bestD = tol;
  for (const p of cornerPoints()) {
    if (exclude?.has(p)) continue;
    const d = dist(raw, p);
    if (d <= bestD) { best = p; bestD = d; }
  }
  if (best) return { pt: { x: best.x, y: best.y }, kind: 'point' };
  return { pt: snapToGrid(raw, grid), kind: 'grid' };
}

// Overlay marker showing what the cursor snapped to.
export function snapMarker(h, snap) {
  if (!snap) return '';
  const r = h.px(snap.kind === 'point' ? 6 : 3);
  return `<circle cx="${h.f(snap.pt.x)}" cy="${h.f(snap.pt.y)}" r="${h.f(r)}" class="snap-${snap.kind}"/>`;
}
