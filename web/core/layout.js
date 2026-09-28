// Pages are lists of panels. A panel is either built in (a calendar, a payslip)
// or generic (a chart, table, figures or text over any view), and /admin can
// add, move, resize, retitle and remove any of them.
import { api } from './api.js';
import { el, flash, readVal, writeVal, seg, select, dialog, table } from './dom.js';
import { money, hrs, plain, hhmm } from './format.js';
import { state, windowOf, loadMeta } from './state.js';
import { chart, shape, TYPES } from '../ui/chart.js';
import { enhance, onDirty } from '../ui/tablefx.js';
import { parse, evaluate, figures, num } from './formula.js';
import { fxInput, cheatsheet } from '../ui/fx.js';
import { kindOf, joinRows, prefixOf } from './rows.js';
import { icon } from './pages.js';
import { popup } from '../ui/menu.js';

export const TABLE_STYLES = [{ v: '', label: 'Theme default' }, { v: 'clean', label: 'Clean' }, { v: 'lines', label: 'Lines' },
  { v: 'striped', label: 'Striped' }, { v: 'grid', label: 'Grid' }, { v: 'sheet', label: 'Sheet' }, { v: 'boxed', label: 'Boxed' }];
export const FONTS = [{ v: '', label: 'Theme default' }, { v: 'Archivo', label: 'Archivo' }, { v: "'Source Serif 4'", label: 'Source Serif' },
  { v: "'JetBrains Mono'", label: 'JetBrains Mono' }, { v: "'Segoe UI'", label: 'Segoe UI' }, { v: 'Calibri', label: 'Calibri' },
  { v: 'Arial', label: 'Arial' }, { v: 'Verdana', label: 'Verdana' }, { v: 'Georgia', label: 'Georgia' },
  { v: "'Times New Roman'", label: 'Times New Roman' }, { v: 'Consolas', label: 'Consolas' }, { v: 'system-ui', label: 'System' }];

export const REGISTRY = {};                 // 'hours.calendar' -> {title, w, render}
export const register = panels => Object.assign(REGISTRY, panels);

const FMT = { money, hours: v => hrs(v), hhmm, number: plain, count: v => String(Math.round(v)) };
const MONEYISH = /amount|total|gross|net$|^net|tax|^ni$|_ni$|pay|spend|income|balance|value|budget|actual|saved|deposited|gain|money|pension|loan|lent|borrowed|interest|variance|deductions|employer|annual|cost/;
export const fmtFor = (col, v) => v == null || v === '' ? '' : typeof v !== 'number' ? v
  : /hours/.test(col) ? hrs(v) : MONEYISH.test(col) ? money(v) : plain(v);

const norm = c => c.use ? { type: 'builtin', id: c.use, ...c } : c;
export const panelTitle = c => c.title || REGISTRY[c.use]?.title || 'Panel';
const width = c => c.w || REGISTRY[c.use]?.w || 12;

// --- data for generic panels -------------------------------------------------

export async function source(name, q) {
  return state.meta.tables[name] ? api.table(name, q) : api.view(name, q);
}
export function colsOf(name) {
  return (state.meta.tables[name] || state.meta.views[name] || []).map(c => c.name);
}
/** A panel's rows: its source, with a second source joined on when it has one. */
export async function load(c, q) {
  const rows = await source(c.source, q);
  const [ka, kb] = c.join?.on || [];
  if (!c.join?.source || !ka || !kb) return rows;
  // matched on the date that keeps the panel to its period: the other side keeps to it too
  const same = c.date && ka === c.date && q[`${c.date}__gte`] ? { [`${kb}__gte`]: q[`${c.date}__gte`], [`${kb}__lte`]: q[`${c.date}__lte`] } : {};
  return joinRows(rows, await source(c.join.source, { ...same, limit: 20000 }), ka, kb, prefixOf(c.join.source), colsOf(c.join.source));
}
export function dateRange(field, w) {
  if (!field) return {};
  const monthly = /month$/.test(field);
  return { [`${field}__gte`]: monthly ? w.from.slice(0, 7) : w.from,
           [`${field}__lte`]: monthly ? w.to.slice(0, 7) : w.to };
}
export function applyFilters(rows, ctx) {
  const f = ctx.filters;
  return rows.filter(r =>
    (!f.account || !('account_id' in r) || String(r.account_id) === String(f.account)) &&
    (!f.grp || !('grp' in r) || r.grp === f.grp) &&
    (!ctx.tagIds || !('id' in r) || ctx.tagIds.has(r.id)));
}

const pref = (ctx, k, d) => readVal(`chart:${ctx.page}:${ctx.cfg.id}:${k}`, d);
const setPref = (ctx, k, v) => writeVal(`chart:${ctx.page}:${ctx.cfg.id}:${k}`, v);

export const WINDOWS = [{ v: 'period', label: 'This period' }, { v: '12m', label: '12 months' },
                        { v: 'year', label: 'Calendar year' }, { v: 'all', label: 'All time' }];
const GRAINS = [{ v: 'week', label: 'Weekly' }, { v: 'month', label: 'Monthly' },
                { v: 'quarter', label: 'Quarterly' }, { v: 'year', label: 'Yearly' },
                { v: 'taxyear', label: 'By tax year' }];

/** A chart with its own type buttons, grain and window. Used by generic panels
 *  and by built-in panels that just want a chart. */
export async function chartInto(body, ctx, c) {
  const type = pref(ctx, 'type', c.chart || 'bar');
  const grain = pref(ctx, 'grain', c.grain || 'month');
  const win = pref(ctx, 'window', c.window || 'period');
  const w = windowOf(win, ctx.period);
  let rows = c.rows || await load(c, { ...dateRange(c.date, w), ...(c.where || {}) });
  rows = applyFilters(rows, ctx);
  // extra series you wrote as formulas over each row
  const extra = (c.series || []).filter(x => x.formula);
  const ys = [...(c.y || [])], names = { ...(c.names || {}) };
  if (extra.length) {
    const asts = extra.map(x => { try { return parse(x.formula); } catch { return null; } });
    const figs = await figures(asts.filter(Boolean), ctx.period, refs => api.measureValues(refs)).catch(() => new Map());
    rows = rows.map((r, i) => {
      const o = { ...r };
      asts.forEach((a, j) => { try { o['__s' + j] = a ? num(evaluate(a, { row: r, rows, index: i, figures: figs, period: ctx.period })) || 0 : 0; } catch { o['__s' + j] = 0; } });
      return o;
    });
    extra.forEach((x, j) => { ys.push('__s' + j); names['__s' + j] = x.name || `Series ${j + 1}`; });
  }
  const s = shape(rows, { x: c.x, y: c.split ? ys.slice(0, 1) : ys, split: c.split, grain, agg: c.agg, names, top: c.top });
  // accounts keep the colour you gave them
  const acc = Object.fromEntries((state.meta.accounts || []).filter(a => a.colour).map(a => [a.name, a.colour]));
  if (c.split === 'account') s.series.forEach(x => { if (acc[x.name]) x.color = acc[x.name]; });
  // One quiet button for the chart's type, grouping and range, rather than a row of controls on every chart.
  const pick = (k, list, cur) => list.map(o => ({ label: o.label, on: o.v === cur, fn: () => { setPref(ctx, k, o.v); ctx.refresh(); } }));
  const types = TYPES.filter(t => !c.types || c.types.includes(t.v));
  ctx.aside.append(el('button', { class: 'chartopts', type: 'button', 'aria-haspopup': 'menu', title: 'Chart type, grouping and range',
    onclick: e => {
      const r = e.currentTarget.getBoundingClientRect();
      popup([{ label: 'Chart', sub: pick('type', types, type) },
             s.time ? { label: 'Group by', sub: pick('grain', GRAINS, grain) } : null,
             c.date ? { label: 'Range', sub: pick('window', WINDOWS, win) } : null], Math.max(8, r.right - 230), r.bottom + 4);
      e.currentTarget.setAttribute('aria-expanded', 'true');
    } }, [types.find(t => t.v === type)?.label, s.time ? GRAINS.find(g => g.v === grain)?.label : null,
          c.date ? WINDOWS.find(w => w.v === win)?.label : null].filter(Boolean).join(' · '), icon('down')));
  const mount = el('div');
  body.append(mount);
  chart(mount, { type, labels: s.labels, series: s.series, fmt: FMT[c.fmt] || money, height: c.height || 230,
                 colors: c.x === 'account' ? acc : null });
}

const GENERIC = {
  chart: (body, ctx) => chartInto(body, ctx, ctx.cfg),

  async table(body, ctx) {
    const c = ctx.cfg;
    const w = windowOf(c.window || 'period', ctx.period);
    const q = { ...dateRange(c.date, w), limit: c.limit || 300 };
    if (c.order) { q.order = c.order; if (c.desc) q.desc = 1; }
    const rows = applyFilters(await load(c, q), ctx);
    const cols = (c.cols && c.cols.length ? c.cols : colsOf(c.source).slice(0, 10));
    body.append(table(cols.map(k => ({ k, n: rows.some(r => typeof r[k] === 'number'), fmt: v => fmtFor(k, v) })),
      rows, { scroll: 'mid' }));
  },

  async tiles(body, ctx) {
    const c = ctx.cfg;
    const w = windowOf(c.window || 'period', ctx.period);
    const rows = applyFilters(await load(c, dateRange(c.date, w)), ctx);
    const agg = (f) => {
      const vs = rows.map(r => +r[f.k] || 0);
      if (f.agg === 'count') return rows.length;
      if (f.agg === 'avg') return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
      if (f.agg === 'last') return rows.length ? rows[rows.length - 1][f.k] : null;
      return vs.reduce((a, b) => a + b, 0);
    };
    body.classList.add('flush');
    body.append(el('div', { class: 'tiles' }, (c.fields || []).map(f =>
      el('div', { class: 'tile' }, el('div', { class: 'k' }, f.label || f.k.replace(/_/g, ' ')),
        el('div', { class: 'v' }, f.agg === 'count' ? String(agg(f)) : fmtFor(f.k, agg(f)))))));
  },

  text(body, ctx) {
    for (const para of String(ctx.cfg.text || '').split(/\n{2,}/))
      body.append(el('p', { style: 'margin:0 0 8px;white-space:pre-wrap' }, para));
  },
};

// --- a page ------------------------------------------------------------------

let live = null;
let persist = () => {};

/** Customise saves as you go: each change is written a moment after it is made. */
function saver(page, working) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const row = state.meta.layouts.find(l => l.page === page) || {};
      const panels = JSON.stringify(working);
      try {
        await api.save('layout', { page, panels, title: row.title || null, sort: row.sort ?? 100, custom: row.custom || 0 });
        const next = { ...row, page, panels }, i = state.meta.layouts.indexOf(row);
        i < 0 ? state.meta.layouts.push(next) : (state.meta.layouts[i] = next);
        const note = document.querySelector('.pagebar .saved');
        if (note) { note.textContent = 'Saved'; setTimeout(() => { note.textContent = 'Changes save as you go'; }, 1500); }
      } catch (e) { flash(e.message); }
    }, 350);
  };
}
export function renderPage(main, page, layout, base) {
  live?.abort();                 // the previous page's panels stop listening
  live = new AbortController();
  base.signal = live.signal;
  const grid = el('div', { class: 'grid' });
  const working = layout.map(norm);
  persist = saver(page, working);
  onDirty(() => persist());
  if (state.editing && state.meta.admin) main.append(editBar(page, working, base));
  main.append(grid);
  working.forEach((c, i) => { if (!c.hidden || state.editing) grid.append(frame(page, c, base, working, i)); });
  grid.ready = Promise.all([...grid.children].map(p => p.ready));
  return grid;
}

/** Dark text on a light colour, white on a dark one (WCAG's crossover luminance). */
export function inkOn(hex) {
  const n = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const lin = v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255);
  return L > 0.179 ? '#16191c' : '#ffffff';
}

function frame(page, c, base, working, index) {
  const w = width(c);
  const shutKey = `shut:${page}:${c.id}`;
  // While a panel refreshes, what it showed stays until the new content goes in:
  // emptying first made the page shorter for a moment, and the browser scrolled.
  const filler = box => (...xs) => {
    if (box.stale) {
      box.stale = false;
      if (box.contains(document.activeElement)) box.cell = document.activeElement.dataset?.cell;   // focus follows the swap
      Element.prototype.replaceChildren.call(box);
    }
    Element.prototype.append.apply(box, xs.flat().filter(x => x != null && x !== false));   // null means 'nothing here'
  };
  const aside = el('div', { class: 'aside' });
  aside.append = filler(aside);
  const h2 = el('h2', { onclick: () => { if (state.editing) return; p.classList.toggle('shut'); writeVal(shutKey, p.classList.contains('shut') ? '1' : null); } },
    panelTitle(c));
  const body = el('div', { class: 'body', style: c.h ? `height:${c.h}px;overflow:auto` : null });
  body.append = filler(body);
  const look = c.tableStyle || state.tableStyle || 'clean';
  const tint = (k, v) => v ? `;--${k}:${v};--${k}-ink:${inkOn(v)}` : '';
  const p = el('section', { class: 'panel' + (w < 6 ? ' narrow' : '') + (w <= 4 ? ' small' : '') + (w <= 2 ? ' tiny' : '') + (REGISTRY[c.use]?.lead ? ' lead' : '') + (readVal(shutKey) ? ' shut' : '') + (c.hidden ? ' hid' : '')
                            + ` ts-${look}` + (c.color ? ' tinted' : '') + (c.bodyColor ? ' bodytint' : ''), id: 'p-' + c.id,
                            style: `--w:${w}` + tint('pc', c.color) + tint('pb', c.bodyColor) + (c.fontSize ? `;--t-font-size:${c.fontSize}px` : '')
                                   + (c.font ? `;font-family:${c.font}` : '') },
    el('header', {}, editControls(page, c, working, base, () => ctx.refresh()), h2, aside), body);
  p.cfg = c;
  p.refresh = () => ctx.refresh();
  if (state.editing && state.meta.admin) {
    const move = mover(p, working);
    p.querySelector('header').addEventListener('pointerdown', move);
    for (const cls of ['move-t', 'move-l']) p.append(el('span', { class: 'edge ' + cls, title: 'Drag to move', onpointerdown: move }));
    p.append(...sizers(p, c, () => ctx.refresh()));
  }
  body.addEventListener('fin:table', () => enhance(body, c, ctx));
  const ctx = { ...base, cfg: c, page, aside, setTitle: t => { h2.textContent = t; } };
  // Refreshing keeps your place: whichever cell had focus gets it back.
  // One redraw at a time: two changes at once (a card and its lesson, say) used to draw
  // the panel twice over. A refresh asked for mid-draw runs once more when this one ends.
  let drawing = null, again = false;
  ctx.refresh = () => {
    if (drawing) { again = true; return drawing; }
    return (drawing = (async () => { do { again = false; await redraw(); } while (again); })().finally(() => { drawing = null; }));
  };
  const redraw = async () => {
    const cell = document.activeElement?.dataset?.cell;
    if (!c.h) body.style.minHeight = body.offsetHeight + 'px';     // and it keeps its height meanwhile
    body.stale = aside.stale = true;
    await run();
    for (const box of [body, aside]) if (box.stale) { box.stale = false; box.replaceChildren(); }
    requestAnimationFrame(() => { body.style.minHeight = ''; });
    const back = body.cell || cell;
    body.cell = null;
    if (back && !body.contains(document.activeElement)) body.querySelector(`[data-cell="${CSS.escape(back)}"]`)?.focus();
  };
  // Tell the other panels something changed; they redraw if it concerns them.
  ctx.changed = table => document.dispatchEvent(new CustomEvent('fin:changed', { detail: { table, from: ctx } }));
  const deps = c.type === 'builtin' ? REGISTRY[c.use]?.deps : null;
  document.addEventListener('fin:changed', e => {
    if (e.detail.from === ctx) return;
    if (!deps || deps.includes(e.detail.table)) ctx.refresh();
  }, { signal: base.signal });
  const run = async () => {
    try {
      if (c.type === 'builtin') {
        const b = REGISTRY[c.use];
        if (!b) { body.append(el('p', { class: 'err' }, `Unknown panel ${c.use}`)); return; }
        await b.render(body, ctx);
      } else await GENERIC[c.type](body, ctx);
      await enhance(body, c, ctx);
    } catch (e) {
      console.error(e);
      body.append(el('p', { class: 'err' }, e.message));
    }
  };
  p.ready = run();
  return p;
}

// --- editing a layout (admin) ------------------------------------------------
// The dashed outline is the handle. Grab the title bar or the top or left edge to
// move a panel; the right edge, bottom edge or corner to resize it. Nothing is
// redrawn while you drag, so the page stays where it is.

const WIDTHS = [[3, 'Quarter'], [4, 'Third'], [5, '5/12'], [6, 'Half'], [7, '7/12'], [8, 'Two thirds'], [9, 'Three quarters'],
  [10, '10/12'], [11, '11/12'], [12, 'Full']];
const wLabel = w => WIDTHS.find(x => x[0] === w)?.[1] || `${w}/12`;
const dirty = () => persist();
const sync = (grid, working) => working.splice(0, working.length, ...[...grid.children].map(x => x.cfg));

/** Follow one pointer from press to release. */
function track(e, move, up) {
  e.preventDefault();
  const t = e.currentTarget;
  t.setPointerCapture(e.pointerId);
  const end = ev => {
    t.removeEventListener('pointermove', move); t.removeEventListener('pointerup', end); t.removeEventListener('pointercancel', end);
    up(ev);
  };
  t.addEventListener('pointermove', move); t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end);
}

/** Press on the title bar or top/left edge: drag onto another panel to go before or after it. */
function mover(p, working) {
  return e => {
    if (e.button !== 0 || e.target.closest('button, select, input, a, label')) return;
    const x0 = e.clientX, y0 = e.clientY;
    let target = null, after = false, moved = false, y = y0, tick = 0;
    const clear = () => document.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    const edge = () => { const v = y < 80 ? -14 : y > innerHeight - 50 ? 14 : 0; if (v) scrollBy(0, v); tick = requestAnimationFrame(edge); };
    track(e, ev => {
      y = ev.clientY;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!moved) { moved = true; p.classList.add('moving'); tick = requestAnimationFrame(edge); }
      clear();
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.grid > .panel');
      target = over && over !== p ? over : null;
      if (!target) return;
      const r = target.getBoundingClientRect();
      after = (ev.clientX - r.left) / r.width + (ev.clientY - r.top) / r.height > 1;   // past the diagonal: after it
      target.classList.add(after ? 'drop-after' : 'drop-before');
    }, () => {
      cancelAnimationFrame(tick); clear(); p.classList.remove('moving');
      if (!target) return;
      after ? target.after(p) : target.before(p);
      sync(p.parentElement, working); dirty();
    });
  };
}

/** The right edge, bottom edge and corner. Sizes run from where the drag began. */
function sizers(p, c, refresh) {
  const body = p.querySelector('.body');
  const tip = el('span', { class: 'size-tip', hidden: true });
  const show = () => { tip.textContent = `${wLabel(c.w || width(c))}${c.h ? ` · ${c.h}px high` : ''}`; };
  const sizer = (cls, dx, dy, title) => {
    const g = el('span', { class: 'edge ' + cls, title });
    g.addEventListener('pointerdown', e => {
      const col = p.parentElement.clientWidth / 12, w0 = p.getBoundingClientRect().width, h0 = body.getBoundingClientRect().height;
      const x0 = e.clientX, y0 = e.clientY;
      tip.hidden = false; show();
      track(e, ev => {
        if (dx) {
          c.w = Math.max(3, Math.min(12, Math.round((w0 + ev.clientX - x0) / col)));
          p.style.setProperty('--w', c.w); p.classList.toggle('narrow', c.w < 6); p.classList.toggle('small', c.w <= 4); p.classList.toggle('tiny', c.w <= 2);
          p.querySelectorAll('.editbar .widths button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === c.w)));
        }
        if (dy) {
          c.h = Math.max(60, Math.round(h0 + ev.clientY - y0));
          body.style.height = c.h + 'px'; body.style.overflow = 'auto';
        }
        show();
      }, () => { tip.hidden = true; dirty(); refresh(); });
    });
    if (dy) g.addEventListener('dblclick', () => { delete c.h; body.style.height = ''; body.style.overflow = ''; dirty(); refresh(); });
    return g;
  };
  return [sizer('size-r', 1, 0, 'Drag to change the width'),
          sizer('size-b', 0, 1, 'Drag to change the height. Double-click for automatic.'),
          sizer('size-rb', 1, 1, 'Drag to resize'), tip];
}

const QUICK_W = [[3, '¼'], [4, '⅓'], [6, '½'], [8, '⅔'], [12, 'Full']];

function editControls(page, c, working, base, refresh) {
  if (!(state.editing && state.meta.admin)) return null;
  const me = () => bar.closest('.panel');
  const step = d => {
    const p = me(), sib = d < 0 ? p.previousElementSibling : p.nextElementSibling;
    if (!sib) return;
    d < 0 ? sib.before(p) : sib.after(p);
    sync(p.parentElement, working); dirty();
    p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const widths = el('div', { class: 'seg widths', role: 'group', 'aria-label': 'Width' }, QUICK_W.map(([v, label]) =>
    el('button', { type: 'button', 'aria-pressed': String(width(c) === v), title: wLabel(v), data: { v }, onclick: () => {
      c.w = v; me().style.setProperty('--w', v); me().classList.toggle('narrow', v < 6); me().classList.toggle('small', v <= 4); me().classList.toggle('tiny', v <= 2);
      widths.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === v)));
      dirty(); refresh();
    } }, label)));
  const eye = el('button', { class: 'icon', type: 'button', title: c.hidden ? 'Show this panel' : 'Hide this panel (it stays here, greyed, while you customise)',
    'aria-label': c.hidden ? 'Show' : 'Hide', onclick: () => {
      c.hidden = !c.hidden; me().classList.toggle('hid', !!c.hidden);
      eye.replaceChildren(icon(c.hidden ? 'eyeoff' : 'eye')); dirty();
    } }, icon(c.hidden ? 'eyeoff' : 'eye'));
  const bar = el('div', { class: 'editbar' },
    el('span', { class: 'grip', title: 'Drag the title to move this panel' }, icon('grip')), widths,
    el('span', { class: 'spacer' }),
    el('button', { class: 'icon', type: 'button', title: 'Move earlier', 'aria-label': 'Move earlier', onclick: () => step(-1) }, icon('left')),
    el('button', { class: 'icon', type: 'button', title: 'Move later', 'aria-label': 'Move later', onclick: () => step(1) }, icon('right')),
    eye,
    el('button', { class: 'icon', type: 'button', title: 'Title, colour, font, height and what it shows', 'aria-label': 'Settings', onclick: () => configure(c, cfg => {
      working[working.indexOf(c)] = cfg; dirty(); base.redraw(working); }) }, icon('cog')),
    el('button', { class: 'icon del', type: 'button', title: 'Remove this panel', 'aria-label': 'Remove', onclick: () => {
      working.splice(working.indexOf(c), 1); me().remove(); dirty();
      flash('Panel removed', { label: 'Undo', fn: async () => { await api.undo(); await loadMeta(); base.reload(); } });
    } }, icon('x')));
  return bar;
}

function editBar(page, working, base) {
  let widths = {};
  try { widths = JSON.parse(state.meta.settings.widths || '{}'); } catch { /* none set */ }
  const cur = widths[page] || (base.pages?.[page]?.narrow ? 'narrow' : 'full');
  const pageWidth = select([{ v: 'full', label: 'Full width' }, { v: 'narrow', label: 'Centred column' }], cur, { class: 'sm', 'aria-label': 'Page width',
    onchange: async e => {
      widths[page] = e.target.value;
      await api.save('setting', { key: 'widths', value: JSON.stringify(widths) });
      state.meta.settings.widths = JSON.stringify(widths); base.reload();
    } });
  return el('div', { class: 'pagebar' },
    el('strong', {}, 'Customising this page'), el('span', { class: 'muted saved' }, 'Changes save as you go'),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn plain sm', type: 'button', onclick: () => addDrawer(working, base) }, icon('plus'), 'Add a panel'),
    pageWidth,
    el('button', { class: 'btn plain sm', type: 'button', title: 'Back to how this page came', onclick: async () => {
      const row = state.meta.layouts.find(l => l.page === page);
      if (row && !row.custom) { await api.remove('layout', page); await loadMeta(); }
      else if (row) { await api.save('layout', { ...row, panels: '[]' }); await loadMeta(); }
      flash('Page reset', { label: 'Undo', fn: async () => { await api.undo(); await loadMeta(); base.reload(); } });
      base.reload();
    } }, 'Reset page'),
    el('button', { class: 'btn sm', type: 'button', onclick: () => document.querySelector('.appbar .custom')?.click() }, 'Done'),
    el('span', { class: 'narrowhint' }, 'The window is narrow, so panels show wider than the widths set here; a wider window shows them as set.'));
}

/** The panels this app has, by the page they come from, and panels of your own making. */
function addDrawer(working, base) {
  document.querySelector('.drawer')?.remove();
  const here = new Set(working.map(c => c.use).filter(Boolean));
  const add = cfg => { working.push(norm(cfg)); dirty(); base.redraw(working); flash(`Added ${panelTitle(norm(cfg))}`); };
  const fromPages = Object.entries(base.pages || {}).filter(([id]) => !['search', 'changes'].includes(id))
    .map(([id, p]) => [base.titleOf?.(id) || p.title, [...new Set((p.layout || []).map(c => c.use))].filter(u => u && REGISTRY[u] && !here.has(u))])
    .filter(([, uses]) => uses.length);
  const d = el('aside', { class: 'drawer', role: 'dialog', 'aria-label': 'Add a panel' },
    el('header', {}, el('strong', {}, 'Add a panel'),
      el('button', { class: 'icon', type: 'button', 'aria-label': 'Close', onclick: () => d.remove() }, icon('x'))),
    el('div', { class: 'grp' }, 'Make your own'),
    el('div', { class: 'kinds' }, [['chart', 'Chart'], ['table', 'Table'], ['tiles', 'Figures'], ['text', 'Note']].map(([type, label]) =>
      el('button', { class: 'btn plain sm', type: 'button', onclick: () => configure({ type, id: 'p' + Date.now().toString(36), w: 6 }, cfg => add(cfg)) }, label))),
    el('p', { class: 'note' }, 'A chart, table or figures over any of this app’s data, with a second source joined on if you like; a note is text of your own.'),
    fromPages.map(([title, uses]) => [el('div', { class: 'grp' }, `From ${title}`),
      uses.map(u => el('button', { class: 'pick', type: 'button', onclick: e => { e.currentTarget.remove(); add({ use: u, w: REGISTRY[u].w }); } },
        el('span', {}, REGISTRY[u].title), icon('plus')))]),
    fromPages.length ? null : el('p', { class: 'note' }, 'Every built-in panel is on this page already.'));
  document.body.append(d);
}

/** The settings of one panel, or a new one: what it shows first (the data, with a
 *  few rows of it to see what each column holds, and optionally a second source
 *  joined on), then how it looks. */
export function configure(c, done) {
  c = c ? { ...c } : { type: 'chart', id: 'p' + Date.now().toString(36), w: 6 };
  const named = state.meta.sources || {};
  const all = [...Object.keys(state.meta.views), ...Object.keys(state.meta.tables)];
  const nameOf = n => named[n]?.[0] || n;
  const samples = {};                                  // a few rows of each source, to show and to tell columns apart
  const sampleOf = n => samples[n] ??= source(n, { limit: 25 }).catch(() => []);
  const box = el('div', { class: 'stack cfg' });
  const human = k => k.replace(/_/g, ' ');
  // one setting: a label over its control, and a line on what it does. A group of buttons
  // or boxes sits in a div, since a label would pass every click to its first button.
  const f = (lbl, input, hint) => el(input?.tagName === 'SELECT' || input?.tagName === 'INPUT' || input?.tagName === 'TEXTAREA' ? 'label' : 'div',
    { class: 'f cfgrow' }, el('span', { class: 'lbl' }, lbl), input, hint ? el('small', { class: 'hint' }, hint) : null);
  const sourcePick = (value, onPick) => el('select', { onchange: e => onPick(e.target.value) },
    el('option', { value: '' }, 'Pick…'),
    el('optgroup', { label: 'Ready to use' }, Object.keys(named).filter(n => all.includes(n))
      .sort((x, y) => nameOf(x).localeCompare(nameOf(y))).map(n => el('option', { value: n, selected: n === value }, nameOf(n)))),
    el('optgroup', { label: 'Everything else, as stored' }, all.filter(n => !named[n]).sort()
      .map(n => el('option', { value: n, selected: n === value }, n))));
  let ticket = 0;
  const draw = async () => {
    const mine = ++ticket;
    const look = el('details', { class: 'cfglook' }, el('summary', {}, 'Title, colours and text'));
    const txt = (k, ph) => el('input', { value: c[k] ?? '', placeholder: ph || '', oninput: e => { c[k] = e.target.value; } });
    // a colour box with a None: None leaves the theme's colour
    const colour = (k, dflt, label) => {
      const i = el('input', { type: 'color', value: c[k] || dflt, 'aria-label': label });
      const none = el('button', { class: 'link', type: 'button', 'aria-pressed': String(!c[k]), onclick: () => { delete c[k]; none.setAttribute('aria-pressed', 'true'); } }, 'None');
      i.addEventListener('input', () => { c[k] = i.value; none.setAttribute('aria-pressed', 'false'); });
      return el('label', { class: 'f' }, label, el('span', { class: 'row mid' }, i, none));
    };
    look.open = c.type === 'builtin' || c.type === 'text';
    look.append(f('Title', txt('title', panelTitle(c))), el('div', { class: 'row' },
      colour('color', '#3d6ec7', 'Header colour'), colour('bodyColor', '#fff7e0', 'Body colour'),
      el('label', { class: 'f' }, 'Tables', select(TABLE_STYLES, c.tableStyle || '', { onchange: e => { c.tableStyle = e.target.value || undefined; } })),
      el('label', { class: 'f' }, 'Font', select(FONTS, c.font || '', { onchange: e => { c.font = e.target.value || undefined; } })),
      el('label', { class: 'f' }, 'Text size', select([{ v: '', label: 'Default' }, 11, 12, 13, 14, 15, 16, 18].map(x => typeof x === 'object' ? x : { v: x, label: x + 'px' }),
        c.fontSize || '', { onchange: e => { c.fontSize = +e.target.value || undefined; } })),
      el('label', { class: 'f' }, 'Height', select([{ v: '', label: 'Fit' }, 200, 300, 400, 500, 700].map(x => typeof x === 'object' ? x : { v: x, label: x + 'px' }),
        c.h || '', { onchange: e => { c.h = +e.target.value || undefined; } }))));
    const parts = [f('It is', seg([{ v: 'chart', label: 'Chart' }, { v: 'table', label: 'Table' }, { v: 'tiles', label: 'Figures' },
      { v: 'text', label: 'Note' }, { v: 'builtin', label: 'Built-in' }], c.type, v => { c.type = v; draw(); }))];
    if (c.type === 'builtin') {
      parts.push(f('Panel', select([{ v: '', label: '—' }, ...Object.entries(REGISTRY).map(([k, v]) =>
        ({ v: k, label: `${k.split('.')[0]} · ${v.title}` }))], c.use,
        { onchange: e => { c.use = e.target.value; c.id = e.target.value; } })));
    } else if (c.type === 'text') {
      parts.push(f('Text', el('textarea', { rows: 6, oninput: e => { c.text = e.target.value; } }, c.text || '')));
    } else {
      parts.push(f('Data', sourcePick(c.source, v => { c.source = v; c.cols = []; c.y = []; c.ks = []; c.x = c.split = null; delete c.date; delete c.join; draw(); }),
        c.source ? named[c.source]?.[1] || 'Stored as it is; the rows below show what it holds.' : 'Pick what the panel is about; you see a few rows of it next.'));
      if (c.source) {
        const [a, b] = await Promise.all([sampleOf(c.source), c.join?.source ? sampleOf(c.join.source) : []]);
        if (mine !== ticket) return;
        const bCols = c.join?.source ? colsOf(c.join.source) : [];
        const on = c.join?.on || [];
        const rows = c.join?.source && on[0] && on[1] ? joinRows(a, b, on[0], on[1], prefixOf(c.join.source), bCols) : a;
        const cols = [...colsOf(c.source), ...(c.join?.source && on[0] && on[1] ? [...bCols, 'rows'].map(k => prefixOf(c.join.source) + k) : [])];
        const kind = Object.fromEntries(cols.map(k => [k, kindOf(rows, k)]));
        const isId = k => /(^|_)id$/.test(k);                // row numbers: nothing to add up or chart
        const ofKind = (...ks) => cols.filter(k => (ks.includes(kind[k]) || kind[k] === 'empty') && !(ks.includes('number') && isId(k)));
        if (c.date === undefined) c.date = ofKind('date').find(k => /date|day/.test(k)) || null;   // a new panel follows the period
        const eg = k => { const v = rows.find(r => r[k] != null && r[k] !== '')?.[k]; return v == null ? '' : String(fmtFor(k, v)).slice(0, 24); };
        const opt = list => [{ v: '', label: '—' }, ...list.map(k => ({ v: k, label: `${human(k)}${eg(k) ? '  e.g. ' + eg(k) : ''}` }))];
        const checks = (key, list) => el('div', { class: 'cfgchecks' }, list.length ? list.map(k =>
          el('label', { class: 'c' }, el('input', { type: 'checkbox', checked: (c[key] || []).includes(k),
            onchange: e => { const s = new Set(c[key] || []); e.target.checked ? s.add(k) : s.delete(k); c[key] = cols.filter(x => s.has(x)); } }),
            el('span', {}, human(k)), eg(k) ? el('small', { class: 'muted num' }, eg(k)) : null)) : el('span', { class: 'muted' }, 'None of that kind here'));
        const show = cols.slice(0, 9);
        parts.push(rows.length ? el('div', { class: 'cfgpeek' }, el('div', { class: 'scroll' }, el('table', {},
          el('thead', {}, el('tr', {}, show.map(k => el('th', { title: kind[k] }, human(k), el('small', {}, kind[k]))))),
          el('tbody', {}, rows.slice(0, 3).map(r => el('tr', {}, show.map(k => el('td', { class: kind[k] === 'number' ? 'n' : null }, fmtFor(k, r[k]) ?? ''))))))),
          cols.length > show.length ? el('small', { class: 'muted' }, `and ${cols.length - show.length} more columns`) : null)
          : el('p', { class: 'note' }, 'Nothing in it yet, so no rows to show.'));
        // a second source, joined on a column the two share
        if (!c.join) parts.push(el('button', { class: 'btn plain sm', type: 'button', onclick: () => { c.join = {}; draw(); } }, icon('plus'), 'Add columns from another source'));
        else {
          const aCols = colsOf(c.source);
          const guess = () => {
            const shared = aCols.filter(k => bCols.includes(k));
            const k = shared.find(x => /date|day|month|week|year/.test(x)) || shared[0];
            if (k) c.join.on = [k, k];
          };
          parts.push(el('fieldset', { class: 'cfgjoin' }, el('legend', {}, 'Joined on'),
            f('From', sourcePick(c.join.source, v => { c.join = { source: v }; if (v) { const bc = colsOf(v); const shared = aCols.filter(k => bc.includes(k)); const k = shared.find(x => /date|day|month|week|year/.test(x)) || shared[0]; if (k) c.join.on = [k, k]; } draw(); })),
            c.join.source ? el('div', { class: 'row mid' },
              f('Where this', select(opt(aCols), on[0], { onchange: e => { c.join.on = [e.target.value, on[1]]; draw(); } })),
              f(`matches ${nameOf(c.join.source)}’s`, select([{ v: '', label: '—' }, ...bCols.map(k => ({ v: k, label: human(k) }))], on[1], { onchange: e => { c.join.on = [on[0], e.target.value]; draw(); } }))) : null,
            el('small', { class: 'muted' }, c.join.source ? `For each row, the matching rows of ${nameOf(c.join.source)} are added up (numbers summed) and join it as ${prefixOf(c.join.source)}…`
              : 'Pick a second source: its columns join these wherever the two match, a date to a date, say.'),
            el('button', { class: 'link', type: 'button', onclick: () => { delete c.join; draw(); } }, 'Remove the join')));
          if (c.join.source && !on[0]) guess();
        }
        parts.push(el('div', { class: 'row' },
          f('Follows the period by', select([{ v: '', label: 'Nothing: all of it' }, ...ofKind('date').map(k => ({ v: k, label: human(k) }))], c.date,
            { onchange: e => { c.date = e.target.value || null; draw(); } }), 'A date column keeps the panel to the period you are looking at.'),
          c.date ? f('Range', select(WINDOWS, c.window || 'period', { onchange: e => { c.window = e.target.value; } })) : null));
        if (c.type === 'chart') {
          parts.push(f('Along the bottom', select(opt(ofKind('date', 'text')), c.x, { onchange: e => { c.x = e.target.value; } }), 'A date makes a chart over time; text (a category, a payee) makes one bar each.'),
            f('Values', checks('y', ofKind('number')), 'The numbers to draw. Rows with the same place along the bottom are added up.'),
            f('One line or bar per', select(opt(ofKind('text')), c.split, { onchange: e => { c.split = e.target.value || null; } }), 'Optional: split the first value by a column, e.g. one line per account.'),
            el('div', { class: 'row' },
              f('Chart', select(TYPES, c.chart || 'bar', { onchange: e => { c.chart = e.target.value; } })),
              f('Numbers as', select([{ v: 'money', label: 'Money' }, { v: 'hours', label: 'Hours' }, { v: 'hhmm', label: 'Hours:minutes' }, { v: 'number', label: 'Plain' }],
                c.fmt || 'money', { onchange: e => { c.fmt = e.target.value; } }))));
          const list = el('div', { class: 'stack' });
          const drawSeries = () => {
            list.innerHTML = '';
            (c.series ||= []).forEach((x, j) => {
              const nm = el('input', { value: x.name || '', placeholder: 'Series name', oninput: e => { x.name = e.target.value; } });
              const fx = fxInput({ value: x.formula || '', fields: cols, period: null, placeholder: 'e.g. amount * 1.2  or  500' });
              fx.addEventListener('change', () => { x.formula = fx.value; });
              list.append(el('div', { class: 'row', style: 'align-items:start' }, nm, el('div', { style: 'flex:1' }, fx),
                el('button', { class: 'icon del', type: 'button', onclick: () => { c.series.splice(j, 1); drawSeries(); } }, '×')));
            });
            list.append(el('button', { class: 'btn plain sm', type: 'button', onclick: () => { c.series.push({ name: '', formula: '' }); drawSeries(); } }, '+ Series from a formula'));
          };
          drawSeries();
          parts.push(el('details', {}, el('summary', {}, 'Extra series from a formula'), list, cheatsheet()));
        }
        if (c.type === 'table') {
          parts.push(f('Columns', checks('cols', cols), 'None ticked shows the first ten.'),
            el('div', { class: 'row mid' }, f('Sort by', select(opt(cols), c.order, { onchange: e => { c.order = e.target.value || null; } })),
              el('label', { class: 'c' }, el('input', { type: 'checkbox', checked: !!c.desc, onchange: e => { c.desc = e.target.checked; } }), 'Largest or newest first')));
        }
        if (c.type === 'tiles') {
          c.ks ??= (c.fields || []).map(x => x.k);
          parts.push(f('Figures', checks('ks', ofKind('number')), 'Each is added up over the rows in the range.'));
        }
      }
    }
    if (mine !== ticket) return;
    box.replaceChildren(...parts, look);
  };
  draw();
  dialog(c.title ? `Panel: ${c.title}` : 'Panel', box, [{ label: 'Apply', fn: () => {
    const cap = k => human(k).replace(/^./, x => x.toUpperCase());
    if (c.type === 'tiles') c.fields = (c.ks || []).map(k => ({ k, agg: 'sum', label: cap(k) }));
    if (c.join && !(c.join.source && c.join.on?.[0] && c.join.on?.[1])) delete c.join;
    if (c.type === 'chart') c.names = { ...Object.fromEntries((c.y || []).map(k => [k, cap(k)])), ...(c.names || {}) };
    if (!c.title && c.source && c.type !== 'builtin') c.title = nameOf(c.source) + (c.join ? ` and ${nameOf(c.join.source).toLowerCase()}` : '');
    if (c.type === 'builtin' && !c.use) { flash('Pick a panel'); return false; }
    if (['chart', 'table', 'tiles'].includes(c.type) && !c.source) { flash('Pick the data'); return false; }
    if (c.type === 'chart' && (!c.x || !(c.y || []).length)) { flash('Pick what goes along the bottom and at least one value'); return false; }
    done(c);
  } }]);
}
