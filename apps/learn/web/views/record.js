// Your learning record, by date: minutes studied, lessons learned and skills proven. A CPD record
// you could show (the IET asks registrants to keep one); Download gives it as a spreadsheet.
import { api } from '../api.js';
import { el, table, download } from '../core/dom.js';
import { dateUK, today } from '../core/format.js';
import { hm } from '../road.js';

const cell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

const recordPanel = { title: 'Learning record', w: 12, deps: ['card', 'lesson', 'study'], async render(body, ctx) {
  const rows = await api.cpd();
  const mins = rows.reduce((a, r) => a + r.minutes, 0);
  const learned = rows.reduce((a, r) => a + r.learned.length, 0), proven = rows.reduce((a, r) => a + r.proven.length, 0);
  const csv = [['Date', 'Minutes', 'Cards', 'Lessons learned', 'Skills proven (done for real)'],
               ...rows.map(r => [r.day, r.minutes, r.cards, r.learned.join('; '), r.proven.join('; ')])]
    .map(r => r.map(cell).join(',')).join('\r\n');
  ctx.aside.append(el('button', { class: 'btn plain sm', type: 'button', onclick: () => download(`learning-record-${today()}.csv`, csv) }, 'Download CSV'));
  body.append(el('p', {}, `${hm(mins)} studied on ${rows.length} day${rows.length === 1 ? '' : 's'} · ${learned} lesson${learned === 1 ? '' : 's'} learned · `,
      `${proven} skill${proven === 1 ? '' : 's'} proven`),
    table([{ k: 'day', label: 'Date', fmt: dateUK }, { k: 'minutes', label: 'Time', n: true, fmt: m => m ? hm(m) : '' },
           { k: 'learned', label: 'Learned', fmt: v => v.join(', ') }, { k: 'proven', label: 'Proven (done for real)', fmt: v => v.join(', ') }],
      rows, { empty: 'Nothing yet: study a little and it starts.' }));
} };

export const page = { title: 'Record', layout: [{ use: 'learn.record' }], panels: { 'learn.record': recordPanel } };
