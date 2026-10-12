// The calculator's sums: Daybook's own formula engine (web/core/formula.js), so the
// functions are the ones the answers use, with what a calculator adds:
//   4.7k  220µ  2.5m  10M  100n     SI prefixes straight after a number
//   230V/10A  4.7kΩ  50Hz  2.2µF    units after a number carry through the sum: 230V/10A is 23 Ω
//   ans   the last answer;  pi  e;  log is log to base 10, ln the natural one
//   degrees or radians for sin, cos, tan and their inverses
//   2x  3sin(30)  (1+2)(3)  10log(2)  √2    as written by hand;  -2^2 is -4, as on a calculator
//   5!   0x1F  0b1010                factorial; hex and binary for PLC words
// compile() makes a function of x for the graph; solve() finds the one unknown where two sides are equal.
import { parse, evaluate } from './core/formula.js';

const PREFIX = { p: -12, n: -9, u: -6, 'µ': -6, 'μ': -6, m: -3, k: 3, M: 6, G: 9, T: 12 };
const ENG = { '-12': 'p', '-9': 'n', '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M', 9: 'G', 12: 'T' };
const TRIG = new Set(['SIN', 'COS', 'TAN']), ARC = new Set(['ASIN', 'ACOS', 'ATAN']);
// Units, in the SI base units kg, m, s and A. Longest first, so Hz is not H then z. No metre or
// tesla: m is milli and T is tera after a number.
export const UNITS = { Hz: [0, 0, -1, 0], Pa: [1, -1, -2, 0], Wb: [1, 2, -2, -1], 'Ω': [1, 2, -3, -2], ohm: [1, 2, -3, -2],
  V: [1, 2, -3, -1], A: [0, 0, 0, 1], W: [1, 2, -3, 0], J: [1, 2, -2, 0], N: [1, 1, -2, 0], C: [0, 0, 1, 1],
  F: [-1, -2, 4, 2], H: [1, 2, -2, -2], s: [0, 0, 1, 0] };
const SHOWN = ['V', 'A', 'Ω', 'W', 'J', 'N', 'Hz', 's', 'F', 'H', 'C', 'Pa', 'Wb'];       // the name a result is given
const uvar = u => `unit${u === 'Ω' ? 'ohm' : u}`;
const UNIT_RE = /(?<![\w.])(\d*\.?\d+(?:[eE][+-]?\d+)?)\s?([pnuµμmkMGT])?(Hz|Pa|Wb|Ω|ohm|V|A|W|J|N|C|F|H|s)(?![\w(])/g;

/** What was typed, as the formula engine reads it. */
export function prep(src) {
  return String(src)
    .replace(/\b0x([0-9a-f]+)\b/gi, (_, h) => String(parseInt(h, 16))).replace(/\b0b([01]+)\b/g, (_, b) => String(parseInt(b, 2)))
    .replace(UNIT_RE, (_, n, p, u) => `(${n}${p ? `*1e${PREFIX[p]}` : ''}*${uvar(u)})`)
    .replace(/(\d+)\s*!/g, 'FACT($1)')
    .replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi')
    .replace(/√\s*(\d*\.?\d+)/g, 'SQRT($1)').replace(/√\s*\(/g, 'SQRT(')
    .replace(/(?<![A-Za-z_])log\s*\(/gi, 'LOG10(')
    .replace(/(?<![\w.])\.(\d)/g, '0.$1')                                   // .5 is 0.5
    .replace(/(?<![\w.])(\d*\.?\d+(?:[eE][+-]?\d+)?)\s*(?=pi\b|\()/g, '$1*')     // 2pi, 2(3): times
    .replace(/((?<![\w.])\d*\.?\d+(?:[eE][+-]?\d+)?|\))\s*(?=(?:x|ans|pi)\b|(?:a?sin|a?cos|a?tan|sqrt|ln|log10|abs|exp)\s*\()/gi, '$1*')   // 2x, 3sin(30)
    .replace(/\)\s*\(/g, ')*(').replace(/\bx\s*\(/g, 'x*(')                   // (1+2)(3), x(x+1)
    .replace(/(^|[(,=+\-*/]\s*)-(?=\s*[\w.(])/g, '$1-1*')                     // -2^2 is -(2^2), as on a calculator
    // a prefix sticks to its number and is followed by nothing that makes it a name: 2.5m, not 2.5max
    .replace(/(?<![\w.])(\d*\.?\d+(?:[eE][+-]?\d+)?)([pnuµμmkMGT])(?![\w(µμ])/g, (_, n, p) => `(${n}*1e${PREFIX[p]})`);
}

/** Angles in degrees: sin(30) is a half. Wraps the trig functions' arguments and the inverses' results. */
function degrees(a) {
  if (!a || typeof a !== 'object') return a;
  const b = { ...a };
  for (const k of ['a', 'b']) if (b[k]) b[k] = degrees(b[k]);
  if (b.args) b.args = b.args.map(degrees);
  if (b.k === 'call' && TRIG.has(b.name)) return { ...b, args: [{ k: 'call', name: 'RADIANS', args: b.args }] };
  if (b.k === 'call' && ARC.has(b.name)) return { k: 'call', name: 'DEGREES', args: [b] };
  return b;
}

/** The units' values when each SI base unit is worth `base` (kg, m, s, A). */
const unitVars = base => Object.fromEntries(Object.entries(UNITS).map(([u, d]) => [uvar(u), d.reduce((p, e, i) => p * base[i] ** e, 1)]));

/** {value, unit} or {error}. vars: ans and any others, by name. The unit is worked out, not tracked:
 *  the sum is run again with each base unit worth 2, and how the answer moves gives its powers;
 *  a run with odd worths checks them, so 230V + 10A is caught rather than added. */
export function calc(src, { ans = 0, deg = true, vars = {} } = {}) {
  try {
    let ast = parse(prep(src));
    if (deg) ast = degrees(ast);
    const run = base => evaluate(ast, { row: { ans, pi: Math.PI, e: Math.E, ...unitVars(base), ...vars } });
    const v = run([1, 1, 1, 1]);
    if (typeof v !== 'number' || !isFinite(v)) return { error: typeof v === 'number' ? 'Not a finite number' : 'Not a number' };
    if (!/unit/i.test(prep(src)) || !v) return { value: v, unit: '' };
    const dims = [0, 1, 2, 3].map(i => Math.round(2 * Math.log2(run([1, 1, 1, 1].map((_, j) => j === i ? 2 : 1)) / v)) / 2);
    const odd = [3, 5, 7, 11], want = v * odd.reduce((p, b, i) => p * b ** dims[i], 1);
    if (Math.abs(run(odd) - want) > 1e-6 * Math.abs(want)) return { error: 'The units do not match (volts added to amps, say)' };
    const unit = dims.every(e => !e) ? '' : SHOWN.find(u => UNITS[u].every((e, i) => e === dims[i])) || base(dims);
    return { value: v, unit };
  } catch (e) { return { error: said(e) }; }
}

const SUP = { '-': '⁻', '.': '·', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
/** A unit with no name of its own, in base units: kg·m²·s⁻³ */
const base = dims => ['kg', 'm', 's', 'A'].map((u, i) => dims[i] ? u + (dims[i] === 1 ? '' : String(dims[i]).replace(/./g, c => SUP[c] ?? c)) : '').filter(Boolean).join('·');

/** What else a result is worth saying as: 3/8, 0x1F and 0b11111 (when the sum used them). */
export function also(v, src = '') {
  const out = [];
  if (!Number.isInteger(v)) for (let d = 2; d <= 64; d++) {
    const n = Math.round(v * d);
    if (Math.abs(n / d - v) < 1e-9 * Math.max(1, Math.abs(v))) { out.push(`${n}/${d}`); break; }
  }
  if (Number.isInteger(v) && v >= 0 && v < 2 ** 32 && /0x|0b/i.test(src)) out.push(`0x${v.toString(16).toUpperCase()}`, `0b${v.toString(2)}`);
  return out;
}

const said = e => String(e.message || e).replace(/No column called (\S+)/, 'Unknown name: $1');

/** A sum of x (and of anything in vars), read once: f({x}) is its value, NaN where it has none. Throws if it cannot be read. */
export function compile(src, { deg = true } = {}) {
  let ast;
  try { ast = parse(prep(src)); } catch (e) { throw new Error(said(e)); }
  if (deg) ast = degrees(ast);
  return vars => { try { const v = evaluate(ast, { row: { pi: Math.PI, e: Math.E, ...vars } }); return typeof v === 'number' ? v : NaN; } catch { return NaN; } };
}

/** The unknown in an equation: its one name that is not pi, e, ans or a unit. */
function unknown(eq) {
  const names = new Set();
  const walk = a => { if (!a || typeof a !== 'object') return; if (a.k === 'id') names.add(a.v); for (const k of ['a', 'b']) walk(a[k]); (a.args || []).forEach(walk); };
  for (const side of String(eq).split('=')) if (side.trim()) walk(parse(prep(side)));
  return [...names].filter(n => !['pi', 'e', 'ans'].includes(n.toLowerCase()) && !/^unit/i.test(n));
}

/** Where lhs = rhs, for the one unknown (any letter): every sign change of lhs − rhs, closed in on by
 *  halving. Between a and b when given; else −100 to 100 first, then out to ±10⁹ if nothing is there.
 *  ponytail: a root where the curve only touches zero (x² = 0) is found only if a sample lands on it. */
export function solve(eq, { a, b, deg = true, vars = {} } = {}) {
  const sides = String(eq).split('=');
  if (sides.length > 2) return { error: 'Use one = sign' };
  let name;
  try {
    const u = unknown(eq);
    if (!u.length) return { error: 'Use a letter for the unknown: x, R, I…' };
    if (u.length > 1) return { error: `One unknown at a time: ${u.join(', ')}` };
    name = u[0];
  } catch (e) { return { error: said(e) }; }
  let L, R;
  try { L = compile(sides[0], { deg }); R = sides[1]?.trim() ? compile(sides[1], { deg }) : () => 0; } catch (e) { return { error: e.message }; }
  const f = x => L({ ...vars, ...unitVars([1, 1, 1, 1]), [name]: x }) - R({ ...vars, ...unitVars([1, 1, 1, 1]), [name]: x });
  if (a != null && b != null) return { roots: scan(f, linear(a, b)), name };
  let roots = scan(f, linear(-100, 100));
  if (!roots.length) {                                 // nothing near: look further out, a few points a decade
    const far = [];
    for (let k = -6; k <= 9; k += 0.01) far.push(10 ** k, -(10 ** k));
    roots = scan(f, [...far, 0].sort((p, q) => p - q));
  }
  return { roots, name };
}

const linear = (a, b, N = 4000) => Array.from({ length: N + 1 }, (_, i) => a + (b - a) * i / N);

function scan(f, xs) {
  const roots = [];
  const add = r => { if (!roots.some(q => Math.abs(q - r) <= 1e-9 * Math.max(1, Math.abs(r)))) roots.push(r); };
  let x0 = xs[0], y0 = f(x0);
  if (y0 === 0) add(x0);
  for (let i = 1; i < xs.length; i++) {
    const x1 = xs[i], y1 = f(x1);
    if (y1 === 0) add(x1);
    else if (y0 && isFinite(y0) && isFinite(y1) && Math.sign(y0) !== Math.sign(y1)) {
      let lo = x0, hi = x1, flo = y0;
      for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2, fm = f(m); if (!isFinite(fm)) break; if (Math.sign(fm) === Math.sign(flo)) { lo = m; flo = fm; } else hi = m; }
      const r = (lo + hi) / 2;
      if (Math.abs(f(r)) < 1e-6 * Math.max(1, Math.abs(y0), Math.abs(y1))) add(+r.toPrecision(12));   // a crossing, not a jump over an asymptote
    }
    x0 = x1; y0 = y1;
  }
  return roots.sort((p, q) => p - q);
}

/** A tidy grid spacing for a range: 1, 2 or 5 times a power of ten, about n lines across. */
export function step(range, n = 8) {
  const raw = range / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** 4700 → "4.7 k", 0.00022 → "220 µ": a power of ten in threes, as the prefix. */
export function eng(v, sig = 4) {
  if (!v) return '0';
  let p = Math.floor(Math.log10(Math.abs(v)) / 3) * 3;
  p = Math.max(-12, Math.min(12, p));
  let m = +(v / 10 ** p).toPrecision(sig);
  if (Math.abs(m) >= 1000 && p < 12) { p += 3; m = +(m / 1000).toPrecision(sig); }
  return `${m} ${ENG[p]}`.trim();
}

/** A number as a calculator shows it: up to 10 significant figures, no float noise. */
export const plain = v => {
  const a = Math.abs(v);
  return a !== 0 && (a >= 1e12 || a < 1e-6) ? v.toExponential(6).replace(/\.?0+e/, 'e') : String(+v.toPrecision(10));
};
