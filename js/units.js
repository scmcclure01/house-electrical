// Feet-inch parsing and formatting. Internal unit is whole inches.

// Accepts: 12'6"  12'6  12' 6  12-6  12 6  12'  150"  150  12.5'
// Bare single number = inches. Returns null if unparseable.
export function parseLength(text) {
  const s = String(text).trim().replace(/[″]/g, '"').replace(/[′]/g, "'");
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:-?\s*(\d+(?:\.\d+)?)\s*"?)?$/))) {
    return Math.round(parseFloat(m[1]) * 12 + (m[2] ? parseFloat(m[2]) : 0));
  }
  if ((m = s.match(/^(\d+)\s*[- ]\s*(\d+(?:\.\d+)?)\s*"?$/))) {
    return Math.round(parseInt(m[1], 10) * 12 + parseFloat(m[2]));
  }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*"?$/))) return Math.round(parseFloat(m[1]));
  return null;
}

export function formatLength(inches) {
  const neg = inches < 0;
  const total = Math.round(Math.abs(inches));
  const ft = Math.floor(total / 12);
  const inch = total % 12;
  const out = ft === 0 ? `${inch}"` : inch === 0 ? `${ft}'` : `${ft}' ${inch}"`;
  return neg ? `-${out}` : out;
}
