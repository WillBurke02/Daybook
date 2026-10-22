// The machine behind a lesson: blocks wired together by formulas, stepped in time. Pure logic, no page:
// the 3D view, the panel and tests/content.check.mjs all drive the same thing.
//
// A scene is plain data (apps/learn/web/sims/<name>.json, or written into a card):
//   { "title": "…", "dt": 0.002,
//     "inputs": { "start": {"button": "Start"}, "ref": {"slider": "Speed", "min": 0, "max": 50, "value": 30, "unit": "Hz"} },
//     "blocks": { "vfd": {"type": "drive", "run": "plc.Run", "ref": "ref", "motor": "m1"}, "m1": {"type": "motor", "f": "vfd.f", "on": "vfd.on"} },
//     "let":    { "belt_v": "m1.n / 60 / 20 * PI() * 0.1" },
//     "faults": { "eye-dirty": {"label": "…", "why": "…", "set": {"eye.stuck": 0, "stop_wire": 0}} },   (blocks' settings, inputs, lets)
//     "script": [ {"at": 0.5, "press": "start", "say": "Start is pressed"} ],
//     "view": {…3D, see view.js}, "show": [readouts], "trend": {…} }
// Every block setting is a number or a formula over the scene's names: the inputs (start), each block's
// outputs (vfd.f, m1.n), the lets, and t (seconds). Blocks run in the order written, once a step; one that reads
// a block further down gets last step's value. A let may use its own name: it reads its last value, so
// "seal": "AND(OR(start, seal), stop)" is a memory, and "ts": "IF(go, ts + 0.002, 0)" a stopwatch. Formulas are the numeric cards' own: IF(a > 1, 2, 3), AND(a, b),
// a = b, a <> b, MIN, MAX, ABS, SQRT, SIN, MOD, PI(); true is 1 and false 0.
import { parse } from '../core/formula.js';
import { BLOCKS } from './blocks.js';
import { expand } from './kits.js';

// ---- formulas, compiled once to plain functions of the scene's values ------------------------------

const MATH = {
  ABS: Math.abs, SQRT: Math.sqrt, EXP: Math.exp, LN: Math.log, LOG10: Math.log10, SIN: Math.sin, COS: Math.cos, TAN: Math.tan,
  ASIN: Math.asin, ACOS: Math.acos, ATAN: Math.atan, MIN: Math.min, MAX: Math.max, POWER: Math.pow, PI: () => Math.PI,
  MOD: (a, b) => ((a % b) + b) % b,                                   // the spreadsheet's: MOD(-1, 4) is 3
  ROUND: (x, p = 0) => Math.round(x * 10 ** p) / 10 ** p, ROUNDUP: (x, p = 0) => Math.ceil(x * 10 ** p) / 10 ** p,
  ROUNDDOWN: (x, p = 0) => Math.floor(x * 10 ** p) / 10 ** p, INT: Math.floor,
  RADIANS: x => x * Math.PI / 180, DEGREES: x => x * 180 / Math.PI, NOT: a => a ? 0 : 1,
  AND: (...a) => a.every(Boolean) ? 1 : 0, OR: (...a) => a.some(Boolean) ? 1 : 0, CONCAT: (...a) => a.join(''),
};
const num = v => typeof v === 'number' ? v : typeof v === 'boolean' ? +v : v == null || v === '' ? 0 : +v;

/** A formula to a function of the values. name(n) gives the value's key, or throws if there is none. */
function compile(ast, name) {
  const C = a => compile(a, name);
  switch (ast.k) {
    case 'num': case 'bool': { const v = +ast.v; return () => v; }
    case 'str': { const v = ast.v; return () => v; }
    case 'neg': { const a = C(ast.a); return e => -num(a(e)); }
    case 'id': { const k = name(ast.v); return e => e[k]; }
    case 'ref': throw new Error(`${ast.parts.join('.')} is not a name in this machine`);
    case 'bin': {
      const a = C(ast.a), b = C(ast.b);
      switch (ast.op) {
        case '+': return e => num(a(e)) + num(b(e));
        case '-': return e => num(a(e)) - num(b(e));
        case '*': return e => num(a(e)) * num(b(e));
        case '/': return e => num(a(e)) / num(b(e));
        case '^': return e => num(a(e)) ** num(b(e));
        case '&': return e => `${a(e)}${b(e)}`;
        case '=': case '==': return e => a(e) == b(e) ? 1 : 0;           // eslint-disable-line eqeqeq -- '1' = 1, as in a sheet
        case '<>': case '!=': return e => a(e) != b(e) ? 1 : 0;          // eslint-disable-line eqeqeq
        case '<': return e => num(a(e)) < num(b(e)) ? 1 : 0;
        case '>': return e => num(a(e)) > num(b(e)) ? 1 : 0;
        case '<=': return e => num(a(e)) <= num(b(e)) ? 1 : 0;
        case '>=': return e => num(a(e)) >= num(b(e)) ? 1 : 0;
      }
      throw new Error(`no ${ast.op} in a machine's formulas`);
    }
    case 'call': {
      const args = ast.args.map(C);
      if (ast.name === 'IF') { const [c, y, n = () => 0] = args; return e => c(e) ? y(e) : n(e); }
      const f = MATH[ast.name];
      if (!f) throw new Error(`${ast.name}() is not used in a machine's formulas`);
      if (ast.name === 'CONCAT') return e => f(...args.map(a => a(e)));
      return args.length === 1 ? (([a]) => e => f(num(a(e))))(args) : e => f(...args.map(a => num(a(e))));
    }
  }
  throw new Error('not a formula');
}

/** A formula's text to a function, its names checked against known (a Set, or a function saying yes). */
export function formula(src, known) {
  if (typeof src === 'number' || typeof src === 'boolean') { const v = +src; return () => v; }
  const has = typeof known === 'function' ? known : n => known.has(n);
  const lower = typeof known === 'function' ? null : new Map([...known].map(k => [k.toLowerCase(), k]));
  let ast;
  try { ast = parse(String(src)); }
  catch (e) { throw new Error(/\b(AND|OR|NOT)\b/.test(src) ? `"${src}": write AND(a, b), OR(a, b) and NOT(a), as in a spreadsheet` : `"${src}": ${e.message}`); }
  return compile(ast, n => {
    if (has(n)) return n;
    const k = lower?.get(n.toLowerCase());
    if (k) return k;
    throw new Error(`"${src}": there is no ${n} in this machine`);
  });
}

// ---- a machine from a scene ---------------------------------------------------------------------

const clone = x => JSON.parse(JSON.stringify(x));

/** Put each "block.setting" or "input" value from a fault or a card into the scene. */
function apply(scene, set, where) {
  for (const [path, v] of Object.entries(set || {})) {
    const [b, k] = path.split('.');
    if (k == null) {
      if (scene.let && b in scene.let) scene.let[b] = v;                // a let is a wire a fault can cut: "stop_ok": 0
      else if (!scene.inputs?.[b]) throw new Error(`${where}: there is no input or let ${b}`);
      else scene.inputs[b].value = v;
    } else {
      const blk = scene.blocks?.[b];
      if (!blk) throw new Error(`${where}: there is no block ${b}`);
      const def = BLOCKS[blk.type];
      if (def && !(k in def.in)) throw new Error(`${where}: a ${blk.type} has no ${k}`);
      blk[k] = v;
    }
  }
}

/** An input's value at rest: a push-button is 0 (1 if it is normally closed), anything else its value. */
const rest = i => i.button || i.latch ? (i.nc ? 1 : 0) : +(i.value ?? (i.slider ? i.min ?? 0 : 0));

/**
 * A machine ready to run: build(scene, {fault, set}).
 *   fault  one of the scene's faults by id, put in before it starts
 *   set    a card's own changes: {"vfd.accel": 0.5, "ref": 40}
 * Returns {scene, env, t, step(), names, said}: env holds every value by name.
 */
export function build(source, { fault = null, set = null } = {}) {
  const scene = clone(source);
  if (fault && fault !== 'none') {
    const f = scene.faults?.[fault];
    if (!f) throw new Error(`there is no fault ${fault}`);
    apply(scene, f.set, `fault ${fault}`);
  }
  if (set) apply(scene, set, 'the card');
  const env = { t: 0 }, known = new Set(['t']);
  for (const [k, i] of Object.entries(scene.inputs || {})) {
    if (!/^[A-Za-z_]\w*$/.test(k)) throw new Error(`input ${k}: a name is letters, digits and _`);
    env[k] = rest(i); known.add(k);
  }
  // the blocks: each one's settings sorted into formulas, wires and text, and its outputs named
  const blocks = [];
  for (const [id, spec] of Object.entries(scene.blocks || {})) {
    if (!/^[A-Za-z_]\w*$/.test(id)) throw new Error(`block ${id}: a name is letters, digits and _`);
    const def = BLOCKS[spec.type];
    if (!def) throw new Error(`block ${id}: there is no block type ${spec.type}`);
    for (const k of Object.keys(spec)) if (k !== 'type' && !(k in def.in)) throw new Error(`block ${id}: a ${spec.type} has no ${k} (it has ${Object.keys(def.in).join(', ')})`);
    const o = def.setup ? def.setup({ ...def.in, ...spec }, id) : clone(def.out);
    const outs = Object.keys(o).filter(k => !k.startsWith('_'));
    for (const k of outs) { env[`${id}.${k}`] = o[k]; known.add(`${id}.${k}`); }
    blocks.push({ id, spec, def, o, outs });
  }
  for (const k of Object.keys(scene.let || {})) { env[k] = 0; known.add(k); }
  // now every name is known, the formulas can be compiled
  for (const b of blocks) {
    b.f = [];
    for (const [k, dflt] of Object.entries(b.def.in)) {
      const v = b.spec[k] ?? dflt, where = `block ${b.id}, ${k}`;
      if (b.def.text?.includes(k) || v == null || typeof v === 'object' && k !== b.def.wires) b.f.push([k, () => v]);
      else if (k === b.def.wires) { const fs = Object.entries(v).map(([n, src]) => [n, at(where, () => formula(src, known))]); b.f.push([k, e => Object.fromEntries(fs.map(([n, f]) => [n, f(e)]))]); }
      else b.f.push([k, at(where, () => formula(v, known))]);
    }
  }
  const lets = Object.entries(scene.let || {}).map(([k, src]) => [k, at(`let ${k}`, () => formula(src, known))]);
  const sim = { scene, env, known, blocks, lets, t: 0, dt: scene.dt || 0.002, said: '', fault, queue: [], history: null };
  for (const b of blocks) b.def.start?.(b.o, inputs(b, env), sim);
  publish(sim);
  return sim;
}

const at = (where, fn) => { try { return fn(); } catch (e) { throw new Error(`${where}: ${e.message}`); } };
const inputs = (b, env) => Object.fromEntries(b.f.map(([k, f]) => [k, f(env)]));
function publish(sim) {
  const { env } = sim;
  for (const b of sim.blocks) for (const k of b.outs) { const v = b.o[k]; env[`${b.id}.${k}`] = typeof v === 'boolean' ? +v : v; }
  for (const [k, f] of sim.lets) env[k] = f(env);
}

/** One step of dt seconds: the script's events that are due, every block once, then the lets. */
export function step(sim) {
  const { env, dt } = sim;
  while (sim.queue.length && sim.queue[0].at <= sim.t + 1e-9) fire(sim, sim.queue.shift());
  for (const b of sim.blocks) {
    const i = {};
    for (const [k, f] of b.f) i[k] = f(env);
    b.def.step(b.o, i, dt, sim);
    for (const k of b.outs) { const v = b.o[k]; env[`${b.id}.${k}`] = typeof v === 'boolean' ? +v : v; }
  }
  sim.t += dt;
  env.t = sim.t;
  for (const [k, f] of sim.lets) env[k] = f(env);
}

/** Run for so many seconds of machine time (or until a formula comes true). Returns the time it came true, or null. */
export function run(sim, seconds, until = null) {
  const stop = sim.t + seconds, f = until ? formula(until, sim.known) : null;
  while (sim.t < stop - 1e-9) {
    step(sim);
    if (f && f(sim.env)) return sim.t;
  }
  return null;
}

/** Set an input: what a button, a switch or a slider does. */
export function set(sim, name, value) {
  if (!(name in (sim.scene.inputs || {}))) throw new Error(`there is no input ${name}`);
  sim.env[name] = +value;
}

/** Press a push-button for a moment (held for s seconds of machine time). */
export function press(sim, name, s = 0.2) {
  const i = sim.scene.inputs?.[name];
  if (!i) throw new Error(`there is no input ${name}`);
  set(sim, name, i.nc ? 0 : 1);
  sim.queue.push({ at: sim.t + s, set: { [name]: rest(i) } });
  sim.queue.sort((a, b) => a.at - b.at);
}

function fire(sim, ev) {
  for (const [k, v] of Object.entries(ev.set || {})) set(sim, k, v);
  if (ev.press) press(sim, ev.press, ev.for ?? 0.2);
  if (ev.say != null) sim.said = ev.say;
}

/** Queue a script, its times counted from now: [{at, set: {name: value}, press: name, for: s, say: 'caption'}]. */
export function play(sim, script) {
  const now = sim.t;
  for (const ev of script || []) sim.queue.push({ ...ev, at: now + (ev.at || 0) });
  sim.queue.sort((a, b) => a.at - b.at);
}

// ---- checking a scene and a card's task, without a page -------------------------------------------

/** Every formula the view and the panel use, as [where, text, item names allowed]. */
export function viewFormulas(scene) {
  const out = [];
  const walk = (parts, where, each) => (parts || []).forEach((p, n) => {
    const w = `${where} part ${p.id || n + 1}`, item = each || !!p.each;
    if (p.each) out.push([w + ' each', p.each, each]);
    for (const k of ['show', 'lit', 'shade']) if (p[k] != null) out.push([`${w} ${k}`, p[k], item]);
    for (const k of ['move', 'turn', 'scale']) for (const [ax, src] of Object.entries(p[k] || {})) out.push([`${w} ${k}.${ax}`, src, item]);
    if (p.repeat?.shift != null) out.push([`${w} repeat.shift`, p.repeat.shift, item]);
    for (const m of String(p.label || '').matchAll(/\{([\w.]+)(?::\d)?\}/g)) out.push([`${w} label`, m[1], item]);
    walk(p.parts, w, item);
  });
  walk(expand(scene.view?.parts), 'view', false);
  for (const [n, s] of (scene.show || []).entries()) for (const k of ['value', 'on']) if (s[k] != null) out.push([`show ${n + 1} ${k}`, s[k], false]);
  for (const [n, l] of (scene.trend?.lines || []).entries()) out.push([`trend line ${n + 1}`, l.value, false]);
  return out;
}

/** The names a 3D part may press or toggle must be inputs. Returns problems as text. */
export function check(scene) {
  const problems = [], bad = (w, m) => problems.push(`${w}: ${m}`);
  let sim;
  try { sim = build(scene); } catch (e) { return [e.message]; }
  const known = sim.known;
  let vf = [];
  try { vf = viewFormulas(scene); } catch (e) { bad('view', e.message); }
  for (const [w, src, item] of vf)
    try { formula(src, item ? n => known.has(n) || /^item\.\w+$/.test(n) : known); } catch (e) { bad(w, e.message); }
  const walk = parts => (parts || []).forEach(p => {
    for (const k of ['press', 'toggle']) if (p[k] && !scene.inputs?.[p[k]]) bad(`part ${p.id || p.shape}`, `${k}s ${p[k]}, which is not an input`);
    walk(p.parts);
  });
  try { walk(expand(scene.view?.parts)); } catch (e) { bad('view', e.message); }
  // it runs: its script (or ten seconds of nothing), then every fault the same way, without a value going bad
  const runs = [[null, sim]];
  for (const f of Object.keys(scene.faults || {})) {
    if (!scene.faults[f].label) bad(`fault ${f}`, 'a fault has a label (what the answer says)');
    try { runs.push([f, build(scene, { fault: f })]); } catch (e) { bad(`fault ${f}`, e.message); }
  }
  for (const [f, s] of runs) {
    try {
      play(s, scene.script);
      run(s, Math.max(10, ...(scene.script || []).map(e => (e.at || 0) + 1)));
      for (const [k, v] of Object.entries(s.env)) if (typeof v === 'number' && !isFinite(v)) { bad(f ? `fault ${f}` : 'running', `${k} became ${v}`); break; }
    } catch (e) { bad(f ? `fault ${f}` : 'running', e.message); }
  }
  return problems;
}

/** Can a goal be met? Its solution (a script) is run; pass must be false at the start and true within the time. */
export function solves(scene, opts, goal) {
  const sim = build(scene, opts);
  const pass = formula(goal.pass, sim.known);
  if (pass(sim.env)) return { ok: false, why: 'it passes before anything is done' };
  play(sim, goal.solution);
  const end = goal.within ?? Math.max(10, ...(goal.solution || []).map(e => (e.at || 0) + 2));
  while (sim.t < end) {
    for (let k = 0; k < 25 && sim.t < end; k++) step(sim);
    if (pass(sim.env)) return { ok: true, at: sim.t };
  }
  return { ok: false, why: `its solution does not make "${goal.pass}" true within ${end} s` };
}
