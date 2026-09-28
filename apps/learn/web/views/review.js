// Review: only what is due, one card at a time, until there is none. Practice:
// endless questions with new numbers each time, on the lessons you pick (§7.1).
import { api } from '../api.js';
import { el, flash, table } from '../core/dom.js';
import { frame, brief } from '../cards.js';

const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const when = due => {
  const d = new Date(due.replace(' ', 'T'));
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 864e5);
  return days <= 0 ? `at ${due.slice(11)}` : days === 1 ? 'tomorrow' : `in ${days} days`;
};

/** One card after another from next(); the card on show takes the keys first. A confident
 *  mistake comes round again a few cards later, and a refresher from a shaky lesson goes first. */
export function runner(body, ctx, { mode, next, empty, counter }) {
  const stage = el('div', { class: 'player' });
  const count = el('span', { class: 'num small muted' });
  let card = null, done = 0, right = 0, since = 0;
  const later = [];                       // [cards to wait, item]
  const soon = [];
  const repaired = new Set();
  const step = async () => {
    since++;
    const ready = later.findIndex(([n]) => since >= n);
    const item = soon.shift() || (ready >= 0 ? later.splice(ready, 1)[0][1] : await next());
    if (!item) { card = null; stage.replaceChildren(await empty({ done, right })); count.textContent = ''; return; }
    const go = el('button', { class: 'btn plain nextcard', type: 'button', hidden: true, onclick: step }, 'Next →');
    card = frame(item, { mode, onDone: out => {
      if (out.correct != null) { done++; if (out.correct) right++; }
      if (out.retest) later.push([since + 3, { ...item, why: 'again' }]);
      const fresh = (out.repair || []).filter(r => !repaired.has(r.lesson_id));
      if (fresh.length) { repaired.add(fresh[0].lesson_id); soon.push(...fresh); flash(`Next, ${fresh.length} card${fresh.length === 1 ? '' : 's'} from ${fresh[0].lesson}, which this builds on`); }
      count.textContent = counter({ done, right });
      if (item.card.type === 'concept') step(); else { go.hidden = false; go.focus({ preventScroll: true }); }
    } });
    card.classList.add('current');
    stage.replaceChildren(card, go);
    card.querySelector('input:not([type=checkbox]):not([type=range])')?.focus({ preventScroll: true });
  };
  addEventListener('keydown', e => {
    if (!stage.isConnected || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.target.closest?.('input, textarea, select')) return;
    if (card && !card.finished() && card.keys?.(e)) { e.preventDefault(); return; }
    if (card?.finished() && ['Enter', ' ', 'ArrowRight', 'ArrowDown'].includes(e.key)) { e.preventDefault(); step(); }
  }, { signal: ctx.signal });
  ctx.aside.append(count);
  body.append(stage);
  return step();
}

const reviewPanel = { title: 'Review', w: 12, async render(body, ctx) {
  const comeback = ctx.params.mode === 'comeback';
  let queue = comeback ? await api.comeback() : await api.due();
  ctx.setTitle(comeback ? `Weekly comeback · ${queue.length} from this week` : queue.length ? `Review · ${queue.length} due` : 'Review');
  if (comeback) body.append(el('p', { class: 'note' }, 'Everything you missed in the last seven days, once more, while the week is fresh.'));
  await runner(body, ctx, {
    mode: comeback ? 'comeback' : 'review',
    counter: ({ done, right }) => `${done} done · ${right} right`,
    next: async () => { if (!queue.length && !comeback) queue = await api.due(); return queue.shift(); },   // a missed one's flash card is due at once
    empty: async ({ done, right }) => {
      const soon = await api.view('v_card', { asks: 1, due__gt: stamp(new Date()), order: 'due', limit: 1 });
      return el('div', { class: 'lcard' },
        el('h3', {}, done ? `All done: ${done} ${comeback ? 'gone over' : 'reviewed'}, ${right} right.` : comeback ? 'No misses this week.' : 'Nothing is due.'),
        el('p', { class: 'muted' }, soon.length ? `The next card is due ${when(soon[0].due)}.` : 'Cards come due once you have answered them in the feed or a lesson.'),
        el('div', { class: 'row' }, el('a', { class: 'btn', href: '#/feed' }, 'The feed'), el('a', { class: 'btn plain', href: '#/today' }, 'Today')));
    },
  });
} };

// ---- Coming back: everything you are struggling with, until it is solid ---------------------
const strugglePanel = { title: 'Coming back', w: 12, deps: ['card_state'], async render(body, ctx) {
  const rows = await api.view('v_struggle', { order: 'due' });
  ctx.setTitle(rows.length ? `Coming back · ${rows.length}` : 'Coming back');
  body.append(table([
    { k: 'text', label: 'Card', render: r => el('a', { href: `#/lesson?id=${encodeURIComponent(r.lesson_id)}&card=${encodeURIComponent(r.id)}` },
      brief(r.text) || r.id) },
    { k: 'lesson', label: 'Lesson' },
    { k: 'right_days', label: 'Days right', n: true, fmt: v => `${v} of 3` },
    { k: 'due', label: 'Next', fmt: v => v ? when(v) : '' }],
    rows, { empty: 'Nothing: a card you miss after learning it, or miss while sure, comes here until you get it right on three separate days.' }),
    rows.length ? el('p', { class: 'note' }, 'These come round in the feed and Review a fixed share of the time. A card leaves when it is right on three separate days.') : null);
} };

const savedPanel = { title: 'Saved for later', w: 12, deps: ['card_state'], async render(body, ctx) {
  const rows = await api.view('v_card', { saved: 1, order: 'lesson' });
  body.append(table([
    { k: 'text', label: 'Card', render: r => el('a', { href: `#/lesson?id=${encodeURIComponent(r.lesson_id)}&card=${encodeURIComponent(r.id)}` },
      brief(r.text) || r.id) },
    { k: 'lesson', label: 'Lesson' }, { k: 'subject', label: 'Subject' },
    { k: '_x', label: '', sort: false, render: r => el('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
      try { await api.saveCard(r.id); ctx.changed('card_state'); ctx.refresh(); } catch (e) { flash(e.message); }
    } }, 'Unsave') },
  ], rows, { empty: 'Nothing saved. In the feed, swipe a card right (or press →) to keep it here.' }));
} };

// ---- practice ------------------------------------------------------------------------------

const practicePanel = { title: 'Practice', w: 12, async render(body, ctx) {
  const numeric = await api.view('v_card', { type: 'numeric', order: 'lesson_id' });
  const lessons = [...new Map(numeric.map(c => [c.lesson_id, c])).values()];
  const chosen = (ctx.params.lessons || '').split(',').filter(id => lessons.some(l => l.lesson_id === id));
  if (!lessons.length) { body.append(el('p', { class: 'note' }, 'Practice uses the numeric questions in the lessons. None are written yet.')); return; }
  const boxes = lessons.map(l => el('input', { type: 'checkbox', checked: chosen.includes(l.lesson_id), value: l.lesson_id }));
  const subjects = [...new Set(lessons.map(l => l.subject))];
  const picker = el('details', { class: 'lpick', open: !chosen.length },
    el('summary', {}, chosen.length ? `Practising ${chosen.length === 1 ? lessons.find(l => l.lesson_id === chosen[0]).lesson : chosen.length + ' lessons'}` : 'Pick the lessons to practise'),
    subjects.map(s => el('fieldset', {}, el('legend', {}, s), lessons.map((l, i) => l.subject === s
      ? el('label', { class: 'c' }, boxes[i], l.lesson) : null))),
    el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', onclick: () => {
      const ids = boxes.filter(b => b.checked).map(b => b.value);
      if (!ids.length) { flash('Tick at least one lesson'); return; }
      ctx.go('practice', { lessons: ids.join(',') });
    } }, 'Start'), el('span', { class: 'note' }, 'Each question comes with new numbers every time. Right answers here do not push reviews further out.')));
  body.append(picker);
  if (!chosen.length) return;
  let queue = [];
  await runner(body, ctx, {
    mode: 'practice',
    counter: ({ done, right }) => `${done} done · ${right} right`,
    next: async () => { if (queue.length < 2) queue.push(...await api.practice(chosen, 10)); return queue.shift(); },
    empty: async () => el('p', { class: 'note' }, 'No questions found for those lessons.'),
  });
} };

export const page = { title: 'Review', layout: [{ use: 'learn.review' }, { use: 'learn.struggle' }, { use: 'learn.saved' }],
  panels: { 'learn.review': reviewPanel, 'learn.struggle': strugglePanel, 'learn.saved': savedPanel } };
export const practicePage = { title: 'Practice', layout: [{ use: 'learn.practice' }], panels: { 'learn.practice': practicePanel } };
