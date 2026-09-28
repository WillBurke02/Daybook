// A point-to-point move: speed up, run, slow down. Trapezoidal (constant acceleration) or
// S-curve (the acceleration itself ramps up and down, so there is no jolt at the corners).
// A short move never reaches full speed: the trapezoid becomes a triangle.
//   t_acc = v / a,  d_acc = v² / 2a,  t_const = (D − 2 d_acc) / v;  a triangle when D < v²/a: v_peak = √(a D)
// The S-curve here has the same times as the trapezoid (the acceleration is a triangle with the
// same average), so its peak acceleration is double.
//
// params: {D (mm), v (mm/s), a (mm/s²), shape: 'trap' | 's', controls: ['D', 'v', 'a', 'shape']}
// reports: D, v, a, t_acc, t_const, t_total (s), v_peak (mm/s), a_peak (mm/s²), triangle (1 or 0)
import { el } from '../core/dom.js';
import { s, slider, choose, plot, path, sig, put } from './kit.js';

export const REPORTS = ['D', 'v', 'a', 't_acc', 't_const', 't_total', 'v_peak', 'a_peak', 'triangle'];

/** The move's timing. */
export function move({ D, v, a, shape = 'trap' }) {
  let vp = v, ta = v / a, tc = (D - v * v / a) / v, tri = 0;
  if (tc < 0) { vp = Math.sqrt(a * D); ta = vp / a; tc = 0; tri = 1; }
  return { t_acc: ta, t_const: tc, t_total: 2 * ta + tc, v_peak: vp, a_peak: shape === 's' ? 2 * a : a, triangle: tri };
}

/** Speed at time t. */
export function speed(m, t, shape) {
  const { t_acc: ta, t_const: tc, v_peak: vp } = m;
  const ramp = u => shape === 's' ? (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) ** 2) : u;
  if (t <= 0) return 0;
  if (t < ta) return vp * ramp(t / ta);
  if (t <= ta + tc) return vp;
  if (t < 2 * ta + tc) return vp * ramp((2 * ta + tc - t) / ta);
  return 0;
}

export function mount(box, p, report) {
  const st = { D: p.D ?? 500, v: p.v ?? 250, a: p.a ?? 500, shape: p.shape || 'trap' };
  const pic = el('div', { class: 'wscreen' }), read = el('div', { class: 'wread num small' });
  const draw = () => {
    const m = move(st);
    const T = Math.max(m.t_total * 1.1, 0.5);
    const P = plot({ x: [0, T], y: [0, Math.max(st.v, 50) * 1.15], xlabel: 'time (s)', ylabel: 'speed (mm/s)', label: 'Speed against time' });
    const pts = [];
    for (let i = 0; i <= 300; i++) { const t = T * i / 300; pts.push([t, speed(m, t, st.shape)]); }
    P.layer.append(s('path', { class: 'fillarea', d: path(pts, P.X, P.Y) + `L${P.X(T)} ${P.Y(0)} L${P.X(0)} ${P.Y(0)} Z` }),
      s('path', { class: 'trace', d: path(pts, P.X, P.Y) }),
      s('line', { class: 'sp', x1: P.X(0), x2: P.X(T), y1: P.Y(st.v), y2: P.Y(st.v) }),
      [m.t_acc, m.t_acc + m.t_const].map(x => s('line', { class: 'band', x1: P.X(x), x2: P.X(x), y1: P.Y(0), y2: P.Y(st.v * 1.15) })));
    pic.replaceChildren(P.svg);
    put(read, el('strong', {}, `${sig(m.t_total)} s in all: ${sig(m.t_acc)} s up, ${sig(m.t_const)} s at speed, ${sig(m.t_acc)} s down`),
      m.triangle ? el('span', { class: 'warn' }, `too short to reach ${st.v} mm/s: it peaks at ${sig(m.v_peak)} mm/s`) : null,
      el('span', {}, `peak acceleration ${sig(m.a_peak)} mm/s²`), el('span', {}, 'the shaded area is the distance'));
    report({ D: st.D, v: st.v, a: st.a, ...m });
  };
  const rows = {
    D: () => slider('Distance', { min: 10, max: 1000, step: 10, value: st.D, unit: 'mm' }, v => { st.D = v; draw(); }),
    v: () => slider('Top speed', { min: 50, max: 800, step: 10, value: st.v, unit: 'mm/s' }, v => { st.v = v; draw(); }),
    a: () => slider('Acceleration', { min: 100, max: 3000, step: 50, value: st.a, unit: 'mm/s²' }, v => { st.a = v; draw(); }),
    shape: () => choose('Shape', [['trap', 'Trapezoidal'], ['s', 'S-curve']], st.shape, v => { st.shape = v; draw(); }),
  };
  box.append(pic, read, el('div', { class: 'wcontrols' }, (p.controls || ['D', 'v', 'a', 'shape']).map(c => rows[c]?.())));
  draw();
}
