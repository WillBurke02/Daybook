import { api } from '../api.js';
import { el, flash, tiles, tile, select } from '../core/dom.js';
import { money, hrs, monthOnly, monthLong, dayLong, taxYearLabel, taxYearOf, plain, toNumber, grouped, today, addMonths } from '../core/format.js';
import { extraCols, setting, settingsForm } from '../core/state.js';
import { grid } from '../ui/grid.js';

export const title = 'Pay';

const GROUPS = [['pay', 'Payments'], ['deduction', 'Deductions'], ['employer', 'Employer'], ['ytd', 'Year to date']];
// What a line counts as in the totals. The label is free text; this is what the sums use.
const CODES = {
  pay: [['', 'Other pay'], ['basic', 'Basic'], ['ot15', 'Overtime ×1.5'], ['ot2', 'Overtime ×2'], ['bonus', 'Bonus']],
  deduction: [['', 'Other'], ['tax', 'Tax'], ['ni', 'NI'], ['pension', 'Pension'], ['student_loan', 'Student loan']],
  employer: [['', 'Other'], ['er_ni', 'Employer NI'], ['er_pension', 'Employer pension']],
};

/** Saving a changed key (a date that is the row's identity) is add-new then remove-old. */
export const pkSave = (table, key) => async (row, patch) => {
  if (key in patch && patch[key] !== row[key]) {
    const next = { ...row, ...patch };
    for (const k of Object.keys(next)) if (k.startsWith('_')) delete next[k];
    await api.save(table, next);
    await api.remove(table, row[key]);
  } else await api.save(table, { [key]: row[key], ...patch });
};

async function which(ctx) {
  if (ctx.params.new) return null;
  if (ctx.params.slip) return ctx.params.slip;
  const last = await api.table('payslip', { order: 'pay_date', desc: 1, limit: 1 });
  return last[0]?.pay_date || null;
}

// A payslip being typed and not yet saved: leaving it asks first.
let unsaved = false;
const leave = () => !unsaved || confirm('This payslip has changes that are not saved. Leave it anyway?');
addEventListener('beforeunload', e => { if (unsaved) e.preventDefault(); });
const monthBefore = d => addMonths(d.slice(0, 7), -1);

export const panels = {
  'pay.list': { title: 'Payslips', w: 3, deps: ['payslip', 'p60'], async render(body, ctx) {
    const [slips, shown, p60] = await Promise.all([api.view('v_payslip', { order: 'pay_date', desc: 1 }), which(ctx), api.table('p60')]);
    const p60s = new Set(p60.map(r => r.tax_year));
    ctx.aside.append(el('button', { class: 'btn sm', type: 'button', onclick: () => { if (leave()) { unsaved = false; ctx.go('pay', { new: 1 }); } } }, '+ New'));
    const box = el('div', { class: 'sliplist' });
    if (!shown) box.append(el('button', { class: 'on new', type: 'button' }, el('span', {}, 'New payslip', el('br'), el('span', { class: 'muted' }, 'not saved yet')), el('span')));
    let ty = null;
    for (const s of slips) {
      if (s.tax_year !== ty) {
        ty = s.tax_year;
        const has = p60s.has(ty), y = ty;
        box.append(el('div', { class: 'ty' }, `Tax year ${taxYearLabel(ty)}`,
          el('a', { class: 'p60chip' + (has ? ' has' : ''), href: `#/pay?ty=${y}&panel=pay.p60`, title: has ? 'The P60 for this year' : 'No P60 typed in for this year' }, 'P60')));
      }
      box.append(el('button', { class: s.pay_date === shown ? 'on' : null, type: 'button',
        onclick: () => { if (s.pay_date !== shown && leave()) { unsaved = false; ctx.go('pay', { slip: s.pay_date }); } } },
        el('span', {}, `${dayLong(s.pay_date)}`, el('br'), el('span', { class: 'muted' }, s.worked_month ? `${monthOnly(s.worked_month)} hours` : '')),
        el('span', {}, money(s.net))));
    }
    if (!slips.length) box.append(el('p', { class: 'note' }, 'No payslips yet.'));
    body.append(box);
  } },

  // A new payslip starts from the last one's lines, empty. Basic pay and the overtime
  // rates show as grey hints worked out from your salary; a box left empty saves its
  // hint. Enter goes to the next box; Ctrl+S saves.
  'pay.slip': { title: 'Payslip', w: 6, lead: true, deps: ['pay_rate'], async render(body, ctx) {
    const date = await which(ctx);
    const [data, taken] = await Promise.all([date ? api.payslip(date) : api.payslipTemplate(),
                                             api.table('payslip', { order: 'pay_date' })]);
    const isNew = !date;
    const head = { ...data.payslip };
    const lines = data.lines.map(l => ({ ...l }));
    const was = date;
    let workedByHand = false;
    unsaved = false;
    const strip = el('div', { class: 'slipstate ' + (isNew ? 'new' : 'saved') });
    const saveBtns = [];
    const state_ = () => {
      const clash = isNew && taken.some(t => t.pay_date === head.pay_date);
      strip.replaceChildren(
        el('span', { class: 'badge' }, isNew ? 'New' : 'Saved'),
        el('strong', {}, isNew ? 'Payslip not saved yet' : `Payslip paid ${dayLong(was)}`),
        el('span', {}, clash ? el('span', { class: 'deb' }, 'There is already a payslip on this date. ',
            el('a', { href: `#/pay?slip=${head.pay_date}` }, 'Open that one'), ' or change the pay date.')
          : isNew ? 'Grey figures are worked out from your salary; left as they are, they are what is saved.'
          : unsaved ? el('span', { class: 'warn' }, 'Changes not saved yet') : 'Changing anything here changes this payslip.'));
      for (const b of saveBtns) { b.textContent = isNew ? 'Save new payslip' : 'Save changes'; b.disabled = clash || (!isNew && !unsaved); }
    };
    const mark = () => { unsaved = true; state_(); totals(); };
    const sums = {};
    const totalEls = {};
    const foot = { gross: el('div', { class: 'v' }), ded: el('div', { class: 'v' }), net: el('div', { class: 'v' }) };
    const eff = (l, k) => toNumber(l[k]) ?? l.hint?.[k] ?? null;          // what you typed, else its hint
    const totals = () => {
      for (const [g] of GROUPS) {
        sums[g] = lines.filter(l => l.grp === g).reduce((a, l) => a + (eff(l, 'amount') || 0), 0);
        if (totalEls[g]) totalEls[g].textContent = money(sums[g]);
      }
      foot.gross.textContent = money(sums.pay);
      foot.ded.textContent = money(sums.deduction);
      foot.net.textContent = money(sums.pay - sums.deduction);
    };
    const slip = el('div', { class: 'slip' });
    // Enter: the next box (descriptions and pickers are for Tab); from the last box, Save.
    const next = i => {
      const all = [...slip.querySelectorAll('input[data-step]')];
      const n = all[all.indexOf(i) + 1];
      if (n) { n.focus(); n.select?.(); } else saveBtns.at(-1)?.focus();
    };
    const inp = (obj, k, attrs = {}, step = true) => {
      const i = el('input', { value: obj[k] ?? '', ...attrs });
      if (step) i.dataset.step = '';
      i.addEventListener('input', () => { obj[k] = i.value; mark(); });
      i.addEventListener('focus', () => i.select?.());
      i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); next(i); } });
      return i;
    };
    const cols = el('div', { class: 'cols' });
    const codeSel = l => {
      const s = select(CODES[l.grp].map(([v, label]) => ({ v, label })), l.code || '', { 'aria-label': 'Counts as', class: 'code', tabindex: '-1' });
      s.addEventListener('change', () => { l.code = s.value || null; mark(); });
      return s;
    };
    const hintText = v => v == null ? '' : grouped(v);
    const drawGroup = (g, label, host) => {
      const tb = el('tbody');
      for (const l of lines.filter(x => x.grp === g)) {
        // Commas are thousands, as written on the slip: 24,000 is twenty-four thousand.
        const amount = inp({ amount: l.amount == null ? '' : grouped(l.amount) }, 'amount',
          { inputmode: 'decimal', 'aria-label': `${l.label || 'Line'} amount`, placeholder: hintText(l.hint?.amount) });
        amount.addEventListener('input', () => { l.amount = amount.value; totals(); });
        amount.addEventListener('change', () => { if (amount.value) amount.value = grouped(amount.value); });
        // Units x Rate (typed, or its hint) fills Amount; typing in Amount afterwards wins.
        const calc = () => {
          const q = toNumber(l.qty), r = eff(l, 'rate');
          if (q != null && r != null) { l.amount = Math.round(q * r * 100) / 100; amount.value = grouped(l.amount); totals(); }
        };
        const qty = inp(l, 'qty', { inputmode: 'decimal', 'aria-label': `${l.label || 'Line'} units` });
        const rate = inp(l, 'rate', { inputmode: 'decimal', 'aria-label': `${l.label || 'Line'} rate`, placeholder: hintText(l.hint?.rate) });
        qty.addEventListener('input', calc); rate.addEventListener('input', calc);
        tb.append(el('tr', {},
          el('td', { style: 'min-width:130px' }, inp(l, 'label', { 'aria-label': 'Description', class: 'desc' }, !l.label)),
          CODES[g] ? el('td', { style: 'width:104px' }, codeSel(l)) : null,
          g === 'pay' ? el('td', { class: 'n', style: 'width:58px' }, qty) : null,
          g === 'pay' ? el('td', { class: 'n', style: 'width:66px' }, rate) : null,
          el('td', { class: 'n', style: 'width:92px' }, amount),
          el('td', { class: 'x' }, el('button', { class: 'icon del', type: 'button', title: 'Remove line', tabindex: '-1',
            onclick: () => { lines.splice(lines.indexOf(l), 1); mark(); redraw(); } }, '×'))));
      }
      totalEls[g] = el('span', { class: 'num' });
      host.append(el('div', { class: 'col' },
        el('h3', {}, label, totalEls[g]),
        el('div', { class: 'scroll' }, el('table', { class: 'g' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Description'), CODES[g] ? el('th', {}, 'Counts as') : null, g === 'pay' ? [el('th', { class: 'n' }, 'Units'), el('th', { class: 'n' }, 'Rate')] : null,
            el('th', { class: 'n' }, 'Amount'), el('th'))), tb)),
        el('button', { class: 'link', type: 'button', tabindex: '-1', onclick: () => {
          lines.push({ grp: g, label: '', amount: '', code: null }); mark(); redraw();
          cols.querySelectorAll(`.col`)[GROUPS.findIndex(x => x[0] === g)]?.querySelector('tbody tr:last-child input')?.focus();
        } }, '+ line')));
    };
    const ytd = el('div', { class: 'ytd' });
    const redraw = () => {
      cols.innerHTML = ''; ytd.innerHTML = '';
      for (const [g, label] of GROUPS.slice(0, 3)) drawGroup(g, label, cols);
      drawGroup('ytd', 'Year to date', ytd);
      totals();
    };
    const save = async () => {
      try {
        // a rate's hint is only kept where there are units for it
        const out = lines.map(l => ({ ...l, rate: toNumber(l.rate) ?? (toNumber(l.qty) != null ? l.hint?.rate : null) ?? null, amount: eff(l, 'amount') }));
        const r = await api.savePayslip({ ...head, was, new: isNew, lines: out });
        unsaved = false;
        flash(isNew ? 'New payslip saved' : 'Payslip changes saved', { label: 'Undo', fn: async () => { await api.undo(); ctx.reload(); } });
        ctx.changed('payslip');
        ctx.go('pay', { slip: r.payslip.pay_date });
      } catch (e) { flash(e.message); }
    };
    const saveBtn = () => { const b = el('button', { class: 'btn sm', type: 'button', onclick: save }); saveBtns.push(b); return b; };
    ctx.setTitle(isNew ? 'New payslip' : `Payslip · ${dayLong(date)}`);
    ctx.aside.append(saveBtn(),
      date ? el('button', { class: 'btn danger sm', type: 'button', onclick: async () => {
        await api.remove('payslip', date);
        unsaved = false;
        flash('Payslip deleted', { label: 'Undo', fn: async () => { await api.undo(); ctx.go('pay', { slip: date }); } });
        ctx.changed('payslip'); ctx.go('pay', {});
      } }, 'Delete') : null);
    const employer = setting('employer', '');
    const payDate = inp(head, 'pay_date', { type: 'date' }), worked = inp(head, 'worked_month', { type: 'month' });
    // the hours are the month before the pay date, until you say otherwise
    payDate.addEventListener('input', () => {
      if (!workedByHand && /^\d{4}-\d\d/.test(head.pay_date || '')) { head.worked_month = monthBefore(head.pay_date); worked.value = head.worked_month; }
      state_();
    });
    worked.addEventListener('input', () => { workedByHand = true; });
    slip.append(strip,
      el('div', { class: 'head' },
        employer ? el('strong', { class: 'employer' }, employer) : null,
        el('label', { class: 'f' }, 'Pay date', payDate),
        el('label', { class: 'f' }, 'Hours worked in', worked),
        el('label', { class: 'f' }, 'Tax code', inp(head, 'tax_code', { style: 'width:90px' })),
        el('label', { class: 'f' }, 'NI letter', inp(head, 'ni_letter', { style: 'width:60px' })),
        el('label', { class: 'f', style: 'flex:1;min-width:140px' }, 'Note', inp(head, 'note'))),
      cols,
      el('div', { class: 'foot' },
        el('div', {}, el('div', { class: 'eyebrow' }, 'Gross pay'), foot.gross),
        el('div', {}, el('div', { class: 'eyebrow' }, 'Deductions'), foot.ded),
        el('div', {}, el('div', { class: 'eyebrow' }, 'Net pay'), foot.net)),
      ytd,
      el('div', { class: 'slipsave' }, saveBtn()));
    body.append(slip);
    redraw();
    state_();
    body.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } });
  } },

  'pay.expected': { title: 'Expected', w: 3, deps: ['payslip', 'shift'], async render(body, ctx) {
    const date = await which(ctx);
    const actual = date ? (await api.payslip(date)).totals : null;
    const month = actual?.worked_month || ctx.period.month;
    const e = await api.estMonth(month);
    ctx.setTitle(`Expected · ${monthOnly(month)} hours`);
    // three columns, so it fits beside the payslip: the difference sits under the payslip's figure
    const row = (label, exp, act, isMoney = true) => {
      const d = act == null || exp == null ? null : act - exp;
      const show = v => isMoney ? money(v) : hrs(v);
      return el('tr', {}, el('td', {}, label),
        el('td', { class: 'n' }, show(exp)),
        el('td', { class: 'n' }, act == null ? '—' : show(act),
          d != null && Math.abs(d) > 0.5 ? el('div', { class: 'small ' + (d > 0 ? 'cre' : 'deb') }, (d > 0 ? '+' : '') + show(d)) : null));
    };
    body.append(el('div', { class: 'scroll' }, el('table', { class: 'expect' },
      el('thead', {}, el('tr', {}, el('th'), el('th', { class: 'n' }, 'Expected'), el('th', { class: 'n' }, 'Payslip'))),
      el('tbody', {},
        row('Hours', e.hours, null, false),
        row('Hours ×1.5', e.ot15_hours, actual?.ot15_hours, false),
        row('Hours ×2', e.ot2_hours, actual?.ot2_hours, false),
        row('Basic', e.basic, actual?.basic),
        row('OT ×1.5', e.ot15_pay, actual?.ot15_pay), row('OT ×2', e.ot2_pay, actual?.ot2_pay),
        row('Gross', e.gross, actual?.gross), row('Tax', e.tax, actual?.tax), row('NI', e.ni, actual?.ni),
        row('Pension', e.pension, actual?.pension), row('Student loan', e.student_loan, actual?.student_loan),
        row('Net', e.net, actual?.net)))),
      el('p', { class: 'note' }, `Paid ${dayLong(e.pay_date)}`,
        e.hourly ? ` · hourly ${money(e.hourly)}, ×1.5 ${money(e.hourly * 1.5)}, ×2 ${money(e.hourly * 2)}` : ''));
  } },

  'pay.taxyear': { title: 'Tax year', w: 12, deps: ['payslip'], async render(body, ctx) {
    const ty = ctx.period.taxYear;
    const [row] = await api.view('v_tax_year', { tax_year: ty });
    const r = row || {};
    ctx.setTitle(`Tax year ${taxYearLabel(ty)}`);
    body.classList.add('flush');
    body.append(tiles(
      tile('Payslips', String(r.payslips || 0)), tile('Gross', money(r.gross || 0)),
      tile('Tax', money(r.tax || 0)), tile('NI', money(r.ni || 0)), tile('Pension', money(r.pension || 0)),
      tile('Student loan', money(r.student_loan || 0)), tile('Net', money(r.net || 0)),
      tile('Overtime pay', money(r.overtime_pay || 0)),
      tile('Employer paid', money((r.er_ni || 0) + (r.er_pension || 0)), 'NI and pension')));
  } },

  'pay.rates': { title: 'Pay rates', w: 6, deps: ['pay_rate'], async render(body, ctx) {
    const rows = await api.table('pay_rate', { order: 'from_date', desc: 1 });
    const hours = +setting('weekly_contract_hours', 40);
    body.append(grid({ table: 'pay_rate', key: 'from_date', rows, save: pkSave('pay_rate', 'from_date'),
      cols: [{ k: 'from_date', label: 'From', type: 'date', required: true },
             { k: 'annual', label: 'Salary', type: 'number', n: true, required: true },
             { k: 'ot_hourly', label: 'Hourly rate', type: 'number', n: true,
               placeholder: '' },
             { k: '_calc', label: `Salary ÷ (52 × ${hours}h)`, n: true,
               render: r => el('span', { class: 'num muted' }, r.annual ? money(r.annual / 52 / hours) : '') },
             { k: 'note', label: 'Note' }, ...extraCols('pay_rate')],
      draft: {}, onChange: () => { ctx.changed('pay_rate'); ctx.refresh(); } }));
  } },

  'pay.settings': { title: 'Payroll', w: 6, async render(body, ctx) {
    const f = [
      ['employer', 'Employer', 'text'], ['payday', 'Payday (day of month)', 'number'],
      ['weekly_contract_hours', 'Contract hours a week', 'number'],
      ['pension_pct', 'Pension %', 'number'], ['employer_pension_pct', 'Employer pension %', 'number'],
      ['pension_relief', 'Pension taken', [{ v: 'net_pay', label: 'Before tax (net pay)' },
        { v: 'sacrifice', label: 'Salary sacrifice' }, { v: 'relief_at_source', label: 'After tax (relief at source)' }]],
    ];
    body.append(settingsForm(f, ctx));
  } },

  // P60s: every tax year in one list (type each P60 in as it comes), then the
  // year you pick checked line by line against its payslips.
  'pay.p60': { title: 'P60s', w: 12, deps: ['payslip', 'p60', 'setting'], async render(body, ctx) {
    const log = await api.view('v_p60', { order: 'tax_year', desc: 1 });
    const diffs = r => {
      if (!r.has_p60) return el('span', { class: 'muted' }, 'No P60 yet');
      if (!r.payslips) return el('span', { class: 'muted' }, 'No payslips');
      const off = [['Tax', r.tax_diff], ['NI', r.ni_diff], ['Student loan', r.student_loan_diff]].filter(([, d]) => d != null && Math.abs(d) >= 1);
      return off.length ? el('span', { class: 'deb' }, off.map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${money(d)}`).join(' · '))
        : el('span', { class: 'cre' }, 'Matches the payslips');
    };
    const yearIn = v => { const m = String(v ?? '').match(/(\d{4})/); if (!m) throw new Error('Type the tax year, e.g. 2024/25'); return +m[1]; };
    body.append(el('h3', { class: 'sub' }, 'P60 log'),
      grid({ table: 'p60', key: 'tax_year', rows: log, scroll: 'mid',
        rowClass: r => String(r.tax_year) === String(ctx.params.ty) ? 'sel' : null,
        cols: [{ k: 'tax_year', label: 'Tax year', readonly: true, fmt: v => el('a', { href: `#/pay?ty=${v}&panel=pay.p60` }, taxYearLabel(v)),
                 draftInput: true, placeholder: 'e.g. 2024/25', width: '110px' },
               { k: 'pay', label: 'Pay', type: 'number', n: true, width: '100px', placeholder: 'from P60' },
               { k: 'tax', label: 'Tax', type: 'number', n: true, width: '90px' },
               { k: 'ni', label: 'NI', type: 'number', n: true, width: '90px' },
               { k: 'student_loan', label: 'Student loan', type: 'number', n: true, width: '90px' },
               { k: 'tax_code', label: 'Tax code', width: '80px' },
               { k: '_check', label: 'Against the payslips', render: diffs, draftText: '' },
               { k: 'note', label: 'Note' }],
        remove: r => r.has_p60 ? api.remove('p60', r.tax_year) : Promise.reject(new Error('Nothing typed in for that year')),
        add: ({ tax_year, ...row }) => api.save('p60', { ...row, tax_year: yearIn(tax_year) }),
        draft: {}, onChange: () => { ctx.changed('p60'); ctx.refresh(); }, onSaved: () => { ctx.changed('p60'); ctx.refresh(); } }),
      el('h3', { class: 'sub' }, 'One year, line by line'));
    const years = (await api.view('v_tax_year', { order: 'tax_year' })).map(r => r.tax_year);
    const done = taxYearOf(today()) - 1;                       // the last whole tax year
    const ty = +(ctx.params.ty || (years.includes(done) ? done : years.at(-1) ?? done));
    const c = await api.taxYear(ty);
    const pick = select([...new Set([...years, done])].sort().map(y => ({ v: y, label: taxYearLabel(y) })), ty,
      { class: 'sm', onchange: e => ctx.go('pay', { ...ctx.params, ty: e.target.value }) });
    ctx.aside.append(pick);
    const box = (k, isText) => {
      const i = el('input', { value: isText ? c.p60[k] ?? '' : c.p60[k] == null ? '' : grouped(c.p60[k]),
                              inputmode: isText ? null : 'decimal', placeholder: 'from P60', style: 'width:110px;text-align:right' });
      i.addEventListener('change', async () => {
        try { await api.save('p60', { tax_year: ty, [k]: isText ? i.value.trim() || null : toNumber(i.value) }); ctx.changed('p60'); ctx.refresh(); }
        catch (e) { flash(e.message); }
      });
      return i;
    };
    const diff = (mine, k) => {
      const theirs = c.p60[k];
      if (theirs == null || theirs === '') return '';
      const d = Math.round((theirs - mine) * 100) / 100;
      return el('span', { class: 'num ' + (Math.abs(d) < 1 ? 'cre' : 'deb') }, Math.abs(d) < 1 ? 'matches' : (d > 0 ? '+' : '') + money(d));
    };
    const row = (label, mine, k, sub) => el('tr', {}, el('td', {}, label, sub ? el('div', { class: 'muted small' }, sub) : null),
      el('td', { class: 'n' }, el('span', { class: 'num' }, money(mine))), el('td', { class: 'n' }, box(k)), el('td', { class: 'n' }, diff(mine, k)));
    const gap = c.tax_gap;
    body.append(el('div', { class: 'scroll' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th'), el('th', { class: 'n' }, 'Payslips'), el('th', { class: 'n' }, 'P60'), el('th', { class: 'n' }, 'Difference'))),
      el('tbody', {},
        row('Pay', c.taxable, 'pay', c.net_pay_pension ? `gross ${money(c.gross)} less pension ${money(c.pension)}` : null),
        row('Tax', c.tax, 'tax'), row('National Insurance', c.ni, 'ni'), row('Student loan', c.student_loan, 'student_loan'),
        el('tr', {}, el('td', {}, 'Tax code'), el('td', { class: 'n num' }, c.tax_code || '—'), el('td', { class: 'n' }, box('tax_code', true)),
          el('td', { class: 'n' }, c.p60.tax_code ? el('span', { class: c.p60.tax_code === c.tax_code ? 'cre' : 'deb' },
            c.p60.tax_code === c.tax_code ? 'matches' : 'differs') : ''))))),
      el('p', {}, `${c.payslips} payslip${c.payslips === 1 ? '' : 's'} in ${taxYearLabel(ty)}.`,
        c.missing.length ? el('span', { class: 'deb' }, ` None for ${c.missing.map(m => monthOnly(m)).join(', ')}.`) : ''),
      c.expected_tax == null ? null : el('p', {}, `Tax on ${money(c.taxable)} over the whole year comes to about ${money(c.expected_tax)}. `,
        'The payslips took ', el('strong', {}, money(c.tax)), Math.abs(gap) < 5 ? ', which is about right.'
          : el('span', { class: gap > 0 ? 'deb' : 'cre' }, `: ${money(Math.abs(gap))} ${gap > 0 ? 'more' : 'less'} than that.`),
        c.missing.length ? ' With payslips missing, that only holds if you earned nothing in those months.' : ''),
      el('p', { class: 'note' }, 'The estimate assumes the standard personal allowance (tax code 1257L) and this year’s rates from ',
        'Settings. The P60 arrives by 31 May; type its figures in to check them. A difference is worth raising with payroll or HMRC.'));
  } },

  'pay.details': { title: 'My details', w: 6, async render(body, ctx) {
    body.append(settingsForm([
      ['works_number', 'Works number', 'text'], ['tax_code', 'Tax code', 'text'],
      ['ni_number', 'National Insurance number', 'text'], ['ni_table', 'NI table', 'text'],
      ['student_loan_plan', 'Student loan', ['none', 'plan1', 'plan2', 'plan4', 'plan5', 'pgl']],
      ['employer_paye_ref', 'Employer PAYE ref', 'text']], ctx));
  } },
};

export const layout = [
  { use: 'pay.list', w: 3 },
  { use: 'pay.slip', w: 6 },
  { use: 'pay.expected', w: 3 },
  { use: 'pay.taxyear' },
  { use: 'pay.p60', w: 12 },
  { type: 'chart', id: 'pay-trend', title: 'Gross and net', w: 6, source: 'v_payslip', date: 'pay_date',
    x: 'pay_date', y: ['gross', 'net'], names: { gross: 'Gross', net: 'Net' }, chart: 'line', grain: 'month', window: 'all' },
  { type: 'chart', id: 'pay-deductions', title: 'Deductions', w: 6, source: 'v_payslip', date: 'pay_date',
    x: 'pay_date', y: ['tax', 'ni', 'pension', 'student_loan'],
    names: { tax: 'Tax', ni: 'NI', pension: 'Pension', student_loan: 'Student loan' },
    chart: 'stacked', grain: 'month', window: 'all' },
  { use: 'pay.rates', w: 6 },
  { use: 'pay.settings', w: 6 },
  { use: 'pay.details', w: 6 },
];
