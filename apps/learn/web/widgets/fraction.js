// A fraction as a bar cut into equal parts, some shaded, beside its decimal and its
// percentage: the same amount written three ways. Past one whole, a second bar starts.
//
// params: {num, den, controls: ['num', 'den']}
// reports: num, den, dec (the decimal), pct (per cent), top, bottom (the simplest form)
import { el } from '../core/dom.js';
import { s, slider, sig, put } from './kit.js';

export const REPORTS = ['num', 'den', 'dec', 'pct', 'top', 'bottom'];
const gcd = (a, b) => b ? gcd(b, a % b) : a;

export function mount(box, p, report) {
  const st = { num: p.num ?? 3, den: p.den ?? 4 };
  const pic = el('div', { class: 'wscreen' }), read = el('div', { class: 'wread weq num' });
  const draw = () => {
    const { num, den } = st, g = gcd(num, den) || 1, bars = Math.max(1, Math.ceil(num / den));
    const W = 480, L = 20, R = 20, bw = W - L - R, H = 34, gap = 14;
    const rects = [];
    for (let b = 0; b < bars; b++) for (let i = 0; i < den; i++) {
      const k = b * den + i;
      rects.push(s('rect', { class: k < num ? 'part on' : 'part', x: L + i * bw / den, y: 12 + b * (H + gap), width: bw / den, height: H }));
    }
    pic.replaceChildren(s('svg', { viewBox: `0 0 ${W} ${24 + bars * (H + gap)}`, class: 'wplot wfrac', role: 'img',
      'aria-label': `${num} out of ${den} equal parts shaded` }, ...rects));
    const dec = num / den;
    put(read, el('span', {}, `${num}/${den}`), g > 1 ? el('span', {}, `= ${num / g}/${den / g}`) : null,
      el('span', {}, `= ${sig(dec, 6)}`), el('span', {}, `= ${sig(dec * 100, 6)}%`));
    report({ num, den, dec, pct: dec * 100, top: num / g, bottom: den / g });
  };
  const rows = {
    num: () => slider('Shaded parts', { min: 0, max: 20, step: 1, value: st.num }, v => { st.num = v; draw(); }),
    den: () => slider('Equal parts', { min: 1, max: 20, step: 1, value: st.den }, v => { st.den = v; draw(); }),
  };
  box.append(pic, read, el('div', { class: 'wcontrols' }, (p.controls || ['num', 'den']).map(c => rows[c]?.())));
  draw();
}
