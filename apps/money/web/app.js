// Money, as the shell sees it: its pages, sidebar, menus and search results.
import { api } from './api.js';
import { el, flash, select } from './core/dom.js';
import { state } from './core/state.js';
import search from './search.js';
import * as overview from './views/overview.js';
import * as hours from './views/hours.js';
import * as pay from './views/pay.js';
import * as holidays from './views/holidays.js';
import * as spending from './views/spending.js';
import * as accounts from './views/accounts.js';
import * as settings from './views/settings.js';
import * as pension from './views/pension.js';
import * as reminders from './views/reminders.js';

const app = {
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

  search,


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

// The front door this page came in by: /hours/ is work, /spending/ is private, /money/ is all of it.
// Every page still opens from any door (a link to #/pay works in Spending); the door sets the menu.
const door = {
  hours: { title: 'Hours and pay', about: 'hours, overtime, Send to HR, payslips and leave.', home: 'hours',
           groups: [[null, ['hours', 'pay', 'holidays']]], quick: app.quick.slice(0, 2),
           file: shell => app.file(shell).filter((_, i) => i !== 2) },
  spending: { title: 'Spending', about: 'spending, accounts, bills, savings and pension.', home: 'overview',
              groups: app.groups.filter(([g]) => g !== 'Hours'), quick: app.quick.slice(2),
              file: shell => [app.file(shell)[2]] },
}[location.pathname.split('/')[1]];

export default { ...app, ...door };
