// Themes: Paper, Dusk and Ink built in, Auto following the computer, and any
// made in Admin. They live in suite.db, so every app and every device looks the same.
import { suite } from './api.js';
import { el, flash } from './dom.js';
import { state } from './state.js';

export const slug = n => 't-' + String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-');
export const modes = () => [{ v: 'system', label: 'Auto' }, { v: 'paper', label: 'Paper' }, { v: 'dusk', label: 'Dusk' },
  { v: 'ink', label: 'Ink' }, ...(state.meta?.themes || []).map(t => ({ v: slug(t.name), label: t.name }))];
const picker = () => document.querySelector('select.mode');

/** Your themes as CSS, and the header's theme list to match. */
export function themeCSS() {
  document.getElementById('themes')?.remove();
  const css = (state.meta?.themes || []).map(t => {
    let v = {}; try { v = JSON.parse(t.vars); } catch {}
    const decl = Object.entries(v).filter(([k]) => k.startsWith('--')).map(([k, x]) => `${k}:${x};`).join('');
    return `:root[data-mode="${slug(t.name)}"]{color-scheme:${t.scheme};${decl}}`;
  }).join('\n');
  document.head.append(el('style', { id: 'themes' }, css));
  const p = picker();
  if (p) { p.replaceChildren(...modes().map(m => el('option', { value: m.v }, m.label))); p.value = document.documentElement.dataset.mode || 'system'; }
}

export function applyMode(m) {
  if (!modes().some(x => x.v === m)) m = 'system';
  if (m === 'system') delete document.documentElement.dataset.mode;
  else document.documentElement.dataset.mode = m;
  if (picker()) picker().value = m;
  const t = (state.meta?.themes || []).find(x => slug(x.name) === m);
  let v = {}; try { v = JSON.parse(t?.vars || '{}'); } catch {}
  state.tableStyle = v.tableStyle || '';
  document.documentElement.classList.toggle('dark', t?.scheme === 'dark');   // for the few rules that differ in the dark
}

/** Pick a theme. It is kept in suite.db, so it follows you to every app and device. */
export async function useTheme(m) {
  applyMode(m);
  state.meta.settings.default_mode = m;
  try { await suite.save('setting', { key: 'mode', value: m }); } catch (e) { flash(e.message); }
}
