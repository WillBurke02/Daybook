// A formula box that suggests as you type: functions with what they take,
// your columns, and figures by period (2026.May.Hours). Below it, the function
// you are inside and the answer for the first row, or what is wrong.
import { api } from '../core/api.js';
import { el } from '../core/dom.js';
import { FUNCTIONS, parse, evaluate, figures, show } from '../core/formula.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let measures = null;
const loadMeasures = async () => (measures ||= await api.measures().catch(() => []));
const colName = n => /^[A-Za-z_]\w*$/.test(n) ? n : `[${n}]`;

/** fxInput({value, fields: [names], rows: [objects], period, placeholder}) -> element with .value */
export function fxInput({ value = '', fields = [], rows = [], period = null, placeholder = 'e.g. DAYNAME(Date)' } = {}) {
  const input = el('input', { value, placeholder, spellcheck: 'false', autocomplete: 'off', class: 'fx-in' });
  const pop = el('div', { class: 'fx-pop', hidden: true, role: 'listbox' });
  const help = el('div', { class: 'fx-help' });
  const out = el('div', { class: 'fx-out' });
  const box = el('div', { class: 'fx' }, input, pop, help, out);
  let items = [], sel = 0, token = null;
  loadMeasures();

  const context = () => {
    const before = input.value.slice(0, input.selectionStart);
    let m = before.match(/((?:\d{4}|this|prev|next|ty\d{4})(?:\.[A-Za-z0-9]+)*\.)([A-Za-z0-9]*)$/i);
    if (m) return { kind: 'period', prefix: m[1], part: m[2], start: before.length - m[2].length };
    m = before.match(/\[([^\]]*)$/);
    if (m) return { kind: 'bracket', part: m[1], start: before.length - m[0].length };
    m = before.match(/([A-Za-z_][\w]*)$/);
    if (m && !/["']/.test(before.replace(/"[^"]*"|'[^']*'/g, '').slice(-1))) return { kind: 'word', part: m[1], start: before.length - m[1].length };
    return null;
  };

  const suggest = () => {
    token = context();
    items = [];
    if (token) {
      const p = token.part.toLowerCase();
      const hit = s => s.toLowerCase().startsWith(p) ? 0 : s.toLowerCase().includes(p) ? 1 : -1;
      const add = (label, insert, detail, kind) => { const h = hit(label); if (h >= 0 && (p || token.kind !== 'word')) items.push({ label, insert, detail, kind, h }); };
      if (token.kind === 'period') {
        const segs = token.prefix.split('.').filter(Boolean);
        if (segs.length === 1 && /^\d{4}$/.test(segs[0])) {
          MONTHS.forEach(mo => add(mo, mo + '.', `${mo} ${segs[0]}`, 'period'));
          ['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2'].forEach(q => add(q, q + '.', `${q} ${segs[0]}`, 'period'));
        }
        (measures || []).forEach(x => add(x.name, x.name, x.about, 'figure'));
      } else if (token.kind === 'bracket') {
        fields.forEach(f => add(f, `[${f}]`, sample(f), 'column'));
      } else {
        fields.forEach(f => add(f, colName(f), sample(f), 'column'));
        Object.entries(FUNCTIONS).forEach(([n, f]) => add(n, n + '(', `${n}(${f.args}) — ${f.about}`, 'function'));
        [['This.', 'this period, e.g. This.Hours'], ['Prev.', 'the period before, e.g. Prev.Spent'],
         ['Next.', 'the period after'], [`TY${new Date().getFullYear()}.`, 'a tax year, e.g. TY2026.Gross']]
          .forEach(([l, d]) => add(l, l, d, 'period'));
        if (/^\d{0,4}$/.test(token.part)) add(String(new Date().getFullYear()) + '.', String(new Date().getFullYear()) + '.', 'a year, then a month and a figure: 2026.May.Hours', 'period');
      }
      items.sort((a, b) => a.h - b.h || a.label.length - b.label.length);
      items = items.slice(0, 9);
    }
    sel = 0;
    draw();
  };
  const sample = f => { const v = rows[0]?.[f]; return v == null || v === '' ? 'column' : `column · e.g. ${String(v).slice(0, 24)}`; };

  const draw = () => {
    pop.innerHTML = '';
    pop.hidden = !items.length || document.activeElement !== input;
    items.forEach((it, i) => pop.append(el('div', { class: 'fx-item' + (i === sel ? ' on' : ''), role: 'option', title: it.detail,
      onmousedown: e => { e.preventDefault(); accept(i); } },
      el('span', { class: 'fx-k ' + it.kind }, it.kind === 'function' ? 'ƒ' : it.kind === 'column' ? '▦' : it.kind === 'figure' ? '#' : '◷'),
      el('b', {}, it.label), el('span', { class: 'fx-d' }, it.detail))));
  };

  const accept = i => {
    const it = items[i]; if (!it || !token) return;
    const v = input.value, caret = input.selectionStart;
    input.value = v.slice(0, token.start) + it.insert + v.slice(caret);
    const at = token.start + it.insert.length;
    input.setSelectionRange(at, at);
    input.focus();
    changed();
    if (it.insert.endsWith('.')) suggest(); else { items = []; draw(); }
  };

  // which function the caret is inside, and which argument
  const signature = () => {
    const before = input.value.slice(0, input.selectionStart).replace(/"[^"]*"|'[^']*'/g, '""');
    let depth = 0, arg = 0;
    for (let i = before.length - 1; i >= 0; i--) {
      const c = before[i];
      if (c === ')') depth++;
      else if (c === '(') {
        if (depth === 0) {
          const name = (before.slice(0, i).match(/([A-Za-z_]\w*)$/) || [])[1]?.toUpperCase();
          const f = FUNCTIONS[name];
          if (!f) return null;
          const parts = f.args.split(',').map(s => s.trim());
          return el('span', {}, el('b', {}, name), '(', parts.map((p, j) => [j ? ', ' : '', j === Math.min(arg, parts.length - 1) ? el('u', {}, p) : p]), ') ', el('span', { class: 'muted' }, f.about));
        }
        depth--;
      } else if (c === ',' && depth === 0) arg++;
    }
    return null;
  };

  let timer;
  const changed = () => {
    help.innerHTML = '';
    const s = signature();
    if (s) help.append(s);
    clearTimeout(timer);
    timer = setTimeout(preview, 180);
    box.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const preview = async () => {
    out.className = 'fx-out';
    if (!input.value.trim()) { out.textContent = ''; return; }
    try {
      const ast = parse(input.value);
      const figs = await figures([ast], period, refs => api.measureValues(refs));
      const v = evaluate(ast, { row: rows[0] || null, rows, index: 0, figures: figs, period });
      out.textContent = rows.length ? `= ${show(v)}   (first row)` : `= ${show(v)}`;
      out.classList.add('ok');
    } catch (e) { out.textContent = e.message; out.classList.add('bad'); }
  };

  input.addEventListener('input', () => { suggest(); changed(); });
  input.addEventListener('click', () => { suggest(); changed(); });
  input.addEventListener('blur', () => { pop.hidden = true; });
  input.addEventListener('keydown', e => {
    if (pop.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; draw(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(sel); }
    else if (e.key === 'Escape') { e.stopPropagation(); items = []; draw(); }
  });
  Object.defineProperty(box, 'value', { get: () => input.value, set: v => { input.value = v; changed(); } });
  queueMicrotask(preview);
  return box;
}

/** The functions, for a reference list. */
export function cheatsheet() {
  return el('details', { class: 'fx-sheet' }, el('summary', {}, 'Functions and figures'),
    el('div', { class: 'scroll mid' }, el('table', {}, el('tbody', {},
      Object.entries(FUNCTIONS).map(([n, f]) => el('tr', {}, el('td', { class: 'num' }, `${n}(${f.args})`), el('td', {}, f.about))),
      el('tr', {}, el('td', { class: 'num' }, '2026.May.Hours'), el('td', {}, 'A figure for a period: a year, then a month (Jan…), quarter (Q1…) or half (H1, H2), or nothing for the whole year; This., Prev., Next. for the page’s period; TY2026. for a tax year.')),
      el('tr', {}, el('td', { class: 'num' }, '[Day total]'), el('td', {}, 'A column whose name has spaces.')),
      el('tr', {}, el('td', { class: 'num' }, '& = <> < >'), el('td', {}, 'Join text, compare. + - * / ^ and % as usual.'))))));
}
