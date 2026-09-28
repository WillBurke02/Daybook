// ★ Function grapher (§7.7): y = a·f(bx + c) + d with sliders, the plain f(x) faint
// behind it for comparison. Trig is in radians.
//
// params: {f, a, b, c, d, x: [lo, hi], y: [lo, hi], fs: [the f's to offer], ghost, controls: [...]}
//   controls from f, a, b, c, d
// reports: a, b, c, d, f (its key), y0 (where it crosses the y-axis, 0 if it does not)
import { el } from '../core/dom.js';
import { tex } from '../ui/math.js';
import { s, slider, choose, plot, path } from './kit.js';

export const F = {
  x: ['x', x => x, t => t], x2: ['x²', x => x * x, t => `(${t})^2`], x3: ['x³', x => x ** 3, t => `(${t})^3`],
  sin: ['sin x', Math.sin, t => `\\sin(${t})`], cos: ['cos x', Math.cos, t => `\\cos(${t})`], tan: ['tan x', Math.tan, t => `\\tan(${t})`],
  exp: ['eˣ', Math.exp, t => `e^{${t}}`], ln: ['ln x', Math.log, t => `\\ln(${t})`], recip: ['1/x', x => 1 / x, t => `\\frac{1}{${t}}`],
  sqrt: ['√x', Math.sqrt, t => `\\sqrt{${t}}`], abs: ['|x|', Math.abs, t => `|${t}|`],
};
const n = v => String(+v.toFixed(2));

/** The TeX for y = a·f(bx + c) + d, written the way you would write it: no 1·, no + −, no + 0. */
export function formula(k, a, b, c, d) {
  const inner = `${b === 1 ? '' : b === -1 ? '-' : n(b)}x${c ? (c > 0 ? ' + ' : ' - ') + n(Math.abs(c)) : ''}`;
  let f = k === 'x' ? (a !== 1 && c ? `(${inner})` : inner) : F[k][2](inner);
  if (inner === 'x') f = f.replace('(x)^', 'x^');                                   // x^2, not (x)^2
  const lead = a === 1 ? '' : a === -1 ? '-' : n(a);
  return `y = ${a === 0 ? '0' : lead + f}${d ? (d > 0 ? ' + ' : ' - ') + n(Math.abs(d)) : ''}`;
}

/** The names a card's question can use (tests/content.check.mjs holds cards to them). */
export const REPORTS = ['f', 'a', 'b', 'c', 'd', 'y0'];

export function mount(box, p, report) {
  const st = { f: p.f || 'sin', a: p.a ?? 1, b: p.b ?? 1, c: p.c ?? 0, d: p.d ?? 0 };
  const X = p.x || [-10, 10], Y = p.y || [-6, 6];
  const pic = el('div', { class: 'wscreen' }), eq = el('div', { class: 'wread weq' });
  const draw = () => {
    const f = F[st.f][1], y = x => st.a * f(st.b * x + st.c) + st.d;
    const P = plot({ x: X, y: Y, label: 'Graph' });
    const N = 800, span = Y[1] - Y[0];
    const sample = fn => {
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const x = X[0] + (X[1] - X[0]) * i / N, v = fn(x), last = pts[pts.length - 1];
        // a jump of more than the screen between neighbours is an asymptote, not a line to draw
        pts.push(last && isFinite(last[1]) && isFinite(v) && Math.abs(v - last[1]) > span ? [x, null] : [x, isFinite(v) ? Math.max(Y[0] - span, Math.min(Y[1] + span, v)) : null]);
      }
      return pts;
    };
    const plain = st.a !== 1 || st.b !== 1 || st.c !== 0 || st.d !== 0;
    P.layer.append(p.ghost !== false && plain ? s('path', { class: 'ghost', d: path(sample(f), P.X, P.Y) }) : null,
      s('path', { class: 'trace', d: path(sample(y), P.X, P.Y) }));
    pic.replaceChildren(P.svg);
    eq.innerHTML = tex(formula(st.f, st.a, st.b, st.c, st.d), true);           // MathML built by math.js from our own numbers
    const y0 = y(0);
    report({ ...st, y0: isFinite(y0) ? y0 : 0 });
  };
  const set = (k, v) => { st[k] = v; draw(); };
  const fs = p.fs || Object.keys(F);
  const rows = {
    f: () => choose('f(x)', fs.map(k => [k, F[k][0]]), st.f, v => set('f', v)),
    a: () => slider('a (stretch in y)', { min: -5, max: 5, step: 0.1, value: st.a }, v => set('a', v)),
    b: () => slider('b (squash in x)', { min: -5, max: 5, step: 0.1, value: st.b }, v => set('b', v)),
    c: () => slider('c (shift inside)', { min: -10, max: 10, step: 0.1, value: st.c }, v => set('c', v)),
    d: () => slider('d (shift up)', { min: -5, max: 5, step: 0.1, value: st.d }, v => set('d', v)),
  };
  box.append(eq, pic, el('div', { class: 'wcontrols' }, (p.controls || ['f', 'a', 'b', 'c', 'd']).map(k => rows[k]?.())));
  draw();
}
