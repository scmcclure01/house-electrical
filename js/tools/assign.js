// Assign tool: pick a breaker (top-left), then click devices to put them on that circuit, or
// drag a box to assign everything inside it. Typical use: switch a breaker off, walk the house,
// then click every device that went dead. With "Mark verified" on, clicks also confirm the assignment.
// Clicking a device that's already on this circuit (and in the wanted state) takes it off again.

import * as store from '../store.js';
import { view } from '../ui/viewstate.js';
import { render, getScale } from '../render/plan.js';
import { notify, status } from '../ui/status.js';
import { findById, breakerName, LOW_VOLTAGE } from '../model.js';
import { bounds, inRect } from '../geometry.js';

let drag = null;

function activeBreaker(doc) {
  return doc.breakers.find(b => b.id === view.assignBreakerId) ?? null;
}

export const assignTool = {
  label: 'Assign circuit',
  shortcut: 'b',
  hint: 'Click devices to put them on the chosen breaker (click again to take one off) · drag a box to assign many · Esc to finish',
  cancel() { drag = null; },

  down(ctx) {
    const doc = store.getDoc();
    const b = activeBreaker(doc);
    if (!b) { status('Choose a breaker at the top left first (or add breakers in the Panels view).', true); return; }
    const hit = ctx.hitId && findById(doc, ctx.hitId);
    if (hit?.kind === 'device') { drag = null; toggle(doc, b, hit.obj); return; }
    drag = { start: ctx.raw, cur: ctx.raw, moved: false };
  },

  move(ctx) {
    if (!drag) return;
    drag.cur = ctx.raw;
    if (Math.hypot(drag.cur.x - drag.start.x, drag.cur.y - drag.start.y) * getScale() > 3) drag.moved = true;
    render();
  },

  up() {
    if (!drag?.moved) { drag = null; return; }
    const doc = store.getDoc();
    const b = activeBreaker(doc);
    const r = bounds([drag.start, drag.cur]);
    const ids = doc.devices.filter(d => d.floorId === view.floorId && !LOW_VOLTAGE.has(d.type) && inRect(d, r)).map(d => d.id);
    drag = null;
    if (!ids.length) { render(); return; }
    const verify = view.assignVerify;
    store.commit(`Assign ${ids.length} devices`, d => {
      for (const dev of d.devices) if (ids.includes(dev.id)) { dev.breakerId = b.id; dev.verified = verify; }
    });
    notify(`Put ${ids.length} device${ids.length === 1 ? '' : 's'} on ${breakerName(doc, b)}${verify ? ' (verified)' : ''}.`);
  },

  overlay(h) {
    if (!drag?.moved) return '';
    const r = bounds([drag.start, drag.cur]);
    return `<rect x="${h.f(r.minX)}" y="${h.f(r.minY)}" width="${h.f(r.maxX - r.minX)}" height="${h.f(r.maxY - r.minY)}" class="marquee"/>`;
  },
};

function toggle(doc, b, dev) {
  if (LOW_VOLTAGE.has(dev.type)) { status('Cable and ethernet drops are low-voltage — they don\'t go on a breaker.', true); return; }
  const name = breakerName(doc, b);
  const verify = view.assignVerify;
  const already = dev.breakerId === b.id && (!verify || dev.verified);
  if (already) {
    store.commit('Remove from circuit', d => { const x = d.devices.find(o => o.id === dev.id); x.breakerId = null; x.verified = false; });
    notify(`Removed from ${name}.`);
    return;
  }
  const from = dev.breakerId && dev.breakerId !== b.id ? doc.breakers.find(o => o.id === dev.breakerId) : null;
  store.commit('Assign to circuit', d => { const x = d.devices.find(o => o.id === dev.id); x.breakerId = b.id; x.verified = verify; });
  notify(from ? `Moved from ${breakerName(doc, from)} to ${name}.` : `Put on ${name}${verify ? ' (verified)' : ''}.`);
}
