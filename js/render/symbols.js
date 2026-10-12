// Electrical plan symbols (ANSI/IEEE-style). Each symbol is drawn in a local frame centred on
// (0,0) with nominal radius R inches; +x points away from the wall the device is mounted on.
// Used by the plan view, the tool rail icons and (Phase 5) the printed legend.

export const R = 6;

const f = n => Math.round(n * 100) / 100;

// Unit vector the device faces (away from its wall).
export function facing(d) {
  const a = ((d.rot ?? 0) * Math.PI) / 180;
  return { x: Math.cos(a), y: Math.sin(a) };
}

// Where the symbol's centre is drawn. Wall devices store the point on the wall face and are
// drawn one radius out from it; free devices store their centre. s = on-screen scale factor.
export function deviceCenter(d, s = 1) {
  if (!d.wallId) return { x: d.x, y: d.y };
  const u = facing(d);
  return { x: d.x + u.x * R * s, y: d.y + u.y * R * s };
}

// Parts that rotate with the device.
function body(d) {
  switch (d.type) {
    case 'outlet':
      return `<circle r="${R}" class="sym"/><line x1="-8.5" y1="-2.2" x2="8.5" y2="-2.2" class="sym-line"/><line x1="-8.5" y1="2.2" x2="8.5" y2="2.2" class="sym-line"/>`;
    case 'receptacle240':
      return `<circle r="${R}" class="sym"/>` + [-3, 0, 3].map(y => `<line x1="-8.5" y1="${y}" x2="8.5" y2="${y}" class="sym-line"/>`).join('');
    case 'hardwired':
      return `<rect x="-${R}" y="-${R}" width="${R * 2}" height="${R * 2}" class="sym"/><line x1="-${R}" y1="${R}" x2="${R}" y2="-${R}" class="sym-line"/>`;
    case 'switch':
      return `<circle r="${R}" class="sym sym-switch"/>`;
    case 'light':
      if (d.lightKind === 'wall') return `<path d="M-${R} -8 A8 8 0 0 1 -${R} 8 Z" class="sym"/><line x1="-${R}" y1="0" x2="1.5" y2="0" class="sym-line"/>`;
      if (d.lightKind === 'recessed') return `<circle r="${R}" class="sym"/><circle r="3.2" class="sym sym-inner"/>`;
      if (d.lightKind === 'fan') {
        return `<circle r="${R}" class="sym"/>` + [90, 210, 330].map(a => {
          const r = (a * Math.PI) / 180;
          return `<path d="M0 0 Q${f(Math.cos(r + 0.6) * 4)} ${f(Math.sin(r + 0.6) * 4)} ${f(Math.cos(r) * 5.6)} ${f(Math.sin(r) * 5.6)}" class="sym-line"/>`;
        }).join('') + '<circle r="1.2" class="sym-dot"/>';
      }
      return `<circle r="${R}" class="sym"/><line x1="-4.2" y1="-4.2" x2="4.2" y2="4.2" class="sym-line"/><line x1="-4.2" y1="4.2" x2="4.2" y2="-4.2" class="sym-line"/>`;
    case 'cable':
      return `<polygon points="-${R},-${R} -${R},${R} ${R},0" class="sym"/>`;
    case 'ethernet':
      return `<polygon points="-${R},-${R} -${R},${R} ${R},0" class="sym sym-filled"/>`;
    default:
      return `<circle r="${R}" class="sym"/>`;
  }
}

// Parts that stay upright (letters).
function upright(d) {
  if (d.type !== 'switch') return '';
  return d.switchKind === '3way'
    ? '<text class="sym-text" x="-1.2" y="3.6" font-size="10">S<tspan font-size="6.5" dy="1.5">3</tspan></text>'
    : '<text class="sym-text" y="3.6" font-size="10">S</text>';
}

// Full symbol at the origin (local frame), for use inside a positioned <g>.
export function symbolMarkup(d) {
  return `<g transform="rotate(${f(d.rot ?? 0)})">${body(d)}</g>${upright(d)}`;
}

// Short text tags shown next to the symbol.
export function deviceTags(d) {
  const tags = [];
  if (d.type === 'outlet') { if (d.gfci) tags.push('GFI'); if (d.afci) tags.push('AF'); }
  if (d.type === 'receptacle240') tags.push('240V');
  if (d.type === 'cable') tags.push(d.port ? `TV ${d.port}` : 'TV');
  if (d.type === 'ethernet' && d.port) tags.push(d.port);
  if (d.label) tags.push(d.label);
  return tags;
}
