// Learn's front page: Continue and three short starts, the week, skills, memory and your track; the study
// timer, and the feed's settings (goal, subjects and their weights).
import { api } from '../api.js';
import { el, flash, seg } from '../core/dom.js';
import { today as todayISO } from '../core/format.js';
import { loadMeta, setting } from '../core/state.js';
import { stageChip, known } from './levels.js';
import { hm } from '../road.js';
import { lessonHref } from './courses.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const minutes = m => m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`;

async function saveSetting(key, value, ctx) {
  try { await api.save('setting', { key, value }); await loadMeta(); ctx.changed('setting'); }
  catch (e) { flash(e.message); }
}

// ---- Learn home: one Continue, three short starts with their length, and progress you could show ----
// No score: the week in sessions, skills learned and proven, what is fading, and your track.
const GROUPS = [['Maths', ['maths']], ['Physics and electronics', ['physics', 'electronics']],
                ['Electrical, drives and controls', ['electrical', 'drives', 'plc', 'instrumentation', 'networks', 'practice']],
                ['Mechanical and fluids', ['mechanical', 'fluids', 'materials']]];
const WHERE = [['New to it', 2], ['Some', 3.5], ['Confident', 5], ['Expert', 6.5]];

const todayPanel = { title: 'Today', w: 12, deps: ['setting', 'card', 'study', 'lesson'], async render(body, ctx) {
  const t = await api.plan();
  body.classList.add('flush');
  ctx.setTitle('');
  let broken = [];
  try { broken = JSON.parse(setting('content_errors', '') || '[]'); } catch { /* none */ }
  if (broken.length) body.append(el('details', { class: 'note warn' },
    el('summary', {}, `${broken.length} lesson file${broken.length === 1 ? '' : 's'} could not be read and ${broken.length === 1 ? 'is' : 'are'} left out; the rest of Learn works.`),
    el('ul', { class: 'small' }, broken.map(b => el('li', {}, b)))));

  // first run: where you are, so the first card is not cutting cable from a reel
  if (t.fresh && !t.levels.some(k => k.n || k.placed || k.prior != null)) {
    const said = {};
    body.append(el('section', { class: 'lhome-first' },
      el('h2', {}, 'Where are you now?'),
      el('p', { class: 'muted' }, 'A rough answer is enough: the feed starts near it, and your answers soon take over. ',
        el('a', { href: '#/calibrate' }, 'Find my level'), ' measures it properly (about 10 minutes a subject).'),
      el('table', { class: 'g' }, el('tbody', {}, GROUPS.map(([label, subs]) => el('tr', {}, el('td', {}, label),
        el('td', {}, seg(WHERE.map(([w, v]) => ({ v: String(v), label: w })), '', v => { subs.forEach(s => { said[s] = +v; }); })))))),
      el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', onclick: async () => {
        try { await api.rough(said); flash('Saved'); ctx.refresh(); } catch (e) { flash(e.message); }
      } }, 'Start from there'))));
  }

  const c = t.continue;
  const reviewMin = Math.max(1, Math.round(Math.min(t.due, 30) * 0.4));
  const fading = t.fading || [];
  const starts = [
    t.due ? ['Review', t.due > 30 ? 'a round, the most at risk first' : `${t.due} card${t.due === 1 ? '' : 's'}`, `${reviewMin} min`, '#/review'] : ['Feed', 'what is new and due', '5 min', '#/feed'],
    fading.length ? ['Keep it fresh', `${fading.length} fading skill${fading.length === 1 ? '' : 's'}: ${fading[0].can}`, '5 min',
                     `#/practice?lessons=${encodeURIComponent(fading.map(f => f.id).join(','))}`]
      : t.due ? ['Feed', 'what is new and due', '5 min', '#/feed'] : ['Find my level', 'a subject you have not placed', '10 min', '#/calibrate'],
    t.goal?.next && t.goal.next.id !== c?.id ? ['Next stop', t.goal.next.can, hm(t.goal.next.left || t.goal.next.minutes), lessonHref(t.goal.next.id)]
      : ['Skill map', t.goal ? t.goal.title : 'pick a track to follow', '', '#/map'],
  ];
  const r = t.rhythm;
  body.append(el('div', { class: 'lhome' },
    c ? el('a', { class: 'lcontinue', href: lessonHref(c.id) },
      el('span', { class: 'eyebrow' }, c.started ? 'Continue' : 'Start'), el('strong', {}, c.title),
      el('span', {}, `${c.parts > 1 ? `Part ${c.part} of ${c.parts} · ` : ''}${c.minutes} min · ${c.subject}`))
      : el('a', { class: 'lcontinue', href: '#/feed' }, el('span', { class: 'eyebrow' }, 'Start'), el('strong', {}, 'The feed'), el('span', {}, '5 min')),
    el('div', { class: 'lstarts' }, starts.map(([what, sub, len, href]) => el('a', { class: 'lstart', href },
      el('strong', {}, what), el('span', { class: 'muted small' }, sub), len ? el('span', { class: 'chip' }, len) : null))),
    el('div', { class: 'lprogress' },
      el('div', {}, el('small', {}, 'This week'),
        el('div', { class: 'rdots', role: 'img', 'aria-label': `${r.sessions} of ${r.target} sessions of 5 minutes or more this week` },
          r.days.map(d => el('i', { class: d.session ? 'on' : d.future ? 'later' : '', title: `${d.day}: ${minutes(d.minutes)}` }))),
        el('span', { class: 'small' }, `${r.sessions} of ${r.target} sessions · ${minutes(r.minutes)}`)),
      el('div', {}, el('small', {}, 'Skills'), el('b', { class: 'num' }, String(t.skills.learned)),
        el('span', { class: 'small muted' }, `learned · ${t.skills.proven} proven`)),
      el('div', {}, el('small', {}, 'Memory'), el('b', { class: 'num' }, String(fading.length)),
        el('span', { class: 'small muted' }, fading.length ? 'fading: practise to keep them' : 'fading: all fresh')),
      el('a', { class: 'go', href: t.goal ? `#/map?t=${t.goal.id}` : '#/map' }, el('small', {}, 'Your track'),
        el('b', {}, t.goal ? t.goal.title : 'None yet'),
        el('span', { class: 'small muted' }, t.goal ? `${t.goal.learned} of ${t.goal.total} learned · ${t.goal.left == null
          ? `blocked: ${t.goal.unwritten} not written` : `${hm(t.goal.left)} to go`}` : 'Pick one on the skill map')),
      el('a', { class: 'go', href: '#/record' }, el('small', {}, 'Record'), el('b', {}, 'CPD'),
        el('span', { class: 'small muted' }, 'hours and skills by date')))));
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
      s.id === 'mine' ? null : known(k) ? stageChip(k)
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
      : el('p', { class: 'note' }, 'Counts towards a goal set in minutes.'));
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
  const remindAt = el('input', { type: 'time', class: 'sm', value: setting('review_time', '19:00'), 'aria-label': 'Review time',
    onchange: e => e.target.value && saveSetting('review_time', e.target.value, ctx) });

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
      if (!(n >= 0)) { flash('Weight must be a number'); return; }
      const next = { ...weights, [s.id]: n };
      if (n === 1) delete next[s.id];
      saveSetting('weights', JSON.stringify(next), ctx);
    });
    return { id: s.id, box, tr: el('tr', {}, el('td', {}, el('label', { class: 'c' }, box, s.title)),
      el('td', { class: 'n num muted' }, s.cards ? plural(s.cards, 'card') : 'none written yet'), el('td', { class: 'n' }, w)) };
  });
  body.append(
    el('div', { class: 'row mid' }, el('span', {}, 'Daily goal'), goal, kindSel,
      el('label', { class: 'c' }, remind, 'A daily “review in Learn” in the calendar feed, with an alert at '), remindAt),
    el('div', { class: 'tscroll' }, el('table', { class: 'g lsubjects' }, el('thead', {}, el('tr', {}, el('th', {}, 'In the feed'), el('th', { class: 'n' }, 'Written'), el('th', { class: 'n' }, 'Weight'))),
      el('tbody', {}, rows.map(r => r.tr)))),
    el('p', { class: 'note' }, 'A weight of 2 gives a subject twice as many cards as 1.'));
} };

export const page = { title: 'Today', quick: false,
  layout: [{ use: 'learn.today' }, { use: 'learn.subjects', w: 8 }, { use: 'learn.timer', w: 4 }, { use: 'learn.settings', w: 12 }],
  // learn.road was the old goal panel: a layout that still has it gets an empty panel, not an error
  panels: { 'learn.today': todayPanel, 'learn.road': { title: 'Your track', w: 12, render: () => {} }, 'learn.subjects': subjectsPanel,
            'learn.timer': timerPanel, 'learn.settings': settingsPanel } };
