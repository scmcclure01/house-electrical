// UI-only state (never saved to the house file): active view, floor, selection, display options.

const listeners = new Set();

export const view = {
  mode: 'plan',       // 'plan' | 'panels' | 'print'
  floorId: 'F1',
  ghost: false,       // show the other floor faintly underneath
  selection: [],      // ids of selected objects
  tool: 'select',     // active plan tool (see js/tools/index.js)
  areaKind: 'room',   // kind used by the Area tool
  showDims: false,    // label every wall with its length
  deviceOpts: { gfci: false, afci: false, switchKind: 'single', lightKind: 'ceiling' }, // defaults for new devices
  display: 'circuits',     // plan coloring: 'circuits' | 'unassigned' (highlight devices with no circuit)
  focusBreakerId: null,    // show only this circuit (others dimmed)
  assignBreakerId: null,   // breaker the Assign tool puts devices on
  assignVerify: true,      // Assign tool also marks devices verified
  tagMode: 'numbers',      // text beside device symbols: 'numbers' | 'details' | 'both' | 'none'
  panelSel: null,          // Panels view selection: {kind: 'breaker'|'panel'|'slot', id, panelId?, position?}
};

export function setView(patch) {
  Object.assign(view, patch);
  for (const fn of listeners) fn(patch);
}

export function onViewChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
