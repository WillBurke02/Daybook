// The machine's panel: a control for each of the scene's inputs, the lamps and readings it shows, a trend,
// and the PLC's program and tags, live. Every input is a real button, switch or slider, so nothing needs the 3D view.
//
// scene.inputs = { name: {button: 'Start', color: 'green'} | {button: 'Stop', nc: 1, color: 'red'} (push-buttons:
//   on only while held; nc reads 1 at rest) | {latch: 'E-stop', nc: 1} (stays in until pressed again) |
//   {switch: 'Auto'} | {slider: 'Speed', min, max, step, value, unit} | {select: 'Mode', options: [[0, 'Off'], …], value} }
//   hidden: true leaves one off the panel unless a card's controls list names it (a drive's parameters, say)
// scene.show = [ {lamp: 'Running', on: formula, color: 'green'} | {read: 'Frequency', value: formula, unit: 'Hz', dp: 1}
//   | {meter: 'Overload', value: formula, max: 100, unit: '%'} ]
// scene.trend = { span: 10 (s), y: [lo, hi] (or worked out), lines: [{value: formula, label: 'f (Hz)'}] }
// scene.plc_label: what the PLC's section is called (a hard-wired circuit drawn as a ladder is not a PLC)
import { el } from '../core/dom.js';
import { s, slider, choose, plot, path, sig, put } from '../widgets/kit.js';
import { formula, set } from './engine.js';
import { diagram, tagOf } from '../widgets/ladder.js';

const show = (v, dp) => typeof v === 'number' ? (dp != null ? v.toFixed(dp) : sig(v, 4)) : v === '' || v == null ? '–' : String(v);

/** panel(get, opts): get() is the machine now (it is rebuilt on Reset). opts: {controls: [names], plc: false | 'open'}. */
export function panel(get, opts = {}) {
  const scene = get().scene, known = get().known;
  const syncs = [];

  // ---- the inputs ----
  const control = ([k, i]) => {
    const now = () => get().env[k];
    if (i.button || i.latch) {
      const label = i.button || i.latch, at = i.nc ? 0 : 1, rest = i.nc ? 1 : 0;
      const b = el('button', { class: 'btn plain sm s3push', type: 'button', 'data-c': i.color || null, 'aria-pressed': i.latch ? 'false' : null,
        title: i.latch ? 'Stays in until pressed again' : 'A push-button: on only while held' }, label);
      if (i.latch) b.addEventListener('click', () => set(get(), k, now() === at ? rest : at));
      else {
        // held while down; a quick tap still lasts 150 ms, so the PLC's scan sees it
        let downAt = 0, down = false;
        const go = v => {
          if (v) { down = true; downAt = performance.now(); set(get(), k, at); return; }
          if (!down) return;
          down = false;
          setTimeout(() => { if (!down) set(get(), k, rest); }, Math.max(0, 150 - (performance.now() - downAt)));
        };
        b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); go(true); });
        for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => go(false));
        b.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) go(true); } });
        b.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(false); } });
      }
      syncs.push(() => { const on = now() === at; b.classList.toggle('held', on); if (i.latch) b.setAttribute('aria-pressed', String(on)); });
      return b;
    }
    if (i.switch) {
      const box = el('input', { type: 'checkbox', onchange: e => set(get(), k, e.target.checked ? 1 : 0) });
      syncs.push(() => { box.checked = !!now(); });
      return el('label', { class: 'pswitch' }, box, i.switch);
    }
    if (i.slider) {
      const row = slider(i.slider, { min: i.min ?? 0, max: i.max ?? 100, step: i.step ?? 1, value: now(), unit: i.unit || '' }, v => set(get(), k, v));
      const input = row.querySelector('input');
      syncs.push(() => { if (document.activeElement !== input && +input.value !== now()) row.set(now()); });
      return row;
    }
    if (i.select) {
      const row = choose(i.select, (i.options || []).map(([v, l]) => [String(v), l]), String(now()), v => set(get(), k, +v));
      const pick = row.querySelector('select');
      syncs.push(() => { if (document.activeElement !== pick) pick.value = String(now()); });
      return row;
    }
    return null;
  };
  // a card's controls list says which to show (a hidden one, a drive's parameter say, only when listed)
  const inputs = Object.entries(scene.inputs || {}).filter(([k, i]) => opts.controls ? opts.controls.includes(k) : !i.hidden);
  const buttons = inputs.filter(([, i]) => i.button || i.latch || i.switch).map(control);
  const sliders = inputs.filter(([, i]) => i.slider || i.select).map(control);

  // ---- what it shows ----
  const reads = (scene.show || []).map(r => {
    const f = formula(r.value ?? r.on, known);
    if (r.lamp) {
      const lamp = el('span', { class: `lamp ${r.color || ''}` });
      return { el: el('span', { class: 'out' }, lamp, r.lamp), set: e => lamp.classList.toggle('on', !!f(e)) };
    }
    if (r.meter) {
      const m = el('meter', { min: r.min ?? 0, max: r.max ?? 100, high: r.high ?? (r.max ?? 100) * 0.8, optimum: 0 }), out = el('span', { class: 'num' });
      return { el: el('span', {}, `${r.meter} `, m, ' ', out), set: e => { const v = +f(e) || 0; m.value = v; out.textContent = `${show(v, r.dp)}${r.unit ? ' ' + r.unit : ''}`; } };
    }
    const out = el('strong', { class: 'num' });
    return { el: el('span', {}, `${r.read} `, out, r.unit ? ` ${r.unit}` : ''), set: e => { out.textContent = show(f(e), r.dp); } };
  });

  // ---- a trend: the last span seconds of chosen values ----
  const tr = scene.trend, lines = (tr?.lines || []).map(l => ({ ...l, f: formula(l.value, known) }));
  const trendBox = tr && lines.length ? el('div', { class: 'wscreen calc s3trend' }) : null, hist = [];
  // sampled as the machine steps (400 points a span), so a fast wave is drawn as a wave, not a zigzag
  const sample = e => {
    const h = hist.at(-1);
    if (h && e.t >= h[0] && e.t - h[0] < (tr.span || 10) / 400) return;
    hist.push([e.t, ...lines.map(l => +l.f(e) || 0)]);
  };
  const drawTrend = e => {
    const span = tr.span || 10;
    sample(e);
    while (hist.length && hist[0][0] < e.t - span - 0.5) hist.shift();
    if (hist.length && hist.at(-1)[0] < hist[0][0]) hist.splice(0, hist.length - 1);    // after a reset, time starts again
    let [lo, hi] = tr.y || [Math.min(0, ...hist.flatMap(h => h.slice(1))), Math.max(1e-9, ...hist.flatMap(h => h.slice(1)))];
    if (!tr.y) hi += (hi - lo) * 0.08;
    const t1 = Math.max(span, e.t), P = plot({ x: [t1 - span, t1], y: [lo, hi], xlabel: 'time (s)', w: 760, h: 200, label: 'Trend' });
    lines.forEach((l, k) => P.layer.append(s('path', { class: `trace k${k}`, d: path(hist.map(h => [h[0], h[k + 1]]), P.X, P.Y) })));
    let x = P.box.L + 8;
    P.svg.append(s('g', { class: 'legend' }, lines.map((l, k) => { const t = s('text', { x, y: P.box.T + 12, class: `k${k}` }, l.label || l.value); x += 14 + 6.6 * String(l.label || l.value).length; return t; })));
    put(trendBox, P.svg);
  };

  // ---- the PLC: its program (or ladder, with the power flowing) and its I/O ----
  const [plcId, plcSpec] = Object.entries(scene.blocks || {}).find(([, b]) => b.type === 'plc') || [];
  let plcBox = null, drawPlc = null;
  if (plcId && opts.plc !== false) {
    const pic = el('div', { class: 'ladder' }), tags = el('div', { class: 'images num small' });
    const ins = Object.keys(plcSpec.inputs || {}), outs = plcSpec.outputs || [];
    const block = () => get().blocks.find(b => b.id === plcId).o;
    if (!plcSpec.ladder) put(pic, el('pre', { class: 'st' }, block()._src));
    drawPlc = () => {
      const o = block(), vars = o._m.vars, v = tagOf(vars);
      if (plcSpec.ladder) put(pic, diagram(plcSpec.ladder, v));
      const tag = n => { const x = v(n); return `${n} = ${typeof x === 'boolean' ? +x : typeof x === 'number' ? sig(x, 4) : '?'}`; };
      put(tags, el('div', {}, el('strong', {}, 'Inputs '), ins.map(tag).join('  ')),
        el('div', {}, el('strong', {}, 'Outputs '), outs.map(tag).join('  ')),
        o.err ? el('div', { class: 'err' }, `STOP: ${o.err}`) : el('div', { class: 'muted' }, `scan ${o._m.scans}`));
    };
    plcBox = el('details', { class: 'small s3plc calc', open: opts.plc === 'open' }, el('summary', { class: 'muted' }, scene.plc_label || (plcSpec.ladder ? 'The PLC: its ladder, live' : 'The PLC: its program and tags')), pic, tags);
  }

  const readBox = reads.length ? el('div', { class: 'wread num small s3read' }, reads.map(r => r.el)) : null;
  const root = el('div', { class: 's3panel' },
    buttons.length ? el('div', { class: 's3buttons' }, buttons) : null,
    sliders.length ? el('div', { class: 'wcontrols' }, sliders) : null,
    readBox, trendBox, plcBox);
  let n = 0;
  return {
    el: root,
    update(e) {
      syncs.forEach(f => f());
      reads.forEach(r => r.set(e));
      if (trendBox) drawTrend(e);
      if (drawPlc && (plcBox.open || n % 5 === 0)) drawPlc();
      n++;
    },
    sample(e) { if (trendBox) sample(e); },
    clear() { hist.length = 0; },
  };
}
