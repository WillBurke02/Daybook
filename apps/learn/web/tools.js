// The tool dock: a whiteboard and a calculator beside the card on screen. W opens the
// whiteboard, C the calculator; the card's own links do the same. Docked to the right
// on a wide screen (the page makes room), a sheet from the bottom on a narrow one.
//
// The board is one per card, kept in learn.db (sketch), so when the card comes back it
// offers "your working last time". The calculator is Daybook's formula engine (calc.js),
// and "Use this answer" puts its result in the card's box.
// ponytail: no floating or popped-out windows; add them if docked proves too tight.
import { api } from './api.js';
import { el, flash } from './core/dom.js';
import { dateUK } from './core/format.js';
import { calc, eng, plain } from './calc.js';

const current = () => document.querySelector('.lcard.current') || [...document.querySelectorAll('.lcard')].at(-1) || null;
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

let dock = null, tabs = null, tools = {}, showing = null, watch = null;

/** Open a tool, or close it if it is the one open. */
export function toggle(name) {
  if (showing === name) return close();
  open(name);
}

function open(name) {
  if (!dock) build();
  showing = name;
  for (const [k, t] of Object.entries(tools)) { t.box.hidden = k !== name; tabs[k].setAttribute('aria-pressed', String(k === name)); }
  dock.hidden = false;
  document.body.classList.add('tooling');
  tools[name].shown?.();
  clearInterval(watch);
  watch = setInterval(() => { if (!dock.hidden) tools[showing]?.follow?.(); }, 600);   // the card on screen changes under us
}

function close() {
  if (!dock) return;
  tools.board.save();
  dock.hidden = true;
  showing = null;
  clearInterval(watch);
  document.body.classList.remove('tooling');
}

function build() {
  tools = { board: board(), calc: calculator() };
  tabs = { board: el('button', { class: 'chip', type: 'button', onclick: () => open('board') }, 'Whiteboard ', el('kbd', {}, 'W')),
           calc: el('button', { class: 'chip', type: 'button', onclick: () => open('calc') }, 'Calculator ', el('kbd', {}, 'C')) };
  dock = el('aside', { class: 'dock', hidden: true, 'aria-label': 'Tools' },
    el('header', { class: 'row mid' }, tabs.board, tabs.calc, el('span', { class: 'spacer' }),
      el('button', { class: 'icon', type: 'button', 'aria-label': 'Close the tools', title: 'Close (Esc)', onclick: close }, '×')),
    tools.board.box, tools.calc.box);
  dock.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.body.append(dock);
  addEventListener('beforeunload', () => tools.board.save());
}

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

// ---- the calculator -----------------------------------------------------------------------------

function calculator() {
  const tape = el('ol', { class: 'calc-tape', 'aria-label': 'Earlier sums' });
  const input = el('input', { class: 'calc-in', autocomplete: 'off', spellcheck: false, placeholder: 'e.g. 230 / 4.7k   sin(30)   ans * 2',
                              'aria-label': 'A sum' });
  const out = el('div', { class: 'calc-out num' });
  let ans = 0, deg = store('learn.deg') !== '0', history = [], back = 0;
  const angle = el('button', { class: 'chip', type: 'button', onclick: () => { deg = !deg; store('learn.deg', deg ? '1' : '0'); angle.textContent = deg ? 'Degrees' : 'Radians'; } },
    deg ? 'Degrees' : 'Radians');
  const show = v => out.replaceChildren(el('strong', {}, plain(v)), / \S$/.test(eng(v)) ? el('span', { class: 'muted' }, `  =  ${eng(v)}`) : '');
  const go = () => {
    const src = input.value.trim();
    if (!src) return;
    const r = calc(src, { ans, deg });
    if (r.error) { out.replaceChildren(el('span', { class: 'deb' }, r.error)); return; }
    ans = r.value;
    history.push(src); back = history.length;
    tape.append(el('li', { title: 'Use this sum again', onclick: () => { input.value = src; input.focus(); } },
      el('span', {}, src), el('span', { class: 'num' }, ` = ${plain(r.value)}`)));
    tape.scrollTop = tape.scrollHeight;
    show(ans);
    input.value = '';
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); go(); }
    else if (e.key === 'ArrowUp' && back > 0) { e.preventDefault(); input.value = history[--back]; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); back = Math.min(history.length, back + 1); input.value = history[back] || ''; }
    e.stopPropagation();                             // typing here is not the card's or the page's keys
  });
  const use = () => {
    const box = current()?.querySelector('input.answer:not(:disabled)');
    if (!box) return flash('This card has no box for a number');
    box.value = plain(ans);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
  };
  const box = el('div', { class: 'calc' }, tape, out,
    el('div', { class: 'row mid' }, input, el('button', { class: 'btn sm', type: 'button', onclick: go }, '=')),
    el('div', { class: 'row mid' }, angle, el('button', { class: 'btn plain sm', type: 'button', onclick: use }, 'Use this answer'),
      el('button', { class: 'btn plain sm', type: 'button', onclick: () => { tape.replaceChildren(); history = []; back = 0; } }, 'Clear')),
    el('p', { class: 'muted small' }, 'SI prefixes after a number: 4.7k, 220µ (or u), 2.5m, 10M. ', el('code', {}, 'ans'),
      ' is the last answer; log is to base 10, ln natural; ', el('code', {}, 'sqrt'), ', ', el('code', {}, '^'), ' for powers.'));
  return { box, shown: () => input.focus() };
}
