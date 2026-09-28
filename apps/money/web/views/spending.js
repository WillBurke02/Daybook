import { api } from '../api.js';
import { el, flash, tiles, tile, table, select, datalist } from '../core/dom.js';
import { money, signed, dayShort, plain } from '../core/format.js';
import { state } from '../core/state.js';
import { KINDS } from './settings.js';
import { panels as receiptPanels, clip, openReceipts } from './receipts.js';

export const title = 'Spending';
export const filters = true;

let showAll = false, unsortedOnly = false, search = '';

export async function categoryOptions() {
  const cats = await api.view('v_category', { order: 'order_key' });
  return cats.map(c => ({ v: c.id, label: c.path, path: c.path, kind: c.kind }));
}

async function periodTxns(ctx) {
  const p = ctx.period;
  let rows = await api.view('v_txn', { date__gte: p.from, date__lte: p.to, order: 'date', desc: 1 });
  const f = ctx.filters;
  return rows.filter(r => (!f.account || String(r.account_id) === String(f.account))
    && (!f.grp || (r.category_group || 'Unsorted') === f.grp)
    && (!ctx.tagIds || ctx.tagIds.has(r.id)));
}

export const panels = {
  ...receiptPanels,
  'spending.tiles': { title: 'This period', w: 12, deps: ['txn', 'category', 'merchant', 'match_rule'], async render(body, ctx) {
    const rows = await periodTxns(ctx);
    const sum = f => rows.filter(f).reduce((a, r) => a + r.amount_share, 0);
    const own = r => ['current', 'credit'].includes(r.account_kind);
    const spent = -sum(r => own(r) && ['spend', 'unmatched'].includes(r.category_kind) && r.amount < 0);
    const income = sum(r => own(r) && r.category_kind === 'income');
    ctx.setTitle(ctx.period.label);
    body.classList.add('flush');
    body.append(tiles(
      tile('Money in', money(income), 'income'),
      tile('Spent', money(spent)),
      tile('Left over', money(income - spent), null, income - spent < 0 ? 'deb' : ''),
      tile('Saved', money(sum(r => ['savings', 'investment'].includes(r.account_kind) && r.category_kind === 'transfer' && r.amount > 0))),
      tile('Lent', money(-sum(r => r.category_kind === 'lending'))),
      tile('Unsorted', String(rows.filter(r => r.category_kind === 'unmatched').length), 'transactions'),
      tile('Transactions', String(rows.length))));
  } },

  'spending.sort': { title: 'To sort', w: 6, deps: ['txn', 'match_rule', 'merchant', 'category'], async render(body, ctx) {
    const [rows, merchants, cats] = await Promise.all([api.review(60), api.table('merchant', { order: 'name' }), categoryOptions()]);
    ctx.setTitle(`To sort · ${rows.length}${rows.length === 60 ? '+' : ''}`);
    datalist('dl-payees', merchants.map(m => m.name));
    datalist('dl-cats', cats.map(c => c.path));
    if (!rows.length) { body.append(el('p', { class: 'note' }, 'Everything has a payee.')); return; }
    const t = el('tbody');
    for (const r of rows) {
      const payee = el('input', { list: 'dl-payees', placeholder: titleCase(r.description_norm), 'aria-label': 'Payee' });
      const cat = el('input', { list: 'dl-cats', placeholder: 'Category', 'aria-label': 'Category' });
      const kind = select(KINDS.map(k => ({ v: k.v, label: k.label })), 'spend', { class: 'sm', title: 'Kind, if the category is new' });
      const rk = select([{ v: 'contains', label: 'contains' }, { v: 'exact', label: 'is exactly' }, { v: 'prefix', label: 'starts with' }], 'contains', { class: 'sm' });
      const pat = el('input', { value: r.description_norm, 'aria-label': 'Rule text' });
      const go = el('button', { class: 'btn sm', type: 'button', onclick: async () => {
        const known = cats.find(c => c.path.toLowerCase() === cat.value.trim().toLowerCase());
        try {
          const res = await api.accept({ description_norm: r.description_norm, payee: payee.value.trim() || titleCase(r.description_norm),
            category_id: known?.v, category: known ? null : cat.value.trim() || null, kind: kind.value,
            rule_kind: rk.value, pattern: pat.value });
          flash(`Sorted ${res.changed} transaction${res.changed === 1 ? '' : 's'}`, { label: 'Undo', fn: async () => { await api.undo(); ctx.changed('match_rule'); ctx.refresh(); } });
          ctx.changed('match_rule'); ctx.refresh();
        } catch (e) { flash(e.message); }
      } }, 'Save');
      [payee, cat, pat].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); }));
      t.append(el('tr', {},
        el('td', {}, el('div', {}, r.example), el('div', { class: 'muted', style: 'font-size:11.5px' },
          `${r.n}× · ${r.accounts} · ${dayShort(r.last_seen)}`)),
        el('td', { class: 'n' }, signed(r.total)),
        el('td', {}, payee), el('td', {}, el('div', { class: 'row mid', style: 'flex-wrap:nowrap' }, cat, kind)),
        el('td', {}, el('div', { class: 'row mid', style: 'flex-wrap:nowrap' }, rk, pat)),
        el('td', { class: 'x' }, go)));
    }
    body.append(el('div', { class: 'scroll tall' }, el('table', { class: 'g' },
      el('thead', {}, el('tr', {}, ['Description', 'Total', 'Payee', 'Category', 'Rule', ''].map((h, i) => el('th', { class: i === 1 ? 'n' : null }, h)))), t)));
  } },

  'spending.txns': { title: 'Transactions', w: 12, deps: ['txn', 'match_rule', 'merchant', 'category', 'txn_tag'], async render(body, ctx) {
    let rows = await periodTxns(ctx);
    const cats = await categoryOptions();
    const tags = await api.table('tag', { order: 'name' });
    if (unsortedOnly) rows = rows.filter(r => r.category_kind === 'unmatched');
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r => [r.description, r.merchant, r.category_path, r.note, String(r.amount)].some(x => (x || '').toLowerCase().includes(q)));
    }
    const total = rows.length;
    const shown = showAll ? rows : rows.slice(0, 300);
    const [tagMap, receipts] = shown.length ? await Promise.all([api.tagsOf(shown.map(r => r.id)), api.receiptsFor(shown.map(r => r.id))]) : [{}, {}];
    const refreshed = () => { ctx.changed('receipt'); ctx.refresh(); };
    const s = el('input', { value: search, placeholder: 'Search', class: 'sm', style: 'width:160px' });
    s.addEventListener('change', () => { search = s.value; ctx.refresh(); });
    ctx.aside.append(s,
      el('label', { class: 'c' }, el('input', { type: 'checkbox', checked: unsortedOnly, onchange: e => { unsortedOnly = e.target.checked; ctx.refresh(); } }), 'Unsorted'),
      el('span', { class: 'muted num' }, `${total} rows`),
      total > 300 ? el('button', { class: 'link', onclick: () => { showAll = !showAll; ctx.refresh(); } }, showAll ? 'Show 300' : 'Show all') : null);
    const save = async (id, patch) => {
      try { await api.save('txn', { id, ...patch }); ctx.changed('txn'); } catch (e) { flash(e.message); }
    };
    const tb = el('tbody');
    for (const r of shown) {
      const cs = select([{ v: '', label: r.own_category_id ? '— payee’s —' : '—' }, ...cats], r.category_id, { 'aria-label': 'Category' });
      cs.addEventListener('change', async () => { await save(r.id, { category_id: cs.value || null }); ctx.refresh(); });
      const note = el('input', { value: r.note || '', 'aria-label': 'Note' });
      note.addEventListener('change', () => save(r.id, { note: note.value }));
      const tagCell = el('td', {}, (tagMap[r.id] || []).map(t => el('span', { class: 'chip', style: 'margin-right:3px' }, t.name,
        el('span', { class: 'x', title: 'Remove tag', onclick: async () => { await api.untagTxn(r.id, t.id); ctx.changed('txn_tag'); ctx.refresh(); } }, '×'))),
        select([{ v: '', label: '+' }, ...tags.filter(t => !(tagMap[r.id] || []).some(x => x.id === t.id)).map(t => ({ v: t.id, label: t.name }))], '',
          { class: 'sm', style: 'width:44px', 'aria-label': 'Add tag', onchange: async e => { await api.tagTxn(r.id, e.target.value); ctx.changed('txn_tag'); ctx.refresh(); } }));
      const tr = el('tr', { class: r.link_id ? 'linked' : null },
        el('td', { class: 'x' }, clip(r, receipts[r.id], refreshed)),
        el('td', { class: 'num', style: 'white-space:nowrap' }, dayShort(r.date)),
        el('td', { style: 'white-space:nowrap' }, el('span', { class: 'dot', style: r.account_colour ? `--dot:${r.account_colour}` : null }), r.account),
        el('td', { title: r.description_norm }, r.description),
        el('td', {}, r.merchant || el('span', { class: 'muted' }, '—')),
        el('td', { style: 'min-width:170px' }, r.link_id ? el('span', { class: 'chip on' }, `↔ ${r.linked_account}`) : cs),
        el('td', { class: 'n' }, signed(r.amount)),
        tagCell,
        el('td', { style: 'min-width:120px' }, note));
      tr._row = r;                                            // the right-click menu: this payment, and a receipt for it
      tr._menu = () => [{ label: 'Attach a receipt…', fn: () => openReceipts(r, refreshed) }, '-'];
      tb.append(tr);
    }
    body.append(el('div', { class: 'scroll tall' }, el('table', { class: 'g' },
      el('thead', {}, el('tr', {}, ['', 'Date', 'Account', 'Description', 'Payee', 'Category', 'Amount', 'Tags', 'Note']
        .map(h => el('th', { class: h === 'Amount' ? 'n' : null }, h)))), tb)));
  } },

  'spending.budget': { title: 'Budget', w: 4, deps: ['category', 'txn'], async render(body, ctx) {
    const p = ctx.period;
    const rows = await api.view('v_budget', { month__gte: p.fromMonth, month__lte: p.toMonth });
    const by = {};
    for (const r of rows) {
      const b = by[r.category_id] ||= { path: r.path, budget: 0, actual: 0 };
      b.budget += r.budget; b.actual += r.actual;
    }
    const list = Object.values(by).sort((a, b) => b.budget - a.budget);
    if (!list.length) { body.append(el('p', { class: 'note' }, 'Set budgets in Settings → Categories.')); return; }
    body.append(table([
      { k: 'path', label: 'Category' },
      { k: 'budget', label: 'Budget', n: true, fmt: money },
      { k: 'actual', label: 'Spent', n: true, fmt: money },
      { k: '_bar', label: '', sort: false, render: r => el('div', { class: 'bar' + (r.actual > r.budget ? ' over' : '') },
          el('i', { style: `width:${Math.min(100, r.budget ? r.actual / r.budget * 100 : 0)}%` })) },
      { k: '_left', label: 'Left', n: true, render: r => el('span', { class: r.budget - r.actual < 0 ? 'deb num' : 'num' }, money(r.budget - r.actual)) },
    ], list));
  } },

  'spending.owed': { title: 'Lending and debts', w: 4, deps: ['txn', 'txn_tag', 'category'], async render(body) {
    const rows = await api.view('v_owed');
    body.append(table([
      { k: 'person', label: 'Person' }, { k: 'lent', label: 'Lent', n: true, fmt: money },
      { k: 'borrowed', label: 'Borrowed', n: true, fmt: money },
      { k: 'net', label: 'Owed to you', n: true, render: r => signed(r.net) },
    ], rows, { empty: 'Nothing lent or borrowed' }));
  } },

  'spending.tags': { title: 'By tag', w: 4, deps: ['txn_tag', 'txn'], async render(body, ctx) {
    const p = ctx.period;
    const rows = await api.view('v_tag_spend', { date__gte: p.from, date__lte: p.to });
    const by = {};
    for (const r of rows) { const t = by[r.tag] ||= { tag: r.tag, kind: r.tag_kind, n: 0, total: 0 }; t.n++; t.total += r.amount; }
    body.append(table([{ k: 'tag', label: 'Tag' }, { k: 'kind', label: '' }, { k: 'n', label: 'Items', n: true },
      { k: 'total', label: 'Spent', n: true, fmt: money }], Object.values(by).sort((a, b) => b.total - a.total),
      { empty: 'No tagged spending in this period' }));
  } },
};

export const titleCase = s => (s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

export const layout = [
  { use: 'spending.tiles' },
  { type: 'chart', id: 'spend-groups', title: 'Where it went', w: 5, source: 'v_spend', date: 'date',
    x: 'grp', y: ['amount'], names: { amount: 'Spent' }, chart: 'pie' },
  { type: 'chart', id: 'spend-time', title: 'Spending over time', w: 7, source: 'v_spend', date: 'date',
    x: 'date', y: ['amount'], split: 'grp', chart: 'stacked', grain: 'month', window: '12m' },
  { use: 'spending.sort', w: 12 },
  { use: 'spending.txns' },
  { type: 'chart', id: 'spend-payees', title: 'Biggest payees', w: 4, source: 'v_spend', date: 'date',
    x: 'payee', y: ['amount'], names: { amount: 'Spent' }, chart: 'hbar' },
  { type: 'chart', id: 'in-out', title: 'In and out', w: 4, source: 'v_money', date: 'date',
    x: 'date', y: ['money_in', 'money_out'], names: { money_in: 'In', money_out: 'Out' }, where: { kind__ne: 'transfer' },
    chart: 'bar', grain: 'month', window: '12m' },
  { use: 'spending.budget', w: 4 },
  { use: 'spending.receipts', w: 6 },
  { use: 'spending.owed', w: 6 },
  { use: 'spending.tags', w: 6 },
];
