// node tests/calc.check.mjs — the calculator beside every card: SI prefixes, degrees, ans, log,
// engineering notation, and errors said rather than thrown.
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { calc, eng, plain, prep } = await load('apps/learn/web/calc.js');
const near = (src, want, opts) => {
  const r = calc(src, opts);
  assert.ok(r.value !== undefined && Math.abs(r.value - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${src} → ${JSON.stringify(r)}, want ${want}`);
};

near('4.7k', 4700); near('220µ', 220e-6); near('220u*2', 440e-6); near('2.5m + 1', 1.0025); near('10M/4.7k', 1e7 / 4700);
near('100n', 1e-7); near('3p', 3e-12); near('1e-3k', 1); near('.5k', 500); near('2G', 2e9);
near('sin(30)', 0.5); near('cos(60)', 0.5); near('asin(0.5)', 30); near('atan(1)', 45);
near('sin(pi/6)', 0.5, { deg: false }); near('asin(1)', Math.PI / 2, { deg: false });
near('log(1000)', 3); near('ln(e)', 1); near('20*log(10)', 20); near('sqrt(2)^2', 2); near('√(16)', 4);
near('ans*2', 10, { ans: 5 }); near('2^10', 1024); near('5%', 0.05); near('3 × 4 ÷ 2', 6); near('2π', 2 * Math.PI);
near('sqrt(3)*400*32*0.85', Math.sqrt(3) * 400 * 32 * 0.85);                // three-phase power, kW-ish
assert.equal(prep('max(1)'), 'max(1)');                                      // a name is never read as a prefix
assert.ok(calc('1/0').error.includes('zero'));
assert.ok(calc('2 +').error);
assert.ok(calc('"text"').error);
assert.equal(eng(4700), '4.7 k'); assert.equal(eng(0.00022), '220 µ'); assert.equal(eng(999999), '1 M');
assert.equal(eng(-0.0015), '-1.5 m'); assert.equal(eng(12), '12'); assert.equal(eng(0), '0');
assert.equal(plain(0.1 + 0.2), '0.3'); assert.equal(plain(1e-9), '1e-9'); assert.equal(plain(0.49999999999999994), '0.5');
console.log('ok — calculator: prefixes, degrees, ans, log, engineering notation, errors');
