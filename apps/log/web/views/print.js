// A day or a range, laid out to print for HR or a customer: every entry, with its photos.
import { api } from '../api.js';
import { el } from '../core/dom.js';
import { today, dayLong, addDays } from '../core/format.js';

export const page = { title: 'Print', layout: [{ use: 'log.print' }], panels: {
  'log.print': { title: 'Print', w: 12, async render(body, ctx) {
    const from = ctx.params.from || today(), to = ctx.params.to || from;
    const f = el('input', { type: 'date', class: 'sm', value: from, 'aria-label': 'From' });
    const t = el('input', { type: 'date', class: 'sm', value: to, 'aria-label': 'To' });
    const withDiary = el('input', { type: 'checkbox', checked: ctx.params.diary !== '0' });
    const go = () => ctx.go('print', { from: f.value, to: t.value < f.value ? f.value : t.value, diary: withDiary.checked ? 1 : 0 });
    [f, t, withDiary].forEach(i => i.addEventListener('change', go));
    ctx.aside.append(el('label', { class: 'c' }, 'From', f), el('label', { class: 'c' }, 'to', t),
      el('label', { class: 'c' }, withDiary, 'Diary too'),
      el('button', { class: 'btn plain sm', onclick: () => ctx.go('print', { from: addDays(from, -6), to: from }) }, 'Week to here'),
      el('button', { class: 'btn sm', onclick: () => print() }, 'Print'));
    const got = await api.print(from, to);
    const entries = got.entries.filter(e => withDiary.checked || e.kind !== 'day');
    ctx.setTitle(from === to ? `Log · ${dayLong(from)}` : `Log · ${dayLong(from)} to ${dayLong(to)}`);
    const out = el('div', { class: 'printout' });
    let last = null;
    for (const e of entries) {
      if (e.day !== last) { out.append(el('h2', {}, dayLong(e.day))); last = e.day; }
      out.append(el('div', { class: 'pentry' },
        el('div', { class: 'num muted' }, e.kind === 'day' ? 'Diary' : e.at || ''),
        el('div', {}, el('div', { class: 'ptext' }, e.text || ''),
          e.photos.length ? el('div', { class: 'pphotos' }, e.photos.map(p => el('img', { src: p, alt: '' }))) : null,
          e.voices ? el('div', { class: 'muted small' }, `${e.voices} voice note${e.voices > 1 ? 's' : ''} (not printed)`) : null)));
    }
    body.append(entries.length ? out : el('p', { class: 'note' }, 'Nothing logged in these days.'));
  } },
} };
