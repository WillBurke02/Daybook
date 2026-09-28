// ★ Mini PLC, the Structured Text half (§7.7): the scan cycle you can step through.
// 1 read the inputs into the input image, 2 run the program top to bottom once,
// 3 write the output image to the outputs. A switch flicked after step 1 is not
// seen until the next scan; a variable written twice ends the scan with the second value.
//
// params: {src, inputs: [...], outputs: [...], scan_ms, editable}
// reports: scans, time (ms), and each output as 1 or 0
// ponytail: ST only; the ladder view (rungs drawn and powered) is the later half.
import { el } from '../core/dom.js';
import { compile, machine, scan } from '../st.js';
import { put } from './kit.js';

const PHASES = ['Read inputs', 'Run the program', 'Write outputs'];

/** The names a card's question can use (tests/content.check.mjs holds cards to them). */
export const REPORTS = ['scans', 'time'];   // and each output, by its name

export function mount(box, p, report) {
  const ins = p.inputs || ['Start', 'Stop'], outs = p.outputs || ['Motor'], dt = p.scan_ms || 100;
  const code = p.editable ? el('textarea', { class: 'st mono', rows: Math.max(4, String(p.src || '').split('\n').length + 1), spellcheck: false, 'aria-label': 'Program' }, p.src || '')
    : el('pre', { class: 'st' }, p.src || '');
  const err = el('p', { class: 'err', hidden: true });
  const phaseBox = el('ol', { class: 'phases' }, PHASES.map(t => el('li', {}, t)));
  const physical = Object.fromEntries(ins.map(n => [n, false]));
  const lampEls = Object.fromEntries(outs.map(n => [n, el('span', { class: 'lamp' })]));
  const imageBox = el('div', { class: 'images num small' });
  const status = el('span', { class: 'num small muted' });
  let m, phase, inImage, outImage, lamps;

  const reset = () => {
    try { m = machine(compile(p.editable ? code.value : p.src), { inputs: ins, outputs: outs }); err.hidden = true; }
    catch (e) { m = null; err.textContent = e.message; err.hidden = false; }
    phase = 0; inImage = Object.fromEntries(ins.map(n => [n, false]));
    outImage = Object.fromEntries(outs.map(n => [n, false])); lamps = { ...outImage };
    show();
  };
  const show = () => {
    [...phaseBox.children].forEach((li, i) => li.classList.toggle('on', i === phase));
    for (const n of outs) lampEls[n].classList.toggle('on', !!lamps[n]);
    const others = m ? Object.entries(m.vars).filter(([k]) => !ins.includes(k) && !outs.includes(k))
      .map(([k, v]) => `${k} = ${typeof v === 'object' ? (v.ET != null ? `${v.Q ? 'Q' : '–'} ${v.ET} ms` : v.CV != null ? `CV ${v.CV}` : v.Q ? 'Q' : '–') : v}`) : [];
    put(imageBox, 
      el('div', {}, el('strong', {}, 'Input image '), ins.map(n => `${n} = ${inImage[n] ? 1 : 0}`).join('  ')),
      el('div', {}, el('strong', {}, 'Output image '), outs.map(n => `${n} = ${outImage[n] ? 1 : 0}`).join('  ')),
      others.length ? el('div', { class: 'muted' }, others.join('  ')) : null);
    status.textContent = m ? `scan ${m.scans} · ${(m.time / 1000).toFixed(1)} s` : '';
    report({ scans: m?.scans || 0, time: m?.time || 0, ...Object.fromEntries(outs.map(n => [n, lamps[n] ? 1 : 0])) });
  };
  const step = () => {
    if (!m) return;
    try {
      if (phase === 0) Object.assign(inImage, physical);
      if (phase === 1) { scan(m, inImage, dt); outs.forEach(n => { outImage[n] = !!m.vars[n]; }); }
      if (phase === 2) Object.assign(lamps, outImage);
      phase = (phase + 1) % 3;
    } catch (e) { err.textContent = e.message; err.hidden = false; stop(); phase = 0; }
    show();
  };
  const whole = () => { do step(); while (phase !== 0 && m); };
  let timer = null;
  const run = el('button', { class: 'btn plain sm', type: 'button' }, '▶ Run');
  const stop = () => { clearInterval(timer); timer = null; run.textContent = '▶ Run'; };
  run.addEventListener('click', () => {
    if (timer) { stop(); return; }
    timer = setInterval(() => { if (!box.isConnected) stop(); else whole(); }, dt);
    run.textContent = '■ Stop';
  });
  if (p.editable) code.addEventListener('change', () => { stop(); reset(); });

  box.append(el('div', { class: 'plc' },
    el('div', { class: 'col' }, el('div', { class: 'small muted' }, 'Inputs'),
      ins.map(n => el('label', { class: 'pswitch' }, el('input', { type: 'checkbox', onchange: e => { physical[n] = e.target.checked; } }), n))),
    el('div', { class: 'col grow' }, phaseBox, code, imageBox),
    el('div', { class: 'col' }, el('div', { class: 'small muted' }, 'Outputs'), outs.map(n => el('span', { class: 'out' }, lampEls[n], n)))),
    el('div', { class: 'row mid' }, el('button', { class: 'btn plain sm', type: 'button', onclick: step }, 'Step'),
      el('button', { class: 'btn plain sm', type: 'button', onclick: whole }, 'Scan once'), run,
      el('button', { class: 'btn plain sm', type: 'button', onclick: () => { stop(); reset(); } }, 'Reset'), status), err);
  reset();
}
