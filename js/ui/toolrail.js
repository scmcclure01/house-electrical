// Left tool rail, the tool-options strip, and the zoom/dimension controls on the canvas.

import { view, setView, onViewChange } from './viewstate.js';
import { TOOLS, setTool } from '../tools/index.js';
import { zoomBy, fit } from '../render/plan.js';
import { AREA_KINDS } from '../model.js';

const ICONS = {
  select: '<path d="M6 3l12 9-5.5 1.2L10 19z" fill="currentColor"/>',
  extWall: '<rect x="3" y="9.5" width="18" height="5" fill="currentColor"/>',
  intWall: '<rect x="3" y="11" width="18" height="2.2" fill="currentColor"/>',
  area: '<path d="M4 5h9l7 7v7H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2"/>',
  stair: '<path d="M3 20h4v-4h4v-4h4V8h4V4h2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  door: '<path d="M5 20V6M5 6a14 14 0 0 1 14 14M3 20h18" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  window: '<path d="M3 9h18v6H3zM3 12h18" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  opening: '<path d="M2 12h6M16 12h6M8 8v8M16 8v8" fill="none" stroke="currentColor" stroke-width="2"/>',
};

const GROUPS = [['select'], ['extWall', 'intWall', 'area', 'stair'], ['door', 'window', 'opening']];

const rail = document.getElementById('tool-rail');
const opts = document.getElementById('tool-options');

function buildRail() {
  rail.innerHTML = '';
  GROUPS.forEach((group, gi) => {
    if (gi) rail.append(Object.assign(document.createElement('hr'), { className: 'rail-sep' }));
    for (const name of group) {
      const t = TOOLS[name];
      const b = document.createElement('button');
      b.className = 'rail-btn';
      b.dataset.tool = name;
      b.title = `${t.label} (${t.shortcut.toUpperCase()})`;
      b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22">${ICONS[name]}</svg>`;
      b.addEventListener('click', () => setTool(name));
      rail.append(b);
    }
  });
}

function renderRail() {
  rail.querySelectorAll('.rail-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === view.tool));
  if (view.tool === 'area') {
    opts.hidden = false;
    opts.innerHTML = `<label>Area type <select id="area-kind">${AREA_KINDS.filter(k => k !== 'stair')
      .map(k => `<option value="${k}"${k === view.areaKind ? ' selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select></label>`;
    opts.querySelector('#area-kind').addEventListener('change', e => setView({ areaKind: e.target.value }));
  } else {
    opts.hidden = true;
    opts.innerHTML = '';
  }
}

buildRail();
renderRail();
onViewChange(patch => { if ('tool' in patch) renderRail(); });

document.getElementById('zoom-in').addEventListener('click', () => zoomBy(1.25));
document.getElementById('zoom-out').addEventListener('click', () => zoomBy(0.8));
document.getElementById('zoom-fit').addEventListener('click', () => fit());
document.getElementById('show-dims').addEventListener('change', e => setView({ showDims: e.target.checked }));
