// Where each lesson sits on the skill tree. Columns are the stages (1–9, left to right is
// easy to hard), rows are units, lessons in one cell stack. Pure, so it can be checked in node.
export const NW = 176, NH = 76, GX = 36, GY = 10, HEAD = 40, LANE = 24, PAD = 12;
export const tierOf = l => Math.min(9, Math.max(1, Math.floor((l.level ?? 1) + 1e-9)));

/** lessons (in unit then lesson order) -> {nodes: id -> {x, y}, lanes, cols, w, h} */
export function layout(lessons) {
  const tiers = lessons.map(tierOf), lo = Math.min(...tiers), hi = Math.max(...tiers);
  const nodes = {}, lanes = [];
  let y = HEAD;
  for (const unit of [...new Set(lessons.map(l => l.unit_id))]) {
    const ls = lessons.filter(l => l.unit_id === unit).sort((a, b) => (a.level ?? 1) - (b.level ?? 1) || a.sort - b.sort);
    const fill = {};
    for (const l of ls) {
      const t = tierOf(l), k = fill[t] = (fill[t] ?? -1) + 1;
      nodes[l.id] = { x: PAD + (t - lo) * (NW + GX), y: y + LANE + k * (NH + GY) };
    }
    const rows = Math.max(...Object.values(fill)) + 1, h = LANE + rows * (NH + GY) + 4;
    lanes.push({ unit, title: ls[0].unit, y, h });
    y += h;
  }
  const cols = Array.from({ length: hi - lo + 1 }, (_, i) => ({ tier: lo + i, x: PAD + i * (NW + GX) }));
  return { nodes, lanes, cols, w: PAD * 2 + cols.length * (NW + GX) - GX, h: y };
}

/** An edge from a prerequisite's box to the lesson's: right to left, or down/up inside a column. */
export function edge(a, b) {
  if (b.x > a.x) {
    const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, dx = Math.max(24, (x2 - x1) / 2);
    return `M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
  }
  const down = b.y >= a.y, x1 = a.x + NW / 2, y1 = down ? a.y + NH : a.y, x2 = b.x + NW / 2, y2 = down ? b.y : b.y + NH;
  const dy = Math.max(24, Math.abs(y2 - y1) / 2) * (down ? 1 : -1);
  return `M${x1} ${y1}C${x1} ${y1 + dy} ${x2} ${y2 - dy} ${x2} ${y2}`;
}
