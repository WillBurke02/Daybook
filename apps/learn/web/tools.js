// The tools beside a card: a calculator and a whiteboard, two tabs of one workbench. On a wide
// screen it docks at the right at full height (40% of the width, at most 480 px) and the page
// makes room, so it never covers the card; on a phone it is a sheet along the bottom with the card
// above it. Alt+C opens the calculator and Alt+W the whiteboard, even while typing an answer (C and
// W too, when not typing); the same key again, or Esc, closes it. Ctrl+Z after drawing undoes the drawing.
//
// The board is one per card, kept in learn.db (sketch), so when the card comes back it offers
// "your working last time". The calculator is Daybook's formula engine (calc.js), with units: the
// card's numbers are buttons to put into a sum, the card's sums stay with it, and "Use this answer"
// puts the result, with its unit, in the card's box.
// ponytail: no popped-out browser windows; the dock covers it until one is missed.
import { api } from './api.js';
import { el, flash } from './core/dom.js';
import { dateUK } from './core/format.js';
import { calc, compile, eng, plain, solve, step, also } from './calc.js';

const current = () => document.querySelector('.lcard.current') || [...document.querySelectorAll('.lcard')].at(-1) || null;
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

const WIDE = 1000;                               // narrower than this, the workbench is a sheet along the bottom
let wb = null, watch = null, shownFor = null;
const sheet = () => innerWidth < WIDE;
const asks = c => c && !c.classList.contains('t-concept');

/** Open the workbench on a tool, or close it if that tool is already showing. */
export function toggle(name) {
  if (wb && !wb.box.hidden && wb.tab === name) return close();
  open(name);
}

// Open, it follows you: it steps aside on a card that only explains (a concept) and comes back on the next
// question, and once you leave the cards altogether (the lesson list, Today) it closes.
function open(name) {
  wb ||= make();
  show(true);
  pick(name);
  clearInterval(watch);
  watch = setInterval(() => {
    const c = current();
    if (!c) return close();
    if (!asks(c)) return show(false);
    show(true);
    for (const t of Object.values(wb.tools)) t.follow();     // the card changes under us
    if (c !== shownFor) { shownFor = c; pushUp(c); }
  }, 400);
  shownFor = current();
  pushUp(shownFor);
}

function show(on) {
  if (wb.box.hidden !== on) return;
  if (!on) wb.tools.board.save();
  wb.box.hidden = !on;
  layout();
  if (on) wb.tools[wb.tab]?.shown?.();
}

function close() {
  if (!wb) return;
  clearInterval(watch);
  if (wb.box.hidden) return;
  wb.tools.board.save();
  wb.box.hidden = true;
  layout();
}

/** On a phone the sheet takes the bottom of the screen: the card goes up, under the top bar, to sit above it. */
function pushUp(c) {
  if (!c || !sheet() || !wb || wb.box.hidden) return;
  requestAnimationFrame(() => c.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
}

function pick(name) {
  wb.tab = name;
  for (const [n, t] of Object.entries(wb.tools)) t.box.hidden = n !== name;
  wb.tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.k === name)));
  wb.tools[name].shown();
}

function make() {
  const tools = { calc: calculator(), board: board() };
  const tabs = el('div', { class: 'wb-tabs', role: 'tablist' }, [['calc', 'Calculator', 'Alt+C'], ['board', 'Whiteboard', 'Alt+W']].map(([k, label, key]) =>
    el('button', { type: 'button', role: 'tab', 'data-k': k, onclick: () => pick(k) }, label, el('kbd', {}, key))));
  // on a phone, the bar along the top of the sheet is its handle: drag it up or down for more card or more room
  const grip = el('span', { class: 'wb-grip', 'aria-hidden': 'true' });
  const head = el('header', { class: 'row mid wb-head' }, grip, tabs, el('span', { class: 'spacer' }),
    el('button', { class: 'btn plain sm', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close the calculator and whiteboard', onclick: close }, 'Close'));
  const box = el('section', { class: 'workbench', hidden: true, 'aria-label': 'Calculator and whiteboard' }, head, tools.calc.box, tools.board.box);
  head.addEventListener('pointerdown', e => {
    if (!sheet() || e.target.closest('button')) return;
    e.preventDefault();
    head.setPointerCapture(e.pointerId);
    const move = ev => setSheet((innerHeight - ev.clientY) / innerHeight);
    const up = () => { head.removeEventListener('pointermove', move); store('learn.sheet', String(sheetSize)); shownFor && pushUp(shownFor); };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up, { once: true });
    head.addEventListener('pointercancel', up, { once: true });
  });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.body.append(box);
  addEventListener('beforeunload', () => tools.board.save());
  return { box, tools, tabs, tab: null };
}

/** Docked at the right on a wide screen, with the page narrowed to make room; a sheet along the bottom on a narrow one. */
let sheetSize = Math.min(0.8, Math.max(0.3, +store('learn.sheet') || 0.5));
function setSheet(f) {
  sheetSize = Math.min(0.8, Math.max(0.3, f));
  document.body.style.setProperty('--sheet', `${Math.round(sheetSize * innerHeight)}px`);
}
function layout() {
  const on = !!wb && !wb.box.hidden, wide = !sheet();
  document.body.classList.toggle('docked', on && wide);
  document.body.classList.toggle('sheeted', on && !wide);
  document.body.style.setProperty('--dock', `${Math.min(480, Math.round(innerWidth * 0.4))}px`);
  setSheet(sheetSize);
  wb?.box.classList.toggle('sheet', !wide);
}
globalThis.addEventListener?.('resize', () => { if (wb) layout(); });

// ---- the whiteboard ---------------------------------------------------------------------------

const COLOURS = ['--ink', '--s1', '--debit', '--s3'];
const PAPERS = [['plain', 'Plain'], ['squared', 'Squared'], ['graph', 'Graph']];
const SIZES = [[1.5, 'Fine'], [3, 'Medium'], [6, 'Thick'], [12, 'Marker']];   // pen widths, in screen pixels
// The board is measured in screen pixels: a bigger window shows more of it, never a zoomed copy.

function board() {
  const canvas = el('canvas', { class: 'wb-canvas', tabindex: '-1', 'aria-label': 'Whiteboard: draw with a pen, finger or mouse' });
  const g = canvas.getContext('2d');
  const question = el('div', { class: 'wb-q muted small' });
  const last = el('div', { class: 'wb-last row mid', hidden: true });
  let strokes = [], undo = [], redo = [], colour = 0, tool = 'pen', paper = store('learn.paper') || 'squared', size = +store('learn.pen') || 3;
  let card = null, dirty = false, timer = null, drawing = null;
  const mine = new Map();                        // this session's boards, by card: back to them without asking

  const scale = () => devicePixelRatio || 1;
  const ink = i => getComputedStyle(document.documentElement).getPropertyValue(COLOURS[i]).trim() || '#222';
  const paint = () => {
    const s = scale(), w = canvas.width, h = canvas.height;
    g.clearRect(0, 0, w, h);
    if (paper !== 'plain') {
      const step = (paper === 'graph' ? 10 : 25) * s;
      g.strokeStyle = ink(0); g.globalAlpha = 0.08; g.lineWidth = 1;
      g.beginPath();
      for (let x = step; x < w; x += step) { g.moveTo(x, 0); g.lineTo(x, h); }
      for (let y = step; y < h; y += step) { g.moveTo(0, y); g.lineTo(w, y); }
      g.stroke();
      if (paper === 'graph') {                     // every fifth line darker, as graph paper has
        g.globalAlpha = 0.16; g.beginPath();
        for (let x = step * 5; x < w; x += step * 5) { g.moveTo(x, 0); g.lineTo(x, h); }
        for (let y = step * 5; y < h; y += step * 5) { g.moveTo(0, y); g.lineTo(w, y); }
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    g.lineCap = g.lineJoin = 'round';
    for (const st of [...strokes, drawing].filter(Boolean)) {
      g.strokeStyle = ink(st.c);
      if (st.t === 'text') {                        // typed text, sized by the pen width
        g.fillStyle = ink(st.c); g.font = `${(13 + st.w * 2) * s}px ${getComputedStyle(canvas).fontFamily}`; g.textBaseline = 'middle';
        g.fillText(st.s, st.x * s, st.y * s);
        continue;
      }
      const p = st.p;
      if (p.length === 1) { g.fillStyle = ink(st.c); g.beginPath(); g.arc(p[0][0] * s, p[0][1] * s, st.w * s / 2, 0, 7); g.fill(); continue; }
      for (let k = 1; k < p.length; k++) {         // each piece as wide as the pen was pressed
        g.lineWidth = st.w * s * (0.5 + (p[k][2] ?? 0.5));
        g.beginPath(); g.moveTo(p[k - 1][0] * s, p[k - 1][1] * s); g.lineTo(p[k][0] * s, p[k][1] * s); g.stroke();
      }
    }
  };
  const fit = () => {
    const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
    if (!r.width) return;
    canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d);
    paint();
  };
  new ResizeObserver(fit).observe(canvas);

  const at = e => { const r = canvas.getBoundingClientRect(), k = 1;
    return [+((e.clientX - r.left) * k).toFixed(1), +((e.clientY - r.top) * k).toFixed(1), e.pointerType === 'pen' ? +e.pressure.toFixed(2) : 0.5]; };
  const change = next => { undo.push(strokes); redo = []; strokes = next; dirty = true; clearTimeout(timer); timer = setTimeout(save, 1500); paint(); };
  const hits = pt => strokes.filter(st => st.t === 'text' ? Math.hypot(st.x - pt[0], st.y - pt[1]) < 20
    : st.p.some(q => Math.hypot(q[0] - pt[0], q[1] - pt[1]) < 12 + st.w));
  // Text: a box where you click; Enter puts the words on the board
  const write = ([x, y]) => {
    const r = canvas.getBoundingClientRect(), box_ = box.getBoundingClientRect();
    const t = el('input', { class: 'wb-text', placeholder: 'Type, then Enter', style: `left:${r.left - box_.left + x}px;top:${r.top - box_.top + y - 14}px` });
    let over = false;                              // Enter, then the blur as it goes: once only
    const done = keep => { if (over) return; over = true; if (keep && t.value.trim()) change([...strokes, { t: 'text', x, y, s: t.value.trim(), c: colour, w: size, px: 1 }]);
      t.remove(); canvas.focus({ preventScroll: true }); };
    t.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    t.addEventListener('blur', () => done(true));
    box.append(t); t.focus();
  };

  canvas.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });         // out of the answer box, so Ctrl+Z means the drawing
    qbox.open = false;                               // the question folds away to give the drawing room
    if (tool === 'text') return write(at(e));
    canvas.setPointerCapture(e.pointerId);
    if (tool === 'erase') { const gone = hits(at(e)); if (gone.length) change(strokes.filter(st => !gone.includes(st))); drawing = { erase: true, c: 0, w: 0, p: [] }; return; }
    drawing = { c: colour, w: size, px: 1, p: [at(e)], line: tool === 'line' };
    paint();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const evs = e.getCoalescedEvents?.() || [e];
    if (drawing.erase) { for (const ev of evs) { const gone = hits(at(ev)); if (gone.length) change(strokes.filter(st => !gone.includes(st))); } return; }
    if (drawing.line || e.shiftKey) drawing.p = [drawing.p[0], at(e)];   // Line, or Shift: straight from where it started
    else for (const ev of evs) drawing.p.push(at(ev));
    paint();
  });
  const end = () => {
    if (!drawing) return;
    const d = drawing;
    drawing = null;
    if (!d.erase && d.p.length) change([...strokes, d]);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  async function save() {
    clearTimeout(timer);
    if (!dirty || !card) return;
    dirty = false;
    mine.set(card, strokes);
    try { await api.send('sketch', { card_id: card, strokes, paper }); } catch (e) { flash(`The board was not kept: ${e.message}`); }
  }
  const old = list => list.map(st => st.px || st.t ? st : { ...st, px: 1, w: st.w * 0.44, p: st.p.map(([x, y, q]) => [x * 0.44, y * 0.44, q]) });
  const load = (list, p) => { strokes = old(list); undo = []; redo = []; if (p) paper = p; paper_.value = paper; paint(); };

  /** The card on screen changed: keep this board, then take up that card's. */
  async function follow() {
    const c = current(), id = c?.dataset.id || null;
    if (id === card) return;
    await save();
    card = id;
    last.hidden = true;
    const q = c?.querySelector('.face > .rich, .face > .front');
    question.replaceChildren(q ? q.cloneNode(true) : '');
    if (mine.has(id)) return load(mine.get(id));
    load([]);
    if (!id) return;
    let was;
    try { was = await api.get(`sketch?card=${encodeURIComponent(id)}`); } catch { return; }
    if (card !== id || !was) return;
    const list = JSON.parse(was.strokes || '[]');
    if (!list.length) return;
    last.replaceChildren(el('span', { class: 'muted small' }, `Your working last time (${dateUK(was.updated.slice(0, 10))})`),
      el('button', { class: 'btn plain sm', type: 'button', onclick: () => { last.hidden = true; load(list, was.paper); mine.set(id, list); } }, 'Show it'));
    last.hidden = false;
  }

  const tool_ = el('span', { class: 'seg wb-seg' }, [['pen', 'Pen'], ['line', 'Line'], ['text', 'Text'], ['erase', 'Eraser']].map(([k, label]) =>
    el('button', { type: 'button', 'aria-pressed': String(k === tool), onclick: e => {
      tool = k; tool_.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    } }, label)));
  const colours = el('span', { class: 'swatches' }, COLOURS.map((v, i) => el('button', { class: 'swatch', type: 'button', style: `--sw: var(${v})`,
    'aria-label': `Colour ${i + 1}`, 'aria-pressed': String(i === colour), onclick: e => {
      colour = i; tool = 'pen';
      colours.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      tool_.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-pressed', String(k === 0)));
    } })));
  const sizes = el('span', { class: 'swatches', title: 'Pen width' }, SIZES.map(([w, name]) => el('button', { class: 'penw', type: 'button', 'aria-label': name, title: name,
    'aria-pressed': String(w === size), style: `--pw: ${Math.max(3, w)}px`, onclick: e => {
      size = w; store('learn.pen', String(w)); tool = 'pen';
      sizes.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      tool_.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-pressed', String(k === 0)));
    } })));
  const paper_ = el('select', { class: 'sm', 'aria-label': 'Paper', onchange: () => { paper = paper_.value; store('learn.paper', paper); dirty = true; paint(); save(); } },
    PAPERS.map(([v, label]) => el('option', { value: v }, label)));
  paper_.value = paper;
  const back = () => { if (undo.length) { redo.push(strokes); strokes = undo.pop(); dirty = true; paint(); save(); } };
  const fwd = () => { if (redo.length) { undo.push(strokes); strokes = redo.pop(); dirty = true; paint(); save(); } };
  const qbox = el('details', { class: 'wb-qbox', open: true }, el('summary', { class: 'muted small' }, 'The question'), question);
  const clear = () => { if (!strokes.length) return; change([]); flash('Board cleared', { label: 'Undo', fn: back }); };
  const box = el('div', { class: 'wb' }, qbox, last,
    el('div', { class: 'row mid wb-tools' }, tool_,
      el('button', { class: 'btn plain', type: 'button', title: 'Undo (Ctrl+Z)', onclick: back }, 'Undo'),
      el('button', { class: 'btn plain', type: 'button', title: 'Redo (Ctrl+Y)', onclick: fwd }, 'Redo'),
      el('button', { class: 'btn plain', type: 'button', onclick: clear }, 'Clear')),
    el('div', { class: 'row mid wb-tools' }, colours, sizes, paper_),
    canvas);
  // Ctrl+Z (Ctrl+Y or Ctrl+Shift+Z again) undoes the drawing, not Daybook's last saved change, while the board
  // was the last thing touched; preventDefault is how the shell's own Ctrl+Z knows to stand aside
  let here = false;
  document.addEventListener('pointerdown', e => { here = !!box.contains(e.target); }, true);
  document.addEventListener('keydown', e => {
    if (!here || box.hidden || box.closest('.workbench')?.hidden || !(e.ctrlKey || e.metaKey) || e.target.closest?.('input, textarea, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'y') { e.preventDefault(); k === 'y' || e.shiftKey ? fwd() : back(); }
  });
  return { box, follow, save, shown: () => { requestAnimationFrame(fit); follow(); } };
}

// ---- the calculator: sums, graphs and equations, typed or pressed ------------------------------

const KEYS = [['Shift', 'sin', 'cos', 'tan', 'π'], ['x', 'x²', '^', '√', 'ln'], ['(', ')', 'log', 'e', 'Ans'],
              ['7', '8', '9', 'DEL', 'AC'], ['4', '5', '6', '×', '÷'], ['1', '2', '3', '+', '−'], ['0', '.', '×10ⁿ', '%', '='],
              ['n', 'µ', 'm', 'k', 'M']];
const TYPES = { sin: 'sin(', cos: 'cos(', tan: 'tan(', asin: 'asin(', acos: 'acos(', atan: 'atan(', '√': '√(', ln: 'ln(', log: 'log(',
                'x²': '^2', Ans: 'ans', '×10ⁿ': '×10^', '−': '-' };
const GCOL = ['--s1', '--debit', '--s3'];
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888';

function calculator() {
  let ans = 0, deg = store('learn.deg') !== '0', shift = false, target = null, mode = store('learn.calcmode') || 'calc';
  const field = (attrs, onEnter) => {
    const f = el('input', { class: 'calc-in', autocomplete: 'off', spellcheck: false, ...attrs });
    f.addEventListener('focus', () => { target = f; });
    f.addEventListener('keydown', e => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } });
    return f;
  };

  // Calc: a line to type in, the answer, and a tape of earlier sums
  const tape = el('ol', { class: 'calc-tape', 'aria-label': 'This card\'s sums' });
  const out = el('div', { class: 'calc-out num', 'aria-live': 'polite' });
  let history = [], back = 0, unit = '', card = null;
  const sums = new Map();                       // each card's sums, so they are there when it comes back
  // 4.7 kΩ beside 4700 Ω; 3/8 beside 0.375; the engineering form only when it says more (not 500 m for 0.5)
  const show = (v, u = '', src = '') => {
    const a = Math.abs(v), e = eng(v);
    const extra = [u || a >= 1e4 || (a && a < 1e-2) ? `${e}${u}` : null, ...also(v, src)].filter(x => x && x !== `${plain(v)}${u}` && x !== plain(v));
    out.replaceChildren(el('strong', {}, `${plain(v)}${u ? ' ' + u : ''}`), extra.length ? el('span', { class: 'muted' }, `  =  ${extra.join('  =  ')}`) : '');
  };
  const paintTape = () => tape.replaceChildren(...(sums.get(card) || []).map(x => el('li', { title: 'Use this sum again',
    onclick: () => { line.value = x.src; line.focus(); } }, el('span', {}, x.src), el('span', { class: 'num' }, ` = ${plain(x.value)}${x.unit ? ' ' + x.unit : ''}`))));
  const go = () => {
    const src = line.value.trim();
    if (!src) return;
    const r = calc(src, { ans, deg });
    if (r.error) { out.replaceChildren(el('span', { class: 'deb' }, r.error)); return; }
    ans = r.value; unit = r.unit;
    history.push(src); back = history.length;
    sums.set(card, [...(sums.get(card) || []), { src, value: r.value, unit: r.unit }]);
    paintTape();
    tape.scrollTop = tape.scrollHeight;
    show(ans, unit, src);
    line.value = '';
  };
  // the card's numbers, as buttons that put them into the sum: 230 V, 4.7 kΩ
  const given = el('div', { class: 'row wrap calc-given', 'aria-label': 'Numbers on the card' });
  const NUM_RE = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|M|G|m|µ|μ|u|n|p)?(Ω|ohm|Hz|Pa|V|A|W|J|N|C|F|H|s|%)?(?![\w])/g;
  const follow = () => {
    const c = current(), id = c?.dataset.id || null;
    if (id === card) return;
    card = id;
    paintTape();
    const q = c?.querySelector('.face');
    const seen = new Set(), found = [];
    for (const m of (q?.textContent || '').matchAll(NUM_RE)) {
      const t = `${m[1].replace(/,/g, '')}${m[2] || ''}${m[3] && m[3] !== '%' ? m[3] : ''}`;
      if (!seen.has(t) && found.length < 10) { seen.add(t); found.push([t, `${m[1]}${m[2] || m[3] ? ' ' : ''}${m[2] || ''}${m[3] || ''}`]); }
    }
    given.replaceChildren(...found.map(([t, label]) => el('button', { class: 'chip num', type: 'button', title: 'Put it in the sum',
      onpointerdown: e => e.preventDefault(), onclick: () => typeIn(t) }, label)));
    given.hidden = !found.length;
  };
  const line = field({ 'aria-label': 'A sum',
    title: 'ans is the last answer; k, m, µ, n, M after a number are prefixes' }, go);
  line.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' && back > 0) { e.preventDefault(); line.value = history[--back]; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); back = Math.min(history.length, back + 1); line.value = history[back] || ''; }
  });
  const sumsPane = el('div', { class: 'calc-pane' }, given, tape,
    el('div', { class: 'row mid calc-res' }, out, el('button', { class: 'btn plain sm', type: 'button', title: 'Put the answer in the card\'s box', onclick: () => use() }, 'Use this answer')), line);

  // Graph: up to three functions of x; drag to move, scroll or the buttons to zoom, point to read
  const canvas = el('canvas', { class: 'g-canvas', 'aria-label': 'Graph: drag to move it, scroll to zoom' });
  const g = canvas.getContext('2d');
  const read = el('div', { class: 'g-read num small muted' }, 'Drag to move · scroll to zoom · point at it to read values');
  const fns = GCOL.map((c, i) => {
    const r = { c, f: null };
    r.input = field({ 'aria-label': `y${i + 1}, a function of x` });
    r.input.addEventListener('input', () => { compileAll(); draw(); });
    return r;
  });
  const HOME = { x0: -10, x1: 10, y0: -7, y1: 7 };
  let v = { ...HOME }, hover = null, drag = null;
  function compileAll() {
    for (const r of fns) {
      const s = r.input.value.replace(/^\s*y\s*=/i, '').trim();
      r.f = null; r.input.classList.remove('bad'); r.input.title = '';
      if (!s) continue;
      try { r.f = compile(s, { deg: false }); } catch (e) { r.input.classList.add('bad'); r.input.title = e.message; }   // a graph is in radians
    }
  }
  const val = (r, x) => r.f({ x, ans });
  function draw() {
    const W = canvas.width, H = canvas.height, d = devicePixelRatio || 1;
    if (!W) return;
    const sx = x => (x - v.x0) / (v.x1 - v.x0) * W, sy = y => (v.y1 - y) / (v.y1 - v.y0) * H;
    const ink = css('--ink'), gx = step(v.x1 - v.x0), gy = step(v.y1 - v.y0);
    g.clearRect(0, 0, W, H);
    g.lineWidth = d; g.strokeStyle = ink; g.fillStyle = ink;
    g.font = `${11 * d}px ${getComputedStyle(canvas).fontFamily}`;
    g.globalAlpha = 0.1; g.beginPath();
    for (let x = Math.ceil(v.x0 / gx) * gx; x <= v.x1; x += gx) { g.moveTo(sx(x), 0); g.lineTo(sx(x), H); }
    for (let y = Math.ceil(v.y0 / gy) * gy; y <= v.y1; y += gy) { g.moveTo(0, sy(y)); g.lineTo(W, sy(y)); }
    g.stroke();
    const ax = Math.min(Math.max(sy(0), 0), H), ay = Math.min(Math.max(sx(0), 0), W);   // the axes, or the edge they are off
    g.globalAlpha = 0.55; g.beginPath(); g.moveTo(0, ax); g.lineTo(W, ax); g.moveTo(ay, 0); g.lineTo(ay, H); g.stroke();
    g.globalAlpha = 0.8; g.textAlign = 'center'; g.textBaseline = 'top';
    for (let x = Math.ceil(v.x0 / gx) * gx; x <= v.x1; x += gx) if (Math.abs(x) > gx / 2) g.fillText(plain(+x.toPrecision(6)), sx(x), Math.min(ax + 3 * d, H - 14 * d));
    g.textAlign = 'left'; g.textBaseline = 'middle';
    for (let y = Math.ceil(v.y0 / gy) * gy; y <= v.y1; y += gy) if (Math.abs(y) > gy / 2) g.fillText(plain(+y.toPrecision(6)), Math.min(ay + 4 * d, W - 44 * d), sy(y));
    g.globalAlpha = 1;
    for (const r of fns) {
      if (!r.f) continue;
      g.strokeStyle = css(r.c); g.lineWidth = 2 * d; g.beginPath();
      let pen = false, last = 0;
      for (let px = 0; px <= W; px++) {
        const y = val(r, v.x0 + px / W * (v.x1 - v.x0)), py = sy(y);
        if (!isFinite(py) || Math.abs(py) > H * 50 || (pen && Math.abs(py - last) > H * 2)) { pen = false; continue; }   // a gap, or an asymptote
        pen ? g.lineTo(px, py) : g.moveTo(px, py); pen = true; last = py;
      }
      g.stroke();
    }
    if (hover != null) {
      g.globalAlpha = 0.35; g.strokeStyle = ink; g.lineWidth = d; g.beginPath(); g.moveTo(sx(hover), 0); g.lineTo(sx(hover), H); g.stroke(); g.globalAlpha = 1;
      for (const r of fns) if (r.f) { const y = val(r, hover); if (isFinite(y)) { g.fillStyle = css(r.c); g.beginPath(); g.arc(sx(hover), sy(y), 4 * d, 0, 7); g.fill(); } }
    }
  }
  const readout = () => {
    if (hover == null) return;
    read.replaceChildren(`x = ${plain(+hover.toPrecision(5))}`, ...fns.map((r, i) => r.f ? el('span', { style: `color: var(${r.c})` },
      `   y${i + 1} = ${isFinite(val(r, hover)) ? plain(+val(r, hover).toPrecision(5)) : '—'}`) : ''));
  };
  new ResizeObserver(() => { const b = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
    if (b.width) { canvas.width = Math.round(b.width * d); canvas.height = Math.round(b.height * d); draw(); } }).observe(canvas);
  const zoom = (k, fx = 0.5, fy = 0.5) => {
    const cx = v.x0 + fx * (v.x1 - v.x0), cy = v.y1 - fy * (v.y1 - v.y0);
    v = { x0: cx - (cx - v.x0) * k, x1: cx + (v.x1 - cx) * k, y0: cy - (cy - v.y0) * k, y1: cy + (v.y1 - cy) * k };
    draw();
  };
  const fit = () => {                          // the y range to what the functions do across the x range shown
    const ys = [];
    for (const r of fns) if (r.f) for (let i = 0; i <= 200; i++) { const y = val(r, v.x0 + i / 200 * (v.x1 - v.x0)); if (isFinite(y)) ys.push(y); }
    if (!ys.length) return;
    ys.sort((p, q) => p - q);
    let lo = ys[Math.floor(ys.length * 0.02)], hi = ys[Math.ceil(ys.length * 0.98) - 1];   // not the spikes by an asymptote
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.1;
    v = { ...v, y0: lo - pad, y1: hi + pad };
    draw();
  };
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, v: { ...v } }; });
  canvas.addEventListener('pointermove', e => {
    const b = canvas.getBoundingClientRect();
    if (drag) {
      const dx = (e.clientX - drag.x) / b.width * (drag.v.x1 - drag.v.x0), dy = (e.clientY - drag.y) / b.height * (drag.v.y1 - drag.v.y0);
      v = { x0: drag.v.x0 - dx, x1: drag.v.x1 - dx, y0: drag.v.y0 + dy, y1: drag.v.y1 + dy };
    }
    hover = v.x0 + (e.clientX - b.left) / b.width * (v.x1 - v.x0);
    draw(); readout();
  });
  for (const k of ['pointerup', 'pointercancel']) canvas.addEventListener(k, () => { drag = null; });
  canvas.addEventListener('pointerleave', () => { if (!drag) { hover = null; draw(); } });
  canvas.addEventListener('wheel', e => { e.preventDefault(); const b = canvas.getBoundingClientRect();
    zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, (e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height); }, { passive: false });
  const graph = el('div', { class: 'calc-pane' },
    ...fns.map((r, i) => el('label', { class: 'row mid g-fn' }, el('span', { class: 'g-sw', style: `--sw: var(${r.c})` }), `y${i + 1} =`, r.input)),
    canvas, read, el('p', { class: 'muted small' }, 'Graphs use radians.'),
    el('div', { class: 'row mid g-ctl' },
      el('button', { class: 'btn plain sm', type: 'button', 'aria-label': 'Zoom in', onclick: () => zoom(1 / 1.5) }, '+'),
      el('button', { class: 'btn plain sm', type: 'button', 'aria-label': 'Zoom out', onclick: () => zoom(1.5) }, '−'),
      el('button', { class: 'btn plain sm', type: 'button', title: 'Fit the height to the curves', onclick: fit }, 'Fit y'),
      el('button', { class: 'btn plain sm', type: 'button', onclick: () => { v = { ...HOME }; draw(); } }, 'Reset')));

  // Solve: where two sides are equal, for x in a range
  const res = el('div', { class: 'solve-out' });
  const range = s => { if (!s.trim()) return null; const r = calc(s, { ans, deg }); return r.error ? null : r.value; };
  const run = () => {
    const a = range(from.value), b = range(to.value), both = a != null && b != null;
    const r = solve(eq.value, { a: both ? Math.min(a, b) : undefined, b: both ? Math.max(a, b) : undefined, deg, vars: { ans } });
    if (r.error) return res.replaceChildren(el('span', { class: 'deb' }, r.error));
    const graphIt = el('button', { class: 'btn plain sm', type: 'button', onclick: () => {
      const [l, rh = '0'] = eq.value.split('=');
      fns[0].input.value = l.trim(); fns[1].input.value = rh.trim() === '0' ? '' : rh.trim(); fns[2].input.value = '';
      if (r.roots.length) { const lo = r.roots[0], hi = r.roots.at(-1), w = Math.max(hi - lo, 2); v = { ...v, x0: lo - w * 0.5, x1: hi + w * 0.5 }; }
      setMode('graph'); compileAll(); fit();
    } }, 'Graph it');
    if (!r.roots.length) return res.replaceChildren(el('p', { class: 'muted small' }, both ? `No solution between ${plain(Math.min(a, b))} and ${plain(Math.max(a, b))}.`
      : 'No solution found between −10⁹ and 10⁹.', ' Graph it to see where the sides meet.'), graphIt);
    res.replaceChildren(el('div', { class: 'row wrap' }, r.roots.map(x => el('button', { class: 'chip num', type: 'button', title: 'Keep it as ans',
      onclick: () => { ans = x; unit = ''; show(x); flash(`ans = ${plain(x)}`); } }, `${r.name} = ${plain(x)}`))), graphIt);
  };
  const eq = field({ 'aria-label': 'An equation with one unknown', placeholder: 'e.g. 24/(220+R) = 0.05' }, run);
  const from = field({ placeholder: 'anywhere', 'aria-label': 'Look from', class: 'calc-in calc-num' }, run);
  const to = field({ placeholder: 'anywhere', 'aria-label': 'Look to', class: 'calc-in calc-num' }, run);
  const solver = el('div', { class: 'calc-pane' }, eq,
    el('div', { class: 'row mid small' }, 'between', from, 'and', to, el('button', { class: 'btn sm', type: 'button', onclick: run }, 'Solve')),
    res, el('p', { class: 'muted small' }, 'Solves for one unknown letter.'));

  // the keys: they type into whichever box was last used
  const typeIn = s => {
    const f = target && target.isConnected && !target.closest('[hidden]') ? target : panes[mode].querySelector('input');
    f.focus();
    const a = f.selectionStart ?? f.value.length, b = f.selectionEnd ?? a;
    f.setRangeText(s, a, b, 'end');
    f.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const press = k => {
    const f = target && target.isConnected && !target.closest('[hidden]') ? target : panes[mode].querySelector('input');
    if (k === 'Shift') { shift = !shift; keypad.classList.toggle('shift', shift); for (const [n, b] of Object.entries(trig)) b.textContent = shift ? `${n}⁻¹` : n; return; }
    if (k === '=') return mode === 'calc' ? go() : mode === 'solve' ? run() : (compileAll(), draw());
    if (k === 'AC') { f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); if (mode === 'calc') out.replaceChildren(); return f.focus(); }
    if (k === 'DEL') {
      f.focus();
      const a = f.selectionStart ?? f.value.length, b = f.selectionEnd ?? a;
      f.setRangeText('', a === b ? Math.max(0, a - 1) : a, b, 'end');
      return f.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (trig[k] && shift) { press('Shift'); return typeIn(TYPES[`a${k}`]); }
    typeIn(TYPES[k] ?? k);
  };
  const trig = {};
  const keypad = el('div', { class: 'ckeys', 'aria-label': 'Calculator keys' }, KEYS.flat().map(k => {
    const b = el('button', { type: 'button', class: `ckey${/^[0-9.]$/.test(k) ? ' digit' : ''}${k === '=' ? ' eq' : ''}${/^[×÷+−^]$/.test(k) ? ' op' : ''}`,
      'aria-label': { 'x²': 'squared', '√': 'square root', '×10ⁿ': 'times ten to the', DEL: 'delete', AC: 'clear', Shift: 'shift, for the inverse functions' }[k] || k,
      onpointerdown: e => e.preventDefault(),               // keep the caret in the box being typed in
      onclick: () => press(k) }, k);
    if (['sin', 'cos', 'tan'].includes(k)) trig[k] = b;
    return b;
  }));

  const panes = { calc: sumsPane, graph, solve: solver };
  const tabs = el('span', { class: 'seg' }, [['calc', 'Calc'], ['graph', 'Graph'], ['solve', 'Solve']].map(([k, label]) =>
    el('button', { type: 'button', 'data-k': k, onclick: () => setMode(k) }, label)));
  function setMode(k) {
    mode = k; store('learn.calcmode', k);
    for (const [n, p] of Object.entries(panes)) p.hidden = n !== k;
    tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
    target = null;
    showKeys(keysShown(k));
    if (k === 'graph') requestAnimationFrame(() => { compileAll(); draw(); });
    panes[k].querySelector('input')?.focus();
  }
  const angle = el('button', { class: 'chip', type: 'button', title: 'For sin, cos and tan', onclick: () => {
    deg = !deg; store('learn.deg', deg ? '1' : '0'); angle.textContent = deg ? 'Degrees' : 'Radians'; compileAll(); draw(); } }, deg ? 'Degrees' : 'Radians');
  // the keys, shown or hidden per tab (hidden on Graph at first, where the picture wants the room)
  const keysShown = k => (store(`learn.keys.${k}`) ?? (k === 'graph' ? '0' : '1')) === '1';
  const showKeys = on => { keypad.hidden = !on; keysBtn.setAttribute('aria-pressed', String(on)); };
  const keysBtn = el('button', { class: 'chip', type: 'button', title: 'Show or hide the keys', onclick: () => {
    showKeys(keypad.hidden); store(`learn.keys.${mode}`, keypad.hidden ? '0' : '1'); } }, 'Keys');
  function use() {
    const box = current()?.querySelector('input.answer:not(:disabled)');
    if (!box) return flash('This card has no box for a number');
    box.value = `${plain(ans)}${unit ? ' ' + unit : ''}`;              // the box reads the unit into the card's own (4700 Ω on a kΩ card)
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
  }
  const box = el('div', { class: 'calc' },
    el('div', { class: 'row mid' }, tabs, el('span', { class: 'spacer' }), angle, keysBtn),
    sumsPane, graph, solver, keypad);
  box.addEventListener('keydown', e => { if (e.key !== 'Escape' && !e.altKey) e.stopPropagation(); });   // typing here is not the card's or the page's keys (Alt+W and Alt+C still switch)
  setMode(mode);
  return { box, follow, shown: () => { setMode(mode); follow(); } };
}
