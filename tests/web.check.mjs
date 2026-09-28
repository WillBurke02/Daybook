// node tests/web.check.mjs — small pieces of browser-side logic.
import assert from 'node:assert/strict';
import { usualTimes } from '../web/core/format.js';
import { kindOf, joinRows, prefixOf } from '../web/core/rows.js';

// the usual day: first start and last finish of each day, the most common of each
const u = usualTimes([
  { date: '2026-09-01', start: '07:30', end: '16:30' },
  { date: '2026-09-02', start: '07:30', end: '12:00' }, { date: '2026-09-02', start: '13:00', end: '17:00' },
  { date: '2026-09-03', start: '08:00', end: '16:30' },
  { date: '2026-09-04', start: '18:00', end: '21:00' }, { date: '2026-09-04', start: '07:30', end: '16:30' },
  { date: '2026-09-05', start: '09:00', end: '16:30' },
]);
assert.deepEqual(u, { start: '07:30', end: '16:30' });
assert.deepEqual(usualTimes([]), { start: null, end: null });
assert.equal(usualTimes([{ date: 'a', start: '08:00', end: '1' }, { date: 'b', start: '07:00', end: '1' }]).start, '08:00');   // a tie: the first seen
console.log('ok — usual start and finish');

// a panel over two sources: each day, with that day's spending added up beside it
const days = [{ date: '2026-09-01', hours: 8 }, { date: '2026-09-02', hours: 9.5 }, { date: '2026-09-03', hours: 0 }];
const spend = [{ date: '2026-09-01', amount: 4.5, payee: 'Tesco' }, { date: '2026-09-01', amount: 10, payee: 'Shell' },
               { date: '2026-09-03', amount: 2, payee: 'Greggs' }];
const j = joinRows(days, spend, 'date', 'date', prefixOf('v_spend'));
assert.equal(prefixOf('v_spend'), 'spend_');
assert.deepEqual(j.map(r => [r.spend_amount, r.spend_rows, r.spend_payee]), [[14.5, 2, 'Tesco'], [null, 0, null], [2, 1, 'Greggs']]);
assert.equal(j.length, 3);                                    // every row of the first source keeps its place
assert.equal(days[0].spend_amount, undefined);                // and the rows handed in are not changed
assert.deepEqual(['hours', 'date', 'payee', 'none'].map(k => kindOf([...days, ...spend], k)), ['number', 'date', 'text', 'empty']);
assert.equal(kindOf([{ m: '2026-09' }], 'm'), 'date');
console.log('ok — joining two sources, column kinds');
