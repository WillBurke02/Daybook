// Home: the start screen, three ways, switched at the top (and kept: one choice for a phone, one for a bigger screen).
//   Today     a briefing: the day in a line, the figures, what is to do (tick it off here), the box to add to Log,
//             so far today, the week's hours, on this day
//   Tiles     each app's figures and lists as tiles, arranged like a phone's widgets: in any order, wide or small, or hidden
//   Timeline  the week along the top; the day as a line of hours with your shift down the side and a line for now
// Everything comes from each app's /api/home (figures, lists, a ring, a quick box, links, on this day, photos) and
// the suite's /api/days (each app's day(db, d): shifts, bills, payday, days off, entries, reminders, commits, the
// review), so Home knows kinds of things, not apps; an app that is missing or failing only loses its own part.
import { suite, appApi } from './core/api.js';
import { el, flash, seg } from './core/dom.js';
import { state } from './core/state.js';
import { dayLong, today, addDays, mondayOf, dow } from './core/format.js';
import { themeCSS, applyMode, useTheme, modes } from './core/theme.js';
import { appbar, tabbar, banner, icon } from './core/pages.js';
import { popup } from './ui/menu.js';
import { ring } from './ui/ring.js';

const $ = s => document.querySelector(s);
const VIEWS = [{ v: 'today', label: 'Today' }, { v: 'tiles', label: 'Tiles' }, { v: 'timeline', label: 'Timeline' }];
const TODO = new Set(['reminder', 'bill', 'review']), ALLDAY = new Set(['bill', 'payday', 'off']), SOFAR = new Set(['entry', 'diary', 'github']);
let arranging = false, picked = null;            // picked: the day the timeline shows
let homes = [], week = {};                       // [{app, data}] from each app's home; {date: [item]} for this week

const phone = () => matchMedia('(max-width: 700px)').matches;
const prefs = () => { try { return JSON.parse(state.meta.settings.home || '{}'); } catch { return {}; } };
async function savePrefs(p) {
  state.meta.settings.home = JSON.stringify(p);
  try { await suite.save('setting', { key: 'home', value: state.meta.settings.home }); } catch (e) { flash(e.message); }
}
const viewKey = () => phone() ? 'view_phone' : 'view';
const view = () => prefs()[viewKey()] || 'today';

// ---- pieces every view uses ------------------------------------------------------------------
const link = (app, href) => href ? `/${app}/${href}` : null;
const dot = app => el('span', { class: `adot a-${app}`, 'aria-hidden': 'true' });
const box = (title, ...kids) => el('section', { class: 'hbox' }, title ? el('h2', {}, title) : null, ...kids);
const hm = () => new Date().toTimeString().slice(0, 5);
const stamp = () => `${today()} ${hm()}`;
const itemsOf = d => week[d] || [];
const byTime = (a, b) => (a.at || '99:99').localeCompare(b.at || '99:99');
const hoursOf = d => itemsOf(d).filter(i => i.kind === 'shift').reduce((n, i) => n + (i.hours || 0), 0);
const allFigs = () => homes.flatMap(h => (h.data.figures || []).map(f => ({ f, app: h.app.name })));
const goTo = it => it.url ? { href: it.url, target: '_blank', rel: 'noopener' } : { href: link(it.app, it.href) };

const fig = (f, app) => el(f.href ? 'a' : 'div', { class: 'hfig' + (f.href ? ' go' : ''), href: link(app, f.href) },
  el('small', {}, dot(app), f.label), el('b', { class: 'num ' + (f.cls || '') }, f.value), f.sub ? el('em', {}, f.sub) : null);

/** Tick a reminder or a bill off (or a reminder back on), through its own app's API. */
async function tick(it) {
  const t = it.done ? it.untick : it.tick;
  if (!t) return;
  const row = Object.fromEntries(Object.entries(t.row).map(([k, v]) => [k, v === '@now' ? stamp() : v]));
  try { await appApi(it.app).save(t.table, row); await load(); } catch (e) { flash(e.message); }
}
const tickBtn = it => it.tick ? el('button', { class: 'htick', type: 'button', 'aria-pressed': String(!!it.done),
  title: it.done ? 'Not done after all' : 'Done', 'aria-label': `${it.text}: ${it.done ? 'done' : 'not done'}`, onclick: () => tick(it) }, it.done ? '✓' : '')
  : el('span', { class: 'htick none', 'aria-hidden': 'true' });

const todoList = items => items.length
  ? el('ul', { class: 'todo' }, items.map(it => el('li', { class: [it.done && 'done', it.late && 'late'].filter(Boolean).join(' ') || null },
      tickBtn(it), el('a', goTo(it), it.text), el('span', { class: 'num muted small' }, it.late ? 'earlier' : it.at || it.sub || ''), dot(it.app))))
  : el('p', { class: 'note' }, 'Nothing to do.');
const todoOf = d => itemsOf(d).filter(i => TODO.has(i.kind)).sort((a, b) => a.done - b.done || byTime(a, b));

const sofarList = items => items.length
  ? el('ul', { class: 'sofar' }, items.map(it => el('li', {}, el('span', { class: 'num muted small' }, it.at || (it.kind === 'diary' ? 'diary' : '')),
      el('a', goTo(it), it.text, it.sub ? el('span', { class: 'muted small' }, ` · ${it.sub}`) : null),
      it.thumb ? el('img', { src: it.thumb, alt: '', loading: 'lazy' }) : el('span'))))
  : el('p', { class: 'note' }, 'Nothing yet today.');

function quickBox(h) {
  const q = h.data.quick, text = el('textarea', { rows: 2, placeholder: q.placeholder, 'aria-label': q.placeholder });
  const add = async () => {
    if (!text.value.trim()) return;
    try { await appApi(h.app.name).send(q.post, { text: text.value.trim() }); text.value = ''; flash(q.done || 'Added'); load(); }
    catch (e) { flash(e.message); }
  };
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(); });
  return el('div', { class: 'quickbox' }, text, el('div', { class: 'row' },
    el('a', { class: 'btn plain sm', href: `/${h.app.name}/` }, 'Photo or voice'), el('button', { class: 'btn sm', type: 'button', onclick: add }, 'Add')));
}

const ringBlock = (h, links = 3) => el('div', { class: 'hring' }, ring(h.data.ring.done, h.data.ring.goal, 78),
  el('div', { class: 'stack' }, el('small', { class: 'muted' }, h.data.ring.label),
    (h.data.links || []).slice(0, links).map((l, i) => el('a', { class: 'btn sm' + (i ? ' plain' : ''), href: link(h.app.name, l.href) }, l.label))));

const memoryBlock = h => { const m = h.data.memory; return el('a', { class: 'hmem', href: link(h.app.name, m.href) },
  m.thumb ? el('img', { src: m.thumb, alt: '' }) : null, el('span', {}, el('small', { class: 'muted' }, `On this day · ${m.year}`), el('span', { class: 'w' }, m.text))); };

const photosBlock = h => el('div', { class: 'hphotos' }, h.data.photos.slice(0, 8).map(p => el('a', { href: link(h.app.name, p.href) }, el('img', { src: p.thumb, alt: '', loading: 'lazy' }))));

const listBlock = h => el('div', { class: 'hlist' }, h.data.items.length
  ? h.data.items.map(i => el(i.href ? 'a' : 'div', { class: 'item' + (i.href ? ' go' : ''), href: link(h.app.name, i.href) },
      el('span', { class: 'd num' }, i.when || ''), el('span', { class: 'w' }, i.text), el('span', { class: 'num' }, i.value || '')))
  : el('p', { class: 'note' }, h.data.items_empty || 'Nothing.'));

/** The week's hours worked, a bar a day. */
function weekBars() {
  const days = Object.keys(week), max = Math.max(8, ...days.map(hoursOf));
  return el('div', {}, el('div', { class: 'wbars' }, days.map(d => el('span', { class: d === today() ? 'today' : null, title: `${dow(d)}: ${+hoursOf(d).toFixed(2)}h`,
    style: `height:${Math.max(3, hoursOf(d) / max * 100)}%` }))),
    el('div', { class: 'wdays' }, days.map(d => el('span', {}, dow(d).slice(0, 1)))),
    el('p', { class: 'note' }, `${+days.reduce((n, d) => n + hoursOf(d), 0).toFixed(2)}h this week`));
}

/** The day in a line: the shift, payday this week, a day off, how much there is to do. */
function summary() {
  const t = itemsOf(today()), bits = [], sh = t.filter(i => i.kind === 'shift').sort(byTime);
  if (sh.length) bits.push(`Shift ${sh[0].at} to ${sh.at(-1).end}`);
  const off = t.find(i => i.kind === 'off');
  if (off) bits.push(off.text);
  const pay = Object.keys(week).find(d => d >= today() && itemsOf(d).some(i => i.kind === 'payday'));
  if (pay) bits.push(pay === today() ? 'payday today' : `payday ${new Date(pay + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' })}`);
  const n = todoOf(today()).filter(i => !i.done).length;
  bits.push(n ? `${n} thing${n === 1 ? '' : 's'} to do` : 'nothing to do');
  return bits.join(' · ');
}

const quickApp = () => homes.find(h => h.data.quick);
const ringApp = () => homes.find(h => h.data.ring);
const memApp = () => homes.find(h => h.data.memory);
const photoApp = () => homes.find(h => h.data.photos?.length);

// ---- A: Today ---------------------------------------------------------------------------------
function viewToday() {
  const t = itemsOf(today()), log = quickApp(), learn = ringApp(), mem = memApp();
  const col = (...xs) => el('div', { class: 'hcol' }, xs.filter(Boolean));
  return el('div', { class: 'vtoday' },
    el('div', { class: 'hfigs' }, allFigs().map(({ f, app }) => fig(f, app))),
    el('div', { class: 'hcols' },
      col(box('Today', todoList(todoOf(today()))), log ? box('Add to today', quickBox(log)) : null),
      col(box('So far today', sofarList(t.filter(i => SOFAR.has(i.kind)).sort(byTime))), Object.keys(week).length ? box('This week', weekBars()) : null),
      col(learn ? box(learn.app.title, ringBlock(learn)) : null, mem ? box(null, memoryBlock(mem)) : null,
        ...homes.filter(h => h.data.items && h !== log).map(h => box(h.data.items_title || h.app.title, listBlock(h))))));
}

// ---- B: Tiles ---------------------------------------------------------------------------------
// ponytail: a first order that suits Daybook's own apps; any other tile goes after them
const FIRST = ['money:Payday', 'money:Hours this week', 'log:quick', 'learn:ring', 'learn:Due', 'todo', 'money:Safe to spend', 'github', 'log:photos', 'log:memory'];
function tiles() {
  const out = [], t = itemsOf(today()), add = (id, wide, title, app, body) => out.push({ id, wide, title, app, body });
  for (const h of homes) {
    const a = h.app.name;
    (h.data.figures || []).forEach(f => add(`${a}:${f.label}`, false, null, a, fig(f, a)));
    if (h.data.ring) add(`${a}:ring`, false, h.app.title, a, ringBlock(h, 1));
    if (h.data.quick) add(`${a}:quick`, true, h.app.title, a, quickBox(h));
    if (h.data.items && !h.data.quick) add(`${a}:items`, true, h.data.items_title || h.app.title, a, listBlock(h));
    if (h.data.photos?.length) add(`${a}:photos`, true, 'Latest photos', a, photosBlock(h));
    if (h.data.memory) add(`${a}:memory`, false, null, a, memoryBlock(h));
  }
  add('todo', true, 'Today', null, todoList(todoOf(today())));
  const gh = t.filter(i => i.kind === 'github');
  if (gh.length) add('github', false, 'GitHub today', 'log', el('div', { class: 'hfig' }, el('b', { class: 'num' }, String(gh.length)),
    el('em', {}, [...new Set(gh.map(i => i.sub))].join(', '))));
  return out;
}
function viewTiles() {
  const p = prefs(), tp = p.tiles || {}, order = tp.order || FIRST, size = tp.size || {}, hidden = new Set(tp.hidden || []);
  const all = tiles().sort((a, b) => (order.indexOf(a.id) + 1 || 999) - (order.indexOf(b.id) + 1 || 999));
  const shown = all.filter(x => arranging || !hidden.has(x.id));
  const save = async (fn) => { const next = { order: all.map(x => x.id), size: { ...size }, hidden: [...hidden] }; fn(next); await savePrefs({ ...prefs(), tiles: next }); draw(); };
  const move = (id, by) => save(n => { const i = n.order.indexOf(id), j = Math.max(0, Math.min(n.order.length - 1, i + by)); n.order.splice(j, 0, n.order.splice(i, 1)[0]); });
  return el('div', { class: 'tiles2' }, shown.length ? shown.map(x => {
    const wide = size[x.id] ? size[x.id] === 'wide' : x.wide, off = hidden.has(x.id);
    return el('section', { class: `tile${wide ? ' wide' : ''}${off ? ' off' : ''}`, data: { id: x.id } },
      x.title ? el('div', { class: 'tt' }, x.app ? dot(x.app) : null, x.title) : null, x.body,
      arranging ? el('div', { class: 'tools' },
        el('button', { class: 'icon', type: 'button', 'aria-label': 'Earlier', title: 'Earlier', onclick: () => move(x.id, -1) }, icon('left')),
        el('button', { class: 'icon', type: 'button', 'aria-label': 'Later', title: 'Later', onclick: () => move(x.id, 1) }, icon('right')),
        el('button', { class: 'btn plain sm', type: 'button', 'aria-pressed': String(wide), onclick: () => save(n => { n.size[x.id] = wide ? 'small' : 'wide'; }) }, 'Wide'),
        el('button', { class: 'icon', type: 'button', 'aria-label': off ? 'Show' : 'Hide', title: off ? 'Show this tile' : 'Hide this tile',
          onclick: () => save(n => { n.hidden = off ? n.hidden.filter(h => h !== x.id) : [...n.hidden, x.id]; }) }, icon(off ? 'eyeoff' : 'eye'))) : null);
  }) : el('p', { class: 'note' }, 'All tiles are hidden.'));
}

// ---- C: Timeline ------------------------------------------------------------------------------
function tlCard(it) {
  if (it.kind === 'reminder') return el('div', { class: 'tl-card reminder' + (it.done ? ' done' : '') }, tickBtn(it), el('a', { class: 't', ...goTo(it) }, it.text));
  if (it.kind === 'review') return el('div', { class: 'tl-card' }, el('span', { class: 't' }, `${it.text} · ${it.sub}`), el('a', { class: 'btn sm', href: link(it.app, it.href) }, 'Start'));
  return el('a', { class: 'tl-card', ...goTo(it) }, el('span', { class: 't' }, it.text, it.sub ? el('span', { class: 'muted small' }, ` · ${it.sub}`) : null),
    it.thumb ? el('img', { src: it.thumb, alt: '' }) : null);
}
function viewTimeline() {
  const days = Object.keys(week), d = days.includes(picked) ? picked : today(), xs = itemsOf(d);
  const strip = el('div', { class: 'wstrip', role: 'group', 'aria-label': 'This week' }, days.map(x => {
    const its = itemsOf(x), h = hoursOf(x);
    const mark = its.some(i => i.kind === 'payday') ? 'payday' : h ? `${+h.toFixed(1)}h` : its.some(i => i.kind === 'reminder' && !i.done) ? 'reminder' : '';
    return el('button', { type: 'button', class: x === today() ? 'today' : null, 'aria-pressed': String(x === d), 'aria-label': `${dayLong(x)}${mark ? ', ' + mark : ''}`,
      onclick: () => { picked = x; draw(); } }, el('small', {}, dow(x)), el('b', {}, String(+x.slice(8))), el('em', {}, mark));
  }));
  // a shift is two rows (it starts, it ends) and the band between; the rest at its time; a line for now
  const shifts = xs.filter(i => i.kind === 'shift'), rows = [];
  for (const i of xs) {
    if (i.kind === 'shift') rows.push({ at: i.at, it: i, edge: 'starts' }, { at: i.end, it: i, edge: 'ends' });
    else if (i.at && !ALLDAY.has(i.kind)) rows.push({ at: i.at, it: i });
  }
  if (d === today()) rows.push({ at: hm(), now: true });
  rows.sort((a, b) => a.at.localeCompare(b.at) || (a.now ? 1 : 0) - (b.now ? 1 : 0));
  const inShift = at => shifts.some(s => s.at <= at && at <= s.end);
  const line = el('ol', { class: 'dayline' }, rows.map(r => r.now
    ? el('li', { class: 'now' + (inShift(r.at) ? ' shift' : '') }, el('span', { class: 'num' }, r.at), el('span', { class: 'rail' }), el('span', { class: 'bar', 'aria-label': 'Now' }))
    : el('li', { class: inShift(r.at) ? 'shift' : null }, el('span', { class: 'num muted' }, r.at), el('span', { class: 'rail' }),
        r.edge ? el('span', { class: 'tl-edge' }, el('b', {}, `${r.it.text} ${r.edge}`), r.edge === 'ends' ? ` · ${+(r.it.hours || 0).toFixed(2)}h` : ` · until ${r.it.end}`)
          : tlCard(r.it))));
  const anytime = xs.filter(i => !i.at && !ALLDAY.has(i.kind) && i.kind !== 'shift');
  const log = quickApp(), learn = ringApp(), mem = memApp();
  return el('div', { class: 'vtimeline' },
    el('div', { class: 'main' }, strip,
      box(null, el('div', { class: 'tlhead' }, el('h2', {}, new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })),
          el('div', { class: 'chips' }, xs.filter(i => ALLDAY.has(i.kind)).map(i => el('a', { class: `chip a-${i.app}`, href: link(i.app, i.href) }, i.text)))),
        d === today() && log ? quickBox(log) : null,
        anytime.length ? el('div', { class: 'anytime' }, el('h3', {}, 'Any time'), anytime.map(tlCard)) : null,
        rows.length ? line : el('p', { class: 'note' }, 'Nothing scheduled.'))),
    el('div', { class: 'side' }, box('This week', el('div', { class: 'hfigs col' }, allFigs().map(({ f, app }) => fig(f, app)))),
      learn ? box(learn.app.title, ringBlock(learn)) : null, mem ? box(null, memoryBlock(mem)) : null));
}

// ---- drawing ----------------------------------------------------------------------------------
function draw() {
  const v = view();
  $('.appbar .custom').hidden = v !== 'tiles';
  if (v !== 'tiles' && arranging) { arranging = false; document.body.classList.remove('arranging'); }
  $('.homehead .summary').textContent = summary();
  $('.views').replaceChildren(v === 'tiles' ? viewTiles() : v === 'timeline' ? viewTimeline() : viewToday());
  $('.views').dataset.view = v;
}

async function load() {
  const mon = mondayOf(today());
  [homes, week] = await Promise.all([
    Promise.all(state.meta.apps.map(async a => ({ app: a, data: await appApi(a.name).home().catch(e => ({ error: e.message })) }))),
    suite.get(`days?from=${mon}&to=${addDays(mon, 6)}`).then(r => r.days).catch(() => ({})),
  ]);
  draw();
}

// ---- first run: five things that make Daybook yours, each ticked from what is really there --------------
async function setup() {
  const box = $('.setupbox'), p = prefs();
  if (p.setup === 'hidden') return box.replaceChildren();
  const has = (app, t) => appApi(app).table(t, { limit: 1 }).then(r => r.length > 0).catch(() => null);   // null: app not here
  // asked all at once: one round trip to the Pi, not four
  const [pay, accounts, shifts, answers] = await Promise.all([has('money', 'pay_rate'), has('money', 'account'), has('money', 'shift'), has('learn', 'answer')]);
  const steps = [
    ['Set your own password', 'then the phone and the Pi can open Daybook', !state.meta.password_default, '/admin'],
    ['Add your pay', 'salary from a date: payslip checks and overtime come from it', pay, '/hours/#/pay?panel=pay.rates'],
    ['Add your bank accounts', 'then import a statement from each', accounts, '/spending/#/settings?panel=settings.accounts'],
    ['Log some hours', 'or import them from Clockify', shifts, '/hours/#/hours?add=today'],
    ['Find your level in Learn', 'about 10 minutes a subject, so lessons start where you are', answers, '/learn/#/calibrate'],
  ].filter(x => x[2] !== null);
  const done = steps.filter(x => x[2]).length;
  if (done === steps.length) return box.replaceChildren();
  box.replaceChildren(el('section', { class: 'hcard wide setup' },
    el('header', {}, el('strong', { class: 'name' }, 'Set up Daybook'), el('span', { class: 'muted small' }, `${done} of ${steps.length} done`),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn plain sm', type: 'button', onclick: async () => { await savePrefs({ ...prefs(), setup: 'hidden' }); setup(); } }, 'Hide')),
    el('ol', { class: 'body steps' }, steps.map(([what, why, ok, href]) => el('li', { class: ok ? 'done' : '' },
      el('span', { class: 'tick', 'aria-hidden': 'true' }, ok ? '✓' : '○'),
      el('span', {}, el('strong', {}, what), el('span', { class: 'muted small' }, ` ${why}`), ok ? el('span', { class: 'sr-only' }, ' (done)') : null),
      ok ? null : el('a', { class: 'btn sm', href }, 'Do it'))))));
}

const hello = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

async function start() {
  state.meta = await suite.meta();
  themeCSS();
  applyMode(state.meta.settings.default_mode || 'system');
  appbar($('.appbar'), state.meta.doors, 'home', { custom: 'Arrange' });
  tabbar($('.tabbar'), state.meta.doors, 'home');
  $('.appbar .burger').hidden = true;
  const admin = (panel = '') => `/${state.meta.apps[0].name}/#/admin${panel ? '?panel=' + panel : ''}`;
  $('.appbar .more').before(el('a', { class: 'btn plain sm homecog', href: admin(), title: 'Password, keys, the phone, GitHub, backups' }, icon('cog'), el('span', {}, 'Admin')));
  $('.appbar .custom').addEventListener('click', e => {
    arranging = !arranging;
    e.currentTarget.setAttribute('aria-pressed', String(arranging));
    document.body.classList.toggle('arranging', arranging);
    draw();
  });
  $('.appbar .more').addEventListener('click', e => {
    const r = e.currentTarget.getBoundingClientRect();
    popup([{ label: 'Theme', sub: modes().map(m => ({ label: m.label, on: (document.documentElement.dataset.mode || 'system') === m.v,
             fn: () => useTheme(m.v) })) },
           { label: 'Home shows', sub: VIEWS.map(o => ({ label: o.label, on: view() === o.v, fn: () => pick(o.v) })) },
           '-', ...state.meta.doors.map(a => ({ label: `Open ${a.title}`, fn: () => { location.href = `/${a.name}/`; } })),
           '-', { label: 'Admin', fn: () => { location.href = admin(); } },
           { label: 'Set up the phone (app, widget, shortcuts)', fn: () => { location.href = admin('phone-and-calendar'); } },
           { label: 'Connect GitHub', fn: () => { location.href = admin('github'); } },
           '-', { label: 'Lock (sign out here)', fn: async () => { await suite.logout(); location.href = '/login'; } }],
          r.right - 240, r.bottom + 4);
  });
  // the switch: Today, Tiles or Timeline, kept (a phone's choice and a bigger screen's apart)
  const sw = seg(VIEWS, view(), v => pick(v));
  sw.setAttribute('aria-label', 'Home shows');
  sw.classList.add('vswitch');
  $('.homehead').append(sw);
  const pick = async v => {
    sw.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    await savePrefs({ ...prefs(), [viewKey()]: v });
    draw();
  };
  $('.today').textContent = dayLong(today());
  $('.hello').textContent = hello();
  document.title = 'Home · Daybook';
  banner(state.meta);
  await Promise.all([setup(), load()]);
  addEventListener('focus', () => { if (!arranging) { setup(); load(); } });     // back to the window: fresh figures
}
start();
