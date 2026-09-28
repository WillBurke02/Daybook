// Courses: subject → unit → lesson, with your level and what is solid; and the lesson
// player. A lesson runs in stages (LEARN-SPEC §2): warm-up, try, learn, example,
// practise, mix, check. It opens with what you will be able to do and anything worth
// reading or watching first, and ends with its summary, your notes and where to go next.
// Prerequisites show but never lock.
import { api } from '../api.js';
import { appApi } from '../core/api.js';
import { el, flash, seg, readVal, writeVal } from '../core/dom.js';
import { state } from '../core/state.js';
import { frame, rich, listenButton } from '../cards.js';
import { formulaHelp, loadFormulas, mathsOf } from '../formulas.js';
import { stageChip, levelText } from './levels.js';

const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
export const lessonHref = (id, extra = '') => `#/lesson?id=${encodeURIComponent(id)}${extra}`;
export const bar = (f, label) => el('span', { class: 'mbar', title: label, role: 'img', 'aria-label': label },
  el('i', { style: `width:${Math.round(100 * Math.min(1, f))}%` }));

// Where each lesson stands, in words and a mark (never colour alone).
const STATUS = {
  learned: ['Learned', 'passed its check'], finished: ['Finished', 'reached the end: the check is still to pass'],
  going: ['In progress', ''], new: ['Not started', ''], unwritten: ['Not written yet', 'in the outline, not written'],
};
export const statusOf = l => !l.cards ? 'unwritten' : l.learned ? 'learned' : l.finished ? 'finished' : (l.opened || l.seen) ? 'going' : 'new';
const SHOW = [['all', 'All'], ['written', 'Written'], ['todo', 'To do'], ['going', 'In progress'], ['learned', 'Learned']];
const shows = (show, st) => show === 'all' || (show === 'written' && st !== 'unwritten') || (show === 'learned' && st === 'learned')
  || (show === 'going' && (st === 'going' || st === 'finished')) || (show === 'todo' && (st === 'new' || st === 'going' || st === 'finished'));
const counts = ls => {
  const n = st => ls.filter(l => statusOf(l) === st).length;
  return [`${ls.filter(l => l.cards).length} of ${ls.length} written`, n('learned') && `${n('learned')} learned`,
    (n('going') + n('finished')) && `${n('going') + n('finished')} in progress`].filter(Boolean).join(' · ');
};

function lessonCard(l, titles) {
  const st = statusOf(l), [label, tip] = STATUS[st];
  const pre = JSON.parse(l.prereq || '[]').filter(p => titles[p]);
  const detail = st === 'unwritten' ? null : st === 'new' ? `${l.cards} cards${l.minutes ? ` · about ${l.minutes} min` : ''}`
    : st === 'going' ? `${l.seen || 0} of ${l.cards} seen` : null;
  return el('li', { class: `lcardrow st-${st}` + (l.placed === 'start' ? ' here' : '') },
    el('div', { class: 'ltop' },
      el('span', { class: 'lmark', 'aria-hidden': 'true' }),
      st === 'unwritten' ? el('span', { class: 'ltitle' }, l.title) : el('a', { class: 'ltitle', href: lessonHref(l.id) }, l.title),
      l.level != null ? el('span', { class: 'lvl num', title: levelText(l.level) }, l.level.toFixed(1)) : null),
    el('div', { class: 'lmeta' },
      el('span', { class: 'lstatus', title: tip || null }, label), detail ? el('span', { class: 'muted' }, detail) : null,
      l.placed === 'start' ? el('span', { class: 'chip on' }, 'Start here') : null,
      l.placed === 'known' && st !== 'learned' ? el('a', { class: 'chip', href: lessonHref(l.id, '&testout=1'), title: 'Your level says you probably know this: four questions settle it' }, 'Probably known · Test out') : null,
      l.due ? el('span', { class: 'chip on', title: 'Cards due for review' }, `${l.due} due`) : null,
      l.struggles ? el('span', { class: 'chip warn', title: 'Cards you are struggling with' }, `${l.struggles} coming back`) : null),
    l.cards && l.asks && (l.seen || l.learned) ? el('div', { class: 'lsolid' }, bar(l.mastered / l.asks, `${pct(l.mastered, l.asks)}% solid`),
      el('span', { class: 'muted small num' }, `${pct(l.mastered, l.asks)}% solid`)) : null,
    pre.length && st !== 'learned' ? el('div', { class: 'lafter small muted' }, 'After ', pre.map((p, i) => [i ? ', ' : '', el('a', { href: lessonHref(p) }, titles[p])])) : null);
}

const coursesPanel = { title: 'Courses', w: 12, deps: ['card', 'lesson', 'skill'], async render(body, ctx) {
  const [subjects, lessons, lv] = await Promise.all([api.view('v_subject', { order: 'sort' }), api.view('v_lesson'), api.levels()]);
  const titles = Object.fromEntries(lessons.map(l => [l.id, l.title]));
  const skill = Object.fromEntries(lv.skills.map(s => [s.scope, s]));
  lessons.sort((a, b) => a.unit_sort - b.unit_sort || a.sort - b.sort);
  const going = lessons.filter(l => l.opened && !l.finished).sort((a, b) => (b.opened > a.opened) - (b.opened < a.opened))[0];
  if (going) body.append(el('p', { class: 'lcontinue' }, el('a', { class: 'btn', href: lessonHref(going.id) }, `Continue where you left off: ${going.title}`),
    el('span', { class: 'muted small' }, ` ${going.subject} · card ${Math.min((going.pos || 0) + 1, going.cards)} of ${going.cards}`)));
  const show = readVal('learn:show', 'all');
  body.append(el('div', { class: 'row mid lfilter' }, el('span', { class: 'muted small' }, 'Show'),
    seg(SHOW.map(([v, label]) => ({ v, label })), show, v => { writeVal('learn:show', v); ctx.refresh(); }),
    el('span', { class: 'lkey small muted' }, ['learned', 'going', 'new', 'unwritten'].map(k =>
      el('span', { class: `st-${k}` }, el('span', { class: 'lmark', 'aria-hidden': 'true' }), STATUS[k][0])))));
  const open = ctx.params.s;
  for (const s of subjects) {
    const mine = lessons.filter(l => l.subject_id === s.id);
    if (s.id === 'mine' && !s.cards) continue;
    const units = [...new Set(mine.map(l => l.unit_id))];
    const k = skill[s.id];
    const shown = units.map(u => {
      const ls = mine.filter(l => l.unit_id === u), vis = ls.filter(l => shows(show, statusOf(l)));
      if (!vis.length) return null;
      const ku = skill[u];
      return el('div', { class: 'lunit' }, el('h3', {}, ls[0].unit, ku ? stageChip(ku, true) : null,
          el('span', { class: 'ucount' }, counts(ls)),
          ls.some(l => l.learned) ? el('a', { class: 'btn plain sm', href: `#/checkpoint?unit=${encodeURIComponent(u)}`, title: 'Ten mixed questions: your level in this unit' }, 'Checkpoint') : null),
        el('ul', { class: 'llessons' }, vis.map(l => lessonCard(l, titles))));
    }).filter(Boolean);
    body.append(el('details', { class: 'lsubject', open: open ? open === s.id : s.written > 0, id: `s-${s.id}` },   // nothing written yet: starts closed
      el('summary', {}, el('strong', {}, s.title),
        k?.placed || k?.n ? stageChip(k) : null,
        el('span', { class: 'muted small' }, ` ${counts(mine)}`),
        s.asks ? el('span', { class: 'small' }, ' ', bar(s.mastered / s.asks, `${pct(s.mastered, s.asks)}% solid`), ` ${pct(s.mastered, s.asks)}% solid`) : null,
        s.due ? el('span', { class: 'chip on' }, `${s.due} due`) : null,
        s.id !== 'mine' && (s.asks || s.bank) ? el('a', { class: 'btn plain sm cal', href: `#/calibrate?s=${encodeURIComponent(s.id)}` }, k?.placed ? 'Recalibrate' : 'Find my level') : null,
        s.id !== 'mine' ? el('a', { class: 'btn plain sm', href: `#/notes?s=${encodeURIComponent(s.id)}` }, 'Notes') : null,
        s.id !== 'mine' ? el('a', { class: 'btn plain sm', href: '/learn/api/' + api.packUrl(s.id), title: 'This course as a pack (.zip), to share or keep' }, 'Download') : null),
      shown.length ? shown : el('p', { class: 'muted small' }, 'None here.')));
  }
  if (!subjects.some(s => s.id !== 'mine')) body.append(el('p', { class: 'note' }, 'No courses found. They are the files in apps/learn/content.'));
  if (open) requestAnimationFrame(() => document.getElementById(`s-${open}`)?.scrollIntoView({ block: 'start' }));
} };

// ---- the lesson player --------------------------------------------------------------------

export const STAGES = [['warmup', 'Warm-up'], ['try', 'Try'], ['learn', 'Learn'], ['example', 'Example'],
                       ['practise', 'Practise'], ['mix', 'Mix'], ['check', 'Check']];
const KIND = { video: 'Watch', read: 'Read', interactive: 'Try', reference: 'Reference', listen: 'Listen' };

/** Reading and watching, as a list of links out. */
export function resources(list, heading) {
  if (!list?.length) return null;
  return el('div', { class: 'lres' }, heading ? el('h4', {}, heading) : null, el('ul', {}, list.map(r => el('li', {},
    el('span', { class: 'rk' }, KIND[r.kind] || 'Read'),
    el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.title),
    el('span', { class: 'muted small' }, [r.by, r.minutes ? `${r.minutes} min` : null].filter(Boolean).join(' · ')),
    r.note ? el('div', { class: 'small muted' }, r.note) : null))));
}

/** Your notes on a lesson: saved as you type. */
export function notesBox(lessonId, text) {
  const t = el('textarea', { class: 'lnotes', rows: 4, placeholder: 'Your notes on this lesson: what clicked, what to remember, questions to look up.' });
  t.value = text || '';
  let timer;
  t.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => api.notes(lessonId, t.value).catch(e => flash(e.message)), 600); });
  t.addEventListener('blur', () => { clearTimeout(timer); api.notes(lessonId, t.value).catch(() => {}); });
  return t;
}

const lessonPanel = { title: 'Lesson', w: 12, async render(body, ctx) {
  const id = ctx.params.id;
  if (!id) { ctx.go('courses'); return; }
  const got = await api.lesson(id);
  const { lesson, prereq, you } = got;
  ctx.pageTitle(lesson.title, `${lesson.subject} · ${lesson.unit}`);
  ctx.setTitle('');
  ctx.aside.append(el('a', { class: 'btn plain sm', href: `#/courses?s=${encodeURIComponent(lesson.subject_id)}` }, lesson.subject),
    el('a', { class: 'btn plain sm', href: `#/notes?s=${encodeURIComponent(lesson.subject_id)}&l=${encodeURIComponent(id)}` }, 'Notes'),
    got.cards.some(c => c.type === 'numeric') ? el('a', { class: 'btn plain sm', href: `#/practice?lessons=${encodeURIComponent(id)}` }, 'Practise') : null);
  if (!got.cards.length) {
    body.append(el('p', { class: 'note' }, 'This lesson is in the outline but not written yet. Its cards come in a later update; ',
      'until then, ', el('a', { href: `#/mine?lesson=${encodeURIComponent(id)}` }, 'write your own for it'), '.'),
      resources(lesson.resources, 'Reading and watching'));
    return;
  }
  if (ctx.params.testout) { await testOut(body, ctx, lesson); return; }

  // Above the lesson's level, the problem comes first and the worked examples wait to be asked for.
  const ahead = you && lesson.level != null && you.level >= lesson.level + 0.3;
  const examples = [], cards = [];
  for (const c of got.cards) {
    c.stage ||= 'learn';
    if (ahead && c.stage === 'example' && c.type === 'steps') examples.push(c); else cards.push(c);
  }
  const warm = got.warmup.map(c => ({ ...c, stage: 'warmup' }));
  const seq = [...warm, ...cards];
  const at = ctx.params.card ? seq.findIndex(c => c.id === ctx.params.card) : -1;
  let pos = at >= 0 ? at : -1;
  let right = 0, answered = 0, card = null;
  const repaired = new Set();
  const count = el('span', { class: 'num small muted' });
  const track = el('div', { class: 'ltrack' });
  const stages = el('ol', { class: 'lstages' });
  const stage = el('div', { class: 'player' });
  const prev = el('button', { class: 'btn plain sm', type: 'button', onclick: () => show(pos - 1) }, '← Back');
  const next = el('button', { class: 'btn plain sm', type: 'button', onclick: () => show(pos + 1) }, 'Next →');

  const paintStages = () => {
    const here = seq[pos]?.stage;
    stages.replaceChildren(...STAGES.filter(([k]) => seq.some(c => c.stage === k)).map(([k, label]) => {
      const mine = seq.filter(c => c.stage === k);
      const done = mine.every(c => c.done || c.state?.last_seen);
      return el('li', { class: (k === here ? 'on' : '') + (done ? ' done' : '') }, label, el('span', { class: 'num' }, mine.length));
    }));
  };
  const paint = () => {
    track.replaceChildren(...seq.map((c, i) => el('button', {
      class: 'tick' + (i === pos ? ' on' : '') + (c.done || c.state?.last_seen ? ' seen' : '') + (c.why === 'again' || c.why === 'refresher' ? ' extra' : ''),
      type: 'button', 'aria-label': `Card ${i + 1}`, title: `Card ${i + 1}${c.stage ? ' · ' + c.stage : ''}`, onclick: () => show(i) })));
    paintStages();
  };

  const intro = () => {
    pos = -1;
    card = null;
    const resume = lesson.pos && !lesson.finished && lesson.pos < seq.length ? lesson.pos : 0;
    const ready = you ? (you.level >= lesson.level + 0.5 ? 'You are above this lesson’s level in this unit: test out if you like.'
      : you.level >= lesson.level - 0.5 ? 'This is at your level.' : 'This is a stretch from where you are: the worked examples will help.') : null;
    stage.replaceChildren(el('div', { class: 'lcard lintro' },
      el('div', { class: 'row mid' }, lesson.level != null ? stageChip({ level: lesson.level }) : null,
        lesson.minutes ? el('span', { class: 'chip' }, `about ${lesson.minutes} min`) : null,
        lesson.kind ? el('span', { class: 'chip' }, { procedure: 'How to', concept: 'Ideas', facts: 'Facts' }[lesson.kind]) : null),
      lesson.goals?.length ? [el('h3', {}, 'By the end you can'), el('ul', {}, lesson.goals.map(g => el('li', {}, rich(g))))] : null,
      prereq.length ? el('p', { class: 'small muted' }, 'Builds on: ', prereq.map((p, i) => [i ? ', ' : '',
        el('a', { href: lessonHref(p.id) }, p.title), p.asks ? ` (${pct(p.mastered, p.asks)}% solid)` : ''])) : null,
      resources((lesson.resources || []).filter(r => r.when === 'before'), 'Before you start (optional)'),
      ready ? el('p', { class: 'muted' }, ready) : null,
      fbtn(),
      warm.length ? el('p', { class: 'small muted' }, `It starts with ${warm.length} warm-up card${warm.length === 1 ? '' : 's'} from what it builds on.`) : null,
      el('div', { class: 'row' },
        el('button', { class: 'btn big', type: 'button', onclick: () => show(resume) }, resume ? `Continue at card ${resume + 1}` : 'Start'),
        resume ? el('button', { class: 'btn plain', type: 'button', onclick: () => show(0) }, 'From the start') : null,
        you && you.level >= lesson.level - 0.3 ? el('a', { class: 'btn plain', href: lessonHref(id, '&testout=1') }, 'Test out') : null)));
    count.textContent = `${seq.length} cards`;
    prev.disabled = true; next.disabled = false;
    paint();
  };

  // the lesson's formulas, letter by letter: shown once the list has loaded, if it has any
  const fbtn = () => {
    const b = el('button', { class: 'btn plain sm', type: 'button', hidden: true,
      onclick: () => formulaHelp(mathsOf({ summary: lesson.summary || '' }), id) }, 'Formulas in this lesson');
    loadFormulas().then(db => { const n = db.formulas.filter(f => f.lesson === id).length; if (n) { b.hidden = false; b.textContent = `The ${n} formula${n === 1 ? '' : 's'} in this lesson, explained`; } });
    return el('div', { class: 'row' }, b);
  };

  const finish = async () => {
    card = null;
    pos = seq.length;
    let learned = null;
    try { learned = (await api.place(id, seq.length, true)).learned; } catch (e) { flash(e.message); }
    const nextLesson = (await api.view('v_lesson', { unit_id: lesson.unit_id, order: 'sort' })).find(l => l.sort > lesson.sort);
    const hasCheck = seq.some(c => c.stage === 'check');
    stage.replaceChildren(el('div', { class: 'lcard lend' },
      el('h3', {}, !hasCheck ? 'Lesson done.' : learned ? 'Lesson learned.' : 'Lesson done: some of it comes back soon.'),
      el('p', {}, answered ? `${answered} answered, ${right} right. ` : '',
        hasCheck && learned ? 'Its check questions come back in about a day, a week and three weeks; right each time and it is solid.'
          : hasCheck ? 'The check questions you missed come back first, and the lesson counts as learned once you get them all right.'
          : 'The cards you answered come back in Review when they are due.'),
      lesson.summary ? [el('div', { class: 'row mid' }, el('h4', {}, 'Summary'), listenButton(lesson.summary)),
        el('div', { class: 'lsummary' }, rich(lesson.summary))] : null,
      fbtn(),
      lesson.bench?.length ? [el('h4', {}, 'Try it on the bench or on site'), lesson.bench.map(b => benchTask(b, id))] : null,
      resources((lesson.resources || []).filter(r => r.when !== 'before'), 'To go further'),
      el('h4', {}, 'Your notes'), notesBox(id, got.notes),
      el('div', { class: 'row' },
        nextLesson ? el('a', { class: 'btn', href: lessonHref(nextLesson.id) }, `Next: ${nextLesson.title}`) : null,
        cards.some(c => c.type === 'numeric') ? el('a', { class: 'btn plain', href: `#/practice?lessons=${encodeURIComponent(id)}` }, 'Practise with new numbers') : null,
        el('button', { class: 'btn plain', type: 'button', onclick: () => show(0) }, 'From the start'),
        el('a', { class: 'btn plain', href: '#/courses' }, 'Courses'))));
    count.textContent = `${seq.length} of ${seq.length}`;
    next.disabled = true; prev.disabled = false;
    paint();
  };

  function show(i) {
    if (i < 0) { intro(); return; }
    if (i >= seq.length) { finish(); return; }
    pos = i;
    const item = seq[pos];
    card = frame(item, { mode: 'lesson', onDone: out => {
      item.done = true;
      if (out.correct != null) { answered++; if (out.correct) right++; }
      // a confident mistake: once more, three cards on; a shaky lesson underneath: a refresher first
      if (out.retest) seq.splice(Math.min(pos + 4, seq.length), 0, { ...item, why: 'again', done: false, state: null });
      const fresh = (out.repair || []).filter(r => !repaired.has(r.lesson_id));
      if (fresh.length) {
        repaired.add(fresh[0].lesson_id);
        seq.splice(pos + 1, 0, ...fresh.map(r => ({ ...r, stage: item.stage })));
        flash(`First, ${fresh.length} card${fresh.length === 1 ? '' : 's'} from ${fresh[0].lesson}, which this builds on`);
      }
      api.place(id, pos + 1, false).catch(e => flash(e.message));
      paint();
      if (item.card.type === 'concept') show(pos + 1);
      else next.focus({ preventScroll: true });
    } });
    card.classList.add('current');
    // the worked example, when it was held back
    const extra = ahead && examples.length && item.stage === 'example'
      ? el('button', { class: 'link small', type: 'button', onclick: e => {
          e.currentTarget.remove();
          seq.splice(pos, 0, ...examples.splice(0).map(c => ({ ...c })));
          show(pos);
        } }, 'Show me a worked example first') : null;
    stage.replaceChildren(card, extra || '');
    count.textContent = `${pos + 1} of ${seq.length}`;
    prev.disabled = false; next.disabled = false;
    paint();
    card.querySelector('input:not([type=checkbox]):not([type=range])')?.focus({ preventScroll: true });
    api.place(id, pos, false).catch(() => {});
  }
  addEventListener('keydown', e => {
    if (!stage.isConnected || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.target.closest?.('input, textarea, select')) return;
    if (card && !card.finished() && card.keys?.(e)) { e.preventDefault(); return; }
    if (e.key === 'ArrowRight' || ((e.key === 'Enter' || e.key === ' ') && (card?.finished() || pos < 0))) { e.preventDefault(); if (!next.disabled) show(pos + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (pos >= 0) show(pos - 1); }
  }, { signal: ctx.signal });
  body.append(stages, track, stage, el('div', { class: 'row mid lnav' }, prev, count, el('span', { class: 'spacer' }), next));
  if (pos >= 0) show(pos); else intro();
} };

/** Doing it for real: a job to try on the bench or on site, a checklist, and a line for today's Log. */
function benchTask(b, lessonId) {
  const ticks = (b.check || []).map(x => el('label', {}, el('input', { type: 'checkbox' }), rich(x)));
  const found = el('input', { class: 'sm', placeholder: 'What you found (optional)', style: 'flex:1;min-width:200px' });
  const hasLog = (state.meta?.apps || []).some(a => a.name === 'log');
  const log = hasLog ? el('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
    const done = ticks.filter(t => t.querySelector('input').checked).map(t => `- ${t.textContent.trim()}`);
    const text = [`Bench: ${String(b.task).replace(/\*\*|`/g, '')}`, ...done, found.value.trim(),
                  `#bench #${lessonId.split('.').pop()}`].filter(Boolean).join('\n');
    try { await appApi('log').send('quick', { text }); flash('Added to today in Log'); log.disabled = true; } catch (e) { flash(e.message); }
  } }, 'Add to today’s Log') : null;
  return el('div', { class: 'bench' }, rich(b.task), ticks.length ? el('div', { class: 'points' }, ticks) : null,
    el('div', { class: 'row mid' }, found, log));
}

/** Test out: the lesson's hardest questions. All right and it is learned; its cards start as reviews. */
async function testOut(body, ctx, lesson) {
  const items = await api.testout(lesson.id);
  let i = 0, right = 0, asked = 0;
  const stage = el('div', { class: 'player' });
  const note = el('p', { class: 'muted' }, `Test out: ${items.length} of this lesson’s harder questions. Get them all right and it counts as learned; `,
    'miss one and the lesson is there to work through.');
  const step = async () => {
    if (i >= items.length) {
      const r = await api.testoutDone(lesson.id, right, asked);
      stage.replaceChildren(el('div', { class: 'lcard' },
        el('h3', {}, r.passed ? 'Tested out: learned.' : `${right} of ${asked} right: worth doing the lesson.`),
        el('p', {}, r.passed ? 'Its cards come back as reviews in a week or so, so it stays solid.' : 'The lesson will fill the gaps, and it is quicker than it looks.'),
        el('div', { class: 'row' }, el('a', { class: r.passed ? 'btn plain' : 'btn', href: lessonHref(lesson.id) }, 'The lesson'),
          el('a', { class: r.passed ? 'btn' : 'btn plain', href: `#/courses?s=${encodeURIComponent(lesson.subject_id)}` }, 'Courses'))));
      return;
    }
    const item = items[i++];
    const go = el('button', { class: 'btn plain nextcard', type: 'button', hidden: true, onclick: step }, 'Next →');
    const card = frame(item, { mode: 'testout', onDone: out => { if (out.correct != null) { asked++; if (out.correct) right++; } go.hidden = false; go.focus(); } });
    card.classList.add('current');
    stage.replaceChildren(card, go);
  };
  body.append(note, stage);
  if (!items.length) { stage.append(el('p', { class: 'note' }, 'This lesson has no questions to test out with.')); return; }
  step();
}

export const page = { title: 'Courses', layout: [{ use: 'learn.courses' }], panels: { 'learn.courses': coursesPanel } };
export const lessonPage = { title: 'Lesson', quick: false, layout: [{ use: 'learn.lesson' }], panels: { 'learn.lesson': lessonPanel } };
