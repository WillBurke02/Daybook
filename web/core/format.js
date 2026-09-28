import { el } from './dom.js';

const GBP  = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 });
const AXIS = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP',
  maximumFractionDigits: 1, notation: 'compact' });

// `compact` must be exactly true: a table cell calls fmt(value, row), and a row
// object is truthy, which would quietly round every figure to "£3K".
export const money = (v, compact) =>
  v == null || v === '' ? '' : (compact === true ? AXIS : GBP).format(Math.abs(v) < 0.005 ? 0 : v);
export const hrs  = (v, compact) => v == null ? ''
  : (compact === true ? Math.round(v) : (+v).toFixed(2)) + 'h';
export const hhmm = h => {
  if (h == null) return '';
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const pct  = v => v == null ? '' : (+v).toFixed(1) + '%';
export const num  = (v, d = 2) => v == null || v === '' ? '' : (+v).toFixed(d);
/** What you typed, as a number: '24,000', '£1,234.50' and ' 12 ' all read as you meant. Null if it is not one. */
export const toNumber = v => {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[£,\s]/g, '');
  return s === '' || isNaN(+s) ? null : +s;
};
/** 24000 -> '24,000.00', for money typed into a box. */
export const grouped = v => { const n = toNumber(v); return n == null ? String(v ?? '') : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
export const plain = v => v == null ? '' : String(+(+v).toFixed(2));

export const iso = d => d.toISOString().slice(0, 10);
export const today     = () => { const d = new Date(); return iso(new Date(d.getTime() - d.getTimezoneOffset() * 6e4)); };
export const thisMonth = () => today().slice(0, 7);
export const taxYearOf = d => +d.slice(0, 4) - (d.slice(5, 10) < '04-06' ? 1 : 0);
export const taxYearLabel = y => `${y}/${String(+y + 1).slice(2)}`;
const D = s => new Date((s.length === 7 ? s + '-02' : s) + 'T12:00:00Z');
export const monthName = m => D(m).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
export const monthLong = m => D(m).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const monthOnly = m => D(m).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
export const dayShort = d => D(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const dayLong = d => D(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const dow = d => D(d).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
export const dateUK = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
export const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const addMonths = (m, n) => {
  const d = new Date(m.slice(0, 7) + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};
export const mondayOf = s => addDays(s, -((D(s).getUTCDay() + 6) % 7));
export const lastDay = m => addDays(addMonths(m, 1) + '-01', -1);

/** The start and finish used most often: the first start and last finish of each
 *  day in `shifts`, the most common of each. A tie goes to the one seen first. */
export function usualTimes(shifts) {
  const days = {};
  for (const s of shifts) {
    const d = days[s.date] ||= { start: s.start, end: s.end };
    if (s.start < d.start) d.start = s.start;
    if (s.end > d.end) d.end = s.end;       // ponytail: a shift past midnight counts by its clock time
  }
  const mode = k => {
    const n = {}; let best = null;
    for (const d of Object.values(days)) { n[d[k]] = (n[d[k]] || 0) + 1; if (best == null || n[d[k]] > n[best]) best = d[k]; }
    return best;
  };
  return { start: mode('start'), end: mode('end') };
}

/** Minutes between two 'HH:MM', across midnight if need be, as hours. */
export const span = (a, b) => {
  if (!/^\d\d:\d\d$/.test(a || '') || !/^\d\d:\d\d$/.test(b || '')) return null;
  let m = (+b.slice(0, 2) * 60 + +b.slice(3)) - (+a.slice(0, 2) * 60 + +a.slice(3));
  if (m < 0) m += 1440;
  return m / 60;
};

/** '9', '930', '9:30', '0930', '17.5' -> 'HH:MM' */
export const toTime = v => {
  const s = String(v || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{1,2})[:.](\d{2})$/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  m = s.match(/^(\d{3,4})$/);
  if (m) return `${m[1].slice(0, -2).padStart(2, '0')}:${m[1].slice(-2)}`;
  m = s.match(/^(\d{1,2})$/);
  if (m && +m[1] < 24) return `${m[1].padStart(2, '0')}:00`;
  return s;
};

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = n => String(n).padStart(2, '0');

/** One side of a date range: '25th April', 'Apr 25', 'Fri 25 Apr', '25/04', '25/04/26', '2026-04-25'. */
function side(s) {
  s = s.trim().toLowerCase().replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/, '').replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/);
  if (m) return { d: +m[1], m: +m[2], y: m[3] ? +(m[3].length === 2 ? '20' + m[3] : m[3]) : null };
  const mon = w => { const i = MON.indexOf((w || '').slice(0, 3)); return i < 0 ? NaN : i + 1; };
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?(?: (?:of )?([a-z]+))?(?: (\d{4}))?$/);
  if (m) return { d: +m[1], m: m[2] ? mon(m[2]) : null, y: m[3] ? +m[3] : null };
  m = s.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/);
  if (m) return { d: +m[2], m: mon(m[1]), y: m[3] ? +m[3] : null };
  return null;
}

/** '8-12 Sep', '25th April', '27-28 Nov', '25/04', '30 Dec - 2 Jan' -> {from, to}, in `year` unless it says otherwise. */
export function parseWhen(text, year) {
  const t = String(text || '').trim();
  if (!t) return null;
  const parts = t.match(/\d{4}-\d{1,2}-\d{1,2}/g)                      // ISO dates carry their own dashes
    || t.split(/\s*(?:-|–|—|\bto\b|\buntil\b)\s*/i).filter(Boolean);
  if (!parts.length || parts.length > 2) return null;
  const a = side(parts[0]), b = parts[1] ? side(parts[1]) : { ...a };
  if (!a || !b) return null;
  a.m ??= b.m; b.m ??= a.m;
  if (!a.m || !b.m || isNaN(a.m) || isNaN(b.m)) return null;
  a.y ??= b.y ?? year; b.y ??= a.y;
  let from = `${a.y}-${pad(a.m)}-${pad(a.d)}`, to = `${b.y}-${pad(b.m)}-${pad(b.d)}`;
  if (to < from && b.m < a.m && !parts[1]?.match(/\d{4}/)) to = `${b.y + 1}-${pad(b.m)}-${pad(b.d)}`;   // 30 Dec - 2 Jan
  const ok = s => { const d = new Date(s + 'T00:00:00Z'); return !isNaN(d) && iso(d) === s; };   // no 31 Feb
  return ok(from) && ok(to) && to >= from ? { from, to } : null;
}

/** The other way: 'Fri 25 Apr', 'Mon 8 – Fri 12 Sep', 'Tue 30 Dec – Fri 2 Jan'. */
export function fmtWhen(from, to) {
  const f = d => `${dow(d)} ${+d.slice(8, 10)}`, mon = d => MON[+d.slice(5, 7) - 1].replace(/^./, c => c.toUpperCase());
  if (!to || to === from) return `${f(from)} ${mon(from)}`;
  return from.slice(0, 7) === to.slice(0, 7) ? `${f(from)} – ${f(to)} ${mon(to)}` : `${f(from)} ${mon(from)} – ${f(to)} ${mon(to)}`;
}

export const signed = v => el('span', { class: v > 0 ? 'cre num' : v < 0 ? 'deb num' : 'muted num' },
  (v > 0 ? '+' : '') + money(v));
export const overUnder = v => el('span', { class: v > 0 ? 'deb num' : v < 0 ? 'cre num' : 'muted num' },
  (v > 0 ? '+' : '') + money(v));
