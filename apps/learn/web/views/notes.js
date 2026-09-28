// Notes: every lesson's summary in a subject, in course order, with your own notes
// under each. One page to read back over, and to print.
import { api } from '../api.js';
import { el } from '../core/dom.js';
import { rich } from '../cards.js';
import { notesBox, lessonHref } from './courses.js';

const notesPanel = { title: 'Notes', w: 12, async render(body, ctx) {
  const subjects = (await api.view('v_subject', { order: 'sort' })).filter(s => s.id !== 'mine');
  const sid = ctx.params.s || subjects[0]?.id;
  const subject = subjects.find(s => s.id === sid);
  ctx.setTitle('');
  ctx.pageTitle(subject ? `Notes: ${subject.title}` : 'Notes', 'The summary of every lesson written so far, and your own notes');
  ctx.aside.append(el('button', { class: 'btn plain sm', type: 'button', onclick: () => print() }, 'Print'));
  body.append(el('div', { class: 'seg tabs', role: 'tablist' }, subjects.map(s => el('a', { class: 'btn plain sm' + (s.id === sid ? ' on' : ''),
    href: `#/notes?s=${encodeURIComponent(s.id)}`, 'aria-current': s.id === sid ? 'page' : null }, s.title))));
  if (!subject) return;
  const rows = await api.subjectNotes(sid);
  if (!rows.length) { body.append(el('p', { class: 'note' }, 'No summaries in this subject yet: they come with each lesson as it is written.')); return; }
  let unit = null;
  for (const r of rows) {
    if (r.unit !== unit) { unit = r.unit; body.append(el('h2', { class: 'nunit' }, unit)); }
    body.append(el('section', { class: 'nlesson', id: `n-${r.id}` },
      el('h3', {}, el('a', { href: lessonHref(r.id) }, r.title), r.learned ? el('span', { class: 'chip on' }, 'learned') : null),
      r.summary ? el('div', { class: 'lsummary' }, rich(r.summary)) : el('p', { class: 'note' }, 'Not written yet.'),
      el('details', { open: !!r.notes }, el('summary', {}, 'Your notes'), notesBox(r.id, r.notes))));
  }
  if (ctx.params.l) requestAnimationFrame(() => document.getElementById(`n-${ctx.params.l}`)?.scrollIntoView({ block: 'start' }));
} };

export const page = { title: 'Notes', quick: false, narrow: true, layout: [{ use: 'learn.notes' }], panels: { 'learn.notes': notesPanel } };
