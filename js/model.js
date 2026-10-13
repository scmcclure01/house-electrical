// House document: schema version, factory, migration, validation.
// All lengths are whole inches. All floors share one coordinate origin.

import { pointInPolygon, polygonArea } from './geometry.js';

export const SCHEMA_VERSION = 1;

export const DEVICE_TYPES = ['outlet', 'receptacle240', 'hardwired', 'switch', 'light', 'cable', 'ethernet'];
export const DEVICE_NAMES = {
  outlet: 'Outlet', receptacle240: '240V receptacle', hardwired: 'Hardwired equipment',
  switch: 'Switch', light: 'Light', cable: 'Cable TV drop', ethernet: 'Ethernet drop',
};
export const LIGHT_KINDS = ['ceiling', 'wall', 'recessed', 'fan'];
export const SWITCH_KINDS = ['single', '3way'];
export const LOW_VOLTAGE = new Set(['cable', 'ethernet']);

// Ensure a device has exactly the per-type fields its type uses (called on create and type change).
export function normalizeDevice(d) {
  d.label ??= '';
  d.notes ??= '';
  d.breakerId ??= null;
  d.verified ??= false;
  d.wallId ??= null;
  d.rot ??= 0;
  const keep = { outlet: ['gfci', 'afci'], cable: ['port'], ethernet: ['port'], switch: ['switchKind'], light: ['lightKind'] }[d.type] ?? [];
  for (const k of ['gfci', 'afci', 'port', 'switchKind', 'lightKind']) if (!keep.includes(k)) delete d[k];
  if (d.type === 'outlet') { d.gfci ??= false; d.afci ??= false; }
  if (LOW_VOLTAGE.has(d.type)) d.port ??= '';
  if (d.type === 'switch') d.switchKind ??= 'single';
  if (d.type === 'light') d.lightKind ??= 'ceiling';
  // Low-voltage drops aren't on a breaker.
  if (LOW_VOLTAGE.has(d.type)) d.breakerId = null;
  return d;
}

// Devices that mount on a wall face (everything except ceiling-type lights).
export function isWallMounted(type, lightKind) {
  return type !== 'light' || lightKind === 'wall';
}
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

// ---------- lookup & cascading delete ----------
const COLLECTIONS = { wall: 'walls', opening: 'openings', area: 'areas', device: 'devices', breaker: 'breakers', group: 'switchGroups' };

// Returns {kind, obj} for any id in the plan collections, or null.
export function findById(doc, objId) {
  for (const [kind, key] of Object.entries(COLLECTIONS)) {
    const obj = doc[key].find(o => o.id === objId);
    if (obj) return { kind, obj };
  }
  return null;
}

// Delete objects and everything that depends on them.
export function deleteIds(doc, ids) {
  const del = new Set(ids);
  for (const o of doc.openings) if (del.has(o.wallId)) del.add(o.id);
  for (const key of Object.values(COLLECTIONS)) doc[key] = doc[key].filter(o => !del.has(o.id));
  for (const d of doc.devices) {
    if (d.breakerId && del.has(d.breakerId)) d.breakerId = null;
    if (d.wallId && del.has(d.wallId)) d.wallId = null;
  }
  for (const p of doc.panels) if (p.fedFromBreakerId && del.has(p.fedFromBreakerId)) p.fedFromBreakerId = null;
  for (const g of doc.switchGroups) {
    g.switchIds = g.switchIds.filter(x => !del.has(x));
    g.loadIds = g.loadIds.filter(x => !del.has(x));
  }
  doc.switchGroups = doc.switchGroups.filter(g => g.switchIds.length > 0);
}

// The smallest area on a floor containing point p (so a closet inside a bedroom wins), or null.
export function areaAt(doc, floorId, p) {
  let best = null, bestA = Infinity;
  for (const a of doc.areas) {
    if (a.floorId !== floorId || !pointInPolygon(p, a.points)) continue;
    const A = Math.abs(polygonArea(a.points));
    if (A < bestA) { best = a; bestA = A; }
  }
  return best;
}

export function wallLength(w) { return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y); }

// ---------- panels & circuits ----------
// Distinct, saturated colors that read well as thin strokes on white. New breakers take the
// first color not already used.
export const PALETTE = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#1aa3a3', '#f032e6', '#9a6324',
  '#7a7a00', '#000075', '#d4a000', '#1b9e77', '#d95f02', '#7570b3', '#c51b7d', '#66a61e',
  '#2c7fb8', '#8c510a', '#01665e', '#b2182b', '#5e3c99', '#e7298a', '#4d4d4d', '#a6761d',
];

export function nextColor(doc) {
  const used = new Set(doc.breakers.map(b => b.color));
  return PALETTE.find(c => !used.has(c)) ?? PALETTE[doc.breakers.length % PALETTE.length];
}

// Problem with putting a breaker (position, poles) in a panel, or null if it fits.
export function slotProblem(doc, panelId, position, poles, ignoreId = null) {
  const panel = doc.panels.find(p => p.id === panelId);
  const want = slotsOf({ position, poles });
  for (const s of want) if (s < 1 || s > panel.spaces) return `Slot ${s} is outside ${panel.name} (1–${panel.spaces})`;
  for (const b of doc.breakers) {
    if (b.panelId !== panelId || b.id === ignoreId) continue;
    const clash = slotsOf(b).find(s => want.includes(s));
    if (clash) return `Slot ${clash} is already used by ${breakerName(doc, b)}${b.label ? ` (${b.label})` : ''}`;
  }
  return null;
}

// "Main 7" or "Main 7/9" for a 2-pole breaker.
export function breakerName(doc, b) {
  const panel = doc.panels.find(p => p.id === b.panelId);
  return `${panel?.name ?? '?'} ${slotsOf(b).join('/')}`;
}

// "Main 7 · Kitchen counter · 20A"
export function breakerTitle(doc, b) {
  return [breakerName(doc, b), b.label || 'unlabeled', `${b.amps}A`].join(' · ');
}

// The panel a breaker feeds (subpanel feeder), or undefined.
export function fedPanel(doc, breakerId) {
  return doc.panels.find(p => p.fedFromBreakerId === breakerId);
}

// Breakers devices can be assigned to (everything except subpanel feeders), sorted by panel then slot.
export function assignableBreakers(doc) {
  const order = new Map(doc.panels.map((p, i) => [p.id, i]));
  return doc.breakers.filter(b => !fedPanel(doc, b.id))
    .sort((a, b) => order.get(a.panelId) - order.get(b.panelId) || a.position - b.position);
}

// Per-breaker device statistics: {total, verified, byType: {type: n}, rooms: [names]}.
export function circuitStats(doc) {
  const stats = new Map(doc.breakers.map(b => [b.id, { total: 0, verified: 0, byType: {}, rooms: new Set() }]));
  for (const d of doc.devices) {
    const s = d.breakerId && stats.get(d.breakerId);
    if (!s) continue;
    s.total++;
    if (d.verified) s.verified++;
    s.byType[d.type] = (s.byType[d.type] ?? 0) + 1;
    s.rooms.add(areaAt(doc, d.floorId, d)?.name ?? 'Exterior');
  }
  for (const s of stats.values()) s.rooms = [...s.rooms].sort();
  return stats;
}

// Devices that should be on a circuit but aren't (low-voltage drops don't count).
export function unassignedDevices(doc) {
  return doc.devices.filter(d => !d.breakerId && !LOW_VOLTAGE.has(d.type));
}
