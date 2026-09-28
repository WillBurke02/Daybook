// node tests/learn.check.mjs — Learn's logic that runs in the browser: question
// templates and the Structured Text interpreter.
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const tpl = await load('apps/learn/web/template.js');
const st = await load('apps/learn/web/st.js');

// Scheduling moved to the server (apps/learn/fsrs.py); tests/test_learn.py checks it against the reference.

// === question templates ======================================================================
{
  const card = { vars: { v: [5850, 5950, 10], t: [5, 20, 0.5] }, let: { d: 'v * t / 1e6 / 2 * 1000' }, answer: 'd', tolerance: 0.02 };
  let r = 0;
  const seq = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let k = 0; k < 200; k++) {
    const x = tpl.draw(card, seq);
    assert.ok(x.v >= 5850 && x.v <= 5950 && x.v % 10 === 0, x.v);
    assert.ok(x.t >= 5 && x.t <= 20 && Math.abs(x.t * 2 - Math.round(x.t * 2)) < 1e-9, x.t);
    assert.ok(Math.abs(x.answer - x.v * x.t / 2000) < 1e-9);
  }
  const x = tpl.draw({ vars: { v: [5920, 5920, 1], t: [10, 10, 1] }, let: { d: 'v * t / 2e3' }, answer: 'd' });
  assert.equal(x.answer, 29.6);
  assert.equal(tpl.fill('Steel at {v} m/s, echo at {t} µs: {d} mm, or {d:2} mm; {nope} stays', x),
               'Steel at 5920 m/s, echo at 10 µs: 29.6 mm, or 29.60 mm; {nope} stays');
  assert.equal(tpl.draw({ vars: { m: ['steel', 'aluminium'] } }, () => 0.99).m, 'aluminium');
  assert.equal(tpl.draw({ vars: { m: { pick: [1, 2, 3] } } }, () => 0).m, 1);
  assert.throws(() => tpl.draw({ vars: { x: [0, 0, 1] }, answer: '1 / x' }), /Divided by zero|gives/);
  // what he types
  assert.equal(tpl.read('29.6'), 29.6); assert.equal(tpl.read('1,480'), 1480); assert.equal(tpl.read('5.92e3'), 5920);
  assert.equal(tpl.read('5920*10/2000'), 29.6); assert.equal(tpl.read('−4'), -4); assert.ok(isNaN(tpl.read('about 30')));
  assert.ok(isNaN(tpl.read('')));
  // within 2% by default, or the card's own tolerance, relative or absolute
  assert.ok(tpl.right(30, 29.6) && !tpl.right(30.3, 29.6));
  assert.ok(tpl.right(31, 29.6, { tolerance: 0.05 }) && tpl.right(29.9, 29.6, { abs: 0.5 }) && !tpl.right(30.2, 29.6, { abs: 0.5 }));
  assert.ok(tpl.right(0, 0) && !tpl.right(0.1, 0) && !tpl.right(NaN, 1));
  assert.equal(tpl.fmt(0.00118343), '0.001183'); assert.equal(tpl.fmt(5920), '5920'); assert.equal(tpl.fmt(46480000), '4.65e7');
  assert.equal(tpl.fmt(1 / 3), '0.3333'); assert.equal(tpl.fmt(2.5, 2), '2.50');
}
console.log('ok — question templates');

// === Structured Text ===========================================================================
{
  // the seal-in: Start latches the motor, Stop drops it
  const sealIn = st.compile('Motor := (Start OR Motor) AND NOT Stop;');
  const m = st.machine(sealIn, { inputs: ['Start', 'Stop'], outputs: ['Motor'] });
  assert.equal(st.scan(m, { Start: true }).Motor, true);
  assert.equal(st.scan(m, { Start: false }).Motor, true, 'held in by its own contact');
  assert.equal(st.scan(m, { Stop: true }).Motor, false);
  assert.equal(st.scan(m, { Stop: false }).Motor, false);

  // a timer: on-delay of 2 s at 100 ms a scan
  const ton = st.compile(`VAR T1 : TON; END_VAR
    T1(IN := Go, PT := T#2s);   (* on delay *)
    Lamp := T1.Q;`);
  const t = st.machine(ton, { inputs: ['Go'], outputs: ['Lamp'] });
  for (let k = 0; k < 19; k++) st.scan(t, { Go: true }, 100);
  assert.equal(t.vars.Lamp, false); assert.equal(t.vars.T1.ET, 1900);
  st.scan(t, { Go: true }, 100);
  assert.equal(t.vars.Lamp, true, 'on after 2 s');
  st.scan(t, { Go: false }, 100);
  assert.equal(t.vars.Lamp, false); assert.equal(t.vars.T1.ET, 0);

  // TOF holds on after the input drops
  const tof = st.machine(st.compile('VAR F : TOF; END_VAR F(IN := X, PT := T#500ms); Y := F.Q;'), { inputs: ['X'] });
  st.scan(tof, { X: true }); assert.equal(tof.vars.Y, true);
  for (let k = 0; k < 4; k++) st.scan(tof, { X: false }); assert.equal(tof.vars.Y, true);
  st.scan(tof, { X: false }); assert.equal(tof.vars.Y, false, 'off 500 ms after');

  // a counter counts rising edges, not scans held high; R_TRIG gives one scan
  const ctu = st.machine(st.compile(`VAR C : CTU; E : R_TRIG; Pulses : INT; END_VAR
    C(CU := Box, R := Reset, PV := 3);
    E(CLK := Box);
    IF E.Q THEN Pulses := Pulses + 1; END_IF;
    Full := C.Q;`), { inputs: ['Box', 'Reset'] });
  for (const b of [true, true, false, true, false, true, true]) st.scan(ctu, { Box: b });
  assert.equal(ctu.vars.C.CV, 3); assert.equal(ctu.vars.Pulses, 3); assert.equal(ctu.vars.Full, true);
  st.scan(ctu, { Reset: true }); assert.equal(ctu.vars.C.CV, 0);

  // IF/ELSIF/ELSE, CASE with lists and ranges, arithmetic, MOD, case-insensitive names
  const sm = st.machine(st.compile(`VAR Step : INT := 0; n : INT; END_VAR
    CASE step OF
      0: Step := 10;
      10, 20: Step := Step + 10;
      30..39: Step := 99;
    ELSE Step := -1;
    END_CASE;
    IF Step > 50 THEN n := 1; ELSIF Step MOD 20 = 0 THEN n := 2; ELSE n := 3; END_IF;`));
  const seen = [];
  for (let k = 0; k < 5; k++) { st.scan(sm); seen.push([sm.vars.Step, sm.vars.n]); }
  assert.deepEqual(seen, [[10, 3], [20, 2], [30, 3], [99, 1], [-1, 3]]);

  // FOR, WHILE, integer division, REAL
  const loop = st.machine(st.compile(`VAR i, s : INT; r : REAL; END_VAR
    s := 0; FOR i := 1 TO 10 DO s := s + i; END_FOR;
    WHILE s > 50 DO s := s - 7; END_WHILE;
    r := 7.0 / 2; q := 7 / 2;`));
  st.scan(loop); assert.equal(loop.vars.s, 48); assert.equal(loop.vars.r, 3.5); assert.equal(loop.vars.q, 3);
  assert.equal(st.time('T#1m30s'), 90000); assert.equal(st.time('T#500ms'), 500); assert.equal(st.time('TIME#2.5s'), 2500);

  // mistakes say where they are
  assert.throws(() => st.compile('IF A THEN B := 1;'), /expected END_IF/);
  assert.throws(() => st.compile('A := (B AND C;\n'), /line 1/);
  assert.throws(() => st.scan(st.machine(st.compile('X := Nope;'))), /Nope is not declared/);
  assert.throws(() => st.scan(st.machine(st.compile('WHILE TRUE DO x := 1; END_WHILE;'))), /ran too long/);

  // a code card's tests
  const card = { inputs: ['Start', 'Stop'], outputs: ['Motor'], tests: [
    { name: 'starts', steps: [{ set: { Start: true }, expect: { Motor: true } }] },
    { name: 'stays on', steps: [{ set: { Start: true } }, { set: { Start: false }, expect: { Motor: true } }] },
    { name: 'stops', steps: [{ set: { Start: true } }, { set: { Start: false, Stop: true }, expect: { Motor: false } }] }] };
  assert.deepEqual(st.test('Motor := (Start OR Motor) AND NOT Stop;', card).map(r => r.ok), [true, true, true]);
  const wrong = st.test('Motor := Start AND NOT Stop;', card);
  assert.deepEqual(wrong.map(r => r.ok), [true, false, true]);
  assert.match(wrong[1].why, /Motor is false, should be true/);
}
console.log('ok — Structured Text');

// ---- Formula help: which formulas and notation a card's maths shows ----
{
  globalThis.location ??= { pathname: '/learn/', hash: '' };            // the page's address, which api.js reads on load
  const fh = await load('apps/learn/web/formulas.js');
  const db = { formulas: [{ tex: 'd = \\frac{vt}{2}', match: ['\\frac{vt}{2}'], lesson: 'a' }, { tex: 'd=\\frac{vt}{2}', lesson: 'b' },
                          { tex: 'V = IR', lesson: 'b' }],
               symbols: JSON.parse((await import('node:fs')).readFileSync(new URL('../apps/learn/content/symbols.json', import.meta.url))).symbols };
  const got = fh.findHelp(db, ['d = \\tfrac{vt}{2}', 'u = K_p e + K_d \\frac{de}{dt}'], 'b');
  assert.deepEqual(got.here.map(f => f.lesson), ['b'], 'the same formula once, this lesson first');
  assert.deepEqual(got.lesson.map(f => f.tex), ['V = IR']);
  const names = got.symbols.map(s => s.name);
  assert.ok(names.some(n => /derivative/.test(n)) && names.some(n => /subscript|below/i.test(n)) && names.some(n => /fraction/i.test(n)), names.join(' | '));
  assert.ok(!fh.findHelp(db, ['\\frac{ d }{v}'], 'a').symbols.some(s => /derivative/.test(s.name)), 'd over v is not a derivative');
  assert.deepEqual(fh.mathsOf({ q: 'Find $x^{{n}}$', why: 'no maths', options: ['$a$'] }, { n: 3 }), ['x^{3}', 'a']);
}
console.log('ok — Formula help');
