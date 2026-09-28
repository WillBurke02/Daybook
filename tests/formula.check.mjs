// node tests/formula.check.mjs — the formula engine, which runs in the browser.
import assert from 'node:assert/strict';
import { parse, run, evaluate, resolveRef, refsIn, refKey, num, show } from '../web/core/formula.js';

const rows = [
  { Date: '01/09/2026', Started: '08:00', Finished: '16:00', Hours: '08:00', 'Day total': '08:00', Overtime: '' },
  { Date: '03/09/2026', Started: '06:15', Finished: '19:30', Hours: '13:15', 'Day total': '13:15', Overtime: '04:45 ×1.5' },
  { Date: '06/09/2026', Started: '16:30', Finished: '23:00', Hours: '06:30', 'Day total': '06:30', Overtime: '£1,234.50' },
];
const at = (src, i) => run(src, { row: rows[i], rows, index: i });
const total = src => run(src, { rows });

assert.equal(at('DAYNAME(Date)', 0).value, 'Tue');
assert.equal(at('DAYNAME(Date)', 2).value, 'Sun');
assert.equal(at('Hours * 12.82', 1).value, 13.25 * 12.82);
assert.equal(at('HOURS(Started, Finished)', 1).value, 13.25);
assert.equal(at('[Day total] - 8.5', 0).value, -0.5);
assert.equal(total('SUM(Hours)').value, 27.75);
assert.equal(total('SUM(Hours * 2)').value, 55.5);
assert.equal(total('COUNTIF(Hours, ">8.5")').value, 1);
assert.equal(total('SUMIF(Date, "01/09/2026", Hours)').value, 8);
assert.equal(at('Hours / SUM(Hours)', 0).value, 8 / 27.75);
assert.equal(at('RUNNING(Hours)', 1).value, 21.25);
assert.equal(at('PREV(Hours)', 1).value, '08:00');
assert.equal(at('IF(Hours > 8.5, "long", "short")', 1).value, 'long');
assert.equal(at('IF(Hours > 8.5, "long", "short")', 0).value, 'short');
assert.equal(at('TEXT(Date, "dddd d mmm")', 0).value, 'Tuesday 1 Sept');
assert.equal(at('HHMM(Hours + 0.25)', 0).value, '08:15');
assert.equal(at('"Week " & WEEKNUM(Date)', 0).value, 'Week 36');
assert.equal(at('MONEY(1234.56 * 2)', 0).value, '£2,469.12');
assert.equal(num('£1,234.50'), 1234.5);
assert.equal(num('(45.20)'), -45.2);
assert.equal(at('ROWNUM()', 2).value, 3);
assert.equal(at('WORKDAYS("2026-09-07", "2026-09-13")', 0).value, 5);
assert.equal(run('2 + 3 * 4 ^ 2', {}).value, 50);
assert.equal(run('50%', {}).value, 0.5);
assert.match(total('Hours').error, /SUM\(Hours\)/);
assert.match(at('Nope + 1', 0).error, /No column called Nope/);
assert.match(run('SUMM(1)', {}).error, /no function called SUMM/);
assert.match(run('1 +', {}).error, /ends too soon/);
assert.equal(at('IFERROR(1 / 0, "n/a")', 0).value, 'n/a');

// figures by period
const period = { from: '2026-09-01', to: '2026-09-30' };
assert.deepEqual(resolveRef(['2026', 'May', 'Hours']), { name: 'Hours', from: '2026-05-01', to: '2026-05-31' });
assert.deepEqual(resolveRef(['2026', 'February', 'Gross']), { name: 'Gross', from: '2026-02-01', to: '2026-02-28' });
assert.deepEqual(resolveRef(['2026', 'Q2', 'Spent']), { name: 'Spent', from: '2026-04-01', to: '2026-06-30' });
assert.deepEqual(resolveRef(['2026', 'Tax']), { name: 'Tax', from: '2026-01-01', to: '2026-12-31' });
assert.deepEqual(resolveRef(['TY2026', 'Net']), { name: 'Net', from: '2026-04-06', to: '2027-04-05' });
assert.deepEqual(resolveRef(['2026', 'Sep', '14', 'Hours']), { name: 'Hours', from: '2026-09-14', to: '2026-09-14' });
assert.deepEqual(resolveRef(['This', 'Hours'], period), { name: 'Hours', from: '2026-09-01', to: '2026-09-30' });
assert.equal(resolveRef(['Prev', 'Hours'], period).from, '2026-08-02');   // same length, just before
const ast = parse('SUM(2026.May.Hours) + 2026.Jun.Hours * 2');
const refs = refsIn(ast, period);
assert.equal(refs.length, 2);
const figures = new Map([[refKey(refs[0]), 150], [refKey(refs[1]), 160]]);
assert.equal(evaluate(ast, { figures }), 470);
assert.match(run('2026.Smarch.Hours', {}).error, /not a month/);
assert.equal(show(0.1 + 0.2), '0.3');
console.log('ok — formulas');

// days off typed the way the old sheet had them
const { parseWhen: W, fmtWhen, toNumber, grouped } = await import('../web/core/format.js');
assert.equal(toNumber('24,000'), 24000); assert.equal(toNumber('£1,234.50'), 1234.5); assert.equal(toNumber('abc'), null);
assert.equal(grouped('24000'), '24,000.00'); assert.equal(toNumber(''), null);
const r = (from, to = from) => ({ from, to });
assert.deepEqual(W('8-12 Sep', 2026), r('2026-09-08', '2026-09-12'));
assert.deepEqual(W('25th April', 2026), r('2026-04-25'));
assert.deepEqual(W('27 - 28 Nov', 2027), r('2027-11-27', '2027-11-28'));
assert.deepEqual(W('25/04', 2026), r('2026-04-25'));
assert.deepEqual(W('25/04/27', 2026), r('2027-04-25'));
assert.deepEqual(W('30 Dec - 2 Jan', 2026), r('2026-12-30', '2027-01-02'));
assert.deepEqual(W('Sep 8 to Sep 12', 2026), r('2026-09-08', '2026-09-12'));
assert.deepEqual(W('2026-04-25 to 2026-04-28', 2025), r('2026-04-25', '2026-04-28'));
assert.deepEqual(W(fmtWhen('2026-09-08', '2026-09-12'), 2026), r('2026-09-08', '2026-09-12'));   // round trip
assert.equal(fmtWhen('2026-12-30', '2027-01-02'), 'Wed 30 Dec – Sat 2 Jan');
for (const bad of ['', 'soon', '31 Feb', '12-8 Sep', '8 Smarch']) assert.equal(W(bad, 2026), null, bad);
console.log('ok — days off dates');

// random themes stay readable: text, money and chart colours all clear of the panels
const { randomTheme, contrast, hsl } = await import('../web/ui/palette.js');
assert.equal(hsl(0, 100, 50), '#ff0000'); assert.equal(hsl(120, 100, 25), '#008000');
let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 400; i++) {
  const { vars: v, scheme } = randomTheme(rand, i % 2 === 0);
  const p = v['--panel'], at = (k, r) => assert.ok(contrast(v[k], p) >= r, `${scheme} ${k} ${v[k]} on ${p}: ${contrast(v[k], p).toFixed(2)}`);
  for (const k of Object.keys(v)) assert.match(v[k], /^#[0-9a-f]{6}$/, k);
  at('--ink', 7); at('--ink-2', 4.5); at('--accent', 4.5); at('--debit', 4.5); at('--credit', 4.5); at('--flag', 4.5);
  assert.ok(contrast(v['--accent-ink'], v['--accent']) >= 4.5, 'button text on the accent');
  const series = [1, 2, 3, 4, 5, 6].map(n => v[`--s${n}`]);
  series.forEach((c, n) => { at(`--s${n + 1}`, 3); assert.ok(contrast(c, v['--ground']) >= 3, 'chart colour vs page'); });
  assert.equal(new Set(series).size, 6, 'six different chart colours');
}
console.log('ok — random themes');

// numbers as a question writes them, and the maths a question needs
{
  const v = (src, row = {}) => run(src, { row });
  assert.equal(v('1e6').value, 1e6);
  assert.equal(v('2.5e-3 * 2').value, 0.005);
  assert.equal(v('v * t / 1e6 / 2 * 1000', { v: 5920, t: 10 }).value, 29.6);
  assert.equal(v('SQRT(16) + POWER(2, 3)').value, 12);
  assert.ok(Math.abs(v('SIN(RADIANS(30))').value - 0.5) < 1e-12);
  assert.equal(v('ROUND(DEGREES(ATAN(1)), 6)').value, 45);
  assert.equal(v('LOG10(1000) + LN(EXP(2))').value, 5);
  assert.ok(Math.abs(v('20 * LOG10(a / b)', { a: 80, b: 40 }).value - 6.0206) < 1e-4);
  assert.equal(v('PI()').value, Math.PI);
  assert.equal(v('(Z2 - Z1) / (Z2 + Z1)', { Z1: 1, Z2: 3 }).value, 0.5);
  // a figure reference still reads as one: 2026.May.Hours is not 2026 then e-something
  assert.deepEqual(parse('2026.May.Hours'), { k: 'ref', parts: ['2026', 'May', 'Hours'] });
}
console.log('ok — scientific notation and maths functions');
