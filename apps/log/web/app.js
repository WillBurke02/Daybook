// Log, as the shell sees it: a diary of the day and the work day.
import { el } from './core/dom.js';
import { today, addDays, dayLong } from './core/format.js';
import * as day from './views/day.js';
import * as browse from './views/browse.js';
import * as printing from './views/print.js';

const onDay = () => location.hash.startsWith('#/day') || !location.hash.replace('#/', '');
const dayShown = () => new URLSearchParams(location.hash.split('?')[1] || '').get('d') || today();
const toDay = d => { location.hash = `#/day?d=${d}`; };

export default {
  name: 'log', title: 'Log', home: 'day', period: false,
  about: 'a diary of the day and the work day.',
  pages: { day: day.page, timeline: browse.timeline, calendar: browse.month, tags: browse.tags, print: printing.page },
  groups: [[null, ['day', 'timeline', 'calendar', 'tags', 'print']]],
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
  search: {
    entry: ['Entries', r => ({ when: r.date, thumb: r.thumb, what: (r.text || (r.kind === 'day' ? 'Diary' : 'Photo or voice note')).split('\n')[0],
      more: [r.kind === 'day' ? 'diary' : r.at, (r.text || '').split('\n').slice(1).join(' ').slice(0, 120)].filter(Boolean).join(' · '),
      href: `#/day?d=${r.date}&e=${r.id}` })],
  },
  // the quick add, above every page
  bar: ctx => day.quickBar(ctx),
};
