// How Learn's search results read and where they go. Its own small module, so another app's
// "Search every app" can show them and link straight to the card or lesson.
export const brief = (text, n = 140) => String(text || '').replace(/\$[^$]*\$/g, '…').replace(/\{\w+(:\d)?\}/g, '…').replace(/\*\*|`/g, '').split('\n')[0].slice(0, n);

export default {
  card: ['Cards', r => ({ what: brief(r.text), more: `${r.subject} · ${r.lesson} · ${r.type}`,
    href: `#/lesson?id=${encodeURIComponent(r.lesson_id)}&card=${encodeURIComponent(r.id)}` })],
  lesson: ['Lessons', r => ({ what: r.title, more: `${r.subject} · ${r.unit}`, href: `#/lesson?id=${encodeURIComponent(r.id)}` })],
};
