// The calculator's sums: Daybook's own formula engine (web/core/formula.js), so the
// functions are the ones the answers use, with what a calculator adds:
//   4.7k  220µ  2.5m  10M  100n     SI prefixes straight after a number
//   ans   the last answer;  pi  e;  log is log to base 10, ln the natural one
//   degrees or radians for sin, cos, tan and their inverses
//   2x  3sin(30)  (1+2)(3)          times, as written by hand;  -2^2 is -4, as on a calculator
// compile() makes a function of x for the graph; solve() finds where two sides are equal.
import { parse, evaluate } from './core/formula.js';

const PREFIX = { p: -12, n: -9, u: -6, 'µ': -6, 'μ': -6, m: -3, k: 3, M: 6, G: 9, T: 12 };
const ENG = { '-12': 'p', '-9': 'n', '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M', 9: 'G', 12: 'T' };
const TRIG = new Set(['SIN', 'COS', 'TAN']), ARC = new Set(['ASIN', 'ACOS', 'ATAN']);

/** What was typed, as the formula engine reads it. */
export function prep(src) {
  return String(src)
    .replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/√\s*\(/g, 'SQRT(')
    .replace(/\blog\s*\(/gi, 'LOG10(')
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

/** {value} or {error}. vars: ans and any others, by name. */
export function calc(src, { ans = 0, deg = true, vars = {} } = {}) {
  try {
    let ast = parse(prep(src));
    if (deg) ast = degrees(ast);
    const v = evaluate(ast, { row: { ans, pi: Math.PI, e: Math.E, ...vars } });
    if (typeof v !== 'number' || !isFinite(v)) return { error: typeof v === 'number' ? 'Not a finite number' : 'Not a number' };
    return { value: v };
  } catch (e) { return { error: said(e) }; }
}

const said = e => String(e.message || e).replace(/No column called (\S+)/, 'Unknown name: $1');

/** A sum of x (and of anything in vars), read once: f({x}) is its value, NaN where it has none. Throws if it cannot be read. */
export function compile(src, { deg = true } = {}) {
  let ast;
  try { ast = parse(prep(src)); } catch (e) { throw new Error(said(e)); }
  if (deg) ast = degrees(ast);
  return vars => { try { const v = evaluate(ast, { row: { pi: Math.PI, e: Math.E, ...vars } }); return typeof v === 'number' ? v : NaN; } catch { return NaN; } };
}

/** Where lhs = rhs, for x between a and b: every sign change of lhs − rhs, closed in on by halving.
 *  ponytail: a root where the curve only touches zero (x² = 0) is found only if a sample lands on it. */
export function solve(eq, { a = -100, b = 100, deg = true, vars = {} } = {}) {
  const sides = String(eq).split('=');
  if (sides.length > 2) return { error: 'Use one = sign' };
  if (!/\bx\b|\dx/i.test(eq)) return { error: 'Use x for the unknown' };
  let L, R;
  try { L = compile(sides[0], { deg }); R = sides[1]?.trim() ? compile(sides[1], { deg }) : () => 0; } catch (e) { return { error: e.message }; }
  const f = x => L({ ...vars, x }) - R({ ...vars, x }), roots = [], N = 4000;
  const add = r => { if (!roots.some(q => Math.abs(q - r) <= 1e-9 * Math.max(1, Math.abs(r)))) roots.push(r); };
  let x0 = a, y0 = f(a);
  if (y0 === 0) add(a);
  for (let i = 1; i <= N; i++) {
    const x1 = a + (b - a) * i / N, y1 = f(x1);
    if (y1 === 0) add(x1);
    else if (y0 && isFinite(y0) && isFinite(y1) && Math.sign(y0) !== Math.sign(y1)) {
      let lo = x0, hi = x1, flo = y0;
      for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2, fm = f(m); if (!isFinite(fm)) break; if (Math.sign(fm) === Math.sign(flo)) { lo = m; flo = fm; } else hi = m; }
      const r = (lo + hi) / 2;
      if (Math.abs(f(r)) < 1e-6 * Math.max(1, Math.abs(y0), Math.abs(y1))) add(+r.toPrecision(12));   // a crossing, not a jump over an asymptote
    }
    x0 = x1; y0 = y1;
  }
  return { roots: roots.sort((p, q) => p - q) };
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
