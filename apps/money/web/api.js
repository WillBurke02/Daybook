// Money's API: the generic calls, plus what only Money has.
import { api as core, qs } from './core/api.js';

const { get, send } = core;
export const api = {
  ...core,
  deleteCategory: (id, move_to) => send(`category/${id}${qs({ move_to })}`, undefined, 'DELETE'),
  moveCategory: (from_id, to_id) => send('categories/move', { from_id, to_id }),

  review:   (limit) => get(`review${qs({ limit })}`),
  accept:   (b)     => send('review/accept', b),
  rescan:   (force) => send('rescan', { force }),
  ruleTest: (q)     => get(`rules/test${qs({ q })}`),
  rulePreview: (kind, pattern) => get(`rules/preview${qs({ kind, pattern })}`),

  tagTxn:   (txn, tag) => send(`tags/${txn}/${tag}`),
  untagTxn: (txn, tag) => send(`tags/${txn}/${tag}`, undefined, 'DELETE'),
  tagsOf:   (ids)      => get(`tags/of${qs({ txn_ids: ids.join(',') })}`),

  link:   (a, b) => send('link', { a, b }),
  unlink: (a)    => send(`link/${a}`, undefined, 'DELETE'),

  makeCurrent:     (id) => send(`statement/${id}/current`),
  removeStatement: (id) => send(`statement/${id}`, undefined, 'DELETE'),

  importPlan:   (b) => send('import/plan', b),
  importCommit: (b) => send('import/commit', b),
  hoursPlan:    (b) => send('hours/plan', b),
  hoursCommit:  (b) => send('hours/commit', b),
  hrSheet:      (m) => get(`hours/hr/${m}`),

  payslip:         (d) => get(`payslip/${d}`),
  payslipTemplate: ()  => get('payslip/template'),
  savePayslip:     (b) => send('payslip', b),

  reminders: () => get('reminders'),
  regular:   () => get('reminders/suggest'),
  taxYear:   ty => get(`taxyear/${ty}`),
  safe:      () => get('safe'),
  receiptsFor: ids => get(`receipts/of${qs({ txn_ids: ids.join(',') })}`),
  readStatement: data => send('valuations/read', { data }),
  receiptMatches: id => get(`receipts/${id}/matches`),

  bankHolidays: y => send(`bank_holidays/${y}`, {}),
  estMonth: m => get(`estimate/month/${m}`),
  estYear:  y => get(`estimate/year/${y}`),
};
