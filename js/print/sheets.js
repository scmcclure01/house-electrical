// Builders for printable sheets. Each returns HTML for one .sheet element sized in inches.
// Fixed sheets (floor plans, panel schedules) fill exactly one page; "flow" sheets (circuit table,
// breaker labels) may run onto several printed pages — the browser paginates them.

import { printFloorSVG, houseBounds } from '../render/plan.js';
import { symbolMarkup } from '../render/symbols.js';
import {
  DEVICE_NAMES, NUM_PREFIX, LOW_VOLTAGE, slotsOf, slotRow, slotSide, breakerCode, breakerName,
  deviceCode, fedPanel, circuitStats, unassignedDevices, areaAt,
} from '../model.js';

export const PAPER = {
  letter: { w: 11, h: 8.5, name: 'Letter' },
  tabloid: { w: 17, h: 11, name: '11 × 17' },
};
export const MARGIN = 0.4; // inches

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const byPanelSlot = doc => {
  const order = new Map(doc.panels.map((p, i) => [p.id, i]));
  return [...doc.breakers].sort((a, b) => order.get(a.panelId) - order.get(b.panelId) || a.position - b.position);
};
const byNum = (a, b) => (a.num ?? '').localeCompare(b.num ?? '', undefined, { numeric: true });

// Standard architectural scales, inches of paper per foot, largest first.
const SCALES = [[0.5, '1/2"'], [0.375, '3/8"'], [0.25, '1/4"'], [0.1875, '3/16"'], [0.125, '1/8"'], [0.09375, '3/32"'], [0.0625, '1/16"']];

function titleBlock(doc, title, sub, extra = '') {
  return `<div class="title-block">
    <div class="tb-house">${esc(doc.meta.name || 'House')}</div>
    <div class="tb-title">${esc(title)}</div>
    ${sub ? `<div class="tb-sub">${sub}</div>` : ''}
    ${extra}
    <div class="tb-date">Printed ${today()}</div>
  </div>`;
}

// ---------- floor plan ----------
function legendSymbol(d) {
  return `<svg width="26" height="22" viewBox="-13 -11 26 22" class="print-plan"><g class="device">${symbolMarkup({ rot: 0, ...d })}</g></svg>`;
}

function floorLegend(doc, floorId) {
  const devs = doc.devices.filter(d => d.floorId === floorId);
  const variants = new Map();
  const add = (key, d, label) => { if (!variants.has(key)) variants.set(key, { d, label }); };
  for (const d of devs) {
    if (d.type === 'light') add(`light-${d.lightKind}`, { type: 'light', lightKind: d.lightKind }, { ceiling: 'Ceiling light', wall: 'Wall light', recessed: 'Recessed light', fan: 'Ceiling fan' }[d.lightKind]);
    else if (d.type === 'switch') add(`switch-${d.switchKind}`, { type: 'switch', switchKind: d.switchKind }, d.switchKind === '3way' ? '3-way switch' : 'Switch');
    else add(d.type, { type: d.type }, DEVICE_NAMES[d.type]);
  }
  const order = ['outlet', 'receptacle240', 'hardwired', 'switch-single', 'switch-3way', 'light-ceiling', 'light-recessed', 'light-wall', 'light-fan', 'cable', 'ethernet'];
  const rows = [...variants].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([, v]) => `<div class="lg-row">${legendSymbol(v.d)}<span>${esc(v.label)}</span></div>`).join('');
  const flags = devs.some(d => d.gfci || d.afci) ? '<div class="lg-note">GFI = GFCI outlet · AF = AFCI outlet</div>' : '';

  const ids = new Set(devs.map(d => d.breakerId).filter(Boolean));
  const circuits = byPanelSlot(doc).filter(b => ids.has(b.id)).map(b =>
    `<div class="lg-circuit"><span class="sw" style="background:${b.color}"></span><b>${esc(breakerCode(doc, b))}</b> ${esc(b.label || 'unlabeled')} <span class="muted">${b.amps}A</span></div>`).join('');
  const WORDS = { outlet: 'outlet', receptacle240: '240V', hardwired: 'hardwired', switch: 'switch', light: 'light/fan', cable: 'cable TV', ethernet: 'data' };
  const letters = Object.entries(NUM_PREFIX).map(([t, p]) => `${p} ${WORDS[t]}`).join(' · ');
  return `<div class="legend">
    <h4>Symbols</h4>${rows || '<div class="muted">No devices on this floor.</div>'}${flags}
    <div class="lg-row">${legendSymbol({ type: 'outlet' })}<span>Circuit verified</span></div>
    <div class="lg-row lg-unverified">${legendSymbol({ type: 'outlet' })}<span>Not yet verified</span></div>
    ${circuits ? `<h4>Circuits on this floor</h4><div class="lg-circuits">${circuits}</div>` : ''}
    <h4>Device codes</h4>
    <div class="lg-note"><b>M7-R103</b> = panel M, breaker 7 · outlet (R) · floor 1 · #03. Unassigned devices show only R103.<br>${letters}</div>
  </div>`;
}

// Graphic scale bar: a round number of feet about 1–1.6" long, in alternating black/white blocks.
function scaleBar(k) {
  const inPerFt = (12 * k) / 96;
  const ft = [1, 2, 4, 5, 10, 20, 25, 50, 100].find(n => n * inPerFt >= 1) ?? 100;
  const len = ft * inPerFt, seg = len / 4;
  const blocks = [0, 1, 2, 3].map(i => `<rect x="${(i * seg).toFixed(3)}in" y="0" width="${seg.toFixed(3)}in" height="6" fill="${i % 2 ? '#fff' : '#111'}" stroke="#111" stroke-width="1"/>`).join('');
  return `<svg class="scale-bar" width="${(len + 0.4).toFixed(3)}in" height="20" overflow="visible">${blocks}
    <text x="0" y="17" font-size="8">0</text><text x="${len.toFixed(3)}in" y="17" font-size="8" text-anchor="middle">${ft}'</text></svg>`;
}

export function floorSheet(doc, floor, paper, opts) {
  const cw = paper.w - 2 * MARGIN, ch = paper.h - 2 * MARGIN;
  const side = paper.w > 12 ? 3.1 : 2.25;
  const boxW = cw - side - 0.2, boxH = ch;
  const hb = houseBounds(doc) ?? { minX: 0, minY: 0, maxX: 480, maxY: 360 };
  const pad = 30;
  const worldW = hb.maxX - hb.minX + pad * 2, worldH = hb.maxY - hb.minY + pad * 2;
  // k = paper CSS px per world inch. 'standard' uses the largest architectural scale that fits;
  // 'fit' (default) fills the page and prints a scale bar instead.
  const fitK = 96 * Math.min(boxW / worldW, boxH / worldH);
  const std = SCALES.find(([s]) => (worldW * s) / 12 <= boxW && (worldH * s) / 12 <= boxH);
  let k, scaleLabel;
  if (opts.planScale === 'standard' && std) { k = (96 * std[0]) / 12; scaleLabel = `${std[1]} = 1'-0"`; }
  else { k = fitK; scaleLabel = `fitted to page (about 1" = ${((96 / k) / 12).toFixed(1)}')`; }
  // Frame the whole box around the house's centre so both floors line up sheet to sheet.
  const cx = (hb.minX + hb.maxX) / 2, cy = (hb.minY + hb.maxY) / 2;
  const ww = (boxW * 96) / k, wh = (boxH * 96) / k;
  const rect = { minX: cx - ww / 2, minY: cy - wh / 2, maxX: cx + ww / 2, maxY: cy + wh / 2 };
  const svg = printFloorSVG(doc, floor.id, rect, k, { tagMode: opts.tagMode, dims: opts.dims });
  return `<section class="sheet sheet-floor">
    <div class="floor-plan">${svg}</div>
    <aside class="floor-side" style="width:${side}in">
      ${floorLegend(doc, floor.id)}
      ${titleBlock(doc, `Electrical plan — ${floor.name}`, `Scale ${scaleLabel}`, scaleBar(k))}
    </aside>
  </section>`;
}

// ---------- circuit table ----------
const COUNT_COLS = ['outlet', 'receptacle240', 'hardwired', 'switch', 'light'];

export function circuitTableSheet(doc) {
  const stats = circuitStats(doc);
  const rows = byPanelSlot(doc).map(b => {
    const st = stats.get(b.id);
    const feeds = fedPanel(doc, b.id);
    const devs = doc.devices.filter(d => d.breakerId === b.id).sort(byNum);
    const codes = devs.map(d => `<span class="${d.verified ? '' : 'unv'}">${esc(d.num)}</span>`).join(' ');
    return `<tr>
      <td class="nowrap"><span class="sw" style="background:${b.color}"></span><b>${esc(breakerCode(doc, b))}</b></td>
      <td class="c">${slotsOf(b).join('/')}</td>
      <td class="c">${b.poles}</td>
      <td class="c">${b.amps}</td>
      <td>${b.type && b.type !== 'standard' ? esc({ gfci: 'GFCI', afci: 'AFCI', dual: 'AFCI/GFCI' }[b.type]) : ''}</td>
      <td><b>${esc(b.label || '—')}</b>${feeds ? `<div class="muted">Feeds ${esc(feeds.name)} panel (${esc(feeds.code)})</div>` : ''}${b.notes ? `<div class="muted">${esc(b.notes)}</div>` : ''}</td>
      <td>${feeds ? '' : esc(st.rooms.join(', '))}</td>
      ${COUNT_COLS.map(t => `<td class="c">${feeds ? '' : st.byType[t] || ''}</td>`).join('')}
      <td class="c nowrap">${feeds || !st.total ? '' : `${st.verified}/${st.total}`}</td>
      <td class="codes">${codes}</td>
    </tr>`;
  }).join('');
  const panelInfo = doc.panels.map(p => {
    const feeder = p.fedFromBreakerId && doc.breakers.find(b => b.id === p.fedFromBreakerId);
    return `<b>${esc(p.code)}</b> = ${esc(p.name)} panel${feeder ? ` (fed from ${esc(breakerName(doc, feeder))})` : ''}`;
  }).join(' · ');
  const un = unassignedDevices(doc).sort(byNum);
  const lowV = doc.devices.filter(d => LOW_VOLTAGE.has(d.type)).sort(byNum);
  return `<section class="sheet flow sheet-table">
    <div class="sheet-head"><h2>Circuit table</h2><div class="muted">${esc(doc.meta.name || 'House')} · printed ${today()} · ${panelInfo}</div></div>
    <table class="ctable">
      <thead><tr>
        <th>Breaker</th><th>Slot</th><th>Poles</th><th>Amps</th><th>Type</th><th>Description</th><th>Rooms served</th>
        <th title="Outlets">R</th><th title="240V receptacles">V</th><th title="Hardwired equipment">E</th><th title="Switches">S</th><th title="Lights">L</th>
        <th>Verified</th><th>Devices</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="14" class="muted">No breakers yet.</td></tr>'}</tbody>
    </table>
    <p class="muted small">R outlets · V 240V receptacles · E hardwired equipment · S switches · L lights/fans. Device numbers in grey italics are not yet verified by testing.
      Full device code = breaker + number, e.g. ${rows ? 'M7-R103' : ''}.</p>
    ${un.length ? `<h3>Not on a circuit (${un.length})</h3><p class="codes">${un.map(d => `<span>${esc(d.num)}</span> <span class="muted">${esc(DEVICE_NAMES[d.type].toLowerCase())}${d.label ? `, ${esc(d.label)}` : ''} — ${esc(areaAt(doc, d.floorId, d)?.name ?? 'Exterior')}</span>`).join(' · ')}</p>` : ''}
    ${lowV.length ? `<h3>Low-voltage drops (${lowV.length})</h3>
      <table class="ctable lv"><thead><tr><th>Number</th><th>Type</th><th>Port / jack</th><th>Label</th><th>Room</th></tr></thead><tbody>
      ${lowV.map(d => `<tr><td><b>${esc(d.num)}</b></td><td>${d.type === 'cable' ? 'Cable TV' : 'Ethernet'}</td><td>${esc(d.port)}</td><td>${esc(d.label)}</td><td>${esc(areaAt(doc, d.floorId, d)?.name ?? 'Exterior')}</td></tr>`).join('')}
      </tbody></table>` : ''}
  </section>`;
}

// ---------- panel door schedule ----------
export function panelScheduleSheet(doc, panel, paper) {
  const ch = paper.h - 2 * MARGIN;
  const rows = Math.ceil(panel.spaces / 2);
  const headH = 1.25;
  const rowH = Math.min(0.6, (ch - headH - 0.35) / rows);
  const stats = circuitStats(doc);
  const at = new Map(); // "row:side" -> breaker (only on its first row)
  const covered = new Set();
  for (const b of doc.breakers.filter(x => x.panelId === panel.id)) {
    at.set(`${slotRow(b.position)}:${slotSide(b.position)}`, b);
    if (b.poles === 2) covered.add(`${slotRow(b.position) + 1}:${slotSide(b.position)}`);
  }
  const fontPx = Math.max(9, Math.min(14, rowH * 96 * 0.3));
  const cell = (row, side) => {
    const key = `${row}:${side}`;
    if (covered.has(key)) return '';
    const b = at.get(key);
    if (!b) {
      const n = side === 'left' ? row * 2 - 1 : row * 2;
      if (n > panel.spaces) return side === 'left' ? '<td class="num"></td><td></td><td></td>' : '<td></td><td></td><td class="num"></td>';
      return side === 'left' ? `<td class="num">${n}</td><td class="spare">—</td><td></td>` : `<td></td><td class="spare">—</td><td class="num">${n}</td>`;
    }
    const span = b.poles === 2 ? ' rowspan="2"' : '';
    const nums = slotsOf(b).join('<br>');
    const feeds = fedPanel(doc, b.id);
    const st = stats.get(b.id);
    const badge = b.type && b.type !== 'standard' ? `<span class="bt">${{ gfci: 'GFCI', afci: 'AFCI', dual: 'DF' }[b.type]}</span>` : '';
    const desc = `<div class="desc"><b>${esc(b.label || 'unlabeled')}</b> ${badge}</div>
      <div class="rooms">${feeds ? `→ ${esc(feeds.name)} panel` : esc(st.rooms.join(', '))}</div>`;
    const amps = `<td class="amps"${span}>${b.amps}${b.poles === 2 ? '<br><small>2P</small>' : ''}</td>`;
    const style = `style="border-${side === 'left' ? 'left' : 'right'}: 6px solid ${b.color}"`;
    return side === 'left'
      ? `<td class="num"${span}>${nums}</td><td class="circ"${span} ${style}>${desc}</td>${amps}`
      : `${amps}<td class="circ"${span} ${style}>${desc}</td><td class="num"${span}>${nums}</td>`;
  };
  let body = '';
  for (let r = 1; r <= rows; r++) body += `<tr style="height:${rowH.toFixed(3)}in">${cell(r, 'left')}${cell(r, 'right')}</tr>`;
  const feeder = panel.fedFromBreakerId && doc.breakers.find(b => b.id === panel.fedFromBreakerId);
  const info = [
    panel.brand || panel.model ? `${esc(panel.brand)} ${esc(panel.model)}`.trim() : '',
    panel.mainAmps ? `${panel.mainAmps}A main` : '',
    panel.busAmps ? `${panel.busAmps}A bus` : '',
    `${panel.spaces} spaces`,
    feeder ? `Fed from ${esc(breakerName(doc, feeder))} (${feeder.amps}A)` : 'Main service panel',
    panel.location ? esc(panel.location) : '',
  ].filter(Boolean).join(' · ');
  return `<section class="sheet sheet-schedule" style="font-size:${fontPx.toFixed(1)}px">
    <div class="sched-head">
      <div><h2><span class="code">${esc(panel.code)}</span> ${esc(panel.name)} panel</h2><div class="muted">${info}</div></div>
      <div class="muted right">${esc(doc.meta.name || '')}<br>Printed ${today()}</div>
    </div>
    <table class="sched">
      <colgroup><col class="cn"><col><col class="ca"><col class="ca"><col><col class="cn"></colgroup>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

// ---------- breaker number labels ----------
export function labelsSheet(doc, opts) {
  const size = { small: [0.75, 0.5], medium: [1, 0.625] }[opts.labelSize] ?? [0.75, 0.5];
  const groups = doc.panels.map(p => {
    const labels = [];
    for (let n = 1; n <= p.spaces; n++) labels.push(`<div class="blabel">${opts.labelPrefix ? esc(p.code) : ''}${n}</div>`);
    return `<h3>${esc(p.name)} panel <span class="muted">· ${p.spaces} labels${opts.labelPrefix ? ` · ${esc(p.code)}1–${esc(p.code)}${p.spaces}` : ''}</span></h3>
      <div class="blabels" style="--lw:${size[0]}in; --lh:${size[1]}in">${labels.join('')}</div>`;
  }).join('');
  return `<section class="sheet flow sheet-labels">
    <div class="sheet-head"><h2>Breaker number labels</h2>
      <div class="muted">Cut along the dashed lines and stick each number beside its slot: odd numbers down the left side, even down the right, starting at the top.</div></div>
    ${groups}
  </section>`;
}

