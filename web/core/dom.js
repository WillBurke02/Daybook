// Building blocks. Small on purpose.

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'value') e.value = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'data') Object.assign(e.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  add(e, kids);
  return e;
}

function add(parent, kids) {
  for (const k of kids.flat(3)) {
    if (k == null || k === false || k === '') continue;
    parent.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}

export const frag = (...kids) => { const f = document.createDocumentFragment(); add(f, kids); return f; };

export function tiles(...items) { return el('div', { class: 'tiles' }, items.filter(Boolean)); }

/** A figure: its name, value and a line under it. With href, it is a link to where the figure comes from. */
export function tile(k, v, s, cls, href) {
  return el(href ? 'a' : 'div', { class: 'tile' + (href ? ' go' : ''), href: href || null },
    el('div', { class: 'k' }, k),
    el('div', { class: 'v ' + (cls || '') }, v),
    s ? el('div', { class: 's' }, s) : null);
}

/** table(cols, rows, opts) — col: {k, label, n, fmt, render, cls, sort:false}. Sorts on header click.
 *  opts.href(row): clicking the row goes there. */
export function table(cols, data, opts = {}) {
  cols = cols.map(c => (typeof c === 'string' ? { k: c } : c));
  if (!data.length) return el('p', { class: 'note' }, opts.empty || '—');
  let sortK = null, dir = 1;
  const body = el('tbody');
  const fill = () => {
    let d = data;
    if (sortK) d = [...data].sort((a, b) => {
      const x = a[sortK], y = b[sortK];
      return (x == null) - (y == null) || (x < y ? -dir : x > y ? dir : 0);
    });
    body.innerHTML = '';
    for (const row of d) {
      const tr = el('tr', { class: opts.rowClass ? opts.rowClass(row) : null },
        cols.map(c => el('td', { class: [c.n ? 'n' : '', c.cls || ''].join(' ').trim() || null },
          c.render ? c.render(row) : c.fmt ? c.fmt(row[c.k], row) : (row[c.k] ?? ''))));
      tr._row = row;                                  // the right-click menu reads it
      const to = opts.href?.(row);
      if (to) {
        tr.classList.add('go');
        tr.addEventListener('click', e => { if (!e.target.closest('a, button, input, select, textarea, label')) location.href = to; });
      }
      if (opts.onRow) opts.onRow(tr, row);
      body.append(tr);
    }
    if (body.isConnected) body.dispatchEvent(new Event('fin:table', { bubbles: true }));   // re-sorted: redo added columns
  };
  const head = el('tr', {}, cols.map(c => {
    const th = el('th', { class: [c.n ? 'n' : '', c.sort === false ? '' : 'sortable'].join(' ').trim() || null },
      c.label ?? c.k.replace(/_/g, ' '));
    if (c.sort !== false) th.addEventListener('click', () => {
      dir = sortK === c.k ? -dir : (c.n ? -1 : 1); sortK = c.k; fill();
    });
    return th;
  }));
  fill();
  const t = el('table', {}, el('thead', {}, head), body);
  if (opts.total) t.append(el('tfoot', {}, el('tr', { class: 'total' },
    cols.map(c => el('td', { class: c.n ? 'n' : null }, opts.total[c.k] ?? '')))));
  return el('div', { class: 'scroll ' + (opts.scroll || '') }, t);
}

export function select(options, value, attrs = {}) {
  return el('select', attrs, options.map(o => {
    const v = typeof o === 'object' ? o.v : o, l = typeof o === 'object' ? o.label : o;
    return el('option', { value: v ?? '', selected: String(v ?? '') === String(value ?? '') }, l);
  }));
}

export function seg(options, value, onPick) {
  const box = el('div', { class: 'seg', role: 'group' });
  for (const o of options) {
    const v = typeof o === 'object' ? o.v : o, l = typeof o === 'object' ? o.label : o;
    box.append(el('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => {
      box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
      box.querySelector(`[data-v="${CSS.escape(String(v))}"]`).setAttribute('aria-pressed', 'true');
      onPick(v);
    }, data: { v } }, l));
  }
  return box;
}

/** A datalist shared by every field on the page that uses the same id. */
export function datalist(id, values) {
  document.getElementById(id)?.remove();
  document.body.append(el('datalist', { id }, values.map(v => el('option', { value: v }))));
  return id;
}

export function flash(msg, action) {
  document.querySelectorAll('.flash').forEach(x => x.remove());
  const n = el('div', { class: 'flash', role: 'status' }, msg,
    action ? el('button', { onclick: () => { n.remove(); action.fn(); } }, action.label) : null);
  document.body.append(n);
  setTimeout(() => n.remove(), action ? 7000 : 3500);
}

export function dialog(title, body, buttons = []) {
  const d = el('dialog', {},
    el('header', {}, title), el('div', { class: 'body' }, body),
    el('footer', {}, buttons.map(b => el('button', { class: b.cls || 'btn', type: 'button', onclick: async () => {
      if ((await b.fn?.(d)) !== false) d.close();
    } }, b.label)), el('button', { class: 'btn plain', type: 'button', onclick: () => d.close() }, 'Close')));
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

export function download(name, text, type = 'text/csv') {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}

export function toCSV(rows, cols) {
  const q = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return [cols.join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\n');
}

// Per-viewer conveniences only: a collapsed panel, a chosen chart type.
export function readVal(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
export function writeVal(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
