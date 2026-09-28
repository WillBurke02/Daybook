// Rows for panels you make yourself: what kind each column holds, and one source
// joined onto another. No page in here, so node can check it.

const DATE = /^\d{4}-\d\d(-\d\d)?$/;

/** 'number', 'date', 'text' or 'empty', from the values the rows hold. */
export function kindOf(rows, col) {
  const vs = rows.map(r => r[col]).filter(v => v != null && v !== '');
  if (!vs.length) return 'empty';
  if (vs.every(v => typeof v === 'number')) return 'number';
  if (vs.every(v => DATE.test(v))) return 'date';
  return 'text';
}

/** The name a joined source's columns take: v_spend's amount is spend_amount. */
export const prefixOf = name => name.replace(/^v_/, '') + '_';

/** Every row of `a`, with the rows of `b` that match it on a[ka] = b[kb] added up
 *  (numbers summed, the first of anything else) under prefixed names, and how many
 *  matched as <prefix>rows. A row with no match keeps its place, its new columns empty.
 *  ponytail: one level, one key, in the browser; a view in Admin → SQL for anything bigger. */
export function joinRows(a, b, ka, kb, prefix, bCols = null) {
  const by = new Map();
  for (const r of b) {
    const k = String(r[kb] ?? '');
    const s = by.get(k);
    if (!s) { by.set(k, { row: { ...r }, n: 1 }); continue; }
    s.n++;
    for (const [c, v] of Object.entries(r)) if (typeof v === 'number') s.row[c] = (typeof s.row[c] === 'number' ? s.row[c] : 0) + v;
  }
  const cols = bCols || [...new Set(b.flatMap(r => Object.keys(r)))];
  return a.map(r => {
    const m = by.get(String(r[ka] ?? ''));
    const o = { ...r };
    for (const c of cols) o[prefix + c] = m ? m.row[c] ?? null : null;
    o[prefix + 'rows'] = m ? m.n : 0;
    return o;
  });
}
