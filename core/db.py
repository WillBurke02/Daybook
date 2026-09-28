"""Connection, migrations, integrity and backups, for any app's database.

Each database is one portable file. Everything here exists to keep it that way:
migrations run forward only, views are rebuilt from source on every boot, and a
damaged file stops the app rather than being served.

An app hands over where its migrations and views live (app.MIGRATIONS,
app.VIEWS). The toolkit's own tables (settings, change history, layouts, saved
views, column labels, rewording) come from base.sql, created if missing before
the app's migrations run, so an app's first migration can fill in its settings.
"""
import json
import os
import sqlite3
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = os.path.join(HERE, "base.sql")
APP_VERSION = "2.2.0"
KEEP_BACKUPS = 30
BIG = 200 * 1024 * 1024   # past this, a database is copied weekly, and fewer copies are kept
KEEP_BIG = 8
VIEW_ERRORS = {}          # custom views that failed to build, by database path then name


class Stop(Exception):
    """Something the user must fix before the app can run."""


def connect(path):
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA busy_timeout = 10000")
    return db


# --- migrations --------------------------------------------------------------

def _ensure_version_table(db):
    db.execute("""CREATE TABLE IF NOT EXISTS schema_version (
                    n           INTEGER PRIMARY KEY,
                    filename    TEXT NOT NULL,
                    applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
                    app_version TEXT NOT NULL)""")


def _files(app):
    out = []
    for f in sorted(os.listdir(app.MIGRATIONS)):
        if not f.endswith(".sql"):
            continue
        try:
            out.append((int(f.split("_", 1)[0]), f))
        except ValueError:
            raise Stop(f"migration {f} must start with a number")
    return out


def known(app):
    return max([n for n, _ in _files(app)] or [0])


def pending(db, app):
    _ensure_version_table(db)
    done = {r["n"] for r in db.execute("SELECT n FROM schema_version")}
    return [(n, f) for n, f in _files(app) if n not in done]


def migrate(db, app, log=print):
    """Apply outstanding migrations, then rebuild the views. Forward only."""
    todo = pending(db, app)
    highest_applied = db.execute("SELECT MAX(n) FROM schema_version").fetchone()[0] or 0
    if highest_applied > known(app):
        # The stick has been used on a machine with a newer copy of the app.
        raise Stop(
            f"This database is at schema {highest_applied} but this copy of the app only "
            f"knows {known(app)}.\nUpdate the app rather than running an old one against it "
            f"— an old app writing to a newer database corrupts it.")
    if todo:
        drop_views(db)      # derived; rebuilt below, and a view can block a table rename
    db.executescript(open(BASE, encoding="utf-8").read())      # IF NOT EXISTS: a no-op once there
    for n, f in todo:
        sql = open(os.path.join(app.MIGRATIONS, f), encoding="utf-8").read()
        # Foreign keys are paused while a migration runs, so a table can be
        # rebuilt (the only way SQLite changes a CHECK), then checked after.
        db.commit()
        db.execute("PRAGMA foreign_keys = OFF")
        try:
            db.executescript("BEGIN;\n" + sql + "\nCOMMIT;")
        except sqlite3.Error as e:
            if db.in_transaction:
                db.execute("ROLLBACK")
            db.execute("PRAGMA foreign_keys = ON")
            raise Stop(f"migration {f} failed: {e}")
        bad = db.execute("PRAGMA foreign_key_check").fetchall()
        db.execute("PRAGMA foreign_keys = ON")
        if bad:
            raise Stop(f"migration {f} left {len(bad)} broken references, e.g. {tuple(bad[0])}")
        db.execute("INSERT INTO schema_version (n, filename, app_version) VALUES (?,?,?)",
                   (n, f, APP_VERSION))
        db.commit()
        log(f"  applied {f}")
    rebuild_views(db, app)
    if hasattr(app, "after_migrate"):         # e.g. Learn loads its lessons from files, every start
        app.after_migrate(db)
    return len(todo)


def drop_views(db):
    for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='view'").fetchall():
        db.execute(f'DROP VIEW IF EXISTS "{name}"')


def rebuild_views(db, app):
    """Views are derived, never data, so they are dropped and recreated from
    source every boot. Adding a number to the app needs no migration. Saved
    queries from /admin come last; one that no longer builds is skipped and
    reported, not allowed to stop the app."""
    drop_views(db)
    if getattr(app, "VIEWS", None) and os.path.exists(app.VIEWS):
        db.executescript(open(app.VIEWS, encoding="utf-8").read())
    errors = VIEW_ERRORS.setdefault(db_file(db), {})
    errors.clear()
    has = db.execute("SELECT 1 FROM sqlite_master WHERE name='custom_view'").fetchone()
    for r in (db.execute("SELECT name, sql FROM custom_view").fetchall() if has else []):
        try:
            db.execute(f'CREATE VIEW "{r[0]}" AS {r[1]}')
        except sqlite3.Error as e:
            errors[r[0]] = str(e)
    db.commit()


def db_file(db):
    return db.execute("PRAGMA database_list").fetchone()[2]


# --- keeping the file safe ---------------------------------------------------

def check_integrity(path):
    db = sqlite3.connect(path)
    try:
        status = db.execute("PRAGMA quick_check").fetchone()[0]
    except sqlite3.DatabaseError as e:
        # Damaged badly enough and the check itself throws. That must still read
        # as "restore a backup", not as a stack trace.
        status = str(e)
    finally:
        db.close()
    if status != "ok":
        raise Stop(f"{path} is damaged ({status}).\n"
                   f"Restore the newest file from your backups folder.\n"
                   f"Never unplug the drive, or copy the file, while the app is running.")


def backup_folder(path, backup_dir=None):
    folder = backup_dir or os.path.join(os.path.dirname(os.path.abspath(path)), "backups")
    return os.path.abspath(os.path.expanduser(folder))


def back_up(path, backup_dir=None, label=None):
    """One copy a day, plus one before anything risky (label), newest
    KEEP_BACKUPS kept per database. backup_dir matters when the databases live
    on a USB stick: copies on the same stick are lost with it.
    A database past BIG (Log, full of photos and voice notes) is copied once a
    week instead, and only KEEP_BIG copies are kept."""
    folder = backup_folder(path, backup_dir)
    os.makedirs(folder, exist_ok=True)
    stem = os.path.basename(path)
    now = datetime.now()
    suffix = f"{now:%Y-%m-%d}" + (f"_{now:%H%M%S}_{label}" if label else "")
    today = os.path.join(folder, f"{stem}.{suffix}")
    big = os.path.getsize(path) > BIG
    if big and not label:
        week = {f"{stem}.{now.date() - timedelta(days=d):%Y-%m-%d}" for d in range(7)}
        done = [f for f in os.listdir(folder) if f in week]
        if done:
            return os.path.join(folder, done[0])
    if not os.path.exists(today):
        src = sqlite3.connect(path)
        try:
            with sqlite3.connect(today) as dest:
                src.backup(dest)          # safe on a live database
            dest.close()
        finally:
            src.close()
        old = sorted(f for f in os.listdir(folder) if f.startswith(stem + "."))
        for f in old[:-(KEEP_BIG if big else KEEP_BACKUPS)]:
            os.remove(os.path.join(folder, f))
    return today


def open_db(path, app, backup_dir=None, quiet=False, no_backup=False):
    """The one way a database is opened: check, back up, migrate, return."""
    fresh = not os.path.exists(path)
    say = (lambda *a: None) if quiet else print
    if not fresh:
        check_integrity(path)
        if not no_backup:
            back_up(path, backup_dir)
    else:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    db = connect(path)
    n = migrate(db, app, log=say)
    if fresh:
        say(f"created {path}")
    elif n:
        say(f"migrated {path}: {n} change(s)")
    return db


# --- audit -------------------------------------------------------------------

def log_change(db, action, entity, summary, entity_id=None, detail=None, rows=0):
    db.execute(
        "INSERT INTO change_log (action, entity, entity_id, summary, detail, rows) "
        "VALUES (?,?,?,?,?,?)",
        (action, entity, str(entity_id) if entity_id is not None else None,
         summary, json.dumps(detail) if detail is not None else None, rows))


def settings(db):
    return {r["key"]: r["value"] for r in db.execute("SELECT key, value FROM setting")}
