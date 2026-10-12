// How Log's search results read and where they go; also shown by another app's "Search every app".
export default {
  entry: ['Entries', r => ({ when: r.date, thumb: r.thumb, what: (r.text || (r.kind === 'day' ? 'Diary' : 'Photo or voice note')).split('\n')[0],
    more: [r.kind === 'day' ? 'diary' : r.at, (r.text || '').split('\n').slice(1).join(' ').slice(0, 120)].filter(Boolean).join(' · '),
    href: `#/day?d=${r.date}&e=${r.id}` })],
};
