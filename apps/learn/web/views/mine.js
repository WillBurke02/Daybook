// Your own cards and lessons (§7.8): written here, kept in learn.db, never
// touched when the course files reload. Plus a CSV import and the flash
// cards made from your mistakes.
import { api } from '../api.js';
import { el, flash, table } from '../core/dom.js';
import { brief } from '../cards.js';

const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lesson';
const firstLine = t => brief(t, 120);
const EXAMPLE = JSON.stringify({ type: 'mcq', q: 'Which couplant suits a hot surface?', options: ['Water', 'High-temperature gel', 'Nothing'],
  answer: 1, why: 'Water boils off; a gel made for the temperature stays in place.' }, null, 2);

/** Lessons to file a card under: yours first, then every course lesson, by subject. */
async function lessonPicker(value) {
  const ls = await api.view('v_lesson');
  ls.sort((a, b) => a.subject_sort - b.subject_sort || a.unit_sort - b.unit_sort || a.sort - b.sort);
  const pick = el('select', { 'aria-label': 'Lesson' });
  for (const s of [...new Set(ls.map(l => l.subject))])
    pick.append(el('optgroup', { label: s }, ls.filter(l => l.subject === s).map(l => el('option', { value: l.id, selected: l.id === value }, l.title))));
  return pick;
}

const cardsPanel = { title: 'My cards', w: 8, deps: ['card', 'lesson'], async render(body, ctx) {
  const [rows, lessons] = await Promise.all([api.view('v_card', { source: 'own', order: 'lesson' }), api.view('v_lesson', { source: 'own' })]);
  const pick = await lessonPicker(ctx.params.lesson || lessons[0]?.id);
  let editing = null, kind = 'flash';
  const front = el('textarea', { rows: 3, placeholder: 'Front: the question. $maths$ works, as do **bold** and - lists', 'aria-label': 'Front' });
  const back = el('textarea', { rows: 3, placeholder: 'Back: the answer, and why', 'aria-label': 'Back' });
  const json = el('textarea', { rows: 10, class: 'mono', spellcheck: false, 'aria-label': 'Card as JSON', hidden: true });
  const kindBtn = el('button', { class: 'btn plain sm', type: 'button', onclick: () => setKind(kind === 'flash' ? 'json' : 'flash') });
  const title = el('strong', {}, 'New flash card');
  const setKind = k => {
    kind = k;
    front.hidden = back.hidden = k !== 'flash'; json.hidden = k === 'flash';
    if (k === 'json' && !json.value.trim()) json.value = front.value ? JSON.stringify({ type: 'flash', front: front.value, back: back.value }, null, 2) : EXAMPLE;
    kindBtn.textContent = k === 'flash' ? 'Another type (as JSON)…' : 'Plain flash card';
    title.textContent = `${editing ? 'Edit' : 'New'} ${k === 'flash' ? 'flash card' : 'card'}`;
  };
  const clear = () => { editing = null; front.value = back.value = json.value = ''; setKind('flash'); };
  const save = async () => {
    let data;
    if (kind === 'flash') {
      if (!front.value.trim() || !back.value.trim()) { flash('A flash card needs a front and a back'); return; }
      data = { type: 'flash', front: front.value.trim(), back: back.value.trim() };
    } else {
      try { data = JSON.parse(json.value); } catch (e) { flash('That is not valid JSON: ' + e.message); return; }
    }
    const id = editing || `own/${pick.value}/${Date.now().toString(36)}`;
    try {
      await api.save('card', { id, lesson_id: pick.value, sort: 1000 + rows.length, source: 'own', data: JSON.stringify({ ...data, id }) });
      flash(editing ? 'Card saved' : 'Card added');
      clear(); ctx.changed('card'); ctx.refresh();
    } catch (e) { flash(e.message); }
  };
  const edit = async r => {
    const [c] = await api.table('card', { id: r.id });
    const d = JSON.parse(c.data || '{}');
    editing = r.id;
    pick.value = r.lesson_id;
    if (d.type === 'flash') { front.value = d.front || ''; back.value = d.back || ''; json.value = ''; setKind('flash'); }
    else { const { id, ...rest } = d; json.value = JSON.stringify(rest, null, 2); setKind('json'); }
    front.focus();
  };
  setKind('flash');
  body.append(el('div', { class: 'lform' }, title, el('label', {}, 'Lesson ', pick), front, back, json,
    el('div', { class: 'row mid' }, el('button', { class: 'btn', type: 'button', onclick: save }, 'Save'),
      el('button', { class: 'btn plain', type: 'button', onclick: clear }, 'Clear'), el('span', { class: 'spacer' }), kindBtn)),
    el('p', { class: 'note' }, 'Any card type can be written as JSON, as in the course files: concept, mcq, numeric (with vars and an answer formula), ',
      'steps, order, match, flash or code. Cards filed in a course lesson show at the end of it.'),
    table([
      { k: 'text', label: 'Card', render: r => el('a', { href: `#/lesson?id=${encodeURIComponent(r.lesson_id)}&card=${encodeURIComponent(r.id)}` }, firstLine(r.text) || r.id) },
      { k: 'lesson', label: 'Lesson' }, { k: 'type', label: 'Type' },
      { k: '_e', label: '', sort: false, render: r => el('span', { class: 'row mid' },
        el('button', { class: 'btn plain sm', type: 'button', onclick: () => edit(r) }, 'Edit'),
        el('button', { class: 'btn danger sm', type: 'button', onclick: async () => {
          try { await api.remove('card', r.id); flash('Card deleted', { label: 'Undo', fn: async () => { await api.undo(); ctx.refresh(); } }); ctx.changed('card'); ctx.refresh(); }
          catch (e) { flash(e.message); }
        } }, 'Delete')) },
    ], rows, { empty: 'None yet.' }));
} };

const lessonsPanel = { title: 'My lessons', w: 4, deps: ['lesson', 'card'], async render(body, ctx) {
  const rows = await api.view('v_lesson', { source: 'own', order: 'title' });
  const name = el('input', { placeholder: 'A new lesson, such as Site notes', 'aria-label': 'New lesson' });
  const add = async () => {
    const t = name.value.trim();
    if (!t) return;
    const id = `mine.cards.${slug(t)}`;
    if (rows.some(r => r.id === id)) { flash('You have a lesson of that name'); return; }
    try { await api.save('lesson', { id, unit_id: 'mine.cards', title: t, sort: rows.length, source: 'own' }); name.value = ''; ctx.changed('lesson'); ctx.refresh(); }
    catch (e) { flash(e.message); }
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  body.append(el('div', { class: 'row mid' }, name, el('button', { class: 'btn plain', type: 'button', onclick: add }, 'Add')),
    rows.length ? el('ul', { class: 'plain mylessons' }, rows.map(r => {
      const t = el('input', { value: r.title, 'aria-label': 'Lesson title' });
      t.addEventListener('change', async () => {
        try { await api.save('lesson', { id: r.id, title: t.value.trim() || r.title }); ctx.changed('lesson'); } catch (e) { flash(e.message); }
      });
      return el('li', { class: 'row mid' }, t, el('a', { class: 'small', href: `#/lesson?id=${encodeURIComponent(r.id)}` }, `${r.cards} card${r.cards === 1 ? '' : 's'}`),
        r.cards ? null : el('button', { class: 'btn danger sm', type: 'button', onclick: async () => {
          try { await api.remove('lesson', r.id); ctx.changed('lesson'); ctx.refresh(); } catch (e) { flash(e.message); }
        } }, 'Delete'));
    })) : el('p', { class: 'note' }, 'Lessons of your own sit under My cards in Courses. You can also file cards in any course lesson.'));
} };

const importPanel = { title: 'Import flash cards', w: 4, async render(body, ctx) {
  const text = el('textarea', { rows: 6, class: 'mono', placeholder: 'front,back,topic\nOhm’s law?,V = IR,Electricity', 'aria-label': 'CSV' });
  const file = el('input', { type: 'file', accept: '.csv,text/csv,text/plain', 'aria-label': 'CSV file',
    onchange: async e => { const f = e.target.files[0]; if (f) text.value = await f.text(); } });
  body.append(el('p', { class: 'note' }, 'A CSV of front,back,topic, one card a line. A topic that names a lesson (its title or id) files the card there; ',
    'any other topic becomes a lesson of your own.'), file, text,
    el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', onclick: async () => {
      try { const r = await api.importCsv(text.value); flash(`Imported ${r.added} card${r.added === 1 ? '' : 's'}`); text.value = ''; file.value = ''; ctx.changed('card'); ctx.changed('lesson'); }
      catch (e) { flash(e.message); }
    } }, 'Import')));
} };

const mistakesPanel = { title: 'From my mistakes', w: 8, deps: ['card'], async render(body, ctx) {
  const rows = await api.view('v_card', { source: 'mistake', order: 'due' });
  body.append(el('p', { class: 'note' }, 'A wrong answer becomes a flash card with the answer and the reason, due at once. Delete one once it has stuck.'),
    table([{ k: 'text', label: 'Card', render: r => firstLine(r.text) }, { k: 'lesson', label: 'Lesson' },
      { k: 'due', label: 'Next', fmt: v => v ? v.slice(0, 10) : '' },
      { k: '_x', label: '', sort: false, render: r => el('button', { class: 'btn danger sm', type: 'button', onclick: async () => {
        try { await api.remove('card', r.id); ctx.changed('card'); ctx.refresh(); } catch (e) { flash(e.message); }
      } }, 'Delete') }], rows, { empty: 'None: nothing answered wrongly yet.' }));
} };

export const page = { title: 'My cards',
  layout: [{ use: 'learn.mycards', w: 8 }, { use: 'learn.mylessons', w: 4 }, { use: 'learn.import', w: 4 }, { use: 'learn.mistakes', w: 8 }],
  panels: { 'learn.mycards': cardsPanel, 'learn.mylessons': lessonsPanel, 'learn.import': importPanel, 'learn.mistakes': mistakesPanel } };
