// What the whole app is looking at: the period, the page filters, the schema.
import { api } from './api.js';
import { readVal, el, select, flash } from './dom.js';
import { addDays, addMonths, lastDay, mondayOf, monthLong, monthName, dayShort,
         taxYearOf, taxYearLabel, today, toNumber } from './format.js';

export const GRAINS = [
  { v: 'week', label: 'Week' }, { v: 'month', label: 'Month' }, { v: 'bimonth', label: '2 months' },
  { v: 'quarter', label: 'Quarter' }, { v: 'taxyear', label: 'Tax year' },
  { v: 'year', label: 'Year' }, { v: 'all', label: 'All time' },
];

export const state = {
  meta: null,
  grain: readVal('grain', 'month'),
  anchor: today(),
  filters: { account: '', grp: '', tag: '' },
  editing: false,
};

export async function loadMeta() { state.meta = await api.meta(); return state.meta; }

export const setting = (k, d) => state.meta?.settings?.[k] ?? d;

/** A two-column form of settings: [key, label, 'text'|'number'|[options]]. Saves on change. */
export function settingsForm(rows, ctx) {
  return el('table', { class: 'g' }, el('tbody', {}, rows.map(([k, label, type]) => {
    const v = setting(k, '');
    const i = Array.isArray(type) ? select(type, v) : el('input', { value: v, inputmode: type === 'number' ? 'decimal' : null });
    i.addEventListener('change', async () => {
      const value = type === 'number' && toNumber(i.value) != null ? String(toNumber(i.value)) : i.value;   // '60,000' is kept as 60000
      try { await api.save('setting', { key: k, value }); await loadMeta(); flash('Saved'); ctx.changed('setting'); }
      catch (e) { flash(e.message); }
    });
    return el('tr', {}, el('td', { style: 'width:45%' }, label), el('td', {}, i));
  })));
}

/** The label for a column: yours if you named it in /admin, otherwise its own. */
export function label(tbl, col) {
  const f = (state.meta?.fields || []).find(x => x.tbl === tbl && x.col === col);
  return f?.label || col.replace(/^x_/, '').replace(/_/g, ' ');
}
export const hiddenCol = (tbl, col) =>
  !!(state.meta?.fields || []).find(x => x.tbl === tbl && x.col === col && x.hidden);

/** Columns you added in /admin, for any grid built on that table. */
export function extraCols(tbl) {
  return (state.meta?.tables?.[tbl] || [])
    .filter(c => c.name.startsWith('x_') && !hiddenCol(tbl, c.name))
    .map(c => ({ k: c.name, label: label(tbl, c.name), readonly: c.generated,
                 type: /INT|REAL|NUM/i.test(c.type) ? 'number' : 'text', n: /INT|REAL|NUM/i.test(c.type) }));
}

export function period(grain = state.grain, anchor = state.anchor) {
  const y = +anchor.slice(0, 4), m = +anchor.slice(5, 7);
  let from, to, lbl;
  if (grain === 'week') {
    from = mondayOf(anchor); to = addDays(from, 6);
    lbl = `w/c ${dayShort(from)} ${from.slice(0, 4)}`;
  } else if (grain === 'month') {
    from = anchor.slice(0, 7) + '-01'; to = lastDay(anchor.slice(0, 7));
    lbl = monthLong(anchor.slice(0, 7));
  } else if (grain === 'bimonth') {
    const s = m % 2 ? m : m - 1;
    from = `${y}-${String(s).padStart(2, '0')}-01`; to = lastDay(addMonths(from, 1));
    lbl = `${monthName(from.slice(0, 7)).split(' ')[0]}–${monthName(to.slice(0, 7))}`;
  } else if (grain === 'quarter') {
    const q = Math.floor((m - 1) / 3);
    from = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`; to = lastDay(addMonths(from, 2));
    lbl = `Q${q + 1} ${y}`;
  } else if (grain === 'taxyear') {
    const t = taxYearOf(anchor);
    from = `${t}-04-06`; to = `${t + 1}-04-05`; lbl = `Tax year ${taxYearLabel(t)}`;
  } else if (grain === 'year') {
    from = `${y}-01-01`; to = `${y}-12-31`; lbl = String(y);
  } else {
    from = '1900-01-01'; to = '2999-12-31'; lbl = 'All time';
  }
  return { grain, anchor, from, to, label: lbl, month: anchor.slice(0, 7), year: y,
           taxYear: taxYearOf(anchor), fromMonth: from.slice(0, 7), toMonth: to.slice(0, 7) };
}

export function step(n, grain = state.grain, anchor = state.anchor) {
  const by = { week: [0, 7], month: [1], bimonth: [2], quarter: [3], taxyear: [12], year: [12], all: [0] }[grain];
  if (grain === 'week') return addDays(anchor, 7 * n);
  if (grain === 'all') return anchor;
  return addMonths(anchor, by[0] * n) + '-' + String(Math.min(+anchor.slice(8, 10), 28)).padStart(2, '0');
}

/** A wider window for charts over time: the twelve months up to the period's end. */
export function windowOf(kind, p) {
  if (kind === 'all') return { from: '1900-01-01', to: '2999-12-31' };
  if (kind === '12m') {
    const to = p.grain === 'all' ? today() : p.to;
    return { from: addMonths(to.slice(0, 7), -11) + '-01', to };
  }
  if (kind === 'year') return { from: `${p.year}-01-01`, to: `${p.year}-12-31` };
  return { from: p.from, to: p.to };
}
