// ★ Pulse-echo A-scan (§7.7). A normal (0°) probe on a plate: the initial pulse,
// a flaw echo and the back-wall echoes (with their repeats), on a screen of time
// against amplitude. Gain in dB, attenuation, and a gate that reads the first echo
// through it: time of flight, amplitude and depth.
//
// params: {material, v, thickness, flaw, size, gain, atten, gate: [start µs, width µs], level, range, freq, controls: [...]}
//   controls from: material, gain, thickness, flaw, size, atten, gate, range
// reports: v (m/s), thickness, flaw (mm, 0 = none), gain (dB), t_bw and t_flaw (µs), tof (µs), amp (%), depth (mm), range
// ponytail: a teaching model, not a simulator. Echo heights follow dB arithmetic (6 dB doubles them),
// attenuation is a flat dB/mm, beam spread and near field are left out.
import { el } from '../core/dom.js';
import { s, slider, choose, plot, path, sig, put } from './kit.js';

// Typical longitudinal velocities. Your procedure and calibration block give the figures to use.
export const MATERIALS = { steel: ['Steel (carbon)', 5920], stainless: ['Stainless steel', 5790], aluminium: ['Aluminium', 6320],
  copper: ['Copper', 4660], perspex: ['Perspex', 2730] };
const REF = 80;              // % screen height of the first back wall at 20 dB with no attenuation
const tof = (d, v) => 2 * d / v * 1000;          // mm and m/s to µs, there and back

/** The names a card's question can use (tests/content.check.mjs holds cards to them). */
export const REPORTS = ['v', 'thickness', 'flaw', 'gain', 't_bw', 't_flaw', 'range', 'tof', 'amp', 'depth'];

export function mount(box, p, report) {
  const st = { material: p.material || 'steel', v: p.v, T: p.thickness ?? 25, flaw: p.flaw ?? 0, size: p.size ?? 0.5, gain: p.gain ?? 20,
               atten: p.atten ?? 0.01, level: p.level ?? 20, freq: p.freq ?? 5 };
  const vel = () => st.v ?? MATERIALS[st.material][1];
  const range = p.range ?? Math.max(10, Math.ceil(2.4 * tof(st.T, vel()) / 5) * 5);
  st.range = range;
  const g0 = st.flaw ? tof(st.flaw, vel()) - 1 : tof(st.T, vel()) - 1;
  st.gs = p.gate?.[0] ?? Math.max(0.5, +g0.toFixed(1));
  st.gw = p.gate?.[1] ?? 2;
  const controls = p.controls || ['gain', 'thickness', 'flaw', 'gate'];

  // the grass: fixed pseudo-random noise, so it does not flicker as you move a slider
  let seed = 7;
  const N = 1400, grass = Array.from({ length: N + 1 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));

  const holder = el('div', { class: 'wscreen' });
  const read = el('div', { class: 'wread num small' });
  const echoes = () => {
    const v = vel(), a = g => REF * 10 ** ((st.gain - 20) / 20) * g;
    const loss = d => 10 ** (-st.atten * 2 * d / 20);
    const tb = tof(st.T, v), out = [{ t: 0, h: 400, w: 0.5 }];                        // the initial pulse, always saturated
    const flaw = st.flaw > 0 && st.flaw < st.T;
    if (flaw) out.push({ t: tof(st.flaw, v), h: a(0.9 * st.size * loss(st.flaw)) });
    const shadow = flaw ? 1 - 0.8 * st.size : 1;
    for (let k = 1; k <= 4; k++) out.push({ t: k * tb, h: a(shadow * 0.55 ** (k - 1) * loss(k * st.T)) });
    return { out, tb, tf: flaw ? tof(st.flaw, v) : null };
  };
  const draw = () => {
    const { out, tb, tf } = echoes();
    const w = 1.2 / st.freq;
    const noise = 1.5 * 10 ** ((st.gain - 20) / 20);
    const amp = t => {
      let y = 0;
      for (const e of out) { const d = (t - e.t) / (e.w || w); if (Math.abs(d) < 4) y += e.h * Math.exp(-d * d) * (0.7 + 0.3 * Math.abs(Math.cos(Math.PI * st.freq * (t - e.t)))); }
      return y;
    };
    const pts = [];
    for (let i = 0; i <= N; i++) { const t = st.range * i / N; pts.push([t, Math.min(100, amp(t) + noise * grass[i])]); }
    // the gate: the first echo to break its level, then that echo's peak
    let hit = null;
    for (const [t, y] of pts) {
      if (t < st.gs || t > st.gs + st.gw) continue;
      if (!hit && y >= st.level) hit = { t, y };
      else if (hit && y >= hit.y) hit = { t, y };
      else if (hit && y < st.level) break;
    }
    const P = plot({ x: [0, st.range], y: [0, 100], xlabel: 'time (µs)', ylabel: '% screen height', label: 'A-scan' });
    P.layer.append(s('path', { class: 'trace', d: path(pts, P.X, P.Y) }),
      s('line', { class: 'gate', x1: P.X(st.gs), x2: P.X(Math.min(st.range, st.gs + st.gw)), y1: P.Y(st.level), y2: P.Y(st.level) }),
      hit ? s('circle', { class: 'gatehit', cx: P.X(hit.t), cy: P.Y(hit.y), r: 3.5 }) : null);
    holder.replaceChildren(P.svg);
    const depth = hit ? vel() * hit.t / 2000 : null;
    put(read, 
      el('span', {}, `v = ${vel()} m/s`), el('span', {}, `back wall ${sig(tb)} µs`), tf ? el('span', {}, `flaw ${sig(tf)} µs`) : null,
      el('strong', {}, hit ? `Gate: ${sig(hit.t)} µs · ${Math.round(hit.y)}% · depth ${sig(depth)} mm` : 'Gate: nothing breaks it'),
      hit && hit.y >= 100 ? el('span', { class: 'warn' }, 'saturated: take gain off to read the height') : null);
    report({ v: vel(), thickness: st.T, flaw: st.flaw, gain: st.gain, t_bw: tb, t_flaw: tf ?? 0, range: st.range,
             tof: hit ? hit.t : 0, amp: hit ? Math.round(hit.y) : 0, depth: depth ?? 0 });
  };
  const set = (k, v) => { st[k] = v; draw(); };
  const flawSlider = slider('Flaw depth', { min: 0, max: 100, step: 0.5, value: st.flaw, unit: 'mm', fmt: v => v ? v : 'none' }, v => set('flaw', v));
  const rows = {
    material: () => choose('Material', Object.entries(MATERIALS).map(([k, [l, v]]) => [k, `${l}, ${v} m/s`]), st.material, v => { st.v = undefined; set('material', v); }),
    gain: () => slider('Gain', { min: 0, max: 60, step: 0.5, value: st.gain, unit: 'dB' }, v => set('gain', v)),
    thickness: () => slider('Thickness', { min: 5, max: 100, step: 1, value: st.T, unit: 'mm' }, v => set('T', v)),
    flaw: () => flawSlider,
    size: () => slider('Flaw size', { min: 0.1, max: 1, step: 0.1, value: st.size, fmt: v => v < 0.35 ? 'small' : v < 0.7 ? 'medium' : 'large' }, v => set('size', v)),
    atten: () => slider('Attenuation', { min: 0, max: 0.2, step: 0.005, value: st.atten, unit: 'dB/mm' }, v => set('atten', v)),
    gate: () => [slider('Gate start', { min: 0, max: st.range, step: 0.1, value: st.gs, unit: 'µs' }, v => set('gs', v)),
                 slider('Gate width', { min: 0.5, max: st.range / 2, step: 0.1, value: st.gw, unit: 'µs' }, v => set('gw', v))],
    range: () => slider('Range', { min: 5, max: 100, step: 1, value: st.range, unit: 'µs' }, v => set('range', v)),
  };
  box.append(holder, read, el('div', { class: 'wcontrols' }, controls.map(c => rows[c]?.())));
  draw();
}
