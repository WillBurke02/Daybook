// Cards: one renderer per type, one frame around them all. The frame keeps the
// time, asks how sure you are (if that is on), shows what was right and why, and
// records the answer; the server schedules it and says when it comes back.
// Every type but concept asks something of you.
//
//   frame(item, {mode, onDone, onKeyHost})   item: {id, type, card, state, subject, lesson, why}
import { api } from './api.js';
import { el, flash, dialog } from './core/dom.js';
import { state } from './core/state.js';
import { tex, split } from './ui/math.js';
import { draw, compute, fill, read, right, fmt } from './template.js';
import { compile, machine, scan, test } from './st.js';
import { formulaHelp, mathsOf } from './formulas.js';
import { toggle } from './tools.js';

// ---- text: paragraphs, - lists, **bold**, *italic*, `code`, $maths$ ------------------------

function inline(text) {
  const out = [];
  for (const part of split(text)) {
    if (part.math != null) { const s = el('span', { class: part.display ? 'mathblock' : 'mathin' }); s.innerHTML = tex(part.math, part.display); out.push(s); continue; }
    // **bold**, *italic*, `code`, in that order of precedence; everything else is text
    const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
    let last = 0, m;
    while ((m = re.exec(part.text))) {
      if (m.index > last) out.push(part.text.slice(last, m.index));
      out.push(m[1] ? el('strong', {}, m[1]) : m[2] ? el('em', {}, m[2]) : el('code', {}, m[3]));
      last = re.lastIndex;
    }
    if (last < part.text.length) out.push(part.text.slice(last));
  }
  return out;
}

/** Card text to DOM: never innerHTML for what was written, only for the MathML math.js builds. */
export function rich(text, values = {}) {
  const box = el('div', { class: 'rich' });
  for (const para of fill(text, values).split(/\n{2,}/)) {
    const lines = para.split('\n');
    if (/^```/.test(para) && /```$/.test(para)) add(box, el('pre', { class: 'code' }, para.replace(/^```\w*\n?|\n?```$/g, '')));   // a ladder rung, a listing
    else if (lines.every(l => /^\s*- /.test(l))) add(box, el('ul', {}, lines.map(l => el('li', {}, inline(l.replace(/^\s*- /, ''))))));
    else add(box, el('p', {}, lines.flatMap((l, i) => [i ? el('br') : null, ...inline(l)])));
  }
  return box;
}

/** Element.append prints null as "null": this leaves the nulls out. */
const add = (node, ...kids) => node.append(...kids.flat().filter(k => k != null && k !== false));
/** A card's words for a list: the first line, maths and template numbers shown as … */
export const brief = (text, n = 140) => String(text || '').replace(/\$[^$]*\$/g, '…').replace(/\{\w+(:\d)?\}/g, '…').replace(/\*\*|`/g, '').split('\n')[0].slice(0, n);
const shuffle = (xs, rand = Math.random) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const plain = (text, values) => fill(text, values).replace(/\*\*|`/g, '');

// ---- widgets load on first use ----------------------------------------------------------

const widgets = {};
export async function mountWidget(box, spec, report) {
  if (!spec?.name) return null;
  widgets[spec.name] ??= import(`./widgets/${spec.name}.js`);
  try { return (await widgets[spec.name]).mount(box, spec.params || {}, report); }
  catch (e) { add(box, el('p', { class: 'err' }, `The ${spec.name} widget could not start: ${e.message}`)); return null; }
}

// ---- the types ------------------------------------------------------------------------------
// Each renderer fills `face` and calls done({correct, rating, answer, mistake}) once, when you have answered.
// keys: a function the frame passes keyboard presses to while this card is the one on screen.

const ratingFor = correct => correct ? 'good' : 'again';
const RATINGS = [['again', 'Again'], ['hard', 'Hard'], ['good', 'Good'], ['easy', 'Easy']];
function rateButtons(done, why) {
  const box = el('div', { class: 'rate' });
  const pick = r => { box.querySelectorAll('button').forEach(b => { b.disabled = true; }); done({ correct: r !== 'again', rating: r, selfRated: true, why }); };
  RATINGS.forEach(([r, label], i) => add(box, el('button', { class: 'btn plain sm r-' + r, type: 'button', onclick: () => pick(r) },
    el('span', { class: 'num muted' }, `${i + 1} `), label)));
  box.keys = e => { const i = '1234'.indexOf(e.key); if (i >= 0) { pick(RATINGS[i][0]); return true; } };
  return box;
}

const TYPES = {
  concept(c, face, done) {
    add(face, c.title ? el('h3', {}, c.title) : null, rich(c.body || ''));
    if (c.widget) { const w = el('div', { class: 'widget' }); add(face, w); mountWidget(w, c.widget, () => {}); }
    // the same idea again, slower and in other words, for when the first go did not land
    if (c.more) add(face, el('details', { class: 'more' }, el('summary', {}, 'Explain it another way'), rich(c.more)));
    const ok = el('button', { class: 'btn', type: 'button', onclick: () => { ok.disabled = true; done({ correct: null, rating: null }); } }, 'Got it');
    add(face, el('div', { class: 'row' }, ok));
    return e => { if (e.key === 'Enter' || e.key === ' ') { ok.click(); return true; } };
  },

  flash(c, face, done) {
    add(face, el('div', { class: 'front' }, rich(c.front || '')));
    const back = el('div', { class: 'back', hidden: true }, rich(c.back || ''));
    let rates = null;
    const show = el('button', { class: 'btn', type: 'button', onclick: () => {
      back.hidden = false; show.remove(); rates = rateButtons(done); add(face, rates);
    } }, 'Show the answer');
    add(face, back, el('div', { class: 'row' }, show));
    return e => {
      if (!rates && (e.key === 'Enter' || e.key === ' ')) { show.click(); return true; }
      return rates?.keys(e);
    };
  },

  mcq(c, face, done, values) {
    const order = c.shuffle === false ? c.options.map((_, i) => i) : shuffle(c.options.map((_, i) => i));
    add(face, rich(c.q, values));
    let answered = false;
    const pick = (i, b) => {
      if (answered) return;
      answered = true;
      const correct = i === c.answer;
      opts.querySelectorAll('button').forEach(x => { x.disabled = true; if (+x.dataset.i === c.answer) x.classList.add('right'); });
      if (!correct) b.classList.add('wrong');
      done({ correct, rating: ratingFor(correct), why: c.why ? fill(c.why, values) : null, answer: fill(c.options[c.answer], values),
             mistake: { front: plain(c.q, values), back: `${plain(c.options[c.answer], values)}${c.why ? '\n\n' + c.why : ''}` } });
    };
    const opts = el('div', { class: 'options' }, order.map((i, n) => {
      const b = el('button', { class: 'opt', type: 'button', data: { i } }, el('span', { class: 'num muted' }, `${n + 1}`), rich(c.options[i], values));
      b.addEventListener('click', () => pick(i, b));
      return b;
    }));
    add(face, opts);
    return e => { const n = '12345'.indexOf(e.key); if (n >= 0 && n < order.length) { opts.children[n].click(); return true; } };
  },

  numeric(c, face, done, values) {
    add(face, rich(c.q, values));
    const input = el('input', { class: 'answer', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Your answer' });
    const check = el('button', { class: 'btn', type: 'button' }, 'Check');
    add(face, el('div', { class: 'row mid' }, input, c.unit ? el('span', { class: 'unit' }, rich(c.unit)) : null, check),
      c.hint ? el('details', { class: 'hint' }, el('summary', {}, 'Hint'), rich(c.hint, values)) : null);
    const go = () => {
      const given = read(input.value);
      if (!isFinite(given)) { flash('Type a number (5920, 1.18e-3 and 5920*10/2000 all work)'); input.focus(); return; }
      const v = values.answer, correct = right(given, v, c);
      input.disabled = check.disabled = true;
      input.classList.add(correct ? 'right' : 'wrong');
      const shown = `${fmt(v)}${c.unit ? ' ' + c.unit : ''}`;
      done({ correct, rating: ratingFor(correct), answer: shown, work: c.work ? fill(c.work, values) : null, why: c.why ? fill(c.why, values) : null,
             mistake: { front: plain(c.q, values), back: `${shown}${c.work ? '\n\n' + plain(c.work, values) : ''}${c.why ? '\n\n' + c.why : ''}` } });
    };
    check.addEventListener('click', go);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); } });
    queueMicrotask(() => { if (face.isConnected && face.closest('.lcard.current')) input.focus({ preventScroll: true }); });
    return e => { if (e.key === 'Enter') { go(); return true; } };
  },

  // A worked example (worked: true) shows every step and asks nothing. A faded one (given: n)
  // shows the first n steps worked, then you do the rest, a step at a time.
  steps(c, face, done, values) {
    const given = c.worked ? c.steps.length : Math.min(c.given || 0, c.steps.length);
    add(face, rich(c.q, values), el('p', { class: 'muted small' }, c.worked ? 'A worked example: read each step and see why it follows.'
      : given ? `The first ${given === 1 ? 'step is' : given + ' steps are'} done for you. Work out the rest yourself, then show each one.`
      : 'Work out each step yourself first, then show it.'));
    const list = el('ol', { class: 'steps' });
    add(face, list);
    c.steps.slice(0, given).forEach(st_ => add(list, el('li', { class: 'given' }, st_.ask ? rich(st_.ask, values) : null,
      el('div', { class: 'shown' }, rich(st_.show, values)))));
    if (c.worked) {
      const ok = el('button', { class: 'btn', type: 'button', onclick: () => { ok.disabled = true; done({ correct: null, rating: null }); } }, 'Got it');
      add(face, c.why ? el('div', { class: 'muted' }, rich(c.why, values)) : null, el('div', { class: 'row' }, ok));
      return e => { if (e.key === 'Enter' || e.key === ' ') { ok.click(); return true; } };
    }
    let n = given, rates = null;
    const nextStep = () => {
      const s = c.steps[n];
      const mine = el('input', { class: 'sm', placeholder: 'Your step (for yourself; not marked)', 'aria-label': 'Your step' });
      const reveal = el('button', { class: 'btn plain sm', type: 'button' }, 'Show');
      const li = el('li', {}, s.ask ? rich(s.ask, values) : null, el('div', { class: 'row mid' }, mine, reveal));
      reveal.addEventListener('click', () => {
        reveal.remove(); mine.disabled = true;
        add(li, el('div', { class: 'shown' }, rich(s.show, values)));
        if (++n < c.steps.length) nextStep();
        else { rates = rateButtons(done, c.why); add(face, el('p', { class: 'muted small' }, 'How did your steps compare?'), rates); }
      });
      mine.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); reveal.click(); } });
      add(list, li);
      queueMicrotask(() => { if (face.closest('.lcard.current')) mine.focus({ preventScroll: true }); });
    };
    nextStep();
    return e => {
      if (rates) return rates.keys(e);
      if (e.key === 'Enter') { list.lastElementChild?.querySelector('button')?.click(); return true; }
    };
  },

  order(c, face, done, values) {
    add(face, rich(c.q, values), el('p', { class: 'muted small' }, 'Drag them into order, or use ↑ ↓.'));
    let items = shuffle(c.items.map((t, i) => ({ t, i })));
    if (items.every((x, k) => x.i === k) && items.length > 1) items = [...items.slice(1), items[0]];
    const list = el('ol', { class: 'order' });
    let checked = false;
    const draw_ = () => list.replaceChildren(...items.map((x, k) => {
      const li = el('li', { data: { k } },
        el('span', { class: 'grip', title: 'Drag' }, '⋮⋮'), rich(x.t, values),
        checked ? null : el('span', { class: 'moves' },
          el('button', { class: 'icon', type: 'button', 'aria-label': 'Up', onclick: () => move(k, -1) }, '↑'),
          el('button', { class: 'icon', type: 'button', 'aria-label': 'Down', onclick: () => move(k, 1) }, '↓')));
      if (checked) li.classList.add(x.i === k ? 'right' : 'wrong');
      return li;
    }));
    // Pointer events, not HTML drag and drop: that one needs setData in Firefox and does nothing on
    // touch. A mouse drags a row from anywhere; a finger from the grip, so the page still scrolls.
    list.addEventListener('pointerdown', e => {
      const li = e.target.closest('li');
      if (checked || !li || e.button !== 0 || e.target.closest('button') || (e.pointerType !== 'mouse' && !e.target.closest('.grip'))) return;
      e.preventDefault();
      list.setPointerCapture(e.pointerId);
      li.classList.add('dragging');
      const drag = ev => {
        const over = [...list.children].find(o => o !== li && ev.clientY < o.getBoundingClientRect().top + o.offsetHeight / 2);
        if ((over || null) !== li.nextElementSibling) list.insertBefore(li, over || null);
      };
      const end = () => {
        list.removeEventListener('pointermove', drag); list.removeEventListener('pointerup', end); list.removeEventListener('pointercancel', end);
        items = [...list.children].map(n => items[+n.dataset.k]);
        draw_();
      };
      list.addEventListener('pointermove', drag); list.addEventListener('pointerup', end); list.addEventListener('pointercancel', end);
    });
    const move = (k, d) => { const j = k + d; if (j < 0 || j >= items.length) return; [items[k], items[j]] = [items[j], items[k]]; draw_(); };
    const check = el('button', { class: 'btn', type: 'button', onclick: () => {
      checked = true; check.disabled = true;
      const correct = items.every((x, k) => x.i === k);
      draw_();
      done({ correct, rating: ratingFor(correct), why: c.why, answer: correct ? null : c.items.map((t, k) => `${k + 1}. ${plain(t, values)}`).join('\n'),
             mistake: { front: plain(c.q, values), back: c.items.map((t, k) => `${k + 1}. ${plain(t, values)}`).join('\n') } });
    } }, 'Check');
    draw_();
    add(face, list, el('div', { class: 'row' }, check));
    return e => { if (e.key === 'Enter') { check.click(); return true; } };
  },

  match(c, face, done, values) {
    add(face, rich(c.q || 'Match each one to its pair.', values), el('p', { class: 'muted small' }, 'Pick one on the left, then its partner on the right.'));
    const rights = shuffle(c.pairs.map((p, i) => ({ t: p[1], i })));
    const pairs = new Map();                            // left index -> right index
    let sel = null, checked = false;
    const L = el('div', { class: 'col' }), R = el('div', { class: 'col' });
    const paint = () => {
      L.querySelectorAll('button').forEach(b => {
        const i = +b.dataset.i, p = pairs.get(i);
        b.className = 'opt' + (sel === i ? ' sel' : '') + (p != null ? ' paired' : '') + (checked ? (p === i ? ' right' : ' wrong') : '');
        b.querySelector('.tagn').textContent = p != null ? String([...pairs.keys()].indexOf(i) + 1) : '';
      });
      R.querySelectorAll('button').forEach(b => {
        const j = +b.dataset.i, owner = [...pairs.entries()].find(([, r]) => r === j)?.[0];
        b.className = 'opt' + (owner != null ? ' paired' : '') + (checked && owner != null ? (owner === j ? ' right' : ' wrong') : '');
        b.querySelector('.tagn').textContent = owner != null ? String([...pairs.keys()].indexOf(owner) + 1) : '';
      });
      check.disabled = checked || pairs.size < c.pairs.length;
    };
    c.pairs.forEach((p, i) => add(L, el('button', { type: 'button', class: 'opt', data: { i }, onclick: () => { if (!checked) { sel = sel === i ? null : i; paint(); } } },
      el('span', { class: 'tagn num' }), rich(p[0], values))));
    rights.forEach(r => add(R, el('button', { type: 'button', class: 'opt', data: { i: r.i }, onclick: () => {
      if (checked || sel == null) return;
      for (const [k, v] of pairs) if (v === r.i) pairs.delete(k);
      pairs.set(sel, r.i); sel = null; paint();
    } }, el('span', { class: 'tagn num' }), rich(r.t, values))));
    const check = el('button', { class: 'btn', type: 'button', disabled: true, onclick: () => {
      checked = true;
      const correct = c.pairs.every((_, i) => pairs.get(i) === i);
      paint();
      done({ correct, rating: ratingFor(correct), why: c.why, answer: correct ? null : c.pairs.map(p => `${plain(p[0], values)} — ${plain(p[1], values)}`).join('\n'),
             mistake: { front: plain(c.q || 'Match the pairs', values), back: c.pairs.map(p => `${plain(p[0], values)} — ${plain(p[1], values)}`).join('\n') } });
    } }, 'Check');
    add(face, el('div', { class: 'match' }, L, R), el('div', { class: 'row' }, check));
    return e => { if (e.key === 'Enter' && !check.disabled) { check.click(); return true; } };
  },

  widget(c, face, done, values) {
    add(face, c.intro ? rich(c.intro, values) : null);
    const w = el('div', { class: 'widget' });
    const seen = {};
    // predict, then see: with c.predict you commit to a guess before the controls unlock. Guessing
    // first, even wrongly, makes what you then see stick (the prequestion effect).
    const p = c.predict;
    let predicted = p ? null : -1, guess = null;
    const inner = { ...c.ask, id: c.id }, ask = el('div', { class: 'ask', hidden: !!p });
    if (p) {
      w.inert = true;
      w.classList.add('locked');
      const choose = i => {
        predicted = i;
        guess.replaceChildren(rich(`You predicted: ${p.options[i]}. Now try it and see.`, values));
        guess.classList.add('made');
        w.inert = false;
        w.classList.remove('locked');
        ask.hidden = false;
      };
      guess = el('div', { class: 'predict' }, el('p', { class: 'small' }, el('strong', {}, 'Predict first. '),
        el('span', { class: 'muted' }, 'The controls unlock when you have.')), rich(p.q, values),
        el('div', { class: 'options' }, p.options.map((o, i) => el('button', { class: 'opt', type: 'button', onclick: () => choose(i) },
          el('span', { class: 'num muted' }, `${i + 1}`), rich(o, values)))));
      guess.keys = e => { const n = '12345'.indexOf(e.key); if (n >= 0 && n < p.options.length) { choose(n); return true; } };
      add(face, guess);
    }
    add(face, w);
    mountWidget(w, c.widget, r => Object.assign(seen, r));
    // then a question about it: an mcq, or a numeric whose answer may use what the widget reports (its names
    // are the report's keys). The values are read when you check, so they are the widget's as you left it.
    add(face, ask);
    const told = !p ? done : out => {
      const mine = p.options[predicted];
      const note = p.answer == null ? `You predicted: ${mine}.` : predicted === p.answer ? `Your prediction was right: ${mine}.`
        : `You predicted: ${mine}. What happens: ${p.options[p.answer]}.`;
      done({ ...out, work: [note, p.why, out.work].filter(Boolean).join('\n\n') });
    };
    const now = () => { const v = { ...values, ...seen }; try { return compute(inner, v); } catch { return v; } };
    const live = new Proxy({}, {
      get: (_, k) => now()[k], has: (_, k) => k in now(),
      ownKeys: () => Reflect.ownKeys(now()), getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    });
    const keys = TYPES[inner.type](inner, ask, told, live);
    return e => predicted == null ? guess.keys(e) : keys?.(e);
  },

  // Explain the step: why does it follow, in your own words; then the model answer to compare with.
  // Saying why is one of the surest ways to learn from a worked example (self-explanation).
  explain(c, face, done, values) {
    add(face, c.context ? el('div', { class: 'context' }, rich(c.context, values)) : null, rich(c.q, values));
    const mine = el('textarea', { rows: 4, class: 'mine', placeholder: 'In your own words… (for you; not marked)', 'aria-label': 'Your explanation' });
    let rates = null;
    const compare = el('button', { class: 'btn', type: 'button', onclick: () => {
      if (!mine.value.trim()) { flash('Write something first: even a rough go helps it stick'); mine.focus(); return; }
      mine.readOnly = true;
      mine.blur();
      compare.remove();
      rates = rateButtons(done, c.why);
      add(face, el('div', { class: 'model' }, el('h4', {}, 'A model answer'), rich(c.model, values)),
        c.points?.length ? [el('p', { class: 'muted small' }, 'Tick each point yours made:'),
          el('div', { class: 'points' }, c.points.map(pt => el('label', {}, el('input', { type: 'checkbox' }), rich(pt, values))))] : null,
        el('p', { class: 'muted small' }, 'How did yours compare?'), rates);
    } }, 'Compare');
    mine.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); compare.click(); } });
    add(face, mine, el('div', { class: 'row mid' }, compare, el('span', { class: 'muted small' }, 'Ctrl+Enter')));
    queueMicrotask(() => { if (face.closest('.lcard.current')) mine.focus({ preventScroll: true }); });
    return e => rates?.keys(e);
  },

  // Spot the mistake: working, a rung or a listing with one line wrong. Find it; then see it put right.
  spot(c, face, done, values) {
    add(face, rich(c.q || 'One line has a mistake in it. Which?', values));
    let answered = false;
    const show = t => c.mono ? el('code', {}, fill(t, values)) : rich(t, values);
    const pick = (i, b) => {
      if (answered) return;
      answered = true;
      const correct = i === c.wrong;
      lines.querySelectorAll('button').forEach(x => { x.disabled = true; if (+x.dataset.i === c.wrong) x.classList.add('right'); });
      if (!correct) b.classList.add('wrong');
      done({ correct, rating: ratingFor(correct), answer: correct ? null : `line ${c.wrong + 1}`,
             work: c.fix ? `**Put right:** ${fill(c.fix, values)}` : null, why: c.why ? fill(c.why, values) : null,
             mistake: { front: `${plain(c.q || 'Spot the mistake', values)}\n\n${c.lines.map((l, k) => `${k + 1}. ${plain(l, values)}`).join('\n')}`,
                        back: `Line ${c.wrong + 1}.${c.fix ? ' Put right: ' + plain(c.fix, values) : ''}${c.why ? '\n\n' + c.why : ''}` } });
    };
    const lines = el('div', { class: 'spot' + (c.mono ? ' mono' : '') }, c.lines.map((t, i) => {
      const b = el('button', { class: 'opt', type: 'button', data: { i } }, el('span', { class: 'num muted' }, `${i + 1}`), show(t));
      b.addEventListener('click', () => pick(i, b));
      return b;
    }));
    add(face, lines);
    return e => { const n = '123456789'.indexOf(e.key); if (n >= 0 && n < c.lines.length) { lines.children[n].click(); return true; } };
  },

  code(c, face, done) {
    add(face, rich(c.q || ''));
    const parts = String(c.code).split('___');
    const blanks = [];
    const pre = el('pre', { class: 'st' }, parts.flatMap((p, k) => {
      if (k === parts.length - 1) return [p];
      const b = el('input', { class: 'blank', size: c.blank_size || 12, spellcheck: false, 'aria-label': `Blank ${k + 1}` });
      blanks.push(b);
      return [p, b];
    }));
    const source = () => parts.map((p, k) => p + (k < blanks.length ? blanks[k].value : '')).join('');
    const panel = el('div', { class: 'plcpanel' });
    const ins = c.inputs || [], outs = c.outputs || [];
    let m = null, err = el('p', { class: 'err', hidden: true });
    const inputs = Object.fromEntries(ins.map(n => [n, false]));
    const lamps = Object.fromEntries(outs.map(n => [n, el('span', { class: 'lamp' })]));
    const vars = el('div', { class: 'vars num small muted' });
    const reset = () => {
      err.hidden = true; m = null;
      if (blanks.every(b => b.value.trim())) try { m = machine(compile(source()), c); } catch (e) { err.textContent = e.message; err.hidden = false; }
      show();
    };
    const show = () => {
      for (const n of outs) lamps[n].classList.toggle('on', !!m?.vars[n]);
      vars.textContent = !m ? (err.hidden ? 'Fill in the blanks to run it.' : '') : `scan ${m.scans} · ${(m.time / 1000).toFixed(1)} s` + Object.entries(m.vars)
        .filter(([k, v]) => !ins.includes(k) && !outs.includes(k)).map(([k, v]) => `  ${k}=${typeof v === 'object' ? (v._type === 'TON' || v._type === 'TOF' || v._type === 'TP' ? `${v.Q ? 'Q' : '-'} ${v.ET}ms` : v.CV != null ? `CV ${v.CV}` : v.Q ? 'Q' : '-') : v}`).join('');
    };
    const once = () => { if (!m) reset(); if (!m) return; try { scan(m, inputs, c.scan_ms || 100); } catch (e) { err.textContent = e.message; err.hidden = false; } show(); };
    let timer = null;
    const run = el('button', { class: 'btn plain sm', type: 'button', onclick: () => {
      if (timer) { clearInterval(timer); timer = null; run.textContent = '▶ Run'; return; }
      timer = setInterval(() => { if (!face.isConnected) { clearInterval(timer); return; } once(); }, c.scan_ms || 100);
      run.textContent = '■ Stop';
    } }, '▶ Run');
    add(panel, 
      el('div', { class: 'row mid' }, ins.map(n => el('label', { class: 'pswitch' }, el('input', { type: 'checkbox', onchange: e => { inputs[n] = e.target.checked; } }), n)),
        el('span', { class: 'spacer' }), outs.map(n => el('span', { class: 'out' }, lamps[n], n))),
      el('div', { class: 'row mid' }, el('button', { class: 'btn plain sm', type: 'button', onclick: once }, 'Scan once'), run,
        el('button', { class: 'btn plain sm', type: 'button', onclick: reset }, 'Reset'), vars), err);
    add(face, pre, panel);
    blanks.forEach(b => b.addEventListener('change', reset));
    reset();
    if (c.ask) { const ask = el('div', { class: 'ask' }); add(face, ask); return TYPES[c.ask.type]({ ...c.ask, id: c.id }, ask, done, {}); }
    const check = el('button', { class: 'btn', type: 'button', onclick: () => {
      let res;
      try { res = test(source(), c); } catch (e) { flash(e.message); return; }
      const bad = res.filter(r => !r.ok), correct = !bad.length;
      check.disabled = true; blanks.forEach(b => { b.disabled = true; });
      add(face, el('ul', { class: 'tests' }, res.map(r => el('li', { class: r.ok ? 'right' : 'wrong' }, `${r.ok ? '✓' : '✗'} ${r.name}${r.why ? ': ' + r.why : ''}`))));
      done({ correct, rating: ratingFor(correct), why: c.why, answer: c.solution ? c.solution.join(' · ') : null,
             mistake: { front: `${c.q}\n\n${c.code}`, back: `${(c.solution || []).join(' · ')}${c.why ? '\n\n' + c.why : ''}` } });
    } }, blanks.length ? 'Check' : 'Run the tests');
    add(face, el('div', { class: 'row' }, check));
    return e => { if (e.key === 'Enter' && !e.target.closest?.('input.blank')) { check.click(); return true; } };
  },
};

// ---- the frame ------------------------------------------------------------------------------

const WHY = { review: 'Review', new: 'New', practice: 'Practice', lesson: '', warmup: 'Warm-up', refresher: 'Refresher',
              struggle: 'Coming back', calibrate: '', checkpoint: 'Checkpoint', testout: 'Test out', comeback: 'Comeback', again: 'Again' };
const SURE = [[0, 'Guess'], [1, 'Think so'], [2, 'Sure']];
// the kinds of card whose answer is marked, not self-rated: "how sure?" is asked of these
const MARKED = new Set(['mcq', 'numeric', 'order', 'match', 'code', 'widget', 'spot']);

/** Read aloud in the browser's own voice: for the drive or the walk. Null where there is no speech. */
export function listenButton(text) {
  if (!('speechSynthesis' in window)) return null;
  const said = String(text).replace(/\$\$?([^$]+)\$\$?/g, (_, m) => m.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1 over $2')
    .replace(/\\(times|cdot)/g, ' times ').replace(/\\approx/g, ' about ').replace(/\^\{?2\}?/g, ' squared ')
    .replace(/\\([a-zA-Z]+)/g, ' $1 ').replace(/[{}^_]/g, ' ')).replace(/\*\*|`/g, '').replace(/^- /gm, '');
  const b = el('button', { class: 'btn plain sm', type: 'button', title: 'Read it aloud' }, 'Listen');
  b.addEventListener('click', () => {
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); b.textContent = 'Listen'; return; }
    const u = new SpeechSynthesisUtterance(said);
    u.lang = 'en-GB';
    u.rate = 0.95;
    u.onend = u.onerror = () => { b.textContent = 'Listen'; };
    speechSynthesis.speak(u);
    b.textContent = 'Stop';
  });
  return b;
}

/** "Report a problem": a note on the card, for the Needs rework list. */
export function report(id) {
  const note = el('textarea', { rows: 3, placeholder: 'What is wrong with it? (the answer, the wording, a typo…)', style: 'width:100%' });
  dialog('Report a problem with this card', el('div', {}, note), [{ label: 'Send', fn: async () => {
    try { await api.report(id, note.value); flash('Thanks: it is on the Needs rework list in Stats'); } catch (e) { flash(e.message); return false; }
  } }]);
}

/** A card, ready to use. onDone(outcome) after it is recorded: outcome.today has the day's counts,
 *  outcome.retest says to ask it again soon (a confident mistake), outcome.repair holds cards to go over first. */
export function frame(item, { mode = 'feed', onDone } = {}) {
  const c = item.card, started = Date.now();
  let values = {};
  try { values = draw(c); } catch (e) { values = {}; }
  const face = el('div', { class: 'face' });
  const result = el('div', { class: 'result', hidden: true });
  const asks = c.type !== 'concept' && !(c.type === 'steps' && c.worked);
  let confidence = null;
  const sure = asks && MARKED.has(c.type) && mode !== 'practice' && state.meta?.settings?.confidence_taps !== '0'
    ? el('div', { class: 'sure', role: 'group', 'aria-label': 'How sure are you?' }, el('span', { class: 'muted small' }, 'How sure?'),
        SURE.map(([v, label]) => el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: e => {
          confidence = confidence === v ? null : v;
          sure.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget && confidence === v)));
        } }, label))) : null;
  // a nudge before answering (numeric cards show their own, next to the box)
  const hintText = c.type === 'numeric' || c.ask?.type === 'numeric' ? null : c.hint ?? c.ask?.hint;
  const hint = hintText ? el('details', { class: 'hint' }, el('summary', {}, 'Hint'), rich(hintText, values)) : null;
  const box = el('article', { class: `lcard t-${c.type}`, data: { id: item.id } },
    el('div', { class: 'meta muted small' }, [item.subject, item.lesson].filter(Boolean).join(' · '),
      WHY[item.why] ? el('span', { class: 'chip' }, WHY[item.why]) : null,
      JSON.stringify(c).includes('$') ? el('button', { class: 'link small fhelpbtn', type: 'button', title: 'What this formula means, letter by letter',
        onclick: () => formulaHelp(mathsOf(c, values), item.id.split('/')[0]) }, 'Formula help') : null,
      el('button', { class: 'link small', type: 'button', title: 'A whiteboard beside the card (W)', onclick: () => toggle('board') }, 'Whiteboard'),
      el('button', { class: 'link small', type: 'button', title: 'A calculator beside the card (C)', onclick: () => toggle('calc') }, 'Calculator'),
      el('button', { class: 'link small report', type: 'button', title: 'Report a problem with this card', onclick: () => report(item.id) }, 'Report')),
    face, hint, sure, result);
  let finished = false;
  const done = async out => {
    if (finished) return;
    finished = true;
    if (sure) sure.hidden = true;
    const when = el('div', { class: 'muted small' });
    if (asks) {
      result.hidden = false;
      result.className = 'result ' + (out.correct ? 'right' : 'wrong');
      add(result, el('strong', {}, out.selfRated ? (out.correct ? 'Noted.' : 'It will come back soon.') : out.correct ? 'Right.' : 'Not quite.'),
        !out.correct && out.answer ? el('div', {}, 'The answer: ', rich(out.answer)) : null,
        out.work ? rich(out.work) : null, out.why ? rich(out.why, values) : null, when);
    }
    try {
      const rec = await api.answer({ card_id: item.id, mode, correct: asks ? out.correct : null, rating: out.selfRated ? out.rating : null,
                                     confidence, ms: Math.min(Date.now() - started, 600000),
                                     mistake: out.correct === false && c.type !== 'flash' ? out.mistake : null });
      when.textContent = [rec.next, rec.struggle ? 'It is on your Coming back list until you get it right on three separate days.' : null,
        rec.retest ? 'You were sure, so it comes round again in a moment.' : null].filter(Boolean).join(' ');
      onDone?.({ ...out, today: rec.today, retest: rec.retest, repair: rec.repair || [], level: rec.level });
    } catch (e) { flash(e.message); onDone?.({ ...out }); }
  };
  if (!TYPES[c.type]) add(face, el('p', { class: 'err' }, `Learn does not know a ${c.type} card.`));
  else {
    try { box.keys = TYPES[c.type](c, face, done, values) || null; }
    catch (e) { add(face, el('p', { class: 'err' }, `This card could not be shown: ${e.message}`)); }
  }
  box.finished = () => finished;
  /** Swiped away as too easy. A card you have answered before goes further out; a new one needs an answer. */
  box.tooEasy = async () => {
    if (finished) return null;
    if (asks && !item.state?.stability) return { needs: true };
    finished = true;
    box.classList.add('easy');
    const rec = await api.answer({ card_id: item.id, mode, correct: null, too_easy: asks, ms: Math.min(Date.now() - started, 600000) });
    return { next: rec.next, today: rec.today };
  };
  return box;
}
