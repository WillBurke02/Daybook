// The shell: the bar along the top, the sidebar, and the page with its header.
// Knows nothing of any one app: start(app) is handed the app's pages and wording.
//
//   app = { name, title, home, pages: {id: page}, groups: [[heading, [ids]]], setup: [ids],
//           period: true for the period control in the page header, quick: [{label, href}],
//           file: () => [menu items], search: {kind: [label, row => hit]},
//           filterBar(render) for pages with filters: true, bar(ctx) above every page,
//           admin: {health: () => [elements]} }
//   page = { title, layout: [panel configs], panels: {id: panel}, ownPeriod, filters, narrow, head: false,
//            bar(render) for a control of its own in the page header }
import { api, suite, APP } from './api.js';
import { el, flash, writeVal } from './dom.js';
import { state, loadMeta, period, step, GRAINS } from './state.js';
import { today } from './format.js';
import { register, renderPage } from './layout.js';
import { applyText, watchText } from './text.js';
import { install, openMenu } from './commands.js';
import { themeCSS, applyMode, useTheme, modes } from './theme.js';
import { searchPage, changesPage, appbar, tabbar, banner, icon } from './pages.js';
import { sidebar } from './nav.js';
import * as admin from './admin.js';

const $ = s => document.querySelector(s);
let app, PAGES;
const main = () => $('main'), side = () => $('aside.side');

// ---- where we are ----
function parse() {
  const [path, q] = location.hash.slice(2).split('?');
  const parts = (path || app.home).split('/');
  return { parts, params: Object.fromEntries(new URLSearchParams(q || '')) };
}
export function go(page, params = {}) {
  const p = app.period ? { p: `${state.grain}:${state.anchor}`, ...params } : params;
  location.hash = `#/${page}?` + new URLSearchParams(p).toString();
}
const current = () => parse().parts.join('/');
const titleOf = id => state.meta.layouts.find(l => l.page === id.replace(/^p\//, ''))?.title || PAGES[id]?.title || id.replace(/^p\//, '');
const layoutOf = id => PAGES[id]?.layout;

// ---- the period: in the page header of an app that has one ----
let periodBox = null;
function makePeriod() {
  const grain = el('select', { class: 'sm grain', 'aria-label': 'Period length' }, GRAINS.map(g => el('option', { value: g.v }, g.label)));
  const jump = el('input', { class: 'jump', type: 'date', tabindex: '-1', 'aria-hidden': 'true' });
  const lbl = el('button', { class: 'lbl', type: 'button', title: 'Pick a date' });
  const page = () => parse().parts.join('/');
  const box = el('div', { class: 'period', role: 'group', 'aria-label': 'Period' },
    el('button', { class: 'icon prev', type: 'button', 'aria-label': 'Previous period', onclick: () => { state.anchor = step(-1); go(page()); } }, icon('left')),
    lbl, jump,
    el('button', { class: 'icon next', type: 'button', 'aria-label': 'Next period', onclick: () => { state.anchor = step(1); go(page()); } }, icon('right')),
    grain, el('button', { class: 'btn plain sm now', type: 'button', onclick: () => { state.anchor = today(); go(page()); } }, 'Today'));
  grain.addEventListener('change', () => { state.grain = grain.value; go(page()); });
  lbl.addEventListener('click', () => { jump.value = state.anchor; try { jump.showPicker(); } catch { jump.focus(); } });
  jump.addEventListener('change', () => { if (jump.value) { state.anchor = jump.value; go(page()); } });
  box.update = () => {
    lbl.textContent = period().label; grain.value = state.grain;
    box.querySelectorAll('.prev, .next').forEach(b => { b.disabled = state.grain === 'all'; });
  };
  return box;
}

/** The page's own header: its title (a page may retitle it), and its controls. */
function pageHead(title, mod) {
  const h1 = el('h1', {}, title), sub = el('div', { class: 'sub' });
  const ctl = el('div', { class: 'ctl' });
  if (app.period && !mod?.ownPeriod) { periodBox.update(); ctl.append(periodBox); }
  if (app.quick?.length && mod?.quick !== false)
    ctl.append(el('div', { class: 'quick' }, app.quick.map((q, i) => el('a', { class: 'btn sm' + (i ? ' plain' : ''), href: q.href }, q.label))));
  const head = el('div', { class: 'pagehead', hidden: mod?.head === false }, el('div', { class: 'ttl' }, h1, sub), ctl);
  head.set = (t, s) => { if (t != null) { h1.textContent = t; document.title = `${t} · ${app.title} · Daybook`; } sub.textContent = s || ''; head.hidden = false; };
  return head;
}

// ---- Customise and rewording ----
function editLayout() {
  state.editing = !state.editing;
  document.body.classList.toggle('editing', state.editing);
  $('.appbar .custom')?.setAttribute('aria-pressed', String(state.editing));
  render();
}
function editText() {
  const on = document.body.classList.toggle('texting');
  document.querySelector('.textbar')?.remove();
  if (on) document.body.append(el('div', { class: 'textbar', role: 'status' }, 'Click any heading, label or button to reword it.',
    el('button', { class: 'btn sm', type: 'button', onclick: editText }, 'Done')));
}
async function lock() { await suite.logout(); location.href = '/login'; }

function drawSide(name) {
  sidebar(side(), { app, current: name, titleOf, layoutOf, editing: state.editing, go, redraw: () => drawSide(name) });
}

let token = 0;
export async function render() {
  const { parts, params } = parse();
  if (params.p && app.period) {
    const [g, a] = params.p.split(':');
    if (GRAINS.some(x => x.v === g)) state.grain = g;
    if (/^\d{4}-\d{2}-\d{2}$/.test(a || '')) state.anchor = a;
  }
  writeVal('grain', state.grain);
  const name = parts[0] === 'p' ? 'p/' + parts[1] : (PAGES[parts[0]] || parts[0] === 'admin' ? parts[0] : app.home);
  const mine = ++token;
  const same = render.last === current();
  const keepScroll = same ? window.scrollY : 0;
  render.last = current();
  const m = main();
  // Redrawing the same page: hold its height until the panels are back, so the
  // browser has no reason to scroll you up while they load.
  const hold = () => { if (same) m.style.minHeight = m.offsetHeight + 'px'; };
  const release = async grid => {
    await Promise.race([grid?.ready, new Promise(r => setTimeout(r, 4000))]);
    if (mine !== token) return;
    m.style.minHeight = '';
    if (same && Math.abs(window.scrollY - keepScroll) > 2) window.scrollTo(0, keepScroll);
    const aim = params.panel && document.getElementById('p-' + params.panel);     // ?panel=x: a link to one panel
    if (aim) { aim.scrollIntoView({ behavior: 'smooth' }); aim.classList.add('lit'); setTimeout(() => aim.classList.remove('lit'), 1600); }
  };
  drawSide(name);
  document.body.classList.remove('nav');

  if (name === 'admin') {
    hold();
    m.className = '';
    m.replaceChildren(pageHead('Admin', { ownPeriod: true, quick: false }));
    document.title = `Admin · ${app.title} · Daybook`;
    await admin.render(m, { reload: render, app, pages: PAGES });
    release();
    return;
  }
  const mod = PAGES[name];
  const key = mod ? name : parts[1];               // a page you added is stored by its own name
  const saved = state.meta.layouts.find(l => l.page === key);
  const layout = saved ? JSON.parse(saved.panels) : mod ? mod.layout : null;
  if (!layout) { location.hash = '#/' + app.home; return; }
  if (name === 'search' && document.activeElement !== $('.find')) $('.find').value = params.q || '';
  const filters = mod?.filters && app.filterBar ? await app.filterBar(render) : null;
  if (mine !== token) return;
  const tagIds = state.filters.tag && mod?.filters
    ? new Set((await api.table('txn_tag', { tag_id: state.filters.tag })).map(r => r.txn_id)) : null;
  hold();
  const title = saved?.title || mod?.title || parts[1];
  const head = pageHead(title, mod);
  if (mod?.bar) {                                  // a page's own control (Annual leave's year), in its header
    const b = await mod.bar(render);
    if (mine !== token) return;
    head.querySelector('.ctl').prepend(b);
  }
  let widths = {};
  try { widths = JSON.parse(state.meta.settings.widths || '{}'); } catch { /* the default */ }
  m.className = (widths[key] || (mod?.narrow ? 'narrow' : 'full')) === 'narrow' ? 'narrow' : '';
  m.replaceChildren(head);
  document.title = `${title} · ${app.title} · Daybook`;
  const base = {
    period: period(), filters: state.filters, params, meta: state.meta, tagIds, app,
    reload: render, go, pageTitle: head.set, pageHead: head, pages: PAGES, titleOf,
    redraw: working => {
      const y = window.scrollY;
      m.style.minHeight = m.offsetHeight + 'px';
      m.querySelectorAll('.grid, .pagebar').forEach(x => x.remove());
      renderPage(m, key, working, base).ready.then(() => { m.style.minHeight = ''; window.scrollTo(0, y); });
    },
  };
  if (app.bar) m.append(await app.bar(base));
  if (filters) m.append(filters);
  const grid = renderPage(m, key, layout, base);
  if (!same) window.scrollTo(0, 0);
  release(grid);
}

export async function start(theApp) {
  app = theApp;
  PAGES = { ...app.pages, search: searchPage(app), changes: changesPage };
  Object.values(PAGES).forEach(m => register(m.panels || {}));
  document.body.dataset.app = APP;
  document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', `/assets/icons/${APP}-apple.png`);
  try { await loadMeta(); } catch (e) {
    main().append(el('p', { class: 'err' }, 'Cannot reach the Daybook server: ' + e.message)); return;
  }
  appbar($('.appbar'), state.meta.apps, APP, { find: `Search ${app.title}…`, undo: true, custom: 'Customise' });
  tabbar($('.tabbar'), state.meta.apps, APP);
  if (app.period) periodBox = makePeriod();
  $('.appbar .undo').addEventListener('click', async () => {
    try { const r = await api.undo(); flash(r.undid); render(); } catch (e) { flash(e.message); }
  });
  $('.appbar .custom').addEventListener('click', editLayout);
  $('.appbar .more').addEventListener('click', e => openMenu(e.currentTarget));
  $('.appbar .burger').addEventListener('click', () => document.body.classList.toggle('nav'));
  // Search as you type; / jumps to the box from anywhere that is not a text box.
  const find = $('.find');
  let typing;
  const seek = () => { const q = find.value.trim(); if (q || parse().parts[0] === 'search') location.hash = '#/search?' + new URLSearchParams({ q }); };
  find.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(seek, 300); });
  find.addEventListener('keydown', e => {
    if (e.key === 'Enter') { clearTimeout(typing); seek(); }
    if (e.key === 'Escape') find.blur();
  });
  addEventListener('keydown', e => {
    if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]')) { e.preventDefault(); find.focus(); find.select(); }
  });
  document.addEventListener('click', e => {             // a page picked on a phone closes the drawer
    if (e.target.closest('aside.side a[href^="#/"]')) document.body.classList.remove('nav');
    else if (document.body.classList.contains('nav') && !e.target.closest('aside.side, .burger')) document.body.classList.remove('nav');
  });
  addEventListener('hashchange', render);
  themeCSS();
  applyMode(state.meta.settings.default_mode || 'system');
  banner(state.meta);
  const dbn = $('.dbname');                  // which database, when it is not the usual one
  dbn.hidden = !state.meta.db || state.meta.db === state.meta.db_usual;
  dbn.textContent = (state.meta.db || '').replace(/\.(db|sqlite3?)$/i, '');
  dbn.onclick = () => { location.hash = '#/admin'; };
  install({ app, go, render, page: () => parse().parts.join('/') || app.home, useTheme, modes, groups: () => app.groups,
            titleOf, editLayout, editText, lock, focusFind: () => { find.focus(); find.select(); },
            fold: shut => document.querySelectorAll('.grid > .panel').forEach(p => p.classList.toggle('shut', shut)) });
  watchText();
  applyText(document.body);
  render();
}
