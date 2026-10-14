// A machine to run: in 3D, with its panel, on the simulation in ../sim/. A card names a scene from
// apps/learn/web/sims/ (or writes one in) and changes only what its lesson needs:
//   "widget": {"name": "sim", "params": {"scene": "conveyor", "set": {"vfd.accel": 0.5}, "fault": "eye-stuck",
//     "controls": ["start", "stop"], "show": [...], "trend": false, "plc": "open" | false, "camera": {...},
//     "speed": 1, "paused": false, "demo": false}}
// The scene's format is in ../sim/engine.js (the machine), ../sim/view.js (3D) and ../sim/panel.js (the panel).
// reports: every value in the machine by its name (vfd.f, m1.n, plc.Run, t), so a card's question can use them.
import { el } from '../core/dom.js';
import { build, step, play, set, press, formula } from '../sim/engine.js';
import { view3d } from '../sim/view.js';
import { panel } from '../sim/panel.js';

export const REPORTS = [];   // whatever the scene holds: tests/content.check.mjs builds the scene to see

const scenes = {};
/** A scene from the library, by name. */
export function scene(name) {
  if (!/^[a-z0-9-]+$/.test(name)) return Promise.reject(new Error(`${name} is not a scene's name`));
  return scenes[name] ??= fetch(new URL(`../sims/${name}.json`, import.meta.url))
    .then(r => { if (!r.ok) throw new Error(`there is no scene called ${name}`); return r.json(); });
}

/** The card's changes over the library scene: what it shows, its trend, its camera. */
export function merge(base, p) {
  const out = { ...base };
  if (p.show) out.show = p.show;
  if (p.trend !== undefined) out.trend = p.trend || null;
  if (p.camera) out.view = { ...base.view, camera: { ...base.view?.camera, ...p.camera } };
  return out;
}

export async function mount(box, p, report) {
  const sc = merge(typeof p.scene === 'string' ? await scene(p.scene) : p.scene, p);
  let fault = p.fault || null;
  let sim = build(sc, { fault, set: p.set });
  const get = () => sim;

  // the 3D view, if this device can draw it; the panel works either way
  const canvas = el('canvas', { tabindex: 0, role: 'img', 'aria-label': `${sc.title || 'The machine'} in 3D. Drag, or use the arrow keys, to turn it; + and − zoom.` });
  const stage = el('div', { class: 's3stage' }, canvas, el('div', { class: 's3labels', 'aria-hidden': 'true' }));
  box.append(stage);
  const cam = el('div', { class: 's3cam' });
  stage.append(cam);
  let view = null;
  try {
    view = sc.view ? view3d(canvas, sc, sim.known, {
      onInput(name, how) {
        const i = sc.inputs[name], at = i.nc ? 0 : 1;
        if (how === 'toggle') set(sim, name, sim.env[name] === at ? 1 - at : at);      // a switch or a latch
        else set(sim, name, (how === 'down') !== !!i.nc ? 1 : 0);                     // a push-button, while held
      },
    }) : null;
  } catch { view = null; }
  if (!view) { stage.replaceChildren(sc.view ? el('p', { class: 'muted small' }, '3D is not available on this device.') : ''); if (!sc.view) stage.remove(); }
  else cam.append(
    el('button', { class: 'btn plain sm', type: 'button', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => view.zoom(1 / 1.25) }, '+'),
    el('button', { class: 'btn plain sm', type: 'button', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => view.zoom(1.25) }, '−'),
    el('button', { class: 'btn plain sm', type: 'button', title: 'Back to the first view', 'aria-label': 'Reset the view', onclick: () => view.reset() }, '⟲'));

  const pan = panel(get, { controls: p.controls, plc: p.plc });
  const say = el('p', { class: 's3say', 'aria-live': 'polite' });
  const clock = el('span', { class: 'num small muted' });
  let speed = p.speed ?? 1, paused = !!p.paused;
  const pause = el('button', { class: 'btn plain sm', type: 'button', onclick: () => { paused = !paused; pause.textContent = paused ? '▶ Run' : '❚❚ Pause'; } }, paused ? '▶ Run' : '❚❚ Pause');
  const speeds = el('select', { 'aria-label': 'Speed', onchange: e => { speed = +e.target.value; } },
    [[0.1, '0.1×'], [0.25, '¼×'], [0.5, '½×'], [1, '1×'], [2, '2×'], [5, '5×']].map(([v, l]) => el('option', { value: v, selected: v === speed }, l)));
  const restart = (script = null) => {
    sim = build(sc, { fault, set: p.set });
    pan.clear();
    if (script) { play(sim, script); paused = false; pause.textContent = '❚❚ Pause'; }
    tick(true);
  };
  const demo = sc.script?.length && p.demo !== false
    ? el('button', { class: 'btn plain sm', type: 'button', title: 'Start again and watch it run', onclick: () => restart(sc.script) }, '▷ Watch it run') : null;
  box.append(el('div', { class: 's3bar' }, pause, speeds, el('button', { class: 'btn plain sm', type: 'button', title: 'Start the machine again', onclick: () => restart() }, 'Reset'), demo, clock),
    say, pan.el);

  // ---- running: real time (times the speed), in the machine's own fixed steps --------------------
  const snapshot = () => Object.fromEntries(Object.entries(sim.env).filter(([, v]) => typeof v === 'number' || typeof v === 'string'));
  let last = null, acc = 0, ui = 0, raf = 0, seen = true;
  function tick(force = false) {
    say.textContent = sim.said;
    clock.textContent = `${sim.t.toFixed(1)} s`;
    pan.update(sim.env);
    report(snapshot());
    if (force) view?.draw(sim.env);
  }
  const frame = now => {
    raf = 0;
    if (!box.isConnected) return stop();
    if (last != null && !paused) {
      acc = Math.min(acc + Math.min(0.1, (now - last) / 1000) * speed, 0.5);
      while (acc >= sim.dt) { step(sim); pan.sample(sim.env); acc -= sim.dt; }
    }
    last = now;
    view?.draw(sim.env);
    if (now - ui > 70) { ui = now; tick(); }
    if (seen) raf = requestAnimationFrame(frame);
  };
  const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting; if (seen && !raf) { last = null; raf = requestAnimationFrame(frame); } });
  io.observe(box);
  // out of sight it does not run; once the card is gone, its 3D view is let go (a page holds only so many)
  const gone = setInterval(() => { if (!box.isConnected) stop(); }, 2000);
  const stop = () => { cancelAnimationFrame(raf); raf = 0; io.disconnect(); clearInterval(gone); view?.destroy(); };
  tick(true);
  raf = requestAnimationFrame(frame);

  return {
    scene: sc,
    get sim() { return sim; },
    faults: sc.faults || {},
    /** Start again, with this fault (or none) and, if given, a script playing. */
    restart(script, f = fault) { fault = f; restart(script); },
    press: name => press(sim, name),
    /** Is this formula true of the machine now? (A goal's pass, its fails.) */
    test: src => !!formula(src, sim.known)(sim.env),
    stop,
  };
}
