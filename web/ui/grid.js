// An editable table: every cell is a text box that saves when you leave it.
// Enter moves down a row like a spreadsheet; the empty row at the bottom adds.
// A column's `usual` shows in the new row as a grey hint and is used if left empty.
import { api } from '../core/api.js';
import { el, flash } from '../core/dom.js';
import { toTime, toNumber } from '../core/format.js';

const conv = (c, v) => {
  if (c.type === 'check') return v ? 1 : 0;
  if (v === '' || v == null) return null;
  if (c.type === 'number') return toNumber(v);
  if (c.type === 'time') return toTime(v);
  return v;
};

function input(c, value, onCommit) {
  let i;
  if (c.type === 'select') {
    i = el('select', {}, (c.options || []).map(o => {
      const v = typeof o === 'object' ? o.v : o, l = typeof o === 'object' ? o.label : o;
      return el('option', { value: v ?? '', selected: String(v ?? '') === String(value ?? '') }, l);
    }));
  } else if (c.type === 'check') {
    i = el('input', { type: 'checkbox', checked: !!value });
  } else {
    const type = { date: 'date', month: 'month', number: 'text', color: 'color' }[c.type] || 'text';
    i = el('input', { type, value: value ?? '', placeholder: c.placeholder || '',
                      inputmode: c.type === 'number' ? 'decimal' : c.type === 'time' ? 'numeric' : null,
                      list: c.list || null, 'aria-label': c.label || c.k });
    if (c.type === 'number' && value != null && c.dp != null) i.value = (+value).toFixed(c.dp);
  }
  i.addEventListener('change', () => onCommit(i));
  return i;
}

export function grid(o) {
  const cols = o.cols.map(c => typeof c === 'string' ? { k: c } : c);
  const key = o.key || 'id';
  const save = o.save || ((row, patch) => api.save(o.table, { [key]: row[key], ...patch }));
  const remove = o.remove || (row => api.remove(o.table, row[key]));
  const add = o.add || (draft => api.save(o.table, draft));
  const changed = () => o.onChange && o.onChange();

  const body = el('tbody');
  const move = (inp, dir) => {
    const td = inp.closest('td'), tr = td.parentElement;
    const idx = [...tr.children].indexOf(td);
    const next = dir > 0 ? tr.nextElementSibling : tr.previousElementSibling;
    const target = next?.children[idx]?.querySelector('input,select');
    if (target) { target.focus(); target.select?.(); }
  };

  for (const row of o.rows) {
    const tr = el('tr', { class: o.rowClass ? o.rowClass(row) : null });
    // for the right-click menu: this row, and what can be done to it
    tr._row = row;
    tr._act = {
      extra: o.menu,
      duplicate: async () => {
        const copy = Object.fromEntries(Object.entries(row).filter(([k]) => k !== key && !k.startsWith('_') && cols.some(c => c.k === k && !c.render)));
        try { await add(copy); flash('Copied into a new row', { label: 'Undo', fn: async () => { await api.undo(); changed(); } }); changed(); }
        catch (e) { flash(e.message); }
      },
      remove: async () => {
        try { await remove(row); flash('Deleted', { label: 'Undo', fn: async () => { await api.undo(); changed(); } }); changed(); }
        catch (e) { flash(e.message); }
      },
    };
    for (const c of cols) {
      const td = el('td', { class: [c.n ? 'n' : '', c.cls || ''].join(' ').trim() || null,
                            style: c.width ? `width:${c.width};min-width:${c.width}` : null });   // a narrow panel scrolls rather than squash a box
      if (c.render) td.append(c.render(row) ?? '');
      else if (c.readonly || o.readonly) td.append(c.fmt ? c.fmt(row[c.k], row) : (row[c.k] ?? ''));
      else {
        const i = input(c, row[c.k], async inp => {
          const v = conv(c, c.type === 'check' ? inp.checked : inp.value);
          if (c.type === 'time' && v) inp.value = v;
          if (String(v ?? '') === String(row[c.k] ?? '')) return;
          try {
            await save(row, { [c.k]: v });
            row[c.k] = v;
            td.classList.remove('saved'); void td.offsetWidth; td.classList.add('saved');
            if (o.onSaved) o.onSaved(c.k, row);
          } catch (e) {
            flash(e.message);
            if (c.type === 'check') inp.checked = !!row[c.k]; else inp.value = row[c.k] ?? '';
          }
        });
        i.dataset.cell = `${row[key]}:${c.k}`;
        i.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); i.blur(); move(i, e.shiftKey ? -1 : 1); }
        });
        td.append(i);
      }
      tr.append(td);
    }
    if (o.del !== false) tr.append(el('td', { class: 'x' },
      el('button', { class: 'icon del', type: 'button', title: 'Delete', 'aria-label': 'Delete row', onclick: async () => {
        try {
          await remove(row);
          flash('Deleted', { label: 'Undo', fn: async () => { await api.undo(); changed(); } });
          changed();
        } catch (e) { flash(e.message); }
      } }, '×')));
    body.append(tr);
  }

  if (o.draft) {
    const draft = { ...(typeof o.draft === 'object' ? o.draft : {}) };
    const tr = el('tr', { class: 'draft' });
    const inputs = [];
    const commit = async () => {
      const row = { ...draft };
      for (const [c, i] of inputs) {
        const v = conv(c, c.type === 'check' ? i.checked : i.value);
        if (v != null && v !== '') row[c.k] = v;
        else if (c.usual) row[c.k] = c.usual;          // the grey hint is what an empty box means
      }
      const need = cols.filter(c => c.required).find(c => row[c.k] == null || row[c.k] === '');
      if (need) { flash(`${need.label || need.k} is needed`); return; }
      try { await add(row); changed(); } catch (e) { flash(e.message); }
    };
    for (const c of cols) {
      const td = el('td', { class: c.n ? 'n' : null });
      if ((c.readonly || c.render) && !c.draftInput) td.append(c.draftText ?? '');
      else {
        const i = input({ ...c, placeholder: c.usual || c.placeholder || (c.required ? c.label || c.k : '') }, draft[c.k], () => {});
        if (c.type === 'time') i.addEventListener('change', () => { i.value = toTime(i.value); });
        i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
        i.dataset.cell = `draft:${c.k}`;
        inputs.push([c, i]);
        td.append(i);
      }
      tr.append(td);
    }
    tr.append(el('td', { class: 'x' }, el('button', { class: 'btn sm', type: 'button', onclick: commit }, 'Add')));
    body.append(tr);
    body.focusDraft = () => inputs[o.focus ?? 0]?.[1].focus();
  }

  const t = el('table', { class: 'g' },
    el('thead', {}, el('tr', {}, cols.map(c => el('th', { class: c.n ? 'n' : null }, c.label ?? c.k.replace(/_/g, ' '))),
      o.del !== false || o.draft ? el('th', {}) : null)),
    body);
  if (o.total) t.append(el('tfoot', {}, el('tr', { class: 'total' },
    cols.map(c => el('td', { class: c.n ? 'n' : null }, o.total[c.k] ?? '')), el('td'))));
  const wrap = el('div', { class: 'scroll ' + (o.scroll || '') }, t);
  wrap.focusDraft = () => body.focusDraft?.();
  if (!o.rows.length && !o.draft) return el('p', { class: 'note' }, o.empty || '—');
  return wrap;
}
