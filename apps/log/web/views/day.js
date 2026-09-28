// A day: its diary, its work entries in time order with photos and voice notes,
// and, when Money is there, the shifts worked. The quick add sits above every page.
import { api } from '../api.js';
import { appApi } from '../core/api.js';
import { el, flash, seg } from '../core/dom.js';
import { icon } from '../core/pages.js';
import { today, addDays, dayLong, dow, toTime, hhmm, span } from '../core/format.js';
import { state } from '../core/state.js';
import { shrinkAll, picturesIn, pictureInput, recorder, voicePlayer, viewImage, blobOf, shrink } from '../ui/media.js';

const now = () => new Date().toTimeString().slice(0, 5);
const dayOf = ctx => /^\d{4}-\d{2}-\d{2}$/.test(ctx.params.d || '') ? ctx.params.d : today();
const tagLinks = tags => (tags || '').trim().split(/\s+/).filter(Boolean)
  .map(t => el('a', { class: 'chip', href: `#/timeline?tag=${encodeURIComponent(t)}` }, '#' + t));
let cache = null;                                        // the panels on one page share one fetch of the day
const changed = ctx => { cache = null; ctx.reload(); };

// ---- the quick add ----------------------------------------------------------------

let pending = { photos: [], voice: null };

export async function quickBar(ctx) {
  const onDayPage = !location.hash || location.hash.startsWith('#/day');
  const forDay = onDayPage ? dayOf(ctx) : today();
  const text = el('textarea', { rows: 1, placeholder: forDay === today() ? 'What happened? #tags work' : `Add to ${dayLong(forDay)}`,
                                'aria-label': 'Log text' });
  const at = el('input', { class: 'sm', value: forDay === today() ? now() : '', placeholder: 'time', inputmode: 'numeric',
                           style: 'width:64px', 'aria-label': 'Time' });
  let kind = 'work';
  const kinds = seg([{ v: 'work', label: 'Work' }, { v: 'day', label: 'Diary' }], kind, v => { kind = v; });
  const shown = el('span', { class: 'pending' });
  const show = () => shown.replaceChildren(...[...pending.photos.map(p => el('img', { src: p.thumb, alt: 'Photo to add' })),
    pending.voice ? el('span', { class: 'chip' }, `voice ${Math.round(pending.voice.duration_s)}s`) : null,
    pending.photos.length || pending.voice ? el('button', { class: 'icon del', type: 'button', title: 'Drop these',
      onclick: () => { pending = { photos: [], voice: null }; show(); } }, '×') : null].filter(Boolean));   // null would print "null"
  const takePictures = async files => { pending.photos.push(...await shrinkAll(files)); show(); text.focus(); };
  const pick = pictureInput(takePictures);
  const add = async () => {
    if (!text.value.trim() && !pending.photos.length && !pending.voice) return flash('Write something, or add a photo or a voice note');
    try {
      await api.quick({ text: text.value, kind, day: forDay, at: toTime(at.value) || null,
                        photos: pending.photos, voice: pending.voice });
      pending = { photos: [], voice: null };
      flash(`Added to ${forDay === today() ? 'today' : dayLong(forDay)}`, { label: 'Undo', fn: async () => { await api.undo(); changed(ctx); } });
      changed(ctx);
    } catch (e) { flash(e.message); }
  };
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } });
  const bar = el('div', { class: 'quickadd' }, text,
    el('div', { class: 'row mid' }, kinds, at,
      el('button', { class: 'icon', type: 'button', onclick: () => pick.click(), title: 'Take or pick photos', 'aria-label': 'Photo' }, icon('cam')), pick,
      recorder(v => { pending.voice = v; show(); }), shown,
      el('span', { class: 'spacer' }),
      el('span', { class: 'muted small hint' }, 'Ctrl+Enter adds · paste or drop a picture'),
      el('button', { class: 'btn', type: 'button', onclick: add }, 'Add')));
  // a pasted screenshot or a dropped photo joins what is about to be added
  bar.addEventListener('paste', e => { const f = picturesIn(e.clipboardData); if (f.length) { e.preventDefault(); takePictures(f); } });
  document.body.ondragover = e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); bar.classList.add('drop'); } };
  document.body.ondragleave = e => { if (!e.relatedTarget) bar.classList.remove('drop'); };
  document.body.ondrop = e => { bar.classList.remove('drop'); const f = picturesIn(e.dataTransfer); if (f.length) { e.preventDefault(); takePictures(f); } };
  show();
  fileInbox(ctx);
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
  return el('div', { class: 'atts' }, e.attachments.map(a => el('span', { class: 'att' },
    a.type === 'photo'
      ? el('button', { class: 'thumb', type: 'button', title: 'Open photo', onclick: () => viewImage(api.media(a.id), `${dayLong(e.day)}${e.at ? ' · ' + e.at : ''}`) },
          el('img', { src: a.thumb, alt: 'Photo' }))
      : voicePlayer(a, api.media),
    el('button', { class: 'icon del', type: 'button', title: 'Remove', onclick: async () => {
      await api.remove('attachment', a.id);
      flash('Removed', { label: 'Undo', fn: async () => { await api.undo(); changed(ctx); } });
      changed(ctx);
    } }, '×'))));
}

/** + Photo and + Voice on an entry that already exists. */
function addMedia(e, ctx) {
  const put = async body => { try { await api.attach(e.id, body); changed(ctx); } catch (x) { flash(x.message); } };
  const pick = pictureInput(async files => { const photos = await shrinkAll(files); if (photos.length) put({ photos }); });
  return el('span', { class: 'row mid addmedia' },
    el('button', { class: 'btn plain sm', type: 'button', onclick: () => pick.click() }, '+ Photo'), pick,
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
    el('div', { class: 'what' }, text, attachments(e, ctx), el('div', { class: 'row mid' }, tagLinks(e.tags),
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
    body.append(text, diary ? el('div', { class: 'row mid' }, tagLinks(diary.tags), addMedia(diary, ctx)) : null,
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
    ctx.aside.append(el('a', { class: 'link', href: `/money/#/hours?p=month:${d}&add=${d}` }, 'Open in Money'));
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
  layout: [{ use: 'log.diary' }, { use: 'log.work', w: 12 }, { use: 'log.shifts', w: 12 }], panels };
