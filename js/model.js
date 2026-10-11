// House document: schema version, factory, migration, validation.
// All lengths are whole inches. All floors share one coordinate origin.

export const SCHEMA_VERSION = 1;

export const DEVICE_TYPES = ['outlet', 'receptacle240', 'hardwired', 'switch', 'light', 'cable', 'ethernet'];
export const AREA_KINDS = ['room', 'garage', 'attic', 'exterior', 'stair'];
export const WALL_KINDS = ['exterior', 'interior'];
export const OPENING_KINDS = ['door', 'window', 'opening'];

let idCounter = 0;
export function id(prefix) {
  idCounter = (idCounter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36).padStart(2, '0')}`;
}

export function newHouse(name = 'My House') {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { name, modified: new Date().toISOString(), notes: '' },
    settings: { gridIn: 6, defaultWallIn: { exterior: 6, interior: 4 } },
    floors: [
      { id: 'F1', name: 'First Floor', order: 1 },
      { id: 'F2', name: 'Second Floor', order: 2 },
    ],
    walls: [],
    openings: [],
    areas: [],
    devices: [],
    panels: [
      { id: 'p_main', name: 'Main', spaces: 30, location: '', notes: '', fedFromBreakerId: null },
      { id: 'p_sub', name: 'Sub', spaces: 20, location: '', notes: '', fedFromBreakerId: null },
    ],
    breakers: [],
    switchGroups: [],
  };
}

// Upgrade older documents one version at a time. Add a step here whenever SCHEMA_VERSION bumps:
//   MIGRATIONS[1] = doc => { ...transform v1 into v2...; doc.schemaVersion = 2; return doc; }
const MIGRATIONS = {};

export function migrate(doc) {
  if (typeof doc.schemaVersion !== 'number') throw new Error('Not a house file: missing schemaVersion.');
  if (doc.schemaVersion > SCHEMA_VERSION) {
    return { doc, readOnly: true, warning: `File is schema v${doc.schemaVersion}; this app supports v${SCHEMA_VERSION}. Opened read-only.` };
  }
  while (doc.schemaVersion < SCHEMA_VERSION) {
    const step = MIGRATIONS[doc.schemaVersion];
    if (!step) throw new Error(`No migration from schema v${doc.schemaVersion}.`);
    doc = step(doc);
  }
  // Fill any missing top-level collections so older/hand-edited files load cleanly.
  const fresh = newHouse();
  for (const k of Object.keys(fresh)) if (doc[k] === undefined) doc[k] = fresh[k];
  return { doc, readOnly: false, warning: null };
}

// Panel slot math: odd slots on the left, even on the right, numbered top to bottom.
// A 2-pole breaker at position n also occupies n+2 (next row, same side).
export function slotsOf(breaker) {
  return breaker.poles === 2 ? [breaker.position, breaker.position + 2] : [breaker.position];
}
export function slotRow(n) { return Math.ceil(n / 2); }
export function slotSide(n) { return n % 2 === 1 ? 'left' : 'right'; }

// Returns a list of human-readable problems; empty means valid.
export function validate(doc) {
  const errs = [];
  const ids = new Set();
  const dup = (x, what) => { if (ids.has(x.id)) errs.push(`Duplicate id ${x.id} (${what})`); ids.add(x.id); };
  const floorIds = new Set(doc.floors.map(f => f.id));
  doc.floors.forEach(f => dup(f, 'floor'));
  doc.walls.forEach(w => { dup(w, 'wall'); if (!floorIds.has(w.floorId)) errs.push(`Wall ${w.id} has unknown floor`); });
  const wallIds = new Set(doc.walls.map(w => w.id));
  doc.openings.forEach(o => { dup(o, 'opening'); if (!wallIds.has(o.wallId)) errs.push(`Opening ${o.id} has unknown wall`); });
  doc.areas.forEach(a => { dup(a, 'area'); if (a.points.length < 3) errs.push(`Area ${a.name || a.id} has fewer than 3 points`); });
  doc.panels.forEach(p => dup(p, 'panel'));
  const breakerIds = new Set(doc.breakers.map(b => b.id));
  const used = new Map(); // panelId:slot -> breaker id
  for (const b of doc.breakers) {
    dup(b, 'breaker');
    const panel = doc.panels.find(p => p.id === b.panelId);
    if (!panel) { errs.push(`Breaker ${b.id} has unknown panel`); continue; }
    for (const s of slotsOf(b)) {
      if (s < 1 || s > panel.spaces) errs.push(`Breaker ${b.label || b.id} slot ${s} is outside ${panel.name} (1–${panel.spaces})`);
      const key = `${b.panelId}:${s}`;
      if (used.has(key)) errs.push(`Slot ${s} in ${panel.name} is used by two breakers`);
      used.set(key, b.id);
    }
  }
  doc.panels.forEach(p => {
    if (p.fedFromBreakerId && !breakerIds.has(p.fedFromBreakerId)) errs.push(`Panel ${p.name} is fed from an unknown breaker`);
  });
  doc.devices.forEach(d => {
    dup(d, 'device');
    if (!DEVICE_TYPES.includes(d.type)) errs.push(`Device ${d.id} has unknown type ${d.type}`);
    if (d.breakerId && !breakerIds.has(d.breakerId)) errs.push(`Device ${d.id} is on an unknown breaker`);
  });
  const switchSeen = new Set();
  doc.switchGroups.forEach(g => {
    dup(g, 'switch group');
    g.switchIds.forEach(s => { if (switchSeen.has(s)) errs.push(`Switch ${s} is in more than one group`); switchSeen.add(s); });
  });
  return errs;
}
