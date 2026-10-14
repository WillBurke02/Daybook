// What was written while Daybook could not be reached, kept on this device (IndexedDB) until it can:
// Log's quick add holds an entry here and sends it on the next visit, or when the phone is back online.
const open = () => new Promise((ok, bad) => {
  const r = indexedDB.open('daybook', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
  r.onsuccess = () => ok(r.result);
  r.onerror = () => bad(r.error);
});
async function store(mode, fn) {
  const db = await open();
  return new Promise((ok, bad) => {
    const t = db.transaction('outbox', mode), req = fn(t.objectStore('outbox'));
    t.oncomplete = () => { db.close(); ok(req?.result); };
    t.onerror = t.onabort = () => { db.close(); bad(t.error); };
  });
}

/** A failed fetch that never reached the server (no signal, Tailscale off), as against one it refused. */
export const unreachable = e => e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);

/** Keep one thing to send later: {app, what, body, files}. Files (videos) are kept as they are. */
export const hold = item => store('readwrite', s => s.add({ ...item, at: Date.now() }));
/** Everything waiting for one app, oldest first. */
export const held = app => store('readonly', s => s.getAll()).then(xs => (xs || []).filter(x => x.app === app)).catch(() => []);

/** Send what an app has waiting, oldest first, with send(item). Stops at the first that still cannot get
 *  through; one the server refuses is dropped (it would never go) and reported. Returns how many went. */
export async function flush(app, send, refused = () => {}) {
  let n = 0;
  for (const it of await held(app)) {
    try { await send(it); n++; }
    catch (e) {
      if (unreachable(e)) break;
      refused(it, e);
    }
    await store('readwrite', s => s.delete(it.id));
  }
  return n;
}
