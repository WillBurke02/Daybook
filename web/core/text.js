// Every label in the app can be reworded. The app's own wording is the key,
// yours is the value; titles like "Calendar · September" are reworded a part
// at a time, so renaming "Calendar" still leaves the month.
import { api } from './api.js';
import { el, dialog, flash } from './dom.js';
import { state, loadMeta } from './state.js';

export const LABELS = 'h1,h2,h3,h4,th,.k,.eyebrow,button,label,.dow,.note,.pp header,.pp header span,.tile .s,aside.side a,a.btn,a.link,.chip,.legend span,.grp,dialog header,.slip .col h3';
const orig = new WeakMap();                 // text node -> the app's own wording

const reword = t => {
  const map = state.meta?.text || {};
  if (map[t.trim()] != null) return t.replace(t.trim(), map[t.trim()]);
  if (!t.includes(' · ')) return t;
  return t.split(' · ').map(p => map[p.trim()] ?? p).join(' · ');
};

function fix(node) {
  const was = orig.get(node) ?? node.textContent;
  if (!was.trim()) return;
  if (!orig.has(node)) orig.set(node, was);
  const now = reword(was);
  if (node.textContent !== now) node.textContent = now;
  const host = node.parentElement;
  if (host && !host.dataset.orig) host.dataset.orig = was.trim();
}

export function applyText(root = document.body) {
  if (!state.meta?.text || !Object.keys(state.meta.text).length) return;
  const els = root.nodeType === 1 ? [root.matches?.(LABELS) ? root : null, ...root.querySelectorAll(LABELS)] : [];
  for (const e of els) if (e) for (const n of e.childNodes) if (n.nodeType === 3) fix(n);
}

export function watchText() {
  new MutationObserver(ms => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType === 1) applyText(n);
      else if (n.nodeType === 3 && n.parentElement?.matches(LABELS)) fix(n);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

/** The wording for a label: the part before " · ", as the app wrote it. */
const originalOf = e => {
  const n = [...e.childNodes].find(x => x.nodeType === 3 && x.textContent.trim());
  const t = (n && orig.get(n)) || e.dataset.orig || e.textContent;
  return t.split(' · ')[0].trim();
};

export function editText(original) {
  const cur = state.meta.text?.[original] ?? original;
  const input = el('input', { value: cur, style: 'width:100%' });
  dialog('Reword', el('div', { class: 'stack' },
    el('p', { class: 'note', style: 'margin:0' }, `Shown everywhere the app says “${original}”.`), input), [
    { label: 'Save', fn: async () => {
      if (!input.value.trim() || input.value.trim() === original) await api.remove('ui_text', original).catch(() => {});
      else await api.save('ui_text', { original, text: input.value.trim() });
      await loadMeta(); flash('Saved'); location.reload();
    } },
    state.meta.text?.[original] != null ? { label: 'Put back', cls: 'btn plain', fn: async () => {
      await api.remove('ui_text', original); await loadMeta(); location.reload(); } } : null,
  ].filter(Boolean));
  queueMicrotask(() => { input.focus(); input.select(); });
}

// In text mode a click on any label rewords it instead of doing what it does.
addEventListener('click', e => {
  if (!document.body.classList.contains('texting')) return;
  const t = e.target.closest(LABELS);
  if (!t || t.closest('.appbar, .textbar, .menu, dialog, .fx-popmenu')) return;
  e.preventDefault(); e.stopPropagation();
  const o = originalOf(t);
  if (o) editText(o);
}, true);
