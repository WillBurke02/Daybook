// An induction motor on a drive: the torque–speed curve for the supply frequency and pole
// count, the load's torque, and where they meet. Synchronous speed ns = 120 f / p; the rotor
// runs a little slower, and the gap (slip) grows with load. With V/f held constant the curve
// keeps its shape and slides along the speed axis: the slip in rpm stays about the same.
// Torque by the Kloss formula, T = 2 Tk / (Δn/Δnk + Δnk/Δn), per unit of rated torque.
// ponytail: a textbook motor (breakdown 2.5× rated, at 20% slip at 50 Hz); real curves differ.
//
// params: {f, poles, load, controls: ['f', 'poles', 'load']}
// reports: f (Hz), poles, ns (rpm), n (rpm), slip (%), load (% of rated torque), stalled (1 if the load is past breakdown)
import { el } from '../core/dom.js';
import { s, slider, choose, plot, path, sig, put } from './kit.js';

export const REPORTS = ['f', 'poles', 'ns', 'n', 'slip', 'load', 'stalled'];
const TK = 2.5, SK = 0.2;                 // breakdown torque (per unit) and the slip it happens at, at 50 Hz

/** Where the motor settles: {ns, n, slip (%), stalled}. load in per cent of rated torque. */
export function operate({ f, poles, load }) {
  const ns = 120 * f / poles, dk = SK * 120 * 50 / poles;            // the slip speed at breakdown, the same at every frequency
  const t = load / 100;
  if (t > TK) return { ns, n: 0, slip: 100, stalled: 1 };
  const dn = t <= 0 ? 0 : dk * (TK / t - Math.sqrt((TK / t) ** 2 - 1));  // the stable side of the curve
  return { ns, n: Math.max(0, ns - dn), slip: ns ? 100 * dn / ns : 0, stalled: 0 };
}
const torque = (dn, dk) => dn <= 0 ? 0 : 2 * TK / (dn / dk + dk / dn);

export function mount(box, p, report) {
  const st = { f: p.f ?? 50, poles: p.poles ?? 4, load: p.load ?? 100 };
  const pic = el('div', { class: 'wscreen' }), read = el('div', { class: 'wread num small' });
  const draw = () => {
    const r = operate(st), dk = SK * 6000 / st.poles, top = 120 * 60 / st.poles;
    const P = plot({ x: [0, top], y: [0, 3], xlabel: 'speed (rpm)', ylabel: 'torque (× rated)', label: 'Torque against speed' });
    const pts = [];
    for (let n = 0; n <= r.ns; n += r.ns / 200 || 1) pts.push([n, torque(r.ns - n, dk)]);
    P.layer.append(s('path', { class: 'trace', d: path(pts, P.X, P.Y) }),
      s('line', { class: 'sp', x1: P.X(0), x2: P.X(top), y1: P.Y(st.load / 100), y2: P.Y(st.load / 100) }),
      s('line', { class: 'band', x1: P.X(r.ns), x2: P.X(r.ns), y1: P.Y(0), y2: P.Y(3) }),
      s('text', { x: P.X(r.ns) - 4, y: P.Y(2.85), 'text-anchor': 'end' }, `ns ${sig(r.ns, 4)}`),
      r.stalled ? null : s('circle', { class: 'op', cx: P.X(r.n), cy: P.Y(st.load / 100), r: 5 }));
    pic.replaceChildren(P.svg);
    put(read, r.stalled ? el('strong', { class: 'warn' }, 'Stalled: the load needs more torque than the motor can give (past breakdown).')
      : el('strong', {}, `Runs at ${sig(r.n, 4)} rpm: slip ${sig(r.slip, 2)}%`),
      el('span', {}, `synchronous ${sig(r.ns, 4)} rpm = 120 × ${st.f} / ${st.poles}`));
    report({ f: st.f, poles: st.poles, load: st.load, ...r });
  };
  const rows = {
    f: () => slider('Frequency', { min: 5, max: 60, step: 1, value: st.f, unit: 'Hz' }, v => { st.f = v; draw(); }),
    poles: () => choose('Poles', [['2', '2 poles'], ['4', '4 poles'], ['6', '6 poles'], ['8', '8 poles']], String(st.poles), v => { st.poles = +v; draw(); }),
    load: () => slider('Load torque', { min: 0, max: 300, step: 5, value: st.load, unit: '%' }, v => { st.load = v; draw(); }),
  };
  box.append(pic, read, el('div', { class: 'wcontrols' }, (p.controls || ['f', 'poles', 'load']).map(c => rows[c]?.())));
  draw();
}
