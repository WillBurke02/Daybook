// Home: the window's start screen, one card per app from that app's /api/home.
// The card shows whatever the app sends (figures, a short list, a ring, links, a
// quick box), so Home knows nothing about any app, and an app that is missing or
// failing only loses its own card. Arrange: drag the cards into any order, make
// one wide, hide one; the arrangement is kept in suite.db.
import { suite, appApi } from './core/api.js';
import { el, flash } from './core/dom.js';
import { state } from './core/state.js';
import { dayLong, today } from './core/format.js';
import { themeCSS, applyMode, useTheme, modes } from './core/theme.js';
import { appbar, tabbar, banner, icon } from './core/pages.js';
import { popup } from './ui/menu.js';
import { ring } from './ui/ring.js';

const $ = s => document.querySelector(s);
let arranging = false;
const prefs = () => { try { return JSON.parse(state.meta.settings.home || '{}'); } catch { return {}; } };
async function savePrefs(p) {
  state.meta.settings.home = JSON.stringify(p);
  try { await suite.save('setting', { key: 'home', value: state.meta.settings.home }); } catch (e) { flash(e.message); }
}

function card(app, data, p) {
  const body = el('div', { class: 'body' });
  if (data.error) body.append(el('p', { class: 'err' }, `${app.title} could not be read: ${data.error}`));
  // a figure or an item that says where it comes from is a link there
  const at = href => href ? `/${app.name}/${href}` : null;
  const figs = data.figures?.length ? el('div', { class: 'figs' }, data.figures.map(f =>
    el(f.href ? 'a' : 'div', { class: 'fig' + (f.href ? ' go' : ''), href: at(f.href) },
      el('small', {}, f.label), el('b', { class: 'num ' + (f.cls || '') }, f.value), f.sub ? el('em', {}, f.sub) : null))) : null;
  if (data.ring) body.append(el('div', { class: 'ringrow' }, ring(data.ring.done, data.ring.goal, 84), figs || el('span', { class: 'muted' }, data.ring.label)));
  else if (figs) body.append(figs);
  if (data.quick) {
    const box = el('textarea', { rows: 2, placeholder: data.quick.placeholder, 'aria-label': data.quick.placeholder });
    const add = async () => {
      if (!box.value.trim()) return;
      try { await appApi(app.name).send(data.quick.post, { text: box.value.trim() }); box.value = ''; flash(data.quick.done || 'Added'); load(); }
      catch (e) { flash(e.message); }
    };
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(); });
    body.append(el('div', { class: 'quickbox' }, box, el('button', { class: 'btn sm', type: 'button', onclick: add }, 'Add')));
  }
  if (data.items) body.append(el('div', { class: 'items' }, el('h3', {}, data.items_title || ''), data.items.length
    ? data.items.map(i => el(i.href ? 'a' : 'div', { class: 'item' + (i.href ? ' go' : ''), href: at(i.href) },
        el('span', { class: 'd num' }, i.when || ''), el('span', { class: 'w' }, i.text), el('span', { class: 'num' }, i.value || '')))
    : el('p', { class: 'note' }, data.items_empty || 'Nothing.')));
  if (data.links?.length) body.append(el('div', { class: 'row links' }, data.links.map((l, i) =>
    el('a', { class: 'btn sm' + (i ? ' plain' : ''), href: `/${app.name}/${l.href}` }, l.label))));
  const off = (p.hidden || []).includes(app.name), wide = (p.wide || []).includes(app.name);
  const c = el('section', { class: `hcard${wide ? ' wide' : ''}${off ? ' off' : ''}`, data: { app: app.name } },
    el('header', {}, el('img', { class: 'appic', alt: '', src: `/assets/icons/${app.name}-192.png` }),
      el('a', { class: 'name', href: `/${app.name}/` }, app.title),
      arranging ? el('span', { class: 'tools' },
        el('button', { class: 'btn plain sm', type: 'button', 'aria-pressed': String(wide), onclick: () => toggle('wide', app.name) }, 'Wide'),
        el('button', { class: 'icon', type: 'button', title: off ? 'Show this card' : 'Hide this card', 'aria-label': off ? 'Show' : 'Hide',
          onclick: () => toggle('hidden', app.name) }, icon(off ? 'eyeoff' : 'eye')))
        : el('a', { class: 'open', href: `/${app.name}/` }, 'Open', icon('right'))),
    body);
  if (arranging) {
    c.draggable = true;
    c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', app.name); c.classList.add('dragging'); });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
    c.addEventListener('dragover', e => e.preventDefault());
    c.addEventListener('drop', async e => {
      e.preventDefault();
      const from = e.dataTransfer.getData('text/plain');
      const order = [...$('.cards').children].map(x => x.dataset.app).filter(x => x !== from);
      const r = c.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
      order.splice(order.indexOf(app.name) + (after ? 1 : 0), 0, from);
      await savePrefs({ ...prefs(), order }); load();
    });
  }
  return c;
}

async function toggle(kind, name) {
  const p = prefs(), s = new Set(p[kind] || []);
  s.has(name) ? s.delete(name) : s.add(name);
  await savePrefs({ ...p, [kind]: [...s] }); load();
}

async function load() {
  const p = prefs(), order = p.order || [];
  const apps = [...state.meta.apps].sort((a, b) => (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99))
    .filter(a => arranging || !(p.hidden || []).includes(a.name));
  const cards = await Promise.all(apps.map(async a => card(a, await appApi(a.name).home().catch(e => ({ error: e.message })), p)));
  $('.cards').replaceChildren(...cards);
  if (!cards.length) $('.cards').append(el('p', { class: 'note' }, 'Every card is hidden. Arrange shows them again.'));
}

const hello = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

async function start() {
  state.meta = await suite.meta();
  themeCSS();
  applyMode(state.meta.settings.default_mode || 'system');
  appbar($('.appbar'), state.meta.apps, 'home', { custom: 'Arrange' });
  tabbar($('.tabbar'), state.meta.apps, 'home');
  $('.appbar .burger').hidden = true;
  $('.appbar .custom').addEventListener('click', e => {
    arranging = !arranging;
    e.currentTarget.setAttribute('aria-pressed', String(arranging));
    document.body.classList.toggle('arranging', arranging);
    if (arranging) flash('Drag the cards into any order; Wide gives one the whole row; the eye hides one');
    load();
  });
  $('.appbar .more').addEventListener('click', e => {
    const r = e.currentTarget.getBoundingClientRect();
    popup([{ label: 'Theme', sub: modes().map(m => ({ label: m.label, on: (document.documentElement.dataset.mode || 'system') === m.v,
             fn: () => useTheme(m.v) })) },
           { label: arranging ? 'Stop arranging' : 'Arrange the cards', fn: () => $('.appbar .custom').click() },
           '-', ...state.meta.apps.map(a => ({ label: `Open ${a.title}`, fn: () => { location.href = `/${a.name}/`; } })),
           '-', { label: 'Lock (sign out here)', fn: async () => { await suite.logout(); location.href = '/login'; } }],
          r.right - 240, r.bottom + 4);
  });
  $('.today').textContent = dayLong(today());
  $('.hello').textContent = hello();
  document.title = 'Home · Daybook';
  banner(state.meta);
  await load();
  addEventListener('focus', () => { if (!arranging) load(); });     // back to the window: fresh figures
}
start();
