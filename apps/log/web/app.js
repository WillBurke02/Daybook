// Log, as the shell sees it: a diary of the day and the work day.
import { el } from './core/dom.js';
import { today, addDays, dayLong } from './core/format.js';
import search from './search.js';
import * as day from './views/day.js';
import * as browse from './views/browse.js';
import * as printing from './views/print.js';

const onDay = () => location.hash.startsWith('#/day') || !location.hash.replace('#/', '');
const dayShown = () => new URLSearchParams(location.hash.split('?')[1] || '').get('d') || today();
const toDay = d => { location.hash = `#/day?d=${d}`; };

// A swipe across a day steps to the one before or after, as [ and ] do; not in a box being typed in, a dialog
// (a photo's own swipe), or from the screen's edge, which is the phone's own back.
let x0 = null, y0 = 0;
addEventListener('touchstart', e => {
  const t = e.touches[0];
  x0 = e.touches.length === 1 && t.clientX > 24 && t.clientX < innerWidth - 24 && e.target.closest?.('main')
    && !e.target.closest('textarea, input, select, dialog, .tagassist') ? t.clientX : null;
  y0 = t.clientY;
}, { passive: true });
addEventListener('touchend', e => {
  if (x0 == null || !onDay()) return;
  const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
  if (Math.abs(dx) > 80 && Math.abs(dx) > 2 * Math.abs(dy) && !String(getSelection())) toDay(addDays(dayShown(), dx < 0 ? 1 : -1));
}, { passive: true });
// Leaving the app (another app on the phone, the window closed) saves the box being typed in, as leaving the box does.
document.addEventListener('visibilitychange', () => { if (document.hidden) document.activeElement?.blur?.(); });

export default {
  name: 'log', title: 'Log', home: 'day', period: false,
  about: 'a diary of the day and the work day.',
  pages: { day: day.page, timeline: browse.timeline, calendar: browse.month, photos: browse.photos, tags: browse.tags, print: printing.page },
  groups: [[null, ['day', 'timeline', 'calendar', 'photos', 'tags', 'print']]],
  setup: [],
  quick: [{ label: 'Today', href: '#/day' }],
  sqlHint: 'SELECT day, COUNT(*) FROM entry GROUP BY day ORDER BY day DESC',
  file: shell => [
    { label: 'Today', fn: () => toDay(today()) },
    { label: 'Print this day…', fn: () => shell.go('print', { from: dayShown(), to: dayShown() }) },
    { label: 'Print a range…', fn: () => shell.go('print') },
  ],
  keys: [['[ and ]', 'Previous and next day (on a day)'], ['T', 'Today']],
  keymap: {
    '[': () => onDay() && toDay(addDays(dayShown(), -1)),
    ']': () => onDay() && toDay(addDays(dayShown(), 1)),
    t: () => toDay(today()),
  },
  search,
  // the quick add, above every page
  bar: ctx => day.quickBar(ctx),
};
