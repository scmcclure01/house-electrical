// Device tools: one per device type. Wall-type devices snap to the nearest wall face and turn
// to face the side the cursor is on; ceiling lights snap to the grid or to a room's centre.

import * as store from '../store.js';
import { view, setView } from '../ui/viewstate.js';
import { render, pxToWorld, deviceMarkup } from '../render/plan.js';
import { id, DEVICE_NAMES, normalizeDevice, isWallMounted, wallLength } from '../model.js';
import { add, sub, scale, unit, normal, dist, projectOnSegment, snapToGrid, labelPoint, roundPt } from '../geometry.js';

const WALL_REACH_IN = 18;   // how far from a wall a click still snaps onto it
const CENTER_SNAP_PX = 14;  // ceiling lights snap to a room's centre within this distance

// Compute {x, y, rot, wallId} for a device of `type` near world point `raw`.
export function devicePlacement(raw, type, lightKind) {
  const doc = store.getDoc();
  const grid = doc.settings.gridIn;
  if (isWallMounted(type, lightKind)) {
    const reach = Math.max(WALL_REACH_IN, pxToWorld(16));
    let best = null;
    for (const w of doc.walls) {
      if (w.floorId !== view.floorId) continue;
      const pr = projectOnSegment(raw, w.a, w.b);
      if (pr.d <= reach && (!best || pr.d < best.d)) best = { wall: w, ...pr };
    }
    if (best) {
      const w = best.wall;
      const u = unit(sub(w.b, w.a));
      const L = wallLength(w);
      const along = Math.max(0, Math.min(L, Math.round(best.along / grid) * grid));
      let n = normal(u);
      if ((raw.x - best.pt.x) * n.x + (raw.y - best.pt.y) * n.y < 0) n = scale(n, -1);
      const face = roundPt(add(add(w.a, scale(u, along)), scale(n, w.thicknessIn / 2)));
      return { x: face.x, y: face.y, rot: Math.round((Math.atan2(n.y, n.x) * 180) / Math.PI), wallId: w.id };
    }
  } else {
    // Ceiling light: prefer the centre of the room under the cursor.
    const tol = pxToWorld(CENTER_SNAP_PX);
    for (const a of doc.areas) {
      if (a.floorId !== view.floorId || a.kind === 'stair') continue;
      const c = roundPt(labelPoint(a.points));
      if (dist(raw, c) <= tol) return { x: c.x, y: c.y, rot: 0, wallId: null };
    }
  }
  const p = snapToGrid(raw, grid);
  return { x: p.x, y: p.y, rot: 0, wallId: null };
}

// Per-type defaults chosen in the tool-options strip.
function newDevice(type, place) {
  const o = view.deviceOpts;
  const d = { id: id('d'), floorId: view.floorId, type, ...place };
  if (type === 'outlet') { d.gfci = o.gfci; d.afci = o.afci; }
  if (type === 'switch') d.switchKind = o.switchKind;
  if (type === 'light') d.lightKind = o.lightKind;
  return normalizeDevice(d);
}

const SHORTCUTS = { outlet: 'r', receptacle240: '2', hardwired: 'h', switch: 's', light: 'l', cable: 'c', ethernet: 'e' };

export function deviceTool(type) {
  let preview = null;
  const name = DEVICE_NAMES[type].toLowerCase();
  return {
    label: DEVICE_NAMES[type],
    shortcut: SHORTCUTS[type],
    hint: type === 'light'
      ? 'Click to place a light. Ceiling lights snap to room centres; wall lights snap to walls. Pick the kind at top left.'
      : `Click near a wall to place a ${name} facing into the room (it snaps to the wall). Click in open space for a free-standing one.`,
    cancel() { preview = null; },

    move(ctx) {
      preview = newDevice(type, devicePlacement(ctx.raw, type, view.deviceOpts.lightKind));
      render();
    },

    down(ctx) {
      const d = newDevice(type, devicePlacement(ctx.raw, type, view.deviceOpts.lightKind));
      store.commit(`Add ${name}`, doc => { doc.devices.push(d); });
      setView({ selection: [d.id] });
    },

    overlay() { return preview ? deviceMarkup(preview, 'preview') : ''; },
  };
}
