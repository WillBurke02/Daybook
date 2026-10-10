// The skill tree's small parts, shared by Today, the tree and the lesson: the marks for a
// lesson's state, the route to a goal, and the one line said when a lesson is learned.
import { el, flash } from './core/dom.js';

// glyph + word, so a state is never colour alone
export const MARK = { mastered: ['★', 'Solid'], learned: ['✓', 'Learned'], going: ['◐', 'In progress'], ready: ['○', 'Ready'],
                      needs: ['◌', 'Needs more first'], unwritten: ['·', 'Not written yet'] };
export const mark = state => el('span', { class: `gmark st-${state}`, title: MARK[state][1], 'aria-hidden': 'true' }, MARK[state][0]);
export const meter = (f, label) => el('span', { class: 'mbar', role: 'img', title: label, 'aria-label': label },
  el('i', { style: `width:${Math.round(100 * Math.min(1, Math.max(0, f)))}%` }));

/** The goal and the way to it. `pick(step)` may return a click handler (a step on this page); otherwise a link. */
export function roadmapBar(rm, { pick, clear } = {}) {
  const a = (s, text) => { const h = pick?.(s); return h ? el('button', { class: 'link', type: 'button', onclick: h }, text)
    : el('a', { class: 'link', href: `#/lesson?id=${encodeURIComponent(s.id)}` }, text); };
  return el('div', { class: 'road' },
    el('div', { class: 'row mid' }, el('strong', {}, 'Goal: ', a(rm.goal, rm.goal.title)),
      el('span', { class: 'muted small' }, `${rm.done} of ${rm.total} steps`), meter(rm.done / rm.total, `${rm.done} of ${rm.total} steps done`),
      rm.next ? el('a', { class: 'btn sm', href: `#/lesson?id=${encodeURIComponent(rm.next.id)}` }, `Next: ${rm.next.title}`) : null,
      clear ? el('button', { class: 'btn plain sm', type: 'button', onclick: clear }, 'Clear goal') : null),
    rm.steps.length ? el('ol', { class: 'road-steps' }, rm.steps.map(s => el('li', { class: `st-${s.state}` }, mark(s.state),
      s.state === 'unwritten' ? el('span', { class: 'muted' }, `${s.title} (not written yet)`) : a(s, s.title)))) : null);
}

/** A lesson just learned, wherever its check was passed (the feed and Review count): say so and what it opened. */
export function learnedNote(w) {
  if (!w) return;
  flash([`Lesson learned: ${w.title}`, w.goal_reached ? 'goal reached' : null,
         w.unlocked?.length ? `opens ${w.unlocked.map(u => u.title).join(', ')}` : null].filter(Boolean).join(' · '));
}
