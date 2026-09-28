// Learn's front page: the day's ring and counts, where to go next, the study
// timer, and the feed's settings (goal, subjects and their weights).
import { api } from '../api.js';
import { el, flash } from '../core/dom.js';
import { today as todayISO } from '../core/format.js';
import { loadMeta, setting } from '../core/state.js';
import { ring } from '../ui/ring.js';
import { stageChip } from './levels.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const minutes = m => m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`;

async function saveSetting(key, value, ctx) {
  try { await api.save('setting', { key, value }); await loadMeta(); ctx.changed('setting'); }
  catch (e) { flash(e.message); }
}

const todayPanel = { title: 'Today', w: 12, deps: ['setting', 'card', 'study'], async render(body, ctx) {
  const [t, going] = await Promise.all([api.plan(), api.view('v_lesson', { finished: '', opened__gte: '0', order: 'opened', desc: 1, limit: 1 })]);
  const unit = t.goal_kind === 'cards' ? 'card' : 'minute';
  const left = Math.max(0, Math.round(t.goal - t.done));
  const l = going[0];
  body.classList.add('flush');
  ctx.setTitle('');
  body.append(el('div', { class: 'lhero' },
    ring(Math.round(t.done), Math.round(t.goal), 132),
    el('div', { class: 'lhero-main' },
      el('h2', {}, left ? `${plural(left, unit)} to today's goal` : `Today's goal is done: ${plural(Math.round(t.done), unit)}`),
      el('p', { class: 'muted' }, [t.due ? `${t.due} due for review` : 'Nothing due for review',
        t.struggles ? `${t.struggles} coming back` : null, t.streak ? `a ${t.streak}-day streak` : null, `${minutes(t.minutes)} today`].filter(Boolean).join(' · ')),
      el('div', { class: 'row mid' },
        el('a', { class: 'btn big', href: '#/feed' }, 'Start the feed'),
        t.due ? el('a', { class: 'btn plain big', href: '#/review' }, `Review ${t.due} due`) : null,
        t.comeback_today && t.comeback ? el('a', { class: 'btn plain big', href: '#/review?mode=comeback', title: 'This week’s misses, once more' },
          `Weekly comeback: ${t.comeback}`) : null,
        el('a', { class: 'btn plain big', href: '#/courses' }, 'Courses'))),
    l ? el('a', { class: 'lcontinue-card', href: `#/lesson?id=${encodeURIComponent(l.id)}` },
      el('span', { class: 'eyebrow' }, 'Continue'), el('strong', {}, l.title),
      el('span', { class: 'muted small' }, `${l.subject} · card ${Math.min((l.pos || 0) + 1, l.cards)} of ${l.cards}`),
      el('span', { class: 'mbar' }, el('i', { style: `width:${Math.round(100 * Math.min(1, (l.pos || 0) / (l.cards || 1)))}%` }))) : null));
} };

// ---- the subjects: your level in each, how much is solid, and the next lesson ---------------
const subjectsPanel = { title: 'Your subjects', w: 8, deps: ['card', 'setting', 'skill'], async render(body, ctx) {
  const [rows, t] = await Promise.all([api.view('v_subject', { order: 'sort' }), api.plan()]);
  let on = [];
  try { on = JSON.parse(setting('subjects_on', '') || '[]'); } catch { /* every subject */ }
  const lv = Object.fromEntries(t.levels.map(k => [k.scope, k]));
  const nxt = Object.fromEntries(t.next.map(n => [n.subject_id, n]));
  ctx.aside.append(el('a', { class: 'link small', href: '#/calibrate' }, 'Find my level'),
    el('a', { class: 'link small', href: '#/today', onclick: e => { e.preventDefault();
      document.getElementById('p-learn.settings')?.scrollIntoView({ behavior: 'smooth' }); } }, 'Feed settings'));
  body.append(el('div', { class: 'scards' }, rows.filter(s => s.id !== 'mine' || s.cards).map(s => {
    const pct = s.asks ? Math.round(100 * s.mastered / s.asks) : 0;
    const k = lv[s.id], n = nxt[s.id];
    return el('div', { class: 'scard' + (on.length && !on.includes(s.id) ? ' off' : '') },
      el('a', { class: 'stitle', href: `#/courses?s=${encodeURIComponent(s.id)}` }, el('strong', {}, s.title)),
      s.id === 'mine' ? null : k?.n || k?.placed ? stageChip(k)
        : el('a', { class: 'small', href: `#/calibrate?s=${encodeURIComponent(s.id)}` }, 'Find my level (about 10 min)'),
      el('span', { class: 'mbar' }, el('i', { style: `width:${pct}%` })),
      el('span', { class: 'small muted' }, s.cards ? `${pct}% solid · ${s.learned} of ${s.written} lessons learned` : 'none written yet',
        s.due ? el('b', { class: 'due' }, ` · ${s.due} due`) : null),
      n ? el('a', { class: 'small snext', href: `#/lesson?id=${encodeURIComponent(n.id)}` }, `Next: ${n.title}`) : null);
  })));
} };

// ---- the study timer: focus minutes, by subject (§7.9) ----------------------------------
// ponytail: the running timer lives in this tab; closing the tab mid-session loses that session.
const timer = { start: null, subject: '' };

const timerPanel = { title: 'Study timer', w: 4, deps: ['study'], async render(body, ctx) {
  const [subjects, done] = await Promise.all([api.view('v_subject', { order: 'sort' }), api.table('study', { day: todayISO() })]);
  const pick = el('select', { 'aria-label': 'Subject', onchange: e => { timer.subject = e.target.value; } },
    el('option', { value: '' }, 'No subject'), subjects.map(s => el('option', { value: s.id, selected: s.id === timer.subject }, s.title)));
  const clock = el('div', { class: 'lclock num' });
  const note = el('input', { placeholder: 'What you worked on (optional)', 'aria-label': 'Note' });
  const btn = el('button', { class: 'btn', type: 'button' });
  const show = () => {
    const s = timer.start ? Math.floor((Date.now() - timer.start) / 1000) : 0;
    clock.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    btn.textContent = timer.start ? 'Stop and log it' : 'Start';
    pick.disabled = !!timer.start;
  };
  btn.addEventListener('click', async () => {
    if (!timer.start) { timer.start = Date.now(); show(); return; }
    const mins = Math.round((Date.now() - timer.start) / 6000) / 10;
    timer.start = null;
    show();
    if (mins < 1) { flash('Under a minute: not logged'); return; }
    try {
      await api.save('study', { day: todayISO(), subject_id: timer.subject || null, minutes: mins, note: note.value.trim() || null });
      flash(`Logged ${minutes(mins)}`);
      ctx.changed('study'); ctx.refresh();
    } catch (e) { flash(e.message); }
  });
  const tick = setInterval(() => { if (!clock.isConnected) clearInterval(tick); else if (timer.start) show(); }, 1000);
  ctx.signal?.addEventListener('abort', () => clearInterval(tick));
  show();
  const title = id => subjects.find(s => s.id === id)?.title || 'No subject';
  body.append(clock, el('div', { class: 'row mid' }, pick, btn), note,
    done.length ? el('ul', { class: 'plain small' }, done.map(d => el('li', {}, `${minutes(d.minutes)} · ${title(d.subject_id)}${d.note ? ' · ' + d.note : ''}`)))
      : el('p', { class: 'note' }, 'Time from the timer counts towards the goal when it is set in minutes, and shows in Stats.'));
} };

// ---- what the feed brings, and how much of it ------------------------------------------------
const settingsPanel = { title: 'Feed settings', w: 12, deps: ['setting'], async render(body, ctx) {
  const subjects = await api.view('v_subject', { order: 'sort' });
  const on = (() => { try { return JSON.parse(setting('subjects_on', '') || '[]'); } catch { return []; } })();
  const weights = (() => { try { return JSON.parse(setting('weights', '{}') || '{}'); } catch { return {}; } })();
  const isOn = id => !on.length || on.includes(id);
  const kind = setting('goal_kind', 'cards');
  const goal = el('input', { class: 'sm', value: setting('goal', '20'), inputmode: 'numeric', size: 4, 'aria-label': 'Daily goal' });
  goal.addEventListener('change', () => { const n = parseInt(goal.value, 10); if (n > 0) saveSetting('goal', String(n), ctx); else flash('The goal is a whole number above 0'); });
  const kindSel = el('select', { class: 'sm', 'aria-label': 'Goal in', onchange: e => saveSetting('goal_kind', e.target.value, ctx) },
    el('option', { value: 'cards', selected: kind === 'cards' }, 'cards'), el('option', { value: 'minutes', selected: kind === 'minutes' }, 'minutes'));
  const remind = el('input', { type: 'checkbox', checked: setting('review_reminder', '0') === '1',
    onchange: e => saveSetting('review_reminder', e.target.checked ? '1' : '0', ctx) });

  const rows = subjects.map(s => {
    const box = el('input', { type: 'checkbox', checked: isOn(s.id), 'aria-label': `${s.title} in the feed` });
    const w = el('input', { class: 'sm', value: weights[s.id] ?? 1, inputmode: 'decimal', size: 3, 'aria-label': `${s.title} weight` });
    box.addEventListener('change', () => {
      const ticked = rows.filter(r => r.box.checked).map(r => r.id);
      if (!ticked.length) { box.checked = true; flash('Keep at least one subject on'); return; }
      saveSetting('subjects_on', ticked.length === rows.length ? '' : JSON.stringify(ticked), ctx);
    });
    w.addEventListener('change', () => {
      const n = parseFloat(w.value);
      if (!(n >= 0)) { flash('A weight is a number: 2 brings twice as many cards as 1'); return; }
      const next = { ...weights, [s.id]: n };
      if (n === 1) delete next[s.id];
      saveSetting('weights', JSON.stringify(next), ctx);
    });
    return { id: s.id, box, tr: el('tr', {}, el('td', {}, el('label', { class: 'c' }, box, s.title)),
      el('td', { class: 'n num muted' }, s.cards ? plural(s.cards, 'card') : 'none written yet'), el('td', { class: 'n' }, w)) };
  });
  body.append(
    el('div', { class: 'row mid' }, el('span', {}, 'Daily goal'), goal, kindSel,
      el('label', { class: 'c' }, remind, 'A daily “review in Learn” in the calendar feed')),
    el('table', { class: 'g lsubjects' }, el('thead', {}, el('tr', {}, el('th', {}, 'In the feed'), el('th', { class: 'n' }, 'Written'), el('th', { class: 'n' }, 'Weight'))),
      el('tbody', {}, rows.map(r => r.tr))),
    el('p', { class: 'note' }, 'The feed takes turns between the subjects that are on, in proportion to their weights: due reviews first, ',
      'then the next new cards in course order, then practice with new numbers.'));
} };

export const page = { title: 'Today', quick: false,
  layout: [{ use: 'learn.today' }, { use: 'learn.subjects', w: 8 }, { use: 'learn.timer', w: 4 }, { use: 'learn.settings', w: 12 }],
  panels: { 'learn.today': todayPanel, 'learn.subjects': subjectsPanel, 'learn.timer': timerPanel, 'learn.settings': settingsPanel } };
