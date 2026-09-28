// A small Structured Text (IEC 61131-3) interpreter for the mini PLC and the
// code cards. One call to scan() is one PLC scan: inputs are read, the program
// runs top to bottom once, outputs are what the variables hold at the end.
//
//   VAR T1 : TON; Count : INT := 0; END_VAR
//   Motor := (Start OR Motor) AND NOT Stop;          (* seal-in *)
//   T1(IN := Motor, PT := T#2s);
//   IF T1.Q THEN Lamp := TRUE; ELSIF Count > 3 THEN Lamp := FALSE; END_IF;
//   CASE Step OF 0: Step := 1; 1, 2: Step := Step + 1; ELSE Step := 0; END_CASE;
//
// Types: BOOL, INT (and DINT, UINT, WORD…), REAL, TIME (T#2s, T#500ms, T#1m30s),
// and the standard blocks TON, TOF, TP, CTU, CTD, R_TRIG, F_TRIG, SR, RS.
// Also FOR … TO … BY … DO … END_FOR and WHILE … DO … END_WHILE (capped).
// ponytail: no arrays, structs, strings or user function blocks; the cards do not need them yet.

const KEYWORDS = new Set(['IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF', 'CASE', 'OF', 'END_CASE', 'AND', 'OR', 'XOR', 'NOT',
  'MOD', 'TRUE', 'FALSE', 'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_GLOBAL', 'END_VAR', 'FOR', 'TO', 'BY', 'DO', 'END_FOR',
  'WHILE', 'END_WHILE', 'RETURN', 'PROGRAM', 'END_PROGRAM']);
const BLOCKS = {
  TON: { IN: false, PT: 0, Q: false, ET: 0 }, TOF: { IN: false, PT: 0, Q: false, ET: 0 }, TP: { IN: false, PT: 0, Q: false, ET: 0, _m: false },
  CTU: { CU: false, R: false, PV: 0, Q: false, CV: 0, _m: false }, CTD: { CD: false, LD: false, PV: 0, Q: false, CV: 0, _m: false },
  R_TRIG: { CLK: false, Q: false, _m: false }, F_TRIG: { CLK: false, Q: false, _m: false },
  SR: { S1: false, R: false, Q1: false }, RS: { S: false, R1: false, Q1: false },
};
const NUMERIC = /^(S|D|L|U|US|UD|UL)?INT$|^(REAL|LREAL|BYTE|WORD|DWORD|TIME)$/;

export class STError extends Error {
  constructor(msg, line) { super(line ? `line ${line}: ${msg}` : msg); this.line = line; }
}

/** 'T#1m30s', 'T#500ms', 'TIME#2.5s' -> milliseconds. */
export function time(lit) {
  const s = lit.replace(/^(T|TIME)#/i, '').toLowerCase().replace(/_/g, '');
  let ms = 0, any = false;
  for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)(ms|d|h|m|s)/g)) {
    ms += +n * { d: 864e5, h: 36e5, m: 6e4, s: 1e3, ms: 1 }[u]; any = true;
  }
  if (!any) throw new STError(`not a time: ${lit}`);
  return ms;
}

function tokens(src) {
  const out = [];
  let line = 1;
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('(*', i)) { const j = src.indexOf('*)', i + 2); const end = j < 0 ? src.length : j + 2; line += (src.slice(i, end).match(/\n/g) || []).length; i = end; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    let m = src.slice(i).match(/^(T|TIME)#[\d_.a-z]+/i);
    if (m) { out.push({ t: 'num', v: time(m[0]), line, src: m[0] }); i += m[0].length; continue; }
    m = src.slice(i).match(/^\d+(\.\d+)?([eE][+-]?\d+)?/);
    if (m) { out.push({ t: 'num', v: +m[0].replace(/_/g, ''), line, real: !!m[1] }); i += m[0].length; continue; }
    m = src.slice(i).match(/^[A-Za-z_]\w*/);
    if (m) {
      const up = m[0].toUpperCase();
      out.push(KEYWORDS.has(up) ? { t: 'kw', v: up, line } : { t: 'id', v: m[0], line });
      i += m[0].length; continue;
    }
    m = src.slice(i).match(/^(:=|<>|<=|>=|=>|\.\.|[=<>+\-*/(),;:.])/);
    if (m) { out.push({ t: 'op', v: m[0], line }); i += m[0].length; continue; }
    throw new STError(`unexpected "${c}"`, line);
  }
  return out;
}

/** Source -> a program: {decls: {name: type}, init: {name: value}, body: statements}. Throws STError. */
export function compile(src) {
  const t = tokens(String(src ?? ''));
  let i = 0;
  const peek = () => t[i], next = () => t[i++];
  const line = () => (t[i] || t[t.length - 1])?.line;
  const is = (v, k) => peek() && peek().v === v && (!k || peek().t === k);
  const want = (v) => { const k = next(); if (!k || k.v !== v) throw new STError(`expected ${v}${k ? `, found ${k.v}` : ''}`, k?.line ?? line()); return k; };
  const decls = {}, init = {};

  // expressions, lowest precedence first
  const expr = () => orExpr();
  const bin = (sub, ops) => () => {
    let a = sub();
    while (peek() && ops.includes(peek().v) && (peek().t === 'op' || peek().t === 'kw')) { const op = next().v; a = { k: 'bin', op, a, b: sub() }; }
    return a;
  };
  const primary = () => {
    const k = next();
    if (!k) throw new STError('the line ends too soon', line());
    if (k.t === 'num') return { k: 'lit', v: k.v, real: k.real };
    if (k.t === 'kw' && (k.v === 'TRUE' || k.v === 'FALSE')) return { k: 'lit', v: k.v === 'TRUE' };
    if (k.t === 'kw' && k.v === 'NOT') return { k: 'not', a: unary() };
    if (k.v === '-' && k.t === 'op') return { k: 'neg', a: unary() };
    if (k.v === '(') { const e = expr(); want(')'); return e; }
    if (k.t === 'id') {
      const path = [k.v];
      while (is('.', 'op')) { next(); path.push(next().v); }
      return { k: 'var', path, line: k.line };
    }
    throw new STError(`unexpected ${k.v}`, k.line);
  };
  const unary = primary;
  const mulExpr = bin(unary, ['*', '/', 'MOD']);
  const addExpr = bin(mulExpr, ['+', '-']);
  const cmpExpr = bin(addExpr, ['=', '<>', '<', '>', '<=', '>=']);
  const andExpr = bin(cmpExpr, ['AND', '&']);
  const xorExpr = bin(andExpr, ['XOR']);
  const orExpr = bin(xorExpr, ['OR']);

  const stmts = (...ends) => {
    const out = [];
    while (peek() && !ends.includes(peek().v)) {
      if (is(';', 'op')) { next(); continue; }
      out.push(stmt());
    }
    return out;
  };
  const stmt = () => {
    const k = peek();
    if (k.t === 'kw' && k.v === 'IF') {
      next();
      const arms = [];
      let c = expr(); want('THEN');
      arms.push([c, stmts('ELSIF', 'ELSE', 'END_IF')]);
      while (is('ELSIF')) { next(); c = expr(); want('THEN'); arms.push([c, stmts('ELSIF', 'ELSE', 'END_IF')]); }
      const other = is('ELSE') ? (next(), stmts('END_IF')) : [];
      want('END_IF');
      return { k: 'if', arms, other, line: k.line };
    }
    if (k.t === 'kw' && k.v === 'CASE') {
      next();
      const sel = expr(); want('OF');
      const branches = [];
      while (peek() && peek().t === 'num' || is('-', 'op')) {
        const labels = [];
        do {
          const neg = is('-', 'op') ? (next(), -1) : 1;
          const lo = neg * next().v;
          if (is('..', 'op')) { next(); labels.push([lo, next().v]); } else labels.push([lo, lo]);
        } while (is(',', 'op') && next());
        want(':');
        // the body runs until the next label (a number then ':' or '..' or ',') or ELSE / END_CASE
        const body = [];
        while (peek() && !is('ELSE') && !is('END_CASE') && !(peek().t === 'num' && [':', '..', ','].includes(t[i + 1]?.v))) {
          if (is(';', 'op')) { next(); continue; }
          body.push(stmt());
        }
        branches.push({ labels, body });
      }
      const other = is('ELSE') ? (next(), stmts('END_CASE')) : [];
      want('END_CASE');
      return { k: 'case', sel, branches, other, line: k.line };
    }
    if (k.t === 'kw' && k.v === 'FOR') {
      next();
      const v = next().v; want(':=');
      const from = expr(); want('TO'); const to = expr();
      const by = is('BY') ? (next(), expr()) : { k: 'lit', v: 1 };
      want('DO'); const body = stmts('END_FOR'); want('END_FOR');
      return { k: 'for', v, from, to, by, body, line: k.line };
    }
    if (k.t === 'kw' && k.v === 'WHILE') {
      next(); const c = expr(); want('DO'); const body = stmts('END_WHILE'); want('END_WHILE');
      return { k: 'while', c, body, line: k.line };
    }
    if (k.t === 'kw' && k.v === 'RETURN') { next(); return { k: 'return' }; }
    if (k.t !== 'id') throw new STError(`a line cannot start with ${k.v}`, k.line);
    next();
    const path = [k.v];
    while (is('.', 'op')) { next(); path.push(next().v); }
    if (is('(', 'op')) {                                   // T1(IN := x, PT := T#2s);
      next();
      const args = {};
      while (!is(')', 'op')) {
        const name = next().v; want(':='); args[name.toUpperCase()] = expr();
        if (is(',', 'op')) next();
      }
      want(')');
      return { k: 'call', name: k.v, args, line: k.line };
    }
    want(':=');
    return { k: 'set', path, e: expr(), line: k.line };
  };

  // declarations: VAR … END_VAR blocks anywhere at the top level
  const body = [];
  while (peek()) {
    if (peek().t === 'kw' && peek().v.startsWith('VAR')) {
      next();
      while (!is('END_VAR')) {
        const names = [next().v];
        while (is(',', 'op')) { next(); names.push(next().v); }
        want(':');
        const type = next().v.toUpperCase();
        let v = type in BLOCKS ? null : NUMERIC.test(type) ? 0 : false;
        if (is(':=', 'op')) { next(); const e = expr(); v = evalConst(e); }
        want(';');
        for (const n of names) { decls[n] = type; if (!(type in BLOCKS)) init[n] = v; }
      }
      want('END_VAR');
    } else if (peek().t === 'kw' && (peek().v === 'PROGRAM' || peek().v === 'END_PROGRAM')) {
      next(); if (peek()?.t === 'id') next();
    } else if (is(';', 'op')) next();
    else body.push(stmt());
  }
  return { decls, init, body };
}

function evalConst(e) {
  if (e.k === 'lit') return e.v;
  if (e.k === 'neg') return -evalConst(e.a);
  throw new STError('an initial value must be a plain value');
}

// --- running ------------------------------------------------------------------------

/** A fresh PLC for a program: variables at their initial values, blocks reset, time 0. */
export function machine(prog, { inputs = [], outputs = [] } = {}) {
  const vars = { ...prog.init };
  for (const n of [...inputs, ...outputs]) if (!(n in vars)) vars[n] = false;
  for (const [n, type] of Object.entries(prog.decls)) if (type in BLOCKS) vars[n] = { ...BLOCKS[type], _type: type };
  return { vars, time: 0, scans: 0, prog };
}

const truthy = v => typeof v === 'boolean' ? v : !!v;
const find = (name, vars) => Object.keys(vars).find(k => k.toLowerCase() === name.toLowerCase()) ?? name;   // ST names ignore case

function get(path, m, line) {
  let v = m.vars[find(path[0], m.vars)];
  if (v === undefined) throw new STError(`${path[0]} is not declared`, line);
  for (const p of path.slice(1)) {
    if (!v || typeof v !== 'object') throw new STError(`${path.join('.')} is not a block's output`, line);
    const k = Object.keys(v).find(x => x.toLowerCase() === p.toLowerCase());
    if (k === undefined) throw new STError(`${path[0]} has no ${p}`, line);
    v = v[k];
  }
  return v;
}

/** Is this expression REAL? A literal with a decimal point, a REAL variable, or anything made from one. */
function real(e, m) {
  if (e.k === 'lit') return !!e.real;
  if (e.k === 'var') { const d = m.prog.decls[Object.keys(m.prog.decls).find(k => k.toLowerCase() === e.path[0].toLowerCase())];
                       return /REAL/.test(d || '') || (d === undefined && !Number.isInteger(get(e.path, m))); }
  return [e.a, e.b].some(x => x && real(x, m));
}

function ev(e, m) {
  switch (e.k) {
    case 'lit': return e.v;
    case 'var': return get(e.path, m, e.line);
    case 'not': { const a = ev(e.a, m); return typeof a === 'boolean' ? !a : ~a; }
    case 'neg': return -ev(e.a, m);
    case 'bin': {
      const a = ev(e.a, m), b = ev(e.b, m);
      switch (e.op) {
        case 'AND': case '&': return typeof a === 'boolean' ? a && truthy(b) : a & b;
        case 'OR': return typeof a === 'boolean' ? a || truthy(b) : a | b;
        case 'XOR': return typeof a === 'boolean' ? a !== truthy(b) : a ^ b;
        case '=': return a === b; case '<>': return a !== b;
        case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
        case '+': return a + b; case '-': return a - b; case '*': return a * b;
        case '/': if (b === 0) throw new STError('divided by zero'); return real(e, m) ? a / b : Math.trunc(a / b);   // INT / INT is an INT
        case 'MOD': return a % b;
      }
    }
  }
  throw new STError('cannot work that out');
}

/** Run one block with its inputs set, as a PLC does when the program calls it. */
function block(fb, dt) {
  const rise = (now, key) => { const r = now && !fb[key]; fb[key] = now; return r; };
  switch (fb._type) {
    case 'TON':
      if (!fb.IN) { fb.ET = 0; fb.Q = false; } else { fb.ET = Math.min(fb.PT, fb.ET + dt); fb.Q = fb.ET >= fb.PT; }
      break;
    case 'TOF':
      if (fb.IN) { fb.ET = 0; fb.Q = true; } else if (fb.Q) { fb.ET = Math.min(fb.PT, fb.ET + dt); fb.Q = fb.ET < fb.PT; }
      break;
    case 'TP':
      if (rise(fb.IN, '_m') && !fb.Q) { fb.Q = true; fb.ET = 0; }
      if (fb.Q) { fb.ET = Math.min(fb.PT, fb.ET + dt); if (fb.ET >= fb.PT) fb.Q = false; } else if (!fb.IN) fb.ET = 0;
      break;
    case 'CTU':
      if (fb.R) fb.CV = 0; else if (rise(fb.CU, '_m')) fb.CV++;
      if (fb.R) fb._m = fb.CU;
      fb.Q = fb.CV >= fb.PV; break;
    case 'CTD':
      if (fb.LD) fb.CV = fb.PV; else if (rise(fb.CD, '_m')) fb.CV--;
      if (fb.LD) fb._m = fb.CD;
      fb.Q = fb.CV <= 0; break;
    case 'R_TRIG': fb.Q = fb.CLK && !fb._m; fb._m = fb.CLK; break;
    case 'F_TRIG': fb.Q = !fb.CLK && fb._m; fb._m = fb.CLK; break;
    case 'SR': fb.Q1 = fb.S1 || (!fb.R && fb.Q1); break;
    case 'RS': fb.Q1 = !fb.R1 && (fb.S || fb.Q1); break;
  }
}

const RETURN = {};
function run(stmts, m, dt, budget) {
  for (const s of stmts) {
    if (--budget.n < 0) throw new STError('the program ran too long in one scan (a loop that never ends?)', s.line);
    switch (s.k) {
      case 'set': {
        const v = ev(s.e, m);
        if (s.path.length > 1) {                            // T1.PT := T#5s sets a block's input
          const fb = get(s.path.slice(0, 1), m, s.line);
          fb[Object.keys(fb).find(x => x.toLowerCase() === s.path[1].toLowerCase()) ?? s.path[1].toUpperCase()] = v;
        } else m.vars[find(s.path[0], m.vars)] = v;
        break;
      }
      case 'call': {
        const fb = get([s.name], m, s.line);
        if (!fb || !fb._type) throw new STError(`${s.name} is not a timer, counter or edge block`, s.line);
        for (const [k, e] of Object.entries(s.args)) fb[k] = ev(e, m);
        block(fb, dt);
        break;
      }
      case 'if': {
        const arm = s.arms.find(([c]) => truthy(ev(c, m)));
        run(arm ? arm[1] : s.other, m, dt, budget);
        break;
      }
      case 'case': {
        const v = ev(s.sel, m);
        const br = s.branches.find(b => b.labels.some(([lo, hi]) => v >= lo && v <= hi));
        run(br ? br.body : s.other, m, dt, budget);
        break;
      }
      case 'for': {
        const name = find(s.v, m.vars);
        const to = ev(s.to, m), by = ev(s.by, m);
        for (m.vars[name] = ev(s.from, m); by > 0 ? m.vars[name] <= to : m.vars[name] >= to; m.vars[name] += by) run(s.body, m, dt, budget);
        break;
      }
      case 'while':
        while (truthy(ev(s.c, m))) run(s.body, m, dt, budget);
        break;
      case 'return': throw RETURN;
    }
  }
}

/** One scan: set the inputs, run the program once, let dt milliseconds pass. Returns the variables. */
export function scan(m, inputs = {}, dt = 100) {
  for (const [k, v] of Object.entries(inputs)) m.vars[find(k, m.vars)] = v;
  m.time += dt;
  m.scans++;
  try { run(m.prog.body, m, dt, { n: 100000 }); } catch (e) { if (e !== RETURN) throw e; }
  return m.vars;
}

/** A code card's tests: each a list of steps {set, scans, expect}. Returns [{name, ok, why}]. */
export function test(src, card) {
  const prog = compile(src);
  return (card.tests || []).map(tc => {
    const m = machine(prog, card);
    for (const [n, st] of (tc.steps || []).entries()) {
      for (let k = 0; k < (st.scans ?? 1); k++) scan(m, st.set || {}, st.dt ?? card.scan_ms ?? 100);
      for (const [name, want] of Object.entries(st.expect || {})) {
        const got = get(name.split('.'), m);
        if (got !== want) return { name: tc.name, ok: false, why: `step ${n + 1}: ${name} is ${got}, should be ${want}` };
      }
    }
    return { name: tc.name, ok: true };
  });
}
