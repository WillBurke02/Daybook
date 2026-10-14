// A day: its diary, its work entries in time order with photos and voice notes,
// and, when Money is there, the shifts worked. The quick add sits above every page.
import { api } from '../api.js';
import { appApi, APP } from '../core/api.js';
import { el, flash, seg } from '../core/dom.js';
import { icon } from '../core/pages.js';
import { today, addDays, dayLong, dow, toTime, hhmm, span } from '../core/format.js';
import { state } from '../core/state.js';
import { pictureInput, recorder, voicePlayer, viewImage, blobOf, shrink, mediaIn, isVideo, videoInfo, uploadClip,
  videoTile, busy, CLIP_MAX } from '../ui/media.js';

const now = () => new Date().toTimeString().slice(0, 5);
const dayOf = ctx => /^\d{4}-\d{2}-\d{2}$/.test(ctx.params.d || '') ? ctx.params.d : today();
const tagLinks = tags => (tags || '').trim().split(/\s+/).filter(Boolean)
  .map(t => el('a', { class: 'chip', href: `#/timeline?tag=${encodeURIComponent(t)}` }, '#' + t));
// when an entry's !fri falls: on its own day's Reminders
const whenOf = r => `${dow(r.slice(0, 10))} ${r.slice(8, 10)}/${r.slice(5, 7)}${r.length > 10 ? ' ' + r.slice(11) : ''}`;
const remindChip = e => e.remind ? el('a', { class: 'chip rem' + (e.reminded ? ' done' : ''), href: `#/day?d=${e.remind.slice(0, 10)}`,
  title: e.reminded ? 'Reminder, done' : 'Reminder: on that day in Log, and in the calendar feed' }, `Reminder ${whenOf(e.remind)}`) : null;
let cache = null;                                        // the panels on one page share one fetch of the day
const changed = ctx => { cache = null; tagList = null; ctx.reload(); };

// ---- #tags: the ones in use, offered as a # is typed ------------------------------------
let tagList = null;                                      // most used first; fetched again after a change
const tagsInUse = () => tagList ??= api.view('v_tag', { order: 'n', desc: 1 }).then(r => r.map(t => t.tag)).catch(() => []);

/** The row under a box that offers #site and #siemens as #si is typed: a tap (or Tab) finishes the word. */
export function tagAssist(box) {
  const strip = el('div', { class: 'tagassist', hidden: true, 'aria-label': 'Tags in use' });
  let w = null;
  const pick = t => {
    const at = box.selectionStart;
    box.setRangeText(t + ' ', at - w.length, at, 'end');
    strip.hidden = true;
    box.focus();
    box.dispatchEvent(new Event('input'));               // the draft keeps it
  };
  const offer = async () => {
    const at = box.selectionStart;
    w = /(?:^|[^\w#])#([\w-]*)$/.exec(box.value.slice(0, at))?.[1] ?? null;
    if (w == null) { strip.hidden = true; return; }
    const has = new Set([...(box.value.slice(0, at - w.length - 1) + ' ' + box.value.slice(at)).matchAll(/#([\w-]+)/g)].map(m => m[1].toLowerCase()));
    const got = (await tagsInUse()).filter(t => t.startsWith(w.toLowerCase()) && t !== w.toLowerCase() && !has.has(t)).slice(0, 8);
    strip.hidden = !got.length;
    // pointerdown is held back so the box keeps its focus (an entry is not saved half-typed); the click picks
    const keep = e => e.preventDefault();
    strip.replaceChildren(...got.map(t => el('button', { type: 'button', class: 'chip', tabindex: -1,
      onpointerdown: keep, onmousedown: keep, onclick: () => pick(t) }, '#' + t)));
  };
  box.addEventListener('input', offer);
  box.addEventListener('keydown', e => { if (e.key === 'Tab' && !strip.hidden) { e.preventDefault(); strip.firstChild.dispatchEvent(new MouseEvent('click')); }
                                         if (e.key === 'Escape') strip.hidden = true; });
  box.addEventListener('blur', () => { strip.hidden = true; });
  return strip;
}

// ---- the quick add ----------------------------------------------------------------

const BASE = `/${APP}/`;
let pending = { photos: [], voice: null, videos: [] };
// The words being written survive switching app or a reload (this browser only); photos and voice
// are too big to keep, so leaving with them unsent asks first.
const DRAFT = 'log.draft';
const draft = v => { try { return v === undefined ? localStorage.getItem(DRAFT) || '' : v ? localStorage.setItem(DRAFT, v) : localStorage.removeItem(DRAFT); } catch { return ''; } };
addEventListener('beforeunload', e => { if (pending.photos.length || pending.voice || pending.videos.length) e.preventDefault(); });

/** Photos (shrunk here) and videos (as they are, with a picture of their first frame), from a picker, a paste or a drop,
 *  one at a time: got('photos' | 'videos', it) as each is ready, so it shows at once; got(null) for one left out. */
async function prepare(files, got) {
  for (const f of files) {
    try {
      if (!isVideo(f)) { got('photos', await shrink(f)); continue; }
      if (f.size > CLIP_MAX) { flash(`${f.name || 'That video'} is ${Math.round(f.size / 2 ** 20)} MB: videos up to ${CLIP_MAX / 2 ** 20} MB. Trim it on the phone first.`); got(null); continue; }
      got('videos', { file: f, ...(await videoInfo(f)) });
    } catch { flash(`Can't read ${f.name || 'that picture'}. Save it as JPEG or PNG and try again.`); got(null); }
  }
}

/** Each video up to the Pi in turn, with how far it has got. */
async function sendVideos(entryId, videos) {
  try {
    for (const [i, v] of videos.entries()) {
      const mb = Math.round(v.file.size / 2 ** 20), what = `Uploading video ${i + 1} of ${videos.length}${mb ? ` (${mb} MB)` : ''}`;
      busy(what, 0);
      await uploadClip(BASE, entryId, v.file, v, f => busy(`${what} · ${Math.round(f * 100)}%`, f));
    }
    return true;
  } catch (e) { flash(e.message); return false; }
  finally { busy(); }
}

export async function quickBar(ctx) {
  const onDayPage = !location.hash || location.hash.startsWith('#/day');
  const forDay = onDayPage ? dayOf(ctx) : today();
  const text = el('textarea', { rows: 1, placeholder: forDay === today() ? 'What happened? #tags, !fri for a reminder' : `Add to ${dayLong(forDay)}`,
                                'aria-label': 'Log text' });
  text.value = draft();
  text.addEventListener('input', () => draft(text.value));
  const at = el('input', { class: 'sm', value: forDay === today() ? now() : '', placeholder: 'time', inputmode: 'numeric',
                           style: 'width:64px', 'aria-label': 'Time' });
  let kind = 'work';
  const kinds = seg([{ v: 'work', label: 'Work' }, { v: 'day', label: 'Diary' }], kind, v => { kind = v; });
  const shown = el('span', { class: 'pending' });
  // a grey tile for each one still being made ready, so a pick shows at once; gen drops those still coming after ×
  let waiting = 0, gen = 0, preparing = Promise.resolve();
  const show = () => shown.replaceChildren(...[...pending.photos.map(p => el('img', { src: p.thumb, alt: 'Photo to add' })),
    ...pending.videos.map(v => el('span', { class: 'pvid' }, v.thumb ? el('img', { src: v.thumb, alt: 'Video to add' }) : 'video', el('b', {}, '▶'))),
    ...Array.from({ length: waiting }, () => el('span', { class: 'prep', role: 'img', 'aria-label': 'Getting it ready' })),
    pending.voice ? el('span', { class: 'chip' }, `voice ${Math.round(pending.voice.duration_s)}s`) : null,
    pending.photos.length || pending.voice || pending.videos.length ? el('button', { class: 'icon del', type: 'button', title: 'Drop these',
      onclick: () => { pending = { photos: [], voice: null, videos: [] }; gen++; waiting = 0; show(); } }, '×') : null].filter(Boolean));   // null would print "null"
  const takeMedia = files => {
    const mine = gen;
    waiting += files.length; show();
    preparing = preparing.then(() => prepare(files, (k, x) => {
      if (mine !== gen) return;
      if (k) pending[k].push(x);
      waiting--; show();
    }));
    text.focus({ preventScroll: true });
  };
  // the camera takes a photo there and then; + picks photos and videos already on the phone (or files on a PC)
  const shoot = pictureInput(takeMedia, { multiple: false });
  const pick = pictureInput(takeMedia, { camera: false, accept: 'image/*,video/*' });
  const addBtn = el('button', { class: 'btn', type: 'button', onclick: () => add() }, 'Add');
  const add = async () => {
    if (addBtn.disabled) return;                          // one tap, one entry
    addBtn.disabled = true;
    try {
      if (waiting) { addBtn.textContent = 'Getting ready…'; await preparing; }
      if (!text.value.trim() && !pending.photos.length && !pending.voice && !pending.videos.length) return flash('Write something, or add a photo, a video or a voice note');
      addBtn.textContent = 'Sending…';
      const { photos, videos, voice } = pending;
      if (photos.length) busy(`Sending ${photos.length} photo${photos.length === 1 ? '' : 's'}…`);
      const r = await api.quick({ text: text.value, kind, day: forDay, at: toTime(at.value) || null, photos, voice, videos: videos.length });
      busy();
      pending = { photos: [], voice: null, videos: [] };
      draft(''); text.value = '';
      show();
      if (videos.length && !await sendVideos(r.id, videos)) return changed(ctx);
      flash(`Added to ${forDay === today() ? 'today' : dayLong(forDay)}`, { label: 'Undo', fn: async () => { await api.undo(); changed(ctx); } });
      changed(ctx);
    } catch (e) { busy(); flash(e.message); }
    finally { addBtn.disabled = false; addBtn.textContent = 'Add'; }
  };
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } });
  const bar = el('div', { class: 'quickadd' }, text, tagAssist(text),
    el('div', { class: 'row mid' }, kinds, at,
      el('button', { class: 'icon', type: 'button', onclick: () => shoot.click(), title: 'Take a photo', 'aria-label': 'Take a photo' }, icon('cam')), shoot,
      el('button', { class: 'icon', type: 'button', onclick: () => pick.click(), title: 'Add photos and videos', 'aria-label': 'Add photos and videos' }, icon('plus')), pick,
      recorder(v => { pending.voice = v; show(); }), shown,
      el('span', { class: 'spacer' }),
      el('span', { class: 'muted small hint' }, 'Ctrl+Enter adds · paste or drop a picture'),
      addBtn));
  // a pasted screenshot or a dropped photo joins what is about to be added
  bar.addEventListener('paste', e => { const f = mediaIn(e.clipboardData); if (f.length) { e.preventDefault(); takeMedia(f); } });
  document.body.ondragover = e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); bar.classList.add('drop'); } };
  document.body.ondragleave = e => { if (!e.relatedTarget) bar.classList.remove('drop'); };
  document.body.ondrop = e => { bar.classList.remove('drop'); const f = mediaIn(e.dataTransfer); if (f.length) { e.preventDefault(); takeMedia(f); } };
  show();
  fileInbox(ctx);
  // opened to write (the Log icon, Ctrl+Alt+L): the box is ready to type in, with a mouse and keyboard;
  // a phone waits for a tap, so the keyboard does not cover the day
  if (onDayPage && matchMedia('(pointer: fine)').matches) setTimeout(() => text.focus({ preventScroll: true }));   // once it is on the page
  return bar;
}

/** Pictures a phone shared arrive as they are: shrink each in the browser, file it on its entry. */
async function fileInbox(ctx) {
  const rows = await api.table('inbox').catch(() => []);
  if (!rows.length) return;
  let n = 0;
  for (const r of rows) {
    try {
      const p = await shrink(await blobOf(r.data));
      await api.attach(r.entry_id, { photos: [p], inbox: [r.id] });
      n++;
    } catch { /* one that will not read stays in the inbox, and is tried again next time */ }
  }
  if (n) { flash(`Filed ${n} shared picture${n === 1 ? '' : 's'}`); changed(ctx); }
}

// ---- one entry ----------------------------------------------------------------------

function attachments(e, ctx) {
  const title = `${dayLong(e.day)}${e.at ? ' · ' + e.at : ''}`;
  return el('div', { class: 'atts' }, e.attachments.map(a => el('span', { class: 'att' },
    a.type === 'photo'
      ? el('button', { class: 'thumb', type: 'button', title: 'Open photo', onclick: () => viewImage(api.media(a.id), title) },
          el('img', { src: a.thumb, alt: 'Photo' }))
      : a.type === 'video' ? videoTile(a, BASE, title) : voicePlayer(a, api.media),
    el('button', { class: 'icon del', type: 'button', title: 'Remove', onclick: async () => {
      await api.remove(a.type === 'video' ? 'clip' : 'attachment', a.id);
      flash('Removed', { label: 'Undo', fn: async () => { await api.undo(); changed(ctx); } });
      changed(ctx);
    } }, '×'))));
}

/** + Photo or video and + Voice on an entry that already exists. */
function addMedia(e, ctx) {
  const put = async body => { try { await api.attach(e.id, body); changed(ctx); } catch (x) { flash(x.message); } };
  const pick = pictureInput(async files => {
    const got = { photos: [], videos: [] };
    let left = files.length;
    busy(`Getting ${left} ready…`);
    await prepare(files, (k, x) => { if (k) got[k].push(x); if (--left) busy(`Getting ${left} ready…`); });
    try {
      if (got.photos.length) { busy(`Sending ${got.photos.length} photo${got.photos.length === 1 ? '' : 's'}…`); await api.attach(e.id, { photos: got.photos }); }
    } catch (x) { flash(x.message); return; }
    finally { busy(); }
    if (got.videos.length) await sendVideos(e.id, got.videos);
    if (got.photos.length || got.videos.length) { flash('Added'); changed(ctx); }
  }, { camera: false, accept: 'image/*,video/*' });
  return el('span', { class: 'row mid addmedia' },
    el('button', { class: 'btn plain sm', type: 'button', onclick: () => pick.click() }, '+ Photo or video'), pick,
    recorder(v => put({ voice: v })));
}

function workEntry(e, ctx) {
  const at = el('input', { class: 'sm at', value: e.at || '', placeholder: '--:--', inputmode: 'numeric', 'aria-label': 'Time' });
  const text = el('textarea', { rows: 1, 'aria-label': 'Entry' }, e.text || '');
  text.value = e.text || '';
  const save = async patch => {
    try { await api.save('entry', { id: e.id, ...patch }); changed(ctx); } catch (x) { flash(x.message); }
  };
  at.addEventListener('change', () => { at.value = toTime(at.value); save({ at: at.value || null }); });
  text.addEventListener('change', () => save({ text: text.value.trim() || null }));
  const box = el('article', { class: 'entry', id: `e${e.id}` },
    el('div', { class: 'when' }, at),
    el('div', { class: 'what' }, text, tagAssist(text), attachments(e, ctx), el('div', { class: 'row mid' }, tagLinks(e.tags), remindChip(e),
      el('span', { class: 'actions row mid' }, addMedia(e, ctx),
        el('button', { class: 'icon del', type: 'button', title: 'Delete entry', 'aria-label': 'Delete entry', onclick: async () => {
          await api.remove('entry', e.id);
          flash('Entry deleted', { label: 'Undo', fn: async () => { await api.undo(); changed(ctx); } });
          changed(ctx);
        } }, icon('x'))))));
  return box;
}

// ---- the page -------------------------------------------------------------------------

const load = d => {
  if (cache?.d === d && Date.now() - cache.t < 1500) return cache.p;
  cache = { d, t: Date.now(), p: api.day(d) };
  return cache.p;
};

export const panels = {
  // what an entry asked to be reminded of (!fri), on its day; today, also any earlier not yet ticked off
  'log.remind': { title: 'Reminders', w: 12, deps: ['entry'], async render(body, ctx) {
    const d = dayOf(ctx), rows = (await load(d)).reminders || [];
    body.closest('.panel').hidden = !rows.length && !state.editing;          // there only when there is one
    const tick = r => async () => {
      try { await api.save('entry', { id: r.id, reminded: r.reminded ? null : new Date().toISOString().slice(0, 16).replace('T', ' ') }); changed(ctx); }
      catch (e) { flash(e.message); }
    };
    body.append(el('ul', { class: 'reminders' }, rows.map(r => {
      const late = r.remind.slice(0, 10) < d;
      return el('li', { class: r.reminded ? 'done' : late ? 'late' : null },
        el('button', { class: 'tick', type: 'button', 'aria-pressed': String(!!r.reminded), title: r.reminded ? 'Not done after all' : 'Done',
          'aria-label': `${r.what}: ${r.reminded ? 'done' : 'not done'}`, onclick: tick(r) }, r.reminded ? '✓' : ''),
        el('a', { href: `#/day?d=${r.day}&e=${r.id}`, title: 'The entry it is in' }, r.what),
        el('span', { class: 'muted small num' }, late ? `since ${whenOf(r.remind)}` : r.remind.slice(11)));
    })));
  } },

  'log.diary': { title: 'Diary', w: 12, deps: ['entry', 'attachment'], async render(body, ctx) {
    const d = dayOf(ctx);
    const got = await load(d);
    const diary = got.entries.find(e => e.kind === 'day');
    const long = new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    ctx.pageTitle(long, `${d === today() ? 'Today · ' : d === addDays(today(), -1) ? 'Yesterday · ' : ''}${d.slice(0, 4)}`);
    const jump = el('input', { type: 'date', class: 'sm', value: d, 'aria-label': 'Go to a day',
      onchange: e => e.target.value && ctx.go('day', { d: e.target.value }) });
    ctx.pageHead.querySelector('.ctl').replaceChildren(...[
      got.prev ? el('button', { class: 'link small', type: 'button', onclick: () => ctx.go('day', { d: got.prev }), title: 'The last day with anything logged' },
        `Last logged: ${dow(got.prev)} ${got.prev.slice(8)}/${got.prev.slice(5, 7)}`) : null,
      el('span', { class: 'daynav' },
        el('button', { class: 'icon', type: 'button', title: 'The day before  [', 'aria-label': 'The day before', onclick: () => ctx.go('day', { d: addDays(d, -1) }) }, icon('left')),
        jump,
        el('button', { class: 'icon', type: 'button', title: 'The day after  ]', 'aria-label': 'The day after', onclick: () => ctx.go('day', { d: addDays(d, 1) }) }, icon('right'))),
      d !== today() ? el('button', { class: 'btn plain sm', type: 'button', onclick: () => ctx.go('day', {}) }, 'Today') : null,
      el('a', { class: 'icon', href: `#/print?from=${d}&to=${d}`, title: 'Print this day', 'aria-label': 'Print this day' }, icon('print'))].filter(Boolean));
    const text = el('textarea', { class: 'diary', rows: 2, placeholder: 'How the day went. #tags work here too.', 'aria-label': 'Diary' });
    text.value = diary?.text || '';
    text.addEventListener('change', async () => {
      try {
        await api.save('entry', diary ? { id: diary.id, text: text.value.trim() || null } : { day: d, kind: 'day', text: text.value.trim() });
        flash('Saved'); changed(ctx);
      } catch (x) { flash(x.message); }
    });
    body.append(text, tagAssist(text), diary ? el('div', { class: 'row mid' }, tagLinks(diary.tags), remindChip(diary), addMedia(diary, ctx)) : null,
      diary ? attachments(diary, ctx) : null);
    if (diary && String(diary.id) === ctx.params.e) lightUp(text);
  } },

  'log.work': { title: 'Work', w: 8, deps: ['entry', 'attachment'], async render(body, ctx) {
    const d = dayOf(ctx);
    const got = await load(d);
    const work = got.entries.filter(e => e.kind === 'work');
    ctx.aside.append(el('span', { class: 'muted num' }, `${work.length} entr${work.length === 1 ? 'y' : 'ies'}`));
    if (!work.length) { body.append(el('p', { class: 'note' }, 'Nothing logged for work on this day. Use the box at the top.')); return; }
    body.append(el('div', { class: 'entries' }, work.map(e => workEntry(e, ctx))));
    lightUp(body.querySelector(`#e${CSS.escape(ctx.params.e || '')}`));      // arrived from Home or search: that entry
  } },

  // Money's shifts that day, read through Money's own API; left out if Money is not installed.
  'log.shifts': { title: 'Hours', w: 4, async render(body, ctx) {
    if (!state.meta.apps.some(a => a.name === 'money')) { body.append(el('p', { class: 'note' }, 'Money is not installed.')); return; }
    const d = dayOf(ctx), money = appApi('money');
    const [shifts, [day]] = await Promise.all([money.table('shift', { date: d, order: 'start' }), money.view('v_day', { date: d })])
      .catch(() => [[], []]);
    ctx.aside.append(el('a', { class: 'link', href: `/hours/#/hours?p=month:${d}&add=${d}` }, 'Open in Hours'));
    if (!shifts.length) { body.append(el('p', { class: 'note' }, 'No shifts on this day.')); return; }
    body.append(el('table', {}, el('tbody', {}, shifts.map(s => el('tr', {},
      el('td', { class: 'num' }, `${s.start}–${s.end}`), el('td', { class: 'n num' }, hhmm(span(s.start, s.end))),
      el('td', { class: 'muted' }, [s.project, s.note].filter(Boolean).join(' · ')))))),
      day ? el('p', { class: 'row mid', style: 'margin:8px 0 0' }, el('strong', { class: 'num' }, `${hhmm(day.hours)} worked`),
        day.ot_hours > 0 ? el('span', { class: 'num', style: 'color:var(--flag)' }, `${hhmm(day.ot_hours)} overtime ×${day.ot_mult}`) : null) : null);
  } },
};

/** Bring an entry into view and mark it for a moment. */
function lightUp(x) {
  if (!x) return;
  requestAnimationFrame(() => { x.scrollIntoView({ block: 'center', behavior: 'smooth' }); x.classList.add('lit'); setTimeout(() => x.classList.remove('lit'), 2200); });
}

export const page = { title: 'Day', narrow: true, quick: false,
  layout: [{ use: 'log.remind', w: 12 }, { use: 'log.diary' }, { use: 'log.work', w: 12 }, { use: 'log.shifts', w: 12 }], panels };
