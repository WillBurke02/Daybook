// ★ Acoustic impedance (§7.7): two materials meet at an interface; how much of the
// sound comes back and how much goes on. Z = ρv; R = ((Z₂ − Z₁)/(Z₂ + Z₁))², T = 1 − R
// (intensity, at normal incidence).
//
// params: {a, b, controls: ['a', 'b']}  material keys below
// reports: Z1, Z2 (MRayl), ratio (r, the amplitude ratio, negative when the phase flips), refl and trans (R and T, per cent)
import { el } from '../core/dom.js';
import { s, choose, sig, put } from './kit.js';

// Typical densities (kg/m³) and longitudinal velocities (m/s); your procedure's figures take precedence.
export const MATERIALS = {
  air: ['Air', 1.2, 343], water: ['Water', 1000, 1480], gel: ['Couplant gel (glycerine)', 1260, 1920], oil: ['Oil (typical)', 900, 1400],
  perspex: ['Perspex', 1180, 2730], aluminium: ['Aluminium', 2700, 6320], steel: ['Steel', 7850, 5920], copper: ['Copper', 8900, 4660],
};
export const z = k => MATERIALS[k][1] * MATERIALS[k][2] / 1e6;                // MRayl
export function split(z1, z2) { const r = (z2 - z1) / (z2 + z1); return { r, R: r * r, T: 1 - r * r }; }

/** The names a card's question can use (tests/content.check.mjs holds cards to them). */
export const REPORTS = ['Z1', 'Z2', 'ratio', 'refl', 'trans'];   // formula names ignore case, so not r and R

export function mount(box, p, report) {
  const st = { a: p.a || 'water', b: p.b || 'steel' };
  const pic = el('div', { class: 'wscreen' });
  const read = el('div', { class: 'wread num small' });
  const draw = () => {
    const Z1 = z(st.a), Z2 = z(st.b), { r, R, T } = split(Z1, Z2);
    const W = 480, H = 200, mid = W / 2, thick = 22, arrow = (x1, y1, x2, y2, wd, cls) => {
      const a = Math.atan2(y2 - y1, x2 - x1), hw = Math.max(wd, 3) / 2 + 5, len = 12;
      const bx = x2 - len * Math.cos(a), by = y2 - len * Math.sin(a);
      return s('g', { class: cls },
        wd > 0.4 ? s('line', { x1, y1, x2: bx, y2: by, 'stroke-width': wd }) : null,
        s('polygon', { points: `${x2},${y2} ${bx - hw * Math.sin(a)},${by + hw * Math.cos(a)} ${bx + hw * Math.sin(a)},${by - hw * Math.cos(a)}`, opacity: wd > 0.4 ? 1 : 0.35 }));
    };
    pic.replaceChildren(s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'wplot', role: 'img', 'aria-label': `${MATERIALS[st.a][0]} to ${MATERIALS[st.b][0]}` },
      s('rect', { class: 'm1', x: 0, y: 0, width: mid, height: H }), s('rect', { class: 'm2', x: mid, y: 0, width: mid, height: H }),
      s('line', { class: 'iface', x1: mid, x2: mid, y1: 0, y2: H }),
      s('text', { x: 10, y: 20 }, MATERIALS[st.a][0]), s('text', { x: mid + 10, y: 20 }, MATERIALS[st.b][0]),
      s('text', { x: 10, y: H - 10, class: 'num' }, `Z₁ = ${sig(Z1)} MRayl`), s('text', { x: mid + 10, y: H - 10, class: 'num' }, `Z₂ = ${sig(Z2)} MRayl`),
      arrow(30, 70, mid - 4, 70, thick, 'inc'),
      arrow(mid - 4, 128, 30, 128, thick * R, 'refl'),
      arrow(mid + 4, 70, W - 30, 70, thick * T, 'trans'),
      s('text', { x: 36, y: 60 }, 'in: 100%'), s('text', { x: 36, y: 158 }, `back: ${sig(100 * R)}%`), s('text', { x: mid + 12, y: 106 }, `on: ${sig(100 * T)}%`)));
    put(read, el('span', {}, `r = (Z₂ − Z₁)/(Z₂ + Z₁) = ${sig(r)}`), el('strong', {}, `R = ${sig(100 * R)}%, T = ${sig(100 * T)}%`),
      el('span', {}, T > 0 ? `transmitted ${sig(10 * Math.log10(T))} dB` : ''), r < 0 ? el('span', {}, 'the reflection comes back inverted (Z₂ < Z₁)') : null);
    report({ Z1, Z2, ratio: r, refl: 100 * R, trans: 100 * T });
  };
  const opts = Object.entries(MATERIALS).map(([k, [l]]) => [k, l]);
  const rows = { a: () => choose('First material', opts, st.a, v => { st.a = v; draw(); }), b: () => choose('Second material', opts, st.b, v => { st.b = v; draw(); }) };
  box.append(pic, read, el('div', { class: 'wcontrols' }, (p.controls || ['a', 'b']).map(c => rows[c]?.())));
  draw();
}
