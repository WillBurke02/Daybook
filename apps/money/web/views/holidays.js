import { api } from '../api.js';
import { el, flash, table, select, readVal, writeVal } from '../core/dom.js';
import { dayLong, dow, plain, today, addDays, parseWhen, fmtWhen, toNumber } from '../core/format.js';
import { extraCols, setting } from '../core/state.js';
import { grid } from '../ui/grid.js';
import { icon } from '../core/pages.js';
import { yearCalendar, leaveDates } from '../ui/calendar.js';
import { pkSave } from './pay.js';

export const title = 'Annual leave';
export const ownPeriod = true;          // leave goes by its own year, not the period in the header

const thisYear = () => +today().slice(0, 4);
export const holYear = () => +readVal('holiday_year', '') || thisYear();
// the codes stay as stored; what you read is Annual leave and Time off in lieu
export const KINDS = [{ v: 'holiday', label: 'Annual leave' }, { v: 'extra', label: 'Time off in lieu' }, { v: 'other', label: 'Other' }];

/** The year, in the page's header: step back or on as far as you like. A year with
 *  no bank holidays yet gets them worked out as you arrive at it. */
export async function bar(render) {
  const y = holYear();
  const [years] = await Promise.all([api.table('leave_year', { order: 'year' }), api.bankHolidays(y).catch(() => null)]);
  const known = years.map(r => r.year);
  const lo = Math.min(y, thisYear(), ...known) - 3, hi = Math.max(y, thisYear(), ...known) + 3;
  const all = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const set = v => { writeVal('holiday_year', v); render(); };
  return el('div', { class: 'period', role: 'group', 'aria-label': 'Leave year' },
    el('button', { class: 'icon', type: 'button', 'aria-label': 'Previous year', onclick: () => set(y - 1) }, icon('left')),
    select(all, y, { class: 'sm lbl', 'aria-label': 'Leave year', onchange: e => set(e.target.value) }),
    el('button', { class: 'icon', type: 'button', 'aria-label': 'Next year', onclick: () => set(y + 1) }, icon('right')),
    y !== thisYear() ? el('button', { class: 'btn plain sm now', type: 'button', onclick: () => set(thisYear()) }, 'This year') : null);
}

/** A year's row, made on first look with last year's allowance. */
async function yearRow(y) {
  let [row] = await api.view('v_leave_year', { year: y });
  if (row) return row;
  const [prev] = await api.table('leave_year', { year__lt: y, order: 'year', desc: 1, limit: 1 });
  await api.save('leave_year', { year: y, allowance: prev?.allowance ?? 25 });
  [row] = await api.view('v_leave_year', { year: y });
  return row;
}

/** One of a leave year's numbers, typed in place. */
function yearBox(ctx, y, row, k, label, sub) {
  const i = el('input', { value: plain(row[k]), inputmode: 'decimal', style: 'width:90px;text-align:right', 'aria-label': label });
  i.addEventListener('change', async () => {
    try { await api.save('leave_year', { year: y, [k]: toNumber(i.value) || 0 }); ctx.changed('leave_year'); ctx.refresh(); }
    catch (e) { flash(e.message); }
  });
  return el('tr', {}, el('td', {}, label, sub ? el('div', { class: 'muted small' }, sub) : null), el('td', { class: 'n' }, i));
}

/** Mon–Fri between two dates, less bank holidays. Half days you type yourself. */
const workdays = (from, to, bank) => {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (!['Sat', 'Sun'].includes(dow(d)) && !bank.has(d)) n++;
  return n;
};

export const panels = {
  'holidays.allowance': { title: 'Allowance', w: 3, deps: ['leave', 'leave_year', 'setting'], async render(body, ctx) {
    const y = holYear();
    const row = await yearRow(y);
    ctx.setTitle(`Allowance · ${y}`);
    const line = (label, v, cls = '') => el('tr', {}, el('td', { class: cls }, label), el('td', { class: 'n ' + cls }, el('span', { class: 'num' }, v)));
    const note = el('input', { value: row.note || '', placeholder: 'Note' });
    note.addEventListener('change', () => api.save('leave_year', { year: y, note: note.value }));
    body.append(el('table', { class: 'g' }, el('tbody', {},
      yearBox(ctx, y, row, 'allowance', 'Allowance'), yearBox(ctx, y, row, 'extra', 'Extra days', 'bought or given'),
      line('Time off in lieu earned', `${plain(row.toil_days)} (${plain(row.toil_hours)} h)`),
      line('Annual leave taken', plain(row.taken)),
      line('Time off in lieu taken', plain(row.extra_taken)),
      el('tr', { class: 'total' }, el('td', {}, 'Left'), el('td', { class: 'n' },
        el('strong', { class: 'num ' + (row.remaining < 0 ? 'deb' : '') }, plain(row.remaining)))),
      line('Bank holidays', String(row.bank_holidays), 'muted'))),
      el('div', { style: 'margin-top:8px' }, note));
  } },

  // Hours banked instead of overtime pay: they become days in the allowance above.
  'holidays.toil': { title: 'Time off in lieu', w: 3, deps: ['leave', 'leave_year', 'setting'], async render(body, ctx) {
    const y = holYear();
    const row = await yearRow(y);
    ctx.setTitle(`Time off in lieu · ${y}`);
    const week = +setting('weekly_contract_hours', 0) || 0;
    const day = el('input', { value: setting('leave_day_hours', ''), placeholder: plain(row.day_hours), inputmode: 'decimal', style: 'width:90px;text-align:right' });
    day.addEventListener('change', async () => {
      try { await api.save('setting', { key: 'leave_day_hours', value: day.value.trim() === '' ? '' : String(toNumber(day.value) ?? '') }); ctx.changed('setting'); ctx.refresh(); }
      catch (e) { flash(e.message); }
    });
    const line = (label, v, cls = '') => el('tr', {}, el('td', { class: cls }, label), el('td', { class: 'n ' + cls }, el('span', { class: 'num' }, v)));
    body.append(el('table', { class: 'g' }, el('tbody', {},
      yearBox(ctx, y, row, 'toil_hours', 'Earned (hours)', `in ${y}`),
      el('tr', {}, el('td', {}, 'A day off is', el('div', { class: 'muted small' }, week ? `blank: ${plain(week)} a week ÷ 5` : 'hours')), el('td', { class: 'n' }, day)),
      line('Earned (days)', plain(row.toil_days)),
      line('Taken (days)', plain(row.extra_taken)),
      el('tr', { class: 'total' }, el('td', {}, 'Left'), el('td', { class: 'n' },
        el('strong', { class: 'num ' + (row.toil_left < 0 ? 'deb' : '') }, `${plain(row.toil_left)} h`),
        el('div', { class: 'muted small' }, `${plain(Math.round(row.toil_left / row.day_hours * 100) / 100)} days`))))),
      el('p', { class: 'muted small' }, 'Book the days under Days off as Time off in lieu. Earned days count in the allowance too.'));
  } },

  'holidays.years': { title: 'Every leave year', w: 6, deps: ['leave', 'leave_year'], async render(body, ctx) {
    const rows = await api.view('v_leave_year', { order: 'year' });
    const y = holYear();
    const next = (rows.at(-1)?.year ?? thisYear() - 1) + 1;
    body.append(grid({ table: 'leave_year', key: 'year', rows,
      rowClass: r => r.year === y ? 'sel' : r.year < thisYear() ? 'past' : null,
      cols: [{ k: 'year', label: 'Year', readonly: true, draftText: String(next) },
             { k: 'allowance', label: 'Allowance', type: 'number', n: true, required: true, width: '70px' },
             { k: 'extra', label: 'Extra days', type: 'number', n: true, width: '70px' },
             { k: 'toil_hours', label: 'Lieu earned (h)', type: 'number', n: true, width: '80px' },
             { k: 'taken', label: 'Leave taken', n: true, readonly: true, fmt: plain },
             { k: 'extra_taken', label: 'Lieu taken', n: true, readonly: true, fmt: plain },
             { k: 'remaining', label: 'Left', n: true, readonly: true, fmt: v => el('strong', { class: 'num ' + (v < 0 ? 'deb' : '') }, plain(v)) }],
      draft: { allowance: rows.at(-1)?.allowance ?? 25, year: next },
      onChange: () => { ctx.changed('leave_year'); ctx.refresh(); }, onSaved: () => { ctx.changed('leave_year'); ctx.refresh(); } }));
  } },

  'holidays.days': { title: 'Days off', w: 6, deps: ['leave', 'bank_holiday'], async render(body, ctx) {
    const y = holYear();
    const [rows, bankRows] = await Promise.all([
      api.table('leave', { from_date__gte: `${y}-01-01`, from_date__lte: `${y}-12-31`, order: 'from_date' }),
      api.table('bank_holiday', { date__gte: `${y}-01-01`, date__lte: `${y + 1}-01-31` })]);
    const bank = new Set(bankRows.map(b => b.date));
    const t = today();
    ctx.setTitle(`Days off · ${y}`);
    const read = text => {
      const w = parseWhen(text, y);
      if (!w) throw new Error(`Can't read "${text}". Try 8-12 Sep, 25th April or 25/04`);
      return w;
    };
    for (const r of rows) r.when = fmtWhen(r.from_date, r.to_date);
    const sum = kind => plain(rows.filter(r => r.kind === kind).reduce((a, r) => a + (r.days || 0), 0));
    body.append(grid({ table: 'leave', rows, scroll: 'mid',
      rowClass: r => r.to_date < t ? 'past' : null,
      cols: [{ k: 'when', label: 'When', required: true, placeholder: `8-12 Sep, 25th April… (${y})`, width: '190px' },
             { k: 'days', label: 'Days', type: 'number', n: true, width: '70px', placeholder: 'auto' },
             { k: 'kind', label: 'Type', type: 'select', options: KINDS, width: '120px' },
             { k: 'note', label: 'Note' }, ...extraCols('leave')],
      // a new When re-counts the days; type over Days afterwards for half days
      save: (row, patch) => {
        if (!('when' in patch)) return api.save('leave', { id: row.id, ...patch });
        const w = read(patch.when);
        return api.save('leave', { id: row.id, from_date: w.from, to_date: w.to, days: workdays(w.from, w.to, bank) });
      },
      add: ({ when, ...row }) => {
        const w = read(when);
        return api.save('leave', { kind: 'holiday', ...row, from_date: w.from, to_date: w.to, days: row.days ?? workdays(w.from, w.to, bank) });
      },
      draft: { kind: 'holiday' },
      total: { when: 'Annual leave', days: sum('holiday'), note: `Time off in lieu ${sum('extra')} · other ${sum('other')}` },
      onChange: () => { ctx.changed('leave'); ctx.refresh(); },
      onSaved: () => { ctx.changed('leave'); ctx.refresh(); } }));
  } },

  'holidays.bank': { title: 'Bank holidays', w: 6, deps: ['bank_holiday'], async render(body, ctx) {
    const y = holYear(), years = [y - 1, y, y + 1];
    const rows = await api.table('bank_holiday', { date__gte: `${y - 1}-01-01`, date__lte: `${y + 1}-12-31`, order: 'date' });
    const t = today();
    const names = [...new Set(rows.map(r => r.name))];          // date order, so substitute days follow their holiday
    const cell = (name, yr) => rows.filter(r => r.name === name && r.date.startsWith(yr)).map(r =>
      el('span', { class: r.date < t ? 'past' : null }, fmtWhen(r.date)));
    body.append(table([{ k: 'name', label: '' }, ...years.map(yr => ({ k: String(yr), label: String(yr), sort: false,
      render: r => el('span', {}, cell(r.name, String(yr))) }))], names.map(name => ({ name })), { empty: 'No bank holidays in these years' }));
    const edit = grid({ table: 'bank_holiday', key: 'date', save: pkSave('bank_holiday', 'date'),
      rows: rows.filter(r => r.date.startsWith(String(y))),
      cols: [{ k: 'date', label: 'Date', type: 'date', required: true },
             { k: '_d', label: '', render: r => el('span', { class: 'muted' }, dow(r.date)) },
             { k: 'name', label: 'Name', required: true }],
      draft: {}, onChange: () => { ctx.changed('bank_holiday'); ctx.refresh(); },
      onSaved: () => ctx.changed('bank_holiday') });
    body.append(el('details', { style: 'margin-top:10px' }, el('summary', {}, `Change ${y}'s bank holidays`), edit));
  } },

  'holidays.year': { title: 'Year', w: 12, deps: ['leave', 'bank_holiday', 'shift'], async render(body, ctx) {
    const y = holYear();
    const [days, leave, bank] = await Promise.all([
      api.view('v_day', { date__gte: `${y}-01-01`, date__lte: `${y}-12-31` }),
      api.table('leave', { to_date__gte: `${y}-01-01`, from_date__lte: `${y}-12-31` }),
      api.table('bank_holiday', { date__gte: `${y}-01-01`, date__lte: `${y}-12-31` })]);
    ctx.setTitle(`Year · ${y}`);
    body.append(yearCalendar(y, {
      worked: Object.fromEntries(days.map(d => [d.date, d.hours])), off: leaveDates(leave),
      bank: Object.fromEntries(bank.map(b => [b.date, b.name])),
      onPick: d => ctx.go('hours', { p: `month:${d}`, add: d }) }),
      el('div', { class: 'key' },
        el('span', {}, el('i', { style: 'background:var(--seq-2)' }), 'worked'),
        el('span', {}, el('i', { style: 'background:var(--leave-soft);border-color:var(--leave)' }), 'day off'),
        el('span', {}, el('i', { style: 'background:var(--bh-soft);border-color:var(--flag)' }), 'bank holiday')));
  } },

  'holidays.upcoming': { title: 'Coming up', w: 3, deps: ['leave', 'bank_holiday'], async render(body) {
    const t = today();
    const [bank, leave] = await Promise.all([
      api.table('bank_holiday', { date__gte: t, order: 'date', limit: 4 }),
      api.table('leave', { to_date__gte: t, order: 'from_date', limit: 4 })]);
    const rows = [...bank.map(b => ({ date: b.date, what: b.name })),
                  ...leave.map(l => ({ date: l.from_date, what: l.note || `${KINDS.find(k => k.v === l.kind)?.label || 'Day off'} (${plain(l.days)})` }))]
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
    body.append(table([{ k: 'date', label: 'Date', fmt: dayLong }, { k: 'what', label: '' }], rows, { empty: 'Nothing booked' }));
  } },
};

export const layout = [
  { use: 'holidays.allowance', w: 3 },
  { use: 'holidays.toil', w: 3 },
  { use: 'holidays.years', w: 6 },
  { use: 'holidays.days', w: 6 },
  { use: 'holidays.bank', w: 6 },
  { use: 'holidays.year' },
];
