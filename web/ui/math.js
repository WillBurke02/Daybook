// Maths notation: a small TeX subset turned into MathML, which Chromium,
// Firefox and Safari draw natively, so no library. Enough for A-level maths
// and physics: fractions, powers and subscripts, roots, Greek letters,
// ∫ ∑ ∏ lim with limits, vectors and accents, matrices up to any size,
// \left( \right), \text and \mathrm for units, and the common symbols.
//
//   tex('\\frac{v t}{2}')           -> '<math><mfrac>…</mfrac></math>'
//   split('Pulse-echo: $d = \\tfrac{vt}{2}$.') -> [{text}, {math, display}, {text}]
//
// The output is a string built only from escaped text and fixed tags, so it is
// safe to put into innerHTML even when the TeX came from something you typed.

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
  sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' };
const SYMBOL = { times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠',
  neq: '≠', approx: '≈', equiv: '≡', propto: '∝', sim: '∼', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒',
  Leftrightarrow: '⇔', infty: '∞', partial: '∂', nabla: '∇', circ: '∘', degree: '°', cdots: '⋯', ldots: '…', dots: '…',
  in: '∈', notin: '∉', subset: '⊂', cup: '∪', cap: '∩', angle: '∠', perp: '⊥', parallel: '∥', therefore: '∴',
  ohm: 'Ω', '%': '%', '{': '{', '}': '}', '#': '#', '&': '&', '_': '_', '|': '‖', lt: '<', gt: '>' };
const BIG = { sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮' };
const FUNCS = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cosec', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh',
  'tanh', 'ln', 'log', 'exp', 'lim', 'max', 'min', 'det', 'arg', 'sgn']);
const ACCENT = { vec: '→', hat: '^', bar: '¯', overline: '¯', dot: '˙', ddot: '¨', tilde: '~' };
const SPACE = { ',': '0.167em', ':': '0.222em', ';': '0.278em', ' ': '0.25em', quad: '1em', qquad: '2em' };
const FENCE = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], vmatrix: ['|', '|'], Bmatrix: ['{', '}'], cases: ['{', ''], matrix: ['', ''] };

function tokens(src) {
  const out = [];
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '\\') {
      const m = src.slice(i + 1).match(/^[A-Za-z]+/);
      if (m) {
        out.push({ t: 'cmd', v: m[0] }); i += 1 + m[0].length;
        if (/^(text|textrm|mbox|operatorname)$/.test(m[0]) && src[i] === '{') {   // words keep their spaces
          let depth = 0, j = i;
          for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && !--depth) break; }
          out.push({ t: 'raw', v: src.slice(i + 1, j) }); i = j + 1;
        }
      }
      else { out.push({ t: 'cmd', v: src[i + 1] || '' }); i += 2; }
      continue;
    }
    if (/\d/.test(c)) { const m = src.slice(i).match(/^\d+(\.\d+)?/); out.push({ t: 'num', v: m[0] }); i += m[0].length; continue; }
    if (/[A-Za-z]/.test(c)) { out.push({ t: 'id', v: c }); i++; continue; }
    out.push({ t: c === '{' || c === '}' || c === '^' || c === '_' || c === '&' ? c : 'op', v: c }); i++;
  }
  return out;
}

const mo = (v, attrs = '') => `<mo${attrs}>${esc(v)}</mo>`;
const row = xs => xs.length === 1 ? xs[0] : `<mrow>${xs.join('')}</mrow>`;

function parser(src) {
  const t = tokens(src);
  let i = 0, upright = false;                            // upright: inside \mathrm, letters are not italic
  const peek = () => t[i], next = () => t[i++];
  const rawGroup = () => {                                // \text{...}: the characters as written
    if (peek()?.t !== '{') return next()?.v || '';
    let depth = 0, s = '';
    next();
    for (let tok = next(); tok && !(tok.t === '}' && depth === 0); tok = next()) {
      if (tok.t === '{') depth++;
      if (tok.t === '}') depth--;
      s += tok.t === 'cmd' ? (SPACE[tok.v] ? ' ' : SYMBOL[tok.v] ?? tok.v) : tok.v;
    }
    return s;
  };
  const arg = () => {                                     // one argument: {group} or a single atom
    if (peek()?.t === '{') { next(); const r = seq(['}']); next(); return row(r); }
    return atom() ?? '<mrow></mrow>';
  };

  function matrix(env) {
    const rows = [[[]]];
    for (;;) {
      const tok = peek();
      if (!tok) break;
      if (tok.t === 'cmd' && tok.v === 'end') { next(); rawGroup(); break; }
      if (tok.t === '&') { next(); rows[rows.length - 1].push([]); continue; }
      if (tok.t === 'cmd' && tok.v === '\\') { next(); rows.push([[]]); continue; }
      const cell = rows[rows.length - 1];
      const a = piece();
      if (a != null) cell[cell.length - 1].push(a);
    }
    const body = rows.filter(r => r.some(c => c.length)).map(r => `<mtr>${r.map(c => `<mtd>${row(c)}</mtd>`).join('')}</mtr>`).join('');
    const [l, r] = FENCE[env] || ['', ''];
    const table = `<mtable${env === 'cases' ? ' columnalign="left"' : ''}>${body}</mtable>`;
    return `<mrow>${l ? mo(l, ' fence="true" stretchy="true"') : ''}${table}${r ? mo(r, ' fence="true" stretchy="true"') : ''}</mrow>`;
  }

  function atom() {
    const tok = next();
    if (!tok) return null;
    if (tok.t === 'num') return `<mn>${tok.v}</mn>`;
    if (tok.t === 'id') return upright ? `<mi mathvariant="normal">${tok.v}</mi>` : `<mi>${tok.v}</mi>`;
    if (tok.t === '{') { const r = seq(['}']); next(); return row(r); }
    if (tok.t === 'op') {
      const v = { '-': '−', '*': '∗', "'": '′' }[tok.v] || tok.v;
      return /[()[\]|]/.test(v) ? mo(v, ' stretchy="false"') : mo(v);
    }
    if (tok.t !== 'cmd') return null;
    const c = tok.v;
    if (c === 'frac' || c === 'dfrac' || c === 'tfrac') {
      const f = `<mfrac>${arg()}${arg()}</mfrac>`;
      return c === 'tfrac' ? `<mstyle displaystyle="false">${f}</mstyle>` : c === 'dfrac' ? `<mstyle displaystyle="true">${f}</mstyle>` : f;
    }
    if (c === 'sqrt') {
      if (peek()?.v === '[') {
        next(); const n = seq([']']); next();
        return `<mroot>${arg()}${row(n)}</mroot>`;
      }
      return `<msqrt>${arg()}</msqrt>`;
    }
    if (c in GREEK) return /[A-Z]/.test(c[0]) ? `<mi mathvariant="normal">${GREEK[c]}</mi>` : `<mi>${GREEK[c]}</mi>`;
    if (c in BIG) return mo(BIG[c], c.endsWith('int') ? ' largeop="true"' : ' largeop="true" movablelimits="true"');
    if (FUNCS.has(c)) return `<mi>${c === 'cosec' ? 'cosec' : c}</mi>`;
    const words = () => peek()?.t === 'raw' ? next().v : rawGroup();
    if (c === 'text' || c === 'textrm' || c === 'mbox') return `<mtext>${esc(words())}</mtext>`;
    if (c === 'operatorname') return `<mi>${esc(words())}</mi>`;
    if (c === 'mathrm' || c === 'unit') { const was = upright; upright = true; const a = arg(); upright = was; return a; }
    if (c === 'mathbf' || c === 'boldsymbol' || c === 'bm') return `<mstyle mathvariant="bold">${arg()}</mstyle>`;
    if (c in ACCENT) return `<mover accent="true">${arg()}${mo(ACCENT[c], ' stretchy="false"')}</mover>`;
    if (c in SPACE) return `<mspace width="${SPACE[c]}"/>`;
    if (c === '!' || c === '\\' || c === 'displaystyle' || c === 'limits') return '';
    if (c === 'left' || c === 'right') {
      const d = next();
      const v = d?.t === 'cmd' ? (SYMBOL[d.v] ?? d.v) : d?.v;
      if (c === 'right') return v === '.' ? '' : mo(v, ' fence="true" stretchy="true"');
      const inner = seq([], true);
      const close = peek() ? atom() : '';                  // the \right that ended it
      return `<mrow>${v === '.' ? '' : mo(v, ' fence="true" stretchy="true"')}${inner.join('')}${close}</mrow>`;
    }
    if (c === 'begin') return matrix(rawGroup());
    if (c in SYMBOL) return mo(SYMBOL[c]);
    return `<merror><mtext>\\${esc(c)}</mtext></merror>`;   // unknown: shown, so a typo is seen
  }

  function piece() {
    let base = atom();
    if (base == null) return null;
    const limits = /<mo[^>]*movablelimits|<mi>(lim|max|min)<\/mi>$/.test(base);
    let sub = null, sup = null;
    while (peek() && (peek().t === '^' || peek().t === '_')) {
      const k = next().t;
      if (k === '^') sup = arg(); else sub = arg();
    }
    if (sub && sup) return limits ? `<munderover>${base}${sub}${sup}</munderover>` : `<msubsup>${base}${sub}${sup}</msubsup>`;
    if (sub) return limits ? `<munder>${base}${sub}</munder>` : `<msub>${base}${sub}</msub>`;
    if (sup) return limits ? `<mover>${base}${sup}</mover>` : `<msup>${base}${sup}</msup>`;
    return base;
  }

  /** Pieces until one of stop (a token value), the end, or (inLeft) a \right. */
  function seq(stop, inLeft = false) {
    const out = [];
    while (peek()) {
      const k = peek();
      if (stop.includes(k.t) || (k.t === 'op' && stop.includes(k.v))) break;
      if (inLeft && k.t === 'cmd' && k.v === 'right') break;
      if (k.t === '}' ) { next(); continue; }             // a stray brace: skip it rather than fail
      const p = piece();
      if (p) out.push(p);
    }
    return out;
  }
  return () => { const r = seq([]); return r.join(''); };
}

/** TeX (without the $ signs) to a MathML string. */
export function tex(src, display = false) {
  let body;
  try { body = parser(String(src ?? ''))(); }
  catch { body = `<merror><mtext>${esc(src)}</mtext></merror>`; }
  return `<math${display ? ' display="block"' : ''}>${body}</math>`;
}

/** Text with $inline$ and $$display$$ maths, as pieces in order. \$ is a dollar sign. */
export function split(text) {
  const out = [];
  const s = String(text ?? '');
  const re = /\$\$([\s\S]+?)\$\$|(?<!\\)\$((?:\\\$|[^$])+?)\$/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index).replace(/\\\$/g, '$') });
    out.push({ math: m[1] ?? m[2], display: m[1] != null });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ text: s.slice(last).replace(/\\\$/g, '$') });
  return out;
}
