// Looking back: the timeline (days newest first), the month with dots on the
// days that have anything logged, and the tags.
import { api } from '../api.js';
import { el, table, dialog, flash } from '../core/dom.js';
import { today, dayLong, addMonths, monthLong, lastDay, dateUK } from '../core/format.js';
import { calendar } from '../ui/calendar.js';
import { viewImage, videoTile } from '../ui/media.js';

const dayLink = (d, text) => el('a', { href: `#/day?d=${d}` }, text || dayLong(d));

export const timeline = { title: 'Timeline', narrow: true, layout: [{ use: 'log.timeline' }], panels: {
  'log.timeline': { title: 'Timeline', w: 12, deps: ['entry', 'attachment'], async render(body, ctx) {
    const tag = ctx.params.tag || '';
    if (tag) ctx.aside.append(el('span', { class: 'chip on' }, '#' + tag, el('a', { class: 'x', href: '#/timeline', title: 'All entries' }, ' ×')));
    const list = el('div', { class: 'timeline' });
    const more = el('button', { class: 'btn plain', hidden: true }, 'Older');
    let before = '9999-12-31';
    const page = async () => {
      const got = await api.timeline({ before, tag, limit: 30 });
      if (tag && before === '9999-12-31') body.prepend(el('p', { class: 'tagnote' }, got.note || el('span', { class: 'muted' }, `No note on #${tag} yet.`),
        ' ', el('a', { class: 'small', href: `#/tags?edit=${encodeURIComponent(tag)}` }, got.note ? 'Edit' : 'Add one'),
        ' · ', el('a', { class: 'small', href: `#/photos?tag=${encodeURIComponent(tag)}` }, 'Photos')));
      for (const d of got.days) {
        list.append(el('section', { class: 'tday' },
          el('h3', {}, dayLink(d.day)),
          el('div', { class: 'tlines' }, d.lines.map(l => el('div', { class: 'tline' + (l.kind === 'day' ? ' diary' : '') },
            el('span', { class: 'num muted' }, l.kind === 'day' ? 'Diary' : l.at || ''),
            el('span', {}, l.text || el('span', { class: 'muted' }, [l.photos ? `${l.photos} photo${l.photos > 1 ? 's' : ''}` : '', l.voices ? 'voice note' : ''].filter(Boolean).join(', ')))))),
          d.thumbs.length ? el('div', { class: 'tthumbs' }, d.thumbs.map(t => el('a', { href: `#/day?d=${d.day}` }, el('img', { src: t, alt: '' })))) : null));
        before = d.day;
      }
      more.hidden = !got.more;
      if (!list.children.length) list.append(el('p', { class: 'note' }, tag ? `Nothing tagged #${tag}.` : 'Nothing logged yet.'));
    };
    more.addEventListener('click', page);
    body.append(list, more);
    await page();
  } },
} };

export const month = { title: 'Calendar', layout: [{ use: 'log.month', w: 8 }, { use: 'log.tags', w: 4 }], panels: {
  'log.month': { title: 'Calendar', w: 8, deps: ['entry'], async render(body, ctx) {
    const m = /^\d{4}-\d{2}$/.test(ctx.params.m || '') ? ctx.params.m : today().slice(0, 7);
    const days = await api.view('v_log_day', { day__gte: m + '-01', day__lte: lastDay(m) });
    ctx.setTitle(monthLong(m));
    // a month back or on, a year back or on, or straight to any month
    const pick = el('input', { type: 'month', class: 'sm', value: m, 'aria-label': 'Go to a month',
      onchange: e => { if (/^\d{4}-\d\d$/.test(e.target.value)) ctx.go('calendar', { m: e.target.value }); } });
    const to = n => () => ctx.go('calendar', { m: addMonths(m, n) });
    ctx.aside.append(el('div', { class: 'period' },
      el('button', { class: 'btn plain sm', type: 'button', title: 'A year back', onclick: to(-12) }, '«'),
      el('button', { class: 'icon', type: 'button', 'aria-label': 'Previous month', onclick: to(-1) }, '◀'), pick,
      el('button', { class: 'icon', type: 'button', 'aria-label': 'Next month', onclick: to(1) }, '▶'),
      el('button', { class: 'btn plain sm', type: 'button', title: 'A year on', onclick: to(12) }, '»'),
      m !== today().slice(0, 7) ? el('button', { class: 'btn plain sm', type: 'button', onclick: () => ctx.go('calendar', {}) }, 'This month') : null));
    body.append(calendar({ month: m, dots: Object.fromEntries(days.map(d => [d.day, d.entries])),
                           onPick: d => ctx.go('day', { d }) }),
      el('p', { class: 'note' }, `${days.length} day${days.length === 1 ? '' : 's'} logged`));
  } },
  'log.tags': { title: 'Tags', w: 4, deps: ['entry'], async render(body, ctx) {
    const rows = await api.view('v_tag', { order: 'n', desc: 1 });
    const redraw = () => { ctx.changed('entry'); ctx.refresh(); };           // the others, then this one
    // what a tag stands for, and its name: a typo (#sit) or two names for one thing (#pump-3, #pump3) is renamed,
    // onto a tag in use to merge them
    const edit = r => {
      const to = el('input', { value: r.tag, 'aria-label': 'Name', autocapitalize: 'off' });
      const note = el('textarea', { rows: 3, 'aria-label': 'What it stands for' }, r.note || '');
      note.value = r.note || '';
      dialog(`#${r.tag}`, el('div', { class: 'stack' }, el('label', {}, 'What it stands for', note), el('label', {}, 'Name ', to),
        el('p', { class: 'note' }, `Renaming changes ${r.n} entr${r.n === 1 ? 'y' : 'ies'}. Using an existing name merges the two tags.`)),
        [{ label: 'Save', fn: async () => {
          try {
            const text = note.value.trim();
            if (text !== (r.note || '')) await (text ? api.save('tag_note', { tag: r.tag, note: text }) : api.remove('tag_note', r.tag));
            if (to.value.trim().replace(/^#/, '').toLowerCase() !== r.tag) {
              const got = await api.renameTag(r.tag, to.value);
              flash(`Renamed in ${got.entries} entr${got.entries === 1 ? 'y' : 'ies'}`, { label: 'Undo', fn: async () => { await api.undo(); redraw(); } });
            } else flash('Saved');
            redraw();
          } catch (e) { flash(e.message); return false; }
        } }]);
      setTimeout(() => note.focus());
    };
    const asked = rows.find(r => r.tag === ctx.params.edit);                // from a tag's timeline: Add one / Edit
    if (asked) { edit(asked); history.replaceState(null, '', '#/tags'); }
    body.append(table([
      { k: 'tag', label: 'Tag', render: r => el('a', { href: `#/timeline?tag=${encodeURIComponent(r.tag)}` }, '#' + r.tag) },
      { k: 'note', label: 'Stands for', render: r => el('span', { class: 'muted small' }, r.note || '') },
      { k: 'n', label: 'Entries', n: true }, { k: 'last_day', label: 'Last', fmt: dateUK },
      { k: 'edit', label: '', render: r => el('button', { class: 'btn plain sm', type: 'button', onclick: () => edit(r) }, 'Edit') }],
      rows, { empty: 'No tags yet.' }));
  } },
} };

// Every photo and video, newest first, as a grid; a tag's alone from the chips along the top.
export const photos = { title: 'Photos', layout: [{ use: 'log.photos' }], panels: {
  'log.photos': { title: 'Photos', w: 12, deps: ['entry', 'attachment', 'clip'], async render(body, ctx) {
    const tag = (ctx.params.tag || '').toLowerCase();
    const tags = (await api.view('v_tag', { order: 'n', desc: 1 }).catch(() => [])).slice(0, 14);
    if (tag && !tags.some(t => t.tag === tag)) tags.unshift({ tag });
    const go = t => ctx.go('photos', t ? { tag: t } : {});
    body.append(el('div', { class: 'row wrap photochips' },
      el('button', { class: 'chip' + (tag ? '' : ' on'), type: 'button', onclick: () => go('') }, 'All'),
      tags.map(t => el('button', { class: 'chip' + (t.tag === tag ? ' on' : ''), type: 'button', title: t.note || null, onclick: () => go(t.tag) }, '#' + t.tag))));
    const grid = el('div', { class: 'photogrid' }), more = el('button', { class: 'btn plain', type: 'button', hidden: true }, 'More');
    let offset = 0;
    const page = async () => {
      const got = await api.photos({ tag, offset, limit: 60 });
      grid.append(...got.items.map(i => {
        const title = `${dayLong(i.day)}${i.at ? ' · ' + i.at : ''}${i.text ? ' · ' + i.text.split('\n')[0].slice(0, 80) : ''}`;
        return el('div', { class: 'ptile' }, i.type === 'video' ? videoTile(i, '/log/', title)
          : el('button', { class: 'thumb', type: 'button', title, onclick: () => viewImage(api.media(i.id), title) }, el('img', { src: i.thumb, alt: title, loading: 'lazy' })),
          el('a', { class: 'pday small', href: `#/day?d=${i.day}&e=${i.entry_id}` }, `${i.day.slice(8)}/${i.day.slice(5, 7)}/${i.day.slice(2, 4)}`));
      }));
      offset += got.items.length;
      more.hidden = !got.more;
      if (!grid.children.length) grid.replaceWith(el('p', { class: 'note' }, tag ? `No photos on entries tagged #${tag}.` : 'No photos yet.'));
    };
    more.addEventListener('click', page);
    body.append(grid, more);
    await page();
  } },
} };

export const tags = { title: 'Tags', layout: [{ use: 'log.tags', w: 12 }], panels: {} };
