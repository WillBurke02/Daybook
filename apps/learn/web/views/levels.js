// Your level: Daybook's own stages 1–9 (from below GCSE), with the UK qualification level
// alongside (level.py has the model). Here: the chips, finding your level (calibration),
// unit checkpoints, and the Levels panel in Stats.
import { api } from '../api.js';
import { el, flash, table } from '../core/dom.js';
import { dayShort } from '../core/format.js';
import { frame } from '../cards.js';
import { chart } from '../ui/chart.js';

// the same as STAGES in apps/learn/level.py (tests/test_learn.py checks they agree)
export const STAGES = [
  [1, 'First steps', 'Entry 1–2'], [2, 'Basics', 'Entry 3'], [3, 'Foundation', 'Level 1 (GCSE grades 1–3)'],
  [4, 'Secure', 'Level 2 (GCSE grades 4–9)'], [5, 'Advanced', 'Level 3 (A level)'], [6, 'Higher', 'Level 4 (HNC)'],
  [7, 'Diploma', 'Level 5 (HND)'], [8, 'Graduate', 'Level 6 (degree)'], [9, 'Master', "Level 7 (master's)"]];
export const stageOf = level => STAGES[Math.min(Math.max(Math.floor(level + 1e-9), 1), 9) - 1];
export const levelText = level => { const [n, name, rqf] = stageOf(level); return `Stage ${level.toFixed(1)}: ${name} (${rqf})`; };

/** A level as a chip: "4.3 Secure", with the range and the qualification level on hover. */
export function stageChip(k, small) {
  const [n, name, rqf] = stageOf(k.level);
  const range = k.low != null ? ` · likely ${k.low.toFixed(1)}–${k.high.toFixed(1)}` : '';
  return el('span', { class: `stage s${n}${small ? ' sm' : ''}`, title: `Stage ${k.level.toFixed(1)} of 9 · ${name} · ${rqf}${range}` },
    el('b', { class: 'num' }, k.level.toFixed(1)), small ? null : ` ${name}`);
}

/** The ladder: every stage with its qualification level, yours marked. */
export function ladder(level) {
  return el('ol', { class: 'ladder' }, [...STAGES].reverse().map(([n, name, rqf]) =>
    el('li', { class: `s${n}` + (level != null && stageOf(level)[0] === n ? ' you' : '') },
      el('b', { class: 'num' }, n), el('span', {}, name), el('span', { class: 'muted small' }, rqf))));
}

// ---- finding your level: an adaptive test (calibration) -------------------------------------

const calibratePanel = { title: 'Find my level', w: 12, async render(body, ctx) {
  ctx.setTitle('');
  const subjects = (await api.view('v_subject', { order: 'sort' })).filter(s => s.id !== 'mine' && s.asks > 0);   // nothing to ask: not offered
  const sid = ctx.params.s;
  const subject = subjects.find(s => s.id === sid);
  if (!subject) {
    ctx.pageTitle('Find my level', 'About ten minutes a subject: questions that get harder or easier as you go');
    const lv = await api.levels();
    const k = Object.fromEntries(lv.skills.map(s => [s.scope, s]));
    body.append(el('div', { class: 'scards' }, subjects.map(s => el('a', { class: 'scard', href: `#/calibrate?s=${encodeURIComponent(s.id)}` },
      el('strong', {}, s.title), k[s.id]?.placed ? stageChip(k[s.id]) : el('span', { class: 'muted small' }, 'Not placed yet'),
      el('span', { class: 'small muted' }, k[s.id]?.placed ? `Last found ${dayShort(k[s.id].placed.slice(0, 10))}` : 'About 10 minutes')))));
    return;
  }
  ctx.pageTitle(`Find my level: ${subject.title}`, 'Up to 15 questions; they get harder or easier with your answers');
  // 1. roughly where you think you are: only a starting point
  const pickStart = el('div', { class: 'lcard' },
    el('h3', {}, 'Roughly where are you in this subject?'),
    el('p', { class: 'muted' }, 'A guess is fine, and so is "no idea". It only decides the first question: the test moves up or down quickly from there.'),
    el('div', { class: 'stagepick' }, STAGES.map(([n, name, rqf]) => el('button', { class: `opt s${n}`, type: 'button', onclick: () => begin(n) },
      el('b', { class: 'num' }, n), el('span', {}, name), el('span', { class: 'muted small' }, rqf))),
      el('button', { class: 'opt', type: 'button', onclick: () => begin(null) }, el('b', {}, '?'), el('span', {}, 'No idea'))));
  const stage = el('div', { class: 'player' });
  const progress = el('div', { class: 'calprog' });
  body.append(progress, stage);
  stage.append(pickStart);
  const asked = [];
  let right = 0;
  async function begin(said) {
    try { await api.calStart(sid, said); } catch (e) { flash(e.message); return; }
    step();
  }
  async function step() {
    let nx;
    try { nx = await api.calNext(sid, asked); } catch (e) { flash(e.message); return; }
    if (nx.done) { result(nx.result); return; }
    progress.replaceChildren(el('span', { class: 'small muted' }, `Question ${nx.asked + 1} of up to ${nx.of}`),
      el('span', { class: 'mbar' }, el('i', { style: `width:${Math.round(100 * nx.asked / nx.of)}%` })));
    asked.push(nx.item.id);
    const go = el('button', { class: 'btn plain nextcard', type: 'button', hidden: true, onclick: step }, 'Next →');
    const card = frame(nx.item, { mode: 'calibrate', onDone: out => { if (out.correct) right++; go.hidden = false; go.focus({ preventScroll: true }); } });
    card.classList.add('current');
    stage.replaceChildren(card, go);
    card.querySelector('input:not([type=checkbox]):not([type=range])')?.focus({ preventScroll: true });
  }
  function result(r) {
    progress.replaceChildren();
    const s = r.subject;
    const [n, name, rqf] = stageOf(s.level);
    stage.replaceChildren(el('div', { class: 'lcard lresult' },
      el('div', { class: 'eyebrow' }, `${subject.title}: ${asked.length} questions, ${right} right`),
      el('h3', {}, `Stage ${s.level.toFixed(1)}: ${name}`),
      el('p', {}, `About ${rqf}. You get roughly 8 in 10 right at this stage; the true figure is likely between ${s.low.toFixed(1)} and ${s.high.toFixed(1)}. `,
        'It sharpens with every question you answer from now on.'),
      el('div', { class: 'cols2' }, ladder(s.level),
        r.units.length ? table([{ k: 'title', label: 'Unit' }, { k: 'level', label: 'Stage', n: true, render: u => stageChip(u, true) },
          { k: 'n', label: 'Asked', n: true }], r.units) : el('p', { class: 'note' }, 'Too few questions per unit yet to say.')),
      r.known ? el('p', {}, `${r.known} lesson${r.known === 1 ? ' is' : 's are'} marked "probably known": test out of them from Courses if you like.`) : null,
      el('div', { class: 'row' },
        r.start ? el('a', { class: 'btn', href: `#/lesson?id=${encodeURIComponent(r.start.id)}` }, `Start here: ${r.start.title}`) : null,
        el('a', { class: 'btn plain', href: `#/courses?s=${encodeURIComponent(sid)}` }, 'Courses'),
        el('a', { class: 'btn plain', href: '#/calibrate' }, 'Another subject'))));
  }
} };

// ---- a unit checkpoint: ten mixed questions, your level before and after ---------------------

const checkpointPanel = { title: 'Checkpoint', w: 12, async render(body, ctx) {
  const unit = ctx.params.unit;
  const [items, before] = await Promise.all([api.checkpoint(unit), api.levels()]);
  const was = before.skills.find(s => s.scope === unit);
  const name = (await api.table('unit', { id: unit }))[0]?.title;
  ctx.pageTitle(`Checkpoint: ${name || unit}`, 'Ten mixed questions from this unit and the ones before it');
  ctx.setTitle('');
  const stage = el('div', { class: 'player' });
  let i = 0, right = 0, asked = 0;
  const step = async () => {
    if (i >= items.length) {
      const now = (await api.levels()).skills.find(s => s.scope === unit);
      stage.replaceChildren(el('div', { class: 'lcard lresult' },
        el('h3', {}, `${right} of ${asked} right`),
        now ? el('p', {}, was ? `This unit: stage ${was.level.toFixed(1)} → ` : 'This unit: stage ', stageChip(now)) : null,
        el('p', { class: 'muted' }, 'Anything you missed is on your Coming back list.'),
        el('div', { class: 'row' }, el('a', { class: 'btn', href: '#/courses' }, 'Courses'), el('a', { class: 'btn plain', href: '#/review' }, 'Review'))));
      return;
    }
    const item = items[i++];
    const go = el('button', { class: 'btn plain nextcard', type: 'button', hidden: true, onclick: step }, 'Next →');
    const card = frame(item, { mode: 'checkpoint', onDone: out => { if (out.correct != null) { asked++; if (out.correct) right++; } go.hidden = false; go.focus(); } });
    card.classList.add('current');
    stage.replaceChildren(el('div', { class: 'small muted' }, `Question ${i} of ${items.length}`), card, go);
  };
  body.append(stage);
  if (!items.length) stage.append(el('p', { class: 'note' }, 'Nothing to ask yet in this unit.'));
  else step();
} };

// ---- Stats → Levels: where you are, how it has moved, the units, how sure you were -----------

const levelsPanel = { title: 'Levels', w: 12, deps: ['skill'], async render(body) {
  const lv = await api.levels();
  const subs = lv.skills.filter(s => s.kind === 'subject');
  if (!subs.length) {
    body.append(el('p', { class: 'note' }, 'No levels yet. ', el('a', { href: '#/calibrate' }, 'Find your level'),
      ' in a subject (about ten minutes), or just keep going: every answer that counts sharpens it.'), ladder(null));
    return;
  }
  body.append(el('div', { class: 'levelgrid' }, subs.map(s => {
    const hist = lv.history[s.scope] || [];
    const units = lv.skills.filter(u => u.kind === 'unit' && u.subject_id === s.scope);
    const mount = el('div');
    if (hist.length > 1) queueMicrotask(() => chart(mount, { type: 'line', labels: hist.map(h => dayShort(h.day)),
      series: [{ name: 'Stage', values: hist.map(h => h.level) }], fmt: v => (+v).toFixed(1), height: 140, zeroBase: false }));
    return el('div', { class: 'levelcard' },
      el('div', { class: 'row mid' }, el('strong', {}, s.title), stageChip(s), el('span', { class: 'spacer' }),
        el('a', { class: 'btn plain sm', href: `#/calibrate?s=${encodeURIComponent(s.scope)}` }, 'Recalibrate')),
      el('p', { class: 'small muted' }, `${stageOf(s.level)[2]} · likely ${s.low.toFixed(1)}–${s.high.toFixed(1)} · from ${s.n} answers`),
      hist.length > 1 ? mount : null,
      units.length ? el('div', { class: 'unitmap' }, units.map(u => el('div', { class: 'mrow' }, el('span', {}, u.title),
        el('span', { class: 'lvlbar' }, el('i', { style: `width:${Math.round(100 * Math.min(1, u.level / 9))}%` })), stageChip(u, true)))) : null);
  })), el('details', {}, el('summary', {}, 'The stages'), ladder(null),
    el('p', { class: 'note' }, 'Stages are Daybook’s own scale, 1 to 9, starting below GCSE; the UK qualification level (RQF) is alongside. ',
      'Your stage is where you get about 8 in 10 right. The range narrows as you answer more.')));
} };

const confidencePanel = { title: 'How sure, how right', w: 6, deps: ['answer'], async render(body) {
  const rows = await api.view('v_confidence', { order: 'confidence' });
  const say = ['Guess', 'Think so', 'Sure'];
  body.append(table([{ k: 'confidence', label: 'You said', fmt: v => say[v] }, { k: 'asked', label: 'Answers', n: true },
    { k: 'pct', label: 'Right', n: true, fmt: v => `${v}%` }], rows, { empty: 'Tap how sure you are before answering and it shows here.' }),
    el('p', { class: 'note' }, 'Well judged is about 90% right when sure and near chance when guessing. Sure and wrong is worth noticing: those come back soonest.'));
} };

const reworkPanel = { title: 'Needs rework', w: 6, deps: ['report', 'card_state'], async render(body, ctx) {
  const rw = await api.rework();
  const link = r => el('a', { href: `#/lesson?id=${encodeURIComponent(r.lesson_id)}&card=${encodeURIComponent(r.card_id || r.id)}` }, (r.text || r.card_id || '').slice(0, 90));
  body.append(
    el('h4', {}, 'Reported'), table([{ k: 'text', label: 'Card', render: link }, { k: 'note', label: 'Note' },
      { k: '_d', label: '', sort: false, render: r => el('button', { class: 'btn plain sm', type: 'button', onclick: async () => {
        try { await api.save('report', { id: r.id, done: 1 }); ctx.changed('report'); ctx.refresh(); } catch (e) { flash(e.message); }
      } }, 'Done') }], rw.reports, { empty: 'Nothing reported. Every card has a Report link.' }),
    el('h4', {}, 'Missed four times or more'), table([{ k: 'text', label: 'Card', render: link }, { k: 'lesson', label: 'Lesson' },
      { k: 'lapses', label: 'Missed', n: true }], rw.leeches, { empty: 'None. A card missed four times is usually a card to rewrite, not a failing of yours.' }));
} };

export const calibratePage = { title: 'Find my level', quick: false, layout: [{ use: 'learn.calibrate' }], panels: { 'learn.calibrate': calibratePanel } };
export const checkpointPage = { title: 'Checkpoint', quick: false, layout: [{ use: 'learn.checkpoint' }], panels: { 'learn.checkpoint': checkpointPanel } };
export const panels = { 'learn.levels': levelsPanel, 'learn.confidence': confidencePanel, 'learn.rework': reworkPanel };
