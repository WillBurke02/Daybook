import { api } from '../api.js';
import { el, tiles, tile, table, flash, select } from '../core/dom.js';
import { money, hrs, signed, dayShort, dateUK, dayLong, monthOnly, plain, today, toNumber, grouped } from '../core/format.js';
import { loadMeta, setting } from '../core/state.js';

export const title = 'Overview';

export const panels = {
  'overview.tiles': { title: 'At a glance', w: 12, deps: ['shift', 'txn', 'payslip', 'leave'], async render(body, ctx) {
    const p = ctx.period;
    const [days, spend, money_, slip, unsorted, leave, safe] = await Promise.all([
      api.view('v_day', { date__gte: p.from, date__lte: p.to }),
      api.view('v_spend', { date__gte: p.from, date__lte: p.to }),
      api.view('v_money', { date__gte: p.from, date__lte: p.to, kind: 'income' }),
      api.view('v_payslip', { order: 'pay_date', desc: 1, limit: 1 }),
      api.review(500),
      api.view('v_leave_year', { year: today().slice(0, 4) }), api.safe()]);
    const s = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const est = p.grain === 'month' ? await api.estMonth(p.month).catch(() => null) : null;
    body.classList.add('flush');
    body.append(tiles(
      tile('Safe to spend', safe.available == null ? '—' : money(safe.available),
        safe.available == null ? 'type a balance below' : `${money(safe.per_day)} a day · ${safe.days} to payday`, safe.available < 0 ? 'deb' : '',
        '#/overview?panel=overview.safe'),
      tile('Hours', hrs(s(days, 'hours')), `${days.length} days`, '', '#/hours'),
      tile('Overtime', hrs(s(days, 'ot_hours')), null, '', '#/hours'),
      est ? tile('Expected pay', money(est.net), `gross ${money(est.gross)} · ${dayShort(est.pay_date)}`, '', '#/pay?new=1') : null,
      slip[0] ? tile('Last payslip', money(slip[0].net), dayLong(slip[0].pay_date), '', `#/pay?slip=${slip[0].pay_date}`) : null,
      tile('Money in', money(s(money_, 'money_in')), null, '', '#/spending'),
      tile('Spent', money(s(spend, 'amount')), null, '', '#/spending'),
      tile('To sort', String(unsorted.length), 'payees', '', '#/spending?panel=spending.sort'),
      leave[0] ? tile('Annual leave left', plain(leave[0].remaining), `of ${plain(leave[0].total)} in ${leave[0].year}`, '', '#/holidays') : null));
  } },

  // Explicit inputs only: a balance (the statement's, or one typed today), the
  // bills before payday from Reminders, and what you mean to save.
  'overview.safe': { title: 'Safe to spend until payday', w: 4, deps: ['statement', 'reminder', 'setting', 'txn'], async render(body, ctx) {
    const [s, accts] = await Promise.all([api.safe(), api.table('account', { kind: 'current', archived: 0, order: 'sort_order' })]);
    const put = async (pairs, msg) => {
      try { for (const [key, value] of pairs) await api.save('setting', { key, value }); await loadMeta(); flash(msg); ctx.changed('setting'); ctx.refresh(); }
      catch (e) { flash(e.message); }
    };
    const bal = el('input', { class: 'sm', inputmode: 'decimal', placeholder: 'from your banking app', style: 'width:130px',
                              value: setting('safe_balance_on', '') === today() ? grouped(setting('safe_balance', '')) : '' });
    bal.addEventListener('change', () => put(toNumber(bal.value) == null ? [['safe_balance', ''], ['safe_balance_on', '']]
      : [['safe_balance', String(toNumber(bal.value))], ['safe_balance_on', today()]], 'Balance kept for today'));
    const save = el('input', { class: 'sm', inputmode: 'decimal', value: grouped(setting('safe_savings', '0')), style: 'width:100px' });
    save.addEventListener('change', () => put([['safe_savings', String(toNumber(save.value) ?? 0)]], 'Saved'));
    const acct = select([{ v: '', label: 'The first current account' }, ...accts.map(a => ({ v: a.id, label: a.name }))],
      setting('safe_account', ''), { class: 'sm', onchange: e => put([['safe_account', e.target.value]], 'Saved') });
    const from = s.balance_from === 'typed' ? `typed on ${dateUK(s.balance_on)}`
      : s.balance_from === 'statement' ? `${s.account}’s statement closing ${dateUK(s.balance_on)}` : null;
    body.append(el('div', { class: 'safe' },
      el('div', { class: 'big ' + (s.available < 0 ? 'deb' : '') }, s.available == null ? '—' : money(s.available)),
      el('div', { class: 'muted' }, s.available == null ? 'No balance yet: import a statement with its closing balance, or type today’s below.'
        : `${money(s.per_day)} a day for ${s.days} day${s.days === 1 ? '' : 's'}, until payday ${dayLong(s.payday)}`)),
      table([{ k: 'k', label: '' }, { k: 'v', label: '', n: true }], [
        { k: from ? `Balance, ${from}` : 'Balance', v: s.balance == null ? '—' : money(s.balance) },
        ...s.bills.map(b => ({ k: `${b.title} · ${dayShort(b.date)}`, v: money(-b.amount) })),
        { k: 'Keeping back to save', v: money(-s.savings) },
        { k: 'Safe to spend', v: s.available == null ? '—' : money(s.available) }]),
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('label', { class: 'f' }, 'Balance today', bal), el('label', { class: 'f' }, 'Save before payday', save),
        el('label', { class: 'f' }, 'Account', acct)),
      el('p', { class: 'note' }, 'Bills are the reminders with an amount that fall due before payday and after the balance’s date. ',
        'A balance typed today wins over an older statement.'));
  } },

  'overview.accounts': { title: 'Accounts', w: 6, deps: ['statement', 'valuation', 'account'], async render(body) {
    const rows = await api.view('v_account_status', { archived: 0, order: 'sort_order' });
    body.append(table([
      { k: 'name', label: 'Account', render: r => el('span', {}, el('span', { class: 'dot', style: r.colour ? `--dot:${r.colour}` : null }), r.name) },
      { k: 'balance', label: 'Closing balance', n: true, render: r => r.valuation != null ? money(r.valuation) : r.balance == null ? el('span', { class: 'muted' }, '—') : money(r.balance) },
      { k: 'as_of', label: 'As of', render: r => el('span', { class: 'muted' }, r.valuation != null ? dateUK(r.valued_on) : r.as_of ? dateUK(r.as_of) : '') },
      { k: 'statements', label: 'Statements', n: true },
    ], rows, { empty: 'Add accounts in Settings', href: () => '#/accounts' }));
  } },

  'overview.recent': { title: 'Latest transactions', w: 6, deps: ['txn', 'match_rule', 'category'], async render(body, ctx) {
    const rows = await api.view('v_txn', { order: 'date', desc: 1, limit: 14 });
    ctx.aside.append(el('a', { class: 'link', href: '#/spending' }, 'All'));
    body.append(table([
      { k: 'date', label: 'Date', fmt: dayShort }, { k: 'account', label: 'Account' },
      { k: 'merchant', label: 'Payee', render: r => r.merchant || el('span', { class: 'muted' }, r.description) },
      { k: 'category_path', label: 'Category' },
      { k: 'amount', label: 'Amount', n: true, render: r => signed(r.amount) }], rows,
      { empty: 'No statements imported yet', href: r => `#/spending?p=month:${r.date}&panel=spending.txns` }));
  } },

  'overview.payslip': { title: 'Last payslip', w: 3, deps: ['payslip'], async render(body, ctx) {
    const [s] = await api.view('v_payslip', { order: 'pay_date', desc: 1, limit: 1 });
    if (!s) { body.append(el('p', { class: 'note' }, 'None yet'), el('a', { class: 'btn sm', href: '#/pay?new=1' }, '+ Payslip')); return; }
    ctx.aside.append(el('a', { class: 'link', href: `#/pay?slip=${s.pay_date}` }, 'Open'));
    body.append(el('a', { class: 'eyebrow', href: `#/pay?slip=${s.pay_date}` }, `${dayLong(s.pay_date)} · ${s.worked_month ? monthOnly(s.worked_month) + ' hours' : ''}`),
      table([{ k: 'k', label: '' }, { k: 'v', label: '', n: true }], [
        { k: 'Gross', v: money(s.gross) }, { k: 'Tax', v: money(s.tax) }, { k: 'NI', v: money(s.ni) },
        { k: 'Pension', v: money(s.pension) }, { k: 'Student loan', v: money(s.student_loan) }, { k: 'Net', v: money(s.net) }],
        { href: () => `#/pay?slip=${s.pay_date}` }));
  } },
};

export const layout = [
  { use: 'overview.tiles' },
  { use: 'overview.safe', w: 4 },
  { type: 'chart', id: 'ov-hours', title: 'Hours', w: 4, source: 'v_day', date: 'date', x: 'date',
    y: ['normal_hours', 'ot_hours'], names: { normal_hours: 'Normal', ot_hours: 'Overtime' },
    chart: 'stacked', grain: 'week', window: '12m', fmt: 'hours' },
  { type: 'chart', id: 'ov-spend', title: 'Where it went', w: 4, source: 'v_spend', date: 'date',
    x: 'grp', y: ['amount'], names: { amount: 'Spent' }, chart: 'pie' },
  { type: 'chart', id: 'ov-inout', title: 'In and out', w: 4, source: 'v_money', date: 'date', x: 'date',
    y: ['money_in', 'money_out'], names: { money_in: 'In', money_out: 'Out' }, where: { kind__ne: 'transfer' },
    chart: 'bar', grain: 'month', window: '12m' },
  { use: 'hours.calendar', w: 4 },
  { use: 'overview.payslip', w: 3 },
  { use: 'reminders.soon', w: 3 },
  { use: 'holidays.allowance', w: 2 },
  { use: 'overview.accounts', w: 6 },
  { use: 'overview.recent', w: 6 },
  { use: 'hours.periods' },
];
