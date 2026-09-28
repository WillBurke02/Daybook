// Learn, as the shell sees it.
import * as today from './views/today.js';
import * as feed from './views/feed.js';
import * as courses from './views/courses.js';
import * as review from './views/review.js';
import * as stats from './views/stats.js';
import * as mine from './views/mine.js';
import * as levels from './views/levels.js';
import * as notes from './views/notes.js';
import { brief } from './cards.js';
import { formulasPanel } from './formulas.js';
import { toggle } from './tools.js';

export default {
  name: 'learn', title: 'Learn', home: 'today', period: false,
  about: 'courses, and a feed of short cards to use instead of scrolling.',
  pages: { today: today.page, feed: feed.page, courses: courses.page, lesson: courses.lessonPage, review: review.page,
           practice: review.practicePage, stats: stats.page, mine: mine.page, calibrate: levels.calibratePage,
           checkpoint: levels.checkpointPage, notes: notes.page,
           formulas: { title: 'Formulas', quick: false, narrow: true, layout: [{ use: 'learn.formulas' }], panels: { 'learn.formulas': formulasPanel } } },
  groups: [[null, ['today', 'feed']], ['Study', ['courses', 'review', 'practice', 'notes', 'formulas']], ['Progress', ['calibrate', 'stats']]],
  setup: ['mine'],
  quick: [{ label: 'Start the feed', href: '#/feed' }],
  sqlHint: 'SELECT subject, COUNT(*) FROM v_card GROUP BY subject',
  keymap: { w: () => toggle('board'), c: () => toggle('calc') },
  keys: [['W', 'Whiteboard beside the card'], ['C', 'Calculator beside the card'], ['1–4', 'Answer, or rate a card'], ['Enter', 'Check'], ['↓ or Space', 'The next card in the feed'],
         ['← →', 'Too easy (a card answered before) / save for later, in the feed']],
  file: shell => [
    { label: 'Start the feed', fn: () => shell.go('feed') },
    { label: 'Review what is due', fn: () => shell.go('review') },
    { label: 'Find my level…', fn: () => shell.go('calibrate') },
    { label: 'Notes', fn: () => shell.go('notes') },
    { label: 'Formulas', fn: () => shell.go('formulas') },
    { label: 'Import flash cards (CSV)…', fn: () => shell.go('mine') },
  ],
  search: {
    card: ['Cards', r => ({ what: brief(r.text), more: `${r.subject} · ${r.lesson} · ${r.type}`,
      href: `#/lesson?id=${encodeURIComponent(r.lesson_id)}&card=${encodeURIComponent(r.id)}` })],
    lesson: ['Lessons', r => ({ what: r.title, more: `${r.subject} · ${r.unit}`, href: `#/lesson?id=${encodeURIComponent(r.id)}` })],
  },
};
