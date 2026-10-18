// Log's API: the generic calls, plus adding, attaching, a day, the timeline, printing.
import { api as core, qs } from './core/api.js';

const { get, send } = core;
export const api = {
  ...core,
  quick:    b => send('quick', b),
  attach:   (id, b) => send(`attach/${id}`, b),
  day:      d => get(`day${qs({ d })}`),
  timeline: q => get(`timeline${qs(q)}`),
  print:    (from, to) => get(`print${qs({ from, to })}`),
  renameTag: (from, to) => send('tag/rename', { from, to }),
  photos:   q => get(`photos${qs(q)}`),
  photoMonths: q => get(`photos/months${qs(q)}`),
  github:   () => get('github'),
  githubSave: b => send('github', b),
  githubPull: () => send('github/pull', {}),
  githubBackup: () => send('github/backup', {}),
  media:    id => core.table('attachment', { id }).then(([a]) => a?.data),
};
