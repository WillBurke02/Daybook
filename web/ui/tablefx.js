// Any table on any page can be reshaped in /admin without touching its code:
// columns dragged into a new order, resized, hidden, or added as formulas;
// rows added as formulas (a total, an average). It is stored with the layout.
import { api } from '../core/api.js';
import { el, dialog, flash, select } from '../core/dom.js';
import { state } from '../core/state.js';
import { parse, evaluate, figures, key, show } from '../core/formula.js';
import { fxInput, cheatsheet } from './fx.js';
import { editText } from '../core/text.js';

const editing = () => state.editing && state.meta?.admin;
const safe = f => { try { return { value: f() }; } catch (e) { return { error: e.message }; } };
let dirty = () => {};
let dragged = null;                          // the column being dragged, across redraws
export const onDirty = f => { dirty = f; };

function cellValue(td) {
  const i = td.querySelector('input:not([type=checkbox]):not([type=file]),textarea');
  if (i) return i.value;
  const c = td.querySelector('input[type=checkbox]');
  if (c) return c.checked;
  const s = td.querySelector('select');
  if (s && !td.querySelector('.chip')) return s.selectedOptions[0]?.textContent ?? '';
  let t = '';
  const walk = n => { for (const k of n.childNodes) {
    if (k.nodeType === 3) t += k.textContent;
    else if (!['BUTTON', 'SELECT', 'OPTION'].includes(k.tagName) && !k.classList?.contains('x')) walk(k);
  } };
  walk(td);
  return t.trim();
}

function insertAfter(tr, cell, afterKey) {
  let anchor = afterKey ? [...tr.cells].find(c => c.dataset.key === afterKey) : null;
  if (!anchor) { tr.append(cell); return; }
  while (anchor.nextElementSibling?.classList.contains('fx')) anchor = anchor.nextElementSibling;
  anchor.after(cell);
}

/** Apply a panel's table settings to every table in it. */
export async function enhance(body, c, ctx) {
  const tables = [...body.querySelectorAll('table')].filter(t => !t.closest('dialog'));
  for (const [i, t] of tables.entries()) {
    try { await one(t, i, c, ctx); } catch (e) { console.error(e); }
  }
}

async function one(table, i, c, ctx) {
  const tc = c.tables?.[i] || {};
  const T = () => ((c.tables ||= [])[i] ||= {});
  table.querySelectorAll('.fx, .fx-tools, .fx-grip, .fx-popmenu').forEach(x => x.remove());
  (table.closest('.scroll') || table).parentElement?.querySelectorAll(`:scope > .fx-bar[data-for="${i}"]`).forEach(x => x.remove());
  table.querySelectorAll('.fx-hide').forEach(x => x.classList.remove('fx-hide'));
  const hr = table.tHead?.rows[0];
  if (!hr) return;

  // remember where every column started, before anything moves
  [...hr.cells].forEach((th, ci) => {
    if (th.dataset.ci != null) return;
    const label = (th.dataset.orig || th.textContent).trim();
    th.dataset.ci = ci; th.dataset.label = label; th.dataset.key = key(label) || 'c' + ci;
  });
  const cols = [...hr.cells].map(th => ({ key: th.dataset.key, label: th.dataset.label, ci: +th.dataset.ci }))
    .sort((a, b) => a.ci - b.ci);
  const keyAt = Object.fromEntries(cols.map(x => [x.ci, x.key]));
  const bodyRows = [...table.tBodies].flatMap(b => [...b.rows]);
  const footRows = table.tFoot ? [...table.tFoot.rows] : [];
  for (const tr of [...bodyRows, ...footRows]) {
    if (tr.dataset.seen) continue;
    tr.dataset.seen = '1';
    [...tr.cells].forEach((td, ci) => { td.dataset.ci = ci; td.dataset.key = keyAt[ci] || 'c' + ci; });
  }
  const data = bodyRows.filter(tr => !tr.classList.contains('draft') && tr.cells.length === cols.length);
  const objs = data.map(tr => {
    const o = {};
    for (const td of tr.cells) { const col = cols.find(k => k.ci === +td.dataset.ci); if (col?.label) o[col.label] = cellValue(td); }
    return o;
  });

  // formula columns and rows
  const fx = tc.fx || [];
  const rowsFx = tc.rows || [];
  const P = f => { try { return parse(f); } catch (e) { return e; } };
  const asts = fx.map(f => P(f.formula));
  const rowAsts = rowsFx.map(r => Object.fromEntries(Object.entries(r.cells || {}).filter(([, f]) => String(f).trim()).map(([k, f]) => [k, P(f)])));
  const all = [...asts, ...rowAsts.flatMap(o => Object.values(o))].filter(a => !(a instanceof Error));
  const figs = all.length ? await figures(all, ctx.period, refs => api.measureValues(refs)).catch(() => new Map()) : new Map();
  fx.forEach((f, j) => {
    const k = 'fx:' + f.id;
    insertAfter(hr, el('th', { class: 'fx' + (asts[j] instanceof Error ? ' fx-err' : ''), title: `= ${f.formula}`,
      data: { key: k, label: f.label, fx: f.id, ci: 'fx' } }, f.label), f.after);
    data.forEach((tr, r) => {
      const res = asts[j] instanceof Error ? { error: asts[j].message }
        : safe(() => evaluate(asts[j], { row: objs[r], rows: objs, index: r, figures: figs, period: ctx.period }));
      if (!res.error) objs[r][f.label] = res.value;
      insertAfter(tr, el('td', { class: 'fx' + (res.error ? ' fx-err' : typeof res.value === 'number' ? ' n' : ''),
        title: res.error || `= ${f.formula}`, data: { key: k } }, res.error ? '!' : show(res.value)), f.after);
    });
    for (const tr of [...bodyRows.filter(t => !data.includes(t)), ...footRows])
      insertAfter(tr, el('td', { class: 'fx', data: { key: k } }), f.after);
  });
  if (rowsFx.length) {
    const foot = table.tFoot || table.createTFoot();
    const order = [...hr.cells].map(th => th.dataset.key);
    rowsFx.forEach((r, j) => {
      const tr = el('tr', { class: 'fx fx-row total', data: { seen: '1' } });
      order.forEach((k, idx) => {
        const a = rowAsts[j][k];
        const res = !a ? null : a instanceof Error ? { error: a.message }
          : safe(() => evaluate(a, { rows: objs, figures: figs, period: ctx.period }));
        tr.append(el('td', { class: res ? (res.error ? 'fx-err' : 'n') : null, data: { key: k },
          title: res ? (res.error || `= ${r.cells[k]}`) : null }, res ? (res.error ? '!' : show(res.value)) : idx === 0 ? r.label : ''));
      });
      foot.append(tr);
    });
  }

  // order, widths, hidden
  const now = [...hr.cells].map(th => th.dataset.key);
  const want = [...(tc.order || []).filter(k => now.includes(k)), ...now.filter(k => !(tc.order || []).includes(k))];
  if (want.join('|') !== now.join('|')) {
    for (const tr of [hr, ...bodyRows, ...(table.tFoot ? [...table.tFoot.rows] : [])]) {
      if (tr.cells.length !== now.length) continue;
      const by = new Map([...tr.cells].map(x => [x.dataset.key, x]));
      if (by.size === now.length) want.forEach(k => tr.append(by.get(k)));
    }
  }
  for (const th of hr.cells) {
    const w = tc.width?.[th.dataset.key];
    th.style.width = w ? w + 'px' : ''; th.style.minWidth = w ? w + 'px' : '';
  }
  for (const k of tc.hidden || []) table.querySelectorAll(`[data-key="${CSS.escape(k)}"]`).forEach(x => x.classList.add('fx-hide'));

  if (!editing()) return;

  // --- /admin: handles on every heading, and buttons to add ---------------------
  const redo = () => { dirty(); one(table, i, c, ctx); };
  const labels = () => [...hr.cells].map(th => th.dataset.label).filter(Boolean);
  for (const th of hr.cells) {
    const k = th.dataset.key;
    th.classList.add('fx-edit');
    th.draggable = true;
    if (!th.dataset.bound) {                  // listeners once; the tools below are redrawn each time
      th.dataset.bound = '1';
      th.addEventListener('dragstart', e => { dragged = k; e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); });
      th.addEventListener('dragover', e => { if (dragged && dragged !== k) { e.preventDefault(); th.classList.add('fx-drop'); } });
      th.addEventListener('dragleave', () => th.classList.remove('fx-drop'));
    }
    th.ondrop = e => {
      e.preventDefault(); e.stopPropagation(); th.classList.remove('fx-drop');
      if (!dragged || dragged === k) return;
      const order = [...hr.cells].map(x => x.dataset.key).filter(x => x !== dragged);
      const r = th.getBoundingClientRect();
      order.splice(order.indexOf(k) + (e.clientX > r.left + r.width / 2 ? 1 : 0), 0, dragged);
      T().order = order; dragged = null; redo();
    };
    const grip = el('span', { class: 'fx-grip', title: 'Drag to resize' });
    grip.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX, w0 = th.getBoundingClientRect().width;
      const move = ev => { th.style.width = th.style.minWidth = Math.max(30, w0 + ev.clientX - x0) + 'px'; };
      const up = () => {
        removeEventListener('mousemove', move); removeEventListener('mouseup', up);
        (T().width ||= {})[k] = Math.round(parseFloat(th.style.width)); dirty();
      };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    });
    const menu = el('button', { class: 'fx-menu', type: 'button', title: 'Column options', onclick: e => {
      e.stopPropagation();
      const hidden = (T().hidden ||= []).includes(k);
      const f = (T().fx || []).find(x => 'fx:' + x.id === k);
      const pop = el('div', { class: 'fx-popmenu' },
        el('button', { onclick: () => { const h = T().hidden; hidden ? h.splice(h.indexOf(k), 1) : h.push(k); redo(); } }, hidden ? 'Show column' : 'Hide column'),
        el('button', { onclick: () => columnDialog(null, k) }, 'Add a column after'),
        f ? el('button', { onclick: () => columnDialog(f, f.after) }, 'Edit formula') : null,
        f ? el('button', { onclick: () => { T().fx = T().fx.filter(x => x !== f); redo(); } }, 'Remove column') : null,
        !f ? el('button', { onclick: () => editText(th.dataset.label) }, 'Rename') : null,
        (T().width || {})[k] ? el('button', { onclick: () => { delete T().width[k]; redo(); } }, 'Reset width') : null);
      document.querySelectorAll('.fx-popmenu').forEach(x => x.remove());
      th.append(pop);
      setTimeout(() => addEventListener('click', () => pop.remove(), { once: true }));
    } }, '⋯');
    th.append(el('span', { class: 'fx-tools' }, menu), grip);
  }

  const columnDialog = (f, after) => {
    const name = el('input', { value: f?.label || '', placeholder: 'Column name' });
    const where = select([{ v: '', label: 'At the end' }, ...[...hr.cells].filter(th => th.dataset.label).map(th => ({ v: th.dataset.key, label: `After ${th.dataset.label}` }))], after || '');
    const box = fxInput({ value: f?.formula || '', fields: labels(), rows: objs, period: ctx.period });
    dialog(f ? `Column: ${f.label}` : 'Add a column', el('div', { class: 'stack' },
      el('label', { class: 'f' }, 'Name', name), el('label', { class: 'f' }, 'Where', where),
      el('label', { class: 'f' }, 'Formula', box), cheatsheet()),
    [{ label: f ? 'Save' : 'Add', fn: () => {
      if (!name.value.trim() || !box.value.trim()) { flash('It needs a name and a formula'); return false; }
      const col = f || { id: Date.now().toString(36) };
      Object.assign(col, { label: name.value.trim(), formula: box.value.trim(), after: where.value || null });
      if (!f) (T().fx ||= []).push(col);
      redo();
    } }]);
  };

  const rowDialog = r => {
    const name = el('input', { value: r?.label || 'Total' });
    const heads = [...hr.cells].filter(th => th.dataset.label);
    const boxes = heads.map(th => [th.dataset.key, fxInput({ value: r?.cells?.[th.dataset.key] || '', fields: labels(), rows: objs, period: ctx.period, placeholder: '' })]);
    const fill = el('button', { class: 'btn plain sm', type: 'button', onclick: () => {
      boxes.forEach(([k, b]) => {
        const lab = heads.find(h => h.dataset.key === k).dataset.label;
        const numeric = objs.some(o => typeof o[lab] === 'number' || /^[£-]?[\d,]+(\.\d+)?$|^\d{1,3}:\d\d$/.test(String(o[lab] ?? '').trim()));
        if (numeric && !b.value) b.value = `SUM(${/^[A-Za-z_]\w*$/.test(lab) ? lab : `[${lab}]`})`;
      });
    } }, 'SUM every number column');
    dialog(r ? `Row: ${r.label}` : 'Add a row', el('div', { class: 'stack' },
      el('label', { class: 'f' }, 'Label', name), fill,
      el('table', { class: 'g' }, el('tbody', {}, boxes.map(([k, b]) =>
        el('tr', {}, el('td', { style: 'width:30%' }, heads.find(h => h.dataset.key === k).dataset.label), el('td', {}, b))))),
      cheatsheet()),
    [{ label: r ? 'Save' : 'Add', fn: () => {
      const cells = Object.fromEntries(boxes.map(([k, b]) => [k, b.value.trim()]).filter(([, v]) => v));
      const row = r || { id: Date.now().toString(36) };
      Object.assign(row, { label: name.value.trim(), cells });
      if (!r) (T().rows ||= []).push(row);
      redo();
    } }]);
  };

  const bar = el('div', { class: 'fx-bar', data: { for: String(i) } },
    el('button', { class: 'btn plain sm', onclick: () => columnDialog(null, null) }, '+ Column'),
    el('button', { class: 'btn plain sm', onclick: () => rowDialog(null) }, '+ Row'),
    (tc.rows || []).map(r => el('span', { class: 'chip' }, r.label,
      el('button', { class: 'link', title: 'Edit', onclick: () => rowDialog(r) }, '✎'),
      el('span', { class: 'x', title: 'Remove', onclick: () => { T().rows = T().rows.filter(x => x !== r); redo(); } }, '×'))),
    tc.order || tc.width || tc.hidden?.length ? el('button', { class: 'link', onclick: () => {
      delete T().order; delete T().width; T().hidden = []; redo(); } }, 'Reset columns') : null);
  (table.closest('.scroll') || table).after(bar);
}
