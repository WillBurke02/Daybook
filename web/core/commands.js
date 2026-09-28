// What the menus do: the menu button on the bar (File, Edit, View, Go, Help),
// the right-click menu, and the keys. The router hands over what it knows (shell),
// including the app, whose own File items come first.
import { api, APP } from './api.js';
import { el, flash, dialog, download } from './dom.js';
import { state, GRAINS, step } from './state.js';
import { today, toNumber } from './format.js';
import { popup, closeMenus } from '../ui/menu.js';

let app;
const typing = t => t?.closest?.('input, textarea, select, [contenteditable]');
const short = s => s.length > 28 ? s.slice(0, 27) + '…' : s;

/** Copy text; the clipboard API where it is allowed, the old way where it is not. */
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = el('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
  flash('Copied');
}

const find = q => { location.hash = '#/search?' + new URLSearchParams({ q }); };
const undo = async () => { try { const r = await api.undo(); flash(r.undid); app.render(); } catch (e) { flash(e.message); } };
const setPeriod = (grain, anchor = state.anchor) => { state.grain = grain; state.anchor = anchor; app.go(app.page()); };
const toPanel = (page, id) => { location.hash = `#/${page}`; setTimeout(() => document.getElementById('p-' + id)?.scrollIntoView({ behavior: 'smooth' }), 700); };

// --- tables and charts as data --------------------------------------------------
const cellText = c => [...c.querySelectorAll('input, select')].map(i => i.tagName === 'SELECT' ? i.selectedOptions[0]?.text : i.value).join(' ').trim()
  || [...c.childNodes].filter(n => !(n.nodeType === 1 && n.matches('button, .fx-tools, .fx-grip'))).map(n => n.textContent).join('').trim();
const rowsOf = table => [...table.rows].filter(r => !r.classList.contains('draft')).map(r => [...r.cells].map(cellText));
const tsv = rows => rows.map(r => r.map(v => v.replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
const csv = rows => rows.map(r => r.map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n');
const nameOf = panel => (panel?.querySelector('h2')?.textContent || 'table').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').toLowerCase();

/** A chart as a PNG: its colours are variables, so they are written in before it leaves the page. */
async function chartPicture(svg) {
  const clone = svg.cloneNode(true), from = [svg, ...svg.querySelectorAll('*')], to = [clone, ...clone.querySelectorAll('*')];
  from.forEach((n, i) => { const cs = getComputedStyle(n);
    for (const k of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight']) to[i].style.setProperty(k, cs.getPropertyValue(k)); });
  const { width, height } = svg.getBoundingClientRect();
  Object.entries({ xmlns: 'http://www.w3.org/2000/svg', width, height }).forEach(([k, v]) => clone.setAttribute(k, v));
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  await img.decode();
  const c = el('canvas', { width: Math.round(width * 2), height: Math.round(height * 2) }), g = c.getContext('2d');
  g.fillStyle = getComputedStyle(svg.closest('.panel') || document.body).backgroundColor;
  g.fillRect(0, 0, c.width, c.height); g.scale(2, 2); g.drawImage(img, 0, 0);
  return new Promise(r => c.toBlob(r, 'image/png'));
}

// --- the right-click menu -------------------------------------------------------
function contextItems(e) {
  const t = e.target, sel = String(getSelection()).trim();
  const field = t.closest('input, textarea'), td = t.closest('td, th'), tr = t.closest('tr'), table = t.closest('table');
  const panel = t.closest('.grid > .panel'), link = t.closest('a[href^="#/"]'), svg = t.closest('.chart svg');
  const row = tr?._row, act = tr?._act, items = [...(tr?._menu?.() || [])];
  if (field) items.push(
    { label: 'Cut', key: 'Ctrl+X', off: field.selectionStart === field.selectionEnd, fn: () => { field.focus(); document.execCommand('cut'); } },
    { label: 'Copy', key: 'Ctrl+C', fn: () => copy(field.value.slice(field.selectionStart, field.selectionEnd) || field.value) },
    { label: 'Paste', key: 'Ctrl+V', fn: async () => {
      try { const text = await navigator.clipboard.readText(); field.focus(); field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
            field.dispatchEvent(new Event('input', { bubbles: true })); }
      catch { flash('Press Ctrl+V to paste here'); } } },
    { label: 'Select all', key: 'Ctrl+A', fn: () => field.select() }, '-');
  else if (sel) items.push({ label: 'Copy', key: 'Ctrl+C', fn: () => copy(sel) }, { label: `Search for “${short(sel)}”`, fn: () => find(sel) }, '-');
  if (act) items.push(...(act.extra?.(row) || []), { label: 'Duplicate this row', fn: act.duplicate }, { label: 'Delete this row', fn: act.remove }, '-');
  if (row) {
    const payee = row.merchant || row.payee;
    if (payee) items.push({ label: `Everything from ${short(String(payee))}`, fn: () => find(String(payee)) });
    if (row.amount != null && toNumber(row.amount)) items.push({ label: `Other amounts of £${Math.abs(toNumber(row.amount)).toFixed(2)}`, fn: () => find(Math.abs(toNumber(row.amount)).toFixed(2)) });
  }
  if (td && table && !field) {
    const text = cellText(td);
    items.push('-', { label: 'Copy cell', off: !text, fn: () => copy(text) },
      { label: 'Copy row', fn: () => copy(tsv([[...tr.cells].map(cellText)])) },
      { label: 'Copy table, for Excel', fn: () => copy(tsv(rowsOf(table))) },
      { label: 'Save table as CSV', fn: () => download(`${nameOf(panel)}.csv`, csv(rowsOf(table))) });
    if (text && text.length < 40 && !/^[£\d,.:\s×+-]+$/.test(text) && !sel) items.push({ label: `Search for “${short(text)}”`, fn: () => find(text) });
  }
  if (svg) items.push('-',
    { label: 'Copy chart as a picture', fn: async () => {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': await chartPicture(svg) })]); flash('Chart copied'); }
      catch { flash('This browser will not copy pictures; use Save instead'); } } },
    { label: 'Save chart as a picture', fn: async () => {
      const a = el('a', { href: URL.createObjectURL(await chartPicture(svg)), download: `${nameOf(panel)}.png` });
      document.body.append(a); a.click(); a.remove(); } });
  if (link) items.push('-', { label: 'Open in a new window', fn: () => open(link.href, '_blank', 'popup,width=1320,height=900') });
  if (panel) items.push('-',
    { label: 'Refresh this panel', fn: () => panel.refresh?.() },
    { label: panel.classList.contains('shut') ? 'Unfold this panel' : 'Fold this panel', fn: () => { if (!state.editing) panel.querySelector('h2').click(); } },
    { label: state.editing ? 'Stop editing the layout' : 'Edit this page’s layout', fn: app.editLayout });
  items.push('-', { label: 'Undo', key: 'Ctrl+Z', fn: undo }, { label: 'Search…', key: '/', fn: app.focusFind },
    { label: 'Back', key: 'Alt+←', fn: () => history.back() }, { label: 'Refresh page', key: 'F5', fn: app.render },
    '-', { label: 'Shift+right-click: the browser’s own menu', off: true });
  return items;
}

// --- the bar ----------------------------------------------------------------------
const MENUS = () => [
  { label: 'File', items: () => [
    ...(app.app.file?.(app) || []),
    '-',
    { label: 'Print this page', key: 'Ctrl+P', fn: () => print() },
    '-',
    { label: 'Switch database…', fn: () => { location.hash = '#/admin'; } },
    { label: 'Back up now', fn: async () => { const r = await api.admin.backup(); flash(`Saved ${r.name}`); } },
    { label: `Download ${app.app.title}’s database`, fn: () => { location.href = api.admin.download(); } },
    '-',
    { label: 'Lock (sign out here)', fn: app.lock },
  ] },
  { label: 'Edit', items: () => [
    { label: 'Undo', key: 'Ctrl+Z', fn: undo },
    { label: 'Change history', fn: () => app.go('changes') },
    '-',
    { label: 'Search…', key: '/', fn: app.focusFind },
    { label: 'Search every app…', fn: () => app.go('search', { q: document.querySelector('.find')?.value || '', all: 1 }) },
    '-',
    { label: 'Customise this page', on: state.editing, fn: app.editLayout },
    { label: 'Reword the labels', on: document.body.classList.contains('texting'), fn: app.editText },
    ...(app.app.setup || []).map(id => ({ label: app.titleOf(id), fn: () => app.go(id) })),
  ] },
  { label: 'View', items: () => [
    { label: 'Theme', sub: app.modes().map(m => ({ label: m.label, on: (document.documentElement.dataset.mode || 'system') === m.v,
      fn: async () => { await app.useTheme(m.v); app.render(); } })) },
    ...(app.app.period ? [
      { label: 'Period', sub: GRAINS.map(g => ({ label: g.label, on: state.grain === g.v, fn: () => setPeriod(g.v) })) },
      { label: 'Previous period', key: '[', fn: () => setPeriod(state.grain, step(-1)) },
      { label: 'Next period', key: ']', fn: () => setPeriod(state.grain, step(1)) },
      { label: 'Today', key: 'T', fn: () => setPeriod(state.grain, today()) }] : []),
    '-',
    { label: 'Fold every panel', fn: () => app.fold(true) },
    { label: 'Unfold every panel', fn: () => app.fold(false) },
    '-',
    { label: 'Refresh', key: 'F5', fn: app.render },
    { label: 'Full screen', key: 'F11', on: !!document.fullscreenElement,
      fn: () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen() },
  ] },
  { label: 'Go', items: () => [
    { label: 'Back', key: 'Alt+←', fn: () => history.back() }, { label: 'Forward', key: 'Alt+→', fn: () => history.forward() },
    ...app.groups().flatMap(([group, ids]) => ['-', group ? { head: group } : null,
      ...ids.map(id => ({ label: app.titleOf(id), on: app.page() === id, fn: () => app.go(id) }))]),
    '-', { head: 'Apps' }, { label: 'Home', fn: () => { location.href = '/'; } },
    ...state.meta.apps.filter(a => a.name !== APP).map(a => ({ label: a.title, fn: () => { location.href = `/${a.name}/`; } })),
    '-', { label: 'Admin', fn: () => { location.hash = '#/admin'; } },
  ] },
  { label: 'Help', items: () => [
    { label: 'Keyboard shortcuts', key: '?', fn: shortcuts },
    { label: `About ${app.app.title}`, fn: about },
  ] },
];

function shortcuts() {
  dialog('Keyboard shortcuts', el('table', {}, el('tbody', {}, [
    ['/', `Search ${app.app.title}`], ...(app.app.keys || [['[ and ]', 'Previous and next period'], ['T', 'Back to today']]),
    ['Ctrl+Z', 'Undo the last change (outside a text box)'], ['Enter', 'In a table: save and move down'],
    ['Esc', 'Close a menu or box'], ['?', 'This list'],
    ['Right-click', 'Things to do with what is under the pointer'], ['Shift+right-click', 'The browser’s own menu'],
  ].map(([k, v]) => el('tr', {}, el('td', { class: 'num', style: 'width:150px' }, k), el('td', {}, v))))));
}

function about() {
  const m = state.meta;
  dialog(`About ${app.app.title}`, el('div', {}, el('p', {}, el('strong', {}, `Daybook ${m.version}`), ` · ${app.app.title}: ${app.app.about || ''}`),
    el('table', {}, el('tbody', {}, [['Database', m.db], ['Schema', String(m.schema)], ['Apps', m.apps.map(a => a.title).join(', ')]]
      .map(([k, v]) => el('tr', {}, el('td', { style: 'width:120px' }, k), el('td', {}, v)))))));
}

/** The menu button on the bar: File, Edit, View, Go and Help, then the things most often wanted. */
export function openMenu(button) {
  if (button.getAttribute('aria-expanded') === 'true') { closeMenus(); return; }
  const r = button.getBoundingClientRect();
  popup([...MENUS().map(x => ({ label: x.label, sub: x.items() })), '-',
    { label: state.editing ? 'Stop customising' : 'Customise this page', fn: app.editLayout },
    { label: 'Theme', sub: app.modes().map(t => ({ label: t.label, on: (document.documentElement.dataset.mode || 'system') === t.v,
      fn: async () => { await app.useTheme(t.v); app.render(); } })) },
    { label: 'Admin', fn: () => { location.hash = '#/admin'; } },
    '-', { label: 'Lock (sign out here)', fn: app.lock }], r.right - 250, r.bottom + 4);
  button.setAttribute('aria-expanded', 'true');
}

/** Start the menus and keys. a: {app, go, render, page, useTheme, modes, groups, titleOf, editLayout, editText, lock, fold, focusFind}. */
export function install(a) {
  app = a;
  document.addEventListener('contextmenu', e => {
    const f = e.target.closest?.('input, textarea');
    if (e.shiftKey || (f && !f.closest('table.g')) || e.target.closest?.('.menu, dialog')) return;   // typing boxes keep the browser's menu
    e.preventDefault();
    popup(contextItems(e), e.clientX, e.clientY);
  });
  addEventListener('keydown', e => {
    if (e.defaultPrevented || e.altKey || e.metaKey) return;
    if (e.ctrlKey) { if (e.key === 'z' && !typing(e.target)) { e.preventDefault(); undo(); } return; }
    if (typing(e.target) || document.querySelector('dialog[open]')) return;
    const k = { ...(app.app.period ? { '[': () => setPeriod(state.grain, step(-1)), ']': () => setPeriod(state.grain, step(1)),
                t: () => setPeriod(state.grain, today()) } : {}), '?': shortcuts, ...(app.app.keymap || {}) }[e.key];
    if (k) { e.preventDefault(); closeMenus(); k(); }
  });
}
