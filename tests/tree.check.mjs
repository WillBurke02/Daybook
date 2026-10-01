// node tests/tree.check.mjs — where lessons sit on the skill tree.
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { layout, edge, tierOf, NW, NH, GY } = await load('apps/learn/web/treelayout.js');
const L = (id, unit, level, sort) => ({ id, unit_id: unit, unit: unit.toUpperCase(), level, sort });
const lessons = [L('a1', 'a', 2.4, 1), L('a2', 'a', 2.9, 2), L('a3', 'a', 4.5, 3), L('b1', 'b', 3.2, 1), L('b2', 'b', 4.0, 2)];
const t = layout(lessons);
assert.equal(tierOf({ level: 4.99 }), 4); assert.equal(tierOf({}), 1); assert.equal(tierOf({ level: 12 }), 9);
assert.deepEqual(t.cols.map(c => c.tier), [2, 3, 4], 'columns run from the lowest tier to the highest present');
assert.ok(t.nodes.a1.x < t.nodes.b1.x && t.nodes.b1.x < t.nodes.b2.x, 'harder is further right');
assert.equal(t.nodes.a1.x, t.nodes.a2.x, 'one tier, one column');
assert.equal(t.nodes.a2.y - t.nodes.a1.y, NH + GY, 'two in a cell stack, a gap apart');
assert.ok(t.nodes.b1.y >= t.lanes[1].y && t.nodes.b1.y > t.nodes.a3.y, 'a unit has its own lane, below the last');
for (const l of lessons) { const n = t.nodes[l.id]; assert.ok(n.x + NW <= t.w && n.y + NH <= t.h, `${l.id} is inside the canvas`); }
const boxes = Object.values(t.nodes);
for (const a of boxes) for (const b of boxes) if (a !== b) assert.ok(a.x + NW <= b.x || b.x + NW <= a.x || a.y + NH <= b.y || b.y + NH <= a.y, 'no two nodes overlap');
assert.match(edge(t.nodes.a1, t.nodes.b2), /^M\d+ \d+C/, 'an edge is a curve');
assert.ok(edge(t.nodes.a1, t.nodes.a2).includes(`${t.nodes.a1.x + NW / 2} ${t.nodes.a1.y + NH}`), 'inside a column an edge leaves the bottom');
console.log('ok — skill tree layout');
