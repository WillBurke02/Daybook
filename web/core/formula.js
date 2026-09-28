// Formulas, spreadsheet style, parsed and evaluated here — never eval().
//
//   Hours * 12.82                     a column in the same row
//   DAYNAME(Date)                     Tue
//   IF(Overtime > 0, "OT", "")
//   SUM(Hours)                        the whole column
//   [Day total] / SUM([Day total])    a column name with spaces
//   2026.May.Hours                    a figure for a period (see MEASURES in api.py)
//   2026.Q2.Spent   2026.Gross   TY2026.Tax   This.Overtime   Prev.Hours
//
// Values straight off the screen are understood: 08:30 is 8.5 hours, £1,234.56
// is 1234.56, 01/09/2026 and 2026-09-01 are dates.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const key = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// --- values -------------------------------------------------------------------

export function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s || s === '—') return 0;
  let m = s.match(/^(-?)(\d{1,3}):(\d{2})$/);                   // 08:30 -> 8.5
  if (m) return (m[1] ? -1 : 1) * (+m[2] + +m[3] / 60);
  m = s.replace(/[£$€,\s]/g, '').replace(/^\((.*)\)$/, '-$1').match(/^([+-]?\d*\.?\d+)(h|%)?$/);
  if (m) return m[2] === '%' ? +m[1] / 100 : +m[1];
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return date(s).getTime() / 864e5;   // days, for subtraction
  const n = parseFloat(s.replace(/[£,]/g, ''));
  return isNaN(n) ? NaN : n;
}

export function date(v) {
  if (v instanceof Date) return v;
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);                    // UK day first
  if (m) return new Date(Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]));
  m = s.match(/^(?:[A-Za-z]{3},?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?(?:\s+(\d{4}))?$/);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase()))
    return new Date(Date.UTC(m[3] ? +m[3] : new Date().getUTCFullYear(), MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), +m[1]));
  if (typeof v === 'number') return new Date(v * 864e5);
  return null;
}
const iso = d => d.toISOString().slice(0, 10);

export function show(v) {
  if (v == null) return '';
  if (v instanceof Date) return `${String(v.getUTCDate()).padStart(2, '0')}/${String(v.getUTCMonth() + 1).padStart(2, '0')}/${v.getUTCFullYear()}`;
  if (typeof v === 'number') return isFinite(v) ? String(+v.toFixed(2)) : '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map(show).join(', ');
  return String(v);
}

// --- functions ------------------------------------------------------------------
// agg: which arguments are whole columns when they mention a column (true = all)

const flat = a => a.flat(Infinity).filter(x => x !== '' && x != null);
const nums = a => flat(a).map(num).filter(x => !isNaN(x));
const matches = (v, crit) => {
  const c = String(crit).trim();
  const m = c.match(/^(<=|>=|<>|!=|=|<|>)(.*)$/);
  if (!m) return key(v) === key(c);
  const [a, b] = [num(v), num(m[2])];
  const same = isNaN(b) ? key(v) === key(m[2]) : a === b;
  return { '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b, '=': same, '<>': !same, '!=': !same }[m[1]];
};
const pad = n => String(n).padStart(2, '0');
function fmtText(v, f) {
  const d = date(v);
  const F = String(f);
  if (/^[£]/.test(F)) return money(v);
  if (/^hh:mm$/i.test(F)) return hhmm(num(v));
  if (/^0(\.0+)?$/.test(F)) return num(v).toFixed((F.split('.')[1] || '').length);
  if (d && /[dmy]/i.test(F)) {
    return F.replace(/dddd|ddd|dd|d|mmmm|mmm|mm|m|yyyy|yy/gi, t => {
      const T = t.toLowerCase();
      return { dddd: d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }),
               ddd: DAYS[d.getUTCDay()], dd: pad(d.getUTCDate()), d: String(d.getUTCDate()),
               mmmm: d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' }),
               mmm: d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }),
               mm: pad(d.getUTCMonth() + 1), m: String(d.getUTCMonth() + 1),
               yyyy: String(d.getUTCFullYear()), yy: String(d.getUTCFullYear()).slice(2) }[T];
    });
  }
  return show(v);
}
const money = v => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(num(v) || 0);
const hhmm = h => { const m = Math.round(Math.abs(h) * 60); return `${h < 0 ? '-' : ''}${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const need = (d, what) => { if (!d) throw new Error(`${what} needs a date`); return d; };

export const FUNCTIONS = {
  SUM:      { args: 'values…', about: 'Adds up. SUM(Hours) adds the whole column.', agg: true, fn: (...a) => nums(a).reduce((x, y) => x + y, 0) },
  AVERAGE:  { args: 'values…', about: 'The mean. AVERAGE(Hours).', agg: true, fn: (...a) => { const n = nums(a); return n.length ? n.reduce((x, y) => x + y, 0) / n.length : 0; } },
  MIN:      { args: 'values…', about: 'The smallest.', agg: true, fn: (...a) => Math.min(...nums(a)) },
  MAX:      { args: 'values…', about: 'The largest.', agg: true, fn: (...a) => Math.max(...nums(a)) },
  COUNT:    { args: 'values…', about: 'How many are not blank.', agg: true, fn: (...a) => flat(a).length },
  SUMIF:    { args: 'column, condition, [sum column]', about: 'Adds rows that meet a condition. SUMIF(Day, "Sat", Hours) or SUMIF(Hours, ">8.5").', agg: [true, false, true],
              fn: (r, c, s) => r.reduce((t, v, i) => t + (matches(v, c) ? num((s || r)[i]) || 0 : 0), 0) },
  COUNTIF:  { args: 'column, condition', about: 'Counts rows that meet a condition. COUNTIF(Overtime, ">0").', agg: [true, false],
              fn: (r, c) => r.filter(v => matches(v, c)).length },
  AVERAGEIF:{ args: 'column, condition, [average column]', about: 'Mean of rows that meet a condition.', agg: [true, false, true],
              fn: (r, c, s) => { const v = r.map((x, i) => matches(x, c) ? num((s || r)[i]) : null).filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; } },
  RUNNING:  { args: 'column', about: 'Running total down the table, up to this row.', running: true },
  PREV:     { args: 'column', about: 'The value in the row above.', prev: true },
  ROWNUM:   { args: '', about: 'This row’s number, from 1.', fn: function () { return this.index + 1; } },
  ROUND:    { args: 'number, [places]', about: 'Rounds to so many decimal places.', fn: (x, p = 0) => { const f = 10 ** num(p); return Math.round(num(x) * f) / f; } },
  ROUNDUP:  { args: 'number, [places]', about: 'Rounds up.', fn: (x, p = 0) => { const f = 10 ** num(p); return Math.ceil(num(x) * f) / f; } },
  ROUNDDOWN:{ args: 'number, [places]', about: 'Rounds down.', fn: (x, p = 0) => { const f = 10 ** num(p); return Math.floor(num(x) * f) / f; } },
  ABS:      { args: 'number', about: 'Without its sign.', fn: x => Math.abs(num(x)) },
  MOD:      { args: 'number, divisor', about: 'The remainder.', fn: (a, b) => num(a) % num(b) },
  IF:       { args: 'condition, if true, [if false]', about: 'IF(Overtime > 0, "OT", "").', lazy: true },
  IFERROR:  { args: 'value, if error', about: 'The value, or the fallback if it fails.', lazy: true },
  AND:      { args: 'conditions…', about: 'True if every one is.', fn: (...a) => flat(a).every(Boolean) },
  OR:       { args: 'conditions…', about: 'True if any one is.', fn: (...a) => flat(a).some(Boolean) },
  NOT:      { args: 'condition', about: 'The opposite.', fn: a => !a },
  ISBLANK:  { args: 'value', about: 'True if empty.', fn: a => a == null || String(a).trim() === '' },
  CONCAT:   { args: 'texts…', about: 'Joins text. Same as "a" & "b".', fn: (...a) => flat(a).map(show).join('') },
  UPPER:    { args: 'text', about: 'CAPITALS.', fn: a => show(a).toUpperCase() },
  LOWER:    { args: 'text', about: 'lower case.', fn: a => show(a).toLowerCase() },
  LEN:      { args: 'text', about: 'Number of characters.', fn: a => show(a).length },
  LEFT:     { args: 'text, count', about: 'The first characters.', fn: (a, n = 1) => show(a).slice(0, num(n)) },
  RIGHT:    { args: 'text, count', about: 'The last characters.', fn: (a, n = 1) => show(a).slice(-num(n)) },
  CONTAINS: { args: 'text, part', about: 'True if the text contains the part (any case).', fn: (a, b) => show(a).toLowerCase().includes(show(b).toLowerCase()) },
  TEXT:     { args: 'value, format', about: 'Formats: "ddd" Tue, "dddd" Tuesday, "dd/mm/yyyy", "mmm yyyy", "hh:mm", "0.00", "£".', fn: fmtText },
  MONEY:    { args: 'number', about: 'As pounds: £1,234.56.', fn: money },
  HHMM:     { args: 'hours', about: '8.5 as 08:30.', fn: h => hhmm(num(h)) },
  HOURS:    { args: 'start, finish', about: 'Hours between two times, across midnight if need be. HOURS(Started, Finished).',
              fn: (a, b) => { let m = num(b) - num(a); if (m < 0) m += 24; return m; } },
  TODAY:    { args: '', about: 'Today’s date.', fn: () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); } },
  DATE:     { args: 'year, month, day', about: 'Makes a date.', fn: (y, m, d) => new Date(Date.UTC(num(y), num(m) - 1, num(d))) },
  YEAR:     { args: 'date', about: 'The year.', fn: d => need(date(d), 'YEAR').getUTCFullYear() },
  MONTH:    { args: 'date', about: 'The month, 1 to 12.', fn: d => need(date(d), 'MONTH').getUTCMonth() + 1 },
  DAY:      { args: 'date', about: 'The day of the month.', fn: d => need(date(d), 'DAY').getUTCDate() },
  WEEKDAY:  { args: 'date', about: '1 for Monday to 7 for Sunday.', fn: d => ((need(date(d), 'WEEKDAY').getUTCDay() + 6) % 7) + 1 },
  DAYNAME:  { args: 'date', about: 'Mon, Tue… DAYNAME(Date).', fn: d => DAYS[need(date(d), 'DAYNAME').getUTCDay()] },
  MONTHNAME:{ args: 'date', about: 'Jan, Feb…', fn: d => need(date(d), 'MONTHNAME').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) },
  WEEKNUM:  { args: 'date', about: 'ISO week number.', fn: d => { const t = new Date(need(date(d), 'WEEKNUM')); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); } },
  DAYS:     { args: 'end, start', about: 'Days between two dates.', fn: (a, b) => Math.round((need(date(a), 'DAYS') - need(date(b), 'DAYS')) / 864e5) },
  SQRT:     { args: 'number', about: 'Square root.', fn: x => Math.sqrt(num(x)) },
  POWER:    { args: 'number, power', about: 'POWER(2, 10) is 1024. Same as 2^10.', fn: (a, b) => num(a) ** num(b) },
  EXP:      { args: 'number', about: 'e to the power.', fn: x => Math.exp(num(x)) },
  LN:       { args: 'number', about: 'Natural logarithm.', fn: x => Math.log(num(x)) },
  LOG10:    { args: 'number', about: 'Logarithm to base 10. Decibels: 20*LOG10(A1/A2).', fn: x => Math.log10(num(x)) },
  PI:       { args: '', about: '3.14159…', fn: () => Math.PI },
  SIN:      { args: 'radians', about: 'Sine of an angle in radians: SIN(RADIANS(30)).', fn: x => Math.sin(num(x)) },
  COS:      { args: 'radians', about: 'Cosine of an angle in radians.', fn: x => Math.cos(num(x)) },
  TAN:      { args: 'radians', about: 'Tangent of an angle in radians.', fn: x => Math.tan(num(x)) },
  ASIN:     { args: 'number', about: 'Inverse sine, in radians.', fn: x => Math.asin(num(x)) },
  ACOS:     { args: 'number', about: 'Inverse cosine, in radians.', fn: x => Math.acos(num(x)) },
  ATAN:     { args: 'number', about: 'Inverse tangent, in radians.', fn: x => Math.atan(num(x)) },
  RADIANS:  { args: 'degrees', about: 'Degrees to radians.', fn: x => num(x) * Math.PI / 180 },
  DEGREES:  { args: 'radians', about: 'Radians to degrees.', fn: x => num(x) * 180 / Math.PI },
  WORKDAYS: { args: 'start, end', about: 'Monday-to-Friday days from start to end, both counted.',
              fn: (a, b) => { let n = 0; for (let d = new Date(need(date(a), 'WORKDAYS')); d <= need(date(b), 'WORKDAYS'); d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() % 6) n++; return n; } },
};

// --- tokens and parsing ------------------------------------------------------

const OPS = ['<=', '>=', '<>', '!=', '==', '+', '-', '*', '/', '^', '&', '=', '<', '>', '(', ')', ',', '.', ':', '%'];

export function tokens(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/\d/.test(c)) {
      let j = i; while (/\d/.test(src[j] || '')) j++;
      if (src[j] === '.' && /\d/.test(src[j + 1] || '')) { j++; while (/\d/.test(src[j] || '')) j++; }
      const e = src.slice(j).match(/^[eE][+-]?\d+/);            // 1e6, 2.5e-3: a question's units need them
      if (e) j += e[0].length;
      out.push({ t: 'num', v: src.slice(i, j), at: i }); i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < src.length && src[j] !== c) j++;
      if (j >= src.length) throw new Error('A text is missing its closing quote');
      out.push({ t: 'str', v: src.slice(i + 1, j), at: i }); i = j + 1; continue;
    }
    if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new Error('A [column name] is missing its ]');
      out.push({ t: 'id', v: src.slice(i + 1, j), at: i }); i = j + 1; continue;
    }
    if (/[A-Za-z_£]/.test(c)) {
      let j = i; while (/[\w£]/.test(src[j] || '')) j++;
      out.push({ t: 'id', v: src.slice(i, j), at: i }); i = j; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw new Error(`Unexpected "${c}"`);
    out.push({ t: 'op', v: op, at: i }); i += op.length;
  }
  return out;
}

const PREC = { '=': 1, '==': 1, '<>': 1, '!=': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

export function parse(src) {
  const t = tokens(String(src ?? '').replace(/^=/, ''));
  let i = 0;
  const peek = () => t[i], next = () => t[i++];
  const expect = v => { const k = next(); if (!k || k.v !== v) throw new Error(`Expected "${v}"`); return k; };
  const primary = () => {
    const k = next();
    if (!k) throw new Error('The formula ends too soon');
    if (k.t === 'op' && k.v === '(') { const e = expr(0); expect(')'); return e; }
    if (k.t === 'op' && k.v === '-') return { k: 'neg', a: unary() };
    if (k.t === 'op' && k.v === '+') return unary();
    if (k.t === 'str') return { k: 'str', v: k.v };
    if (k.t === 'num' || (k.t === 'id' && /^(this|prev|next|ty\d{4}|taxyear\d{4})$/i.test(k.v))) {
      if (peek()?.v === '.' && (k.t === 'id' || /^\d{4}$/.test(k.v))) return ref(k);
      if (k.t === 'num') return { k: 'num', v: +k.v };
    }
    if (k.t === 'id') {
      if (/^(true|false)$/i.test(k.v) && peek()?.v !== '(') return { k: 'bool', v: /^true$/i.test(k.v) };
      if (peek()?.v === '(') {
        const name = k.v.toUpperCase();
        if (!FUNCTIONS[name]) throw new Error(`There is no function called ${k.v}`);
        next();
        const args = [];
        if (peek()?.v !== ')') { args.push(expr(0)); while (peek()?.v === ',') { next(); args.push(expr(0)); } }
        expect(')');
        return { k: 'call', name, args };
      }
      return { k: 'id', v: k.v };
    }
    throw new Error(`Unexpected "${k.v}"`);
  };
  const ref = start => {
    const parts = [start.v];
    while (peek()?.v === '.') { next(); const p = next(); if (!p || p.t === 'op') throw new Error('A figure reference ends in "."'); parts.push(p.v); }
    return { k: 'ref', parts };
  };
  const unary = () => { const e = primary(); if (peek()?.v === '%') { next(); return { k: 'bin', op: '/', a: e, b: { k: 'num', v: 100 } }; } return e; };
  const expr = min => {
    let a = unary();
    for (;;) {
      const k = peek();
      if (!k || k.t !== 'op' || !(k.v in PREC) || PREC[k.v] < min) return a;
      next();
      const b = expr(k.v === '^' ? PREC[k.v] : PREC[k.v] + 1);
      a = { k: 'bin', op: k.v, a, b };
    }
  };
  const e = expr(0);
  if (i < t.length) throw new Error(`Unexpected "${t[i].v}"`);
  return e;
}

// --- figures by period: 2026.May.Hours -----------------------------------------

/** parts -> {name, from, to} or throws. period is the page period for This/Prev/Next. */
export function resolveRef(parts, period) {
  const name = parts[parts.length - 1];
  const p = parts.slice(0, -1).map(x => String(x).toLowerCase());
  const range = (a, b) => ({ name, from: a, to: b });
  const last = (y, m) => iso(new Date(Date.UTC(y, m, 0)));
  if (!p.length) throw new Error(`Give ${name} a period, like 2026.May.${name}`);
  let m;
  if (['this', 'prev', 'next'].includes(p[0])) {
    if (!period) throw new Error('This, Prev and Next need a period');
    if (p[0] === 'this') return range(period.from, period.to);
    const len = new Date(period.to) - new Date(period.from) + 864e5, dir = p[0] === 'prev' ? -1 : 1;
    const f = new Date(new Date(period.from).getTime() + dir * len), t2 = new Date(new Date(period.to).getTime() + dir * len);
    return range(iso(f), iso(t2));
  }
  if ((m = p[0].match(/^(?:ty|taxyear)(\d{4})$/))) return range(`${m[1]}-04-06`, `${+m[1] + 1}-04-05`);
  if (!/^\d{4}$/.test(p[0])) throw new Error(`"${parts[0]}" is not a year`);
  const y = +p[0];
  if (p.length === 1) return range(`${y}-01-01`, `${y}-12-31`);
  if ((m = p[1].match(/^q([1-4])$/))) return range(`${y}-${pad((+m[1] - 1) * 3 + 1)}-01`, last(y, +m[1] * 3));
  if ((m = p[1].match(/^h([12])$/))) return range(`${y}-${m[1] === '1' ? '01' : '07'}-01`, last(y, m[1] === '1' ? 6 : 12));
  const mi = MONTHS.indexOf(p[1].slice(0, 3));
  if (mi < 0) throw new Error(`"${parts[1]}" is not a month, quarter (Q1) or half (H1)`);
  if (p.length === 3 && /^\d{1,2}$/.test(p[2])) { const d = `${y}-${pad(mi + 1)}-${pad(+p[2])}`; return range(d, d); }
  return range(`${y}-${pad(mi + 1)}-01`, last(y, mi + 1));
}

export function refsIn(ast, period, out = []) {
  if (!ast) return out;
  if (ast.k === 'ref') { try { out.push(resolveRef(ast.parts, period)); } catch { /* reported on evaluation */ } }
  for (const x of [ast.a, ast.b, ...(ast.args || [])]) if (x) refsIn(x, period, out);
  return out;
}
export const refKey = r => `${r.name.toLowerCase()}|${r.from}|${r.to}`;

// --- evaluation ------------------------------------------------------------------

const mentionsColumn = a => a && (a.k === 'id' || [a.a, a.b, ...(a.args || [])].some(mentionsColumn));

/**
 * evaluate(ast, ctx)
 *   ctx.row      the current row as {column name: value}   (absent for a totals row)
 *   ctx.rows     every row, for SUM(Hours) and friends
 *   ctx.index    the row's position
 *   ctx.figures  Map refKey -> value, fetched beforehand (see refsIn)
 *   ctx.period   the page period, for This / Prev / Next
 */
export function evaluate(ast, ctx) {
  const E = (a, c = ctx) => evaluate(a, c);
  switch (ast.k) {
    case 'num': case 'str': case 'bool': return ast.v;
    case 'neg': return -num(E(ast.a));
    case 'id': {
      if (!ctx.row) throw new Error(`${ast.v} is a column: in a totals row use SUM(${ast.v})`);
      const k = key(ast.v);
      const hit = Object.keys(ctx.row).find(c => key(c) === k);
      if (hit === undefined) throw new Error(`No column called ${ast.v}`);
      return ctx.row[hit];
    }
    case 'ref': {
      const r = resolveRef(ast.parts, ctx.period);
      const v = ctx.figures?.get(refKey(r));
      if (v === undefined) throw new Error(`${ast.parts.join('.')} has not loaded`);
      if (v && typeof v === 'object' && v.error) throw new Error(v.error);
      return v;
    }
    case 'bin': {
      const a = E(ast.a), b = E(ast.b);
      switch (ast.op) {
        case '&': return show(a) + show(b);
        case '+': return num(a) + num(b);
        case '-': return num(a) - num(b);
        case '*': return num(a) * num(b);
        case '/': { const d = num(b); if (!d) throw new Error('Divided by zero'); return num(a) / d; }
        case '^': return num(a) ** num(b);
        default: {
          const both = !isNaN(num(a)) && !isNaN(num(b)) && String(a).trim() !== '' && String(b).trim() !== '';
          const [x, y] = both ? [num(a), num(b)] : [key(a), key(b)];
          return { '=': x === y, '==': x === y, '<>': x !== y, '!=': x !== y, '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y }[ast.op];
        }
      }
    }
    case 'call': {
      const f = FUNCTIONS[ast.name];
      if (ast.name === 'IF') return num(E(ast.args[0])) || (typeof E(ast.args[0]) === 'string' && E(ast.args[0]))
        ? E(ast.args[1]) : ast.args[2] ? E(ast.args[2]) : '';
      if (ast.name === 'IFERROR') { try { return E(ast.args[0]); } catch { return ast.args[1] ? E(ast.args[1]) : ''; } }
      const rows = ctx.rows || [];
      if (f.running || f.prev) {
        if (ctx.index == null) throw new Error(`${ast.name} works row by row`);
        if (f.prev) return ctx.index > 0 ? E(ast.args[0], { ...ctx, row: rows[ctx.index - 1], index: ctx.index - 1 }) : 0;
        let t = 0;
        for (let i = 0; i <= ctx.index; i++) t += num(E(ast.args[0], { ...ctx, row: rows[i], index: i })) || 0;
        return t;
      }
      const args = ast.args.map((a, i) => {
        const whole = f.agg === true || (Array.isArray(f.agg) && f.agg[i]);
        if (whole && rows.length && mentionsColumn(a)) return rows.map((r, j) => E(a, { ...ctx, row: r, index: j }));
        return E(a);
      });
      return f.fn.apply(ctx, args);
    }
  }
  throw new Error('Cannot work that out');
}

/** Parse, fetch nothing, evaluate: for when figures are already in ctx. Returns {value} or {error}. */
export function run(src, ctx) {
  try { return { value: evaluate(typeof src === 'string' ? parse(src) : src, ctx) }; }
  catch (e) { return { error: e.message }; }
}

/** Fetch every figure a set of formulas mention, in one request. */
const cache = new Map();
export async function figures(asts, period, fetcher) {
  const want = [];
  for (const a of asts) for (const r of refsIn(a, period)) if (!cache.has(refKey(r)) && !want.some(w => refKey(w) === refKey(r))) want.push(r);
  if (want.length) {
    const got = await fetcher(want);
    want.forEach((r, i) => cache.set(refKey(r), got[i]));
    setTimeout(() => want.forEach(r => cache.delete(refKey(r))), 5000);
  }
  return cache;
}
