// Question templates: numbers drawn at random each time, an answer worked out
// by the formula engine, and his answer checked within a tolerance (§7.5).
//   { "type": "numeric", "q": "… {v} m/s … {t} µs. Thickness?",
//     "vars": { "v": [5850, 5950, 10], "t": [5, 20, 0.5] },     [min, max, step], or a list to pick from
//     "let": { "d": "v * t / 1e6 / 2 * 1000" },                    worked out in order, for the text
//     "answer": "d", "unit": "mm", "tolerance": 0.02,               relative; "abs": 0.1 for an absolute one
//     "why": "…", "work": "d = {v} × {t} µs ÷ 2 = {d} mm" }
import { parse, evaluate } from './core/formula.js';

/** Up to 4 significant figures, no trailing zeros: 29.6, 0.00118, 5920, 1.23e+6 for the very large. */
export function fmt(x, dp) {
  if (typeof x !== 'number' || !isFinite(x)) return String(x);
  if (dp != null) return x.toFixed(dp);
  if (x !== 0 && (Math.abs(x) >= 1e7 || Math.abs(x) < 1e-4)) return x.toPrecision(3).replace('e+', 'e');
  return String(+x.toPrecision(4));
}

const calc = (src, values) => {
  const v = evaluate(parse(String(src)), { row: values });
  if (typeof v !== 'number' || !isFinite(v)) throw new Error(`${src} gives ${v}`);
  return v;
};

/** One set of numbers for a card: its vars drawn, its lets and its answer worked out. */
export function draw(card, rand = Math.random) {
  const values = {};
  for (const [k, spec] of Object.entries(card.vars || {})) {
    if (Array.isArray(spec) && spec.length === 3 && spec.every(n => typeof n === 'number')) {
      const [lo, hi, step] = spec, n = Math.floor((hi - lo) / step + 1e-9) + 1;
      values[k] = +(lo + Math.floor(rand() * n) * step).toFixed(10);
    } else values[k] = (spec.pick || spec)[Math.floor(rand() * (spec.pick || spec).length)];
  }
  return compute(card, values);
}

/** The card's lets and answer, worked out from values already there (drawn, or what a widget reports). */
export function compute(card, values) {
  for (const [k, f] of Object.entries(card.let || {})) values[k] = calc(f, values);
  if (card.answer != null) values.answer = typeof card.answer === 'number' ? card.answer : calc(card.answer, values);
  return values;
}

/** '{v} m/s' with the numbers in. {name:2} gives two decimal places. Unknown names are left as they are. */
export const fill = (text, values) => String(text ?? '').replace(/\{(\w+)(?::(\d))?\}/g, (m, k, dp) =>
  k in values ? (typeof values[k] === 'number' ? fmt(values[k], dp == null ? undefined : +dp) : String(values[k])) : m);

const SI = { p: -12, n: -9, u: -6, 'µ': -6, 'μ': -6, m: -3, k: 3, M: 6, G: 9 };
const BASES = ['Ω', 'ohm', 'V', 'A', 'W', 'VA', 'var', 'Wh', 'F', 'H', 'Hz', 's', 'm', 'g', 'J', 'N', 'Pa'];
/** A unit as [its prefix's power, its base]: 'kΩ' → [3, 'Ω'], 'mm' → [-3, 'm'], 'min' → [0, 'min']. */
const unitOf = u => u.length > 1 && u[0] in SI && BASES.includes(u.slice(1)) ? [SI[u[0]], u.slice(1)] : [0, u];

/** What was typed, as a number in the card's unit: '29.6', '1,480', '5.92e3', '5920*10/2000', and with an SI
 *  prefix or the unit: '4.7k', '4.7 kΩ', '470 µF', '5m' (mA on an amps card). A bare 'm' is milli only where the
 *  unit makes that plain: on a metres card '10m' is ten metres, and with no unit it is not a number. NaN if not one. */
export function read(typed, unit = '') {
  let s = String(typed ?? '').trim().replace(/,(?=\d{3}\b)/g, '').replace(/×/g, '*').replace(/−/g, '-');
  const [up, base] = unitOf(String(unit).trim());
  let p = up, had = false;
  if (base && s.endsWith(base)) { s = s.slice(0, -base.length).trimEnd(); had = true; p = 0; }
  const m = s.match(/[\d.)]\s*([pnuµμmkMG])$/);
  if (m && (m[1] !== 'm' || had || (BASES.includes(base) && base !== 'm'))) { p = SI[m[1]]; s = s.slice(0, -1); }
  if (!s) return NaN;
  try { const v = evaluate(parse(s), {}); return typeof v === 'number' ? v * 10 ** (p - up) : NaN; } catch { return NaN; }
}

/** Right if within the card's tolerance: relative (default 2%) or absolute. */
export function right(given, want, card = {}) {
  if (!isFinite(given)) return false;
  if (card.abs != null) return Math.abs(given - want) <= card.abs;
  const tol = card.tolerance ?? 0.02;
  return want === 0 ? Math.abs(given) <= (card.abs ?? 1e-9) : Math.abs(given - want) <= Math.abs(want) * tol;
}
