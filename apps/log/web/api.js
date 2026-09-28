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
  media:    id => core.table('attachment', { id }).then(([a]) => a?.data),
};
