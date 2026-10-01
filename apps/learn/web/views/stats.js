// Progress, shown plainly (§7.9): cards and time per day as a heatmap, accuracy by
// subject, mastery per topic, the cards that trip you up, and the study timer's minutes.
import { api } from '../api.js';
import { el, table, tiles, tile } from '../core/dom.js';
import { today, addDays, mondayOf, dayLong, monthName } from '../core/format.js';
import { minutes } from './today.js';
import { bar } from './courses.js';
import { brief } from '../cards.js';
import { panels as levelPanels } from './levels.js';

const WEEKS = 26;
const level = n => !n ? 0 : n < 10 ? 1 : n < 20 ? 2 : n < 35 ? 3 : n < 60 ? 4 : 5;

const heatPanel = { title: 'Every day', w: 12, deps: ['study'], async render(body) {
  const first = addDays(mondayOf(today()), -7 * (WEEKS - 1));
  const [days, t] = await Promise.all([api.view('v_learn_day', { day__gte: first }), api.today()]);
  const by = Object.fromEntries(days.map(d => [d.day, d]));
  const grid = el('div', { class: 'heat', style: `--weeks:${WEEKS}`, role: 'img', 'aria-label': `Cards per day for the last ${WEEKS} weeks` });
  const months = el('div', { class: 'heatm', style: `--weeks:${WEEKS}` });
  for (let w = 0; w < WEEKS; w++) {
    const monday = addDays(first, 7 * w);
    months.append(el('span', {}, monday.slice(8) <= '07' || (w === 0 && monday.slice(8) <= '17') ? monthName(monday.slice(0, 7)).split(' ')[0] : ''));
    for (let d = 0; d < 7; d++) {
      const day = addDays(monday, d), x = by[day];
      grid.append(day > today() ? el('i', { class: 'fut' })
        : el('i', { class: 'l' + level(x?.cards), title: `${dayLong(day)}: ${x ? `${x.cards} cards, ${minutes(x.minutes || 0)}` : 'nothing'}` }));
    }
  }
  const week = days.filter(d => d.day >= mondayOf(today()));
  const sum = (xs, k) => xs.reduce((a, x) => a + (x[k] || 0), 0);
  body.append(tiles(tile('This week', `${sum(week, 'cards')} cards`, minutes(sum(week, 'minutes'))),
      tile(`${WEEKS} weeks`, `${sum(days, 'cards')} cards`, minutes(sum(days, 'minutes'))),
      tile('Days studied', String(days.filter(d => d.cards || d.minutes).length), `of the last ${WEEKS * 7}`),
      tile('Streak', `${t.streak} day${t.streak === 1 ? '' : 's'}`)),
    el('div', { class: 'heatbox' }, months, grid),
    el('p', { class: 'note' }, 'Darker is more cards that day. Hover a day for its cards and minutes.'));
} };

const accuracyPanel = { title: 'Accuracy by subject', w: 6, async render(body) {
  const rows = await api.view('v_accuracy', { order: 'subject' });
  body.append(table([{ k: 'subject', label: 'Subject', fmt: v => v || 'Removed' }, { k: 'asked', label: 'Asked', n: true },
    { k: 'correct', label: 'Right', n: true }, { k: 'pct', label: 'Right %', n: true, fmt: v => v == null ? '' : `${v}%` }],
    rows, { empty: 'Nothing answered yet.' }),
    el('p', { class: 'note' }, 'Every answer counts, including practice and reviews. Flash cards count as right unless rated Again.'));
} };

const masteryPanel = { title: 'Solid, by topic', w: 6, deps: ['card'], async render(body) {
  const lessons = await api.view('v_lesson');
  const units = new Map();
  for (const l of lessons) {
    if (!l.asks) continue;
    const u = units.get(l.unit_id) || { unit: l.unit, subject: l.subject, s: l.subject_sort, us: l.unit_sort, asks: 0, mastered: 0, seen: 0 };
    u.asks += l.asks; u.mastered += l.mastered || 0; u.seen += l.seen || 0;
    units.set(l.unit_id, u);
  }
  const rows = [...units.values()].sort((a, b) => a.s - b.s || a.us - b.us);
  if (!rows.length) { body.append(el('p', { class: 'note' }, 'Nothing written to master yet.')); return; }
  let last = null;
  body.append(el('div', { class: 'mastery' }, rows.map(u => [
    u.subject !== last && (last = u.subject) ? el('h3', {}, u.subject) : null,
    el('div', { class: 'mrow' }, el('span', {}, u.unit), bar(u.mastered / u.asks, `${u.mastered} of ${u.asks}`),
      el('span', { class: 'num small muted' }, `${Math.round(100 * u.mastered / u.asks)}%`))])),
    el('p', { class: 'note' }, 'Solid: a card you are expected to remember for three weeks or more, or have got right on three separate days since you last missed it.'));
} };

const hardestPanel = { title: 'Hardest cards', w: 8, async render(body) {
  const rows = (await api.view('v_hardest')).sort((a, b) => b.wrong - a.wrong || b.lapses - a.lapses).slice(0, 25);
  body.append(table([
    { k: 'text', label: 'Card', render: r => el('a', { href: `#/lesson?id=${encodeURIComponent(r.lesson_id)}&card=${encodeURIComponent(r.id)}` },
      brief(r.text, 120) || r.id) },
    { k: 'lesson', label: 'Lesson' }, { k: 'wrong', label: 'Wrong', n: true }, { k: 'asked', label: 'Asked', n: true },
    { k: 'lapses', label: 'Forgotten', n: true }],
    rows, { empty: 'None yet: the cards you get wrong or forget show here.' }));
} };

const timePanel = { title: 'Study timer', w: 4, deps: ['study'], async render(body) {
  const since = addDays(today(), -29);
  const [rows, subjects] = await Promise.all([api.table('study', { day__gte: since }), api.view('v_subject')]);
  const by = {};
  for (const r of rows) by[r.subject_id || ''] = (by[r.subject_id || ''] || 0) + r.minutes;
  const title = id => subjects.find(s => s.id === id)?.title || 'No subject';
  body.append(table([{ k: 's', label: 'Subject' }, { k: 'm', label: 'Last 30 days', n: true, fmt: minutes }],
    Object.entries(by).map(([s, m]) => ({ s: title(s), m })).sort((a, b) => b.m - a.m),
    { empty: 'No timed sessions yet. The timer is on Today.' }));
} };

// ---- achievements: earned first; the rest say how, so they double as suggestions ----
const badgesPanel = { title: 'Achievements', w: 12, deps: ['card', 'lesson'], async render(body) {
  const { badges, rank, xp } = await api.game();
  const got = badges.filter(b => b.at).length;
  body.append(el('p', { class: 'muted small' }, `${got} of ${badges.length} earned · ${xp} XP, rank ${rank}`),
    el('ul', { class: 'badges' }, [...badges].sort((a, b) => !!b.at - !!a.at || (a.at < b.at ? -1 : 1)).map(b =>
      el('li', { class: b.at ? 'got' : 'todo' }, el('span', { 'aria-hidden': 'true' }, b.at ? '★' : '☆'),
        el('strong', {}, b.title), el('span', { class: 'muted small' }, b.at ? `${b.how} · ${b.at.slice(0, 10)}` : b.how)))));
} };

export const page = { title: 'Stats',
  layout: [{ use: 'learn.levels' }, { use: 'learn.badges' }, { use: 'learn.heat' }, { use: 'learn.accuracy', w: 6 }, { use: 'learn.mastery', w: 6 },
           { use: 'learn.hardest', w: 8 }, { use: 'learn.time', w: 4 }, { use: 'learn.confidence', w: 6 }, { use: 'learn.rework', w: 6 }],
  panels: { 'learn.badges': badgesPanel, 'learn.heat': heatPanel, 'learn.accuracy': accuracyPanel, 'learn.mastery': masteryPanel, 'learn.hardest': hardestPanel,
            'learn.time': timePanel, ...levelPanels } };
