// The sidebar: the app's pages in their groups, pages of your own, then Setup.
// In Customise, drag a page to reorder it within its group, the eye hides it
// (it stays in the Go menu), click its name to rename it, and add or delete
// pages of your own. The order and what is hidden are a setting of the app's.
import { api } from './api.js';
import { el, flash } from './dom.js';
import { state, loadMeta } from './state.js';
import { icon } from './pages.js';

const pref = () => { try { return JSON.parse(state.meta.settings.nav || '{}'); } catch { return {}; } };
async function savePref(v) {
  const value = JSON.stringify(v);
  await api.save('setting', { key: 'nav', value });
  state.meta.settings.nav = value;
}

/** The groups as shown: [[heading, [ids]]], in your order. */
export function navGroups(app) {
  const custom = state.meta.layouts.filter(l => l.custom).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map(l => 'p/' + l.page);
  const { order = [] } = pref();
  const rank = (id, i) => { const k = order.indexOf(id); return k < 0 ? 1000 + i : k; };
  return [...app.groups, ...(custom.length ? [['Your pages', custom]] : [])]
    .map(([g, ids]) => [g, ids.map((id, i) => [id, rank(id, i)]).sort((a, b) => a[1] - b[1]).map(x => x[0])]);
}
export const hiddenPages = () => new Set(pref().hidden || []);

/** Rename a page: its layout row carries the title (a built-in page keeps its panels). */
async function rename(id, title, layoutOf) {
  const custom = id.startsWith('p/'), page = custom ? id.slice(2) : id;
  const cur = state.meta.layouts.find(l => l.page === page);
  await api.save('layout', { page, title, panels: cur?.panels || JSON.stringify(layoutOf(id) || []),
                             sort: cur?.sort ?? 100, custom: custom ? 1 : 0 });
  await loadMeta();
}

/** s: the aside. o: {app, current, titleOf, layoutOf, editing, redraw, go} */
export function sidebar(s, o) {
  const { app, current, titleOf, editing } = o;
  const hidden = hiddenPages();
  const groups = navGroups(app);
  s.replaceChildren(el('a', { class: 'apphead', href: '#/' + app.home },
    el('img', { class: 'appic', alt: '', src: `/assets/icons/${app.name}-192.png` }), el('span', {}, app.title)));
  if (editing) s.append(el('p', { class: 'navhelp' }, 'Drag to reorder. The eye hides a page; click a name to rename it.'));
  let dragged = null;
  const row = (id, group, fixed) => {
    const on = id === current, off = hidden.has(id);
    if (!editing) return off ? null : el('a', { href: `#/${id}`, class: 'nav' + (on ? ' on' : '') }, titleOf(id));
    const name = el('button', { class: 'name', type: 'button', title: 'Rename' }, titleOf(id));
    name.addEventListener('click', () => {
      const input = el('input', { class: 'sm', value: titleOf(id), 'aria-label': 'Page name' });
      let ended = false;                           // Enter ends it, and so does the blur the redraw causes: once
      const done = async keep => {
        if (ended) return;
        ended = true;
        const t = input.value.trim();
        if (keep && t && t !== titleOf(id)) { try { await rename(id, t, o.layoutOf); } catch (e) { flash(e.message); } }
        o.redraw();
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
      input.addEventListener('blur', () => done(true));
      name.replaceWith(input); input.focus(); input.select();
    });
    const r = el('div', { class: 'navrow' + (on ? ' on' : '') + (off ? ' off' : ''), draggable: fixed ? null : 'true', data: { id } },
      fixed ? null : el('span', { class: 'grip', title: 'Drag to reorder' }, icon('grip')), name,
      el('a', { class: 'icon go', href: `#/${id}`, title: 'Open' }, icon('right')),
      fixed ? null : el('button', { class: 'icon eye', type: 'button', title: off ? 'Show this page' : 'Hide this page',
        'aria-label': off ? 'Show' : 'Hide', onclick: async () => {
          const p = pref(), h = new Set(p.hidden || []);
          h.has(id) ? h.delete(id) : h.add(id);
          await savePref({ ...p, hidden: [...h] }); o.redraw();
        } }, icon(off ? 'eyeoff' : 'eye')),
      id.startsWith('p/') ? el('button', { class: 'icon del', type: 'button', title: 'Delete this page', 'aria-label': 'Delete', onclick: async () => {
        await api.remove('layout', id.slice(2)); await loadMeta();
        flash('Page deleted', { label: 'Undo', fn: async () => { await api.undo(); await loadMeta(); o.redraw(); } });
        if (current === id) o.go(app.home); else o.redraw();
      } }, icon('x')) : null);
    if (!fixed) {
      r.addEventListener('dragstart', e => { dragged = { id, group }; r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      r.addEventListener('dragend', () => r.classList.remove('dragging'));
      r.addEventListener('dragover', e => { if (dragged?.group === group && dragged.id !== id) { e.preventDefault(); r.classList.add('over'); } });
      r.addEventListener('dragleave', () => r.classList.remove('over'));
      r.addEventListener('drop', async e => {
        e.preventDefault(); r.classList.remove('over');
        if (!dragged || dragged.group !== group) return;
        const ids = groups[group][1].filter(x => x !== dragged.id);
        const at = ids.indexOf(id), after = e.offsetY > r.offsetHeight / 2;
        ids.splice(at + (after ? 1 : 0), 0, dragged.id);
        groups[group][1] = ids;
        await savePref({ ...pref(), order: groups.flatMap(g => g[1]) });
        o.redraw();
      });
    }
    return r;
  };
  groups.forEach(([g, ids], i) => {
    const rows = ids.map(id => row(id, i)).filter(Boolean);
    if (!rows.length) return;
    if (g) s.append(el('div', { class: 'grp' }, g));
    s.append(...rows);
  });
  if (editing) {
    const name = el('input', { class: 'sm', placeholder: 'A new page', 'aria-label': 'New page name' });
    const add = async () => {
      const t = name.value.trim(), id = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!id) return flash('Give the page a name');
      if (state.meta.layouts.some(l => l.page === id) || app.pages[id]) return flash('There is a page of that name');
      await api.save('layout', { page: id, title: t, panels: '[]', custom: 1, sort: 200 + state.meta.layouts.length });
      await loadMeta(); o.go('p/' + id);
    };
    name.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    s.append(el('div', { class: 'newpage' }, name, el('button', { class: 'btn plain sm', type: 'button', onclick: add }, icon('plus'), 'Page')));
  }
  s.append(el('div', { class: 'spacer' }), el('div', { class: 'grp' }, 'Setup'),
    ...[...(app.setup || []), 'changes'].map(id => editing ? row(id, -1, true) : el('a', { href: `#/${id}`, class: 'nav' + (current === id ? ' on' : '') }, titleOf(id))),
    el('a', { href: '#/admin', class: 'nav' + (current === 'admin' ? ' on' : '') }, 'Admin'));
}
