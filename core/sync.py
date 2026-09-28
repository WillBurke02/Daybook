"""Sync: the same Money, Log and Learn on more than one computer, through a folder.

Each computer keeps its own databases and works offline. Its changes go into
files of its own in a shared folder (OneDrive, Google Drive, a USB stick, a NAS,
or a GitHub repository), and it reads everyone else's. A file is written once
and never changed, so a sync service never has two versions of one to settle,
and no database is ever put in the folder.

    triggers  every write to a synced table adds a row to sync_out: the table,
              the row's key, the columns that changed, and a clock reading
    export    sync_out goes to <folder>/<app>/<computer>/<t0>-<t1>-<random>.dbk
    import    every file not yet applied is read, and its changes applied in clock order

A row is known by a key every computer shares. A table keyed by `id INTEGER`
gives each row a random gid (sync_id maps it to the local id, which differs
from one computer to the next); any other table is known by its own key.
References to an id travel as gids.

For each column, the newest change wins (by clock, then computer). A deleted row
leaves a tombstone. When a change from elsewhere overwrites a value that was
changed here too, the value it replaced goes into Change history, where Undo
puts it back. Files are encrypted with the sync code, which never goes in the folder.
"""
import base64
import gzip
import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import sqlite3
import threading
import time
import urllib.error
import urllib.request

LOCAL = {"change_log", "schema_version"}             # each computer's own
HIDDEN = {"sync_meta", "sync_id", "sync_row", "sync_out", "sync_file"}
MAGIC = b"DBK1"
CHECK = "daybook-sync.json"
FILE_MAX = 8 * 1024 * 1024                           # a file of changes, before compression
WAIT = "wait"                                        # a change that needs one not yet here
GONE = "gone"                                        # a change to a row whose parent was deleted

TABLES = """
CREATE TABLE IF NOT EXISTS sync_meta (k TEXT PRIMARY KEY, v);
INSERT OR IGNORE INTO sync_meta (k, v) VALUES ('clock', 0), ('applying', 0);
CREATE TABLE IF NOT EXISTS sync_id (gid TEXT PRIMARY KEY, tbl TEXT NOT NULL, id INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_sync_id ON sync_id(tbl, id);
CREATE TABLE IF NOT EXISTS sync_row (tbl TEXT NOT NULL, key TEXT NOT NULL, ver TEXT NOT NULL DEFAULT '{}', dead TEXT,
                                     PRIMARY KEY (tbl, key)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sync_out (seq INTEGER PRIMARY KEY, t INTEGER NOT NULL, tbl TEXT NOT NULL,
                                     op TEXT NOT NULL, key TEXT, data TEXT, old TEXT);
CREATE TABLE IF NOT EXISTS sync_file (name TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')));
"""


def _q(n):
    return '"' + n.replace('"', '""') + '"'


def _lit(s):
    return "'" + s.replace("'", "''") + "'"


# --- is this database synced? ----------------------------------------------------------

def _has_meta(db):
    return bool(db.execute("SELECT 1 FROM sqlite_master WHERE name = 'sync_meta'").fetchone())


def meta(db, k, default=None):
    r = db.execute("SELECT v FROM sync_meta WHERE k = ?", (k,)).fetchone() if _has_meta(db) else None
    return r[0] if r and r[0] is not None else default


def _set(db, k, v):
    db.execute("INSERT INTO sync_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", (k, v))


def on(db):
    """Synced, and this is the file that was joined: a copy made in Admin to try
    things on has another name, and stays out of it."""
    if str(meta(db, "on", 0)) != "1":
        return False
    path = db.execute("PRAGMA database_list").fetchone()[2]
    return os.path.basename(path) == meta(db, "db")


def schema(db):
    return db.execute("SELECT MAX(n) FROM schema_version").fetchone()[0] or 0


# --- which tables, and what a row is called everywhere ------------------------------------

def tables(db, app):
    """{table: {cols, pk, surrogate, ref, where}} for every table this app syncs.
    ref: the columns holding another synced table's id, which travel as gids."""
    skip = LOCAL | set(getattr(app, "SYNC_SKIP", ()))
    where = getattr(app, "SYNC_WHERE", {})
    out = {}
    for (n,) in db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' "
                           "AND name NOT LIKE 'sync_%' ORDER BY name").fetchall():
        if n in skip:
            continue
        cols = [c for c in db.execute(f"PRAGMA table_xinfo({_q(n)})").fetchall() if not c["hidden"]]
        pk = [c["name"] for c in sorted((c for c in cols if c["pk"]), key=lambda c: c["pk"])]
        if not pk:
            continue                          # ponytail: a table without a key does not sync; none has one today
        types = {c["name"]: (c["type"] or "").upper() for c in cols}
        out[n] = {"cols": [c["name"] for c in cols], "pk": pk, "where": where.get(n),
                  "surrogate": pk == ["id"] and types["id"] == "INTEGER",
                  "fk": {f["from"]: f["table"] for f in db.execute(f"PRAGMA foreign_key_list({_q(n)})").fetchall()}}
    for i in out.values():
        i["ref"] = {c: p for c, p in i["fk"].items() if p in out and out[p]["surrogate"]}
        i["data"] = [c for c in i["cols"] if not (i["surrogate"] and c == "id")]
    return out


def _val(i, c, r):
    """Column c of row r as it travels: an id becomes its gid."""
    p, v = i["ref"].get(c), f"{r}.{_q(c)}"
    return f"(SELECT gid FROM sync_id WHERE tbl = {_lit(p)} AND id = {v} ORDER BY rowid LIMIT 1)" if p else v


def _key(i, t, r):
    if i["surrogate"]:
        return f"(SELECT gid FROM sync_id WHERE tbl = {_lit(t)} AND id = {r}.id ORDER BY rowid LIMIT 1)"
    return "json_array(" + ", ".join(_val(i, c, r) for c in i["pk"]) + ")"


def _obj(i, r, cols, changed=False):
    """A JSON object of these columns of row r; with changed, only those that differ between OLD and NEW."""
    if not cols:
        return "'{}'"
    parts = [f"SELECT {_lit(c)} AS c, {_val(i, c, r)} AS v" + (f" WHERE OLD.{_q(c)} IS NOT NEW.{_q(c)}" if changed else "")
             for c in cols]
    return f"(SELECT json_group_object(c, v) FROM ({' UNION ALL '.join(parts)}))"


GUARD = "(SELECT v FROM sync_meta WHERE k = 'applying') = 0"
TICK = ("UPDATE sync_meta SET v = MAX(v + 1, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) "
        "WHERE k = 'clock'")
NOW = "(SELECT v FROM sync_meta WHERE k = 'clock')"


def _triggers(t, i):
    q, name = _q(t), lambda op: _q(f"sync_{t}_{op}")
    only = lambda r: f" AND ({i['where'].format(r=r)})" if i["where"] else ""
    changed = " OR ".join(f"OLD.{_q(c)} IS NOT NEW.{_q(c)}" for c in i["data"]) or "0"
    rekey = "0" if i["surrogate"] else " OR ".join(f"OLD.{_q(c)} IS NOT NEW.{_q(c)}" for c in i["pk"])
    add = [TICK, f"INSERT INTO sync_out (t, tbl, op, key, data) VALUES ({NOW}, {_lit(t)}, 'i', "
                 f"{_key(i, t, 'NEW')}, {_obj(i, 'NEW', i['data'])})"]
    if i["surrogate"]:
        add = [f"DELETE FROM sync_id WHERE tbl = {_lit(t)} AND id = NEW.id",
               f"INSERT INTO sync_id (gid, tbl, id) VALUES (lower(hex(randomblob(9))), {_lit(t)}, NEW.id)"] + add
    out = [f"CREATE TRIGGER {name('i')} AFTER INSERT ON {q} WHEN {GUARD}{only('NEW')} BEGIN {'; '.join(add)}; END",
           f"CREATE TRIGGER {name('u')} AFTER UPDATE ON {q} WHEN {GUARD}{only('NEW')} AND NOT ({rekey}) AND ({changed}) "
           f"BEGIN {TICK}; INSERT INTO sync_out (t, tbl, op, key, data, old) VALUES ({NOW}, {_lit(t)}, 'u', "
           f"{_key(i, t, 'NEW')}, {_obj(i, 'NEW', i['data'], True)}, {_obj(i, 'OLD', i['data'], True)}); END"]
    if not i["surrogate"]:              # a changed key: the row moves, and its children follow it (ON UPDATE CASCADE)
        out.append(f"CREATE TRIGGER {name('k')} AFTER UPDATE ON {q} WHEN {GUARD}{only('NEW')} AND ({rekey}) "
                   f"BEGIN {TICK}; INSERT INTO sync_out (t, tbl, op, key, data) VALUES ({NOW}, {_lit(t)}, 'k', "
                   f"{_key(i, t, 'OLD')}, {_obj(i, 'NEW', i['data'])}); END")
    # a delete always lets go of the row's gid (a cascade while applying too); it is only recorded when made here
    gone = [f"{TICK} AND {GUARD}",
            f"INSERT INTO sync_out (t, tbl, op, key) SELECT {NOW}, {_lit(t)}, 'd', {_key(i, t, 'OLD')} "
            f"WHERE {GUARD}{only('OLD')}"]
    if i["surrogate"]:
        gone.append(f"DELETE FROM sync_id WHERE tbl = {_lit(t)} AND id = OLD.id")
    out.append(f"CREATE TRIGGER {name('d')} AFTER DELETE ON {q} BEGIN {'; '.join(gone)}; END")
    return out


def drop_triggers(db):
    for (n,) in db.execute("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sync!_%' ESCAPE '!'").fetchall():
        db.execute(f"DROP TRIGGER IF EXISTS {_q(n)}")


def rebuild_triggers(db, app):
    """Triggers are derived, like views: dropped and made again from the schema on
    every start and after a column is added. Rows that arrived without them
    (a migration's defaults) are then given keys."""
    drop_triggers(db)
    if not on(db):
        return
    T = tables(db, app)
    for t, i in T.items():
        for sql in _triggers(t, i):
            db.execute(sql)
    adopt(db, T)


# --- rows made without the triggers ----------------------------------------------------------

def _order(T):
    """Parents before children, so a child's gid can name its parent's."""
    done, out = set(), []
    while len(out) < len(T):
        ready = [t for t in T if t not in done and all(p in done or p == t for p in T[t]["ref"].values())]
        for t in ready or [t for t in T if t not in done]:          # a loop between tables: take them as they come
            done.add(t)
            out.append(t)
    return out


def adopt(db, T):
    """Give a key to every row that has none: all of them when sync is switched on,
    and a migration's new defaults after that. A row with an id gets a gid made from
    its contents, so the same default row made on two computers is one row. Each is
    sent as a change timed at the start of time, so any real edit wins over it:
    the computer that started sync at 1, one that joined at 0, so a new computer's
    defaults give way to the ones already in use."""
    t0 = int(meta(db, "adopt_t", 0))
    for t in _order(T):
        i = T[t]
        only = f" AND ({i['where'].format(r='NEW')})" if i["where"] else ""
        if i["surrogate"]:
            raw = ", ".join(f"NEW.{_q(c)} AS {_q('raw_' + c)}" for c in i["ref"]) or "NULL"
            for _ in range(100):                   # a row naming another in its own table waits a round for it
                rows = db.execute(f"SELECT NEW.id, {raw}, {_obj(i, 'NEW', i['data'])} AS d FROM {_q(t)} AS NEW "
                                  f"WHERE NEW.id NOT IN (SELECT id FROM sync_id WHERE tbl = ?){only} ORDER BY NEW.id",
                                  (t,)).fetchall()
                made = 0
                for r in rows:
                    d = json.loads(r["d"])
                    if any(r["raw_" + c] is not None and d.get(c) is None for c in i["ref"]):
                        continue
                    base = "h" + hashlib.sha1((t + "\0" + json.dumps(d, sort_keys=True)).encode()).hexdigest()[:20]
                    gid, n = base, 0
                    while db.execute("SELECT 1 FROM sync_id WHERE gid = ? UNION ALL SELECT 1 FROM sync_row "
                                     "WHERE tbl = ? AND key = ?", (gid, t, gid)).fetchone():
                        n += 1
                        gid = f"{base}.{n}"
                    db.execute("INSERT INTO sync_id (gid, tbl, id) VALUES (?, ?, ?)", (gid, t, r["id"]))
                    db.execute("INSERT INTO sync_out (t, tbl, op, key, data) VALUES (?, ?, 'i', ?, ?)", (t0, t, gid, r["d"]))
                    made += 1
                if not made:
                    break
        else:
            have = {r[0] for r in db.execute("SELECT key FROM sync_row WHERE tbl = ?", (t,))}
            have |= {r[0] for r in db.execute("SELECT key FROM sync_out WHERE tbl = ?", (t,))}
            for r in db.execute(f"SELECT {_key(i, t, 'NEW')} AS k, {_obj(i, 'NEW', i['data'])} AS d "
                                f"FROM {_q(t)} AS NEW WHERE 1{only}").fetchall():
                if r["k"] in have or None in json.loads(r["k"]):
                    continue
                db.execute("INSERT INTO sync_out (t, tbl, op, key, data) VALUES (?, ?, 'i', ?, ?)", (t0, t, r["k"], r["d"]))


# --- versions and tombstones -----------------------------------------------------------------

def _stamp(t, dev):
    """When a change was made, comparable as text: the clock, then the computer to break a tie."""
    return f"{int(t):015d}.{dev}"


def _rec(db, t, key):
    r = db.execute("SELECT ver, dead FROM sync_row WHERE tbl = ? AND key = ?", (t, key)).fetchone()
    return (json.loads(r[0]), r[1]) if r else ({}, None)


def _put_rec(db, t, key, ver, dead):
    db.execute("INSERT INTO sync_row (tbl, key, ver, dead) VALUES (?, ?, ?, ?) ON CONFLICT(tbl, key) "
               "DO UPDATE SET ver = excluded.ver, dead = excluded.dead", (t, key, json.dumps(ver), dead))


def _natkey(db, i, data):
    """A row's key as its own table's trigger would have written it, from its values as they travel."""
    return db.execute("SELECT json_array(" + ",".join("?" * len(i["pk"])) + ")", [data.get(c) for c in i["pk"]]).fetchone()[0]


def _note(db, T, e, stamp):
    """Record a change's time against the columns it set (or the row it deleted),
    keeping the newer where one is already there."""
    t, op, key = e["tbl"], e["op"], e["key"]
    ver, dead = _rec(db, t, key)
    if op == "d":
        _put_rec(db, t, key, {}, max(dead or "", stamp))
        return
    if op == "k":
        _put_rec(db, t, key, {}, max(dead or "", stamp))
        key = _natkey(db, T[t], e.get("data") or {}) if t in T else key
        ver, dead = _rec(db, t, key)
    for c in e.get("data") or {}:
        ver[c] = max(ver.get(c, ""), stamp)
    _put_rec(db, t, key, ver, None if op in ("i", "k") and stamp > (dead or "") else dead)


# --- files: encrypted, compressed JSON lines ---------------------------------------------------

def _keys(key):
    return hmac.digest(key, b"daybook sync: encrypt", "sha256"), hmac.digest(key, b"daybook sync: check", "sha256")


def _stream(k, nonce, n):
    return b"".join(hmac.digest(k, nonce + c.to_bytes(8, "big"), "sha256") for c in range((n + 31) // 32))[:n]


def seal(key, data):
    """Encrypt then MAC, from the standard library alone (it has no AES): HMAC-SHA256
    as the keystream's PRF in counter mode, then HMAC-SHA256 over nonce and ciphertext.
    ponytail: about 8 MB a second in Python; plenty for a day's changes."""
    ek, mk = _keys(key)
    nonce = secrets.token_bytes(16)
    ct = (int.from_bytes(data, "big") ^ int.from_bytes(_stream(ek, nonce, len(data)), "big")).to_bytes(len(data), "big")
    return MAGIC + nonce + ct + hmac.digest(mk, MAGIC + nonce + ct, "sha256")


def unseal(key, blob):
    ek, mk = _keys(key)
    if len(blob) < 52 or blob[:4] != MAGIC:
        raise ValueError("not a Daybook sync file")
    nonce, ct, tag = blob[4:20], blob[20:-32], blob[-32:]
    if not hmac.compare_digest(tag, hmac.digest(mk, blob[:-32], "sha256")):
        raise ValueError("does not open with this sync code, or has been changed")
    return (int.from_bytes(ct, "big") ^ int.from_bytes(_stream(ek, nonce, len(ct)), "big")).to_bytes(len(ct), "big")


def _write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _write(root, app, dev, key, schema_n, events):
    """The events in files of up to FILE_MAX each. Returns their names, as dev/file."""
    names, chunk, size = [], [], 0
    lines = [json.dumps(e, ensure_ascii=False, separators=(",", ":")) for e in events]
    for n, line in enumerate(lines):
        chunk.append(n)
        size += len(line)
        if size >= FILE_MAX or n == len(lines) - 1:
            head = json.dumps({"v": 1, "app": app, "dev": dev, "schema": schema_n})
            body = gzip.compress(("\n".join([head] + [lines[k] for k in chunk]) + "\n").encode())
            name = f"{events[chunk[0]]['t']:015d}-{events[chunk[-1]]['t']:015d}-{secrets.token_hex(4)}.dbk"
            _write_atomic(os.path.join(root, app, dev, name), seal(key, body))
            names.append(f"{dev}/{name}")
            chunk, size = [], 0
    return names


def _read(path, key):
    lines = gzip.decompress(unseal(key, open(path, "rb").read())).decode().splitlines()
    return json.loads(lines[0]), [json.loads(x) for x in lines[1:] if x]


# --- sending ------------------------------------------------------------------------------------

def export(db, app, T, root, dev, key):
    """What was changed here since last time, to a new file of this computer's."""
    rows = db.execute("SELECT * FROM sync_out ORDER BY seq").fetchall()
    if not rows:
        return []
    events = []
    for r in rows:
        if r["key"] is None:                  # its parent had already gone (a cascade): the parent's delete says it all
            continue
        e = {"t": r["t"], "tbl": r["tbl"], "op": r["op"], "key": r["key"]}
        for k in ("data", "old"):
            if r[k] is not None:
                e[k] = json.loads(r[k])
        events.append(e)
        _note(db, T, e, _stamp(e["t"], dev))
    names = _write(root, app, dev, key, schema(db), events) if events else []
    db.execute("DELETE FROM sync_out WHERE seq <= ?", (rows[-1]["seq"],))
    for n in names:
        db.execute("INSERT OR IGNORE INTO sync_file (name) VALUES (?)", (n,))
    return names


# --- receiving ----------------------------------------------------------------------------------

def _local_id(db, parent, gid):
    r = db.execute("SELECT id FROM sync_id WHERE gid = ?", (gid,)).fetchone()
    if r and db.execute(f"SELECT 1 FROM {_q(parent)} WHERE id = ?", (r[0],)).fetchone():
        return r[0]
    return GONE if _rec(db, parent, gid)[1] else WAIT


def _to_local(db, i, data):
    """Values as they travel, made this computer's: gids back to ids. Unknown columns
    (one added in Admin on the other computer) are left out."""
    out = {}
    for c, v in data.items():
        if c not in i["cols"]:
            continue
        if c in i["ref"] and v is not None:
            v = _local_id(db, i["ref"][c], v)
            if v in (WAIT, GONE):
                return v
        out[c] = v
    return out


def _locate(db, i, t, key):
    """(the row's key here as {column: value}, the key its versions are kept under), or (None, key)."""
    if i["surrogate"]:
        r = db.execute("SELECT id FROM sync_id WHERE gid = ?", (key,)).fetchone()
        if not r or not db.execute(f"SELECT 1 FROM {_q(t)} WHERE id = ?", (r[0],)).fetchone():
            return None, key
        canon = db.execute("SELECT gid FROM sync_id WHERE tbl = ? AND id = ? ORDER BY rowid LIMIT 1", (t, r[0])).fetchone()[0]
        return {"id": r[0]}, canon
    where = _to_local(db, i, dict(zip(i["pk"], json.loads(key))))
    if where in (WAIT, GONE):
        return None, key
    w = " AND ".join(f"{_q(c)} IS ?" for c in i["pk"])
    return (where if db.execute(f"SELECT 1 FROM {_q(t)} WHERE {w}", [where[c] for c in i["pk"]]).fetchone()
            else None), key


def _clash(db, i, t, vals):
    """The row here in the way of an insert, by one of the table's UNIQUE indexes."""
    for ix in db.execute(f"PRAGMA index_list({_q(t)})").fetchall():
        if not ix["unique"] or ix["origin"] == "pk":
            continue
        cols = [r["name"] for r in db.execute(f"PRAGMA index_info({_q(ix['name'])})").fetchall()]
        if not cols or None in cols or any(c not in vals for c in cols):
            continue
        where = " AND ".join(f"{_q(c)} IS ?" for c in cols)
        if ix["partial"]:
            sql = db.execute("SELECT sql FROM sqlite_master WHERE name = ?", (ix["name"],)).fetchone()[0]
            where += f" AND ({re.search(r'WHERE(.*)$', sql, re.I | re.S).group(1)})"
        r = db.execute(f"SELECT {', '.join(_q(c) for c in i['pk'])} FROM {_q(t)} WHERE {where}",
                       [vals[c] for c in cols]).fetchone()
        if r:
            return dict(r)
    return None


class Applier:
    """Changes from elsewhere, applied in clock order. Triggers are off meanwhile
    (sync_meta 'applying'), so nothing applied is sent back out."""

    def __init__(self, db, app, T):
        self.db, self.app, self.T = db, app, T
        self.problems, self.touched = [], set()

    def apply(self, e, stamp, dev):
        i = self.T.get(e["tbl"])
        if not i:
            return True                       # a table this computer does not sync
        t, op, key, db = e["tbl"], e["op"], e["key"], self.db
        data = e.get("data") or {}
        if op == "k":
            return self._rekey(i, t, key, data, stamp, dev)
        where, canon = _locate(db, i, t, key)
        ver, dead = _rec(db, t, canon)
        if op == "d":
            if where:
                try:
                    db.execute(f"DELETE FROM {_q(t)} WHERE " + " AND ".join(f"{_q(c)} IS ?" for c in where), list(where.values()))
                    self.touched.add(t)
                except sqlite3.IntegrityError as ex:
                    self.problems.append(f"{t}: could not delete a row deleted on {dev} ({ex})")
            _put_rec(db, t, canon, {}, max(dead or "", stamp))
            return True
        if dead and (op == "u" or stamp <= dead):
            return True                       # deleted here after this was made: the delete stands
        vals = _to_local(db, i, data)
        if vals == GONE:
            return True
        if vals == WAIT:
            return WAIT
        if where is None:
            return WAIT if op == "u" else self._insert(i, t, key, vals, stamp, dev)
        return self._update(i, t, canon, where, vals, e.get("old"), stamp, dev)

    def _insert(self, i, t, key, vals, stamp, dev):
        db = self.db
        cols = list(vals)
        try:
            cur = db.execute(f"INSERT INTO {_q(t)} ({', '.join(map(_q, cols))}) VALUES ({', '.join('?' * len(cols))})",
                             [vals[c] for c in cols])
        except sqlite3.IntegrityError as ex:
            if "FOREIGN KEY" in str(ex):
                return WAIT
            other = _clash(db, i, t, vals) if "UNIQUE" in str(ex) else None
            if not other or not i["surrogate"]:
                self.problems.append(f"{t}: a row from {dev} could not be added ({ex})")
                return True
            # the same thing made on both computers (a day's diary, the same Clockify shift): one row, both gids
            db.execute("INSERT OR REPLACE INTO sync_id (gid, tbl, id) VALUES (?, ?, ?)", (key, t, other["id"]))
            canon = db.execute("SELECT gid FROM sync_id WHERE tbl = ? AND id = ? ORDER BY rowid LIMIT 1",
                               (t, other["id"])).fetchone()[0]
            return self._update(i, t, canon, other, vals, None, stamp, dev, merging=True)
        if i["surrogate"]:
            db.execute("INSERT OR REPLACE INTO sync_id (gid, tbl, id) VALUES (?, ?, ?)", (key, t, cur.lastrowid))
        _put_rec(db, t, key, {c: stamp for c in cols}, None)
        self.touched.add(t)
        return True

    def _update(self, i, t, canon, where, vals, old, stamp, dev, merging=False):
        db = self.db
        w = " AND ".join(f"{_q(c)} IS ?" for c in where)
        cur = dict(db.execute(f"SELECT * FROM {_q(t)} WHERE {w}", list(where.values())).fetchone())
        ver, dead = _rec(db, t, canon)
        agreed = (getattr(self.app, "sync_merge", None) or (lambda *a: None))(db, t, cur, vals) if merging else None
        sets, lost = {}, {}
        for c, v in vals.items():
            if c in where:
                continue
            if agreed and c in agreed:        # both computers work it out the same way: no winner, nothing lost
                sets[c], ver[c] = agreed[c], max(ver.get(c, ""), stamp)
                continue
            if stamp <= ver.get(c, ""):
                continue                      # changed here more recently
            ver[c] = stamp
            if cur.get(c) == v:
                continue
            sets[c] = v
            concurrent = merging or (old is not None and c in old and c not in i["ref"] and old[c] != cur.get(c))
            if concurrent:
                lost[c] = cur.get(c)
        if sets:
            try:
                db.execute(f"UPDATE {_q(t)} SET " + ", ".join(f"{_q(c)} = ?" for c in sets) + f" WHERE {w}",
                           list(sets.values()) + list(where.values()))
            except sqlite3.IntegrityError as ex:
                if "FOREIGN KEY" in str(ex):
                    return WAIT
                self.problems.append(f"{t}: a change from {dev} could not be made ({ex})")
                return True
            self.touched.add(t)
        _put_rec(db, t, canon, ver, dead)
        if lost:
            from . import db as _db
            label = getattr(self.app, "LABELS", {}).get(t, t.replace("_", " "))
            _db.log_change(db, "sync", t, f"Sync: {label} {', '.join(sorted(lost))} changed here and on {dev}; "
                                          f"{dev}’s kept. Undo puts this computer’s back.",
                           entity_id=where.get("id"), detail={"undo": [{"op": "restore", "table": t, "rows": [{**where, **lost}]}]},
                           rows=1)
        return True

    def _rekey(self, i, t, key, data, stamp, dev):
        """A row whose own key changed (a payslip's pay date): moved, children and all."""
        db = self.db
        vals = _to_local(db, i, data)
        if vals == WAIT:
            return WAIT
        if vals == GONE:
            return True
        new = _natkey(db, i, data)
        where, _ = _locate(db, i, t, key)
        ver, dead = _rec(db, t, key)
        _put_rec(db, t, key, {}, max(dead or "", stamp))
        if where is None:
            return self.apply({"tbl": t, "op": "i", "key": new, "data": data}, stamp, dev)
        w = " AND ".join(f"{_q(c)} IS ?" for c in where)
        try:
            db.execute(f"UPDATE {_q(t)} SET " + ", ".join(f"{_q(c)} = ?" for c in vals) + f" WHERE {w}",
                       list(vals.values()) + list(where.values()))
        except sqlite3.IntegrityError as ex:
            self.problems.append(f"{t}: a row moved on {dev} could not be moved here ({ex})")
            return True
        _put_rec(db, t, new, {c: max(ver.get(c, ""), stamp) for c in vals}, None)
        self.touched.add(t)
        return True


def import_(db, app, T, root, key):
    """Apply every file of changes not applied yet. A file waiting on another (a
    change to a row whose file has not arrived) is tried again next time; applying
    one twice changes nothing."""
    base = os.path.join(root, app.NAME)
    done = {r[0] for r in db.execute("SELECT name FROM sync_file")}
    known, batch, files, problems = schema(db), [], [], []
    for dev in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        folder = os.path.join(base, dev)
        for f in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
            name = f"{dev}/{f}"
            if not f.endswith(".dbk") or name in done:
                continue
            try:
                head, events = _read(os.path.join(folder, f), key)
            except (OSError, ValueError, EOFError) as ex:
                problems.append(f"{name}: {ex}")
                continue
            if head.get("schema", 0) > known:
                problems.append(f"{head.get('dev', dev)} has a newer Daybook: update this computer to take its changes")
                continue
            files.append(name)
            batch += [(_stamp(e["t"], head.get("dev", dev)), name, n, e, head.get("dev", dev)) for n, e in enumerate(events)]
    if not batch:
        for name in files:
            db.execute("INSERT OR IGNORE INTO sync_file (name) VALUES (?)", (name,))
        return 0, 0, sorted(set(problems)), set()
    batch.sort(key=lambda b: b[:3])
    ap = Applier(db, app, T)
    waiting = set()
    _set(db, "applying", 1)
    try:
        for stamp, name, _n, e, dev in batch:
            if ap.apply(e, stamp, dev) == WAIT:
                waiting.add(name)
    finally:
        _set(db, "applying", 0)
    for name in files:
        if name not in waiting:
            db.execute("INSERT OR IGNORE INTO sync_file (name) VALUES (?)", (name,))
    top = max(int(b[3]["t"]) for b in batch)
    db.execute("UPDATE sync_meta SET v = MAX(v, ?) WHERE k = 'clock'", (top,))
    return len(batch), len(waiting), sorted(set(problems + ap.problems)), ap.touched


def sync_db(db, app, root, dev, key):
    """One round for one app's database: send what is new here, then take what is new elsewhere."""
    if not on(db):
        return {"off": True}
    T = tables(db, app)
    db.execute("BEGIN IMMEDIATE")
    try:
        sent = export(db, app.NAME, T, root, dev, key)
        got, waiting, problems, touched = import_(db, app, T, root, key)
        db.commit()
    except BaseException:
        db.rollback()
        raise
    if "custom_view" in touched:
        from . import db as _db
        _db.rebuild_views(db, app)
    return {"sent": len(sent), "got": got, "waiting": waiting, "problems": problems}


# --- switching it on and off, per database ----------------------------------------------------

def enable(db, app, first):
    db.executescript(TABLES)
    _set(db, "on", 1)
    _set(db, "db", os.path.basename(db.execute("PRAGMA database_list").fetchone()[2]))
    _set(db, "adopt_t", 1 if first else 0)
    rebuild_triggers(db, app)
    db.commit()


def disable(db):
    drop_triggers(db)
    for t in HIDDEN:
        db.execute(f"DROP TABLE IF EXISTS {t}")
    db.commit()


# --- the suite: where the folder is, the code, the round every minute --------------------------

def code_of(key):
    s = base64.b32encode(key).decode().rstrip("=")
    return "-".join(s[i:i + 4] for i in range(0, len(s), 4))


def key_of(code):
    s = re.sub(r"[^A-Z2-7]", "", (code or "").upper())
    if len(s) != 32:
        raise ValueError("a sync code is 32 letters and digits, in eight groups of four")
    return base64.b32decode(s)


def _check(key):
    return hmac.new(_keys(key)[1], b"daybook sync folder", "sha256").hexdigest()


def new_device():
    host = re.sub(r"[^a-z0-9]+", "-", socket.gethostname().lower()).strip("-")[:20] or "computer"
    return f"{host}-{secrets.token_hex(2)}"


class State:
    lock = threading.Lock()
    wake = threading.Event()
    started = False
    last = {}                  # the last round: when, what each app sent and got, and anything wrong


STATE = State()


def _suite():
    from . import suite
    return suite


def config():
    raw = _suite()._secret("sync")
    return json.loads(raw) if raw else None


def _save(cfg):
    s = _suite()
    db = s.store()
    try:
        if cfg is None:
            db.execute("DELETE FROM secret WHERE key = 'sync'")
        else:
            db.execute("INSERT INTO secret (key, value) VALUES ('sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                       (json.dumps(cfg),))
        db.commit()
    finally:
        db.close()


def root_of(cfg):
    """The folder the files are in: the one chosen, or for GitHub a copy of the repository's under data/."""
    if cfg["kind"] == "github":
        return os.path.join(_suite().SUITE.data, "sync-github")
    return os.path.abspath(os.path.expanduser(cfg["path"]))


def setup(kind, path=None, repo=None, token=None, branch="main", code=None):
    """Start sync from this computer (no code), or join one already started (its code).
    Every app's database is switched on; on a computer that joins, the rows it already
    has are matched to the same rows elsewhere where they are the same."""
    s = _suite()
    if config():
        raise ValueError("Sync is already on. Leave it first to use another folder.")
    if kind == "folder":
        if not path or not os.path.isdir(os.path.abspath(os.path.expanduser(path))):
            raise ValueError("pick a folder that exists: one OneDrive, Google Drive or a USB stick keeps")
        cfg = {"kind": "folder", "path": os.path.abspath(os.path.expanduser(path))}
    elif kind == "github":
        if not repo or not re.fullmatch(r"[\w.-]+/[\w.-]+", repo) or not token:
            raise ValueError("GitHub needs the repository as owner/name and a token that can write to it")
        cfg = {"kind": "github", "repo": repo, "token": token, "branch": branch or "main", "dir": "daybook-sync"}
    else:
        raise ValueError("sync goes through a folder or GitHub")
    cfg["dev"] = new_device()
    root = root_of(cfg)
    os.makedirs(root, exist_ok=True)
    try:
        remote = github_pull(cfg, root) if kind == "github" else None
    except (OSError, ValueError) as ex:
        raise ValueError(f"GitHub not reached: {ex}")
    check_path = os.path.join(root, CHECK)
    key = key_of(code) if code else None
    if os.path.isfile(check_path):
        if not key:
            raise ValueError("That folder already holds Daybook sync. Type its sync code: Admin → Sync on the computer that started it.")
        if json.load(open(check_path, encoding="utf-8")).get("check") != _check(key):
            raise ValueError("That sync code does not open this folder.")
        first = False
    else:
        key = key or secrets.token_bytes(20)
        _write_atomic(check_path, json.dumps({"v": 1, "check": _check(key)}).encode())
        first = True
    cfg["key"] = key.hex()
    _save(cfg)
    for name, app in s.SUITE.apps.items():
        db = s._db.connect(s.path(name))
        try:
            enable(db, app, first)
        finally:
            db.close()
    if kind == "github":
        github_push(cfg, root, remote or {})
    run()
    return code_of(key)


def leave():
    """This computer stops syncing. Its data stays as it is; the folder is left alone."""
    s = _suite()
    for name in s.SUITE.apps:
        db = s._db.connect(s.path(name))
        try:
            disable(db)
        finally:
            db.close()
    _save(None)
    STATE.last = {}


def run():
    """One round for every app. Safe to call at any time; one runs at once."""
    cfg = config()
    if not cfg:
        return None
    s = _suite()
    with STATE.lock:
        key, root = bytes.fromhex(cfg["key"]), root_of(cfg)
        out = {"at": time.strftime("%Y-%m-%d %H:%M:%S"), "apps": {}, "error": None}
        remote = None
        if cfg["kind"] == "github":
            try:
                remote = github_pull(cfg, root)
            except (OSError, ValueError) as ex:
                out["error"] = f"GitHub not reached ({ex}); changes wait here until it is"
        check_path = os.path.join(root, CHECK)
        if not os.path.isfile(check_path):
            out["error"] = out["error"] or f"The sync folder is not there ({root}): is the drive plugged in, or OneDrive running?"
            STATE.last = out
            return out
        if json.load(open(check_path, encoding="utf-8")).get("check") != _check(key):
            out["error"] = "The sync folder now belongs to another sync code. Leave sync and join again."
            STATE.last = out
            return out
        for name, app in s.SUITE.apps.items():
            db = s._db.connect(s.path(name))
            try:
                out["apps"][name] = sync_db(db, app, root, cfg["dev"], key)
            except Exception as ex:                # one app's trouble leaves the others syncing, and shows in Admin
                out["apps"][name] = {"error": f"{type(ex).__name__}: {ex}"}
            finally:
                db.close()
        if remote is not None:
            try:
                github_push(cfg, root, remote)
            except (OSError, ValueError) as ex:
                out["error"] = f"GitHub not reached ({ex}); changes wait here until it is"
        STATE.last = out
        return out


def status():
    cfg = config()
    if not cfg:
        return {"on": False}
    where = f"github.com/{cfg['repo']}" if cfg["kind"] == "github" else cfg["path"]
    return {"on": True, "kind": cfg["kind"], "where": where, "device": cfg["dev"], "last": STATE.last}


def soon():
    """A write was made: sync shortly, not in a minute."""
    STATE.wake.set()


def start(every=60, settle=3):
    """The round in the background: every minute, and a few seconds after a write."""
    if STATE.started:
        return
    STATE.started = True

    def loop():
        while True:
            try:
                run()
            except Exception as ex:                # the server carries on; the error shows in Admin
                STATE.last = {"at": time.strftime("%Y-%m-%d %H:%M:%S"), "apps": {}, "error": str(ex)}
            STATE.wake.wait(every)
            if STATE.wake.is_set():
                STATE.wake.clear()
                time.sleep(settle)
    threading.Thread(target=loop, name="daybook-sync", daemon=True).start()


# --- GitHub: the folder, mirrored to a repository --------------------------------------------

API = "https://api.github.com"


def _gh(cfg, method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {cfg['token']}", "Accept": "application/vnd.github+json",
                                          "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "daybook"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as ex:
        if ex.code in (404, 409) and method == "GET":
            return None                        # an empty repository has no tree yet
        raise ValueError(f"GitHub said {ex.code} {ex.reason}")


def github_pull(cfg, root):
    """Fetch every file the repository has that this copy does not. Returns {path: sha} of the repository's."""
    pre = cfg.get("dir", "daybook-sync") + "/"
    tree = _gh(cfg, "GET", f"/repos/{cfg['repo']}/git/trees/{cfg.get('branch', 'main')}?recursive=1") or {"tree": []}
    remote = {x["path"][len(pre):]: x["sha"] for x in tree["tree"] if x["type"] == "blob" and x["path"].startswith(pre)}
    for rel, sha in remote.items():
        local = os.path.join(root, *rel.split("/"))
        if not os.path.exists(local):
            blob = _gh(cfg, "GET", f"/repos/{cfg['repo']}/git/blobs/{sha}")
            _write_atomic(local, base64.b64decode(blob["content"]))
    return remote


def github_push(cfg, root, remote):
    """Send every file this copy has that the repository does not: this computer's new ones."""
    pre = cfg.get("dir", "daybook-sync")
    for folder, _dirs, files in os.walk(root):
        for f in sorted(files):
            if not (f.endswith(".dbk") or f == CHECK):
                continue
            rel = os.path.relpath(os.path.join(folder, f), root).replace(os.sep, "/")
            if rel in remote:
                continue
            body = {"message": f"daybook sync: {cfg['dev']}", "branch": cfg.get("branch", "main"),
                    "content": base64.b64encode(open(os.path.join(folder, f), "rb").read()).decode()}
            _gh(cfg, "PUT", f"/repos/{cfg['repo']}/contents/{pre}/{rel}", body)
            remote[rel] = "sent"
