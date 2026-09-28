"""The suite: which apps are installed, where their databases are, and the
small store they share (suite.db): the password, the sign-in key, themes, the
theme in use, which file each app opens, the calendar-feed token.

No personal data lives in suite.db. Each app keeps its own database, and no app
reads another's; remove one app's folder and the rest carry on.
"""
import hashlib
import hmac
import importlib
import os
import secrets
import time

from . import db as _db

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
APPS = os.path.join(ROOT, "apps")
DEFAULT_PASSWORD = "pass"
SESSION_DAYS = 30


def env(key, default=None):
    """DAYBOOK_<key> from the environment: DATA, BACKUPS, PORT, URL, BROWSER, VERBOSE."""
    return os.environ.get("DAYBOOK_" + key) or default


class Store:
    """suite.db's migrations. It has no views."""
    MIGRATIONS = os.path.join(HERE, "suite_migrations")
    VIEWS = None


class Suite:
    data = None             # the folder with the databases
    backup_dir = None
    apps = {}               # name -> app module, in menu order


SUITE = Suite()


def discover():
    """Every folder in apps/ with an app.py is an app. Order by its ORDER."""
    found = []
    for name in sorted(os.listdir(APPS)) if os.path.isdir(APPS) else []:
        if os.path.isfile(os.path.join(APPS, name, "app.py")):
            found.append(importlib.import_module(f"apps.{name}.app"))
    return {m.NAME: m for m in sorted(found, key=lambda m: getattr(m, "ORDER", 50))}


def setup(data=None, backup_dir=None, apps=None):
    SUITE.data = os.path.abspath(os.path.expanduser(data or env("DATA") or os.path.join(ROOT, "data")))
    SUITE.backup_dir = backup_dir or env("BACKUPS")
    SUITE.apps = apps if apps is not None else discover()
    os.makedirs(SUITE.data, exist_ok=True)
    return SUITE


# --- the store ------------------------------------------------------------------

def store_path():
    return os.path.join(SUITE.data, "suite.db")


def store():
    return _db.connect(store_path())


def open_store(quiet=True):
    return _db.open_db(store_path(), Store, SUITE.backup_dir, quiet=quiet)


def _one(sql, *args):
    """One value from suite.db, or None."""
    db = store()
    try:
        r = db.execute(sql, args).fetchone()
        return r[0] if r else None
    finally:
        db.close()


def _secret(key, make=None):
    """A value kept in the secret table, made (and kept) the first time it is asked for."""
    v = _one("SELECT value FROM secret WHERE key = ?", key)
    if v is None and make:
        db = store()
        db.execute("INSERT OR IGNORE INTO secret (key, value) VALUES (?, ?)", (key, make()))
        db.commit()
        db.close()
        v = _one("SELECT value FROM secret WHERE key = ?", key)
    return v


# --- which file each app opens ------------------------------------------------------

def path(name):
    """The database app `name` opens: the one switched to in Admin, else data/<name>.db."""
    p = _one("SELECT path FROM app_db WHERE app = ?", name)
    if p:
        p = os.path.join(SUITE.data, p)          # kept relative to data/ when inside it: a stick's drive letter changes
        if os.path.isfile(p):
            return p
    return os.path.join(SUITE.data, f"{name}.db")


def set_path(name, p):
    p = os.path.abspath(p)
    rel = os.path.relpath(p, SUITE.data) if os.path.splitdrive(p)[0] == os.path.splitdrive(SUITE.data)[0] else p
    db = store()
    db.execute("INSERT INTO app_db (app, path) VALUES (?, ?) ON CONFLICT(app) DO UPDATE SET path = excluded.path",
               (name, p if rel.startswith("..") else rel))
    db.commit()
    db.close()


def open_app(name, quiet=True, no_backup=False):
    """Check, back up and migrate app `name`'s database; returns the connection."""
    return _db.open_db(path(name), SUITE.apps[name], SUITE.backup_dir, quiet=quiet, no_backup=no_backup)


def open_all(quiet=True, no_backup=False):
    """Everything the server needs before it listens: every database checked, backed up, migrated."""
    open_store(quiet).close()
    for name in SUITE.apps:
        open_app(name, quiet, no_backup).close()


# --- the password and sign-in ------------------------------------------------------

def _hash(pw, salt, n=200_000):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), n).hex()


def password_is_default():
    return _secret("password") is None


def password_ok(pw):
    v = _secret("password")
    if v is None:
        return hmac.compare_digest(pw or "", DEFAULT_PASSWORD)
    _, n, salt, want = v.split("$")
    return hmac.compare_digest(_hash(pw or "", salt, int(n)), want)


def set_password(pw):
    """A new password also signs every device out: the key sessions are signed with changes."""
    if len(pw or "") < 6 or pw == DEFAULT_PASSWORD:
        raise ValueError(f"use at least 6 characters, and not '{DEFAULT_PASSWORD}'")
    salt = secrets.token_hex(16)
    db = store()
    for k, v in (("password", f"pbkdf2${200_000}${salt}${_hash(pw, salt)}"), ("session_key", secrets.token_hex(32))):
        db.execute("INSERT INTO secret (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, v))
    db.commit()
    db.close()


def _session_key():
    return _secret("session_key", lambda: secrets.token_hex(32))


def make_session(days=SESSION_DAYS):
    """A signed cookie value: it survives restarts, and a new password voids it.
    ponytail: stateless, so Lock signs out one device; a new password signs out all."""
    body = f"{int(time.time() + days * 86400)}.{secrets.token_urlsafe(9)}"
    return body + "." + hmac.new(_session_key().encode(), body.encode(), "sha256").hexdigest()[:32]


def session_ok(value):
    try:
        exp, nonce, sig = (value or "").split(".")
        good = hmac.new(_session_key().encode(), f"{exp}.{nonce}".encode(), "sha256").hexdigest()[:32]
        return hmac.compare_digest(sig, good) and int(exp) > time.time()
    except ValueError:
        return False


def token(name, reset=False):
    """A random key kept in suite.db: 'cal' for the calendar feed, 'capture' for the phone."""
    if reset:
        db = store()
        db.execute("DELETE FROM secret WHERE key = ?", (name,))
        db.commit()
        db.close()
    return _secret(name, lambda: secrets.token_urlsafe(18))


def token_ok(name, given):
    v = _secret(name)
    return bool(v) and hmac.compare_digest(given or "", v)
