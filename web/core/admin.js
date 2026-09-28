// Admin: the suite's password, themes and keys, then this app's databases,
// page structure, columns, raw data, and the tools that can break things —
// each of which takes a backup first.
import { api, suite } from './api.js';
import { el, flash, table, select, download, toCSV, dialog } from './dom.js';
import { dateUK } from './format.js';
import { state, loadMeta, label } from './state.js';
import { grid } from '../ui/grid.js';
import { useTheme, themeCSS, slug } from './theme.js';
import { banner } from './pages.js';
import { FONTS, TABLE_STYLES } from './layout.js';
import { randomTheme } from '../ui/palette.js';

const panel = (title, w, ...kids) => el('section', { class: 'panel' + (w < 6 ? ' narrow' : ''), style: `--w:${w}` },
  el('header', {}, el('h2', {}, title)), el('div', { class: 'body' }, ...kids));
let APP, PAGES;

export async function render(main, { reload, app, pages: all }) {
  APP = app; PAGES = all;
  const g = el('div', { class: 'grid' });
  main.querySelector('.pagehead')?.set(`Admin`, `Every app, then ${app.title}’s own`);
  if (state.meta.password_default) main.querySelector('.pagehead .ctl')?.append(el('span', { class: 'chip bad' }, 'Still using the default password'));
  main.append(g);
  g.append(el('h2', { class: 'admin-h' }, 'Every app'), password(), keys(), themes(),
           el('h2', { class: 'admin-h' }, app.title), databases(), pages(reload), columns(reload),
           data(), sql(reload), views(reload), backups(reload), health());
}

// --- databases -----------------------------------------------------------------
// Open another database file. It is checked read-only first and shown to you;
// its own admin password opens it; the one you leave is backed up.

const size = b => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

async function openDb(path) {
  let info;
  try { info = await api.admin.inspect(path); } catch (e) { return flash(e.message); }
  const facts = [
    ['File', info.path], ['Size', size(info.size)],
    ['Checked', info.problem ? el('span', { class: 'deb' }, info.problem) : el('span', { class: 'cre' }, 'Not damaged')],
    ...(info.problem ? [] : [...info.facts,
      ['Version', info.upgrade ? 'Older than this app: it will be upgraded, after a backup' : 'Same as this app']]),
  ];
  dialog(`Open ${info.name}?`, el('div', { class: 'stack' },
    table([{ k: 0, label: '' }, { k: 1, label: '' }], facts),
    info.problem ? null : el('p', { class: 'note' }, `${state.meta.db} is backed up first. Then everything you see in ${APP.title}, and every `,
      `change you make there, is ${info.name}'s, until you switch back. ${APP.title} opens it next time too.`)),
    info.problem ? [] : [{ label: `Open ${info.name}`, cls: 'btn', fn: async () => {
      try { await api.admin.switchDb(info.path); location.reload(); } catch (e) { flash(e.message); return false; }
    } }]);
}

function databases() {
  const box = el('div');
  const path = el('input', { class: 'sm', placeholder: `or a path, e.g. E:\\daybook\\${APP.name}-2025.db`, style: 'flex:1;min-width:220px' });
  const name = el('input', { class: 'sm', placeholder: 'Name for a new one', style: 'width:180px' });
  const create = copy => {
    const n = name.value.trim();
    if (!n) return flash('Give the new database a name');
    dialog(copy ? `Copy ${state.meta.db} as ${n}?` : `Start ${n} empty?`, el('p', {},
      copy ? `A copy of everything in ${state.meta.db}, to try things on. ` : `An empty ${APP.title} database. `,
      `It opens straight away; ${state.meta.db} is backed up first and stays as it is.`),
      [{ label: copy ? 'Make the copy' : 'Create it', cls: 'btn', fn: async () => {
        try { await api.admin.newDb(n, copy); location.reload(); } catch (e) { flash(e.message); return false; }
      } }]);
  };
  api.admin.dbs().then(({ files }) => box.replaceChildren(
    table([{ k: 'name', label: 'Database', render: f => el('strong', {}, f.name) },
           { k: 'folder', label: 'Folder', render: f => el('span', { class: 'muted' }, f.folder) },
           { k: 'size', label: 'Size', n: true, fmt: size },
           { k: 'modified', label: 'Changed', fmt: t => dateUK(new Date(t * 1000).toISOString().slice(0, 10)) },
           { k: '_', label: '', sort: false, render: f => f.current ? el('span', { class: 'chip ok' }, 'open')
               : el('button', { class: 'btn plain sm', onclick: () => openDb(f.path) }, 'Open…') }], files),
    el('div', { class: 'row', style: 'margin-top:8px' }, path,
      el('button', { class: 'btn plain sm', onclick: () => path.value.trim() && openDb(path.value.trim()) }, 'Check and open…')),
    el('div', { class: 'row', style: 'margin-top:8px' }, name,
      el('button', { class: 'btn plain sm', onclick: () => create(false) }, 'New, empty'),
      el('button', { class: 'btn plain sm', onclick: () => create(true) }, `New, a copy of ${state.meta.db}`))));
  return panel(`${APP.title} databases`, 12, box);
}

// --- themes --------------------------------------------------------------------
// A theme is the app's colour tokens plus a font, sizes and a table look. The
// whole app is the preview: every change shows at once, and Close puts it back.

const COLOURS = [['Page', '--ground'], ['Panels', '--panel'], ['Panel shade', '--panel-2'], ['Boxes', '--raised'],
  ['Text', '--ink'], ['Text, quiet', '--ink-2'], ['Text, faint', '--ink-3'], ['Lines', '--rule'], ['Lines, soft', '--rule-soft'],
  ['Accent (Home)', '--accent'], ['Accent, soft', '--accent-soft'], ['Text on accent', '--accent-ink'],
  ['Money', '--c-money'], ['Money, soft', '--c-money-soft'], ['Log', '--c-log'], ['Log, soft', '--c-log-soft'],
  ['Learn', '--c-learn'], ['Learn, soft', '--c-learn-soft'], ['Text on an app colour', '--on-accent'],
  ['Money out', '--debit'], ['Money in', '--credit'], ['Warning', '--flag'],
  ['Chart 1', '--s1'], ['Chart 2', '--s2'], ['Chart 3', '--s3'], ['Chart 4', '--s4'], ['Chart 5', '--s5'], ['Chart 6', '--s6'],
  ['Calendar, least', '--seq-1'], ['Calendar 2', '--seq-2'], ['Calendar 3', '--seq-3'], ['Calendar 4', '--seq-4'], ['Calendar, most', '--seq-5'],
  ['Day off', '--leave'], ['Day off, soft', '--leave-soft'], ['Bank holiday', '--bh-soft'],
  ['Table heading', '--th-bg'], ['Table heading text', '--th-ink'], ['Row lines', '--row-line']];
const px = a => a.map(v => ({ v: v + 'px', label: v + 'px' }));
const CHOICES = [['Font', '--sans', FONTS.slice(1)], ['Numbers', '--mono', FONTS.slice(1)],
  ['Text size', '--base-size', px([12, 13, 14, 15, 16, 18])], ['Table text', '--t-font-size', px([11, 12, 13, 14, 15, 16])],
  ['Row spacing', '--t-pad-y', [{ v: '2px', label: 'Tight' }, { v: '4px', label: 'Normal' }, { v: '7px', label: 'Roomy' }]],
  ['Table headings', '--th-case', [{ v: 'uppercase', label: 'CAPITALS' }, { v: 'none', label: 'As written' }]],
  ['Corners', '--r', [{ v: '0px', label: 'Square' }, { v: '3px', label: 'Slight' }, { v: '6px', label: 'Rounded' }, { v: '12px', label: 'Round' }]],
  ['Tables', 'tableStyle', TABLE_STYLES.slice(1)]];
const UNSET = { '--th-bg': '--panel', '--th-ink': '--ink-3', '--row-line': '--rule-soft' };   // defaults that follow another token
const START = { '--base-size': '14px', '--t-font-size': '13px', '--t-pad-y': '4px', '--th-case': 'none', tableStyle: 'clean' };
const root = document.documentElement;

/** Every token as it stands in a mode, read off the page itself. */
function readMode(mode) {
  const was = root.dataset.mode;
  if (mode === 'system') delete root.dataset.mode; else root.dataset.mode = mode;
  const cs = getComputedStyle(root), get = k => cs.getPropertyValue(k).trim();
  const out = { ...START };
  for (const [, k] of [...COLOURS, ...CHOICES]) if (k.startsWith('--')) out[k] = get(k) || (UNSET[k] ? get(UNSET[k]) : START[k] || '');
  if (was) root.dataset.mode = was; else delete root.dataset.mode;
  return out;
}

function themes() {
  const box = el('div');
  let vars = {}, scheme = 'light', editing = null;
  const unpreview = () => { for (const k of Object.keys(vars)) if (k.startsWith('--')) root.style.removeProperty(k); };
  const preview = () => { for (const [k, v] of Object.entries(vars)) if (k.startsWith('--') && v) root.style.setProperty(k, v); };
  const name = el('input', { placeholder: 'Theme name', class: 'sm' });
  const base = select([{ v: 'paper', label: 'Paper' }, { v: 'dusk', label: 'Dusk' }, { v: 'ink', label: 'Ink' },
    ...state.meta.themes.map(t => ({ v: slug(t.name), label: t.name }))], 'paper', { class: 'sm' });
  const sch = select([{ v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }], 'light', { class: 'sm' });
  const sample = el('div', { class: 'theme-preview' });
  const form = el('div');
  const draw = () => {
    const ctl = ([label, k, opts]) => {
      const cur = vars[k] || '';
      const i = opts ? select(opts, opts.find(o => cur.startsWith(o.v))?.v ?? cur, { class: 'sm' })
                     : el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#888888' });
      i.addEventListener('input', () => {
        vars[k] = k === '--sans' ? `${i.value}, system-ui, sans-serif` : k === '--mono' ? `${i.value}, ui-monospace, monospace` : i.value;
        preview(); drawSample();
      });
      return el('label', {}, i, label);
    };
    form.replaceChildren(
      el('h3', {}, 'Colours'), el('div', { class: 'swatches' }, COLOURS.map(ctl)),
      el('h3', {}, 'Type and tables'), el('div', { class: 'swatches' }, CHOICES.map(ctl)));
    drawSample();
  };
  const drawSample = () => {
    sample.replaceChildren(el('section', { class: `panel ts-${vars.tableStyle || 'clean'}`, style: '--w:12;margin:0' },
      el('header', {}, el('h2', {}, 'Preview')),
      el('div', { class: 'body' }, el('div', { class: 'scroll' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Payee'), el('th', { class: 'n' }, 'Amount'))),
        el('tbody', {}, [['Mon 7 Sep', 'Tesco', '-£42.10', 'deb'], ['Thu 17 Sep', 'TS247', '+£1,786.40', 'cre'], ['Fri 18 Sep', 'Shell', '-£61.02', 'deb']]
          .map(([d, p, a, c]) => el('tr', {}, el('td', {}, d), el('td', {}, p), el('td', { class: 'n' }, el('span', { class: c + ' num' }, a))))))),
        el('div', { class: 'row', style: 'margin-top:8px' }, el('button', { class: 'btn sm', type: 'button' }, 'Button'),
          el('span', { class: 'chip ok' }, 'ok'), el('span', { class: 'chip warn' }, 'check'),
          [1, 2, 3, 4, 5, 6].map(n => el('span', { class: 'dot', style: `--dot:var(--s${n})` }))))));
  };
  // What a mode looks like: a built-in one read off the page, one of yours from what it saved.
  const custom = m => state.meta.themes.find(x => slug(x.name) === m);
  const varsOf = m => { const t = custom(m); let v = {}; try { v = JSON.parse(t?.vars || '{}'); } catch {} return t ? { ...readMode('paper'), ...v } : readMode(m); };
  const schemeOf = m => custom(m)?.scheme || (m === 'paper' ? 'light' : 'dark');
  // A new theme starts from the one in use, not from Paper.
  const inUse = () => root.dataset.mode || (matchMedia('(prefers-color-scheme: dark)').matches ? 'ink' : 'paper');
  const open = t => {
    unpreview();
    editing = t?.name || null;
    name.value = t?.name || '';
    if (!t) base.value = inUse();
    const from = t ? slug(t.name) : base.value;
    sch.value = scheme = schemeOf(from);
    vars = varsOf(from);
    preview(); draw(); editor.hidden = false;
  };
  base.addEventListener('change', () => {
    unpreview();
    vars = varsOf(base.value);
    sch.value = scheme = schemeOf(base.value);
    preview(); draw();
  });
  const shuffle = () => {
    const r = randomTheme(Math.random, sch.value === 'dark');
    unpreview();
    vars = { ...vars, ...r.vars };                          // colours only; fonts and tables stay
    preview(); draw();
    flash(`Colours: ${r.rule} on the colour wheel`);
  };
  sch.addEventListener('change', () => { scheme = sch.value; });
  const save = async () => {
    const n = name.value.trim();
    if (!n) return flash('Give the theme a name');
    try {
      if (editing && editing !== n) await suite.remove('theme', editing);
      await suite.save('theme', { name: n, scheme, vars: JSON.stringify(vars) });
      editing = n; await loadMeta(); themeCSS(); flash('Theme saved');
      return n;
    } catch (e) { flash(e.message); }
  };
  const editor = el('div', { hidden: true },
    el('div', { class: 'row mid', style: 'margin-bottom:8px' }, name,
      el('label', { class: 'c' }, 'Start from', base), el('label', { class: 'c' }, 'Kind', sch),
      el('button', { class: 'btn plain sm', type: 'button', title: 'Random colours that still read well: text, money and charts all keep their contrast',
        onclick: shuffle }, '⚄ Randomise colours'),
      el('button', { class: 'btn sm', type: 'button', onclick: save }, 'Save'),
      el('button', { class: 'btn sm', type: 'button', onclick: async () => {
        const n = await save(); if (!n) return;
        unpreview(); await useTheme(slug(n)); editor.hidden = true; list();
      } }, 'Save and use'),
      el('button', { class: 'btn plain sm', type: 'button', onclick: () => { unpreview(); editor.hidden = true; } }, 'Close')),
    el('div', { class: 'cols2' }, form, sample));
  const list = () => {
    const using = state.meta.settings.default_mode || 'system';
    box.replaceChildren(table([
      { k: 'name', label: 'Theme' }, { k: 'scheme', label: 'Kind' },
      { k: '_', label: '', sort: false, render: t => el('span', { class: 'row' },
        el('button', { class: 'btn plain sm', onclick: () => open(t) }, 'Edit'),
        using === slug(t.name) ? el('span', { class: 'chip ok' }, 'in use')
          : el('button', { class: 'btn plain sm', onclick: async () => { await useTheme(slug(t.name)); list(); } }, 'Use'),
        el('button', { class: 'icon del', title: 'Delete theme', onclick: async () => {
          await suite.remove('theme', t.name); await loadMeta(); themeCSS();
          if (using === slug(t.name)) await useTheme('system');
          list();
          flash('Theme deleted', { label: 'Undo', fn: async () => { await suite.undo(); await loadMeta(); themeCSS(); list(); } });
        } }, '×')) }], state.meta.themes, { empty: 'No themes of your own yet. Paper, Dusk and Ink are built in.' }),
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('button', { class: 'btn sm', onclick: () => open(null) }, '+ New theme'),
        el('span', { class: 'muted' }, 'Pick the theme in use from the menu (☰ → Theme).')));
  };
  list();
  return panel('Themes (every app)', 12, box, editor);
}

// --- pages ---------------------------------------------------------------------

function pages(reload) {
  const PAGES_ = Object.fromEntries(Object.entries(PAGES).filter(([id]) => !['search', 'changes'].includes(id)));
  const saved = Object.fromEntries(state.meta.layouts.map(l => [l.page, l]));
  const rows = [...Object.entries(PAGES_).map(([id, m]) => ({ page: id, title: saved[id]?.title || m.title, custom: 0,
                  changed: !!saved[id], sort: saved[id]?.sort ?? 100 })),
                ...state.meta.layouts.filter(l => l.custom).map(l => ({ ...l, changed: true }))];
  const edit = page => { state.editing = true; document.body.classList.add('editing');
                         location.hash = page.startsWith('p/') ? `#/${page}` : `#/${page}`; };
  const name = el('input', { placeholder: 'New page name' });
  return panel(`${APP.title} pages`, 6,
    table([
      { k: 'title', label: 'Page', render: r => {
          const i = el('input', { value: r.title, style: 'width:100%' });
          i.addEventListener('change', async () => {
            const cur = saved[r.page];
            await api.save('layout', { page: r.page, title: i.value, panels: cur?.panels || JSON.stringify(PAGES[r.page]?.layout || []),
                                       sort: cur?.sort ?? 100, custom: r.custom });
            await loadMeta(); flash('Renamed'); reload();
          });
          return i; } },
      { k: 'custom', label: '', render: r => r.custom ? el('span', { class: 'chip on' }, 'yours') : r.changed ? el('span', { class: 'chip' }, 'changed') : '' },
      { k: '_a', label: '', sort: false, render: r => el('span', { class: 'row mid', style: 'gap:4px;flex-wrap:nowrap' },
          el('button', { class: 'btn plain sm', onclick: () => edit(r.custom ? `p/${r.page}` : r.page) }, 'Customise'),
          r.changed && !r.custom ? el('button', { class: 'btn plain sm', onclick: async () => {
            await api.remove('layout', r.page); await loadMeta(); flash('Back to the built-in layout'); reload(); } }, 'Reset') : null,
          r.custom ? el('button', { class: 'btn danger sm', onclick: async () => {
            await api.remove('layout', r.page); await loadMeta(); flash('Page deleted', { label: 'Undo', fn: async () => { await api.undo(); await loadMeta(); reload(); } }); reload(); } }, 'Delete') : null) },
    ], rows),
    el('div', { class: 'row', style: 'margin-top:10px' }, name, el('button', { class: 'btn', onclick: async () => {
      const id = name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!id) return flash('Give the page a name');
      await api.save('layout', { page: id, title: name.value.trim(), panels: '[]', custom: 1, sort: 200 });
      await loadMeta(); edit(`p/${id}`);
    } }, '+ Page')));
}

// --- columns -------------------------------------------------------------------

const EXTENDABLE = () => Object.keys(state.meta.tables)
  .filter(t => !['layout', 'custom_view', 'field_meta', 'change_log', 'setting', 'format_profile'].includes(t)).sort();

function columns(reload) {
  const box = el('div');
  const tbl = select(EXTENDABLE(), EXTENDABLE()[0], { onchange: () => draw() });
  const draw = () => {
    box.innerHTML = '';
    const t = tbl.value;
    const cols = state.meta.tables[t];
    box.append(table([
      { k: 'name', label: 'Column' }, { k: 'type', label: 'Type' },
      { k: '_l', label: 'Label', render: c => {
          if (!c.name.startsWith('x_')) return el('span', { class: 'muted' }, '');
          const i = el('input', { value: label(t, c.name) });
          i.addEventListener('change', async () => { await api.save('field_meta', { tbl: t, col: c.name, label: i.value }); await loadMeta(); flash('Saved'); });
          return i; } },
      { k: '_h', label: 'Hide', render: c => {
          const f = state.meta.fields.find(x => x.tbl === t && x.col === c.name);
          const i = el('input', { type: 'checkbox', checked: !!f?.hidden, disabled: !c.name.startsWith('x_') });
          i.addEventListener('change', async () => { await api.save('field_meta', { tbl: t, col: c.name, hidden: i.checked ? 1 : 0 }); await loadMeta(); });
          return i; } },
      { k: 'generated', label: '', render: c => c.generated ? el('span', { class: 'chip' }, 'formula') : '' },
      { k: '_x', label: '', render: c => c.name.startsWith('x_') ? el('button', { class: 'btn danger sm', onclick: async () => {
          try { await api.admin.dropColumn(t, c.name); await loadMeta(); flash(`Removed ${c.name}. A backup was taken first.`); draw(); }
          catch (e) { flash(e.message); } } }, 'Remove') : '' },
    ], cols));
    const nm = el('input', { placeholder: 'Name, e.g. Miles' });
    const ty = select([{ v: 'text', label: 'Text' }, { v: 'number', label: 'Number' }, { v: 'date', label: 'Date' }, { v: 'yesno', label: 'Yes / no' }], 'text');
    const fx = el('input', { placeholder: 'Formula, optional: e.g. amount * 0.2', style: 'min-width:220px' });
    box.append(el('div', { class: 'row', style: 'margin-top:10px' },
      el('label', { class: 'f' }, 'New column', nm), el('label', { class: 'f' }, 'Type', ty), el('label', { class: 'f' }, 'Formula', fx),
      el('button', { class: 'btn', onclick: async () => {
        try {
          const r = await api.admin.addColumn({ table: t, name: nm.value, label: nm.value, type: ty.value, formula: fx.value });
          await loadMeta(); flash(`Added ${r.column} to ${t}`); draw();
        } catch (e) { flash(e.message); }
      } }, 'Add')));
  };
  draw();
  return panel('Columns', 6, el('div', { class: 'row mid', style: 'margin-bottom:8px' }, el('label', { class: 'c' }, 'Table', tbl)), box);
}

// --- raw data ----------------------------------------------------------------

function data() {
  const box = el('div');
  const tbl = select(Object.keys(state.meta.tables).sort(), Object.keys(state.meta.tables).sort()[0], { onchange: () => { offset = 0; draw(); } });
  const q = el('input', { placeholder: 'Search every column', class: 'sm' });
  let offset = 0;
  q.addEventListener('change', () => { offset = 0; draw(); });
  const draw = async () => {
    box.innerHTML = '';
    const t = tbl.value;
    const meta = state.meta.tables[t];
    const pks = meta.filter(c => c.pk);
    const pk = pks.length === 1 ? pks[0].name : null;
    const rows = await api.table(t, { search: q.value || null, limit: 200, offset, order: pk || meta[0].name, desc: pk ? 1 : null });
    const cols = meta.map(c => ({ k: c.name, label: c.name, readonly: !pk || c.generated || (c.pk && /INT/i.test(c.type)),
                                  type: /INT|REAL|NUM/i.test(c.type) ? 'number' : 'text', n: /INT|REAL|NUM/i.test(c.type),
                                  render: /^(image|thumb)$/.test(c.name) ? r => r[c.name] ? el('img', { src: r[c.name], alt: '', style: 'height:28px' }) : '' : null }));
    box.append(
      el('div', { class: 'row mid', style: 'margin-bottom:6px' },
        el('span', { class: 'muted num' }, `rows ${offset + 1}–${offset + rows.length}`),
        el('button', { class: 'btn plain sm', disabled: !offset, onclick: () => { offset = Math.max(0, offset - 200); draw(); } }, '◀'),
        el('button', { class: 'btn plain sm', disabled: rows.length < 200, onclick: () => { offset += 200; draw(); } }, '▶'),
        el('button', { class: 'btn plain sm', onclick: async () => {
          const all = await api.table(t, { search: q.value || null });
          download(`${t}.csv`, toCSV(all, meta.map(c => c.name)));
        } }, 'Download CSV')),
      grid({ table: t, key: pk || 'rowid', rows, scroll: 'tall', cols, del: !!pk,
        readonly: !pk, draft: pk ? {} : false, onChange: draw }));
  };
  draw();
  return panel('Data', 12, el('div', { class: 'row mid', style: 'margin-bottom:8px' }, el('label', { class: 'c' }, 'Table', tbl), q), box);
}

// --- SQL ---------------------------------------------------------------------

function sql(reload) {
  const ta = el('textarea', { class: 'sqlbox', rows: 6, spellcheck: false, placeholder: APP.sqlHint || 'SELECT * FROM change_log ORDER BY id DESC' });
  const out = el('div');
  const name = el('input', { placeholder: 'Save as view named…', class: 'sm' });
  let last = null;
  const run = async () => {
    out.innerHTML = '';
    try {
      const r = await api.admin.sql(ta.value);
      if (r.columns) {
        last = r;
        const rows = r.rows.map(x => Object.fromEntries(r.columns.map((c, i) => [c, x[i]])));
        out.append(el('div', { class: 'row mid', style: 'margin:6px 0' }, el('span', { class: 'muted num' }, `${rows.length}${r.truncated ? '+' : ''} rows`),
          el('button', { class: 'btn plain sm', onclick: () => download('query.csv', toCSV(rows, r.columns)) }, 'Download CSV')),
          table(r.columns.map(c => ({ k: c, n: rows.some(x => typeof x[c] === 'number') })), rows, { scroll: 'tall', empty: 'No rows' }));
      } else {
        out.append(el('p', {}, `${r.changed} rows changed. Backup taken first: ${r.backup}`),
          r.warning ? el('p', { class: 'err' }, r.warning) : null);
        await loadMeta();
      }
    } catch (e) { out.append(el('p', { class: 'err' }, e.message)); }
  };
  ta.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } });
  return panel('SQL', 12, ta,
    el('div', { class: 'row mid', style: 'margin-top:8px' },
      el('button', { class: 'btn', onclick: run }, 'Run'), el('span', { class: 'muted' }, 'Ctrl+Enter. Anything but a read backs up first.'),
      el('span', { class: 'spacer' }), name,
      el('button', { class: 'btn plain sm', onclick: async () => {
        try { const r = await api.admin.saveView({ name: name.value, sql: ta.value }); await loadMeta(); flash(`Saved as ${r.name}. Add it to a page as a chart or table.`); reload(); }
        catch (e) { flash(e.message); }
      } }, 'Save as view')), out);
}

function views(reload) {
  const box = el('div');
  api.admin.views().then(({ views, errors }) => box.append(table([
    { k: 'name', label: 'View' },
    { k: 'sql', label: 'Query', render: v => el('code', { style: 'font-size:11.5px' }, v.sql.length > 90 ? v.sql.slice(0, 90) + '…' : v.sql) },
    { k: '_e', label: '', render: v => errors[v.name] ? el('span', { class: 'chip bad', title: errors[v.name] }, 'broken') : '' },
    { k: '_x', label: '', sort: false, render: v => el('span', { class: 'row', style: 'gap:4px;flex-wrap:nowrap' },
        el('button', { class: 'btn plain sm', onclick: () => {
          const ta = document.querySelector('textarea.sqlbox'); ta.value = v.sql; ta.scrollIntoView({ block: 'center' }); ta.focus();
        } }, 'Open'),
        el('button', { class: 'btn danger sm', onclick: async () => { await api.admin.dropView(v.name); await loadMeta(); reload(); } }, 'Delete')) },
  ], views, { empty: 'None yet. Run a query in SQL and save it.' })));
  return panel('Saved views', 6, box);
}

// --- backups, health, password -------------------------------------------------

function backups(reload) {
  const box = el('div');
  const draw = async () => {
    box.innerHTML = '';
    const { folder, files } = await api.admin.backups();
    box.append(el('p', { class: 'note', style: 'margin:0 0 8px' }, folder),
      table([{ k: 'name', label: 'File' }, { k: 'size', label: 'Size', n: true, fmt: v => `${(v / 1024).toFixed(0)} KB` },
        { k: '_r', label: '', sort: false, render: f => el('button', { class: 'btn plain sm', onclick: () =>
            dialog(`Restore ${f.name}?`, el('p', {}, 'Everything since that copy is replaced. The current database is backed up first.'),
              [{ label: 'Restore', cls: 'btn danger', fn: async () => {
                try { await api.admin.restore(f.name); await loadMeta(); flash('Restored'); reload(); } catch (e) { flash(e.message); }
              } }]) }, 'Restore') }], files, { scroll: 'mid', empty: 'No backups yet' }));
  };
  draw();
  return panel('Backups', 6,
    el('div', { class: 'row', style: 'margin-bottom:8px' },
      el('button', { class: 'btn', onclick: async () => { const r = await api.admin.backup(); flash(`Saved ${r.name}`); draw(); } }, 'Back up now'),
      el('a', { class: 'btn plain', href: api.admin.download() }, 'Download the database')), box);
}

function health() {
  const box = el('div');
  api.admin.health().then(h => box.append(
    table([{ k: 'k', label: '' }, { k: 'v', label: '' }], [
      { k: 'Integrity', v: h.integrity === 'ok' ? el('span', { class: 'chip ok' }, 'ok') : el('span', { class: 'chip bad' }, h.integrity) },
      { k: 'App', v: `${h.app_version}, schema ${h.schema}` }, { k: 'SQLite', v: h.sqlite }, { k: 'Python', v: h.python },
      { k: 'Database', v: `${h.db_path} (${(h.db_size / 1024).toFixed(0)} KB)` }, { k: 'Backups', v: h.backups },
      ...Object.entries(h.view_errors).map(([k, v]) => ({ k: `View ${k}`, v: el('span', { class: 'err' }, v) }))]),
    el('div', { style: 'height:8px' }),
    table([{ k: 'name', label: 'Table' }, { k: 'rows', label: 'Rows', n: true }], h.tables, { scroll: 'mid' }),
    ...(APP.admin?.health?.() || [])));
  return panel('Health', 6, box);
}

function password() {
  const old = el('input', { type: 'password', autocomplete: 'current-password' });
  const nw = el('input', { type: 'password', autocomplete: 'new-password' });
  const again = el('input', { type: 'password', autocomplete: 'new-password' });
  return panel('Password', 6, el('div', { class: 'row' },
    el('label', { class: 'f' }, 'Current', old), el('label', { class: 'f' }, 'New', nw), el('label', { class: 'f' }, 'Again', again),
    el('button', { class: 'btn', onclick: async () => {
      if (nw.value !== again.value) return flash('The new passwords differ');
      try {
        await suite.password(old.value, nw.value); await loadMeta(); banner(state.meta);
        flash('Password changed. Other devices will need to sign in again.'); old.value = nw.value = again.value = '';
      } catch (e) { flash(e.message); }
    } }, 'Change')),
    el('p', { class: 'note' }, 'One password opens every app. Changing it signs every other device out.'));
}

// --- keys: the calendar feed and the phone ------------------------------------------
// Neither can sign in, so each has a key of its own. Reset makes the old one stop working.

function keys() {
  const box = el('div', { class: 'stack' });
  const copy = async text => { try { await navigator.clipboard.writeText(text); flash('Copied'); } catch { flash('Select it and copy by hand'); } };
  const row = (label, value, reset, extra) => el('div', { class: 'keyrow' },
    el('div', { class: 'k' }, label), el('input', { value, readonly: true, onfocus: e => e.target.select() }),
    el('button', { class: 'btn plain sm', onclick: () => copy(value) }, 'Copy'),
    el('button', { class: 'btn plain sm', onclick: reset }, 'Reset'), extra);
  const draw = async () => {
    const [cal, cap] = await Promise.all([suite.token('cal'), suite.token('capture')]);
    const feed = `${location.origin}/cal/${cal.token}.ics`;
    const reset = name => () => dialog('Make a new key?', el('p', {}, 'The old one stops working at once: anything using it must be given the new one.'),
      [{ label: 'Make a new key', cls: 'btn danger', fn: async () => { await suite.token(name, true); draw(); } }]);
    box.replaceChildren(
      row('Calendar feed', feed, reset('cal'), el('a', { class: 'btn plain sm', href: feed + '?download=1' }, 'Download .ics')),
      el('p', { class: 'note' }, 'Subscribe to this address from Outlook or your phone’s calendar: bills with amounts, paydays, days off, ',
        'bank holidays, and the daily review if Learn has it switched on. Anyone with the address can read those, so keep it to yourself. ',
        'A calendar that fetches from the cloud (Google Calendar) cannot reach a Tailscale address; the phone’s own calendar and Outlook on the PC can.'),
      row('Phone capture key', cap.token, reset('capture')),
      el('p', { class: 'note' }, 'For an iPhone Shortcut that adds to Log: POST JSON {"text": "…"} to ',
        el('code', {}, `${location.origin}/log/api/quick`), ' with the headers ', el('code', {}, 'Authorization: Bearer <this key>'),
        ' and ', el('code', {}, 'X-Daybook: 1'), '. The key opens nothing else.'));
  };
  draw();
  return panel('Calendar feed and phone', 6, box);
}
