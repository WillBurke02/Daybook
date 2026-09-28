// Looking back: the timeline (days newest first), the month with dots on the
// days that have anything logged, and the tags.
import { api } from '../api.js';
import { el, table } from '../core/dom.js';
import { today, dayLong, addMonths, monthLong, lastDay, dateUK } from '../core/format.js';
import { calendar } from '../ui/calendar.js';

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
      if (!list.children.length) list.append(el('p', { class: 'note' }, tag ? `Nothing tagged #${tag}.` : 'Nothing logged yet. Use the box at the top.'));
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
      el('p', { class: 'note' }, `${days.length} day${days.length === 1 ? '' : 's'} logged this month. A dot for each entry, up to five.`));
  } },
  'log.tags': { title: 'Tags', w: 4, deps: ['entry'], async render(body) {
    const rows = await api.view('v_tag', { order: 'n', desc: 1 });
    body.append(table([
      { k: 'tag', label: 'Tag', render: r => el('a', { href: `#/timeline?tag=${encodeURIComponent(r.tag)}` }, '#' + r.tag) },
      { k: 'n', label: 'Entries', n: true }, { k: 'last_day', label: 'Last', fmt: dateUK }],
      rows, { empty: 'No tags yet. Type a word with # in front, such as #site, in any entry.' }));
  } },
} };

export const tags = { title: 'Tags', layout: [{ use: 'log.tags', w: 6 }], panels: {} };
