// Link tool: click a switch to make it active, then click the lights / outlets / equipment it
// controls (click again to unlink). Shift-click a second switch to pair them as a 3-way.
// Plain-clicking another switch makes that one active instead. Works across floors: the active
// switch stays active when you change floor tabs (e.g. stairs: bottom switch on 1, top on 2).

import * as store from '../store.js';
import { view, setView } from '../ui/viewstate.js';
import { notify, status } from '../ui/status.js';
import { findById, deviceCode, isSwitchable, toggleLoad, pairSwitches, groupOf, DEVICE_NAMES } from '../model.js';

const lower = s => s.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());

export const linkTool = {
  label: 'Link switches',
  shortcut: 'k',
  get hint() {
    return view.linkSwitchId
      ? 'Click loads to link/unlink them · Shift-click another switch to pair as a 3-way · click another switch to work on it · Esc to finish'
      : 'Click a switch to start linking the lights and outlets it controls.';
  },
  cancel() {},

  key(e) {
    if (e.key !== 'Escape' || !view.linkSwitchId) return false;
    setView({ linkSwitchId: null, selection: [] });
    status(this.hint);
    return true;
  },

  down(ctx) {
    const doc = store.getDoc();
    const hit = ctx.hitId && findById(doc, ctx.hitId);
    if (hit?.kind !== 'device') return;
    const d = hit.obj;
    const active = view.linkSwitchId && doc.devices.find(x => x.id === view.linkSwitchId);

    if (d.type === 'switch') {
      if (!active || d.id === active.id) { setView({ linkSwitchId: d.id === active?.id ? null : d.id, selection: [d.id] }); status(this.hint); return; }
      if (!ctx.shift) { setView({ linkSwitchId: d.id, selection: [d.id] }); status(this.hint); return; }
      if (groupOf(doc, active.id)?.switchIds.includes(d.id)) { status(`${deviceCode(doc, d)} is already paired with ${deviceCode(doc, active)}. Use the right panel to unpair.`); return; }
      let err = null;
      store.commit('Pair 3-way switches', x => { err = pairSwitches(x, active.id, d.id); });
      if (err) status(err, true);
      else notify(`${deviceCode(doc, active)} and ${deviceCode(doc, d)} are now a 3-way pair (both set to 3-way).`);
      return;
    }
    if (!active) { status('Click a switch first, then the things it controls.', true); return; }
    if (!isSwitchable(d)) { status('Cable and ethernet drops are low-voltage and aren\'t switched.', true); return; }
    let linked = false;
    store.commit('Link switch', x => { linked = toggleLoad(x, active.id, d.id); });
    notify(`${linked ? 'Linked' : 'Unlinked'} ${lower(DEVICE_NAMES[d.type])} ${deviceCode(doc, d)} ${linked ? 'to' : 'from'} ${deviceCode(doc, active)}.`);
  },
};
