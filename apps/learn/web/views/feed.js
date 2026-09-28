// The feed: full-screen cards, one per screen, snapping as you scroll (§7.1, §7.2).
// Swipe up or ↓/Space for the next; swipe left or ← for "too easy", right or → to
// save it for later. After every 20 cards it stops to sum up and offers to stop.
import { api } from '../api.js';
import { el, flash } from '../core/dom.js';
import { ring } from '../ui/ring.js';
import { frame } from '../cards.js';

const EVERY = 20;          // a summary after this many cards
const AHEAD = 4;           // load more when this close to the end
const left = t => { const n = Math.round(t.goal - t.done); return `${n} ${t.goal_kind === 'cards' ? 'card' : 'minute'}${n === 1 ? '' : 's'}`; };
const KEEP = 500;          // ids sent back as "not these again"; ponytail: the URL grows with the session, fine for hundreds

export const page = { title: 'Feed', layout: [{ use: 'learn.feed' }], panels: { 'learn.feed': { title: 'Feed', w: 12, render } } };

async function render(body, ctx) {
  const subjects = ctx.params.subjects || undefined;
  const top = el('div', { class: 'feedtop' });
  const scroller = el('div', { class: 'feed', tabindex: '-1' });
  const wrap = el('div', { class: 'feedwrap', role: 'region', 'aria-label': 'Feed' }, top, scroller);
  body.append(el('p', { class: 'note' }, 'The feed fills the screen. ', el('a', { href: '#/today' }, 'Back to Today')));

  const s = { cards: 0, done: 0, right: 0, wrong: 0, ids: [], again: new Set(), repaired: new Set(), finished: false, loading: null, goalSaid: false, today: null };
  let current = null;

  const close = () => { if (!wrap.isConnected) return; wrap.remove(); document.body.classList.remove('feeding'); io.disconnect(); };
  const leave = () => { close(); location.hash = '#/today'; };
  ctx.signal.addEventListener('abort', close);
  addEventListener('hashchange', () => { if (!location.hash.startsWith('#/feed')) close(); }, { signal: ctx.signal });

  const drawTop = () => {
    const t = s.today;
    top.replaceChildren(...[
      el('button', { class: 'icon', type: 'button', 'aria-label': 'Close the feed', title: 'Close (Esc)', onclick: leave }, '✕'),
      t ? ring(Math.round(t.done), Math.round(t.goal), 38) : null,
      el('span', { class: 'small' }, t ? `${t.cards} today · ${t.due} due` : ''),
      el('span', { class: 'spacer' }),
      el('span', { class: 'small muted keys' }, '↓ next · ← too easy · → save'),
      s.done ? el('span', { class: 'small num' }, `${s.done} done · ${s.right} right`) : null].filter(Boolean));
  };

  const slides = () => [...scroller.children];
  const insertAfter = (slide, gap, add) => {
    let at = slide;
    for (let k = 0; k < gap && at.nextElementSibling; k++) at = at.nextElementSibling;
    at.after(add);
    io.observe(add);
  };
  const go = d => {
    const all = slides(), i = all.indexOf(current);
    const to = all[Math.max(0, Math.min(all.length - 1, i + d))];
    if (to && to !== current) to.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const summary = () => {
    const box = el('section', { class: 'slide sum' });
    box.onShow = () => box.replaceChildren(el('div', { class: 'lcard' },
      el('h3', {}, `${s.done} done · ${s.right} right · ${s.wrong} back soon`),
      s.today ? el('p', {}, s.today.done >= s.today.goal ? "That is today's goal. A good place to stop." :
        `${left(s.today)} to today's goal.`) : null,
      el('p', { class: 'muted' }, 'The ones you missed come back as flash cards, in the feed and in Review.'),
      el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', onclick: leave }, 'Stop for now'),
        el('button', { class: 'btn plain', type: 'button', onclick: () => go(1) }, 'Carry on'))));
    return box;
  };

  const end = () => el('section', { class: 'slide sum' }, el('div', { class: 'lcard' },
    el('h3', {}, 'That is everything for now.'),
    el('p', {}, 'Nothing is due and there are no new cards in the subjects that are on. Switch more subjects on in Today, ',
      'open a course, or write some cards of your own.'),
    el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', onclick: leave }, 'Back to Today'),
      el('a', { class: 'btn plain', href: '#/courses' }, 'Courses'), el('a', { class: 'btn plain', href: '#/mine' }, 'My cards'))));

  const cardSlide = item => {
    const slide = el('section', { class: 'slide' });
    const card = frame(item, { mode: 'feed', onDone: out => {
      s.done++;
      if (out.correct === true) s.right++;
      if (out.correct === false) { s.wrong++; s.again.add(item.id); }
      // a confident mistake: once more a few cards on; a shaky lesson underneath: a refresher next
      if (out.retest) insertAfter(slide, 3, cardSlide({ ...item, why: 'again' }));
      const fresh = (out.repair || []).filter(r => !s.repaired.has(r.lesson_id));
      if (fresh.length) { s.repaired.add(fresh[0].lesson_id); fresh.reverse().forEach(r => insertAfter(slide, 0, cardSlide(r))); }
      if (out.today) s.today = out.today;
      drawTop();
      if (item.card.type === 'concept') { go(1); return; }
      slide.append(el('button', { class: 'btn plain nextcard', type: 'button', onclick: () => go(1) }, 'Next ↓'));
      if (s.today && !s.goalSaid && s.today.done >= s.today.goal) { s.goalSaid = true; flash("That is today's goal done. Carry on if you like."); }
    } });
    slide.card = card;
    slide.append(card);
    return slide;
  };

  const more = () => s.loading ??= (async () => {
    try {
      const ex = s.ids.filter(id => !s.again.has(id)).slice(-KEEP);   // missed ones may come back when due
      const got = await api.feed(10, ex, subjects, s.cards);
      if (!got.length) { if (!s.finished) { s.finished = true; scroller.append(end()); } return; }
      for (const item of got) {
        s.ids.push(item.id);
        scroller.append(cardSlide(item));
        io.observe(scroller.lastElementChild);
        if (++s.cards % EVERY === 0) { scroller.append(summary()); io.observe(scroller.lastElementChild); }
      }
    } catch (e) { flash(e.message); } finally { s.loading = null; }
  })();

  // the slide mostly on screen is the current one
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) show(e.target);
  }, { root: scroller, threshold: 0.6 });
  const show = slide => {
    if (current === slide) return;
    current?.card?.classList.remove('current');
    current = slide;
    slide.onShow?.();
    if (slide.card) {
      slide.card.classList.add('current');
      const box = slide.card.querySelector('input:not([disabled]):not([type=checkbox]):not([type=range])');
      if (box && !slide.card.finished()) box.focus({ preventScroll: true }); else scroller.focus({ preventScroll: true });
    }
    const all = slides();
    if (!s.finished && all.length - all.indexOf(slide) <= AHEAD) more();
  };

  // ---- too easy, save for later -------------------------------------------------------
  const tooEasy = async () => {
    const card = current?.card;
    if (!card) return;
    if (card.finished()) { go(1); return; }
    try {
      const r = await card.tooEasy();
      if (r?.needs) { flash('A new card needs an answer first: a right one sends it further out'); return; }
      if (r?.today) { s.today = r.today; drawTop(); }
      flash(r?.next ? `Too easy: ${r.next.toLowerCase()}` : 'Marked as read');
    } catch (e) { flash(e.message); }
    go(1);
  };
  const saved = new Set();
  const saveIt = async () => {
    const id = current?.card?.dataset.id;
    if (!id) return;
    try {
      await api.saveCard(id);
      saved.has(id) ? saved.delete(id) : saved.add(id);
      flash(saved.has(id) ? 'Saved for later: it is in Review under Saved' : 'No longer saved');
    } catch (e) { flash(e.message); }
  };

  // ---- keys: the card first, then the feed --------------------------------------------
  addEventListener('keydown', e => {
    if (!wrap.isConnected || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    const inField = e.target.closest?.('input, textarea, select');
    if (e.key === 'Escape') { if (inField) e.target.blur(); else leave(); return; }
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); go(1); return; }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); go(-1); return; }
    if (inField) return;
    const card = current?.card;
    if (card && !card.finished() && card.keys?.(e)) { e.preventDefault(); return; }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); tooEasy(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); saveIt(); }
  }, { signal: ctx.signal });

  // ---- swipes: up and down are the browser's own scrolling; left and right are ours --------
  let start = null;
  scroller.addEventListener('pointerdown', e => {
    start = e.pointerType !== 'mouse' && !e.target.closest('input, textarea, select, button, a, .widget, .order, .match, pre')
      ? { x: e.clientX, y: e.clientY, t: Date.now() } : null;
  });
  scroller.addEventListener('pointerup', e => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y, quick = Date.now() - start.t < 800;
    start = null;
    if (quick && Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) dx < 0 ? tooEasy() : saveIt();
  });
  scroller.addEventListener('pointercancel', () => { start = null; });

  document.body.classList.add('feeding');
  document.body.append(wrap);
  try { s.today = await api.today(); } catch { /* the ring waits for the first answer */ }
  drawTop();
  await more();
  if (!scroller.children.length) return;
  show(scroller.firstElementChild);
}
