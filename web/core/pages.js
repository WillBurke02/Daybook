// Pages and pieces every app has: Search (this app, or everywhere), Change
// history, the bar with the apps along the top, and the banner while the password is the default.
import { api, appApi, APP } from './api.js';
import { el, flash, table } from './dom.js';
import { money, signed, dateUK } from './format.js';
import { state } from './state.js';

// Line icons, drawn at 18 px in currentColor.
const ICONS = {
  search: '<path d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  side: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  home: '<path d="M4 11l8-7 8 7v9H4z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 22 12s-1.2 2.1-3.4 4M6.2 6.2C3.6 8 2 12 2 12s4 7 10 7c1.7 0 3.2-.5 4.5-1.2"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
};
/** An icon as an element: <span class="ic"><svg>…</svg></span>. Our own markup, never anything typed. */
export const icon = name => el('span', { class: 'ic', 'aria-hidden': 'true',
  html: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>` });

const appIcon = name => el('img', { class: 'appic', alt: '', src: name === 'home' ? '/assets/icons/favicon-32.png' : `/assets/icons/${name}-192.png` });

/** The one bar along the top: Daybook, the apps as tabs, search, undo, Customise and the menu.
 *  The caller wires the buttons it asked for: find (placeholder), undo, custom (label). */
export function appbar(bar, apps, current, { find, undo, custom } = {}) {
  const tab = (name, title, url) => el('a', { class: 'app' + (name === current ? ' on' : ''), href: url, data: { app: name },
    'aria-current': name === current ? 'page' : null }, name === 'home' ? icon('home') : el('i', { class: 'dot' }), el('span', {}, title));
  bar.replaceChildren(...[
    el('button', { class: 'icon burger', type: 'button', 'aria-label': 'Pages' }, icon('side')),
    el('a', { class: 'mark', href: '/', title: 'Home' }, el('img', { src: '/assets/icons/favicon-32.png', alt: '' }), el('span', {}, 'Daybook')),
    el('nav', { class: 'apps', 'aria-label': 'Apps' }, tab('home', 'Home', '/'), (apps || []).map(a => tab(a.name, a.title, `/${a.name}/`))),
    el('span', { class: 'here' }, (apps || []).find(a => a.name === current)?.title || 'Daybook'),
    find ? el('label', { class: 'findbox' }, icon('search'),
      el('input', { class: 'find', type: 'search', 'aria-label': 'Search', placeholder: find }), el('kbd', {}, '/')) : el('span', { class: 'spacer' }),
    el('span', { class: 'dbname', hidden: true, title: 'The database that is open. Switch in Admin → Databases.' }),
    undo ? el('button', { class: 'icon undo', type: 'button', 'aria-label': 'Undo', title: 'Undo the last change (Ctrl+Z)' }, icon('undo')) : null,
    custom ? el('button', { class: 'btn plain sm custom', type: 'button', 'aria-pressed': 'false', title: 'Move, resize, hide and add panels; reorder and hide pages' },
      icon('edit'), el('span', {}, custom)) : null,
    el('button', { class: 'icon more', type: 'button', 'aria-label': 'Menu', title: 'Menu', 'aria-haspopup': 'menu' }, icon('menu')),
  ].filter(Boolean));
}

/** On a phone, the apps sit along the bottom. */
export function tabbar(nav, apps, current) {
  const tab = (name, title, url) => el('a', { class: name === current ? 'on' : null, href: url, data: { app: name },
    'aria-current': name === current ? 'page' : null }, appIcon(name), el('span', {}, title));
  nav.replaceChildren(tab('home', 'Home', '/'), ...(apps || []).map(a => tab(a.name, a.title, `/${a.name}/`)));
}

/** A red line across the top while the password is still the default. */
export function banner(meta) {
  document.querySelector('.pwbanner')?.remove();
  if (!meta.password_default) return;
  document.body.prepend(el('div', { class: 'pwbanner', role: 'alert' },
    'The password is still “pass”. Anyone who can reach this computer can open Daybook. ',
    el('a', { href: APP ? '#/admin' : '/money/#/admin' }, 'Change it in Admin')));
}

// --- search ------------------------------------------------------------------------

/** The text with every searched word marked. Built from text nodes, never HTML. */
export function marked(text, words) {
  const s = String(text ?? ''), low = s.toLowerCase(), hits = [];
  for (const w of words) for (let i = low.indexOf(w); w && i >= 0; i = low.indexOf(w, i + w.length)) hits.push([i, i + w.length]);
  hits.sort((a, b) => a[0] - b[0]);
  const out = [];
  let pos = 0;
  for (const [a, b] of hits) {
    if (a < pos) continue;
    out.push(s.slice(pos, a), el('mark', {}, s.slice(a, b)));
    pos = b;
  }
  out.push(s.slice(pos));
  return out;
}

const hitRow = (h, words) => el('a', { href: h.href, onclick: h.go },
  el('span', { class: 'when num muted' }, h.when ? dateUK(h.when) : ''),
  el('span', { class: 'what' }, h.thumb ? el('img', { src: h.thumb, alt: '' }) : null,
    el('strong', {}, marked(h.what, words)), h.more ? el('span', { class: 'muted' }, ' ', marked(h.more, words)) : null),
  el('span', { class: 'amt' }, h.amount == null ? '' : h.signed ? signed(h.amount) : el('span', { class: 'num' }, money(h.amount))));

/** Another app's row, shown without knowing that app: its date and its first words. */
const plainHit = (name, r, q) => ({ when: r.date || r.day, thumb: r.thumb,
  what: r.text || r.title || r.description || r.front || r.name || r.label || r.path || '',
  more: r.merchant || r.subject || r.kind || '', amount: r.amount, signed: true,
  href: `/${name}/#/search?q=${encodeURIComponent(q)}` });

export function searchPage(app) {
  return {
    title: 'Search', ownPeriod: true, layout: [{ use: 'search.results' }],
    panels: { 'search.results': { title: 'Search', w: 12, async render(body, ctx) {
      const q = (ctx.params.q || '').trim(), everywhere = ctx.params.all === '1';
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      ctx.aside.append(el('label', { class: 'c' }, el('input', { type: 'checkbox', checked: everywhere,
        onchange: e => ctx.go('search', { q, all: e.target.checked ? 1 : '' }) }), 'Every app'));
      if (!q) {
        body.append(el('p', { class: 'note' }, 'Type in the search box at the top (or press /). Words can come in any order; ',
          'a number such as 24.99 also finds that amount.'));
        return;
      }
      ctx.setTitle(`Search · “${q}”`);
      const others = everywhere ? state.meta.apps.filter(a => a.name !== APP) : [];
      const [mine, ...rest] = await Promise.all([api.search(q), ...others.map(a => appApi(a.name).search(q).catch(() => null))]);
      let n = 0;
      const section = (title, groups, show) => {
        if (title) body.append(el('h2', { class: 'hits-app' }, title));
        for (const g of groups) {
          const [label, fn] = show(g.kind);
          n += g.rows.length;
          body.append(el('h3', { class: 'hits-h' }, label, el('span', { class: 'muted' }, ` ${g.rows.length}${g.more ? '+' : ''}`)),
            el('div', { class: 'hits' }, g.rows.map(r => hitRow(fn(r), words))),
            ...(g.more ? [el('p', { class: 'note' }, 'More than shown; add a word to narrow it.')] : []));
        }
        if (!groups.length && title) body.append(el('p', { class: 'note' }, 'Nothing here.'));
      };
      section(everywhere ? app.title : null, mine, kind => app.search?.[kind] || [kind, r => plainHit(APP, r, q)]);
      others.forEach((a, i) => rest[i] ? section(a.title, rest[i], kind => [kind[0].toUpperCase() + kind.slice(1), r => plainHit(a.name, r, q)])
                                       : body.append(el('h2', { class: 'hits-app' }, a.title), el('p', { class: 'note' }, 'Could not be searched.')));
      ctx.aside.append(el('span', { class: 'num muted' }, `${n} found`));
      if (!n) body.append(el('p', { class: 'note' }, `Nothing matches “${q}”.`));
    } } },
  };
}

// --- change history ------------------------------------------------------------------

export const changesPanel = { title: 'Recent changes', w: 12, async render(body, ctx) {
  const rows = await api.changes(150);
  body.append(table([
    { k: 'at', label: 'When', fmt: v => v.replace('T', ' ').slice(0, 16) },
    { k: 'summary', label: 'What' },
    { k: 'rows', label: 'Rows', n: true },
    { k: '_u', label: '', sort: false, render: r => r.undone ? el('span', { class: 'chip' }, 'undone')
        : r.undoable ? el('button', { class: 'btn plain sm', onclick: async () => {
            try { const x = await api.undo(r.id); flash(x.undid); ctx.reload(); } catch (e) { flash(e.message); }
          } }, 'Undo') : '' },
  ], rows, { scroll: 'mid' }));
} };

export const changesPage = { title: 'Change history', ownPeriod: true, layout: [{ use: 'changes' }], panels: { changes: changesPanel } };
