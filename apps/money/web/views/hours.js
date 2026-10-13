import { api } from '../api.js';
import { el, flash, tiles, tile, table, download, dialog } from '../core/dom.js';
import { hrs, hhmm, money, today, dow, dateUK, span, addMonths, monthOnly, dayShort, lastDay,
         mondayOf, addDays, usualTimes } from '../core/format.js';
import { extraCols, setting, settingsForm } from '../core/state.js';
import { calendar, key, leaveDates } from '../ui/calendar.js';
import { grid } from '../ui/grid.js';
import { state } from '../core/state.js';

export const title = 'Hours';

// One hue per month, like the old sheet: Jan light blue ... Dec cyan.
export const MONTH_HUE = [[212, 60], [199, 60], [54, 85], [130, 45], [22, 70], [42, 90],
                          [300, 45], [140, 45], [200, 70], [0, 0], [355, 70], [186, 65]];

let focusNext = null;

/** The day in Log, by date: the diary and work entries for it live there. */
const dayLog = date => el('a', { class: 'link small', href: `/log/#/day?d=${date}` }, 'Log');

export const panels = {
  'hours.tiles': { title: 'This period', w: 12, deps: ['shift'], async render(body, ctx) {
    const p = ctx.period;
    const days = await api.view('v_day_paid', { date__gte: p.from, date__lte: p.to });
    const sum = (k, f = () => true) => days.filter(f).reduce((a, d) => a + (d[k] || 0), 0);
    body.classList.add('flush');
    body.append(tiles(
      tile('Hours', hrs(sum('hours')), `${days.length} days worked`),
      tile('Normal', hrs(sum('normal_hours'))),
      tile('Overtime ×1.5', hrs(sum('ot_hours', d => d.ot_mult < 2))),
      tile('Overtime ×2', hrs(sum('ot_hours', d => d.ot_mult >= 2))),
      tile('Paid hours', hrs(sum('paid_hours'))),
      tile('Overtime pay', money(sum('ot_pay'))),
      tile('Bank holidays worked', String(days.filter(d => d.bank_holiday).length))));
  } },

  'hours.calendar': { title: 'Calendar', w: 5, deps: ['shift', 'leave', 'bank_holiday'], async render(body, ctx) {
    const month = ctx.period.month;
    const from = month + '-01', to = lastDay(month);
    const [days, rules, bank, leave] = await Promise.all([
      api.view('v_day', { month }), api.table('day_rule'),
      api.table('bank_holiday', { date__gte: from, date__lte: to }),
      api.table('leave', { to_date__gte: from, from_date__lte: to })]);
    ctx.setTitle(`Calendar · ${monthOnly(month)}`);
    body.append(calendar({ month, days, rules, picked: ctx.params.add === 'today' ? today() : ctx.params.add,
      bank: Object.fromEntries(bank.map(b => [b.date, b.name])), off: leaveDates(leave),
      onPick: date => ctx.go('hours', { add: date }) }), key(rules.find(r => r.dow === 1)?.normal_hours || 8.5));
  } },

  'hours.timesheet': { title: 'Timesheet', w: 7, deps: ['shift'], async render(body, ctx) {
    const p = ctx.period;
    const [shifts, days, recent] = await Promise.all([
      api.table('shift', { date__gte: p.from, date__lte: p.to, order: 'date', limit: 2000 }),
      api.view('v_day', { date__gte: p.from, date__lte: p.to }),
      api.table('shift', { date__gte: addDays(today(), -30), date__lte: today(), order: 'date', desc: 1 })]);
    const usual = usualTimes(recent);          // your usual day in the last 30: the new row's grey times
    const hasLog = state.meta.apps.some(a => a.name === 'log');
    shifts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const byDay = Object.fromEntries(days.map(d => [d.date, d]));
    const lastOfDay = new Set(shifts.map((s, i) => shifts[i + 1]?.date !== s.date ? s.id : null));
    const weekIdx = {};
    for (const s of shifts) weekIdx[mondayOf(s.date)] ??= Object.keys(weekIdx).length;
    const addDate = ctx.params.add === 'today' ? today() : ctx.params.add;
    const inPeriod = d => d && d >= p.from && d <= p.to;
    const draftDate = focusNext?.date || (inPeriod(addDate) && addDate)
      || (shifts.length ? shifts[shifts.length - 1].date : inPeriod(today()) ? today() : p.from);
    const g = grid({
      table: 'shift', rows: shifts, scroll: 'tall',
      rowClass: s => (weekIdx[mondayOf(s.date)] % 2 ? 'band' : '') + (s.date === addDate ? ' sel' : ''),
      cols: [
        { k: 'date', label: 'Date', type: 'date', required: true, width: '140px' },
        { k: '_dow', label: 'Day', render: s => el('span', { class: 'muted' }, dow(s.date)), draftText: '' },
        { k: 'start', label: 'Started', type: 'time', required: true, width: '80px', usual: usual.start },
        { k: 'end', label: 'Finished', type: 'time', required: true, width: '80px', usual: usual.end },
        { k: '_h', label: 'Hours', n: true, render: s => el('span', { class: 'num' }, hhmm(span(s.start, s.end))) },
        { k: '_d', label: 'Day total', n: true, render: s => lastOfDay.has(s.id) && byDay[s.date]
            ? el('strong', { class: 'num' }, hhmm(byDay[s.date].hours)) : '' },
        { k: '_ot', label: 'Overtime', n: true, render: s => {
            const d = lastOfDay.has(s.id) && byDay[s.date];
            return d && d.ot_hours > 0 ? el('span', { class: 'num', style: 'color:var(--flag)' },
              `${hhmm(d.ot_hours)} ×${d.ot_mult}`) : ''; } },
        { k: 'note', label: 'Notes', type: 'text' },
        ...(hasLog ? [{ k: '_log', label: 'Log', draftText: '', render: s => lastOfDay.has(s.id) ? dayLog(s.date) : '' }] : []),
        ...extraCols('shift'),
      ],
      draft: { date: draftDate, source: 'manual' }, focus: focusNext || ctx.params.add ? 1 : 0,
      // right-click on a shift
      menu: s => {
        const again = async date => { await api.save('shift', { date, start: s.start, end: s.end, project: s.project });
          flash(`Same shift added on ${dateUK(date)}`, { label: 'Undo', fn: async () => { await api.undo(); ctx.changed('shift'); ctx.refresh(); } });
          ctx.changed('shift'); ctx.refresh(); };
        return [...(hasLog ? [{ label: 'Open this day in Log', fn: () => { location.href = `/log/#/day?d=${s.date}`; } }] : []),
                { label: `Same shift today (${s.start}–${s.end})`, fn: () => again(today()) },
                { label: 'Same shift the next day', fn: () => again(addDays(s.date, 1)) }, '-'];
      },
      onSaved: () => { ctx.changed('shift'); ctx.refresh(); },
      add: async row => { await api.save('shift', row); focusNext = { date: row.date }; },
      onChange: () => { ctx.changed('shift'); ctx.refresh(); },
    });
    const tot = days.reduce((a, d) => a + d.hours, 0);
    ctx.aside.append(el('span', { class: 'num muted' }, `${shifts.length} shifts · ${hhmm(tot)}`));
    body.append(g);
    // on a phone, + Hours is a small form (the grid is for a keyboard); on a computer, the grid's new row
    if (ctx.params.add && matchMedia('(max-width: 600px)').matches) { if (/[?&]add=/.test(location.hash)) addHours(addDate || today(), usual, ctx); }
    else if (focusNext || ctx.params.add) queueMicrotask(() => g.focusDraft?.());
    focusNext = null;
  } },

  'hours.periods': { title: 'Pay periods', w: 12, deps: ['shift', 'payslip'], async render(body, ctx) {
    const y = ctx.period.year;
    const payday = +setting('payday', 17);
    const [rows, slips] = await Promise.all([
      api.view('v_month_hours', { month__gte: `${y}-01`, month__lte: `${y}-12` }),
      api.view('v_payslip', { worked_month__gte: `${y}-01`, worked_month__lte: `${y}-12` })]);
    const by = Object.fromEntries(rows.map(r => [r.month, r]));
    const slip = Object.fromEntries(slips.map(s => [s.worked_month, s]));
    ctx.setTitle(`Pay periods · ${y}`);
    const card = (m, h, s, cls, head, sub) => el('div', { class: 'pp ' + (cls || ''),
        style: m ? `--h:${MONTH_HUE[+m.slice(5) - 1][0]};--sat:${MONTH_HUE[+m.slice(5) - 1][1]}%` : null,
        onclick: m ? () => ctx.go('hours', { p: `month:${m}-01` }) : null },
      el('header', {}, head, el('span', {}, sub)),
      el('div', { class: 'f' },
        el('div', {}, el('div', { class: 'k' }, 'Hours'), el('div', { class: 'v' }, h?.hours ? h.hours.toFixed(2) : '—')),
        el('div', {}, el('div', { class: 'k' }, 'Overtime'), el('div', { class: 'v' }, h?.ot_hours ? h.ot_hours.toFixed(2) : '—')),
        el('div', {}, el('div', { class: 'k' }, 'Gross'), el('div', { class: 'v' }, s?.gross ? money(s.gross) : '—')),
        el('div', {}, el('div', { class: 'k' }, 'Net'), el('div', { class: 'v' }, s?.net ? money(s.net) : '—'))));
    const cards = [];
    for (let i = 1; i <= 12; i++) {
      const m = `${y}-${String(i).padStart(2, '0')}`;
      const s = slip[m];
      const paid = s ? s.pay_date : `${addMonths(m, 1)}-${String(Math.min(payday, 28)).padStart(2, '0')}`;
      cards.push(card(m, by[m], s, m === ctx.period.month ? 'now' : '', monthOnly(m),
        `${s ? 'paid' : 'due'} ${dayShort(paid)}`));
    }
    const t = k => rows.reduce((a, r) => a + (r[k] || 0), 0), ts = k => slips.reduce((a, r) => a + (r[k] || 0), 0);
    cards.push(card(null, { hours: t('hours'), ot_hours: t('ot_hours') }, { gross: ts('gross'), net: ts('net') },
      'total', `Year ${y}`, `${slips.length} payslips`));
    body.append(el('div', { class: 'periods' }, cards));
  } },

  // The month for HR, as it goes in the body of an email: Date, Start, Finish, Overtime, each week its own colour.
  // Its own month (the last full one unless you pick), not the page's: it is sent after the month ends.
  'hours.hr': { title: 'Send to HR', w: 6, deps: ['shift', 'setting'], async render(body, ctx) {
    const pick = el('input', { type: 'month', value: addMonths(today().slice(0, 7), -1), 'aria-label': 'Month for HR' });
    const out = el('div');
    const show = async () => {
      const month = pick.value;
      if (!month) return;
      const sheet = await api.hrSheet(month);
      const preview = el('div', { class: 'scroll hr-sheet' });
      preview.innerHTML = sheet.html;                    // built by the server, every value escaped there
      // Copy as table: HTML (Outlook keeps the colours) with tab-separated text beside it (Excel, plain mail)
      const copy = async () => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([sheet.html], { type: 'text/html' }),
                                                               'text/plain': new Blob([sheet.tsv], { type: 'text/plain' }) })]);
        } catch {                                         // no clipboard API (Daybook over plain http): copy the table on screen
          const r = document.createRange(); r.selectNode(preview.firstElementChild);
          getSelection().removeAllRanges(); getSelection().addRange(r);
          const ok = document.execCommand('copy'); getSelection().removeAllRanges();
          if (!ok) return flash('The browser blocked copying: use the email draft or the CSV');
        }
        flash('Copied. Paste it into the email to HR.');
      };
      out.replaceChildren(
        el('div', { class: 'row mid' },
          el('button', { class: 'btn sm', type: 'button', onclick: copy }, 'Copy as table'),
          el('a', { class: 'btn plain sm', href: api.hrEmail(month), download: `hours-${month}.eml`,
            title: 'An unsent email with the table in it: Outlook opens it as a draft to send' }, 'Open as Outlook draft'),
          el('button', { class: 'btn plain sm', type: 'button', onclick: () => download(`hours-${month}.csv`, sheet.csv) }, 'CSV')),
        sheet.table.length > 2 ? preview : el('p', { class: 'muted' }, `No shifts in ${monthOnly(month)}.`));
    };
    pick.addEventListener('change', show);
    ctx.aside.append(pick);
    body.append(out, el('details', { class: 'small' }, el('summary', {}, 'HR’s email address (for the draft)'),
      settingsForm([['hr_email', 'To', 'text']], ctx)));
    await show();
  } },

  'hours.import': { title: 'Import hours', w: 6, render(body, ctx) {
    const file = el('input', { type: 'file', accept: '.csv,text/csv' });
    const replace = el('input', { type: 'checkbox' });
    const out = el('div');
    let text = null, name = null;
    const preview = async () => {
      if (!text) return;
      out.innerHTML = '';
      try {
        const plan = await api.hoursPlan({ files: [{ name, text }] });
        out.append(
          el('div', { class: 'row mid', style: 'margin:8px 0' },
            el('span', { class: 'chip on' }, plan.source === 'clockify' ? 'Clockify' : 'Spreadsheet'),
            el('strong', {}, `${plan.count} shifts`), el('span', { class: 'num' }, hrs(plan.total_hours)),
            el('span', { class: 'muted num' }, `${plan.from_date || ''} → ${plan.to_date || ''}`),
            plan.skipped ? el('span', { class: 'muted' }, `${plan.skipped} rows skipped`) : null,
            plan.assumed_times.length ? el('span', { class: 'chip warn' }, `${plan.assumed_times.length} without times, set to 09:00`) : null),
          table([{ k: 'date' }, { k: 'start', label: 'Started' }, { k: 'end', label: 'Finished' },
                 { k: 'project', label: 'Job' }, { k: 'note', label: 'Notes' }], plan.sample),
          el('div', { class: 'row', style: 'margin-top:8px' }, el('button', { class: 'btn', disabled: !plan.count, onclick: async e => {
            e.target.disabled = true;
            try {
              const r = await api.hoursCommit({ files: [{ name, text }], replace: replace.checked });
              flash(`${r.added} added, ${r.updated} updated`, { label: 'Undo', fn: async () => { await api.undo(); ctx.reload(); } });
              ctx.changed('shift'); ctx.reload();
            } catch (ex) { e.target.disabled = false; flash(ex.message); }
          } }, `Import ${plan.count} shifts`)));
      } catch (e) { out.append(el('p', { class: 'err' }, e.message)); }
    };
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      text = await f.text(); name = f.name; preview();
    });
    body.append(el('div', { class: 'row mid' }, file,
      el('label', { class: 'c' }, replace, 'Replace imported shifts in that range')),
      el('p', { class: 'note' }, 'Clockify CSV export, or a sheet with Date, Started and Finished columns.'), out);
  } },
};

export const layout = [
  { use: 'hours.tiles' },
  { use: 'hours.calendar', w: 5 },
  { use: 'hours.timesheet', w: 7 },
  { use: 'hours.hr', w: 6 },
  { use: 'hours.import', w: 6 },
  { use: 'hours.periods' },
  { type: 'chart', id: 'hours-week', title: 'Hours worked', w: 6, source: 'v_day', date: 'date', x: 'date',
    y: ['normal_hours', 'ot_hours'], names: { normal_hours: 'Normal', ot_hours: 'Overtime' },
    chart: 'stacked', grain: 'week', window: '12m', fmt: 'hours' },
  { type: 'chart', id: 'hours-ot', title: 'Overtime by rate', w: 6, source: 'v_day', date: 'date', x: 'date',
    y: ['ot_hours'], split: 'ot_mult', names: { 1.5: '×1.5', 2: '×2' }, chart: 'bar', grain: 'month', window: '12m', fmt: 'hours' },
];

/** A shift, from a phone: the date and your usual times filled in, a big Add. The ?add= leaves the address
 *  once it is open, so a refresh does not ask again. */
let adding = false;
function addHours(date, usual, ctx) {
  if (adding) return;
  adding = true;
  history.replaceState(null, '', location.href.replace(/([?&])add=[^&]*&?/, '$1').replace(/[?&]$/, ''));
  const day = el('input', { type: 'date', value: date }), start = el('input', { type: 'time', value: usual.start || '' });
  const end = el('input', { type: 'time', value: usual.end || '' }), note = el('input', { type: 'text', placeholder: 'Note (optional)' });
  const d = dialog('Add hours', el('div', { class: 'addhours' },
    el('label', { class: 'f' }, 'Date', day),
    el('div', { class: 'row' }, el('label', { class: 'f' }, 'Started', start), el('label', { class: 'f' }, 'Finished', end)),
    el('label', { class: 'f' }, 'Note', note)), [{ label: 'Add', fn: async () => {
      if (!day.value || !start.value || !end.value) { flash('A date, a start and a finish'); return false; }
      // the same shift twice (a second tap, a forgotten earlier entry) would double the hours
      const mins = t => +t.slice(0, 2) * 60 + +t.slice(3, 5), a = mins(start.value), b = mins(end.value) <= a ? mins(end.value) + 1440 : mins(end.value);
      const clash = (await api.table('shift', { date: day.value }).catch(() => [])).find(x => {
        const xa = mins(x.start), xb = mins(x.end) <= xa ? mins(x.end) + 1440 : mins(x.end);
        return a < xb && xa < b;
      });
      if (clash) { flash(`That overlaps ${clash.start}–${clash.end}, already on ${dateUK(day.value)}: change the times, or edit that one in the timesheet.`); return false; }
      try { await api.save('shift', { date: day.value, start: start.value, end: end.value, note: note.value.trim() || null, source: 'manual' }); }
      catch (x) { flash(x.message); return false; }
      flash(`Added ${start.value}–${end.value} on ${dateUK(day.value)}`, { label: 'Undo', fn: async () => { await api.undo(); ctx.changed('shift'); ctx.refresh(); } });
      ctx.changed('shift'); ctx.refresh();
    } }]);
  d.addEventListener('close', () => { adding = false; });
}
