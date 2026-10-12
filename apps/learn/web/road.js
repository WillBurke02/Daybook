// The skill map's small parts, shared by Today, the map and the lesson: the marks for a
// stop's state, minutes as hours, and the one line said when a lesson is learned.
import { el, flash } from './core/dom.js';

// glyph + word, so a state is never colour alone
export const MARK = { proven: ['★', 'Proven'], mastered: ['✓', 'Learned'], learned: ['✓', 'Learned'], fading: ['✓', 'Learned, fading'],
                      going: ['◐', 'In progress'], ready: ['○', 'Ready'], needs: ['◌', 'Needs more first'], unwritten: ['·', 'Not written yet'] };
export const mark = state => el('span', { class: `gmark st-${state}`, title: MARK[state]?.[1] || state, 'aria-hidden': 'true' }, MARK[state]?.[0] || '·');
export const meter = (f, label) => el('span', { class: 'mbar', role: 'img', title: label, 'aria-label': label },
  el('i', { style: `width:${Math.round(100 * Math.min(1, Math.max(0, f)))}%` }));
/** 200 → "3 h 20 min" */
export const hm = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${Math.round(m % 60)} min` : ''}` : `${Math.round(m)} min`;
/** A stop's state, with fading shown: learned but no longer well remembered. */
export const stopState = s => s.state === 'learned' && s.fading ? 'fading' : s.state;

/** A lesson just learned, wherever its check was passed (the feed and Review count): say so, what it opened, what is next. */
export function learnedNote(w) {
  if (!w) return;
  flash([`Lesson learned: ${w.title}`, w.unlocked?.length ? `opens ${w.unlocked.map(u => u.title).join(', ')}` : null,
         w.next && w.next.id !== w.lesson ? `next on ${w.track}: ${w.next.can}` : null].filter(Boolean).join(' · '));
}
