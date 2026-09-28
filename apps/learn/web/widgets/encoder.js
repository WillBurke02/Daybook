// An incremental encoder: two square waves, A and B, a quarter of a cycle apart. How many
// cycles a turn is the PPR (pulses per revolution); counting every edge of both gives four
// counts per pulse (×4 decoding). Which one leads tells the direction.
//   frequency of A = rpm × PPR / 60      counts a turn (×4) = 4 × PPR      resolution = 360° / (4 × PPR)
//
// params: {ppr, rpm, dir: 1 | -1, controls: ['ppr', 'rpm', 'dir']}
// reports: ppr, rpm, freq (Hz), counts (per turn, ×4), deg (degrees per count), dir
import { el } from '../core/dom.js';
import { s, slider, choose, sig, put } from './kit.js';

export const REPORTS = ['ppr', 'rpm', 'freq', 'counts', 'deg', 'dir'];

export function mount(box, p, report) {
  const st = { ppr: p.ppr ?? 1024, rpm: p.rpm ?? 1500, dir: p.dir ?? 1 };
  const pic = el('div', { class: 'wscreen' }), read = el('div', { class: 'wread num small' });
  const draw = () => {
    const freq = st.rpm * st.ppr / 60, counts = 4 * st.ppr, deg = 360 / counts;
    const W = 480, L = 30, R = 10, cycles = 4, X = u => L + u / cycles * (W - L - R);   // u in cycles of A
    // B is a quarter cycle behind A going forwards, a quarter ahead in reverse
    const wave = (y, shift) => {
      const high = u => ((((u - shift) % 1) + 1) % 1) < 0.5, lv = h => h ? y - 10 : y + 14;
      let d = `M${X(0)} ${lv(high(1e-6))}`;
      for (let k = Math.ceil(-shift * 2); shift + k / 2 < cycles; k++) {
        const u = shift + k / 2;
        if (u > 0) d += `H${X(u).toFixed(1)}V${lv(high(u + 1e-6))}`;
      }
      return s('path', { class: 'trace', d: d + `H${X(cycles)}` });
    };
    const edges = [];
    for (let q = 0; q <= cycles * 4; q++) edges.push(s('line', { class: 'band', x1: X(q / 4), x2: X(q / 4), y1: 16, y2: 120 }));
    pic.replaceChildren(s('svg', { viewBox: `0 0 ${W} 150`, class: 'wplot', role: 'img', 'aria-label': 'Encoder channels A and B' },
      ...edges, s('text', { x: 6, y: 44 }, 'A'), wave(40, 0), s('text', { x: 6, y: 100 }, 'B'), wave(96, st.dir > 0 ? 0.25 : -0.25),
      s('text', { x: X(cycles) - 2, y: 142, 'text-anchor': 'end' }, `each line is one count: 4 per cycle · one cycle = ${sig(1e6 / freq)} µs`)));
    put(read, el('strong', {}, `A runs at ${sig(freq)} Hz; ${counts} counts a turn (×4), ${sig(deg)}° a count`),
      el('span', {}, st.dir > 0 ? 'A leads B: forwards' : 'B leads A: backwards'));
    report({ ppr: st.ppr, rpm: st.rpm, freq, counts, deg, dir: st.dir });
  };
  const rows = {
    ppr: () => choose('PPR', [[100, '100'], [360, '360'], [500, '500'], [1000, '1000'], [1024, '1024'], [2048, '2048'], [2500, '2500']].map(([v, l]) => [String(v), l]),
      String(st.ppr), v => { st.ppr = +v; draw(); }),
    rpm: () => slider('Speed', { min: 0, max: 3000, step: 50, value: st.rpm, unit: 'rpm' }, v => { st.rpm = v; draw(); }),
    dir: () => choose('Direction', [['1', 'Forwards'], ['-1', 'Backwards']], String(st.dir), v => { st.dir = +v; draw(); }),
  };
  box.append(pic, read, el('div', { class: 'wcontrols' }, (p.controls || ['ppr', 'rpm', 'dir']).map(c => rows[c]?.())));
  draw();
}
