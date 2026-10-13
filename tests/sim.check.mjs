// node tests/sim.check.mjs — the machines behind the lessons (apps/learn/web/sim): the formulas, each block
// against what the real thing does, faults, scripts and the goal check. The scenes themselves are checked
// with the course in tests/content.check.mjs.
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const E = await load('apps/learn/web/sim/engine.js');
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);
const machine = (blocks, inputs = {}, extra = {}) => E.build({ inputs, blocks, ...extra });

// ---- formulas ----
{
  const known = new Set(['vfd.f', 'start', 'm1.n']);
  const f = s => E.formula(s, known);
  const env = { 'vfd.f': 25, start: 1, 'm1.n': 750 };
  assert.equal(f('vfd.f * 2')(env), 50);
  assert.equal(f('IF(AND(start, vfd.f > 20), 7, 3)')(env), 7);
  assert.equal(f('MOD(-1, 4)')(env), 3);
  assert.equal(f('VFD.F')(env), 25);                                           // names ignore case, as ST's do
  assert.equal(f('NOT(start)')(env), 0);
  assert.throws(() => f('vfd.g + 1'), /there is no vfd\.g/);
  assert.throws(() => f('SUMIF(start, 1)'), /not used/);
  console.log('ok — formulas: dotted names, IF, MOD, unknown names caught');
}

// ---- a PLC seal-in, a drive's ramp, a motor on it ----
{
  const sim = machine({
    plc: { type: 'plc', src: 'Run := (Start OR Run) AND Stop;', inputs: { Start: 'start', Stop: 'stop' }, outputs: ['Run'] },
    vfd: { type: 'drive', run: 'plc.Run', ref: 'ref', motor: 'm1', accel: 2, decel: 2 },
    m1: { type: 'motor', f: 'vfd.f', on: 'vfd.on', load: 'm1.Tr * 0.5', J: 0.01 },
  }, { start: { button: 'Start' }, stop: { button: 'Stop', nc: 1 }, ref: { slider: 'Speed', min: 0, max: 50, value: 50 } });
  assert.equal(sim.env.stop, 1, 'a normally closed stop button reads 1 at rest');
  E.play(sim, [{ at: 0.1, press: 'start' }]);
  E.run(sim, 1.1);
  assert.equal(sim.env['plc.Run'], 1, 'sealed in after the button is let go');
  near(sim.env['vfd.f'], 25, 0.5, 'half way up a 2 s ramp');
  E.run(sim, 3);
  near(sim.env['m1.n'], 1465, 15, 'a 1430 rpm motor at half load runs at about 1465 rpm');
  E.press(sim, 'stop');
  E.run(sim, 2.5);
  assert.equal(sim.env['plc.Run'], 0);
  assert.ok(sim.env['m1.n'] < 5, `ramped to a stop: ${sim.env['m1.n']}`);
  console.log('ok — PLC seal-in, drive ramp, motor speed under load');
}

// ---- starting direct on line: about 6 × rated current, settling at rated speed with rated load ----
{
  const sim = machine({ m: { type: 'motor', load: 'm.Tr', J: 0.01 } });
  E.run(sim, 0.01);
  near(sim.env['m.I'] / sim.env['m.Ir'], 5.8, 0.4, 'starting current');
  near(sim.env['m.T'] / sim.env['m.Tr'], 2, 0.15, 'starting torque');
  E.run(sim, 1);
  near(sim.env['m.n'], 1430, 5, 'rated speed at rated load');
  near(sim.env['m.I'] / sim.env['m.Ir'], 1, 0.05, 'rated current at rated load');
  const stall = machine({ m: { type: 'motor', load: 'm.Tr * 3', J: 0.01 } });
  E.run(stall, 1);
  assert.equal(stall.env['m.n'], 0, 'a load over the starting torque does not move');
  console.log('ok — DOL start: current, torque, rated point, a stalled start');
}

// ---- stopping a heavy load: OV trip, a brake resistor, stall prevention ----
{
  const run = { run: { switch: 'Run', value: 1 } };
  const stop = drive => { const s = machine({ vfd: { type: 'drive', run: 'run', motor: 'm', accel: 3, decel: 2, ...drive }, m: { type: 'motor', f: 'vfd.f', on: 'vfd.on', J: 0.1 } }, run); E.run(s, 5); E.set(s, 'run', 0); E.run(s, 3); return s; };
  assert.equal(stop({ stall: 0 }).env['vfd.fault'], 'OV', 'no resistor, no stall prevention: overvoltage');
  const r = stop({ stall: 0, brake: 100 });
  assert.equal(r.env['vfd.fault'], '', 'a brake resistor takes it');
  assert.ok(r.env['m.n'] < 5, `and it stops on time: ${r.env['m.n']}`);
  const s = stop({});
  assert.equal(s.env['vfd.fault'], '', 'stall prevention: no trip');
  assert.ok(s.env['m.n'] > 100, 'but it takes longer than the ramp');
  assert.ok(E.run(s, 30, 'm.n < 1') != null, 'and it gets there');
  const oc = machine({ vfd: { type: 'drive', run: 'run', motor: 'm', accel: 0.2, stall: 0 }, m: { type: 'motor', f: 'vfd.f', on: 'vfd.on', J: 0.2 } }, run);
  E.run(oc, 1);
  assert.equal(oc.env['vfd.fault'], 'OC', 'a 0.2 s ramp on a heavy load: overcurrent');
  E.set(oc, 'run', 0);
  const tripped = machine({ vfd: { type: 'drive', run: 'run', motor: 'm', accel: 0.2, stall: 0, reset: 'rst' }, m: { type: 'motor', f: 'vfd.f', on: 'vfd.on', J: 0.2 } }, { ...run, rst: { button: 'Reset' } });
  E.run(tripped, 1); E.set(tripped, 'run', 0); E.press(tripped, 'rst'); E.run(tripped, 0.5);
  assert.equal(tripped.env['vfd.trip'], 0, 'reset clears it');
  const sto = machine({ vfd: { type: 'drive', run: 'run', motor: 'm', sto: 1 }, m: { type: 'motor', f: 'vfd.f', on: 'vfd.on' } }, run);
  E.run(sto, 2);
  assert.ok(sto.env['m.n'] === 0 && sto.env['vfd.fault'] === '', 'STO: no torque, no fault');
  console.log('ok — drive: OV trip, brake resistor, stall prevention, OC trip, reset, STO');
}

// ---- an overload relay, class 10 ----
{
  const at = x => { const s = machine({ ol: { type: 'overload', I: x, set: 1 } }, {}, { dt: 0.05 }); return E.run(s, 7200, 'ol.trip'); };
  const t72 = at(7.2);
  assert.ok(t72 > 4 && t72 < 10, `class 10 at 7.2 × set trips in 4 to 10 s: ${t72}`);
  assert.equal(at(1.05), null, 'not at 1.05 × in two hours');
  assert.ok(at(1.2) < 7200, 'at 1.2 × within two hours');
  console.log('ok — overload relay: class 10 times');
}

// ---- a conveyor, items, a photo-eye, a pusher ----
{
  const sim = machine({
    belt: { type: 'conveyor', rpm: 1500, ratio: 25, dia: 0.1, length: 2, every: 1, size: 0.2, pattern: [0, 1], eject: 'kick', eject_at: 1 },
    eye: { type: 'eye', belt: 'belt', at: 1.5 },
  }, { kick: { switch: 'Pusher' } });
  E.step(sim);
  near(sim.env['belt.v'], 1500 / 60 / 25 * Math.PI * 0.1, 1e-3, 'belt speed');      // 0.314 m/s
  assert.ok(E.run(sim, 10, 'eye.on') != null, 'an item reaches the eye');
  E.run(sim, 20);
  assert.ok(sim.env['belt.out'] > 3, `items fall off the end: ${sim.env['belt.out']}`);
  E.set(sim, 'kick', 1); E.run(sim, 10);
  assert.ok(sim.env['belt.rejects'] > 0, 'the pusher knocks items off');
  const q = machine({ belt: { type: 'conveyor', rpm: 1500, ratio: 25, length: 2, every: 0.5, stop: 1 } });
  E.run(q, 60);
  assert.equal(q.env['belt.out'], 0, 'with an end stop nothing falls off');
  assert.ok(q.env['belt.n'] >= 9, 'they queue');
  const dirty = machine({ belt: { type: 'conveyor', rpm: 1500, ratio: 25, every: 1 }, eye: { type: 'eye', belt: 'belt', at: 1.5 } }, {}, { faults: { dirty: { label: 'x', set: { 'eye.stuck': 1 } } } });
  assert.throws(() => E.build({ blocks: { e: { type: 'eye', belt: 'b', wrong: 1 } } }), /has no wrong/);
  const f = E.build(dirty.scene, { fault: 'dirty' });
  E.run(f, 0.1);
  assert.equal(f.env['eye.on'], 1, 'a fault puts its settings in');
  console.log('ok — conveyor speed, items, eye, pusher, end stop, faults');
}

// ---- a servo axis ----
{
  const axis = extra => machine({ ax: { type: 'axis', target: 'tgt', ...extra } }, { tgt: { slider: 'Target', min: 0, max: 500, value: 0 } });
  const a = axis({}); E.set(a, 'tgt', 300);
  assert.ok(E.run(a, 5, 'ax.done') != null, 'it gets there');
  near(a.env['ax.pos'], 300, 0.05, 'and stops on it');
  const peak = kp => { const s = axis({ kp, ff: 0, amax: 1e7, vmax: 1e5, maxerr: 1e9 });   // near enough a step
    E.set(s, 'tgt', 100); let top = 0; for (let k = 0; k < 1500; k++) { E.step(s); top = Math.max(top, s.env['ax.pos']); } return top - 100; };
  assert.ok(peak(30) < 0.01 && peak(1000) > 5, `a stiff loop overshoots: ${peak(30)} vs ${peak(1000)}`);
  const inv = axis({ invert: 1 }); E.set(inv, 'tgt', 100); E.run(inv, 2);
  assert.equal(inv.env['ax.fault'], 'FE', 'an encoder wired backwards runs away and trips on following error');
  console.log('ok — servo axis: move, overshoot with gain, runaway on a reversed encoder');
}

// ---- cylinder, tank, transmitter, PID, lag, encoder, sensor ----
{
  const c = machine({ cyl: { type: 'cylinder', extend: 'a', retract: 'b', stroke: 0.1, speed: 0.2 } }, { a: { button: 'A' }, b: { button: 'B' } });
  E.press(c, 'a', 0.05); E.run(c, 1);
  assert.equal(c.env['cyl.ext'], 1, 'a double-solenoid valve keeps it out after the pulse');
  const sp = machine({ cyl: { type: 'cylinder', extend: 'a', stroke: 0.1 } }, { a: { button: 'A' } });
  E.press(sp, 'a', 0.05); E.run(sp, 1);
  assert.equal(sp.env['cyl.ret'], 1, 'a spring-return one comes back');
  const t = machine({ tk: { type: 'tank', inflow: 2, area: 0.5 } });
  E.run(t, 100);
  near(t.env['tk.level'], 0.4, 1e-6, '2 L/s for 100 s into 0.5 m²');
  const tx = machine({ x: { type: 'tx', pv: 50, lo: 0, hi: 100 }, y: { type: 'tx', pv: 50, fail: 1 } });
  E.run(tx, 0.01);
  assert.deepEqual([tx.env['x.mA'], tx.env['x.raw'], tx.env['y.mA'], tx.env['y.raw']], [12, 13824, 0, -32768]);
  // a level loop: PID on a valve (a lag) filling a tank that drains through an orifice
  const loop = machine({
    pid: { type: 'pid', pv: 'tk.pct', sp: 60, kp: 4, ti: 20 },
    valve: { type: 'lag', x: 'pid.out', tau: 2 },
    tk: { type: 'tank', inflow: 'valve.y / 100 * 6', outflow: '3 * SQRT(tk.level)', area: 0.5, height: 2 },
  }, {}, { dt: 0.01 });
  E.run(loop, 600);
  near(loop.env['tk.pct'], 60, 0.5, 'the loop holds the level on set point');
  const enc = machine({ e: { type: 'encoder', turns: 2.5, ppr: 100 } });
  E.run(enc, 0.01);
  assert.equal(enc.env['e.count'], 1000, '×4 counts');
  const s = machine({ hi: { type: 'sensor', x: 1.9, above: 1.8 }, nc: { type: 'sensor', x: 1.9, above: 1.8, nc: 1 } });
  E.run(s, 0.01);
  assert.deepEqual([s.env['hi.on'], s.env['nc.on']], [1, 0]);
  console.log('ok — cylinder valves, tank, 4–20 mA and S7 raw, a PID level loop, encoder ×4, switches');
}

// ---- goals: solvable, not already solved ----
{
  const scene = { inputs: { go: { switch: 'Go' } }, blocks: { tk: { type: 'tank', inflow: 'IF(go, 5, 0)', area: 1 } } };
  assert.equal(E.solves(scene, {}, { pass: 'tk.level > 0.01', solution: [{ at: 0, set: { go: 1 } }] }).ok, true);
  assert.match(E.solves(scene, {}, { pass: 'tk.level > 0.01', solution: [] }).why, /does not make/);
  assert.match(E.solves(scene, {}, { pass: 'tk.level >= 0', solution: [] }).why, /before anything/);
  console.log('ok — goal checks: solved by its solution, not before');
}
