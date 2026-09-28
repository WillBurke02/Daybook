// Formula help: what a formula says in words, what each letter stands for, and what the
// notation means (a fraction line, a small raised number, d/dt, ∫…). Lessons carry their
// formulas; content/symbols.json carries the notation. A card with maths on it offers it.
//
//   formulaHelp(maths, lessonId)   the box, for the maths on one card (and its lesson's formulas)
//   formulasPanel                  the Formulas page: all of it, searchable
import { api } from './api.js';
import { el, dialog } from './core/dom.js';
import { tex, split } from './ui/math.js';
import { fill } from './template.js';
import { rich } from './cards.js';

let cache = null;
export const loadFormulas = () => (cache ??= api.formulas().catch(() => { cache = null; return { formulas: [], symbols: [] }; }));

/** TeX with the spacing and the kinds of fraction taken out, so the same maths matches however it was typed. */
export const norm = t => String(t).replace(/\\[,;:! ]|\\left|\\right|\\displaystyle|\s+/g, '').replace(/\\[td]frac/g, '\\frac');
const SKIP = new Set(['id', 'type', 'answer', 'vars', 'let', 'params', 'tests', 'code', 'solution', 'stage', 'level', 'widget']);

/** Every piece of maths in a card, numbers filled in. */
export function mathsOf(card, values = {}) {
  const out = [];
  const walk = v => {
    if (typeof v === 'string') { for (const p of split(fill(v, values))) if (p.math != null) out.push(p.math); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!SKIP.has(k)) walk(x);
  };
  walk(card);
  return out;
}

/** A formula is on the card when all of its `match` pieces (or its whole self) are there;
 *  a symbol when its `re` finds it. */
export function findHelp(db, maths, lessonId) {
  const all = norm(maths.join(' '));
  // this lesson's own entry first; the same formula from another lesson once only
  const seen = new Set();
  const here = db.formulas.filter(f => (f.match?.length ? f.match : [f.tex]).every(m => all.includes(norm(m))))
    .sort((a, b) => (b.lesson === lessonId) - (a.lesson === lessonId))
    .filter(f => !seen.has(norm(f.tex)) && seen.add(norm(f.tex)));
  const lesson = db.formulas.filter(f => f.lesson === lessonId && !here.includes(f));
  const symbols = db.symbols.filter(s => { try { return new RegExp(s.re).test(all); } catch { return false; } });
  return { here, lesson, symbols };
}

const math = (t, display) => { const s = el('span', { class: display ? 'mathblock' : 'mathin' }); s.innerHTML = tex(t, display); return s; };

export function formulaView(f, { link = true } = {}) {
  return el('section', { class: 'fhelp' },
    el('h4', {}, f.name),
    math(f.tex, true),
    f.says ? el('div', { class: 'fsays' }, rich(f.says)) : null,
    f.symbols?.length ? el('table', { class: 'g fsyms' }, el('tbody', {}, f.symbols.map(([t, m]) =>
      el('tr', {}, el('td', { class: 'fsym' }, math(t)), el('td', {}, rich(m)))))) : null,
    f.example ? el('div', { class: 'fex' }, el('strong', {}, 'For example: '), rich(f.example)) : null,
    link && f.lesson ? el('p', { class: 'muted small' }, 'From ', el('a', { href: `#/lesson?id=${encodeURIComponent(f.lesson)}` }, f.lesson_title || f.lesson)) : null);
}

export function symbolView(s) {
  return el('tr', {}, el('td', { class: 'fsym' }, math(s.tex)),
    el('td', {}, el('strong', {}, s.name), s.says ? rich(s.says) : null, s.example ? el('div', { class: 'muted small' }, rich(`For example: ${s.example}`)) : null));
}

/** The help box for some maths: the formulas it is, what its symbols mean, the rest of its lesson's formulas. */
export async function formulaHelp(maths, lessonId) {
  const db = await loadFormulas();
  const { here, lesson, symbols } = findHelp(db, maths, lessonId);
  const box = el('div', { class: 'fhelpbox' });
  if (here.length) box.append(el('h3', {}, here.length === 1 ? 'The formula' : 'The formulas'), ...here.map(f => formulaView(f, { link: f.lesson !== lessonId })));
  if (symbols.length) box.append(el('h3', {}, 'Reading the maths'), el('table', { class: 'g fsyms' }, el('tbody', {}, symbols.map(symbolView))));
  if (lesson.length) box.append(el('details', { open: !here.length && !symbols.length || null },
    el('summary', {}, `The other formulas in this lesson (${lesson.length})`), ...lesson.map(f => formulaView(f, { link: false }))));
  if (!box.children.length) box.append(el('p', { class: 'note' }, 'Nothing written about this maths yet. Use Report on the card to say what was unclear, and it will get some.'));
  box.append(el('p', {}, el('a', { href: '#/formulas' }, 'Every formula and symbol')));
  const d = dialog('Formula help', box);
  d.addEventListener('click', e => { if (e.target.closest('a[href^="#"]')) d.close(); });
}

/** The Formulas page: the notation first, then each subject's formulas by lesson. */
export const formulasPanel = { title: 'Formulas', w: 12, async render(body, ctx) {
  const db = await loadFormulas();
  ctx.setTitle('');
  ctx.pageTitle('Formulas', 'What each formula says, what its letters stand for, and how to read the maths');
  const q = el('input', { type: 'search', class: 'fsearch', placeholder: 'Find a formula, a letter or a word (slip, derivative, Ohm…)', value: ctx.params.q || '', style: 'width:100%' });
  const out = el('div');
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const has = x => !t || JSON.stringify(x).toLowerCase().includes(t);
    const syms = db.symbols.filter(has), fs = db.formulas.filter(has);
    out.replaceChildren();
    if (syms.length) out.append(el('h2', { class: 'nunit' }, 'Reading the maths'), el('table', { class: 'g fsyms' }, el('tbody', {}, syms.map(symbolView))));
    let subj = null, les = null;
    for (const f of fs) {
      if (f.subject !== subj) { subj = f.subject; les = null; out.append(el('h2', { class: 'nunit' }, subj)); }
      if (f.lesson !== les) { les = f.lesson; out.append(el('h3', {}, el('a', { href: `#/lesson?id=${encodeURIComponent(f.lesson)}` }, f.lesson_title || f.lesson))); }
      out.append(formulaView(f, { link: false }));
    }
    if (!syms.length && !fs.length) out.append(el('p', { class: 'note' }, 'Nothing matches.'));
  };
  q.addEventListener('input', draw);
  body.append(q, out);
  draw();
} };
