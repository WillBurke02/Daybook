// ★ PID loop (§7.7) on a first-order-plus-dead-time plant: K·e^(−θs)/(τs + 1).
// A set-point step at t = 0; Kp, Ki, Kd sliders; overshoot, rise and settling time measured.
// Parallel form u = Kp·e + Ki∫e dt − Kd·dPV/dt: the derivative acts on the measurement, as
// most PLC PID blocks do, so a set-point step gives no kick.
//
// params: {K, tau, theta, kp, ki, kd, t_end, umax, controls: [...]}   controls from kp, ki, kd, K, tau, theta
// reports: kp, ki, kd, K, tau, theta, overshoot (%), rise (s, 10–90%), settling (s, 2% band; 0 if it never settles), sse (error at the end)
import { el } from '../core/dom.js';
import { s, slider, plot, path, sig, put } from './kit.js';

/** The step response: {t, y, u} arrays and the measurements. */
export function simulate({ K = 1, tau = 10, theta = 2, kp = 1, ki = 0.1, kd = 0, t_end = 80, umax = null, sp = 1 }) {
  const dt = Math.min(tau, theta || tau) / 40, n = Math.ceil(t_end / dt), lag = Math.round(theta / dt);
  const buf = new Array(lag).fill(0), t = [], y = [], u = [];
  let pv = 0, prev = 0, I = 0;
  for (let i = 0; i <= n; i++) {
    const e = sp - pv, D = -kd * (pv - prev) / dt;
    let out = kp * e + I + ki * e * dt + D;
    const clamp = umax != null && Math.abs(out) > umax;
    if (clamp) out = Math.sign(out) * umax; else I += ki * e * dt;          // no wind-up while the output is at its limit
    t.push(i * dt); y.push(pv); u.push(out);
    prev = pv;
    buf.push(out);
    pv += dt * (K * buf.shift() - pv) / tau;
    if (!isFinite(pv) || Math.abs(pv) > 1e6) break;
  }
  const peak = Math.max(...y), end = y[y.length - 1];
  const cross = f => { const i = y.findIndex(v => v >= f * sp); return i < 0 ? null : t[i]; };
  let last = -1;
  y.forEach((v, i) => { if (Math.abs(v - sp) > 0.02 * sp) last = i; });
  const settled = last < y.length - 1 && t[t.length - 1] >= t_end - dt;
  // growing: the swing in the last quarter is bigger than in the second
  const swing = (a, b) => Math.max(...y.slice(Math.floor(a * y.length), Math.floor(b * y.length)).map(v => Math.abs(v - sp)));
  const growing = swing(0.75, 1) > 0.05 && swing(0.75, 1) > 1.05 * swing(0.25, 0.5);
  return { t, y, u, overshoot: Math.max(0, (peak - sp) / sp * 100), rise: cross(0.9) != null && cross(0.1) != null ? cross(0.9) - cross(0.1) : null,
           settling: settled ? t[last + 1] : null, sse: sp - end, unstable: !isFinite(end) || Math.abs(end) > 10 || growing };
}

/** The names a card's question can use (tests/content.check.mjs holds cards to them). */
export const REPORTS = ['kp', 'ki', 'kd', 'K', 'tau', 'theta', 'overshoot', 'rise', 'settling', 'sse'];

export function mount(box, p, report) {
  const st = { K: p.K ?? 1, tau: p.tau ?? 10, theta: p.theta ?? 2, kp: p.kp ?? 1, ki: p.ki ?? 0.1, kd: p.kd ?? 0, t_end: p.t_end ?? 80, umax: p.umax ?? null };
  const pic = el('div', { class: 'wscreen' }), read = el('div', { class: 'wread num small' });
  const draw = () => {
    const r = simulate(st);
    const top = Math.min(2.5, Math.max(1.4, Math.ceil(Math.max(...r.y.filter(isFinite)) * 5) / 5 + 0.2));
    const P = plot({ x: [0, st.t_end], y: [-0.2, top], xlabel: 'time (s)', ylabel: 'PV', label: 'Step response' });
    const every = Math.max(1, Math.floor(r.t.length / 600));
    const pts = k => r.t.map((x, i) => [x, r[k][i]]).filter((_, i) => i % every === 0);
    P.layer.append(s('line', { class: 'sp', x1: P.X(0), x2: P.X(st.t_end), y1: P.Y(1), y2: P.Y(1) }),
      s('line', { class: 'band', x1: P.X(0), x2: P.X(st.t_end), y1: P.Y(1.02), y2: P.Y(1.02) }),
      s('line', { class: 'band', x1: P.X(0), x2: P.X(st.t_end), y1: P.Y(0.98), y2: P.Y(0.98) }),
      s('path', { class: 'uout', d: path(pts('u').map(([x, v]) => [x, Math.max(-0.2, Math.min(top, v))]), P.X, P.Y) }),
      s('path', { class: 'trace', d: path(pts('y'), P.X, P.Y) }),
      r.settling != null ? s('line', { class: 'mark', x1: P.X(r.settling), x2: P.X(r.settling), y1: P.Y(-0.2), y2: P.Y(top) }) : null);
    pic.replaceChildren(P.svg);
    put(read, el('span', { class: 'wkey' }, el('i', { class: 'k-pv' }), 'PV'), el('span', { class: 'wkey' }, el('i', { class: 'k-out' }), 'controller output'),
      r.unstable ? el('strong', { class: 'warn' }, 'Unstable: the loop grows without end. Take gain off.')
        : el('strong', {}, `Overshoot ${sig(r.overshoot)}% · rise ${sig(r.rise)} s · settles in ${r.settling == null ? 'more than ' + st.t_end : sig(r.settling)} s`),
      !r.unstable && Math.abs(r.sse) > 0.005 ? el('span', {}, `still ${sig(r.sse)} off at the end${st.ki ? '' : ' (no integral action)'}`) : null);
    report({ kp: st.kp, ki: st.ki, kd: st.kd, K: st.K, tau: st.tau, theta: st.theta, overshoot: r.overshoot, rise: r.rise ?? 0,
             settling: r.settling ?? 0, sse: r.sse });
  };
  const set = (k, v) => { st[k] = v; draw(); };
  const rows = {
    kp: () => slider('Kp', { min: 0, max: p.max?.kp ?? 10, step: 0.05, value: st.kp }, v => set('kp', v)),
    ki: () => slider('Ki', { min: 0, max: p.max?.ki ?? 1, step: 0.005, value: st.ki, unit: '/s' }, v => set('ki', v)),
    kd: () => slider('Kd', { min: 0, max: p.max?.kd ?? 20, step: 0.1, value: st.kd, unit: 's' }, v => set('kd', v)),
    K: () => slider('Plant gain K', { min: 0.2, max: 5, step: 0.1, value: st.K }, v => set('K', v)),
    tau: () => slider('Time constant τ', { min: 1, max: 40, step: 0.5, value: st.tau, unit: 's' }, v => set('tau', v)),
    theta: () => slider('Dead time θ', { min: 0, max: 10, step: 0.1, value: st.theta, unit: 's' }, v => set('theta', v)),
  };
  box.append(pic, read, el('div', { class: 'wcontrols' }, (p.controls || ['kp', 'ki', 'kd']).map(c => rows[c]?.())));
  draw();
}
