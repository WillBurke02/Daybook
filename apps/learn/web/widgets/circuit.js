// A DC circuit: a battery and two resistors, in series or in parallel. Ohm's law for each
// part, Kirchhoff's laws for the whole: in series one current and the voltages add up to
// the battery's; in parallel one voltage and the currents add up to the total.
//
// params: {V, R1, R2, mode: 'series' | 'parallel', controls: ['V', 'R1', 'R2', 'mode']}
// reports: V, R1, R2, Rt (total), I (from the battery), I1, I2, V1, V2 (across each), P (watts from the battery)
import { el } from '../core/dom.js';
import { s, slider, choose, sig, put } from './kit.js';

export const REPORTS = ['V', 'R1', 'R2', 'Rt', 'I', 'I1', 'I2', 'V1', 'V2', 'P'];

/** Everything about the circuit, in volts, ohms, amps and watts. */
export function solve({ V, R1, R2, mode }) {
  if (mode === 'parallel') {
    const Rt = R1 * R2 / (R1 + R2), I1 = V / R1, I2 = V / R2;
    return { Rt, I: I1 + I2, I1, I2, V1: V, V2: V, P: V * (I1 + I2) };
  }
  const Rt = R1 + R2, I = V / Rt;
  return { Rt, I, I1: I, I2: I, V1: I * R1, V2: I * R2, P: V * I };
}

const amps = i => i < 1 ? `${sig(i * 1000)} mA` : `${sig(i)} A`;

export function mount(box, p, report) {
  const st = { V: p.V ?? 12, R1: p.R1 ?? 100, R2: p.R2 ?? 220, mode: p.mode || 'series' };
  const pic = el('div', { class: 'wscreen' }), read = el('div', { class: 'wread num small' });
  const resistor = (x, y, vertical, label, sub) => vertical
    ? s('g', {}, s('rect', { class: 'res', x: x - 9, y: y - 26, width: 18, height: 52, rx: 2 }),
        s('text', { x: x + 16, y: y - 4 }, label), s('text', { x: x + 16, y: y + 12, class: 'sub' }, sub))
    : s('g', {}, s('rect', { class: 'res', x: x - 26, y: y - 9, width: 52, height: 18, rx: 2 }),
        s('text', { x, y: y - 16, 'text-anchor': 'middle' }, label), s('text', { x, y: y + 30, 'text-anchor': 'middle', class: 'sub' }, sub));
  const draw = () => {
    const r = solve(st);
    const W = 480, H = 230, L = 60, R = 420, T = 40, B = 190;
    const wire = d => s('path', { class: 'wire', d });
    const battery = s('g', {}, s('line', { class: 'cell', x1: L - 16, x2: L + 16, y1: 105, y2: 105 }),
      s('line', { class: 'cell short', x1: L - 9, x2: L + 9, y1: 115, y2: 115 }),
      s('text', { x: L - 22, y: 100, 'text-anchor': 'end' }, `${sig(st.V)} V`), s('text', { x: L + 12, y: 100, class: 'sub' }, '+'));
    const parts = st.mode === 'parallel'
      ? [wire(`M${L} ${T} H${R} M${L} ${B} H${R} M300 ${T} V${B} M${R} ${T} V${B}`),
         resistor(300, 115, true, `R1 ${sig(st.R1)} Ω`, amps(r.I1)), resistor(R, 115, true, `R2 ${sig(st.R2)} Ω`, amps(r.I2))]
      : [wire(`M${L} ${T} H${R} V${B} H${L}`),
         resistor(190, T, false, `R1 ${sig(st.R1)} Ω`, `${sig(r.V1)} V`), resistor(R, 115, true, `R2 ${sig(st.R2)} Ω`, `${sig(r.V2)} V`)];
    pic.replaceChildren(s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'wplot wcircuit', role: 'img',
        'aria-label': `${st.mode} circuit: ${st.V} volts, ${st.R1} and ${st.R2} ohms` },
      wire(`M${L} ${T} V100 M${L} 120 V${B}`), battery, ...parts,
      s('text', { x: L + 8, y: T - 12 }, `I = ${amps(r.I)} →`)));
    put(read, el('strong', {}, `Total resistance ${sig(r.Rt)} Ω, current ${amps(r.I)}`),
      st.mode === 'series' ? el('span', {}, `${sig(r.V1)} V + ${sig(r.V2)} V = ${sig(r.V1 + r.V2)} V`)
        : el('span', {}, `${amps(r.I1)} + ${amps(r.I2)} = ${amps(r.I1 + r.I2)}`),
      el('span', {}, `power ${sig(r.P)} W`));
    report({ V: st.V, R1: st.R1, R2: st.R2, ...r });
  };
  const rows = {
    V: () => slider('Battery', { min: 1, max: 24, step: 0.5, value: st.V, unit: 'V' }, v => { st.V = v; draw(); }),
    R1: () => slider('R1', { min: 10, max: 1000, step: 10, value: st.R1, unit: 'Ω' }, v => { st.R1 = v; draw(); }),
    R2: () => slider('R2', { min: 10, max: 1000, step: 10, value: st.R2, unit: 'Ω' }, v => { st.R2 = v; draw(); }),
    mode: () => choose('Wired in', [['series', 'Series'], ['parallel', 'Parallel']], st.mode, v => { st.mode = v; draw(); }),
  };
  box.append(pic, read, el('div', { class: 'wcontrols' }, (p.controls || ['V', 'R1', 'R2', 'mode']).map(c => rows[c]?.())));
  draw();
}
