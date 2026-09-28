// Reminders: bills and anything else that comes round. A bill tied to a payee
// ticks itself off when that payee is paid within a week of the date.
import { api } from '../api.js';
import { el, flash, table } from '../core/dom.js';
import { money, dayShort, dayLong, today, addDays, plain } from '../core/format.js';
import { extraCols } from '../core/state.js';
import { grid } from '../ui/grid.js';

export const title = 'Reminders';
export const ownPeriod = true;

const EVERY = [{ v: 'once', label: 'Once' }, { v: 'week', label: 'Every week' }, { v: 'month', label: 'Every month' },
               { v: 'quarter', label: 'Every quarter' }, { v: 'year', label: 'Every year' }];
const everyLabel = v => EVERY.find(e => e.v === v)?.label || v;
const perMonth = r => (r.amount || 0) * ({ week: 52 / 12, month: 1, quarter: 1 / 3, year: 1 / 12 }[r.every] || 0);
const whenText = d => d === 0 ? 'today' : d === 1 ? 'tomorrow' : d > 0 ? `in ${d} days` : d === -1 ? 'yesterday' : `${-d} days late`;

export const panels = {
  'reminders.soon': { title: 'Coming up', w: 4, deps: ['reminder', 'txn', 'leave', 'bank_holiday'], async render(body, ctx) {
    const t = today(), until = addDays(t, 45);
    const [rems, bank, leave] = await Promise.all([api.reminders(),
      api.table('bank_holiday', { date__gte: t, date__lte: until, order: 'date' }),
      api.table('leave', { to_date__gte: t, from_date__lte: until, order: 'from_date' })]);
    const rows = [
      ...rems.filter(r => r.next_due && r.next_due <= until).map(r => ({ date: r.next_due, days: r.days, rem: r })),
      ...bank.map(b => ({ date: b.date, what: b.name, cls: 'bh' })),
      ...leave.map(l => ({ date: l.from_date, what: l.note || 'Day off', cls: 'off', sub: `${plain(l.days)} days` })),
    ].sort((a, b) => (a.days < 0 ? -1 : 0) - (b.days < 0 ? -1 : 0) || a.date.localeCompare(b.date));
    ctx.aside.append(el('a', { class: 'link', href: '#/reminders' }, 'All'));
    if (!rows.length) { body.append(el('p', { class: 'note' }, 'Nothing in the next six weeks.')); return; }
    body.append(el('div', { class: 'soon' }, rows.map(x => {
      const r = x.rem;
      if (!r) return el('a', { class: 'item go ' + x.cls, href: '#/holidays' }, el('span', { class: 'd num' }, dayShort(x.date)),
        el('span', { class: 'w' }, x.what, x.sub ? el('span', { class: 'muted' }, ` · ${x.sub}`) : null), el('span'));
      return el('div', { class: 'item' + (r.days < 0 ? ' late' : r.days <= 3 ? ' near' : '') },
        el('span', { class: 'd num', title: dayLong(r.next_due) }, dayShort(r.next_due)),
        el('span', { class: 'w' }, el('a', { href: '#/reminders' }, r.title), r.amount ? el('span', { class: 'num' }, ` ${money(r.amount)}`) : null,
          el('span', { class: 'muted' }, ` · ${whenText(r.days)}`),
          r.last_paid ? el('div', { class: 'muted small' }, `Last paid ${money(r.last_amount)} on ${dayShort(r.last_paid)}`) : null),
        el('button', { class: 'btn plain sm', type: 'button', title: r.merchant_id ? 'Ticks itself off when the payment arrives; this does it now'
            : 'Dealt with: move on to the next one', onclick: async () => {
          await api.save('reminder', { id: r.id, done_through: r.next_due });
          flash(`${r.title}: done`, { label: 'Undo', fn: async () => { await api.undo(); ctx.changed('reminder'); ctx.refresh(); } });
          ctx.changed('reminder'); ctx.refresh();
        } }, 'Done'));
    })));
  } },

  'reminders.all': { title: 'All reminders', w: 12, deps: ['reminder', 'txn', 'merchant'], async render(body, ctx) {
    const [rows, payees, computed] = await Promise.all([api.table('reminder', { order: 'start' }),
      api.table('merchant', { order: 'name' }), api.reminders()]);
    const byId = Object.fromEntries(computed.map(r => [r.id, r]));
    const monthly = rows.filter(r => r.merchant_id || r.amount).reduce((a, r) => a + perMonth(r), 0);
    body.append(grid({ table: 'reminder', rows, scroll: 'tall',
      rowClass: r => byId[r.id]?.days < 0 ? 'late' : !byId[r.id]?.next_due ? 'past' : null,
      cols: [{ k: 'title', label: 'Reminder', required: true, placeholder: 'e.g. Car insurance' },
             { k: 'start', label: 'First due', type: 'date', required: true, width: '140px' },
             { k: 'every', label: 'Repeats', type: 'select', options: EVERY, width: '130px' },
             { k: 'amount', label: 'Amount', type: 'number', n: true, width: '90px', placeholder: '£' },
             { k: 'merchant_id', label: 'Paid to (ticks itself off)', type: 'select', width: '170px',
               options: [{ v: '', label: '—' }, ...payees.map(m => ({ v: m.id, label: m.name }))] },
             { k: '_next', label: 'Next due', render: r => { const c = byId[r.id];
                 return c?.next_due ? el('span', {}, dayShort(c.next_due), el('span', { class: 'muted' }, ` · ${whenText(c.days)}`)) : el('span', { class: 'muted' }, 'done'); } },
             { k: '_paid', label: 'Last paid', render: r => { const c = byId[r.id];
                 return c?.last_paid ? el('span', { class: 'muted' }, `${money(c.last_amount)} · ${dayShort(c.last_paid)}`) : ''; } },
             { k: 'note', label: 'Note' }, ...extraCols('reminder')],
      draft: { every: 'month', start: today() },
      total: { title: 'Regular bills', amount: money(monthly), _next: 'a month on average' },
      onSaved: () => { ctx.changed('reminder'); ctx.refresh(); }, onChange: () => { ctx.changed('reminder'); ctx.refresh(); } }));
  } },

  'reminders.regular': { title: 'Regular payments found', w: 12, deps: ['reminder', 'txn'], async render(body, ctx) {
    const found = await api.regular();
    body.append(el('p', { class: 'note', style: 'margin-top:0' },
      'Payees paid about the same amount at a steady interval, lately. Nothing is added until you say so.'),
      table([{ k: 'name', label: 'Payee' }, { k: 'every', label: 'Seems to be', fmt: everyLabel },
             { k: 'amount', label: 'Amount', n: true, fmt: money }, { k: 'last', label: 'Last paid', fmt: dayShort },
             { k: 'next', label: 'Next expected', fmt: dayShort },
             { k: '_', label: '', sort: false, render: s => el('button', { class: 'btn sm', type: 'button', onclick: async () => {
               await api.save('reminder', { title: s.name, start: s.next, every: s.every, amount: s.amount, merchant_id: s.merchant_id });
               flash(`Tracking ${s.name}`, { label: 'Undo', fn: async () => { await api.undo(); ctx.changed('reminder'); } });
               ctx.changed('reminder'); ctx.refresh();
             } }, 'Track') }], found, { empty: 'None found, or all of them are already tracked.' }));
  } },
};

export const layout = [
  { use: 'reminders.soon', w: 4 },
  { use: 'reminders.regular', w: 8 },
  { use: 'reminders.all' },
];
