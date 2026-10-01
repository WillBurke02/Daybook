// The skill tree: a subject as a map. Columns are the stages, rows are units, lines are
// prerequisites. Pick a lesson to see what it needs and opens; make one your goal and the
// tree becomes a route to it. Nothing locks: "needs" is a hint (PLAN-SKILLTREE.md).
import { api } from '../api.js';
import { el, flash, seg, readVal, writeVal } from '../core/dom.js';
import { layout, edge, NW, NH, HEAD } from '../treelayout.js';
import { lessonHref } from './courses.js';
import { stageChip, stageOf } from './levels.js';
import { MARK, mark, meter, rankBar, roadmapBar } from '../game.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const DONE = new Set(['learned', 'mastered']);

const treePanel = { title: 'Skill tree', w: 12, deps: ['card', 'lesson', 'skill', 'setting'], async render(body, ctx) {
  const [subjects, lv, game] = await Promise.all([api.view('v_subject', { order: 'sort' }), api.levels(), api.game()]);
  ctx.setTitle('');
  const list = subjects.filter(s => s.id !== 'mine' && s.written > 0);
  if (!list.length) { body.append(el('p', { class: 'note' }, 'No courses are written yet.')); return; }
  const stored = readVal('learn:tree', null);
  const sid = [ctx.params.s, stored].find(s => list.some(x => x.id === s)) || list[0].id;
  const data = await api.tree(sid);
  const lessons = data.lessons, byId = Object.fromEntries(lessons.map(l => [l.id, l]));
  const skill = lv.skills.find(k => k.scope === sid);
  const rm = game.roadmap;
  let sel = [ctx.params.l, rm?.next?.id, lessons.find(l => l.state === 'going')?.id, lessons.find(l => l.state === 'ready')?.id, lessons[0]?.id]
    .find(id => byId[id]);

  const setGoal = async id => { try { await api.setGoal(id); ctx.refresh(); } catch (e) { flash(e.message); } };
  const pick = s => byId[s.id] ? () => select(s.id) : null;

  // ---- the header: subjects, rank, your level here ----
  body.append(el('div', { class: 'row mid tree-head' },
    seg(list.map(s => ({ v: s.id, label: s.title })), sid, v => { writeVal('learn:tree', v); ctx.go('tree', { s: v }); }),
    el('span', { class: 'spacer' }), rankBar(game)));
  body.append(el('div', { class: 'row mid small muted tree-sub' },
    skill?.placed || skill?.n ? ['Your level here: ', stageChip({ level: skill.level, low: skill.low, high: skill.high })]
      : el('a', { href: `#/calibrate?s=${encodeURIComponent(sid)}` }, 'Find my level here (about 10 min)'),
    el('span', {}, `${data.xp.xp} XP in this subject`),
    el('span', { class: 'tkey' }, ['mastered', 'learned', 'going', 'ready', 'needs', 'unwritten'].map(k =>
      el('span', { class: `st-${k}` }, mark(k), MARK[k][1])))));
  body.append(rm ? roadmapBar(rm, { pick, clear: () => setGoal(null) })
    : el('p', { class: 'note' }, 'No goal yet. Pick a lesson below and choose “Make this my goal”: the tree becomes a route to it, and Today shows your next step.'));

  // ---- the map ----
  const L = layout(lessons);
  const canvas = el('div', { class: 'tcanvas' + (rm ? ' route' : ''), style: `width:${L.w}px;height:${L.h}px` });
  L.lanes.forEach((ln, i) => canvas.append(el('div', { class: 'tlane' + (i % 2 ? ' alt' : ''), style: `top:${ln.y}px;height:${ln.h}px` },
    el('span', { class: 'tlabel' }, ln.title))));
  for (const c of L.cols) {
    const [, name] = stageOf(c.tier);
    canvas.append(el('div', { class: 'tcol', style: `left:${c.x}px;width:${NW}px;top:0;height:${HEAD - 8}px` }, el('b', { class: 'num' }, c.tier), ` ${name}`));
  }
  const edges = svg('svg', { class: 'tedges', width: L.w, height: L.h, 'aria-hidden': 'true' });
  const links = [];
  for (const l of lessons) for (const p of l.needs) if (byId[p.id]) {
    const path = svg('path', { d: edge(L.nodes[p.id], L.nodes[l.id]), class: 'tedge' + (DONE.has(byId[p.id].state) ? ' done' : '')
      + (l.step && (byId[p.id].step || DONE.has(byId[p.id].state)) ? ' route' : '') });
    edges.append(path); links.push([p.id, l.id, path]);
  }
  canvas.append(edges);
  const nodes = {};
  for (const l of lessons) {
    const at = L.nodes[l.id], label = MARK[l.state][1];
    const b = el('button', { class: `tnode st-${l.state}` + (rm && !l.step && !l.goal ? ' dim' : '') + (l.goal ? ' goal' : ''), type: 'button',
      style: `left:${at.x}px;top:${at.y}px;width:${NW}px;height:${NH}px`, 'aria-pressed': 'false',
      'aria-label': `${l.title}. ${label}${l.level != null ? `. Stage ${l.level.toFixed(1)}` : ''}${l.step ? `. Step ${l.step} of your route` : ''}`,
      onclick: () => select(l.id) },
      el('span', { class: 'tstate' }, mark(l.state), label, l.step ? el('b', { class: 'tstep' }, `step ${l.step}`) : null, l.goal ? el('b', { class: 'tstep' }, 'goal') : null),
      el('span', { class: 'ttitle' }, l.title.split(':')[0]),
      el('span', { class: 'tfoot' }, l.level != null ? el('span', { class: 'num' }, l.level.toFixed(1)) : null,
        l.asks && l.state !== 'unwritten' ? meter(l.mastered / l.asks, `${pct(l.mastered, l.asks)}% solid`) : null));
    nodes[l.id] = b; canvas.append(b);
  }
  const panel = el('div', { class: 'tpanel', 'aria-live': 'polite' });
  const scroll = el('div', { class: 'tscroll' }, canvas);
  const reveal = id => scroll.scrollTo({ left: Math.max(0, L.nodes[id].x - 60), top: Math.max(0, L.nodes[id].y - 60) });   // the map only, never the page
  body.append(scroll, panel);

  function select(id) {
    sel = id;
    for (const [k, b] of Object.entries(nodes)) b.setAttribute('aria-pressed', String(k === id));
    for (const [a, b, p] of links) p.classList.toggle('hi', a === id || b === id);
    paint();
  }
  const ref = (s, tail) => byId[s.id]
    ? el('button', { class: 'link', type: 'button', onclick: () => { select(s.id); reveal(s.id); } }, s.title)
    : el('a', { class: 'link', href: lessonHref(s.id) }, s.title, tail);
  const refs = (what, list) => list.length ? el('div', { class: 'small' }, el('b', {}, `${what}: `), list.map((s, i) => [i ? ' · ' : '',
    mark(s.state), ' ', ref(s, byId[s.id] ? '' : ` (${s.subject})`)])) : null;
  function paint() {
    const l = byId[sel];
    if (!l) { panel.replaceChildren(); return; }
    const full = l.state === 'unwritten';
    panel.replaceChildren(el('div', { class: 'tcard' },
      el('div', { class: 'row mid' }, el('h3', {}, l.title), l.level != null ? stageChip({ level: l.level }) : null),
      el('div', { class: 'row mid small muted' }, mark(l.state), MARK[l.state][1],
        full ? null : `${l.cards} cards`, l.minutes ? `about ${l.minutes} min` : null,
        l.asks && l.state !== 'unwritten' ? `${pct(l.mastered, l.asks)}% solid` : null,
        l.due ? `${l.due} due` : null, l.struggles ? `${l.struggles} coming back` : null,
        l.step ? `step ${l.step} of your route` : null, l.goal ? 'your goal' : null),
      refs('Needs', l.needs), refs('Opens', l.unlocks),
      l.state === 'needs' ? el('p', { class: 'small muted' }, 'It still opens: those lessons are a hint, not a gate. Not sure you need them? ',
        el('a', { href: lessonHref(l.id, '&testout=1') }, 'Test out of this one'), '.') : null,
      full ? el('p', { class: 'muted' }, 'In the outline, not written yet. You can still make it your goal; the route skips what cannot be done.') : null,
      el('div', { class: 'row' },
        full ? null : el('a', { class: 'btn', href: lessonHref(l.id) }, { going: 'Continue', learned: 'Review it', mastered: 'Review it' }[l.state] || 'Start'),
        !full && ['ready', 'needs', 'going'].includes(l.state) ? el('a', { class: 'btn plain', href: lessonHref(l.id, '&testout=1') }, 'Test out') : null,
        l.goal ? el('button', { class: 'btn plain', type: 'button', onclick: () => setGoal(null) }, 'Clear goal')
          : DONE.has(l.state) ? null : el('button', { class: 'btn plain', type: 'button', onclick: () => setGoal(l.id) }, 'Make this my goal'))));
  }
  select(sel);
  if (sel) reveal(sel);
} };

export const page = { title: 'Skill tree', layout: [{ use: 'learn.tree' }], panels: { 'learn.tree': treePanel } };
