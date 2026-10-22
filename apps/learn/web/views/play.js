// Play: a machine with a fault to find, a machine to make work, or a puzzle, one after another.
// Just for fun: nothing is recorded, and nothing changes when a card comes round for review.
import { api } from '../api.js';
import { el, seg } from '../core/dom.js';
import { runner } from './review.js';

const GAMES = {
  fault: ['Find the fault', 'A machine that may have something wrong with it. Run it, watch it, say what.'],
  goal: ['Make it work', 'A machine to set up so it does a job.'],
  puzzle: ['Puzzle', 'Spot the mistake, put it in order, match the pairs, fill in the code.'],
};
const KEY = 'learn.play';   // the scores, in this browser only: a nicety, not a record
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const keep = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* fine without */ } };

const playPanel = { title: 'Play', w: 12, async render(body, ctx) {
  const kind = GAMES[ctx.params.kind] ? ctx.params.kind : 'fault';
  const scores = load(), s = scores[kind] ??= { played: 0, right: 0, run: 0, best: 0 };
  const said = el('p', { class: 'small muted' });
  const tell = () => { said.textContent = s.played ? `${s.run} in a row · best ${s.best} · ${s.right} of ${s.played} right` : GAMES[kind][1]; };
  body.append(el('p', { class: 'muted small' }, 'For fun: nothing here is marked or changes your reviews.'),
    seg(Object.entries(GAMES).map(([v, [label]]) => ({ v, label })), kind, v => { location.hash = `#/play?kind=${v}`; }), said);
  tell();
  let queue = [], seen = [], before = 0;
  await runner(body, ctx, {
    mode: 'play',
    counter: ({ right }) => {
      const won = right > before;
      before = right;
      s.played++;
      if (won) { s.right++; s.run++; s.best = Math.max(s.best, s.run); } else s.run = 0;
      keep(scores);
      tell();
      return '';
    },
    next: async () => {
      if (!queue.length) queue = await api.play(kind, 5, seen);
      if (!queue.length && seen.length) { seen = []; queue = await api.play(kind, 5); }   // all played: round again
      const item = queue.shift();
      if (item) seen.push(item.id);
      return item;
    },
    empty: async () => el('div', { class: 'lcard' }, el('p', {}, 'Nothing to play here yet.')),
  });
} };

export const page = { title: 'Play', layout: [{ use: 'learn.play' }], panels: { 'learn.play': playPanel } };
