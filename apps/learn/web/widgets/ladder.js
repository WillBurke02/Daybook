// Ladder: rungs drawn and powered, on the same little PLC as the Structured Text cards.
// Each rung's logic is written as a Boolean expression and drawn as contacts: AND puts
// them in series, OR in parallel branches, NOT A is a normally closed contact, P(A) and
// N(A) are edge contacts (on for one scan as A rises or falls). Power, in colour, flows
// left to right through every contact that conducts; the coil at the right is what the
// rung writes. The PLC scans every scan_ms while the card is open.
//
// params: {rungs: [{logic, out?, coil?: 'set' | 'reset' | 'not', note?,
//                   timer?: {name, type: 'TON' | 'TOF' | 'TP', pt: 'T#3s'},
//                   counter?: {name, type: 'CTU' | 'CTD', pv, reset?}}],
//          inputs: [...], buttons: [...inputs that are push-buttons: on only while held],
//          outputs: [...], scan_ms, st: true to show the program as Structured Text}
// reports: scans, time (ms), and each output as 1 or 0
import { el } from '../core/dom.js';
import { compile, machine, scan } from '../st.js';
import { s, put } from './kit.js';

export const REPORTS = ['scans', 'time'];   // and each output, by its name

// ---- the logic, as a tree of contacts --------------------------------------------------------

/** 'A AND (B OR NOT C)' → {k: 's'|'p', items} of {k: 'c', name, neg, edge}. */
export function parse(src) {
  const toks = String(src).match(/\(|\)|\bAND\b|\bOR\b|\bNOT\b|\b[PN]\(|[A-Za-z_][\w.]*/gi) || [];
  let i = 0;
  const peek = () => toks[i]?.toUpperCase(), next = () => toks[i++];
  const or = () => { const items = [and()]; while (peek() === 'OR') { next(); items.push(and()); } return items.length > 1 ? { k: 'p', items } : items[0]; };
  const and = () => { const items = [unary()]; while (peek() === 'AND') { next(); items.push(unary()); } return items.length > 1 ? { k: 's', items } : items[0]; };
  const unary = () => {
    if (peek() === 'NOT') {
      next();
      const a = atom();
      if (a.k !== 'c' || a.edge) throw new Error('NOT goes on one contact: write NOT A OR NOT B, not NOT (A AND B)');
      return { ...a, neg: !a.neg };
    }
    return atom();
  };
  const atom = () => {
    const t = next();
    if (!t) throw new Error(`the rung "${src}" ends too soon`);
    if (t === '(') { const e = or(); if (next() !== ')') throw new Error(`a ( is not closed in "${src}"`); return e; }
    if (/^[PN]\($/i.test(t)) { const name = next(); if (next() !== ')') throw new Error(`${t}${name} needs its )`); return { k: 'c', name, edge: t[0].toUpperCase() }; }
    if (/^(AND|OR|\))$/i.test(t)) throw new Error(`unexpected ${t} in "${src}"`);
    return { k: 'c', name: t, neg: false };
  };
  const tree = or();
  if (i < toks.length) throw new Error(`unexpected ${toks[i]} in "${src}"`);
  return tree;
}

/** The rungs as a Structured Text program the interpreter runs, top to bottom. */
export function toST(rungs) {
  const decls = {}, body = [], names = new Set(), edges = [];
  const expr = n => {
    if (n.k === 'c') {
      if (n.edge) {
        const e = `_${n.edge}${edges.length + 1}`;
        edges.push(e);
        decls[e] = n.edge === 'P' ? 'R_TRIG' : 'F_TRIG';
        body.push(`${e}(CLK := ${n.name});`);
        names.add(n.name.split('.')[0]);
        return `${e}.Q`;
      }
      names.add(n.name.split('.')[0]);
      return (n.neg ? 'NOT ' : '') + n.name;
    }
    const parts = n.items.map(expr);
    return n.k === 's' ? parts.join(' AND ') : `(${parts.join(' OR ')})`;
  };
  for (const r of rungs) {
    const e = r.logic ? expr(parse(r.logic)) : 'TRUE';
    if (r.timer) {
      decls[r.timer.name] = r.timer.type || 'TON';
      body.push(`${r.timer.name}(IN := ${e}, PT := ${r.timer.pt});`);
      if (r.out) { names.add(r.out); body.push(`${r.out} := ${r.timer.name}.Q;`); }
    } else if (r.counter) {
      const c = r.counter, down = (c.type || 'CTU') === 'CTD';
      decls[c.name] = down ? 'CTD' : 'CTU';
      if (c.reset) names.add(c.reset);
      body.push(`${c.name}(${down ? 'CD' : 'CU'} := ${e}, ${down ? 'LD' : 'R'} := ${c.reset || 'FALSE'}, PV := ${c.pv});`);
      if (r.out) { names.add(r.out); body.push(`${r.out} := ${c.name}.Q;`); }
    } else if (r.out) {
      names.add(r.out);
      body.push(r.coil === 'set' ? `IF ${e} THEN ${r.out} := TRUE; END_IF;` : r.coil === 'reset' ? `IF ${e} THEN ${r.out} := FALSE; END_IF;`
        : r.coil === 'not' ? `${r.out} := NOT (${e});` : `${r.out} := ${e};`);
    }
  }
  for (const n of names) if (!(n in decls) && !/^(TRUE|FALSE)$/i.test(n)) decls[n] = 'BOOL';   // memory bits: declared for them
  return `VAR ${Object.entries(decls).map(([k, t]) => `${k} : ${t};`).join(' ')} END_VAR\n${body.join('\n')}`;
}

// ---- drawing -------------------------------------------------------------------------------------

const CW = 76, ROW = 54, COIL = 64, BOXW = 116;
const rows = n => n.k === 'c' ? 1 : n.k === 's' ? Math.max(...n.items.map(rows)) : n.items.reduce((a, b) => a + rows(b), 0);
const cols = n => n.k === 'c' ? 1 : n.k === 's' ? n.items.reduce((a, b) => a + cols(b), 0) : Math.max(...n.items.map(cols));

/** Draw node n into g, from x across width w, its wire at y. Returns whether power comes out. */
function draw(n, g, x, y, w, power, value, edges) {
  if (n.k === 'c') {
    const v = n.edge ? !!value(edges.get(n))?.Q : !!value(n.name);
    const shut = n.neg ? !v : v, out = power && shut, cx = x + CW / 2;
    g.append(s('line', { class: 'wire' + (power ? ' on' : ''), x1: x, y1: y, x2: cx - 9, y2: y }),
      s('line', { class: 'wire' + (out ? ' on' : ''), x1: cx + 9, y1: y, x2: x + w, y2: y }),
      s('g', { class: 'contact' + (shut ? ' shut' : '') },
        s('line', { x1: cx - 9, y1: y - 11, x2: cx - 9, y2: y + 11 }), s('line', { x1: cx + 9, y1: y - 11, x2: cx + 9, y2: y + 11 }),
        n.neg ? s('line', { x1: cx - 12, y1: y + 11, x2: cx + 12, y2: y - 11 }) : null,
        n.edge ? s('text', { x: cx, y: y + 4, 'text-anchor': 'middle', class: 'edge' }, n.edge) : null),
      s('text', { x: cx, y: y - 17, 'text-anchor': 'middle', class: 'tag' + (v ? ' true' : '') }, n.name));
    return out;
  }
  if (n.k === 's') {
    let at = x, p = power;
    n.items.forEach((c, k) => {
      const cw = k === n.items.length - 1 ? x + w - at : cols(c) * CW;
      p = draw(c, g, at, y, cw, p, value, edges);
      at += cw;
    });
    return p;
  }
  let out = false, at = y;
  const ys = [];
  for (const c of n.items) { ys.push(at); out = draw(c, g, x, at, w, power, value, edges) || out; at += rows(c) * ROW; }
  g.append(s('line', { class: 'wire' + (power ? ' on' : ''), x1: x, y1: ys[0], x2: x, y2: ys.at(-1) }),
    s('line', { class: 'wire' + (out ? ' on' : ''), x1: x + w, y1: ys[0], x2: x + w, y2: ys.at(-1) }));
  return out;
}

const ms = t => t >= 1000 ? `${+(t / 1000).toFixed(1)} s` : `${t} ms`;

export function mount(box, p, report) {
  const rungs = p.rungs || [], ins = p.inputs || [], outs = p.outputs || [], held = new Set(p.buttons || []), dt = p.scan_ms || 100;
  const err = el('p', { class: 'err', hidden: true });
  let trees, src, m;
  const edges = new Map();
  try {
    trees = rungs.map(r => r.logic ? parse(r.logic) : null);
    src = toST(rungs);
    // the edge blocks toST made, matched to their contacts in the same order
    let k = 0;
    const walk = n => { if (!n) return; if (n.k === 'c') { if (n.edge) edges.set(n, `_${n.edge}${++k}`); } else n.items.forEach(walk); };
    trees.forEach(walk);
  } catch (e) { err.textContent = e.message; err.hidden = false; box.append(err); return; }
  const physical = Object.fromEntries(ins.map(n => [n, false]));
  const lamps = Object.fromEntries(outs.map(n => [n, el('span', { class: 'lamp' })]));
  const pic = el('div', { class: 'ladder' }), status = el('span', { class: 'num small muted' });
  const reset = () => { m = machine(compile(src), { inputs: ins, outputs: outs }); show(); };
  const value = name => {
    if (!m) return false;
    const [head, ...rest] = name.split('.');
    let v = m.vars[Object.keys(m.vars).find(x => x.toLowerCase() === head.toLowerCase())];
    for (const r of rest) v = v?.[Object.keys(v).find(x => x.toLowerCase() === r.toLowerCase())];
    return v;
  };
  const logicCols = Math.max(2, ...trees.map(t => t ? cols(t) : 1));
  const width = 20 + logicCols * CW + Math.max(COIL, ...rungs.map(r => (r.timer || r.counter) ? BOXW + (r.out ? COIL : 0) : COIL)) + 20;
  const show = () => {
    const svg = s('svg', { viewBox: `0 0 ${width} ${rungs.reduce((a, r, i) => a + (trees[i] ? rows(trees[i]) : 1) * ROW + (r.note ? 16 : 0), 0) + 12}`,
                           class: 'ladsvg', role: 'img', 'aria-label': 'Ladder diagram' });
    let y = 8;
    rungs.forEach((r, i) => {
      const t = trees[i], h = (t ? rows(t) : 1) * ROW;
      if (r.note) { svg.append(s('text', { x: 16, y: y + 10, class: 'note' }, r.note)); y += 16; }
      const mid = y + 28, g = s('g', {});
      g.append(s('text', { x: 2, y: mid + 4, class: 'num' }, String(i + 1)));
      const left = 16, logicEnd = left + logicCols * CW;
      const power = t ? draw(t, g, left, mid, logicCols * CW, true, value, edges) : true;
      if (!t) g.append(s('line', { class: 'wire on', x1: left, y1: mid, x2: logicEnd, y2: mid }));
      let x = logicEnd, into = power;
      const blk = r.timer || r.counter;
      if (blk) {
        const fb = value(blk.name) || {};
        const lines = r.timer ? [`${blk.type || 'TON'} ${blk.name}`, `PT ${String(blk.pt).replace(/^T#/i, '')}`, `ET ${ms(fb.ET || 0)}`]
          : [`${blk.type || 'CTU'} ${blk.name}`, `PV ${blk.pv}`, `CV ${fb.CV ?? 0}${blk.reset ? `  R: ${blk.reset}` : ''}`];
        g.append(s('line', { class: 'wire' + (into ? ' on' : ''), x1: x, y1: mid, x2: x + 8, y2: mid }),
          s('rect', { class: 'fb' + (fb.Q ? ' done' : ''), x: x + 8, y: mid - 24, width: BOXW - 16, height: 48, rx: 3 }),
          ...lines.map((l, k) => s('text', { x: x + 14, y: mid - 10 + k * 14, class: k ? 'fbv' : 'fbn' }, l)));
        x += BOXW - 8;
        into = !!fb.Q;
        g.append(s('line', { class: 'wire' + (into ? ' on' : ''), x1: x, y1: mid, x2: x + 8, y2: mid }));
        x += 8;
      }
      const right = width - 10;
      if (r.out) {
        const cx = right - COIL / 2, on = !!value(r.out);
        g.append(s('line', { class: 'wire' + (into ? ' on' : ''), x1: x, y1: mid, x2: cx - 12, y2: mid }),
          s('g', { class: 'coil' + (on ? ' on' : '') },
            s('path', { d: `M${cx - 6} ${mid - 11} A 12 12 0 0 0 ${cx - 6} ${mid + 11}` }),
            s('path', { d: `M${cx + 6} ${mid - 11} A 12 12 0 0 1 ${cx + 6} ${mid + 11}` }),
            r.coil ? s('text', { x: cx, y: mid + 4, 'text-anchor': 'middle', class: 'edge' }, { set: 'S', reset: 'R', not: '/' }[r.coil]) : null),
          s('text', { x: cx, y: mid - 17, 'text-anchor': 'middle', class: 'tag' + (on ? ' true' : '') }, r.out),
          s('line', { class: 'wire', x1: cx + 12, y1: mid, x2: right, y2: mid }));
      } else g.append(s('line', { class: 'wire', x1: x, y1: mid, x2: right, y2: mid }));
      g.append(s('line', { class: 'rail', x1: left, y1: y, x2: left, y2: y + h }), s('line', { class: 'rail', x1: right, y1: y, x2: right, y2: y + h }));
      svg.append(g);
      y += h;
    });
    put(pic, svg);
    for (const n of outs) lamps[n].classList.toggle('on', !!value(n));
    status.textContent = m ? `scan ${m.scans} · ${(m.time / 1000).toFixed(1)} s` : '';
    report({ scans: m?.scans || 0, time: m?.time || 0, ...Object.fromEntries(outs.map(n => [n, value(n) ? 1 : 0])) });
  };
  const tick = () => {
    if (!box.isConnected) { clearInterval(timer); return; }
    if (paused || !m) return;
    try { scan(m, physical, dt); } catch (e) { err.textContent = e.message; err.hidden = false; paused = true; }
    show();
  };
  let paused = false;
  const timer = setInterval(tick, dt);
  const pause = el('button', { class: 'btn plain sm', type: 'button', onclick: () => { paused = !paused; pause.textContent = paused ? '▶ Run' : '❚❚ Pause'; } }, '❚❚ Pause');
  const control = n => {
    if (!held.has(n))
      return el('label', { class: 'pswitch' }, el('input', { type: 'checkbox', onchange: e => { physical[n] = e.target.checked; } }), n);
    const b = el('button', { class: 'btn plain sm pbutton', type: 'button', title: 'A push-button: on only while held' }, n);
    const set = v => { physical[n] = v; b.classList.toggle('held', v); };
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); set(true); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => set(false));
    b.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); set(true); } });
    b.addEventListener('keyup', () => set(false));
    return b;
  };
  box.append(...[el('div', { class: 'plc lad' },
    el('div', { class: 'col' }, el('div', { class: 'small muted' }, 'Inputs'), ins.map(control)),
    el('div', { class: 'col grow' }, pic),
    el('div', { class: 'col' }, el('div', { class: 'small muted' }, 'Outputs'), outs.map(n => el('span', { class: 'out' }, lamps[n], n)))),
    el('div', { class: 'row mid' }, pause, el('button', { class: 'btn plain sm', type: 'button', onclick: reset }, 'Reset'), status),
    p.st ? el('details', { class: 'small' }, el('summary', { class: 'muted' }, 'The same program in Structured Text'),
      el('pre', { class: 'st' }, src.replace(/^VAR (.*) END_VAR\n/, (_, d) => `VAR\n  ${d.split('; ').join(';\n  ')}\nEND_VAR\n`))) : null,
    err].filter(Boolean));
  reset();
}
