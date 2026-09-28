// What the widgets share: SVG elements, labelled sliders, and a plot area with axes.
// Every widget exports mount(box, params, report); report({...}) hands what he set to the card's question.
import { el } from '../core/dom.js';

const NS = 'http://www.w3.org/2000/svg';
/** An SVG element. Attributes that are null are left off. */
export function s(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

/** Replace a box's children, leaving out the nulls (Element.append would print "null"). */
export const put = (box, ...kids) => box.replaceChildren(...kids.flat().filter(k => k != null && k !== false && k !== ''));

/** A labelled range input with its value shown. onInput(value) as it moves. */
export function slider(label, { min, max, step = 1, value, unit = '', fmt }, onInput) {
  const input = el('input', { type: 'range', min, max, step, value, 'aria-label': label });
  const out = el('output', { class: 'num' });
  const show = () => { out.textContent = (fmt ? fmt(+input.value) : String(+input.value)) + (unit ? ' ' + unit : ''); };
  input.addEventListener('input', () => { show(); onInput(+input.value); });
  show();
  const row = el('label', { class: 'wslider' }, el('span', {}, label), input, out);
  row.set = v => { input.value = v; show(); };
  return row;
}

/** A labelled select. options: [[value, label]]. */
export function choose(label, options, value, onPick) {
  const pick = el('select', { 'aria-label': label, onchange: e => onPick(e.target.value) },
    options.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
  return el('label', { class: 'wslider' }, el('span', {}, label), pick);
}

/** Round, readable tick values between lo and hi. */
export function ticks(lo, hi, n = 6) {
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/** A plot: {svg, X, Y, layer} where X and Y turn values into pixels and layer is where lines go.
 *  o: {x: [lo, hi], y: [lo, hi], xlabel, ylabel, w, h, xfmt, yfmt} */
export function plot(o) {
  const w = o.w || 480, h = o.h || 260, L = 40, T = 8, R = 10, B = 30;
  const [x0, x1] = o.x, [y0, y1] = o.y;
  const X = v => L + (v - x0) / (x1 - x0) * (w - L - R);
  const Y = v => T + (y1 - v) / (y1 - y0) * (h - T - B);
  const grid = s('g', { class: 'wgrid' });
  for (const v of ticks(x0, x1)) grid.append(s('line', { x1: X(v), x2: X(v), y1: T, y2: h - B }),
    s('text', { x: X(v), y: h - B + 14, 'text-anchor': 'middle' }, o.xfmt ? o.xfmt(v) : v));
  for (const v of ticks(y0, y1, 5)) grid.append(s('line', { x1: L, x2: w - R, y1: Y(v), y2: Y(v) }),
    s('text', { x: L - 5, y: Y(v) + 3.5, 'text-anchor': 'end' }, o.yfmt ? o.yfmt(v) : v));
  if (x0 < 0 && x1 > 0) grid.append(s('line', { class: 'axis', x1: X(0), x2: X(0), y1: T, y2: h - B }));
  if (y0 < 0 && y1 > 0) grid.append(s('line', { class: 'axis', x1: L, x2: w - R, y1: Y(0), y2: Y(0) }));
  if (o.xlabel) grid.append(s('text', { class: 'lab', x: w - R, y: h - 3, 'text-anchor': 'end' }, o.xlabel));
  if (o.ylabel) grid.append(s('text', { class: 'lab', x: L + 4, y: T + 10 }, o.ylabel));
  const layer = s('g');
  const svg = s('svg', { viewBox: `0 0 ${w} ${h}`, class: 'wplot', role: 'img', 'aria-label': o.label || 'Graph' },
    s('clipPath', { id: (o.clip = 'c' + Math.random().toString(36).slice(2)) }, s('rect', { x: L, y: T, width: w - L - R, height: h - T - B })),
    grid, layer);
  layer.setAttribute('clip-path', `url(#${o.clip})`);
  return { svg, X, Y, layer, box: { L, T, R: w - R, B: h - B } };
}

/** Points to a path, broken wherever a value is missing (null, NaN, off to infinity). */
export function path(points, X, Y) {
  let d = '', pen = false;
  for (const [x, y] of points) {
    if (y == null || !isFinite(y)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** A number for a readout: up to 3 significant figures. */
export const sig = (x, n = 3) => x == null || !isFinite(x) ? '–' : String(+x.toPrecision(n));
