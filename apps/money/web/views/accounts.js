import { api } from '../api.js';
import { el, flash, table, select, tiles, tile } from '../core/dom.js';
import { money, signed, dayShort, dateUK } from '../core/format.js';
import { extraCols, state } from '../core/state.js';
import { grid } from '../ui/grid.js';
import { holdings } from './pension.js';

export const title = 'Accounts';
export const filters = true;

const accountsOf = () => api.table('account', { archived: 0, order: 'sort_order' });
export const colourOf = id => { const c = (state.meta.accounts || []).find(a => a.id === id)?.colour; return c ? `--dot:${c}` : null; };

export const panels = {
  'accounts.list': { title: 'Accounts', w: 12, deps: ['account', 'statement', 'valuation'], async render(body, ctx) {
    const rows = await api.view('v_account_status', { archived: 0, order: 'sort_order' });
    body.append(table([
      { k: 'name', label: 'Account', render: r => el('span', {}, el('span', { class: 'dot', style: r.colour ? `--dot:${r.colour}` : null }), r.name) },
      { k: 'kind', label: 'Kind' },
      { k: 'balance', label: 'Closing balance', n: true, render: r => r.balance == null ? el('span', { class: 'muted' }, '—') : money(r.balance) },
      { k: 'as_of', label: 'On statement to', fmt: v => v ? dateUK(v) : '' },
      { k: 'valuation', label: 'Valued at', n: true, render: r => r.valuation == null ? '' : el('span', {}, money(r.valuation),
          el('span', { class: 'muted' }, ` ${dayShort(r.valued_on)}`)) },
      { k: 'share_pct', label: 'Your share', n: true, fmt: v => v === 100 ? '' : `${v}%` },
      { k: 'statements', label: 'Statements', n: true },
      { k: 'since', label: 'Since', fmt: v => v ? dateUK(v) : '' },
      { k: 'gaps', label: 'Gaps', n: true, render: r => r.gaps ? el('span', { class: 'chip warn' }, String(r.gaps)) : '' },
      { k: 'unreconciled', label: 'Don’t balance', n: true, render: r => r.unreconciled ? el('span', { class: 'chip bad' }, String(r.unreconciled)) : '' },
      { k: 'txns', label: 'Transactions', n: true },
    ], rows, { empty: 'Add your accounts in Settings.' }));
  } },

  'accounts.statements': { title: 'Statements', w: 7, deps: ['statement', 'txn'], async render(body, ctx) {
    let rows = await api.view('v_statement_check', { order: 'period_start', desc: 1 });
    if (ctx.filters.account) rows = rows.filter(r => String(r.account_id) === String(ctx.filters.account));
    const status = r => r.status === 'balanced' ? el('span', { class: 'chip ok' }, 'balances')
      : r.status === 'off' ? el('span', { class: 'chip bad', title: `out by ${money(r.discrepancy)}` }, `out ${money(r.discrepancy)}`)
      : el('span', { class: 'chip' }, 'no balances');
    body.append(grid({ table: 'statement', rows, scroll: 'tall',
      rowClass: r => r.role === 'current' ? 'sel' : '',
      cols: [{ k: 'account', label: 'Account', cls: 'nw', render: r => el('span', {}, el('span', { class: 'dot', style: colourOf(r.account_id) }), r.account) },
             { k: 'period_start', label: 'From', type: 'date' }, { k: 'period_end', label: 'To', type: 'date' },
             { k: 'opening_balance', label: 'Opening', type: 'number', n: true, width: '100px' },
             { k: 'closing_balance', label: 'Closing', type: 'number', n: true, width: '100px' },
             { k: 'rows_found', label: 'Rows', n: true, readonly: true },
             { k: '_s', label: 'Check', render: status },
             { k: '_c', label: 'Current', render: r => r.role === 'current' ? el('span', { class: 'chip on' }, 'current')
                 : el('button', { class: 'link', style: 'white-space:nowrap', onclick: async () => { await api.makeCurrent(r.id); ctx.changed('statement'); ctx.refresh(); } }, 'set') },
             { k: 'note', label: 'Note' }],
      save: (row, patch) => api.save('statement', { id: row.id, ...patch }),
      remove: row => api.removeStatement(row.id),
      onSaved: () => { ctx.changed('statement'); ctx.refresh(); },
      onChange: () => { ctx.changed('statement'); ctx.refresh(); } }));
  } },

  'accounts.import': { title: 'Import statements', w: 5, async render(body, ctx) {
    const accts = await accountsOf();
    const acct = select([{ v: '', label: 'Choose the account' }, ...accts.map(a => ({ v: a.id, label: a.name }))],
      ctx.filters.account || '');
    const files = el('input', { type: 'file', accept: '.csv,text/csv,.txt', multiple: true });
    const out = el('div');
    let loaded = [], opts = { flip: false, make_current: true, date_style: null, mapping: null, opening: '', closing: '' };
    const plan = async () => {
      out.innerHTML = '';
      if (!loaded.length) return;
      if (!acct.value && loaded.length === 1) { out.append(el('p', { class: 'err' }, 'Choose the account first.')); return; }
      try {
        const res = await api.importPlan({ files: loaded.map(f => ({ ...f, account_id: f.account_id || acct.value })), ...opts });
        out.append(res.mode === 'one' ? one(res.plan) : bulk(res.plan));
      } catch (e) { out.append(el('p', { class: 'err' }, e.message)); }
    };
    const commit = async btn => {
      btn.disabled = true;
      try {
        const r = await api.importCommit({ files: loaded.map(f => ({ ...f, account_id: f.account_id || acct.value })), ...opts });
        flash(r.files ? `Imported ${r.files} statements, ${r.rows} rows` : `Imported ${r.rows} rows`,
          { label: 'Undo', fn: async () => { await api.undo(); ctx.reload(); } });
        loaded = []; files.value = ''; out.innerHTML = '';
        ctx.changed('statement'); ctx.changed('txn');
      } catch (e) { btn.disabled = false; flash(e.message); }
    };
    const one = p => {
      if (p.duplicate) return el('p', { class: 'err' }, `Already imported as ${p.duplicate.filename} on ${p.duplicate.imported_at}.`);
      const cols = [{ v: -1, label: '—' }, ...p.header.map((h, i) => ({ v: i, label: h || `column ${i + 1}` }))];
      const m = { ...p.mapping };
      const set = (k, v) => { m[k] = +v; opts.mapping = m; plan(); };
      const colSel = k => select(cols, m[k] ?? -1, { class: 'sm', onchange: e => set(k, e.target.value) });
      const num = (k, ph) => { const i = el('input', { value: opts[k], placeholder: ph, inputmode: 'decimal', style: 'width:100px' });
        i.addEventListener('change', () => { opts[k] = i.value; plan(); }); return i; };
      return el('div', { class: 'stack' },
        el('div', { class: 'row' },
          el('label', { class: 'f' }, 'Date', colSel('date')),
          el('label', { class: 'f' }, 'Description', colSel('description')),
          el('label', { class: 'f' }, 'Money', select([{ v: 'signed', label: 'one amount column' }, { v: 'inout', label: 'paid in / paid out' }],
            m.style, { class: 'sm', onchange: e => { m.style = e.target.value; opts.mapping = m; plan(); } })),
          m.style === 'inout'
            ? [el('label', { class: 'f' }, 'Paid in', colSel('paid_in')), el('label', { class: 'f' }, 'Paid out', colSel('paid_out'))]
            : el('label', { class: 'f' }, 'Amount', colSel('amount')),
          el('label', { class: 'f' }, 'Dates are', select([{ v: 'dmy', label: 'day/month' }, { v: 'mdy', label: 'month/day' }, { v: 'iso', label: 'year-month-day' }],
            p.date_style, { class: 'sm', onchange: e => { opts.date_style = e.target.value; plan(); } }))),
        el('div', { class: 'row' },
          el('label', { class: 'f' }, 'Opening balance', num('opening', 'from the statement')),
          el('label', { class: 'f' }, 'Closing balance', num('closing', 'from the statement')),
          el('label', { class: 'c' }, el('input', { type: 'checkbox', checked: opts.flip, onchange: e => { opts.flip = e.target.checked; plan(); } }), 'Flip signs'),
          el('label', { class: 'c' }, el('input', { type: 'checkbox', checked: opts.make_current, onchange: e => { opts.make_current = e.target.checked; } }), 'Latest statement')),
        el('div', { class: 'row mid' },
          el('strong', {}, `${p.count} rows`), el('span', { class: 'num deb' }, `${p.money_out} out ${money(p.out_total)}`),
          el('span', { class: 'num cre' }, `${p.money_in} in ${money(p.in_total)}`),
          el('span', { class: 'muted num' }, `${p.period_start || ''} → ${p.period_end || ''}`),
          p.skipped ? el('span', { class: 'muted' }, `${p.skipped} skipped`) : null,
          p.discrepancy == null ? null : p.reconciles ? el('span', { class: 'chip ok' }, 'balances')
            : el('span', { class: 'chip bad' }, `out by ${money(Math.abs(p.discrepancy))}`)),
        table([{ k: 'date', fmt: dateUK }, { k: 'description' }, { k: 'amount', n: true, render: r => signed(r.amount) },
               { k: '_r', label: 'Reads as', render: r => el('span', { class: r.amount < 0 ? 'deb' : 'cre' }, r.amount < 0 ? 'money out' : 'money in') }],
          p.sample, { empty: 'No rows could be read. Check the columns above.' }),
        el('button', { class: 'btn', disabled: !p.count || !p.account_id, onclick: e => commit(e.target) }, `Import ${p.count} rows`));
    };
    const bulk = p => {
      const box = el('div', { class: 'stack' });
      box.append(table([
        { k: 'name', label: 'File' },
        { k: 'account', label: 'Account', render: f => select([{ v: '', label: 'Choose' }, ...accts.map(a => ({ v: a.id, label: a.name }))],
            f.account_id || acct.value, { class: 'sm', onchange: e => { f.account_id = e.target.value; plan(); } }) },
      ], loaded));
      box.append(table([
        { k: 'account', label: 'Account' }, { k: 'files', label: 'Files', n: true },
        { k: '_p', label: 'Period', render: g => el('span', { class: 'num' }, `${g.period_start} → ${g.period_end}`) },
        { k: 'rows', label: 'Rows', n: true },
        { k: '_g', label: 'Gaps', render: g => g.gaps.filter(x => x.days > 0).map(x => el('div', { class: 'chip warn' }, `${x.from} → ${x.to}`)) },
      ], p.groups));
      if (p.duplicates.length) box.append(el('p', { class: 'note' }, `Already imported: ${p.duplicates.map(d => d.filename).join(', ')}`));
      box.append(el('button', { class: 'btn', disabled: !!p.unassigned || !p.total_rows, onclick: e => commit(e.target) },
        p.unassigned ? 'Choose an account for every file' : `Import ${p.total_rows} rows`));
      return box;
    };
    files.addEventListener('change', async () => {
      loaded = [];
      for (const f of files.files) loaded.push({ name: f.name, text: await f.text() });
      opts.mapping = null; plan();
    });
    acct.addEventListener('change', plan);
    body.append(el('div', { class: 'row mid', style: 'margin-bottom:10px' }, acct, files), out);
    if (ctx.params.import) queueMicrotask(() => body.closest('.panel')?.scrollIntoView({ block: 'start' }));
  } },

  'accounts.link': { title: 'Match payments between accounts', w: 12, deps: ['txn'], async render(body, ctx) {
    const accts = await accountsOf();
    const p = ctx.period;
    const pick = (k, d) => select(accts.map(a => ({ v: a.id, label: a.name })), panels['accounts.link'][k] ?? d,
      { class: 'sm', onchange: e => { panels['accounts.link'][k] = e.target.value; ctx.refresh(); } });
    const st = panels['accounts.link'];
    st.left ??= accts[0]?.id; st.right ??= accts[1]?.id ?? accts[0]?.id;
    const [L, R] = await Promise.all([st.left, st.right].map(id =>
      api.view('v_txn', { account_id: id, date__gte: p.from, date__lte: p.to, order: 'date' })));
    const hideLinked = st.hideLinked ?? true, same = st.same ?? false;
    let sel = st.sel || null, selR = null;
    const linkBtn = el('button', { class: 'btn sm', disabled: true, onclick: async () => {
      await api.link(sel, selR); st.sel = null;
      flash('Linked', { label: 'Undo', fn: async () => { await api.undo(); ctx.changed('txn'); ctx.refresh(); } });
      ctx.changed('txn'); ctx.refresh();
    } }, 'Link selected');
    ctx.aside.append(
      el('label', { class: 'c' }, el('input', { type: 'checkbox', checked: hideLinked, onchange: e => { st.hideLinked = e.target.checked; ctx.refresh(); } }), 'Hide linked'),
      el('label', { class: 'c' }, el('input', { type: 'checkbox', checked: same, onchange: e => { st.same = e.target.checked; ctx.refresh(); } }), 'Same amount only'),
      linkBtn);
    const selAmt = sel ? L.find(r => r.id === sel)?.amount : null;
    const side = (rows, isLeft) => {
      let list = hideLinked ? rows.filter(r => !r.link_id) : rows;
      if (!isLeft && same && selAmt != null) list = list.filter(r => Math.abs(r.amount + selAmt) < 0.005);
      const tb = el('tbody');
      for (const r of list) {
        const cand = !isLeft && selAmt != null && Math.abs(r.amount + selAmt) < 0.005;
        const tr = el('tr', { class: [r.link_id ? 'linked' : '', cand ? 'cand' : '', (isLeft ? sel : selR) === r.id ? 'sel' : ''].join(' ').trim() || null,
          onclick: () => {
            if (isLeft) { st.sel = sel === r.id ? null : r.id; ctx.refresh(); return; }
            selR = selR === r.id ? null : r.id;
            tb.querySelectorAll('tr').forEach(x => x.classList.remove('sel'));
            if (selR) tr.classList.add('sel');
            linkBtn.disabled = !(sel && selR);
          } },
          el('td', { class: 'num', style: 'white-space:nowrap' }, dayShort(r.date)),
          el('td', {}, r.description),
          el('td', { class: 'n' }, signed(r.amount)),
          el('td', { class: 'x' }, r.link_id ? el('span', {}, el('span', { class: 'chip on' }, `↔ ${r.linked_account}`),
            el('button', { class: 'icon', title: 'Unlink', onclick: async e => { e.stopPropagation(); await api.unlink(r.id); ctx.changed('txn'); ctx.refresh(); } }, '×')) : ''));
        tb.append(tr);
      }
      return el('div', {}, el('div', { class: 'row mid', style: 'margin-bottom:6px' }, pick(isLeft ? 'left' : 'right', isLeft ? st.left : st.right),
          el('span', { class: 'muted num' }, `${list.length} rows`)),
        el('div', { class: 'scroll tall' }, el('table', { class: 'g' }, el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Description'), el('th', { class: 'n' }, 'Amount'), el('th'))), tb)));
    };
    body.append(el('div', { class: 'pair' }, side(L, true), side(R, false)));
  } },

  // kept by name for layouts that use it: now savings, investments and pensions together
  'accounts.valuations': { title: 'Savings and investments', w: 6, deps: ['valuation', 'txn', 'account', 'statement', 'contribution'],
    render: (body, ctx) => holdings(body, ctx) },

  'accounts.coverage': { title: 'Missing statements', w: 6, deps: ['statement'], async render(body) {
    const [gaps, accts] = await Promise.all([api.view('v_coverage_gap'), api.table('account')]);
    const name = Object.fromEntries(accts.map(a => [a.id, a.name]));
    body.append(table([{ k: 'account_id', label: 'Account', fmt: v => name[v] },
      { k: 'gap_from', label: 'From', fmt: dateUK }, { k: 'gap_to', label: 'To', fmt: dateUK },
      { k: 'days', label: 'Days', n: true, render: g => g.days > 0 ? String(g.days) : el('span', { class: 'chip bad' }, `overlap ${-g.days}`) }],
      gaps, { empty: 'No gaps between statements' }));
  } },
};

export const layout = [
  { use: 'accounts.list' },
  { use: 'accounts.statements', w: 8 },
  { use: 'accounts.import', w: 4 },
  { use: 'accounts.link' },
  { use: 'accounts.valuations', w: 6 },
  { use: 'accounts.coverage', w: 6 },
];
