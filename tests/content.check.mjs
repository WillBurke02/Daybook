// node tests/content.check.mjs — Learn's course files (§11): every card id unique, every
// prerequisite a real lesson, every widget named a real widget, every numeric answer
// working out for random numbers, every code card's solution passing its own tests,
// and every piece of maths turning into MathML without an error.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './load.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = process.env.CONTENT || join(ROOT, 'apps/learn/content');   // another folder, to check the check
const tpl = await load('apps/learn/web/template.js');
const st = await load('apps/learn/web/st.js');
const { tex, split } = await load('web/ui/math.js');
const { parse, key } = await load('web/core/formula.js');
const TYPES = ['concept', 'widget', 'mcq', 'numeric', 'steps', 'order', 'match', 'flash', 'code', 'explain', 'spot'];

const files = dir => readdirSync(dir).flatMap(f => statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]);
const lessons = new Map(), problems = [];
const bad = (where, what) => problems.push(`${where}: ${what}`);

// ---- the outlines ----
const SUBJECTS = readdirSync(CONTENT).filter(s => statSync(join(CONTENT, s)).isDirectory());
for (const s of SUBJECTS) {
  const outline = JSON.parse(readFileSync(join(CONTENT, s, 'subject.json'), 'utf8'));
  for (const u of outline.units) for (const l of u.lessons) {
    if (lessons.has(l.id)) bad(l.id, 'lesson id used twice');
    if (!l.id.startsWith(u.id + '.')) bad(l.id, `does not start with its unit's id ${u.id}`);
    lessons.set(l.id, { ...l, subject: outline.id, cards: [] });
  }
}
for (const l of lessons.values()) for (const p of l.prereq || []) if (!lessons.has(p)) bad(l.id, `prerequisite ${p} is not a lesson`);

// ---- the widgets and what they report ----
const WIDGETS = {};
for (const f of readdirSync(join(ROOT, 'apps/learn/web/widgets'))) {
  if (f === 'kit.js') continue;
  const m = await load(`apps/learn/web/widgets/${f}`);
  assert.equal(typeof m.mount, 'function', `${f} exports mount`);
  WIDGETS[f.replace(/\.js$/, '')] = m.REPORTS || [];
}

// ---- the names in a formula ----
const ids = ast => !ast || typeof ast !== 'object' ? [] : ast.k === 'id' ? [ast.v] : Object.values(ast).flatMap(ids);

// ---- maths that fails to parse shows as an error box: none allowed ----
const texts = c => Object.entries(c).flatMap(([k, v]) => typeof v === 'string' && !['id', 'type', 'answer', 'code'].includes(k) ? [v]
  : Array.isArray(v) ? v.flatMap(x => typeof x === 'string' ? [x] : Array.isArray(x) ? x.filter(y => typeof y === 'string') : x && typeof x === 'object' ? texts(x) : [])
  : v && typeof v === 'object' && k !== 'vars' && k !== 'let' && k !== 'params' && k !== 'tests' ? texts(v) : []);
function mathOK(where, card, values) {
  // {d} is filled in everywhere, TeX too: \frac{d}{v} with a var d loses its braces. {{d}} puts the value in.
  for (const t of texts(card)) for (const part of split(t)) for (const m of (part.math || '').matchAll(/(\\[a-zA-Z]+|\}|\^|_)\{(\w+)\}/g))
    if (m[2] in values) bad(where, `{${m[2]}} in maths is replaced by its value, braces and all: write {{${m[2]}}} for the value, or { ${m[2]} } for the letter`);
  for (const t of texts(card)) for (const part of split(tpl.fill(t, values))) {
    if (part.math == null) continue;
    if (/merror/.test(tex(part.math, part.display))) bad(where, `this maths does not parse: ${part.math}`);
    const b = part.math.replace(/\\[{}]/g, '');
    if (b.split('{').length !== b.split('}').length) bad(where, `the braces do not balance: ${part.math}`);
  }
}

let r = 1;
const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;

// ---- the cards ----
let cards = 0, numeric = 0;
const bank = new Map();                 // lesson id -> calibration cards
for (const file of files(CONTENT).filter(f => f.endsWith('.json') && !f.endsWith('subject.json') && dirname(f) !== CONTENT)) {
  const where = file.replace(CONTENT + '/', '');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const isBank = file.endsWith('calibrate.json');
  // a calibration bank is questions across the whole outline, each naming its lesson
  const groups = isBank ? [...new Set(raw.cards.map(c => c.lesson))].map(id => ({ id, cards: raw.cards.filter(c => c.lesson === id), bank: true })) : [raw];
  for (const les of groups) {
  if (!lessons.has(les.id)) { bad(where, `lesson ${les.id} is not in its subject's outline`); continue; }
  if (!file.includes(les.id.split('.')[0] + '/')) bad(where, 'is not under its subject folder');
  if (!isBank) template(les, where);
  const seen = new Set();
  for (const c of les.cards) {
    const at = `${les.id}/${c.id}`;
    if (isBank) {
      bank.set(les.id, [...(bank.get(les.id) || []), c]);
      if (!/^cal-/.test(c.id || '')) bad(at, 'a calibration card id starts cal- (it shares the lesson\'s ids)');
      if (!['mcq', 'numeric', 'order', 'match', 'code'].includes(c.type)) bad(at, 'a calibration card is marked: mcq, numeric, order, match or code');
      const lv = c.level ?? lessons.get(les.id).level;
      if (!(lv >= 1 && lv <= 9)) bad(at, 'a calibration card has a stage from 1 to 9');
    }
    cards++;
    if (!c.id || !/^[a-z0-9-]+$/.test(c.id)) bad(at, 'card ids are lower case words and dashes');
    if (seen.has(c.id)) bad(at, 'card id used twice in the lesson');
    seen.add(c.id);
    if (!TYPES.includes(c.type)) { bad(at, `unknown type ${c.type}`); continue; }
    if (c.widget && !WIDGETS[c.widget.name]) bad(at, `no widget called ${c.widget.name}`);
    if (c.type === 'widget' && !c.ask) bad(at, 'a widget card asks a question (ask)');
    if (c.type === 'concept' && (c.body || '').split(/\s+/).length > 150) bad(at, 'a concept is short: 120 words or so');
    if (c.more && c.more.split(/\s+/).length > 180) bad(at, 'more (explain it another way) is 150 words or so');
    const q = c.type === 'widget' ? { ...c.ask } : c;
    const reported = c.type === 'widget' ? WIDGETS[c.widget?.name] || [] : [];
    if (q.type === 'mcq') {
      if (!Array.isArray(q.options) || q.options.length < 3 || q.options.length > 5) bad(at, 'an mcq has 3 to 5 options');
      if (!(q.answer >= 0 && q.answer < (q.options || []).length)) bad(at, 'the answer is not one of the options');
      if (!q.why) bad(at, 'an mcq gives its reason (why)');
      const right = String(q.options?.[q.answer] ?? '').length, wrong = Math.max(...(q.options || []).filter((_, i) => i !== q.answer).map(o => String(o).length));
      if (right > 1.5 * wrong && right - wrong > 12) bad(at, 'the right option gives itself away by being much the longest: trim it, and put the reason in why');
    }
    if (q.type === 'numeric') {
      numeric++;
      const names = [...Object.keys(q.vars || {}), ...Object.keys(q.let || {}), ...reported, 'answer'];
      const folded = names.map(key);
      if (new Set(folded).size !== folded.length) bad(at, `names that differ only in case or underscores: ${names.join(', ')} (formulas ignore both)`);
      for (const f of [q.answer, ...Object.values(q.let || {})]) {
        if (typeof f !== 'string') continue;
        let ast;
        try { ast = parse(f); } catch (e) { bad(at, `formula ${f}: ${e.message}`); continue; }
        for (const n of ids(ast)) if (!folded.includes(key(n))) bad(at, `formula ${f} uses ${n}, which is not a var, a let or something the widget reports`);
      }
      if (!reported.length) {
        for (let k = 0; k < 200; k++) {
          let v;
          try { v = tpl.draw(q, rand); } catch (e) { bad(at, `the answer fails for some numbers: ${e.message}`); break; }
          if (typeof v.answer !== 'number' || !isFinite(v.answer)) { bad(at, `the answer is ${v.answer}`); break; }
          if (!tpl.right(v.answer, v.answer, q)) { bad(at, 'the answer is not right by its own tolerance'); break; }
          if (k === 0) mathOK(at, c, v);
        }
      } else mathOK(at, c, Object.fromEntries(reported.map(n => [n, 1])));
    } else mathOK(at, c, {});
    if (c.type === 'order' && !(c.items?.length >= 3)) bad(at, 'an order card has 3 or more items');
    if (c.type === 'match' && !(c.pairs?.length >= 3)) bad(at, 'a match card has 3 or more pairs');
    if (c.type === 'steps' && !(c.steps?.length >= 2 && c.steps.every(s => s.show))) bad(at, 'steps: two or more, each with something to show');
    if (c.type === 'flash' && !(c.front && c.back)) bad(at, 'a flash card has a front and a back');
    if (c.type === 'explain') {
      if (!c.q || !c.model) bad(at, 'explain the step: a question (q) and a model answer (model)');
      if (c.points && !(Array.isArray(c.points) && c.points.length >= 2 && c.points.length <= 6 && c.points.every(p => typeof p === 'string')))
        bad(at, 'explain: points are 2 to 6 things a good answer says');
    }
    if (c.type === 'spot') {
      if (!(Array.isArray(c.lines) && c.lines.length >= 3 && c.lines.length <= 9)) bad(at, 'spot the mistake: 3 to 9 lines');
      else if (!(Number.isInteger(c.wrong) && c.wrong >= 0 && c.wrong < c.lines.length)) bad(at, 'spot: wrong is the index of the line with the mistake');
      if (!c.fix || !c.why) bad(at, 'spot: the line put right (fix) and why it was wrong (why)');
      if (c.mono && c.lines?.some(l => l.includes('$'))) bad(at, 'spot: mono lines are shown as they are: no maths');
    }
    if (c.predict) {
      const p = c.predict;
      if (c.type !== 'widget') bad(at, 'predict goes on a widget card: the guess unlocks its controls');
      if (!p.q || !(Array.isArray(p.options) && p.options.length >= 2 && p.options.length <= 5)) bad(at, 'predict: a question and 2 to 5 options');
      if (p.answer != null && !(p.answer >= 0 && p.answer < (p.options || []).length)) bad(at, 'predict: answer is one of the options, or left out');
    }
    if (c.type === 'code') {
      const parts = c.code.split('___');
      if (parts.length - 1 !== (c.solution || []).length) bad(at, 'one solution for each ___ blank');
      else {
        const src = parts.map((p, i) => p + (c.solution[i] ?? '')).join('');
        try {
          const res = st.test(src, c);
          if (!res.length) bad(at, 'a code card needs tests');
          for (const t of res) if (!t.ok) bad(at, `the solution fails its own test "${t.name}": ${t.why}`);
        } catch (e) { bad(at, `the solution does not run: ${e.message}`); }
      }
    }
    if (c.type === 'steps' && c.given != null && !(c.given >= 1 && c.given < (c.steps || []).length)) bad(at, 'given: 1 or more steps done, fewer than all (all is worked: true)');
    if (!isBank) lessons.get(les.id).cards.push(c);
  }
  if (!isBank && les.cards.length < 15 && lessons.get(les.id).star) bad(les.id, `a starred lesson has 15 to 30 cards (${les.cards.length})`);
  }
}

// ---- Learn 3's lesson template (LEARN-SPEC §2): the stages, and what a lesson carries ----
function template(les, where) {
  const STAGES = ['try', 'learn', 'example', 'practise', 'mix', 'check'];
  const asks = c => c.type !== 'concept' && !(c.type === 'steps' && c.worked);
  const outline = lessons.get(les.id);
  const level = les.level ?? outline.level, kind = les.kind ?? outline.kind;
  if (!['procedure', 'concept', 'facts'].includes(kind)) bad(where, 'kind: procedure, concept or facts');
  if (!(level >= 1 && level <= 9)) bad(where, 'level: a stage from 1 to 9');
  if (!(les.minutes >= 5 && les.minutes <= 30)) bad(where, 'minutes: 5 to 30');
  if (!(Array.isArray(les.goals) && les.goals.length >= 2 && les.goals.length <= 5)) bad(where, 'goals: 2 to 5 things you can do by the end');
  if (!les.summary || les.summary.split(/\s+/).length > 350) bad(where, 'summary: the lesson in 350 words or fewer');
  else mathOK(`${where} summary`, { summary: les.summary }, {});
  if (!(Array.isArray(les.sources) && les.sources.length)) bad(where, 'sources: what the lesson was checked against');
  if (!(Array.isArray(les.resources) && les.resources.length)) bad(where, 'resources: something to read or watch');
  for (const b of les.bench || []) {
    if (!b.task || typeof b.task !== 'string') bad(where, 'a bench task says what to do (task)');
    if (b.check && !(Array.isArray(b.check) && b.check.every(x => typeof x === 'string'))) bad(where, 'a bench task\'s check is a list of steps');
    mathOK(`${where} bench`, b, {});
  }
  for (const r of les.resources || []) {
    if (!['before', 'after', 'during'].includes(r.when)) bad(where, `resource ${r.title}: when is before, during or after`);
    if (!['video', 'read', 'interactive', 'reference', 'listen'].includes(r.kind)) bad(where, `resource ${r.title}: kind is video, read, interactive, reference or listen`);
    if (!/^https:\/\/[^\s]+$/.test(r.url || '')) bad(where, `resource ${r.title}: an https link`);
    if (!r.title || !r.by) bad(where, 'a resource has a title and says who it is by');
  }
  // Formula help: each formula says what it means and what its letters are
  for (const f of les.formulas || []) {
    if (!f.name || !f.tex || !f.says) bad(where, `formula ${f.name || f.tex}: a name, the tex and what it says`);
    if (f.symbols && !(Array.isArray(f.symbols) && f.symbols.every(x => Array.isArray(x) && x.length === 2))) bad(where, `formula ${f.name}: symbols are [tex, meaning] pairs`);
    mathOK(`${where} formula ${f.name}`, { tex: `$${f.tex}$`, says: f.says, example: f.example || '', symbols: (f.symbols || []).map(([t, m]) => `$${t}$ ${m}`) }, {});
  }
  let last = 0;
  for (const c of les.cards) {
    const k = STAGES.indexOf(c.stage);
    if (k < 0) { bad(`${les.id}/${c.id}`, `stage: one of ${STAGES.join(', ')}`); continue; }
    if (k < last) bad(`${les.id}/${c.id}`, `the stages run in order (${STAGES.join(' → ')})`);
    last = k;
    if (asks(c) && c.level != null && Math.abs(c.level - level) > 1.5) bad(`${les.id}/${c.id}`, 'a card is within 1.5 stages of its lesson');
  }
  const at = st => les.cards.filter(c => c.stage === st);
  if (!at('try').some(asks)) bad(where, 'the try stage asks something before teaching it');
  if (at('check').filter(asks).length < 2) bad(where, 'the check stage asks 2 or more questions');
  const learn = at('learn');
  learn.forEach((c, i) => { if (c.type === 'concept' && (i === learn.length - 1 || !asks(learn[i + 1]))) bad(`${les.id}/${c.id}`, 'every learn card is followed by a question on it'); });
  if (kind === 'procedure') {
    const ex = at('example');
    const w = ex.findIndex(c => c.type === 'steps' && c.worked), f = ex.findIndex(c => c.type === 'steps' && c.given);
    const pr = ex.findIndex((c, i) => i > f && asks(c) && c.type !== 'steps');
    if (w < 0 || f < w || pr < 0) bad(where, 'a procedure works an example, fades one, then asks one: worked → given → a problem');
  }
  if (kind === 'facts' && at('mix').length) bad(where, 'a facts lesson does not mix (interleaving hurts facts and terms)');
}

// ---- the notation Formula help explains (content/symbols.json) ----
if (existsSync(join(CONTENT, 'symbols.json'))) {
  for (const x of JSON.parse(readFileSync(join(CONTENT, 'symbols.json'), 'utf8')).symbols) {
    try { new RegExp(x.re); } catch (e) { bad(`symbols.json ${x.name}`, `re does not compile: ${e.message}`); }
    if (!x.name || !x.tex || !x.says) bad(`symbols.json ${x.name || x.tex}`, 'a name, the tex and what it says');
    mathOK(`symbols.json ${x.name}`, { tex: `$${x.tex}$`, says: x.says, example: x.example || '' }, {});
  }
}

// ---- every lesson of a subject with a calibration bank can be asked about: 3 or more questions ----
for (const s of SUBJECTS) {
  if (!existsSync(join(CONTENT, s, 'calibrate.json'))) continue;
  for (const l of [...lessons.values()].filter(l => l.subject === s)) {
    const n = (bank.get(l.id) || []).length + l.cards.filter(c => ['try', 'check', 'practise', 'mix'].includes(c.stage) && c.type !== 'concept' && c.type !== 'steps').length;
    if (n < 3) bad(l.id, `the calibration bank and the lesson ask only ${n} questions about it (3 or more)`);
  }
}

if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
const written = [...lessons.values()].filter(l => l.cards.length);
console.log(`ok — content: ${lessons.size} lessons in the outline, ${written.length} written, ${cards} cards (${numeric} numeric, each tried with 200 sets of numbers), ${[...bank.values()].flat().length} calibration questions`);
