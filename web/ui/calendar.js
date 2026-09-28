// A month of days shaded by hours worked, with days off and bank holidays
// marked. One hue, light to dark, in five steps.
import { el } from '../core/dom.js';
import { addDays, iso, today, monthOnly, lastDay } from '../core/format.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmtH = h => (Math.round(h * 100) / 100).toString();

export function band(hours, full = 8.5) {
  if (!hours) return 0;
  const r = hours / (full || 8.5);
  return r <= 0.55 ? 1 : r <= 0.9 ? 2 : r <= 1.02 ? 3 : r <= 1.3 ? 4 : 5;
}

/** Every date covered by a day-off row, weekends included (the calendar greys those anyway). */
export function leaveDates(leave) {
  const out = {};
  for (const l of leave) for (let d = l.from_date; d <= l.to_date; d = addDays(d, 1)) out[d] = l.note || 'Day off';
  return out;
}

/** calendar({month, days, rules, bank:{date:name}, off:{date:note}, dots:{date:count}, onPick, picked})
 *  days shade a date by hours worked (Money); dots mark how much was logged on it (Log). */
export function calendar({ month, days = [], onPick, rules = [], bank = {}, off = {}, dots = {}, picked }) {
  const byDate = Object.fromEntries(days.map(d => [d.date, d]));
  const normalFor = dow => (rules.find(r => r.dow === dow) || {}).normal_hours ?? 8.5;
  const first = new Date(month + '-01T12:00:00Z');
  const start = addDays(iso(first), -((first.getUTCDay() + 6) % 7));
  const grid = el('div', { class: 'cal' });
  DOW.forEach(d => grid.append(el('div', { class: 'dow' }, d)));
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    if (i >= 35 && !date.startsWith(month)) break;
    const dow = new Date(date + 'T12:00:00Z').getUTCDay();
    const normal = normalFor(dow);
    const d = byDate[date];
    const lvl = d ? band(d.hours, normal || 8.5) : 0;
    const cls = ['day', date.startsWith(month) ? '' : 'out', date === today() ? 'today' : '',
      normal === 0 ? 'wk' : '', lvl ? 'l' + lvl : '', off[date] ? 'off' : '', bank[date] ? 'bh' : '',
      picked === date ? 'pick' : ''].filter(Boolean).join(' ');
    grid.append(el('button', {
      type: 'button', class: cls, onclick: () => onPick && onPick(date, d),
      'aria-label': `${date}${d ? `, ${d.hours} hours` : ''}${dots[date] ? `, ${dots[date]} logged` : ''}${bank[date] ? ', ' + bank[date] : ''}${off[date] ? ', day off' : ''}`,
    },
      el('span', { class: 'd' }, String(+date.slice(8))),
      d ? el('span', { class: 'h' }, fmtH(d.hours)) : null,
      d && d.ot_hours > 0 ? el('span', { class: 'ot' }, `+${fmtH(d.ot_hours)} ×${d.ot_mult}`) : null,
      dots[date] ? el('span', { class: 'dots', title: `${dots[date]} logged` }, '•'.repeat(Math.min(dots[date], 5))) : null,
      bank[date] ? el('span', { class: 'tag' }, bank[date]) : off[date] ? el('span', { class: 'tag' }, off[date]) : null));
  }
  return grid;
}

export function key(full = 8.5) {
  return el('div', { class: 'key' },
    el('span', {}, 'hours'), [1, 2, 3, 4, 5].map(n => el('i', { style: `background:var(--seq-${n})` })),
    el('span', {}, el('i', { style: 'background:repeating-linear-gradient(135deg,var(--leave-soft) 0 4px,transparent 4px 7px);border-color:var(--leave)' }), 'day off'),
    el('span', {}, el('i', { style: 'background:var(--bh-soft);border-color:var(--flag)' }), 'bank holiday'),
    el('span', {}, `full day ${full}h`));
}

/** Twelve small months: worked, off, bank holiday at a glance. */
export function yearCalendar(year, { worked = {}, off = {}, bank = {}, onPick } = {}) {
  const box = el('div', { class: 'year' });
  for (let m = 1; m <= 12; m++) {
    const mm = `${year}-${String(m).padStart(2, '0')}`;
    const first = new Date(mm + '-01T12:00:00Z');
    const lead = (first.getUTCDay() + 6) % 7;
    const cells = [...Array(lead)].map(() => el('span'));
    for (let d = mm + '-01'; d <= lastDay(mm); d = addDays(d, 1)) {
      const wd = new Date(d + 'T12:00:00Z').getUTCDay();
      const c = off[d] ? 'off' : bank[d] ? 'bh' : worked[d] ? 'w' : '';
      cells.push(el('span', { class: [c, wd === 0 || wd === 6 ? 'we' : ''].join(' ').trim() || null,
        title: [d, bank[d], off[d], worked[d] ? worked[d] + 'h' : ''].filter(Boolean).join(' · '),
        onclick: onPick ? () => onPick(d) : null }, String(+d.slice(8))));
    }
    box.append(el('div', {}, el('h4', {}, monthOnly(mm)), el('div', { class: 'm' }, cells)));
  }
  return box;
}
