"""Endpoints every app gets.

Every table is readable and writable at <app>/api/t/<name> and every view
readable at <app>/api/v/<name>, so a new view or a column added in Admin is on
the API with no change here. That is only safe because identifiers are checked
against the live schema before they are interpolated, and values are always bound.

Every write through this module records how to reverse itself, which is what
the Undo button replays. An app adds its own endpoints with app.route(), and
can step in around writes with app.before_write() and app.after_write().
"""
import json
import os
import pathlib
import re
import sqlite3
import sys

from . import db as _db

OPS = {"gte": ">=", "lte": "<=", "like": "LIKE", "ne": "<>", "gt": ">", "lt": "<"}
HIDDEN = {"secret", "schema_version", "app_db", "sync_meta", "sync_id", "sync_row", "sync_out", "sync_file"}  # never through the generic API
ADMIN_WRITE = {"layout", "custom_view", "field_meta", "theme", "ui_text"}  # structure, not data
RESERVED_Q = {"order", "limit", "offset", "desc", "t", "search"}


class Err(Exception):
    def __init__(self, code, msg):
        self.code, self.msg = code, msg


class File:
    """A download rather than JSON."""
    def __init__(self, data, name, ctype="application/octet-stream"):
        self.data, self.name, self.ctype = data, name, ctype


class Ctx:
    """Who is asking, which app, and where its files live. Built by the server
    per request. switch(path) points the app at another database; meta is what
    the suite adds to /meta (themes, the theme in use, the other apps)."""
    def __init__(self, admin=False, db_path=None, backup_dir=None, switch=None, app=None, meta=None):
        self.admin, self.db_path, self.backup_dir, self.switch = admin, db_path, backup_dir, switch
        self.app, self.meta = app, meta or {}


def hook(ctx, name, *a):
    fn = getattr(ctx.app, name, None) if ctx and ctx.app else None
    return fn(*a) if fn else None


# --- the trust boundary ------------------------------------------------------

def schema(db):
    return {r["name"]: r["type"] for r in db.execute(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') "
        "AND name NOT LIKE 'sqlite_%'")}


def columns(db, name):
    return {r["name"]: r for r in db.execute(f'PRAGMA table_xinfo("{name}")')}


def pk_cols(db, name):
    return [c["name"] for c in sorted(columns(db, name).values(), key=lambda c: c["pk"])
            if c["pk"]]


def need(db, name, want=None):
    objs = schema(db)
    if name not in objs or name in HIDDEN:
        raise Err(404, f"no such table or view: {name}")
    if want and objs[name] != want:
        raise Err(400, f"{name} is a {objs[name]}, not a {want}")
    return name


def rows(db, name, query):
    cols = columns(db, name)
    where, args = [], []
    for k, v in query.items():
        if k in RESERVED_Q:
            continue
        col, _, op = k.rpartition("__")
        if col and op in OPS:
            if col not in cols:
                raise Err(400, f"unknown column: {col}")
            where.append(f'"{col}" {OPS[op]} ?')
            args.append(_num(v[0]) if op != "like" else v[0])
            continue
        if k not in cols:
            raise Err(400, f"unknown column: {k}")
        if v[0] == "":
            where.append(f'"{k}" IS NULL')
        else:
            # a query string is text, but a view's computed column has no type
            # to convert it by: 2026 must match whether it is stored as 2026 or '2026'
            where.append(f'"{k}" IN (?, ?)')
            args += [v[0], _num(v[0])]
    term = (query.get("search") or [""])[0].strip()
    if term:
        where.append("(" + " OR ".join(f'CAST("{c}" AS TEXT) LIKE ?' for c in cols) + ")")
        args += [f"%{term}%"] * len(cols)
    sql = f'SELECT * FROM "{name}"'
    if where:
        sql += " WHERE " + " AND ".join(where)
    order = query.get("order", [None])[0]
    if order:
        if order not in cols:
            raise Err(400, f"unknown column: {order}")
        sql += f' ORDER BY "{order}"' + (" DESC" if "desc" in query else "")
    limit = query.get("limit", [None])[0]
    if limit:
        sql += " LIMIT ?"
        args.append(int(limit))
        if query.get("offset", [None])[0]:
            sql += " OFFSET ?"
            args.append(int(query["offset"][0]))
    return [dict(r) for r in db.execute(sql, args)]


def _num(v):
    if re.fullmatch(r"-?\d+", v or ""):
        return int(v)
    if re.fullmatch(r"-?\d+\.\d+", v or ""):
        return float(v)
    return v


# --- writing, and remembering how to unwrite ---------------------------------

def _put(db, name, row):
    """Update in place when the row exists, insert when it does not. Never
    REPLACE (it deletes first, and a delete cascades), and never INSERT ... ON
    CONFLICT for a partial row: SQLite checks NOT NULL before the conflict."""
    pks = pk_cols(db, name)
    names = list(row)
    if pks and all(k in row for k in pks):
        sets = [c for c in names if c not in pks]
        if sets:
            cur = db.execute(f'UPDATE "{name}" SET ' + ",".join(f'"{c}"=?' for c in sets)
                             + " WHERE " + " AND ".join(f'"{k}"=?' for k in pks),
                             [row[c] for c in sets] + [row[k] for k in pks])
            if cur.rowcount:
                return cur
        elif db.execute(f'SELECT 1 FROM "{name}" WHERE ' + " AND ".join(f'"{k}"=?' for k in pks),
                        [row[k] for k in pks]).fetchone():
            return db.execute("SELECT 1")
    return db.execute(f'INSERT INTO "{name}" ({",".join(chr(34) + c + chr(34) for c in names)}) '
                      f'VALUES ({",".join("?" for _ in names)})', [row[c] for c in names])


def _select(db, name, where):
    w = " AND ".join(f'"{k}" IS ?' for k in where)
    return [dict(r) for r in db.execute(f'SELECT * FROM "{name}" WHERE {w}', list(where.values()))]


def _dependents(db, table, parents, depth=0):
    """Rows elsewhere that point at these, so a delete can be put back whole."""
    out = []
    if not parents or depth > 20:
        return out
    for child in [n for n, t in schema(db).items() if t == "table"]:
        for fk in db.execute(f'PRAGMA foreign_key_list("{child}")').fetchall():
            if fk["table"] != table:
                continue
            to = fk["to"] or pk_cols(db, table)[0]
            vals = [p[to] for p in parents if p.get(to) is not None]
            if not vals:
                continue
            got = [dict(r) for r in db.execute(
                f'SELECT * FROM "{child}" WHERE "{fk["from"]}" IN ({",".join("?" * len(vals))})',
                vals)]
            if not got:
                continue
            out.append({"op": "restore", "table": child, "rows": got})
            if fk["on_delete"] == "CASCADE":
                out += _dependents(db, child, got, depth + 1)
    return out


def _writable(db, name):
    """Only real columns: generated ones are computed, not written."""
    return {n: c for n, c in columns(db, name).items() if not c["hidden"]}


def upsert(db, name, body, log=True, ctx=None):
    cols = _writable(db, name)
    pks = pk_cols(db, name)
    undo, ids = [], []
    for row in (body if isinstance(body, list) else [body]):
        if not isinstance(row, dict):
            raise Err(400, "each row must be an object")
        bad = set(row) - set(cols)
        if bad:
            raise Err(400, f"unknown column(s): {', '.join(sorted(bad))}")
        hook(ctx, "before_write", db, name, row)
        key = {k: row[k] for k in pks if row.get(k) not in (None, "")}
        existing = _select(db, name, key) if pks and len(key) == len(pks) else []
        if existing:
            # an emptied box is NULL, except where the column must hold something: there it is ''
            row = {k: (None if v == "" and not cols[k]["notnull"] else v) for k, v in row.items()}
            undo.append({"op": "restore", "table": name, "rows": existing})
            _put(db, name, row)
        else:
            row = {k: v for k, v in row.items() if v is not None and (v != "" or cols[k]["notnull"])}
            if not row:
                raise Err(400, "empty row")
            cur = _put(db, name, row)
            if len(pks) == 1 and pks[0] not in row:
                row[pks[0]] = cur.lastrowid
            key = {k: row.get(k) for k in pks}
            undo.append({"op": "remove", "table": name, "pk": pks[0], "ids": [row[pks[0]]]}
                        if len(pks) == 1 else
                        {"op": "remove_where", "table": name, "where": key or row})
        ids.append(key[pks[0]] if len(pks) == 1 else key)
    if log:
        what = "Edited" if all(u["op"] == "restore" for u in undo) else "Added"
        shown = [f"#{i}" if not isinstance(i, dict) else "" for i in ids[:5]]
        _db.log_change(db, "edit", name, f"{what} {label(ctx, name)} " + ", ".join(x for x in shown if x)
                       + ("…" if len(ids) > 5 else ""),
                       entity_id=ids[0] if len(ids) == 1 and not isinstance(ids[0], dict) else None,
                       detail={"undo": undo[::-1]}, rows=len(ids))
    db.commit()
    hook(ctx, "after_write", db, {name}, "write")
    return {"ok": True, "n": len(ids), "ids": ids}


def delete(db, name, key=None, query=None, ctx=None):
    if key is not None:
        pk = pk_cols(db, name)[0]
        where, args = f'"{pk}" = ?', [key]
    else:
        cols = columns(db, name)
        parts, args = [], []
        for k, v in (query or {}).items():
            if k == "t":
                continue
            if k not in cols:
                raise Err(400, f"unknown column: {k}")
            parts.append(f'"{k}" = ?')
            args.append(v[0])
        if not parts:
            raise Err(400, "refusing to delete every row: name a filter")
        where = " AND ".join(parts)
    before = [dict(r) for r in db.execute(f'SELECT * FROM "{name}" WHERE {where}', args)]
    undo = ([{"op": "restore", "table": name, "rows": before}]
            + _dependents(db, name, before)) if before else []
    cur = db.execute(f'DELETE FROM "{name}" WHERE {where}', args)
    if cur.rowcount:
        _db.log_change(db, "delete", name, f"Deleted {cur.rowcount} {label(ctx, name)}",
                       detail={"undo": undo}, rows=cur.rowcount)
    db.commit()
    hook(ctx, "after_write", db, {name}, "delete")
    return {"ok": True, "deleted": cur.rowcount}


def label(ctx, name):
    return (getattr(ctx.app, "LABELS", {}) if ctx and ctx.app else {}).get(name, name.replace("_", " "))


def undo(db, change_id=None, ctx=None):
    sql = ("SELECT * FROM change_log WHERE undone = 0 AND detail LIKE '%\"undo\"%' "
           + ("AND id = ? " if change_id else "") + "ORDER BY id DESC LIMIT 1")
    row = db.execute(sql, (change_id,) if change_id else ()).fetchone()
    if not row:
        raise Err(404, "nothing to undo")
    ops = json.loads(row["detail"])["undo"]
    touched = set()
    for op in ops:
        t = op["table"]
        touched.add(t)
        if op["op"] == "restore":
            for r in op["rows"]:
                keep = _writable(db, t)
                _put(db, t, {k: v for k, v in r.items() if k in keep})
        elif op["op"] == "remove":
            ids = op["ids"]
            db.execute(f'DELETE FROM "{t}" WHERE "{op["pk"]}" IN ({",".join("?" * len(ids))})', ids)
        elif op["op"] == "remove_where":
            w = op["where"]
            db.execute(f'DELETE FROM "{t}" WHERE ' + " AND ".join(f'"{k}" IS ?' for k in w),
                       list(w.values()))
    db.execute("UPDATE change_log SET undone = 1 WHERE id = ?", (row["id"],))
    _db.log_change(db, "undo", row["entity"], f"Undid: {row['summary']}")
    db.commit()
    hook(ctx, "after_write", db, touched, "undo")
    return {"ok": True, "undid": row["summary"]}


# --- routing -----------------------------------------------------------------

def route(db, method, parts, query, body, ctx=None):
    ctx = ctx or Ctx()
    app = ctx.app
    p = parts
    g = lambda k, d=None: (query.get(k) or [d])[0]
    body = body if body is not None else {}

    if p == ["meta"]:
        objs = schema(db)
        cols = lambda n: [{"name": c["name"], "type": c["type"], "pk": c["pk"],
                           "notnull": c["notnull"], "generated": bool(c["hidden"])}
                          for c in columns(db, n).values()]
        out = {
            "app": getattr(app, "NAME", None), "title": getattr(app, "TITLE", None),
            "version": _db.APP_VERSION,
            "schema": db.execute("SELECT MAX(n) n FROM schema_version").fetchone()["n"],
            "tables": {n: cols(n) for n, t in objs.items() if t == "table" and n not in HIDDEN},
            "views": {n: cols(n) for n, t in objs.items() if t == "view"},
            "settings": _db.settings(db),
            "fields": [dict(r) for r in db.execute("SELECT * FROM field_meta")],
            "layouts": [dict(r) for r in db.execute("SELECT * FROM layout ORDER BY sort, page")],
            "text": {r["original"]: r["text"] for r in db.execute("SELECT * FROM ui_text")},
            "admin": ctx.admin,
            "db": os.path.basename(ctx.db_path) if ctx.db_path else None,
            "db_usual": f"{getattr(app, 'NAME', '')}.db",
            "measures": bool(getattr(app, "MEASURES", None)),
            "sources": getattr(app, "SOURCES", {}),       # {view or table: [title, what a row is]}, for making panels
        }
        out.update(hook(ctx, "meta", db) or {})
        for k, v in ctx.meta.items():          # the suite's part: themes, the theme in use, the apps
            out[k] = dict(out[k], **v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
        return 200, out

    # generic table + view access
    if p[:1] == ["t"] and len(p) >= 2:
        name = need(db, p[1], "table")
        if method == "GET":
            return 200, rows(db, name, query)
        if name in ADMIN_WRITE and not ctx.admin:
            raise Err(401, "sign in to change the layout")
        if method == "POST":
            return 200, upsert(db, name, body, ctx=ctx)
        if method == "DELETE":
            if len(p) == 3:
                return 200, delete(db, name, key=p[2], ctx=ctx)
            if len(p) == 2:
                return 200, delete(db, name, query=query, ctx=ctx)
        raise Err(405, "method not allowed")

    if p[:1] == ["v"] and len(p) == 2:
        if method != "GET":
            raise Err(405, "views are read-only")
        return 200, rows(db, need(db, p[1], "view"), query)

    # --- undo ----------------------------------------------------------------
    if p == ["changes"] and method == "GET":
        return 200, [dict(r) for r in db.execute(
            "SELECT id, at, action, entity, summary, rows, undone, "
            "detail LIKE '%\"undo\"%' AS undoable FROM change_log ORDER BY id DESC LIMIT ?",
            (int(g("limit", 100)),))]
    if p[:1] == ["undo"] and method == "POST":
        return 200, undo(db, int(p[1]) if len(p) == 2 else None, ctx)

    # --- what every app offers the rest of the suite ---------------------------
    if p == ["search"] and method == "GET":
        return 200, search(db, getattr(app, "SEARCH", []), g("q", ""))
    if p == ["home"] and method == "GET":
        return 200, hook(ctx, "home", db) or {}
    if p == ["calendar"] and method == "GET":
        return 200, hook(ctx, "calendar", db, g("from", "1900-01-01"), g("to", "2999-12-31")) or []

    # --- figures for formulas: 2026.May.Hours and the like --------------------
    measures = getattr(app, "MEASURES", None) or {}
    if p == ["measures"] and method == "GET":
        return 200, [{"name": k, "about": v[3]} for k, v in measures.items()]
    if p == ["measures"] and method == "POST":
        return 200, {"values": [measure(db, measures, r.get("name", ""), r.get("from"), r.get("to"))
                                for r in (body.get("refs") or [])[:200]]}

    # --- admin ---------------------------------------------------------------
    if p[:1] == ["admin"]:
        if not ctx.admin:
            raise Err(401, "sign in first")
        return admin(db, method, p[1:], query, body, ctx)

    got = hook(ctx, "route", db, method, p, query, body, ctx)
    if got is not None:
        return got
    raise Err(404, "no such endpoint")


# --- search ------------------------------------------------------------------
# An app's SEARCH: (kind, SELECT..., [fields to match], amount column or None, ORDER BY).
# Every word must appear somewhere in the row; a number also finds that amount.

def search(db, groups, q, limit=40):
    words = [w for w in q.split() if w][:8]
    if not words:
        return []
    amount = _maybe_float(q) if re.fullmatch(r"\s*[£-]?[\d,]+(\.\d+)?\s*", q) else None
    like = lambda w: "%" + w.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    out = []
    for kind, sql, fields, money, order in groups:
        where = " AND ".join("(" + " OR ".join(f"COALESCE({f},'') LIKE ? ESCAPE '\\'" for f in fields) + ")"
                             for _ in words)
        args = [like(w) for w in words for _ in fields]
        if amount is not None and money:
            where = f"({where}) OR ROUND(ABS({money}), 2) = ?"
            args.append(round(abs(amount), 2))
        found = [dict(r) for r in db.execute(f"SELECT * FROM ({sql} WHERE {where} ORDER BY {order}) LIMIT ?",
                                             args + [limit + 1])]
        if found:
            out.append({"kind": kind, "rows": found[:limit], "more": len(found) > limit})
    return out


def _maybe_float(v):
    """'24,000' and '£1,234.50' are numbers: in the UK a comma groups thousands."""
    if isinstance(v, str):
        v = v.replace(",", "").replace("£", "").strip()
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def measure(db, measures, name, date_from, date_to):
    key = {k.lower(): k for k in measures}.get(str(name).lower().replace("_", ""))
    if not key:
        return {"error": f"no figure called {name}"}
    view, col, expr, _ = measures[key]
    row = db.execute(f'SELECT {expr} FROM "{view}" WHERE "{col}" BETWEEN ? AND ?',
                     (date_from or "1900-01-01", date_to or "2999-12-31")).fetchone()
    return round(row[0] or 0, 4)


# --- admin -------------------------------------------------------------------

def _slug(s):
    return re.sub(r"[^a-z0-9_]+", "_", (s or "").strip().lower()).strip("_")


def _backups(ctx):
    folder = _db.backup_folder(ctx.db_path, ctx.backup_dir)
    stem = os.path.basename(ctx.db_path) + "."
    if not os.path.isdir(folder):
        return folder, []
    out = []
    for f in os.listdir(folder):
        if f.startswith(stem):
            st = os.stat(os.path.join(folder, f))
            out.append({"name": f, "size": st.st_size, "modified": int(st.st_mtime)})
    return folder, sorted(out, key=lambda x: (-x["modified"], x["name"]))


# --- switching databases -----------------------------------------------------
DB_EXT = (".db", ".sqlite", ".sqlite3")
NOT_OURS = ("suite.db",)


def _db_files(ctx):
    """Database files beside the open one, less the suite's own and the other apps'."""
    here = os.path.abspath(ctx.db_path)
    others = set(getattr(ctx.app, "OTHERS", ()))
    out = []
    folder = os.path.dirname(here)
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        path = os.path.join(folder, name)
        if (name.lower().endswith(DB_EXT) and os.path.isfile(path) and name not in NOT_OURS
                and name[:-3] not in others):
            st = os.stat(path)
            out.append({"name": name, "path": path, "folder": folder, "size": st.st_size,
                        "modified": st.st_mtime, "current": path == here})
    return out


def inspect_db(path, app):
    """What a database file holds, read without changing it, and whether this app can open it."""
    path = os.path.abspath(os.path.expanduser(path or ""))
    if not path.lower().endswith(DB_EXT) or not os.path.isfile(path):
        raise Err(400, "pick a .db file that exists")
    info = {"path": path, "name": os.path.basename(path), "size": os.path.getsize(path), "problem": None, "facts": []}
    try:
        ro = sqlite3.connect(pathlib.Path(path).as_uri() + "?mode=ro", uri=True)
        ro.row_factory = sqlite3.Row
    except sqlite3.Error as e:
        return dict(info, problem=f"cannot open it: {e}")
    try:
        check = ro.execute("PRAGMA quick_check").fetchone()[0]
        if check != "ok":
            return dict(info, problem=f"it is damaged ({check})")
        has = {r[0] for r in ro.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        known = _db.known(app)
        schema_n = ro.execute("SELECT MAX(n) FROM schema_version").fetchone()[0] if "schema_version" in has else None
        if (schema_n is None and has - {"sqlite_sequence"}) or (schema_n and app.SIGNATURE not in has):
            return dict(info, problem=f"it is not a {app.TITLE} database")
        info.update(schema=schema_n or 0, app_schema=known,
                    upgrade=(schema_n or 0) < known, newer=(schema_n or 0) > known)
        count = lambda t: ro.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] if t in has else 0
        span = lambda t, c: tuple(ro.execute(f'SELECT MIN("{c}"), MAX("{c}") FROM "{t}"').fetchone()) if t in has else (None, None)
        info["facts"] = app.inspect(count, span) if hasattr(app, "inspect") else []
        if info["newer"]:
            info["problem"] = "a newer copy of the app made it; update this one first"
        return info
    except sqlite3.DatabaseError as e:                    # not a database at all, or badly damaged
        return dict(info, problem=f"it cannot be read ({e})")
    finally:
        ro.close()


def switch_db(ctx, body):
    """Check the file, back up the one being left, then point the app at it. One
    password now covers everything, so the file's own old password is not asked for."""
    info = inspect_db(body.get("path"), ctx.app)
    if info["problem"]:
        raise Err(400, f"{info['name']}: {info['problem']}")
    if info["path"] == os.path.abspath(ctx.db_path):
        raise Err(400, "that database is already open")
    return _open(ctx, info["path"])


def _open(ctx, path):
    try:
        _db.back_up(ctx.db_path, ctx.backup_dir, label="switch")
        _db.open_db(path, ctx.app, ctx.backup_dir, quiet=True).close()      # checks, backs up, upgrades
    except _db.Stop as e:
        raise Err(400, str(e))
    ctx.switch(path)
    return {"ok": True, "db": os.path.basename(path)}


def new_db(ctx, body):
    name = (body.get("name") or "").strip()
    if not re.fullmatch(r"[\w .()-]{1,60}", name):
        raise Err(400, "give it a plain name: letters, numbers, spaces, dashes")
    path = os.path.join(os.path.dirname(os.path.abspath(ctx.db_path)),
                        name if name.lower().endswith(DB_EXT) else name + ".db")
    if os.path.exists(path) or os.path.basename(path) in NOT_OURS:
        raise Err(409, f"{os.path.basename(path)} already exists")
    if body.get("copy"):                                   # a copy to try things on
        src = _db.connect(ctx.db_path)
        try:
            with sqlite3.connect(path) as dest:
                src.backup(dest)
            dest.close()
        finally:
            src.close()
    return _open(ctx, path)


def admin(db, method, p, query, body, ctx):
    if p == ["db"] and method == "GET":
        return 200, {"current": os.path.abspath(ctx.db_path), "files": _db_files(ctx)}
    if p == ["db", "inspect"] and method == "GET":
        return 200, inspect_db((query.get("path") or [""])[0], ctx.app)
    if p == ["db", "switch"] and method == "POST":
        return 200, switch_db(ctx, body)
    if p == ["db", "new"] and method == "POST":
        return 200, new_db(ctx, body)

    if p == ["sql"] and method == "POST":
        return 200, run_sql(db, body.get("sql") or "", ctx)

    if p == ["views"] and method == "GET":
        return 200, {"views": [dict(r) for r in db.execute("SELECT * FROM custom_view ORDER BY name")],
                     "errors": _db.VIEW_ERRORS.get(_db.db_file(db), {})}
    if p == ["views"] and method == "POST":
        name = "cv_" + _slug(body.get("name", "")).removeprefix("cv_")
        sql = (body.get("sql") or "").strip().rstrip(";")
        if name == "cv_" or not sql:
            raise Err(400, "a saved view needs a name and a query")
        try:
            db.execute(f'CREATE TEMP VIEW "_check" AS {sql}')
            db.execute('SELECT * FROM "_check" LIMIT 1').fetchall()
        except sqlite3.Error as e:
            raise Err(400, f"that query does not run: {e}")
        finally:
            db.execute('DROP VIEW IF EXISTS temp."_check"')
        db.execute("INSERT INTO custom_view (name, sql, note) VALUES (?,?,?) ON CONFLICT(name) "
                   "DO UPDATE SET sql = excluded.sql, note = excluded.note",
                   (name, sql, body.get("note")))
        _db.log_change(db, "setting", "custom_view", f"Saved view {name}")
        db.commit()
        _db.rebuild_views(db, ctx.app)
        return 200, {"ok": True, "name": name}
    if p[:1] == ["views"] and len(p) == 2 and method == "DELETE":
        db.execute("DELETE FROM custom_view WHERE name = ?", (p[1],))
        _db.log_change(db, "setting", "custom_view", f"Deleted view {p[1]}")
        db.commit()
        _db.rebuild_views(db, ctx.app)
        return 200, {"ok": True}

    if p == ["columns"] and method == "POST":
        return 200, add_column(db, body, ctx)
    if p[:1] == ["columns"] and len(p) == 3 and method == "DELETE":
        return 200, drop_column(db, p[1], p[2], ctx)

    if p == ["backups"] and method == "GET":
        folder, files = _backups(ctx)
        return 200, {"folder": folder, "files": files}
    if p == ["backup"] and method == "POST":
        path = _db.back_up(ctx.db_path, ctx.backup_dir, label="manual")
        return 200, {"ok": True, "name": os.path.basename(path)}
    if p == ["restore"] and method == "POST":
        return 200, restore(db, body.get("name") or "", ctx)
    if p == ["download"] and method == "GET":
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "copy.db")
            with sqlite3.connect(out) as dest:
                db.backup(dest)
            dest.close()
            data = open(out, "rb").read()
        return 200, File(data, os.path.basename(ctx.db_path))

    if p == ["health"] and method == "GET":
        tables = [n for n, t in schema(db).items() if t == "table"]
        return 200, {
            "integrity": db.execute("PRAGMA quick_check").fetchone()[0],
            "schema": db.execute("SELECT MAX(n) FROM schema_version").fetchone()[0],
            "app_version": _db.APP_VERSION, "sqlite": sqlite3.sqlite_version,
            "python": sys.version.split()[0],
            "db_path": ctx.db_path,
            "db_size": os.path.getsize(ctx.db_path) if ctx.db_path else None,
            "backups": _db.backup_folder(ctx.db_path, ctx.backup_dir) if ctx.db_path else None,
            "tables": [{"name": t, "rows": db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]}
                       for t in sorted(tables)],
            "view_errors": _db.VIEW_ERRORS.get(_db.db_file(db), {}),
        }
    raise Err(404, "no such admin tool")


READ_FIRST = ("SELECT", "WITH", "PRAGMA", "EXPLAIN", "VALUES")


def run_sql(db, sql, ctx):
    """Reads run on a read-only connection, so nothing slips through. Anything
    else is preceded by a backup, runs in one transaction, and is logged."""
    sql = sql.strip()
    if not sql:
        raise Err(400, "nothing to run")
    first = (re.match(r"\s*(\w+)", sql) or [None, ""])[1].upper()
    if first in READ_FIRST:
        ro = sqlite3.connect(pathlib.Path(os.path.abspath(ctx.db_path)).as_uri() + "?mode=ro",
                             uri=True)
        try:
            cur = ro.execute(sql)
            cols = [d[0] for d in cur.description or []]
            data = cur.fetchmany(5001)
        except sqlite3.Error as e:
            raise Err(400, str(e))
        finally:
            ro.close()
        return {"columns": cols, "rows": [list(r) for r in data[:5000]],
                "truncated": len(data) > 5000}
    path = _db.back_up(ctx.db_path, ctx.backup_dir, label="sql")
    before = db.total_changes
    try:
        db.executescript("BEGIN;\n" + sql + "\n;\nCOMMIT;")
    except sqlite3.Error as e:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise Err(400, f"{e} — nothing was changed")
    changed = db.total_changes - before
    _db.log_change(db, "sql", "database", sql[:300], detail={"backup": os.path.basename(path)},
                   rows=changed)
    db.commit()
    try:
        _db.rebuild_views(db, ctx.app)
    except sqlite3.Error as e:
        return {"changed": changed, "backup": os.path.basename(path),
                "warning": f"the app's own views no longer build: {e}. Restore the backup."}
    return {"changed": changed, "backup": os.path.basename(path)}


COLUMN_TYPES = {"text": "TEXT", "number": "REAL", "date": "TEXT", "yesno": "INTEGER"}
NO_COLUMNS = HIDDEN | ADMIN_WRITE | {"change_log", "setting", "format_profile"}


def add_column(db, body, ctx):
    table = body.get("table") or ""
    need(db, table, "table")
    if table in NO_COLUMNS:
        raise Err(400, f"{table} does not take extra columns")
    col = "x_" + _slug(body.get("name")).removeprefix("x_")
    if col == "x_":
        raise Err(400, "the column needs a name")
    if col in columns(db, table):
        raise Err(409, f"{table} already has {col}")
    typ = COLUMN_TYPES.get(body.get("type") or "text", "TEXT")
    formula = (body.get("formula") or "").strip()
    _db.back_up(ctx.db_path, ctx.backup_dir, label="columns")
    ddl = f'ALTER TABLE "{table}" ADD COLUMN "{col}" {typ}'
    if formula:
        ddl += f" GENERATED ALWAYS AS ({formula}) VIRTUAL"
    try:
        db.execute(ddl)
        db.execute(f'SELECT "{col}" FROM "{table}" LIMIT 1').fetchall()
    except sqlite3.Error as e:
        db.rollback()
        raise Err(400, f"could not add it: {e}")
    db.execute("INSERT INTO field_meta (tbl, col, label) VALUES (?,?,?) ON CONFLICT(tbl, col) "
               "DO UPDATE SET label = excluded.label",
               (table, col, body.get("label") or body.get("name")))
    _db.log_change(db, "schema", table, f"Added column {col} to {table}"
                   + (f" = {formula}" if formula else ""))
    db.commit()
    _db.rebuild_views(db, ctx.app)
    return {"ok": True, "column": col}


def drop_column(db, table, col, ctx):
    need(db, table, "table")
    if not col.startswith("x_") or col not in columns(db, table):
        raise Err(400, "only columns added in Admin can be removed")
    if sqlite3.sqlite_version_info < (3, 35):
        raise Err(400, f"removing a column needs SQLite 3.35 or newer (this is {sqlite3.sqlite_version})")
    _db.back_up(ctx.db_path, ctx.backup_dir, label="columns")
    _db.drop_views(db)                  # a view or a sync trigger naming the column would block it
    try:
        db.execute(f'ALTER TABLE "{table}" DROP COLUMN "{col}"')
    except sqlite3.Error as e:
        _db.rebuild_views(db, ctx.app)
        raise Err(400, f"could not remove it: {e}")
    db.execute("DELETE FROM field_meta WHERE tbl = ? AND col = ?", (table, col))
    _db.log_change(db, "schema", table, f"Removed column {col} from {table}")
    db.commit()
    _db.rebuild_views(db, ctx.app)
    return {"ok": True}


def restore(db, name, ctx):
    folder, files = _backups(ctx)
    if name not in {f["name"] for f in files}:
        raise Err(404, "no such backup")
    full = os.path.join(folder, name)
    try:
        _db.check_integrity(full)
    except _db.Stop as e:
        raise Err(400, str(e))
    _db.back_up(ctx.db_path, ctx.backup_dir, label="before-restore")
    src = sqlite3.connect(full)
    try:
        src.backup(db)
    finally:
        src.close()
    try:
        _db.migrate(db, ctx.app, log=lambda *a: None)      # an old backup is brought up to date, work log and all
    except _db.Stop as e:
        raise Err(400, str(e))
    _db.log_change(db, "restore", "database", f"Restored {name}")
    db.commit()
    return {"ok": True}
