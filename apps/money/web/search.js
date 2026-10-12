// How Money's search results read and where clicking one goes; also shown by another app's "Search every app".
import { fmtWhen, plain, dayShort } from './core/format.js';
import { writeVal } from './core/dom.js';

const at = d => `p=month:${d}`;

export default {
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
};
