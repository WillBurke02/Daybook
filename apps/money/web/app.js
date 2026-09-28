// Money, as the shell sees it: its pages, sidebar, menus and search results.
import { api } from './api.js';
import { el, flash, select } from './core/dom.js';
import { state } from './core/state.js';
import { fmtWhen, plain, dayShort } from './core/format.js';
import { writeVal } from './core/dom.js';
import * as overview from './views/overview.js';
import * as hours from './views/hours.js';
import * as pay from './views/pay.js';
import * as holidays from './views/holidays.js';
import * as spending from './views/spending.js';
import * as accounts from './views/accounts.js';
import * as settings from './views/settings.js';
import * as pension from './views/pension.js';
import * as reminders from './views/reminders.js';

const at = d => `p=month:${d}`;

export default {
  name: 'money', title: 'Money', home: 'overview', period: true,
  about: 'hours, pay, leave, spending and bills.',
  pages: { overview, hours, pay, holidays, spending, accounts, reminders, investments: pension.investments, pension, settings },
  groups: [[null, ['overview']], ['Hours', ['hours', 'pay', 'holidays']], ['Spending', ['spending', 'accounts', 'reminders']],
           ['Investments', ['investments', 'pension']]],
  setup: ['settings'],
  quick: [{ label: '+ Hours', href: '#/hours?add=today' }, { label: '+ Payslip', href: '#/pay?new=1' },
          { label: '+ Statement', href: '#/accounts?import=1' }],
  sqlHint: 'SELECT * FROM v_spend WHERE amount > 100 ORDER BY amount DESC',

  file: shell => [
    { label: 'New payslip', fn: () => shell.go('pay', { new: 1 }) },
    { label: 'Add hours for today', fn: () => shell.go('hours', { add: 'today' }) },
    { label: 'Import a bank statement…', fn: () => shell.go('accounts', { import: 1 }) },
    { label: 'Import hours…', fn: () => { shell.go('hours'); setTimeout(() => document.getElementById('p-hours.import')?.scrollIntoView({ behavior: 'smooth' }), 700); } },
  ],

  // How each kind of search result reads, and where clicking it goes.
  search: {
    txn: ['Transactions', r => ({ when: r.date, what: r.merchant || r.description, amount: r.amount, signed: true,
      more: [r.account, r.category_path, r.merchant ? r.description : null, r.note].filter(Boolean).join(' · '), href: `#/spending?${at(r.date)}` })],
    payee: ['Payees', r => ({ what: r.name, more: `${r.category || 'No category'} · ${r.txns} transactions`, href: '#/settings' })],
    shift: ['Shifts', r => ({ when: r.date, what: `${r.start}–${r.end}`, more: [r.project, r.note].filter(Boolean).join(' · '),
      href: `#/hours?${at(r.date)}&add=${r.date}` })],
    payslip: ['Payslip lines', r => ({ when: r.date, what: r.label, amount: r.amount, more: `Payslip paid ${dayShort(r.date)}${r.note ? ' · ' + r.note : ''}`,
      href: `#/pay?slip=${r.date}` })],
    leave: ['Days off', r => ({ when: r.date, what: r.note || { holiday: 'Annual leave', extra: 'Time off in lieu', other: 'Day off' }[r.kind],
      more: `${fmtWhen(r.date, r.to_date)} · ${plain(r.days)} days`, href: '#/holidays', go: () => writeVal('holiday_year', r.date.slice(0, 4)) })],
    reminder: ['Reminders', r => ({ when: r.date, what: r.title, amount: r.amount, more: [r.every, r.note].filter(Boolean).join(' · '), href: '#/reminders' })],
    receipt: ['Receipts', r => ({ when: r.date, what: r.note || 'Receipt', thumb: r.thumb, amount: r.amount,
      more: r.txn_id ? r.description || '' : 'not matched to a payment yet', href: `#/spending?${at(r.date || '')}` })],
    account: ['Accounts', r => ({ what: r.name, more: [r.kind, r.provider].filter(Boolean).join(' · '), href: '#/accounts' })],
    category: ['Categories', r => ({ what: r.path, more: r.kind, href: '#/settings' })],
  },

  /** Account, category and tag, above the pages that say filters: true. */
  async filterBar(render) {
    const [accts, cats, tags] = await Promise.all([
      api.table('account', { archived: 0, order: 'sort_order' }),
      api.table('category', { parent_id: '', order: 'name' }), api.table('tag', { order: 'name' })]);
    const f = state.filters;
    const pick = (k, opts, lbl) => el('label', {}, lbl, select([{ v: '', label: 'All' }, ...opts], f[k],
      { class: 'sm', onchange: e => { f[k] = e.target.value; render(); } }));
    return el('div', { class: 'filters' },
      pick('account', accts.map(a => ({ v: a.id, label: a.name })), 'Account'),
      pick('grp', cats.map(c => c.name), 'Category'),
      pick('tag', tags.map(t => ({ v: t.id, label: t.name })), 'Tag'),
      (f.account || f.grp || f.tag) ? el('button', { class: 'link', onclick: () => {
        Object.keys(f).forEach(k => { f[k] = ''; }); render(); } }, 'Clear') : null);
  },

  admin: {
    health: () => [el('div', { class: 'row', style: 'margin-top:8px' }, el('button', { class: 'btn plain sm', onclick: async () => {
      const r = await api.rescan(true); flash(`Rules re-applied to everything: ${r.changed} changed`);
    } }, 'Re-apply rules to every transaction'))],
  },
};
