// The tools beside a card: a whiteboard and a calculator, each in its own floating window.
// Drag a window by its title bar, resize it from the corner; both can be open at once, and
// each comes back where you left it. W opens or closes the whiteboard, C the calculator;
// the card's own links do the same.
//
// The board is one per card, kept in learn.db (sketch), so when the card comes back it
// offers "your working last time". The calculator is Daybook's formula engine (calc.js),
// and "Use this answer" puts its result in the card's box.
// ponytail: no popped-out browser windows; the floating ones cover it until one is missed.
import { api } from './api.js';
import { el, flash } from './core/dom.js';
import { dateUK } from './core/format.js';
import { calc, compile, eng, plain, solve, step } from './calc.js';

const current = () => document.querySelector('.lcard.current') || [...document.querySelectorAll('.lcard')].at(-1) || null;
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

const TOOLS = { board: ['Whiteboard', 'W', { w: 460, h: 600, min: [280, 260] }], calc: ['Calculator', 'C', { w: 400, h: 660, min: [300, 360] }] };
const wins = {};
let top = 70, watch = null;

/** Open a tool, or close it if it is open. */
export function toggle(name) {
  if (wins[name] && !wins[name].win.hidden) return close(name);
  open(name);
}

function open(name) {
  const w = wins[name] || (wins[name] = make(name));
  w.win.hidden = false;
  place(w.win, name);
  front(w.win);
  w.tool.shown?.();
  if (name === 'board') {
    clearInterval(watch);
    watch = setInterval(() => !w.win.hidden && w.tool.follow(), 600);   // the card on screen changes under us
  }
}

function close(name) {
  const w = wins[name];
  if (!w || w.win.hidden) return;
  if (name === 'board') { w.tool.save(); clearInterval(watch); }
  w.win.hidden = true;
}

function make(name) {
  const [title, key] = TOOLS[name];
  const tool = name === 'board' ? board() : calculator();
  const bar = el('header', { class: 'tw-bar row mid', title: 'Drag to move' },
    el('strong', {}, title), el('kbd', {}, key), el('span', { class: 'spacer' }),
    el('button', { class: 'icon', type: 'button', 'aria-label': `Close the ${title.toLowerCase()}`, title: 'Close (Esc)', onclick: () => close(name) }, '×'));
  const grip = el('span', { class: 'tw-grip', title: 'Drag to resize', 'aria-hidden': 'true' });
  const win = el('section', { class: `toolwin tw-${name}`, hidden: true, role: 'dialog', 'aria-label': title }, bar, tool.box, grip);
  win.addEventListener('pointerdown', () => front(win), true);
  win.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(name); } });
  follow(bar, win, name, (r, dx, dy) => ({ left: r.left + dx, top: r.top + dy }));
  follow(grip, win, name, (r, dx, dy) => ({ width: r.width + dx, height: r.height + dy }));
  document.body.append(win);
  if (name === 'board') addEventListener('beforeunload', () => tool.save());
  return { win, tool };
}

const front = win => { win.style.zIndex = ++top; };
const saved = name => { try { return JSON.parse(store(`learn.tool.${name}`) || 'null'); } catch { return null; } };

/** Where a window goes: where it was left, else the whiteboard at the right and the calculator beside it; always on screen. */
function place(win, name, at = saved(name)) {
  const [, , d] = TOOLS[name], vw = innerWidth, vh = innerHeight;
  let { x, y, w, h } = at || {};
  if (!at && vw >= 1000) {                        // a wide screen: one above the other, right of the card
    const bh = Math.round(Math.min(600, (vh - 90) * 0.45));
    w = Math.min(d.w, vw - 24); x = vw - w - 12;
    if (name === 'board') { y = 70; h = bh; } else { y = 70 + bh + 10; h = Math.max(d.min[1], vh - y - 12); }
  } else if (!at) {                               // half a screen or a phone: along the bottom, the card in view above
    const pair = vw >= 600;
    w = pair ? Math.floor(vw / 2) - 18 : vw - 24; h = Math.round(vh * 0.48);
    x = pair && name === 'board' ? vw - w - 12 : 12; y = vh - h - (pair ? 12 : 66);   // a phone's tab bar is along the bottom
  }
  w = Math.max(d.min[0], Math.min(w, vw)); h = Math.max(d.min[1], Math.min(h, vh));
  x = Math.max(0, Math.min(x, vw - 120)); y = Math.max(0, Math.min(y, vh - 44));   // the title bar stays reachable
  Object.assign(win.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
}

/** Drag `handle` to move or resize `win`: `to` turns the pointer's travel into new styles. */
function follow(handle, win, name, to) {
  handle.addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('button')) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const r = win.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
    const move = ev => {
      const s = to(r, ev.clientX - x0, ev.clientY - y0);
      for (const [k, v] of Object.entries(s)) win.style[k] = `${v}px`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      const b = win.getBoundingClientRect();
      place(win, name, { x: b.left, y: b.top, w: b.width, h: b.height });
      store(`learn.tool.${name}`, JSON.stringify({ x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
    handle.addEventListener('pointercancel', up, { once: true });
  });
}

addEventListener('resize', () => { for (const [name, w] of Object.entries(wins)) if (!w.win.hidden) {
  const b = w.win.getBoundingClientRect(); place(w.win, name, { x: b.left, y: b.top, w: b.width, h: b.height }); } });

// ---- the whiteboard ---------------------------------------------------------------------------

const COLOURS = ['--ink', '--s1', '--debit', '--s3'];
const PAPERS = [['plain', 'Plain'], ['squared', 'Squared'], ['graph', 'Graph']];
const W = 1000;                                   // the board is 1000 units across, whatever its size on screen

function board() {
  const canvas = el('canvas', { class: 'wb-canvas', 'aria-label': 'Whiteboard: draw with a pen, finger or mouse' });
  const g = canvas.getContext('2d');
  const question = el('div', { class: 'wb-q muted small' });
  const last = el('div', { class: 'wb-last row mid', hidden: true });
  let strokes = [], undo = [], redo = [], colour = 0, tool = 'pen', paper = store('learn.paper') || 'squared';
  let card = null, dirty = false, timer = null, drawing = null;
  const mine = new Map();                        // this session's boards, by card: back to them without asking

  const scale = () => canvas.width / W;
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

  const at = e => { const r = canvas.getBoundingClientRect(), k = W / r.width;
    return [+((e.clientX - r.left) * k).toFixed(1), +((e.clientY - r.top) * k).toFixed(1), e.pointerType === 'pen' ? +e.pressure.toFixed(2) : 0.5]; };
  const change = next => { undo.push(strokes); redo = []; strokes = next; dirty = true; clearTimeout(timer); timer = setTimeout(save, 1500); paint(); };
  const hits = pt => strokes.filter(st => st.p.some(q => Math.hypot(q[0] - pt[0], q[1] - pt[1]) < 12 + st.w));

  canvas.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    if (tool === 'erase') { const gone = hits(at(e)); if (gone.length) change(strokes.filter(st => !gone.includes(st))); drawing = { erase: true, c: 0, w: 0, p: [] }; return; }
    drawing = { c: colour, w: e.pointerType === 'pen' ? 3 : 2.5, p: [at(e)] };
    paint();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const evs = e.getCoalescedEvents?.() || [e];
    if (drawing.erase) { for (const ev of evs) { const gone = hits(at(ev)); if (gone.length) change(strokes.filter(st => !gone.includes(st))); } return; }
    for (const ev of evs) drawing.p.push(at(ev));
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
  const load = (list, p) => { strokes = list; undo = []; redo = []; if (p) paper = p; paper_.value = paper; paint(); };

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

  const tool_ = el('span', { class: 'seg' }, [['pen', 'Pen'], ['erase', 'Eraser']].map(([k, label]) =>
    el('button', { type: 'button', 'aria-pressed': String(k === tool), onclick: e => {
      tool = k; tool_.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    } }, label)));
  const colours = el('span', { class: 'swatches' }, COLOURS.map((v, i) => el('button', { class: 'swatch', type: 'button', style: `--sw: var(${v})`,
    'aria-label': `Colour ${i + 1}`, 'aria-pressed': String(i === colour), onclick: e => {
      colour = i; tool = 'pen';
      colours.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      tool_.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-pressed', String(k === 0)));
    } })));
  const paper_ = el('select', { class: 'sm', 'aria-label': 'Paper', onchange: () => { paper = paper_.value; store('learn.paper', paper); dirty = true; paint(); save(); } },
    PAPERS.map(([v, label]) => el('option', { value: v }, label)));
  paper_.value = paper;
  const back = () => { if (undo.length) { redo.push(strokes); strokes = undo.pop(); dirty = true; paint(); save(); } };
  const fwd = () => { if (redo.length) { undo.push(strokes); strokes = redo.pop(); dirty = true; paint(); save(); } };
  const box = el('div', { class: 'wb' },
    el('details', { class: 'wb-qbox', open: true }, el('summary', { class: 'muted small' }, 'The question'), question),
    last,
    el('div', { class: 'row mid wb-tools' }, tool_, colours,
      el('button', { class: 'icon', type: 'button', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: back }, '↶'),
      el('button', { class: 'icon', type: 'button', title: 'Redo', 'aria-label': 'Redo', onclick: fwd }, '↷'),
      el('button', { class: 'btn plain sm', type: 'button', onclick: () => strokes.length && change([]) }, 'Clear'), paper_),
    canvas);
  box.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); e.shiftKey ? fwd() : back(); }
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
  const tape = el('ol', { class: 'calc-tape', 'aria-label': 'Earlier sums' });
  const out = el('div', { class: 'calc-out num', 'aria-live': 'polite' });
  let history = [], back = 0;
  const show = v => out.replaceChildren(el('strong', {}, plain(v)), / \S$/.test(eng(v)) ? el('span', { class: 'muted' }, `  =  ${eng(v)}`) : '');
  const go = () => {
    const src = line.value.trim();
    if (!src) return;
    const r = calc(src, { ans, deg });
    if (r.error) { out.replaceChildren(el('span', { class: 'deb' }, r.error)); return; }
    ans = r.value;
    history.push(src); back = history.length;
    tape.append(el('li', { title: 'Use this sum again', onclick: () => { line.value = src; line.focus(); } },
      el('span', {}, src), el('span', { class: 'num' }, ` = ${plain(r.value)}`)));
    tape.scrollTop = tape.scrollHeight;
    show(ans);
    line.value = '';
  };
  const line = field({ placeholder: 'e.g. 230 / 4.7k   2sin(30)   ans × 2', 'aria-label': 'A sum',
    title: 'ans is the last answer; k, m, µ, n, M after a number are prefixes' }, go);
  line.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' && back > 0) { e.preventDefault(); line.value = history[--back]; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); back = Math.min(history.length, back + 1); line.value = history[back] || ''; }
  });
  const sums = el('div', { class: 'calc-pane' }, tape,
    el('div', { class: 'row mid calc-res' }, out, el('button', { class: 'btn plain sm', type: 'button', title: 'Put the answer in the card\'s box', onclick: () => use() }, 'Use this answer')), line);

  // Graph: up to three functions of x; drag to move, scroll or the buttons to zoom, point to read
  const canvas = el('canvas', { class: 'g-canvas', 'aria-label': 'Graph: drag to move it, scroll to zoom' });
  const g = canvas.getContext('2d');
  const read = el('div', { class: 'g-read num small muted' }, 'Drag to move · scroll to zoom · point at it to read values');
  const fns = GCOL.map((c, i) => {
    const r = { c, f: null };
    r.input = field({ placeholder: ['e.g. x^2 - 4', 'e.g. 2x + 1', 'e.g. 10sin(x)'][i], 'aria-label': `y${i + 1}, a function of x` });
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
      try { r.f = compile(s, { deg }); } catch (e) { r.input.classList.add('bad'); r.input.title = e.message; }
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
    canvas, read,
    el('div', { class: 'row mid g-ctl' },
      el('button', { class: 'btn plain sm', type: 'button', 'aria-label': 'Zoom in', onclick: () => zoom(1 / 1.5) }, '+'),
      el('button', { class: 'btn plain sm', type: 'button', 'aria-label': 'Zoom out', onclick: () => zoom(1.5) }, '−'),
      el('button', { class: 'btn plain sm', type: 'button', title: 'Fit the height to the curves', onclick: fit }, 'Fit y'),
      el('button', { class: 'btn plain sm', type: 'button', onclick: () => { v = { ...HOME }; draw(); } }, 'Reset')));

  // Solve: where two sides are equal, for x in a range
  const res = el('div', { class: 'solve-out' });
  const range = (s, d) => { const r = calc(s, { ans, deg }); return r.error ? d : r.value; };
  const run = () => {
    const a = range(from.value, -100), b = range(to.value, 100), r = solve(eq.value, { a: Math.min(a, b), b: Math.max(a, b), deg, vars: { ans } });
    if (r.error) return res.replaceChildren(el('span', { class: 'deb' }, r.error));
    const graphIt = el('button', { class: 'btn plain sm', type: 'button', onclick: () => {
      const [l, rh = '0'] = eq.value.split('=');
      fns[0].input.value = l.trim(); fns[1].input.value = rh.trim() === '0' ? '' : rh.trim(); fns[2].input.value = '';
      if (r.roots.length) { const lo = r.roots[0], hi = r.roots.at(-1), w = Math.max(hi - lo, 2); v = { ...v, x0: lo - w * 0.5, x1: hi + w * 0.5 }; }
      setMode('graph'); compileAll(); fit();
    } }, 'Graph it');
    if (!r.roots.length) return res.replaceChildren(el('p', { class: 'muted small' }, `No solution between ${plain(Math.min(a, b))} and ${plain(Math.max(a, b))}. Widen the range, or graph it to see where the sides meet.`), graphIt);
    res.replaceChildren(el('div', { class: 'row wrap' }, r.roots.map(x => el('button', { class: 'chip num', type: 'button', title: 'Keep it as ans',
      onclick: () => { ans = x; show(x); flash(`ans = ${plain(x)}`); } }, `x = ${plain(x)}`))), graphIt);
  };
  const eq = field({ placeholder: 'e.g. x^2 - 5 = 3x', 'aria-label': 'An equation in x' }, run);
  const from = field({ value: '-100', 'aria-label': 'Look from x =', class: 'calc-in calc-num' }, run);
  const to = field({ value: '100', 'aria-label': 'Look to x =', class: 'calc-in calc-num' }, run);
  const solver = el('div', { class: 'calc-pane' }, eq,
    el('div', { class: 'row mid small' }, 'for x from', from, 'to', to, el('button', { class: 'btn sm', type: 'button', onclick: run }, 'Solve')),
    res, el('p', { class: 'muted small' }, 'Use x for the unknown. Every place the sides cross is found; one where they only touch may be missed, so graph it to check.'));

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

  const panes = { calc: sums, graph, solve: solver };
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
    box.value = plain(ans);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
  }
  const box = el('div', { class: 'calc' },
    el('div', { class: 'row mid' }, tabs, el('span', { class: 'spacer' }), angle, keysBtn),
    sums, graph, solver, keypad);
  box.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });   // typing here is not the card's or the page's keys
  setMode(mode);
  return { box, shown: () => { setMode(mode); } };
}
