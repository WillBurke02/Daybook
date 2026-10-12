// The skill map: tracks of skills that each end in a project you could do for real. All tracks
// as cards, or one track as lines (its subjects) and stops (what you can do), meeting at the
// project. A stop is proven once its bench task is logged; a learned one fades as it is forgotten.
// Unwritten lessons fold into one dashed stop, and a track that needs them says it is blocked.
import { api } from '../api.js';
import { el, flash } from '../core/dom.js';
import { MARK, mark, hm, stopState } from '../road.js';
import { lessonHref } from './courses.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const LANE = ['--s1', '--s3', '--s2', '--s5', '--s4', '--s6'];
const ROW = 76, GAP = 24, TOP = 22;
const timeLeft = t => t.left == null ? `Blocked: ${t.unwritten} lesson${t.unwritten === 1 ? '' : 's'} not written yet`
  : t.left ? `About ${hm(t.left)} to go` : 'Every stop learned';
const figures = t => [`${t.learned} of ${t.total} learned`, t.proven ? `${t.proven} proven` : null,
  t.fading ? `${t.fading} fading` : null].filter(Boolean).join(' · ');

const mapPanel = { title: 'Skill map', w: 12, deps: ['card', 'lesson', 'setting'], async render(body, ctx) {
  const { tracks } = await api.tracks();
  ctx.setTitle('');
  const goal = async id => { try { await api.setGoal(id); flash(id ? 'Your goal: Continue on Today follows it' : 'Goal cleared'); ctx.refresh(); } catch (e) { flash(e.message); } };
  const t = tracks.find(x => x.id === ctx.params.t);
  if (!tracks.length) { body.append(el('p', { class: 'note' }, 'No tracks yet.')); return; }
  if (t) return oneTrack(body, t, goal);
  body.append(el('p', { class: 'muted' }, 'Each track is a line of skills that ends in a project you could do on the bench or on site. ',
    'Make one your goal and Continue on Today follows it.'),
    el('div', { class: 'tracks' }, tracks.map(x => el('section', { class: 'trk' + (x.goal ? ' goal' : '') },
      el('div', { class: 'row mid' }, el('a', { class: 'trk-t', href: `#/map?t=${x.id}` }, x.title), x.goal ? el('span', { class: 'chip on' }, 'Your goal') : null),
      el('p', { class: 'small' }, el('span', { class: 'muted' }, 'Ends in: '), x.project),
      el('div', { class: 'trk-line', role: 'img', 'aria-label': figures(x) }, x.stops.map(s =>
        el('i', { class: `st-${stopState(s)}`, title: `${s.can} · ${MARK[stopState(s)][1]}` }))),
      el('p', { class: 'small' }, figures(x), el('br'), el('span', { class: x.left == null ? 'deb' : 'muted' }, timeLeft(x))),
      x.counts ? el('p', { class: 'small muted' }, 'Counts towards: ', x.counts) : null,
      el('div', { class: 'row' }, el('a', { class: 'btn sm', href: `#/map?t=${x.id}` }, 'Open'),
        x.next ? el('a', { class: 'btn plain sm', href: lessonHref(x.next.id) }, `Next: ${x.next.can}`) : null,
        el('button', { class: 'btn plain sm', type: 'button', onclick: () => goal(x.goal ? null : x.id) }, x.goal ? 'Clear goal' : 'Make this my goal'))))));
} };

/** One track: subjects are the lines, stops the skills in order, and the lines meet at the project. */
function oneTrack(body, t, goal) {
  // unwritten stops in a row fold into one: "+2 not written"
  const rows = [];
  for (const s of t.stops) {
    const last = rows.at(-1);
    if (!s.written && last?.fold) last.fold.push(s);
    else rows.push(s.written ? s : { ...s, fold: [s] });
  }
  const lanes = [...new Set(t.stops.map(s => s.subject_id))];
  const name = Object.fromEntries(t.stops.map(s => [s.subject_id, s.subject]));
  const x = s => 14 + lanes.indexOf(s.subject_id) * GAP, y = i => TOP + i * ROW;
  const W = 14 + lanes.length * GAP, H = y(rows.length) + 30;
  const colour = s => `var(${LANE[lanes.indexOf(s.subject_id) % LANE.length]})`;

  const g = svg('svg', { class: 'tmap', width: W, height: H, 'aria-hidden': 'true' });
  lanes.forEach(sid => {                                      // each subject's line, from its first stop to the project
    const on = rows.map((r, i) => [r, i]).filter(([r]) => r.subject_id === sid);
    const first = on[0][1], lx = 14 + lanes.indexOf(sid) * GAP;
    g.append(svg('path', { d: `M${lx} ${y(first)} V${y(rows.length) - 16} Q${lx} ${y(rows.length)} ${W / 2} ${y(rows.length)}`,
      class: 'tlane-line', style: `stroke:var(${LANE[lanes.indexOf(sid) % LANE.length]})` }));
  });
  rows.forEach((r, i) => {                                    // the way through: each stop to the next
    if (i) {
      const p = rows[i - 1];
      g.append(svg('path', { d: `M${x(p)} ${y(i - 1)} C${x(p)} ${y(i - 1) + ROW / 2} ${x(r)} ${y(i) - ROW / 2} ${x(r)} ${y(i)}`, class: 'tway' }));
    }
  });
  rows.forEach((r, i) => {
    const st = r.fold ? 'unwritten' : stopState(r);
    g.append(svg('circle', { cx: x(r), cy: y(i), r: st === 'proven' ? 9 : 7, class: `tstop st-${st}`, style: `--c:${colour(r)}` }));
  });
  g.append(svg('rect', { x: W / 2 - 9, y: y(rows.length) - 9, width: 18, height: 18, rx: 4, class: 'tproject' }));

  const list = el('ol', { class: 'tstops', style: `--row:${ROW}px; padding-top:${TOP - ROW / 2}px` }, rows.map(r => {
    if (r.fold) return el('li', { class: 'st-unwritten' },
      el('strong', {}, r.fold.length === 1 ? r.fold[0].can : `+${r.fold.length} not written yet`),
      el('span', { class: 'muted small' }, r.fold.map(s => s.title).join(' · ')),
      el('span', { class: 'small muted' }, `${r.subject} · not written yet: comes in a later import`));
    const st = stopState(r);
    const act = r.state === 'proven' ? null
      : r.learned ? (r.fading ? el('a', { class: 'btn plain sm', href: `#/practice?lessons=${encodeURIComponent(r.id)}` }, 'Practise')
        : el('a', { class: 'btn plain sm', href: lessonHref(r.id, '&prove=1') }, 'Prove it'))
      : el('a', { class: 'btn sm', href: lessonHref(r.id) }, r.state === 'going' ? 'Continue' : 'Start');
    return el('li', { class: `st-${st}` },
      el('div', { class: 'row mid' }, el('strong', {}, r.can), el('span', { class: 'spacer' }), act),
      el('span', { class: 'muted small' }, r.title),
      el('span', { class: 'small' }, mark(st), ` ${MARK[st][1]}`,
        r.memory != null && r.learned ? el('span', { class: 'muted' }, ` · remembered ${Math.round(100 * r.memory)}%`) : null,
        !r.learned ? el('span', { class: 'muted' }, ` · ${hm(r.left || r.minutes)}`) : null,
        r.proven ? el('span', { class: 'muted' }, ` · proven ${r.proven}`) : null));
  }), el('li', { class: 'tproj' }, el('strong', {}, t.project), el('span', { class: 'small muted' }, 'The project at the end of the line')));

  body.append(
    el('div', { class: 'row mid' }, el('a', { class: 'btn plain sm', href: '#/map' }, '← All tracks'), el('h2', { class: 'trk-h' }, t.title),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn sm' + (t.goal ? ' plain' : ''), type: 'button', onclick: () => goal(t.goal ? null : t.id) }, t.goal ? 'Clear goal' : 'Make this my goal')),
    el('p', { class: 'small' }, figures(t), ' · ', el('span', { class: t.left == null ? 'deb' : 'muted' }, timeLeft(t)),
      t.counts ? el('span', { class: 'muted' }, ` · counts towards ${t.counts}`) : null),
    el('div', { class: 'tkey small' }, lanes.map(sid => el('span', {}, el('i', { style: `background:var(${LANE[lanes.indexOf(sid) % LANE.length]})` }), name[sid]))),
    el('div', { class: 'tmapbox' }, g, list));
}

export const page = { title: 'Skill map', layout: [{ use: 'learn.map' }], panels: { 'learn.map': mapPanel } };
