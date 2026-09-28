import { api } from '../api.js';
import { el, flash, table, select, dialog, readVal, writeVal, seg } from '../core/dom.js';
import { money, signed, dayShort } from '../core/format.js';
import { extraCols, loadMeta, settingsForm } from '../core/state.js';
import { grid } from '../ui/grid.js';
import { pkSave } from './pay.js';

export const title = 'Settings';

export const KINDS = [
  { v: 'spend', label: 'Spending' }, { v: 'income', label: 'Income' }, { v: 'transfer', label: 'Transfer' },
  { v: 'saving', label: 'Saving' }, { v: 'interest', label: 'Interest' },
  { v: 'lending', label: 'Lending' }, { v: 'borrowing', label: 'Borrowing' }];

let focusCat = null;

// --- the category tree --------------------------------------------------------

async function tree(body, ctx) {
  const p = ctx.period;
  const [cats, spend] = await Promise.all([
    api.view('v_cat_tree', { order: 'order_key' }),
    api.view('v_spend', { date__gte: p.from, date__lte: p.to })]);
  const byId = Object.fromEntries(cats.map(c => [c.id, { ...c, kids: [], spent: 0 }]));
  const roots = [];
  for (const c of cats) (c.parent_id && byId[c.parent_id] ? byId[c.parent_id].kids : roots).push(byId[c.id]);
  for (const s of spend) {                              // roll spending up every level
    for (let n = byId[s.category_id]; n; n = byId[n.parent_id]) n.spent += s.amount;
  }
  let shut;
  try { shut = new Set(JSON.parse(readVal('tree:shut', '[]'))); } catch { shut = new Set(); }
  const keep = () => writeVal('tree:shut', JSON.stringify([...shut]));
  const within = (a, b) => { for (let n = byId[b]; n; n = byId[n.parent_id]) if (n.id === a) return true; return false; };
  const save = async rows => {
    try { await api.save('category', rows); ctx.changed('category'); ctx.refresh(); } catch (e) { flash(e.message); }
  };
  let dragId = null;

  const node = n => {
    const tog = el('button', { class: 'tog', type: 'button', 'aria-label': shut.has(n.id) ? 'Expand' : 'Collapse',
      onclick: () => { shut.has(n.id) ? shut.delete(n.id) : shut.add(n.id); keep(); ctx.refresh(); } },
      n.kids.length ? (shut.has(n.id) ? '▸' : '▾') : '');
    const name = el('input', { value: n.name, 'aria-label': 'Name', data: { cell: `cat:${n.id}:name` } });
    name.addEventListener('change', () => name.value.trim() && save({ id: n.id, name: name.value.trim() }));
    name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
    const kind = select(KINDS, n.kind, { 'aria-label': 'Kind', onchange: e => save({ id: n.id, kind: e.target.value }) });
    const budget = el('input', { value: n.budget ?? '', inputmode: 'decimal', style: 'text-align:right',
                                 'aria-label': 'Monthly budget' });
    budget.addEventListener('change', () => save({ id: n.id, budget: budget.value === '' ? null : +budget.value }));
    const handle = el('span', { class: 'handle', title: 'Drag onto another category' }, '⋮⋮');
    const row = el('div', { class: 'node' }, tog, handle, name, kind, budget,
      el('span', { class: 'cnt', title: `${n.txns} transactions, ${n.payees} payees` }, n.spent ? money(n.spent) : ''),
      el('span', { style: 'white-space:nowrap' },
        el('button', { class: 'icon', type: 'button', title: 'Add a category inside this one', onclick: async () => {
          const r = await api.save('category', { parent_id: n.id, name: 'New', kind: n.kind });
          focusCat = r.ids[0]; shut.delete(n.id); keep(); ctx.changed('category'); ctx.refresh();
        } }, '+'),
        el('button', { class: 'icon del', type: 'button', title: 'Delete', onclick: () => remove(n) }, '×')));
    handle.addEventListener('mousedown', () => { row.draggable = true; });
    row.addEventListener('dragstart', e => { dragId = n.id; e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', () => { row.draggable = false; dragId = null; });
    const zone = e => {
      const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
      return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'in';
    };
    row.addEventListener('dragover', e => {
      if (dragId == null || dragId === n.id || within(dragId, n.id)) return;
      e.preventDefault();
      row.classList.remove('drop-in', 'drop-before', 'drop-after'); row.classList.add('drop-' + zone(e));
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-in', 'drop-before', 'drop-after'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      const z = zone(e), id = dragId;
      row.classList.remove('drop-in', 'drop-before', 'drop-after');
      if (id == null || id === n.id || within(id, n.id)) return;
      if (z === 'in') return save({ id, parent_id: n.id, sort: (Math.max(0, ...n.kids.map(k => k.sort)) + 1) });
      const siblings = (n.parent_id ? byId[n.parent_id].kids : roots).filter(k => k.id !== id);
      const at = siblings.indexOf(n) + (z === 'after' ? 1 : 0);
      siblings.splice(at, 0, byId[id]);
      save(siblings.map((k, i) => ({ id: k.id, sort: i, ...(k.id === id ? { parent_id: n.parent_id } : {}) })));
    });
    return el('li', {}, row, n.kids.length && !shut.has(n.id) ? el('ul', {}, n.kids.map(node)) : null);
  };

  const remove = n => {
    const others = cats.filter(c => c.id !== n.id).map(c => ({ v: c.id, label: c.path }));
    const to = select([{ v: '', label: 'Unsorted' }, ...others], '');
    dialog(`Delete ${n.name}`, el('div', { class: 'stack' },
      el('p', { style: 'margin:0' }, `${n.payees} payees and ${n.txns} transactions use it.`
        + (n.kids.length ? ` Its ${n.kids.length} categories move up a level.` : '')),
      el('label', { class: 'f' }, 'Move them to', to)),
      [{ label: 'Delete', cls: 'btn danger', fn: async () => {
        await api.deleteCategory(n.id, to.value || null);
        flash(`Deleted ${n.name}`, { label: 'Undo', fn: async () => { await api.undo(); ctx.refresh(); } });
        ctx.changed('category'); ctx.refresh();
      } }]);
  };

  const rootDrop = el('div', { class: 'root-drop' }, 'Drop here to make it a top-level category');
  rootDrop.addEventListener('dragover', e => { if (dragId != null) { e.preventDefault(); rootDrop.classList.add('drop-in'); } });
  rootDrop.addEventListener('dragleave', () => rootDrop.classList.remove('drop-in'));
  rootDrop.addEventListener('drop', e => { e.preventDefault(); rootDrop.classList.remove('drop-in');
    if (dragId != null) save({ id: dragId, parent_id: null, sort: roots.length }); });

  ctx.aside.append(
    el('button', { class: 'btn sm', onclick: async () => {
      const r = await api.save('category', { name: 'New group', kind: 'spend', sort: roots.length });
      focusCat = r.ids[0]; ctx.changed('category'); ctx.refresh();
    } }, '+ Group'),
    el('button', { class: 'btn plain sm', onclick: () => { cats.forEach(c => shut.add(c.id)); keep(); ctx.refresh(); } }, 'Collapse all'),
    el('button', { class: 'btn plain sm', onclick: () => { shut.clear(); keep(); ctx.refresh(); } }, 'Expand all'));
  body.append(
    el('div', { class: 'tree' }, el('div', { class: 'node head' },
      el('span'), el('span'), el('span', {}, 'Name'), el('span', {}, 'Kind'), el('span', { style: 'text-align:right' }, 'Budget / month'),
      el('span', { style: 'text-align:right' }, 'This period'), el('span'))),
    el('ul', { class: 'tree' }, roots.map(node)), rootDrop);
  if (focusCat) {
    const i = body.querySelector(`[data-cell="cat:${focusCat}:name"]`);
    focusCat = null;
    if (i) { i.focus(); i.select(); }
  }
}

// --- the rest -----------------------------------------------------------------

export const panels = {
  'settings.categories': { title: 'Categories', w: 6, deps: ['category', 'txn'], render: tree },

  'settings.rules': { title: 'Payee rules', w: 6, deps: ['match_rule', 'merchant', 'category'], async render(body, ctx) {
    const [rows, merchants, cats] = await Promise.all([
      api.view('v_rule', { order: 'priority' }), api.table('merchant', { order: 'name' }),
      api.view('v_category', { order: 'order_key' })]);
    const payees = merchants.map(m => ({ v: m.id, label: m.name }));
    const catOpts = [{ v: '', label: '—' }, ...cats.map(c => ({ v: c.id, label: c.path }))];
    ctx.aside.append(el('button', { class: 'btn plain sm', onclick: async () => {
      const r = await api.rescan(false); flash(`${r.changed} transactions changed`); ctx.changed('match_rule');
    } }, 'Re-apply rules'));
    const kinds = [{ v: 'contains', label: 'contains' }, { v: 'exact', label: 'is exactly' },
                   { v: 'prefix', label: 'starts with' }, { v: 'regex', label: 'pattern (regex)' }];
    body.append(grid({ table: 'match_rule', rows: rows.sort((a, b) => a.pattern.localeCompare(b.pattern)), scroll: 'mid',
      cols: [{ k: 'kind', label: 'When the description', type: 'select', options: kinds, width: '130px' },
             { k: 'pattern', label: 'Text', required: true },
             { k: 'merchant_id', label: 'Payee', type: 'select', options: payees, required: true },
             { k: 'category_id', label: 'Payee’s category', render: r => select(catOpts, r.category_id, {
                 onchange: async e => { await api.save('merchant', { id: r.merchant_id, category_id: e.target.value || null });
                                        ctx.changed('merchant'); ctx.refresh(); } }) },
             { k: 'priority', label: 'Priority', type: 'number', n: true, width: '70px', placeholder: '100' }],
      save: (row, patch) => api.save('match_rule', { id: row.id, ...patch }),
      draft: { kind: 'contains', priority: 100 },
      onChange: () => { ctx.changed('match_rule'); ctx.refresh(); }, onSaved: () => ctx.changed('match_rule') }));

    // try it before it is saved
    const q = el('input', { placeholder: 'Paste a description from a statement', style: 'flex:1;min-width:200px' });
    const out = el('div', { class: 'note' });
    let mode = 'test', kind = 'contains';
    const run = async () => {
      out.innerHTML = '';
      if (!q.value.trim()) return;
      if (mode === 'test') {
        const r = await api.ruleTest(q.value);
        out.append(el('div', {}, 'Cleaned: ', el('code', {}, r.norm)), el('div', {}, r.rule
          ? `Matched by “${r.rule.kind} ${r.rule.pattern}” → ${r.rule.payee}` : 'No rule matches it'));
      } else {
        const r = await api.rulePreview(kind, q.value);
        out.append(el('div', {}, `${r.count} transactions would match`),
          table([{ k: 'date', fmt: dayShort }, { k: 'account' }, { k: 'description' }, { k: 'amount', n: true, render: x => signed(x.amount) },
                 { k: 'merchant', label: 'Payee now' }], r.sample));
      }
    };
    q.addEventListener('input', () => { clearTimeout(q.t); q.t = setTimeout(run, 250); });
    body.append(el('div', { class: 'row mid', style: 'margin-top:12px' },
      seg([{ v: 'test', label: 'Test a description' }, { v: 'preview', label: 'Preview a rule' }], mode, v => { mode = v; kindSel.hidden = v === 'test'; run(); }),
      q), out);
    const kindSel = select(kinds, kind, { class: 'sm', hidden: true, onchange: e => { kind = e.target.value; run(); } });
    q.before(kindSel);
  } },

  'settings.payees': { title: 'Payees', w: 6, deps: ['merchant', 'category', 'txn'], async render(body, ctx) {
    const [rows, cats, tags] = await Promise.all([api.view('v_merchant_total', { order: 'name' }),
      api.view('v_category', { order: 'order_key' }), api.table('tag', { order: 'name' })]);
    body.append(grid({ table: 'merchant', rows, scroll: 'mid',
      cols: [{ k: 'name', label: 'Payee', required: true },
             { k: 'category_id', label: 'Category', type: 'select', options: [{ v: '', label: '—' }, ...cats.map(c => ({ v: c.id, label: c.path }))] },
             { k: 'default_tag', label: 'Tag', type: 'select', options: [{ v: '', label: '—' }, ...tags.map(t => ({ v: t.id, label: t.name }))] },
             { k: 'n', label: 'Items', n: true, readonly: true },
             { k: 'total', label: 'Net', n: true, render: r => signed(-(r.total || 0)) },
             { k: 'rules', label: 'Rules', n: true, readonly: true },
             ...extraCols('merchant')],
      save: (row, patch) => api.save('merchant', { id: row.id, ...patch }),
      draft: {}, onChange: () => { ctx.changed('merchant'); ctx.refresh(); }, onSaved: () => ctx.changed('merchant') }));
  } },

  'settings.tags': { title: 'Tags', w: 6, deps: ['tag'], async render(body, ctx) {
    const rows = await api.table('tag', { order: 'name' });
    body.append(grid({ table: 'tag', rows, scroll: 'mid',
      cols: [{ k: 'name', label: 'Tag', required: true },
             { k: 'kind', label: 'Kind', type: 'select', options: ['vehicle', 'person', 'trip', 'job', 'project', 'thing'] },
             { k: 'closed', label: 'Closed', type: 'check' }, { k: 'note', label: 'Note' }, ...extraCols('tag')],
      draft: { kind: 'thing' }, onChange: () => { ctx.changed('tag'); ctx.refresh(); } }));
  } },

  'settings.accounts': { title: 'Accounts', w: 6, deps: ['account'], async render(body, ctx) {
    const rows = await api.table('account', { order: 'sort_order' });
    body.append(grid({ table: 'account', rows,
      cols: [{ k: 'colour', label: '', type: 'color', width: '46px' },
             { k: 'name', label: 'Account', required: true },
             { k: 'kind', label: 'Kind', type: 'select', options: ['current', 'savings', 'investment', 'credit', 'pension'], required: true },
             { k: 'provider', label: 'Provider', width: '110px' },
             { k: 'last4', label: 'Last 4', width: '64px' }, { k: 'sort_code', label: 'Sort code', width: '90px' },
             { k: 'share_pct', label: 'Your share %', type: 'number', n: true, width: '80px' },
             { k: 'sort_order', label: 'Order', type: 'number', n: true, width: '56px' },
             { k: 'archived', label: 'Hidden', type: 'check' }, ...extraCols('account')],
      draft: { kind: 'current', share_pct: 100 },
      onSaved: async () => { await loadMeta(); ctx.changed('account'); },
      onChange: async () => { await loadMeta(); ctx.changed('account'); ctx.reload(); } }));
  } },

  'settings.overtime': { title: 'Overtime rules', w: 3, deps: ['day_rule'], async render(body, ctx) {
    const rows = await api.table('day_rule');
    const order = [1, 2, 3, 4, 5, 6, 0];
    body.append(grid({ table: 'day_rule', key: 'dow', rows: order.map(d => rows.find(r => r.dow === d)).filter(Boolean),
      del: false, cols: [{ k: 'name', label: 'Day', readonly: true },
        { k: 'normal_hours', label: 'Normal up to', type: 'number', n: true },
        { k: 'ot_mult', label: 'Then ×', type: 'number', n: true }],
      onSaved: () => ctx.changed('day_rule') }),
      settingsForm([['ot_net', 'Short weekdays', [{ v: '0', label: 'Count as nothing (per day)' },
                                                { v: '1', label: 'Take off overtime (net)' }]]], ctx));
  } },

  'settings.bank': { title: 'Bank holidays', w: 3, deps: ['bank_holiday'], async render(body, ctx) {
    const rows = await api.table('bank_holiday', { order: 'date' });
    body.append(grid({ table: 'bank_holiday', key: 'date', rows, scroll: 'mid', save: pkSave('bank_holiday', 'date'),
      cols: [{ k: 'date', label: 'Date', type: 'date', required: true }, { k: 'name', label: 'Name', required: true }],
      draft: {}, onChange: () => { ctx.changed('bank_holiday'); ctx.refresh(); } }));
  } },

  'settings.tax': { title: 'Tax figures', w: 12, deps: ['rate_band', 'tax_year_cfg'], async render(body, ctx) {
    const [bands, cfg] = await Promise.all([api.table('rate_band', { order: 'tax_year', desc: 1 }), api.table('tax_year_cfg', { order: 'tax_year', desc: 1 })]);
    const key = r => ({ tax_year: r.tax_year, kind: r.kind, lower: r.lower });
    bands.sort((a, b) => b.tax_year - a.tax_year || a.kind.localeCompare(b.kind) || a.lower - b.lower);
    body.append(el('div', { class: 'pair' },
      grid({ table: 'rate_band', rows: bands, scroll: 'mid',
        cols: [{ k: 'tax_year', label: 'Tax year', type: 'number', readonly: false, required: true, width: '80px' },
               { k: 'kind', label: 'Kind', type: 'select', required: true, width: '96px',
                 options: ['income', 'ni_ee', 'ni_er', 'plan1', 'plan2', 'plan4', 'plan5', 'pgl'] },
               { k: 'lower', label: 'From £', type: 'number', n: true, required: true },
               { k: 'upper', label: 'To £', type: 'number', n: true, required: true },
               { k: 'rate', label: 'Rate', type: 'number', n: true, required: true }],
        save: async (row, patch) => {
          if (['tax_year', 'kind', 'lower'].some(k => k in patch)) {
            await api.save('rate_band', { ...row, ...patch }); await api.removeWhere('rate_band', key(row));
          } else await api.save('rate_band', { ...key(row), ...patch });
        },
        remove: row => api.removeWhere('rate_band', key(row)),
        draft: {}, onChange: () => ctx.refresh() }),
      grid({ table: 'tax_year_cfg', key: 'tax_year', rows: cfg,
        cols: [{ k: 'tax_year', label: 'Tax year', type: 'number', required: true },
               { k: 'personal_allowance', label: 'Personal allowance', type: 'number', n: true, required: true },
               { k: 'pa_taper_start', label: 'Taper from', type: 'number', n: true, required: true },
               { k: 'pa_taper_rate', label: 'Taper rate', type: 'number', n: true, required: true }],
        save: pkSave('tax_year_cfg', 'tax_year'), draft: {}, onChange: () => ctx.refresh() })));
  } },

};

export const layout = [
  { use: 'settings.categories', w: 6 },
  { use: 'settings.rules', w: 6 },
  { use: 'settings.payees', w: 6 },
  { use: 'settings.accounts', w: 6 },
  { use: 'settings.tags', w: 6 },
  { use: 'settings.overtime', w: 3 },
  { use: 'settings.bank', w: 3 },
  { use: 'pay.settings', w: 6 },
  { use: 'pay.rates', w: 6 },
  { use: 'settings.tax' },
];
