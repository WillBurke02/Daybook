// The calculator's sums: Daybook's own formula engine (web/core/formula.js), so the
// functions are the ones the answers use, with what a calculator adds:
//   4.7k  220µ  2.5m  10M  100n     SI prefixes straight after a number
//   ans   the last answer;  pi  e;  log is log to base 10, ln the natural one
//   degrees or radians for sin, cos, tan and their inverses
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
  } catch (e) { return { error: e.message }; }
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
