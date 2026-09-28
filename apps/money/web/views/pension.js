import { api } from '../api.js';
import { el, flash, tiles, tile, table, select, readVal, writeVal } from '../core/dom.js';
import { money, signed, dateUK, taxYearLabel, today, monthName, addMonths, toNumber } from '../core/format.js';
import { setting, extraCols, settingsForm } from '../core/state.js';
import { grid } from '../ui/grid.js';
import { chart } from '../ui/chart.js';
import { viewPdf } from '../ui/media.js';

export const title = 'Pension';

const dot = c => el('span', { class: 'dot', style: c ? `--dot:${c}` : null });
const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
const GROUPS = [['savings', 'Savings'], ['investment', 'Investments'], ['pension', 'Pensions']];
const PDF_MAX = 10 * 1024 * 1024;
const readUrl = f => new Promise(r => { const x = new FileReader(); x.onload = () => r(x.result); x.readAsDataURL(f); });

/** An account picker grouped Savings / Investments / Pensions, starting on "Choose the account". */
function accountPicker(accts, value, attrs = {}) {
  const s = el('select', attrs, el('option', { value: '' }, 'Choose the account'),
    GROUPS.map(([k, label]) => {
      const mine = accts.filter(a => a.kind === k);
      return mine.length ? el('optgroup', { label }, mine.map(a => el('option', { value: a.id, selected: String(a.id) === String(value ?? '') }, a.name))) : null;
    }).filter(Boolean));
  return s;
}

/** Add a valuation: type it, or read it off a statement PDF (Trading 212 and most others).
 *  Nothing is chosen for you but what the statement itself says. */
function addValuation(accts, vals, ctx, kinds) {
  const mine = accts.filter(a => kinds.includes(a.kind));
  const acct = accountPicker(mine, mine.length === 1 ? mine[0].id : '', { 'aria-label': 'Account' });
  const date = el('input', { type: 'date', value: today(), 'aria-label': 'Date' });
  const value = el('input', { inputmode: 'decimal', placeholder: 'Value', style: 'width:120px', 'aria-label': 'Value' });
  const note = el('input', { placeholder: 'Note', 'aria-label': 'Note' });
  const file = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
  const found = el('div', { class: 'stack' });
  let pdf = null, paid = null;
  const pick = el('button', { class: 'btn plain sm', type: 'button', onclick: () => file.click() }, 'Read a statement PDF');
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    if (f.size > PDF_MAX) { flash(`${f.name} is over 10 MB`); return; }
    const data = (await readUrl(f)).replace(/^data:application\/pdf[^,]*,/, 'data:application/pdf;base64,');
    found.replaceChildren(el('p', { class: 'muted' }, `Reading ${f.name}…`));
    try {
      const r = await api.readStatement(data);
      pdf = { name: f.name, data };
      if (r.account_id && !acct.value) acct.value = r.account_id;
      if (r.date) date.value = r.date;
      if (r.value != null) value.value = r.value.toFixed(2);
      if (!note.value) note.value = [r.provider, r.account_type, 'statement'].filter(Boolean).join(' ');
      const net = (r.deposits || 0) - (r.withdrawals || 0);
      paid = r.deposits != null || r.withdrawals != null ? { amount: +net.toFixed(2), period: r.period } : null;
      const other = select([{ v: '', label: 'Another figure on it…' }, ...r.amounts.map((a, i) => ({ v: i, label: `${a.label}: ${money(a.amount)}` }))], '',
        { class: 'sm', onchange: e => { if (e.target.value !== '') value.value = r.amounts[+e.target.value].amount.toFixed(2); } });
      const also = paid && net ? el('label', { class: 'c' }, el('input', { type: 'checkbox', checked: true, class: 'also' }),
        `Also record ${money(net)} ${net >= 0 ? 'paid in' : 'taken out'} (deposits less withdrawals${r.period ? `, ${dateUK(r.period[0])} to ${dateUK(r.period[1])}` : ''})`) : null;
      found.replaceChildren(
        el('p', {}, r.value != null ? el('span', {}, 'Found ', el('strong', {}, `${r.value_label}: ${money(r.value)}`), r.date ? ` on ${dateUK(r.date)}` : '', '. ')
          : 'No value found: type it in. ', r.provider ? `${r.provider}${r.account_type ? ', ' + r.account_type : ''}. ` : '',
          r.account_id ? '' : el('strong', {}, 'Choose the account it is for.')),
        el('div', { class: 'row mid' }, other, also),
        el('details', {}, el('summary', { class: 'muted' }, 'What the PDF says'), el('pre', { class: 'pdftext' }, r.text)));
    } catch (e) { pdf = paid = null; found.replaceChildren(el('p', { class: 'err' }, e.message)); }
  });
  const save = el('button', { class: 'btn sm', type: 'button', onclick: async () => {
    const v = toNumber(value.value);
    if (!acct.value) { flash('Choose the account first'); acct.focus(); return; }
    if (v == null || !date.value) { flash('A date and a value'); value.focus(); return; }
    const same = vals.find(x => String(x.account_id) === acct.value && x.date === date.value);
    if (same && !confirm(`There is already a value of ${money(same.value)} for this account on ${dateUK(same.date)}. Replace it?`)) return;
    try {
      const { ids: [id] } = await api.save('valuation', { ...(same ? { id: same.id } : {}), account_id: +acct.value, date: date.value, value: v, note: note.value || null });
      if (pdf) await api.save('valuation_file', { valuation_id: id, name: pdf.name, data: pdf.data });
      if (paid && found.querySelector('input.also')?.checked)
        await api.save('contribution', { account_id: +acct.value, date: paid.period?.[1] || date.value, amount: paid.amount,
          note: `Deposits less withdrawals${paid.period ? `, ${dateUK(paid.period[0])} to ${dateUK(paid.period[1])}` : ''}` });
      flash('Saved', { label: 'Undo', fn: async () => { await api.undo(); ctx.changed('valuation'); ctx.refresh(); } });
      ctx.changed('valuation'); ctx.changed('contribution'); ctx.refresh();
    } catch (e) { flash(e.message); }
  } }, 'Save');
  return el('div', { class: 'addval stack' }, el('div', { class: 'row mid wrap' }, acct, date, value, note, save, pick, file), found);
}

/** Savings, investments and pensions by group, each group and account opening and closing
 *  (remembered), each account's valuations inside it. kinds: which groups to show. */
export async function holdings(body, ctx, kinds = ['savings', 'investment', 'pension']) {
  const [hold, vals, accts] = await Promise.all([api.view('v_holding', { order: 'sort_order' }), api.view('v_valuation', { order: 'date', desc: 1 }),
    api.table('account', { archived: 0, order: 'sort_order' })]);
  const toggle = (key, open, summary, ...kids) => {
    const d = el('details', { class: 'hold', open: readVal(key, open ? '1' : '') === '1' }, el('summary', {}, summary), ...kids);
    d.addEventListener('toggle', () => writeVal(key, d.open ? '1' : '0'));
    return d;
  };
  body.append(addValuation(accts, vals, ctx, kinds));
  for (const [k, label] of GROUPS.filter(([k]) => kinds.includes(k))) {
    const rows = hold.filter(h => h.kind === k);
    if (!rows.length) continue;
    body.append(toggle(`hold:${k}`, true,
      el('span', { class: 'row mid' }, el('strong', {}, label), el('span', { class: 'spacer' }),
        el('span', { class: 'muted' }, `${rows.length} account${rows.length === 1 ? '' : 's'}`), el('strong', { class: 'num' }, money(sum(rows, 'value_share')))),
      ...rows.map(h => {
        const mine = vals.filter(v => v.account_id === h.id);
        return toggle(`hold:a${h.id}`, false,
          el('span', { class: 'row mid' }, dot(h.colour), h.name, el('span', { class: 'spacer' }),
            h.as_of ? el('span', { class: 'muted small' }, `${dateUK(h.as_of)} · ${h.basis === 'statement' ? 'statement' : 'valued'}`) : el('span', { class: 'muted small' }, 'no value yet'),
            h.gain != null ? el('span', { class: 'num small ' + (h.gain < 0 ? 'deb' : 'cre') }, signed(h.gain)) : null,
            el('strong', { class: 'num' }, h.value == null ? '—' : money(h.value))),
          h.paid_in != null ? el('p', { class: 'muted small' }, `Paid in ${money(h.paid_in)}${h.gain != null ? `, growth ${signed(h.gain)}` : ''}${h.share_pct !== 100 ? `, your share ${h.share_pct}%` : ''}`) : null,
          grid({ table: 'valuation', rows: mine,
            cols: [{ k: 'date', label: 'Date', type: 'date', required: true },
                   { k: 'value', label: 'Value', type: 'number', n: true, required: true },
                   { k: 'note', label: 'Note' },
                   { k: '_f', label: '', render: r => r.has_file ? el('button', { class: 'link', type: 'button',
                       onclick: async () => { const [f] = await api.table('valuation_file', { valuation_id: r.id }); if (f) viewPdf(f.data); } }, 'PDF') : '' },
                   ...extraCols('valuation')],
            save: (row, patch) => api.save('valuation', { id: row.id, ...patch }),
            add: row => api.save('valuation', { ...row, account_id: h.id }),
            draft: { date: today() },
            onChange: () => { ctx.changed('valuation'); ctx.refresh(); }, onSaved: () => ctx.changed('valuation') }));
      })));
  }
  if (!hold.some(h => kinds.includes(h.kind)))
    body.append(el('p', { class: 'note' }, 'Add savings, investment or pension accounts in Settings → Accounts.'));
}

/** Money put in and taken out: typed rows to change or remove, and where the rest came from. */
async function contributions(body, ctx, kinds = ['savings', 'investment', 'pension']) {
  const [rows, accts] = await Promise.all([api.view('v_contribution', { order: 'date', desc: 1 }),
    api.table('account', { archived: 0, order: 'sort_order' })]);
  const mine = accts.filter(a => kinds.includes(a.kind));
  const typed = rows.filter(r => r.origin === 'typed' && kinds.includes(r.kind));
  const rest = rows.filter(r => r.origin !== 'typed' && kinds.includes(r.kind));
  body.append(grid({ table: 'contribution', rows: typed, scroll: 'mid',
    cols: [{ k: 'account_id', label: 'Account', type: 'select', required: true,
             options: [{ v: '', label: 'Choose' }, ...GROUPS.flatMap(([k, g]) => mine.filter(a => a.kind === k).map(a => ({ v: a.id, label: `${a.name} (${g.toLowerCase()})` })))] },
           { k: 'date', label: 'Date', type: 'date', required: true },
           { k: 'amount', label: 'Amount', type: 'number', n: true, required: true, placeholder: 'minus: out' },
           { k: 'note', label: 'Note' }],
    save: (row, patch) => api.save('contribution', { id: row.id, ...patch }),
    draft: { date: today() },
    onChange: () => { ctx.changed('contribution'); ctx.refresh(); }, onSaved: () => ctx.changed('contribution') }));
  if (rest.length) body.append(el('details', { style: 'margin-top:10px' },
    el('summary', { class: 'muted' }, `${rest.length} more from statements and payslips`),
    table([{ k: 'date', label: 'Date', fmt: dateUK }, { k: 'account', label: 'Account' },
           { k: 'note', label: 'What' }, { k: 'amount', label: 'Amount', n: true, render: r => signed(r.amount) },
           { k: '_o', label: '', render: r => r.origin === 'payslip' ? el('a', { href: `#/pay?slip=${r.ref}` }, 'payslip')
               : el('span', { class: 'muted' }, 'statement') }], rest)));
}

export const panels = {
  'invest.tiles': { title: 'Savings and investments', w: 12, deps: ['valuation', 'txn', 'account', 'statement', 'payslip', 'contribution'], async render(body) {
    const hold = await api.view('v_holding');
    const of = k => hold.filter(h => h.kind === k);
    const count = k => `${of(k).length} account${of(k).length === 1 ? '' : 's'}`;
    const grown = hold.filter(h => h.gain != null);
    body.classList.add('flush');
    body.append(tiles(
      tile('Altogether', money(sum(hold, 'value_share')), 'savings, investments and pensions, your share'),
      tile('Savings', money(sum(of('savings'), 'value_share')), count('savings')),
      tile('Investments', money(sum(of('investment'), 'value_share')), count('investment')),
      tile('Pensions', money(sum(of('pension'), 'value_share')), count('pension'), '', '#/pension'),
      tile('Growth', signed(sum(grown, 'gain')), grown.length ? `on ${money(sum(grown, 'paid_in'))} paid in` : 'record what you paid in to see it')));
  } },

  // Each group's value at the end of each month: the last figure known carries on until the next
  // (a month with no valuation is not a month worth nothing).
  'invest.value': { title: 'Value over time', w: 12, deps: ['valuation', 'statement', 'account'], async render(body) {
    const [vals, stmts, hold] = await Promise.all([api.view('v_valuation', { order: 'date' }),
      api.view('v_statement_check', { order: 'period_end' }), api.view('v_holding')]);
    const pts = new Map(hold.map(h => [h.id, []]));
    for (const v of vals) pts.get(v.account_id)?.push([v.date, v.value]);
    for (const x of stmts) if (x.closing_balance != null) pts.get(x.account_id)?.push([x.period_end, x.closing_balance]);
    const dates = [...pts.values()].flat().map(p => p[0]).sort();
    if (!dates.length) { body.append(el('p', { class: 'note' }, 'No valuations or statements yet')); return; }
    const months = [];
    for (let m = dates[0].slice(0, 7); m <= today().slice(0, 7); m = addMonths(m, 1)) months.push(m);
    const at = (id, m) => {                    // the latest figure on or before the month's end
      const known = pts.get(id).filter(p => p[0].slice(0, 7) <= m).sort((a, b) => a[0].localeCompare(b[0]));
      return known.length ? known.at(-1)[1] * (hold.find(h => h.id === id).share_pct / 100) : null;
    };
    const series = GROUPS.map(([k, name]) => {
      const ids = hold.filter(h => h.kind === k).map(h => h.id);
      const values = months.map(m => { const v = ids.map(id => at(id, m)).filter(x => x != null); return v.length ? +v.reduce((a, b) => a + b, 0).toFixed(2) : null; });
      return { name, values };
    }).filter(sr => sr.values.some(v => v != null));
    const mount = el('div');
    body.append(mount);
    chart(mount, { type: 'line', labels: months.map(monthName), height: 240, series });
  } },

  'invest.holdings': { title: 'Savings and investments', w: 6, deps: ['valuation', 'account', 'statement', 'txn', 'contribution', 'payslip'],
    render: (body, ctx) => holdings(body, ctx) },
  'invest.contributions': { title: 'Money put away', w: 6, deps: ['contribution', 'txn', 'payslip', 'account'],
    render: (body, ctx) => contributions(body, ctx) },

  'pension.tiles': { title: 'Pension', w: 12, deps: ['payslip', 'valuation', 'txn', 'account', 'setting', 'contribution'], async render(body, ctx) {
    const [pots, flow] = await Promise.all([api.view('v_pension'), api.view('v_pension_flow')]);
    const ty = ctx.period.taxYear;
    const thisYear = flow.filter(f => f.tax_year === ty && ['you', 'employer', 'paid in'].includes(f.source));
    const allowance = +setting('pension_annual_allowance', 60000);
    const value = sum(pots, 'value'), paid = sum(pots, 'paid_in');
    body.classList.add('flush');
    if (!pots.length) {
      body.classList.remove('flush');
      body.append(el('p', { class: 'note' }, 'Add an account of kind "pension" in Settings → Accounts.'));
      return;
    }
    body.append(tiles(
      tile('Pot', money(value), pots.every(p => p.valued_on) ? `valued ${dateUK(pots.map(p => p.valued_on).sort()[0])}` : 'add a valuation'),
      tile('Paid in', money(paid)),
      tile('From you', money(sum(pots, 'from_you'))),
      tile('From your employer', money(sum(pots, 'from_employer'))),
      tile('Growth', signed(value - paid)),
      tile(`Tax year ${taxYearLabel(ty)}`, money(sum(thisYear, 'amount')), 'paid in'),
      tile('Annual allowance left', money(allowance - sum(thisYear, 'amount')), `of ${money(allowance)}`)));
  } },

  'pension.pots': { title: 'Pensions', w: 6, deps: ['account', 'valuation', 'payslip', 'txn', 'contribution'], async render(body) {
    const pots = await api.view('v_pension');
    body.append(table([
      { k: 'name', label: 'Pension', render: r => el('span', {}, dot(r.colour), r.name) },
      { k: 'provider', label: 'Provider' },
      { k: 'from_you', label: 'You', n: true, fmt: money },
      { k: 'from_employer', label: 'Employer', n: true, fmt: money },
      { k: 'other', label: 'Other', n: true, fmt: money },
      { k: 'paid_in', label: 'Paid in', n: true, fmt: money },
      { k: 'value', label: 'Value', n: true, fmt: v => v == null ? '' : money(v) },
      { k: 'valued_on', label: 'Valued', fmt: v => v ? dateUK(v) : '' },
      { k: 'gain', label: 'Growth', n: true, render: r => r.gain == null ? '' : signed(r.gain) },
    ], pots, { empty: 'No pension accounts' }));
  } },

  'pension.growth': { title: 'Paid in and value', w: 6, deps: ['valuation', 'payslip', 'txn', 'contribution'], async render(body) {
    const [pots, flow, vals] = await Promise.all([api.view('v_pension'), api.view('v_pension_flow', { order: 'date' }),
      api.view('v_valuation', { order: 'date' })]);
    const ids = new Set(pots.map(p => p.id));
    const opening = pots.reduce((a, p) => a + (p.opening || 0), 0);
    const months = [...new Set([...flow.map(f => f.month), ...vals.filter(v => ids.has(v.account_id)).map(v => v.date.slice(0, 7))])].sort();
    if (!months.length) { body.append(el('p', { class: 'note' }, 'Nothing paid in yet')); return; }
    const all = [];
    for (let m = months[0]; m <= months[months.length - 1]; m = addMonths(m, 1)) all.push(m);
    let run = opening;
    const paid = all.map(m => (run += flow.filter(f => f.month === m).reduce((a, f) => a + f.amount, 0)));
    const value = all.map(m => {
      const v = vals.filter(x => ids.has(x.account_id) && x.date.slice(0, 7) === m);
      return v.length ? v.reduce((a, x) => a + x.value, 0) : null;
    });
    const mount = el('div');
    body.append(mount);
    chart(mount, { type: 'line', labels: all.map(monthName), height: 230,
      series: [{ name: 'Paid in', values: paid.map(v => +v.toFixed(2)) }, { name: 'Value', values: value }] });
  } },

  // Every payment into a pension, with where it came from: a payslip (open it, or say which
  // pension it went to), a statement, or typed in (change or remove it here).
  'pension.flow': { title: 'Contributions', w: 6, deps: ['payslip', 'txn', 'contribution', 'account'], async render(body, ctx) {
    const [flow, pots] = await Promise.all([api.view('v_pension_flow', { order: 'date', desc: 1 }), api.table('account', { kind: 'pension', archived: 0 })]);
    const potOf = r => select(pots.map(a => ({ v: a.id, label: a.name })), r.account_id, { class: 'sm', 'aria-label': 'Pension',
      onchange: async e => { await api.save('payslip', { pay_date: r.ref, pension_account_id: +e.target.value }); ctx.changed('payslip'); ctx.refresh(); } });
    const from = r => r.origin === 'payslip' ? el('a', { href: `#/pay?slip=${r.ref}`, title: 'Open the payslip to change or remove this line' }, 'payslip')
      : r.origin === 'typed' ? el('button', { class: 'icon', type: 'button', title: 'Remove', 'aria-label': 'Remove', onclick: async () => {
          await api.remove('contribution', r.ref);
          flash('Removed', { label: 'Undo', fn: async () => { await api.undo(); ctx.changed('contribution'); ctx.refresh(); } });
          ctx.changed('contribution'); ctx.refresh(); } }, '×')
      : el('span', { class: 'muted' }, 'statement');
    body.append(table([
      { k: 'date', label: 'Date', fmt: dateUK },
      { k: 'source', label: 'From', render: r => ({ you: 'You', employer: 'Employer', 'paid in': 'Paid in', 'taken out': 'Taken out' }[r.source]) },
      { k: 'amount', label: 'Amount', n: true, render: r => money(r.amount) },
      { k: 'account_id', label: 'Pension', render: r => r.origin === 'payslip' && pots.length > 1 ? potOf(r) : (pots.find(a => a.id === r.account_id)?.name || '') },
      { k: 'origin', label: '', sort: false, render: from },
    ], flow, { scroll: 'mid', empty: 'No contributions yet. Payslip lines counted as Pension and Employer pension land here.' }),
    el('p', { class: 'muted small' }, 'To add one by hand, use Money put away on the Investments page.'));
  } },

  'pension.valuations': { title: 'Valuations', w: 6, deps: ['valuation', 'account'],
    render: (body, ctx) => holdings(body, ctx, ['pension']) },

  'pension.settings': { title: 'Pension settings', w: 6, async render(body, ctx) {
    const accts = await api.table('account', { kind: 'pension' });
    const rows = [
      ['pension_account', 'Payslip contributions go to', [{ v: '', label: 'The first pension account' }, ...accts.map(a => ({ v: a.id, label: a.name }))]],
      ['pension_pct', 'Your contribution %', 'number'],
      ['employer_pension_pct', 'Employer contribution %', 'number'],
      ['pension_relief', 'Taken', [{ v: 'net_pay', label: 'Before tax (net pay)' }, { v: 'sacrifice', label: 'Salary sacrifice' },
                                 { v: 'relief_at_source', label: 'After tax (relief at source)' }]],
      ['pension_annual_allowance', 'Annual allowance', 'number'],
    ];
    body.append(settingsForm(rows, ctx));
  } },
};

// The Investments page: everything that is put away.
export const investments = {
  title: 'Investments',
  layout: [
    { use: 'invest.tiles' },
    { use: 'invest.holdings', w: 7 },
    { use: 'invest.contributions', w: 5 },
    { use: 'invest.value' },
  ],
};

export const layout = [
  { use: 'pension.tiles' },
  { use: 'pension.pots', w: 6 },
  { use: 'pension.growth', w: 6 },
  { type: 'chart', id: 'pension-monthly', title: 'Paid in each month', w: 6, source: 'v_pension_flow', date: 'date',
    x: 'date', y: ['amount'], split: 'source', chart: 'stacked', grain: 'month', window: 'all' },
  { use: 'pension.flow', w: 6 },
  { use: 'pension.valuations', w: 6 },
  { use: 'pension.settings', w: 6 },
];
