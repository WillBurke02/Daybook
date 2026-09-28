// A PLC timer's timing diagram: the input IN, the output Q and the elapsed time ET, for the
// three IEC timers. Move the input's on and off times and the preset PT and watch Q.
//   TON  on-delay:  Q comes on PT after IN, if IN stays on that long; off with IN
//   TOF  off-delay: Q on with IN; off PT after IN goes off
//   TP   pulse:     Q on for exactly PT from IN coming on, however long IN stays on
//
// params: {type: 'TON' | 'TOF' | 'TP', PT, on, off, controls: ['type', 'PT', 'on', 'off']}
// reports: PT, on, off (s), q_on, q_off (s: when Q comes on and goes off; -1 if Q never comes on), q_len (s)
import { el } from '../core/dom.js';
import { s, slider, choose, sig, put } from './kit.js';

export const REPORTS = ['PT', 'on', 'off', 'q_on', 'q_off', 'q_len'];
const END = 10;

/** When Q is on: [start, end] or null, for one pulse on IN from `on` to `off`. */
export function output({ type, PT, on, off }) {
  if (type === 'TON') return off - on >= PT ? [on + PT, off] : null;
  if (type === 'TOF') return [on, off + PT];
  return [on, on + PT];                                        // TP
}

export function mount(box, p, report) {
  const st = { type: p.type || 'TON', PT: p.PT ?? 2, on: p.on ?? 1, off: p.off ?? 5 };
  const pic = el('div', { class: 'wscreen' }), read = el('div', { class: 'wread num small' });
  const draw = () => {
    if (st.off < st.on) st.off = st.on;
    const q = output(st);
    const W = 480, L = 44, R = 12, X = t => L + Math.min(t, END) / END * (W - L - R);
    const row = (y, label, spans) => s('g', {}, s('text', { x: 6, y: y + 4 }, label),
      s('path', { class: 'trace', d: `M${X(0)} ${y + 12}` + spans.map(([a, b]) => `H${X(a)} V${y - 8} H${X(b)} V${y + 12}`).join('') + `H${X(END)}` }));
    // ET: climbs while timing, holds at PT, back to 0 when the timer resets
    const pts = [[0, 0]];
    if (st.type === 'TON') { const top = Math.min(st.off - st.on, st.PT); pts.push([st.on, 0], [st.on + top, top], [st.off, top], [st.off, 0]); }
    else if (st.type === 'TOF') pts.push([st.off, 0], [Math.min(st.off + st.PT, END), Math.min(END - st.off, st.PT)]);
    else { const hold = Math.max(st.off, st.on + st.PT); pts.push([st.on, 0], [st.on + st.PT, st.PT], [hold, st.PT], [hold, 0]); }
    pts.push([END, pts[pts.length - 1][1]]);
    const et = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)} ${(150 - 34 * v / st.PT).toFixed(1)}`);
    const ticks = [0, 2, 4, 6, 8, 10].map(t => s('g', { class: 'wgrid' }, s('line', { x1: X(t), x2: X(t), y1: 12, y2: 158 }), s('text', { x: X(t), y: 172, 'text-anchor': 'middle' }, `${t} s`)));
    pic.replaceChildren(s('svg', { viewBox: `0 0 ${W} 180`, class: 'wplot', role: 'img', 'aria-label': `${st.type} timing diagram` },
      ...ticks, row(34, 'IN', [[st.on, st.off]]), row(84, 'Q', q ? [q] : []),
      s('text', { x: 6, y: 138 }, 'ET'), s('path', { class: 'uout', d: et.join('') }),
      s('text', { x: X(END) - 2, y: 124, 'text-anchor': 'end', class: 'sub' }, `PT ${sig(st.PT)} s`)));
    put(read, el('strong', {}, q ? `Q on at ${sig(q[0])} s, off at ${sig(q[1])} s (${sig(q[1] - q[0])} s)` : 'Q never comes on: IN was not on for PT'),
      el('span', {}, { TON: 'on-delay', TOF: 'off-delay', TP: 'pulse' }[st.type]));
    report({ PT: st.PT, on: st.on, off: st.off, q_on: q ? q[0] : -1, q_off: q ? q[1] : -1, q_len: q ? q[1] - q[0] : 0 });
  };
  const rows = {
    type: () => choose('Timer', [['TON', 'TON on-delay'], ['TOF', 'TOF off-delay'], ['TP', 'TP pulse']], st.type, v => { st.type = v; draw(); }),
    PT: () => slider('Preset PT', { min: 0.5, max: 5, step: 0.5, value: st.PT, unit: 's' }, v => { st.PT = v; draw(); }),
    on: () => slider('IN on at', { min: 0, max: 6, step: 0.5, value: st.on, unit: 's' }, v => { st.on = v; draw(); }),
    off: () => slider('IN off at', { min: 0.5, max: 8, step: 0.5, value: st.off, unit: 's' }, v => { st.off = v; draw(); }),
  };
  box.append(pic, read, el('div', { class: 'wcontrols' }, (p.controls || ['type', 'PT', 'on', 'off']).map(c => rows[c]?.())));
  draw();
}
