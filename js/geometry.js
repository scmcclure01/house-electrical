// 2D helpers. Points are {x, y} in inches; y grows downward (screen/SVG convention).

export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const same = (a, b) => a.x === b.x && a.y === b.y;
export const len = v => Math.hypot(v.x, v.y);
export const unit = v => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l }; };
export const normal = u => ({ x: -u.y, y: u.x });
export const cross = (a, b) => a.x * b.y - a.y * b.x;

export function snapToGrid(p, grid) {
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

// Constrain `p` so the segment from `from` is at a multiple of 45°, with its length snapped to `grid`.
export function snapAngle(from, p, grid) {
  const v = sub(p, from);
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(v.y, v.x) / step) * step;
  const dir = { x: Math.round(Math.cos(ang) * 1e6) / 1e6, y: Math.round(Math.sin(ang) * 1e6) / 1e6 };
  let l = dir.x * v.x + dir.y * v.y;
  if (grid) l = Math.round(l / grid) * grid;
  return roundPt(add(from, scale(dir, l)));
}

// Unit direction from `from` toward `p`, snapped to the nearest 45°.
export function snappedDirection(from, p) {
  const v = sub(p, from);
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(v.y, v.x) / step) * step;
  return { x: Math.cos(ang), y: Math.sin(ang) };
}

export const roundPt = p => ({ x: Math.round(p.x), y: Math.round(p.y) });

// Project p onto segment ab. Returns {t (0..1 clamped), along (inches from a), pt, d (distance)}.
export function projectOnSegment(p, a, b) {
  const ab = sub(b, a);
  const L2 = ab.x * ab.x + ab.y * ab.y || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / L2));
  const pt = add(a, scale(ab, t));
  return { t, along: t * Math.sqrt(L2), pt, d: dist(p, pt) };
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Signed area (positive = clockwise on screen). Use Math.abs for size.
export function polygonArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return s / 2;
}

export function centroid(pts) {
  const A = polygonArea(pts);
  if (Math.abs(A) < 1e-9) return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  let cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    cx += (pts[j].x + pts[i].x) * f;
    cy += (pts[j].y + pts[i].y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

// A point guaranteed inside the polygon, for labels. Uses the centroid when it's inside (rectangles, most rooms);
// otherwise the middle of the widest horizontal run through the polygon at the centroid's height.
export function labelPoint(pts) {
  const c = centroid(pts);
  if (pointInPolygon(c, pts)) return c;
  const xs = [];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > c.y) !== (b.y > c.y)) xs.push(a.x + ((c.y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  xs.sort((m, n) => m - n);
  let best = null;
  for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
  return best ? { x: (best[0] + best[1]) / 2, y: c.y } : c;
}

export function bounds(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function inRect(p, r) { return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY; }
