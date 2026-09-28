// Talking to the server. A page under /money/ talks to /money/api/, Home to
// /api/. Every write carries X-Daybook: a cross-site <form> cannot set a custom
// header, and fetch from another site triggers a preflight the server never answers.
const HEAD = { 'content-type': 'application/json', 'X-Daybook': '1' };
export const APP = location.pathname.match(/^\/([a-z]+)\//)?.[1] || null;
const BASE = APP ? `/${APP}/api/` : '/api/';

async function req(url, opts = {}) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash); }
  const body = await r.json().catch(() => ({ error: r.statusText }));
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
}
export const qs = q => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== false) p.set(k, v === true ? '1' : v);
  const s = p.toString();
  return s ? '?' + s : '';
};

/** The generic calls every app's API answers, at base (for example '/log/api/'). */
export function client(base) {
  const get = path => req(base + path);
  const send = (path, body, method = 'POST') =>
    req(base + path, { method, headers: HEAD, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    get, send,
    meta:   ()       => get('meta'),
    table:  (t, q)   => get(`t/${t}${qs(q)}`),
    view:   (v, q)   => get(`v/${v}${qs(q)}`),
    save:   (t, row) => send(`t/${t}`, row),
    remove: (t, id)  => send(`t/${t}/${encodeURIComponent(id)}`, undefined, 'DELETE'),
    removeWhere: (t, q) => send(`t/${t}${qs(q)}`, undefined, 'DELETE'),
    undo:    (id)  => send(id ? `undo/${id}` : 'undo', {}),
    changes: (limit) => get(`changes${qs({ limit })}`),
    search:  q  => get(`search${qs({ q })}`),
    home:    () => get('home'),
    measures: () => get('measures'),
    measureValues: refs => send('measures', { refs }).then(r => r.values),
    admin: {
      sql:      (sql)     => send('admin/sql', { sql }),
      views:    ()        => get('admin/views'),
      saveView: (b)       => send('admin/views', b),
      dropView: (n)       => send(`admin/views/${n}`, undefined, 'DELETE'),
      addColumn: (b)      => send('admin/columns', b),
      dropColumn: (t, c)  => send(`admin/columns/${t}/${c}`, undefined, 'DELETE'),
      backups:  ()        => get('admin/backups'),
      backup:   ()        => send('admin/backup', {}),
      restore:  (name)    => send('admin/restore', { name }),
      health:   ()        => get('admin/health'),
      dbs:      ()        => get('admin/db'),
      inspect:  (path)    => get(`admin/db/inspect${qs({ path })}`),
      switchDb: (path)    => send('admin/db/switch', { path }),
      newDb:    (name, copy) => send('admin/db/new', { name, copy }),
      download: ()        => base + 'admin/download',
    },
  };
}

/** This page's app. An app adds its own calls: Object.assign(api, {...}) in its app.js. */
export const api = client(BASE);
/** Another app, by name: its Home card, its search, its days. */
export const appApi = name => client(`/${name}/api/`);

/** The suite: sign-in, the password, themes, the keys. */
export const suite = Object.assign(client('/api/'), {
  login:    password => suite.send('login', { password }),
  logout:   ()       => suite.send('logout', {}),
  password: (old, nw) => suite.send('password', { old, new: nw }),
  token:    (name, reset) => reset ? suite.send(`token/${name}`, {}) : suite.get(`token/${name}`),
  sync: {
    status: ()   => suite.get('sync'),
    setup:  body => suite.send('sync', body),
    now:    ()   => suite.send('sync/now', {}),
    code:   ()   => suite.get('sync/code'),
    leave:  ()   => suite.send('sync/leave', {}),
  },
});
