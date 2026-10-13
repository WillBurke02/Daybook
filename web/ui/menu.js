// Menus: the menu button and the right-click menu share one list.
// An item is {label, key, fn, on (ticked), off (greyed), sub: [items]}, or '-' for a line.
import { el } from '../core/dom.js';

let open = null, openedAt = 0;

export function closeMenus() {
  open?.remove(); open = null;
  document.querySelectorAll('[aria-haspopup="menu"][aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

const tidy = items => items.filter(Boolean)
  .filter((x, i, a) => x !== '-' || (i > 0 && i < a.length - 1 && a[i - 1] !== '-'));

/** Show a menu at x, y (kept on screen). Returns the element. On a phone a submenu opens in its place
 *  (with a way back) rather than beside it, where there is no room. */
export function popup(items, x, y, sub = false) {
  if (!sub) closeMenus();
  const m = el('div', { class: 'menu', role: 'menu' });
  const narrow = !sub && innerWidth < 600;
  const place = () => requestAnimationFrame(() => {   // keep it on the screen: flip a submenu to the left if need be
    m.style.left = x + 'px'; m.style.top = y + 'px';
    const r = m.getBoundingClientRect();
    if (r.right > innerWidth - 4) m.style.left = Math.max(4, sub ? m.parentElement.getBoundingClientRect().left - r.width + 3 : innerWidth - r.width - 4) + 'px';
    if (r.bottom > innerHeight - 4) m.style.top = Math.max(4, innerHeight - r.height - 4) + 'px';
  });
  const fill = (list, back) => {
    m.replaceChildren();
    if (back) m.append(el('button', { type: 'button', role: 'menuitem', class: 'back', onclick: () => { fill(items); m.querySelector('button')?.focus(); } },
      el('span', { class: 'tick' }, '‹'), el('span', { class: 'lbl' }, back), el('span', { class: 'key' }, '')));
    for (const it of tidy(list)) {
      if (it === '-') { m.append(el('div', { class: 'sep', role: 'separator' })); continue; }
      if (it.head) { m.append(el('div', { class: 'head' }, it.head)); continue; }
      const b = el('button', { type: 'button', role: 'menuitem', disabled: it.off || null, class: it.sub ? 'has-sub' : null },
        el('span', { class: 'tick' }, it.on ? '✓' : ''), el('span', { class: 'lbl' }, it.label),
        el('span', { class: 'key' }, it.sub ? '▸' : it.key || ''));
      const showSub = () => {
        m.querySelector(':scope > .menu')?.remove();
        if (!it.sub) return;
        const r = b.getBoundingClientRect();
        b.after(popup(it.sub, r.right - 3, r.top - 5, true));   // right after its own item: the CSS marks that one as open
      };
      if (!narrow) b.addEventListener('mouseenter', showSub);
      b.addEventListener('click', () => {
        if (it.sub) return narrow ? (fill(it.sub, it.label), place(), m.querySelector('button')?.focus()) : showSub();
        closeMenus(); it.fn?.();
      });
      m.append(b);
    }
  };
  fill(items);
  m.addEventListener('keydown', e => {
    if (e.target.closest('.menu') !== m && e.target !== m) return;      // a submenu's keys are its own
    const all = [...m.querySelectorAll(':scope > button:not([disabled])')], i = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus(); }
    if (e.key === 'ArrowRight' && document.activeElement?.classList.contains('has-sub')) { document.activeElement.click(); m.querySelector(':scope > .menu button')?.focus(); }
    if (e.key === 'ArrowLeft' && sub) { e.stopPropagation(); m.remove(); }
    if (e.key === 'Escape') { e.stopPropagation(); closeMenus(); }
  });
  if (!sub) document.body.append(m);              // a submenu goes after its item, which showSub does
  m.style.left = x + 'px'; m.style.top = y + 'px';
  place();
  m.tabIndex = -1;                                 // arrow keys work straight away; nothing is highlighted until used
  if (!sub) { open = m; openedAt = performance.now(); requestAnimationFrame(() => m.focus({ preventScroll: true })); }
  return m;
}

document.addEventListener('pointerdown', e => { if (open && !e.target.closest('.menu, [aria-haspopup="menu"]')) closeMenus(); }, true);
addEventListener('blur', closeMenus);
addEventListener('resize', closeMenus);
// a right-click selects the word under it, and the browser may scroll that into view: not a reason to close
document.addEventListener('scroll', e => { if (open && !e.target.closest?.('.menu') && performance.now() - openedAt > 250) closeMenus(); }, true);
addEventListener('hashchange', closeMenus);
