// The blocks a lesson's machine is built from. Each one:
//   in    every setting and its default: a number or a formula, worked out each step
//   out   every output and its value at the start (names starting _ are kept to the block)
//   text  settings that are text or lists, taken as written
//   wires a setting that is a map of {name: formula} (the PLC's inputs)
//   setup(spec) the outputs, for a block whose outputs depend on how it is set up (the PLC)
//   start(o, i)  once, before the first step;  step(o, i, dt, sim)  every step
// Units: seconds, metres (the servo axis: mm), rpm, hertz, newton-metres, amps, volts, litres.
// ponytail: textbook models, each a few lines; good for "what happens and why", not for sizing a real machine.
import { compile, machine, scan } from '../st.js';
import { toST } from '../widgets/ladder.js';

const sat = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const toward = (x, target, by) => x < target ? Math.min(target, x + by) : Math.max(target, x - by);
const rpm = w => w * 30 / Math.PI;

export const BLOCKS = {

  // ---- control --------------------------------------------------------------------------------------

  /** A PLC running Structured Text (or ladder rungs, turned into it) on the mini PLC (st.js), scan by scan.
   *  inputs: {Tag: formula}; outputs: ['Run', …]. Every variable shows as plc.Name, a timer's as plc.T1.ET. */
  plc: {
    in: { src: '', ladder: null, inputs: {}, outputs: [], scan_ms: 10 },
    text: ['src', 'ladder', 'outputs', 'scan_ms'], wires: 'inputs',
    setup(spec) {
      const src = spec.ladder ? toST(spec.ladder) : spec.src;
      const prog = compile(src), names = Object.keys(spec.inputs || {});
      const m = machine(prog, { inputs: names, outputs: spec.outputs || [] });
      const decl = n => prog.decls[Object.keys(prog.decls).find(k => k.toLowerCase() === n.toLowerCase())];
      const o = { _m: m, _src: src, _acc: 0, _bool: Object.fromEntries(names.map(n => [n, !decl(n) || /BOOL/i.test(decl(n))])), err: '' };
      copy(o, m.vars);
      return o;
    },
    step(o, i, dt, sim) {
      if (o.err) return;                                     // a fault in the program stops the PLC, as a real one goes to STOP
      const ms = i.scan_ms;
      o._acc += dt * 1000;
      while (o._acc >= ms - 1e-9) {
        o._acc -= ms;
        const set = {};
        for (const [k, v] of Object.entries(i.inputs)) set[k] = o._bool[k] ? !!v : +v;
        try { scan(o._m, set, ms); } catch (e) { o.err = e.message; sim.said = `The PLC stopped: ${e.message}`; break; }
      }
      copy(o, o._m.vars);
    },
  },

  /** A PID controller: out = Kp (e + 1/Ti ∫e dt + Td de/dt), e = sp − pv (pv − sp if direct), held between lo and hi.
   *  In manual (auto 0) the output is man, and the integral follows it so the change back to auto is bumpless. */
  pid: {
    in: { pv: 0, sp: 0, kp: 1, ti: 0, td: 0, lo: 0, hi: 100, auto: 1, man: 0, direct: 0 },
    out: { out: 0, err: 0, p: 0, i: 0, d: 0, _pv: null },
    step(o, i, dt) {
      const e = i.direct ? i.pv - i.sp : i.sp - i.pv;
      const dpv = o._pv == null ? 0 : (i.pv - o._pv) / dt;
      o._pv = i.pv; o.err = i.sp - i.pv;
      o.p = i.kp * e;
      o.d = i.td ? (i.direct ? 1 : -1) * i.kp * i.td * dpv : 0;    // on the measurement, so a set-point step does not kick
      if (!i.auto) { o.out = sat(i.man, i.lo, i.hi); o.i = o.out - o.p - o.d; return; }
      if (i.ti > 0) o.i += i.kp * e * dt / i.ti; else o.i = 0;
      o.i = sat(o.i, i.lo - o.p - o.d, i.hi - o.p - o.d);          // anti-windup: the integral stops where the output stops
      o.out = sat(o.p + o.i + o.d, i.lo, i.hi);
    },
  },

  /** A first-order lag (and dead time): y follows gain × x with time constant tau. Heaters, valves, filters. */
  lag: {
    in: { x: 0, tau: 1, gain: 1, dead: 0, y0: 0 },
    out: { y: 0, _buf: null, _k: 0 },
    start(o, i) { o.y = i.y0; },
    step(o, i, dt) {
      let x = i.gain * i.x;
      if (i.dead > 0) {
        const n = Math.max(1, Math.round(i.dead / dt));
        if (!o._buf || o._buf.length !== n) { o._buf = new Array(n).fill(x); o._k = 0; }
        const old = o._buf[o._k]; o._buf[o._k] = x; o._k = (o._k + 1) % n; x = old;
      }
      o.y += i.tau > 0 ? (x - o.y) * Math.min(1, dt / i.tau) : x - o.y;
    },
  },

  // ---- drives and motors ------------------------------------------------------------------------------

  /** A variable-frequency drive. run, rev, ref (Hz) in; the output frequency f ramps at fmax/accel and fmax/decel.
   *  With stall on, it holds the ramp while the current is over ilim × rated (speeding up) or the DC bus is high
   *  (slowing down), as real drives do; with it off it trips: OC (over 2 × rated current) or OV (bus over 800 V,
   *  when the motor regenerates faster than the losses and the brake resistor can take). A trip lets the motor
   *  coast and holds until reset rises with the cause gone. sto 1 is Safe Torque Off: no torque, no fault.
   *  motor: the motor block it drives (for its current, torque and speed). coast 1: Stop lets it coast. */
  drive: {
    in: { run: 0, rev: 0, ref: 50, reset: 0, sto: 0, motor: '', fmax: 50, fmin: 0, accel: 5, decel: 5, ilim: 1.5, stall: 1, brake: 0, coast: 0, hold: 0.5, cap: 0 },
    text: ['motor'],
    out: { f: 0, on: 0, running: 0, at: 0, bus: 565, trip: 0, fault: '', I: 0, brk: 0, _r: 0, _z: 1 },
    step(o, i, dt, sim) {
      const e = sim.env, m = i.motor, I = m ? e[`${m}.I`] : 0, Ir = m ? e[`${m}.Ir`] : 1, kw = m ? e[`${m}.kw`] : 1;
      const w = m ? e[`${m}.n`] * Math.PI / 30 : 0, T = m ? e[`${m}.T`] : 0;
      const C = (i.cap || 300 * kw || 300) * 1e-6, Vn = 565;
      o.I = o.on ? I : 0;
      // the DC bus: the rectifier holds it at Vn; what the motor gives back (less the losses) charges it; the resistor bleeds it
      const net = (o.on ? -T * w : 0) - 150 * (kw || 1);              // what comes back, less the losses that soak some up
      o.brk = i.brake > 0 && o.bus > 750 ? 1 : 0;
      const pb = o.brk ? o.bus * o.bus / i.brake : 0;
      o.bus = Math.sqrt(Math.max(Vn * Vn, o.bus * o.bus + 2 * (net - pb) * dt / C));
      if (i.reset && !o._r && o.trip && o.bus < 760) { o.trip = 0; o.fault = ''; }
      o._r = i.reset;
      if (!o.trip && o.on && I > 2 * Ir && !i.stall) { o.trip = 1; o.fault = 'OC'; }
      if (!o.trip && o.bus > 800) { o.trip = 1; o.fault = 'OV'; }
      if (o.trip || i.sto || (!i.run && i.coast)) { o.f = 0; o.on = 0; o.running = 0; o.at = 0; return; }
      const want = i.run ? (i.rev ? -1 : 1) * sat(i.ref, i.fmin, i.fmax) : 0;
      const up = Math.abs(want) > Math.abs(o.f) && (Math.sign(want) === Math.sign(o.f) || o.f === 0);
      const rate = (up ? i.fmax / Math.max(i.accel, 0.01) : i.fmax / Math.max(i.decel, 0.01)) * dt;
      if (i.stall && up && I > i.ilim * Ir) { /* current limit: hold the ramp until the motor catches up */ }
      else if (i.stall && !up && !i.brake && o.bus > 700) o.f = toward(o.f, m ? e[`${m}.fn`] : o.f, rate);   // bus high: ease off, so it regenerates less
      else o.f = toward(o.f, want, rate);
      // at 0 Hz it holds the output on for a moment (hold, s), braking the last of the speed away, then lets go
      o._z = i.run || Math.abs(o.f) > 0.01 ? 0 : o._z + dt;
      o.on = o._z <= i.hold && (i.run || Math.abs(o.f) > 0.01 || o._z > 0) ? 1 : 0;
      if (!o.on) o.f = 0;
      o.running = o.on; o.at = o.on && Math.abs(o.f - want) < 0.05 ? 1 : 0;
    },
  },

  /** An induction motor: torque from the slip (Kloss, with V/f below base and less above it), a starting torque and
   *  current that match a real one (lrt, lrc × rated), and the shaft: J dω/dt = T − load (which opposes the motion,
   *  like friction or a conveyor) + pull (a steady torque, like a hanging load). on 0 means no supply: it coasts.
   *  The rated figures are the nameplate's: kw, rpm (at 50 Hz), poles, Ir (amps; worked out if 0).
 *  fn is the frequency it would turn at with no slip (n × poles / 120). heat is the windings' temperature rise as a
 *  % of the rated rise (100 running at rated current for good; over about 150 the insulation is ageing fast),
 *  warming as I² with time constant tau (s). */
  motor: {
    in: { f: 50, on: 1, load: 0, pull: 0, kw: 1.5, rpm: 1430, poles: 4, J: 0, tk: 2.5, lrt: 2, lrc: 6, Ir: 0, tau: 600 },
    out: { n: 0, fn: 0, T: 0, I: 0, P: 0, slip: 0, turns: 0, Tr: 0, Ir: 0, kw: 0, heat: 0, _w: 0 },
    start(o, i) { o.Tr = i.kw * 1000 / (i.rpm * Math.PI / 30); o.Ir = i.Ir || i.kw * 2; o.kw = i.kw; },
    step(o, i, dt) {
      const p = i.poles, ns50 = 6000 / p, dnr = ns50 - i.rpm, u = i.tk + Math.sqrt(i.tk * i.tk - 1), dk = u * dnr;
      BLOCKS.motor.start(o, i);
      const Tr = o.Tr, Ir = o.Ir, J = i.J || 0.003 * i.kw;
      const kloss = dn => dn === 0 ? 0 : 2 * i.tk * Tr / (dn / dk + dk / dn);
      const k0 = kloss(ns50), rot = dn => Math.abs(dn) / dnr * Math.sqrt(1 + (dnr / dk) ** 2) / Math.sqrt(1 + (dn / dk) ** 2);
      const r0 = rot(ns50), i0 = 0.4, rlr = Math.sqrt((i.lrc ** 2 - i0 * i0) / (1 - i0 * i0));
      const weak = Math.min(1, (50 / Math.max(Math.abs(i.f), 1e-9)) ** 2);   // above 50 Hz the field weakens
      const torque = w => {
        if (!i.on) return 0;
        const dn = 120 * i.f / p - rpm(w), s = Math.min(1, Math.abs(dn) / ns50);
        return (kloss(dn) + Math.sign(dn) * (i.lrt * Tr - k0) * s * s) * weak;
      };
      const w = o._w, Te = torque(w), h = 0.05;
      const k = Math.min(0, (torque(w + h) - torque(w - h)) / (2 * h));     // stiff near synchronous speed: step it implicitly
      let drive = Te + i.pull;
      const load = Math.abs(i.load) + 0.01 * Tr;                       // and a little bearing friction, so it coasts to a stop
      if (w > 1e-6) drive -= load; else if (w < -1e-6) drive += load;
      else drive = Math.abs(drive) <= load ? 0 : drive - Math.sign(drive) * load;   // at rest, the load holds it still
      let w2 = w + dt * drive / (J - dt * k);
      if (w !== 0 && Math.sign(w2) !== Math.sign(w) && Math.abs(Te + i.pull) <= load) w2 = 0;    // friction stops it; it does not reverse it
      o._w = w2;
      const dn = 120 * i.f / p - rpm(w2), s = Math.min(1, Math.abs(dn) / ns50);
      o.n = rpm(w2); o.fn = o.n * p / 120; o.T = torque(w2); o.P = o.T * w2 / 1000; o.turns += w2 * dt / (2 * Math.PI);
      o.slip = i.f ? 100 * dn / (120 * i.f / p) : 0;
      const ir = rot(dn) + (rlr - r0) * s * s;
      o.I = i.on ? Ir * Math.sqrt(i0 * i0 + (1 - i0 * i0) * ir * ir) : 0;
      o.heat += (100 * (o.I / Ir) ** 2 - o.heat) * Math.min(1, dt / i.tau);    // its windings' temperature rise, % of rated
    },
  },

  /** A thermal overload relay: it warms as (I/set)², with a time constant from its class (class 10 trips in about
   *  8 s at 7.2 × set), trips over 1.1 × set, and holds until it has cooled and reset rises.
   *  nc is the 95–96 contact (closed while healthy, in the coil circuit); no is 97–98 (closes on a trip, to a lamp). */
  overload: {
    in: { I: 0, set: 1, class: 10, reset: 0, auto: 0 },
    out: { trip: 0, heat: 0, nc: 1, no: 0, _h: 0, _r: 0 },
    step(o, i, dt) {
      const tau = i.class * 36.3;
      o._h += ((i.I / i.set) ** 2 - o._h) * dt / tau;
      if (o._h >= 1.21) o.trip = 1;
      if (o.trip && o._h < 1 && (i.auto || (i.reset && !o._r))) o.trip = 0;
      o._r = i.reset;
      o.heat = 100 * o._h / 1.21; o.nc = o.trip ? 0 : 1; o.no = o.trip;
    },
  },

  /** A servo axis (mm): a trapezoid move to target (vmax, amax), a position loop (kp, 1/s) with velocity
   *  feed-forward ff (0–1), round a velocity loop that answers with time constant 1/kv. ferr is the following
   *  error; over maxerr it trips (FE). invert 1 is an encoder wired backwards: the loop pushes the wrong way.
   *  x is where the carriage really is (for sensors and the 3D); pos is where the controller thinks it is.
   *  They differ until homing: preset rising says "here is pos0" (the home position), as a drive's homing does. */
  axis: {
    in: { target: 0, enable: 1, vmax: 200, amax: 1000, kp: 30, kv: 300, ff: 1, maxerr: 5, invert: 0, reset: 0, pos0: 0, x0: null, preset: 0, load: 0 },
    out: { pos: 0, x: 0, vel: 0, cmd: 0, ferr: 0, done: 0, trip: 0, fault: '', homed: 0, _v: 0, _r: 0, _p: 0, _off: 0 },
    start(o, i) { o.x = i.x0 ?? i.pos0; o.pos = o.cmd = i.pos0; o._off = o.x - i.pos0; },
    step(o, i, dt) {
      if (i.reset && !o._r && o.trip) { o.trip = 0; o.fault = ''; o.cmd = o.pos; o._v = 0; }
      o._r = i.reset;
      if (i.preset && !o._p) { o._off = o.x - i.pos0; o.pos = i.pos0; o.cmd = i.pos0; o._v = 0; o.homed = 1; }
      o._p = i.preset;
      o.pos = o.x - o._off;
      const fb = i.invert ? 2 * i.pos0 - o.pos : o.pos;
      if (!i.enable || o.trip) { o.cmd = fb; o._v = 0; o.vel *= Math.max(0, 1 - 20 * dt); o.x += o.vel * dt; o.pos = o.x - o._off; o.done = 0; o.ferr = 0; return; }
      // the profile: as fast as vmax allows, slowing in time to stop at the target
      const d = i.target - o.cmd, vstop = Math.sqrt(2 * i.amax * Math.abs(d));
      const want = Math.sign(d) * Math.min(i.vmax, vstop);
      o._v = toward(o._v, want, i.amax * dt);
      if (Math.abs(o._v * dt) >= Math.abs(d) && Math.sign(o._v) !== -Math.sign(d)) { o.cmd = i.target; o._v = 0; }   // there this step
      else o.cmd += o._v * dt;
      o.ferr = o.cmd - fb;                                                  // the error the loop acts on this step
      const vref = i.ff * o._v + i.kp * o.ferr;
      o.vel += (vref - i.load - o.vel) * Math.min(1, i.kv * dt);
      o.x += o.vel * dt; o.pos = o.x - o._off;
      o.done = Math.abs(i.target - o.cmd) < 1e-6 && Math.abs(o.ferr) < 0.05 && Math.abs(o.vel) < 1 ? 1 : 0;
      if (Math.abs(o.ferr) > i.maxerr) { o.trip = 1; o.fault = 'FE'; }
    },
  },

  // ---- moving things ------------------------------------------------------------------------------------

  /** A belt conveyor: speed from the motor's rpm through a gearbox (ratio) and a drive pulley (dia, m).
   *  Items (size m long) come on every so many seconds of running (every), or one each time add rises; kinds come
   *  from pattern in turn. They fall off the end (out counts them) or, with stop 1, queue against an end stop.
   *  eject (a formula, the pusher out) at eject_at knocks an item off (rejects). slip 0.3 is a belt slipping 30%.
 *  preload: [0.5, 1.2] puts items on the belt at those places to begin with.
 *  out1 and rej1 count the items of kind 1 or more (the ones to reject) that went off the end and were knocked
 *  off: for a sorter, out1 is a bad one let through and rejects − rej1 a good one thrown away. */
  conveyor: {
    in: { rpm: 0, ratio: 1, dia: 0.1, length: 2, every: 0, add: 0, size: 0.2, pattern: [0], stop: 0, eject: 0, eject_at: 1, slip: 0, preload: [] },
    text: ['pattern', 'preload'],
    out: { v: 0, pos: 0, items: [], n: 0, out: 0, rejects: 0, last: -1, out1: 0, rej1: 0, _a: 0, _acc: 0, _made: 0 },
    start(o, i) {
      const pat = i.pattern?.length ? i.pattern : [0];
      o.items = (i.preload || []).map(x => ({ x, k: pat[o._made++ % pat.length], id: o._made, s: i.size }));
      o.n = o.items.length;
    },
    step(o, i, dt) {
      o.v = i.rpm / 60 / i.ratio * Math.PI * i.dia * (1 - i.slip);
      o.pos += o.v * dt;
      const pat = i.pattern?.length ? i.pattern : [0];
      const make = () => {
        if (o.items.some(it => it.x < i.size * 1.5)) return;           // the loading end is full
        o.items.push({ x: i.size / 2, k: pat[o._made++ % pat.length], id: o._made, s: i.size });
      };
      if (i.add && !o._a) make();
      o._a = i.add;
      if (i.every > 0 && Math.abs(o.v) > 1e-3) { o._acc += dt; if (o._acc >= i.every) { o._acc = 0; make(); } }
      o.items.sort((a, b) => b.x - a.x);
      let limit = i.stop ? i.length - i.size / 2 : Infinity;
      for (const it of o.items) { it.x = Math.max(i.size / 2, Math.min(it.x + o.v * dt, limit)); limit = it.x - i.size; }
      const off = o.items.filter(it => it.x > i.length + i.size / 2);
      if (off.length) { o.out += off.length; o.out1 += off.filter(it => it.k >= 1).length; o.last = off.at(-1).k; o.items = o.items.filter(it => !off.includes(it)); }
      if (i.eject) {
        const hit = o.items.find(it => Math.abs(it.x - i.eject_at) < i.size / 2);
        if (hit) { o.rejects++; if (hit.k >= 1) o.rej1++; o.items = o.items.filter(it => it !== hit); }
      }
      o.n = o.items.length;
    },
  },

  /** A pneumatic cylinder: stroke (m), speed out and back (m/s). With retract given it is a double-solenoid valve
   *  (each solenoid moves it, the valve stays where it was last sent); without, a spring-return one (out while
   *  extend is on). ext and ret are its end switches. air 0: no supply, it stays put. stick 1: it has seized. */
  cylinder: {
    in: { extend: 0, retract: null, stroke: 0.1, speed: 0.2, back: 0, air: 1, stick: 0 },
    out: { pos: 0, ext: 0, ret: 1, moving: 0, _out: 0 },
    step(o, i, dt) {
      if (i.retract == null) o._out = !!i.extend;
      else if (i.extend && !i.retract) o._out = 1; else if (i.retract && !i.extend) o._out = 0;
      const to = o._out ? i.stroke : 0, was = o.pos;
      if (i.air && !i.stick) o.pos = toward(o.pos, to, (o._out ? i.speed : i.back || i.speed) * dt);
      o.moving = o.pos !== was ? 1 : 0;
      o.ext = o.pos >= i.stroke - 0.001 ? 1 : 0; o.ret = o.pos <= 0.001 ? 1 : 0;
    },
  },

  /** A tank: level (m) from inflow and outflow (L/s) over its area (m²). It cannot give what it has not got,
   *  and over the top it spills (over 1). */
  tank: {
    in: { inflow: 0, outflow: 0, area: 1, height: 2, level0: 0 },
    out: { level: 0, pct: 0, vol: 0, over: 0, empty: 1 },
    start(o, i) { o.level = i.level0; },
    step(o, i, dt) {
      const out = o.level > 0 ? i.outflow : Math.min(i.outflow, i.inflow);
      o.level = o.level + (i.inflow - out) / 1000 * dt / i.area;
      o.over = o.level > i.height ? 1 : 0;
      o.level = sat(o.level, 0, i.height);
      o.pct = 100 * o.level / i.height; o.vol = o.level * i.area * 1000; o.empty = o.level <= 1e-4 ? 1 : 0;
    },
  },

  // ---- sensors -------------------------------------------------------------------------------------------

  /** A photo-eye across a conveyor (belt: the conveyor block) at at (m). dark 1: on while the beam is blocked;
   *  0: on while it is clear. kind: only items of that kind block it (a colour sensor); -1 any.
   *  stuck: -1 works, 0 stuck off, 1 stuck on (a fault). */
  eye: {
    in: { belt: '', at: 1, dark: 1, kind: -1, stuck: -1 },
    text: ['belt'],
    out: { on: 0, blocked: 0 },
    step(o, i, dt, sim) {
      const items = sim.env[`${i.belt}.items`] || [];
      o.blocked = items.some(it => Math.abs(it.x - i.at) < it.s / 2 && (i.kind < 0 || it.k === i.kind)) ? 1 : 0;
      o.on = i.stuck >= 0 ? i.stuck : i.dark ? o.blocked : 1 - o.blocked;
    },
  },

  /** A switch on a value: on while x is within range of at; or with above (or below) given, while x is above
   *  (below) it. A limit switch, a prox on a target, a level switch, a pressure switch. nc 1 opens instead.
   *  stuck: -1 works, 0 stuck off, 1 stuck on. */
  sensor: {
    in: { x: 0, at: 0, range: 0.005, above: null, below: null, nc: 0, stuck: -1 },
    out: { on: 0, hit: 0 },
    step(o, i) {
      o.hit = (i.above != null ? i.x >= i.above : i.below != null ? i.x <= i.below : Math.abs(i.x - i.at) <= i.range) ? 1 : 0;
      o.on = i.stuck >= 0 ? i.stuck : i.nc ? 1 - o.hit : o.hit;
    },
  },

  /** An incremental encoder on a shaft (turns, revolutions): ppr pulses a turn, counted on every edge of A and B
   *  (×4). A leads B going forwards. invert 1: A and B swapped, so it counts the wrong way. */
  encoder: {
    in: { turns: 0, ppr: 1024, invert: 0 },
    out: { count: 0, A: 0, B: 0 },
    step(o, i) {
      const c = Math.floor(i.turns * i.ppr * 4), q = ((c % 4) + 4) % 4;
      o.count = i.invert ? -c : c;
      o.A = q === 1 || q === 2 ? 1 : 0; o.B = q >= 2 ? 1 : 0;
      if (i.invert) [o.A, o.B] = [o.B, o.A];
    },
  },

  /** A 4–20 mA transmitter over lo..hi, and what an S7 analogue input reads from it: 4 mA is 0, 20 mA is 27648,
   *  down to −4864 (1.185 mA) and up to 32511 (22.8 mA); below that it is a wire break, −32768.
   *  fail: 0 works, 1 open circuit (0 mA), 2 shorted (over 21 mA), 3 stuck where it was. tau: damping (s).
   *  ponytail: the S7 numbers are the usual ones for a 4–20 mA range; check the card's manual for yours. */
  tx: {
    in: { pv: 0, lo: 0, hi: 100, fail: 0, tau: 0 },
    out: { mA: 4, pct: 0, raw: 0, _f: null },
    step(o, i, dt) {
      const pct = 100 * (i.pv - i.lo) / (i.hi - i.lo);
      const f = o._f ?? pct;
      o._f = i.tau > 0 ? f + (pct - f) * Math.min(1, dt / i.tau) : pct;
      if (i.fail !== 3) o.pct = sat(o._f, -18.75, 117.6);
      o.mA = i.fail === 1 ? 0 : i.fail === 2 ? 21.5 : 4 + 16 * o.pct / 100;
      o.raw = o.mA < 1.185 ? -32768 : Math.round(sat((o.mA - 4) / 16 * 27648, -4864, 32511));
    },
  },
};

/** The PLC's variables as outputs: BOOL as 1 and 0, a block's fields as plc.T1.Q. */
function copy(o, vars) {
  for (const [k, v] of Object.entries(vars)) {
    if (v && typeof v === 'object') { for (const [f, x] of Object.entries(v)) if (!f.startsWith('_')) o[`${k}.${f}`] = typeof x === 'boolean' ? +x : x; }
    else o[k] = typeof v === 'boolean' ? +v : v;
  }
}
