"""HTTP for the whole suite. Stdlib only.

    /                     Home                 /login        the sign-in page
    /<app>/               that app's pages     /<app>/api/…  that app's endpoints
    /api/…                the suite: sign-in, themes, keys
    /cal/<token>.ics      the calendar feed     } open without signing in,
    /widget/<token>.json  the phone's widget    } each by its own key

Everything else needs the sign-in cookie. Three more things guard the door,
because a server on this machine is still reachable from any web page you have
open:

  Host   header must be one we expect          — stops DNS rebinding
  Origin header must be absent or ours         — stops cross-site writes
  X-Daybook header must be present on writes  — a plain <form> cannot set it

While the password is still the default, only this machine may connect, by
name as well as by socket: Tailscale Serve connects from 127.0.0.1 too.
"""
import email.parser
import email.policy
import gzip
import hashlib
import ipaddress
import json
import mimetypes
import os
import posixpath
import re
import sqlite3
import sys
import threading
import time
from datetime import date, datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote, quote

from . import api as _api
from . import db as _db
from . import suite as _suite
from . import sync as _sync
from . import update as _update
from .suite import SUITE

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(ROOT, "web")
WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")
LOCAL = {"127.0.0.1", "localhost", "::1", "[::1]"}
COOKIE = "daybook"


class Config:
    allowed_hosts = set(LOCAL)
    fails = []            # timestamps of recent wrong passwords


CFG = Config()
_copied = [date.today()]          # open_all made today's copies before the server listened
_copying = threading.Lock()


def daily_copies():
    """A server left running (the Pi, for months) still makes each day's copies: the first app
    request of a day starts them, in the background. Returns that thread, or None."""
    with _copying:
        if _copied[0] == date.today():
            return None
        _copied[0] = date.today()
    def copy():
        for p in [_suite.store_path(), *map(_suite.path, SUITE.apps)]:
            _db.back_up(p, SUITE.backup_dir)
        for name, app in SUITE.apps.items():      # then each app's own once-a-day (Log: GitHub)
            if hasattr(app, "daily"):
                db = _db.connect(_suite.path(name))
                try:
                    app.daily(db)
                except Exception as e:            # one app failing leaves the rest, and the server, alone
                    print(f"daily {name}: {e}", file=sys.stderr)
                finally:
                    db.close()
    t = threading.Thread(target=copy, daemon=True)
    t.start()
    return t


def known_host(host):
    """A name we were told about, or an address typed in as it is (a phone on the
    Wi-Fi or on Tailscale). DNS rebinding needs a name the attacker owns; an IP
    address in the Host header cannot be one."""
    host = host.lower()
    if host in CFG.allowed_hosts:
        return True
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


class Handler(BaseHTTPRequestHandler):
    server_version = "daybook/" + _db.APP_VERSION
    protocol_version = "HTTP/1.1"
    _renew = None                             # a fresh sign-in cookie to send with this response

    def log_message(self, fmt, *a):
        if _suite.env("VERBOSE"):
            super().log_message(fmt, *a)

    # --- plumbing ------------------------------------------------------------
    def _send(self, code, payload, ctype="application/json", extra=None, gz_key=None):
        if isinstance(payload, _api.File):
            extra = list(extra or []) + [
                ("Content-Disposition", f'attachment; filename="{payload.name}"')]
            ctype, payload = payload.ctype, payload.data
        data = (payload if isinstance(payload, (bytes, bytearray))
                else json.dumps(payload, default=str).encode())
        zipped = False
        if len(data) > 1400 and ZIPPABLE.match(ctype) and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            data, zipped = gz(data, gz_key), True     # a Pi's link is the slow part: a quarter of the bytes
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if zipped:
            self.send_header("Content-Encoding", "gzip")
        if ZIPPABLE.match(ctype):
            self.send_header("Vary", "Accept-Encoding")
        if not any(k == "Cache-Control" for k, _ in (extra or [])):
            self.send_header("Cache-Control", "no-store")
        if self._renew and not any(k == "Set-Cookie" for k, _ in (extra or [])):
            self.send_header("Set-Cookie", self._renew)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (extra or []):
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _go(self, where, cookie=None):
        self._send(303 if self.command == "POST" else 302, b"", "text/plain",
                   extra=[("Location", where)] + ([("Set-Cookie", cookie)] if cookie else []))

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 64 * 1024 * 1024:
            raise _api.Err(413, "body too large")
        return self.rfile.read(n) if n else b""

    # --- the door ------------------------------------------------------------
    def _host(self):
        return (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()

    def _origin_ok(self, allow_null=False):
        origin = self.headers.get("Origin")
        if not origin or (allow_null and origin == "null"):
            return True                       # same-origin navigations send none
        return known_host(urlparse(origin).hostname or "")

    def _https(self):
        return self.headers.get("X-Forwarded-Proto") == "https" or self._host().endswith(".ts.net")

    def _signed_in(self):
        """Signed in, and kept signed in while used: a cookie a day old is swapped for a fresh one."""
        c = SimpleCookie(self.headers.get("Cookie", ""))
        ok = COOKIE in c and _suite.session_ok(c[COOKIE].value)
        if ok and _suite.session_left(c[COOKIE].value) < (_suite.SESSION_DAYS - 1) * 86400:
            self._renew = self._cookie(_suite.make_session(), _suite.SESSION_DAYS * 86400)
        return ok

    def _cookie(self, value, age):
        # Lax, not Strict: a link to Daybook clicked in Outlook arrives signed in. Writes stay
        # same-site anyway: they need the X-Daybook header and our Origin.
        return (f"{COOKIE}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}"
                + ("; Secure" if self._https() else ""))

    def _handle(self, method):
        self._renew = None                    # a kept-alive connection reuses this handler: nothing carried over
        url = urlparse(self.path)
        path = unquote(url.path)
        # /_v/<version>/learn/app.js is /learn/app.js, kept by the browser for good: a page names its files
        # under the version of the code (page_html), so an update gives new names and nothing stale is used
        self._immutable = path.startswith("/_v/")
        if self._immutable:
            path = "/" + (path.split("/", 3) + [""])[3]
        query = parse_qs(url.query, keep_blank_values=True)       # ?parent_id= means IS NULL: keep it
        try:
            # DNS rebinding: trust the header we were sent, not the socket.
            if not known_host(self._host()):
                return self._send(421, {"error": "unexpected Host header"})
            if self._host() not in LOCAL and _suite.password_is_default():
                return self._send(403, b"<p>The password is still the default. Change it on the computer "
                                       b"Daybook runs on (Admin, Password) before opening it from anywhere else.</p>",
                                  "text/html; charset=utf-8")
            if path.startswith("/cal/"):
                return self._calendar(path, query)
            if path.startswith("/widget/"):
                return self._widget(path)
            if path in ("/login", "/api/login", "/api/logout", "/sw.js") or path.startswith(("/assets/", "/ui/tokens.css")) \
                    or path.endswith("/manifest.json"):
                pass                                  # open: the sign-in page and what it needs
            elif not self._signed_in() and not self._capture_ok(path):
                if path.startswith("/api/") or "/api/" in path or method != "GET":
                    return self._send(401, {"error": "sign in first"})
                return self._go("/login?next=" + quote(self.path, safe=""))
            share = method == "POST" and path.endswith("/share")
            if method in WRITE_METHODS:
                # A cross-site form POST cannot set a custom header, and anything
                # using fetch to try triggers a preflight we never answer. A phone's
                # share sheet is a form POST, so /<app>/share is let off the header
                # but still needs the sign-in cookie, which SameSite keeps to this site.
                if not self._origin_ok(allow_null=share):
                    return self._send(403, {"error": "cross-site request refused"})
                if not share and self.headers.get("X-Daybook") != "1":
                    return self._send(403, {"error": "missing X-Daybook header"})

            if path.startswith("/api/"):
                return self._suite_api(method, [p for p in path[5:].split("/") if p], query)
            head, _, rest = path.lstrip("/").partition("/")
            name = _suite.door(head)                  # /hours/ is Money's front door, and so on
            if name:
                if rest.startswith("api/"):
                    return self._app_api(name, method, [p for p in rest[4:].split("/") if p], query)
                if rest.startswith("clip/") and hasattr(SUITE.apps[name], "clip_in"):
                    return self._clip(name, method, rest[5:], query)
                if share:
                    return self._share(name)
            if method not in ("GET", "HEAD"):
                return self._send(405, {"error": "method not allowed"})
            if path.rstrip("/") == "/admin":
                return self._go(f"/{next(iter(SUITE.apps))}/#/admin")
            if name and not path.endswith("/") and not rest:
                return self._go(path + "/")           # so the page's relative imports resolve inside /money/
            return self._static(path)
        except _api.Err as e:
            self._send(e.code, {"error": e.msg})

    # --- the suite's own endpoints ---------------------------------------------------
    def _json(self):
        raw = self._body()
        try:
            return json.loads(raw) if raw else None
        except ValueError:
            raise _api.Err(400, "body is not valid JSON")

    def _suite_api(self, method, p, query):
        body = self._json() if method in WRITE_METHODS else None
        if p == ["login"] and method == "POST":
            now = time.time()
            CFG.fails[:] = [t for t in CFG.fails if now - t < 300]
            if len(CFG.fails) >= 8:
                return self._send(429, {"error": "too many wrong passwords; wait five minutes"})
            if not _suite.password_ok((body or {}).get("password", "")):
                CFG.fails.append(now)
                return self._send(403, {"error": "wrong password"})
            return self._send(200, {"ok": True}, extra=[
                ("Set-Cookie", self._cookie(_suite.make_session(), _suite.SESSION_DAYS * 86400))])
        if p == ["logout"] and method == "POST":
            return self._send(200, {"ok": True}, extra=[("Set-Cookie", self._cookie("", 0))])
        if p == ["meta"] and method == "GET":
            return self._send(200, suite_meta())
        if p == ["days"] and method == "GET":          # Home: each app's view of some days
            return self._send(200, days_of(query.get("from", [""])[0], query.get("to", [""])[0]))
        if p == ["changelog"] and method == "GET":     # Help → What's new
            with open(os.path.join(ROOT, "CHANGELOG.md"), encoding="utf-8") as f:
                return self._send(200, {"text": f.read()})
        if p == ["password"] and method == "POST":
            if not _suite.password_ok((body or {}).get("old", "")):
                return self._send(403, {"error": "current password is wrong"})
            try:
                _suite.set_password((body or {}).get("new") or "")
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            # every other device is signed out; this one gets a fresh cookie
            return self._send(200, {"ok": True}, extra=[
                ("Set-Cookie", self._cookie(_suite.make_session(), _suite.SESSION_DAYS * 86400))])
        if p[:1] == ["sync"]:
            return self._sync(method, p[1:], body or {})
        if p == ["update"]:
            try:
                if method == "GET":
                    return self._send(200, dict(_update.check(), version=_db.APP_VERSION))
                if method == "POST":
                    return self._send(200, {"installed": _update.update(data=SUITE.data)})
            except ValueError as e:
                return self._send(400, {"error": str(e)})
        if p[:1] == ["token"] and len(p) == 2 and p[1] in ("cal", "capture", "widget"):
            return self._send(200, {"token": _suite.token(p[1], reset=method == "POST")})
        db = _suite.store()
        try:
            code, payload = _api.route(db, method, p, query, body, _api.Ctx(True, _suite.store_path(),
                                                                           SUITE.backup_dir, app=_suite.Store))
            self._send(code, payload)
        except sqlite3.IntegrityError as e:
            self._send(409, {"error": f"that would break a rule in the data: {e}"})
        finally:
            db.close()

    def _sync(self, method, p, body):
        """Sync between computers: its state, starting or joining it, a round now, its code, leaving."""
        try:
            if p == [] and method == "GET":
                return self._send(200, _sync.status())
            if p == [] and method == "POST":
                code = _sync.setup(body.get("kind"), path=body.get("path"), repo=body.get("repo"),
                                   token=body.get("token"), branch=body.get("branch") or "main", code=body.get("code"))
                return self._send(200, dict(_sync.status(), code=code))
            if p == ["now"] and method == "POST":
                _sync.run()
                return self._send(200, _sync.status())
            if p == ["code"] and method == "GET":
                cfg = _sync.config()
                return self._send(200, {"code": _sync.code_of(bytes.fromhex(cfg["key"])) if cfg else None})
            if p == ["leave"] and method == "POST":
                _sync.leave()
                return self._send(200, _sync.status())
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        return self._send(404, {"error": "no such endpoint"})

    def _capture_ok(self, path):
        """The phone's capture key opens two doors, both to add: <app>/api/quick (a note) and <app>/share
        (photos from the share sheet, for an iPhone Shortcut)."""
        auth = self.headers.get("Authorization", "")
        return (self.command == "POST" and (path.endswith("/api/quick") or path.endswith("/share"))
                and auth.startswith("Bearer ") and _suite.token_ok("capture", auth[7:].strip()))

    # --- an app's endpoints ------------------------------------------------------------
    def _ctx(self, name, meta=False):
        return _api.Ctx(True, _suite.path(name), SUITE.backup_dir, switch=lambda p: _suite.set_path(name, p),
                        app=SUITE.apps[name], meta=suite_meta() if meta else None)

    def _app_api(self, name, method, parts, query):
        daily_copies()
        body = self._json() if method in WRITE_METHODS else None
        ctx = self._ctx(name, meta=parts == ["meta"])
        db = _db.connect(ctx.db_path)
        try:
            code, payload = _api.route(db, method, parts, query, body, ctx)
            self._send(code, payload)
            if method in WRITE_METHODS:
                _sync.soon()
        except _api.Err as e:
            self._send(e.code, {"error": e.msg})
        except sqlite3.IntegrityError as e:
            self._send(409, {"error": f"that would break a rule in the data: {e}"})
        except sqlite3.Error as e:
            self._send(400, {"error": f"database: {e}"})
        except (ValueError, TypeError, KeyError) as e:
            self._send(400, {"error": str(e)})
        finally:
            db.close()

    def _clip(self, name, method, rest, query):
        """A video: POST /log/clip/<entry id> with the file as the body (raw, so up to 60 MB without base64);
        GET /log/clip/<id> plays it, in the pieces a phone asks for (Safari will not play one without)."""
        app, ctx = SUITE.apps[name], self._ctx(name)
        db = _db.connect(ctx.db_path)
        try:
            if method == "POST" and rest.isdigit():
                duration = (query.get("duration") or [None])[0]
                cid = app.clip_in(db, int(rest), self.headers.get("Content-Type", ""), self._body(), duration)
                _sync.soon()
                return self._send(200, {"ok": True, "id": cid})
            if method not in ("GET", "HEAD") or not rest.isdigit():
                return self._send(405, {"error": "method not allowed"})
            found = app.clip_out(db, int(rest))
            if not found:
                return self._send(404, {"error": "no such video"})
            mime, size, read = found
            keep = [("Accept-Ranges", "bytes"), ("Cache-Control", "private, max-age=86400")]
            m = re.fullmatch(r"bytes=(\d*)-(\d*)", (self.headers.get("Range") or "").strip())
            if not m or not (m[1] or m[2]):
                return self._send(200, read(0, size), mime, extra=keep)
            start, end = (int(m[1]), int(m[2]) if m[2] else None) if m[1] else (max(0, size - int(m[2])), size - 1)
            if end is None:                       # open-ended: a piece at a time, the player asks for the next
                end = start + 4 * 2**20 - 1
            end = min(end, size - 1)
            if start >= size or start > end:
                return self._send(416, b"", mime, extra=keep + [("Content-Range", f"bytes */{size}")])
            self._send(206, read(start, end - start + 1), mime, extra=keep + [("Content-Range", f"bytes {start}-{end}/{size}")])
        except _api.Err as e:
            self._send(e.code, {"error": e.msg})
        finally:
            db.close()

    def _share(self, name):
        """A phone's share sheet posts a form here (multipart); the app files it."""
        app = SUITE.apps[name]
        if not hasattr(app, "share"):
            return self._send(404, {"error": "no such endpoint"})
        ctype = self.headers.get("Content-Type", "")
        msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
            f"Content-Type: {ctype}\r\n\r\n".encode() + self._body())
        fields, files = {}, []
        for part in msg.iter_parts() if msg.is_multipart() else []:
            key = part.get_param("name", header="content-disposition")
            if part.get_filename():
                files.append((part.get_content_type(), part.get_payload(decode=True)))
            elif key:
                fields[key] = part.get_content()
        db = _db.connect(_suite.path(name))
        try:
            where = app.share(db, fields, files)
            # a Shortcut (it sent the key) gets an answer; a browser's share sheet goes to the day
            return self._send(200, {"ok": True}) if self.headers.get("Authorization") else self._go(where)
        finally:
            db.close()

    # --- the calendar feed ------------------------------------------------------
    def _calendar(self, path, query):
        tok = path[len("/cal/"):].removesuffix(".ics")
        if not _suite.token_ok("cal", tok):
            return self._send(404, {"error": "not found"})
        extra = [("Content-Disposition", 'attachment; filename="daybook.ics"')] if query.get("download") else None
        return self._send(200, calendar_feed().encode(), "text/calendar; charset=utf-8", extra)

    # --- the phone's home-screen widget ----------------------------------------
    def _widget(self, path):
        """Each app's Home figures, read-only, by the widget's own key (Scriptable on an iPhone)."""
        if not _suite.token_ok("widget", path[len("/widget/"):].removesuffix(".json")):
            return self._send(404, {"error": "not found"})
        return self._send(200, widget(), extra=[("Cache-Control", "no-store")])

    # --- files -----------------------------------------------------------------
    def _static(self, path):
        """An app's page is its own files laid over the shared ones: /money/core/api.js
        is web/core/api.js, /money/views/hours.js is apps/money/web/views/hours.js.
        Home, at /, is web/home over web."""
        full, prefix = locate(path)
        if not full:
            return self._send(404, {"error": "not found"})
        if full.endswith(".html"):
            return self._page(full, prefix)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        st = os.stat(full)
        if self._immutable:
            extra = [("Cache-Control", "public, max-age=31536000, immutable")]
        elif "/assets/" in full:
            extra = [("Cache-Control", "max-age=604800")]
        else:                                   # the browser keeps the file and asks if it changed: a 304 instead
            tag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
            extra = [("Cache-Control", "no-cache"), ("ETag", tag)]
            if self.headers.get("If-None-Match") == tag:
                return self._send(304, b"", ctype, extra=extra)
        with open(full, "rb") as f:
            data = f.read()
        self._send(200, data, ctype, extra=extra, gz_key=(full, st.st_mtime_ns, st.st_size))

    def _page(self, full, prefix):
        """A page, its files named under the code's version, the theme in use already on it (no flash of
        the default on the way in), and every module it will import listed up front (no waterfall)."""
        with open(full, encoding="utf-8") as f:
            html = page_html(f.read(), prefix, static_version(), theme_now())
        data = html.encode()
        tag = '"' + hashlib.sha1(data).hexdigest()[:20] + '"'
        extra = [("Cache-Control", "no-cache"), ("ETag", tag)]
        if self.headers.get("If-None-Match") == tag:
            return self._send(304, b"", "text/html; charset=utf-8", extra=extra)
        self._send(200, data, "text/html; charset=utf-8", extra=extra)

    def do_GET(self):    self._handle("GET")
    def do_HEAD(self):   self._handle("HEAD")
    def do_POST(self):   self._handle("POST")
    def do_PATCH(self):  self._handle("PATCH")
    def do_DELETE(self): self._handle("DELETE")


# --- pages and their files -------------------------------------------------------

ZIPPABLE = re.compile(r"text/|application/(json|javascript|manifest)|image/svg")
_gz = {}


def gz(data, key=None):
    """Gzip, a static file's kept (they do not change until the code does)."""
    if key is None:
        return gzip.compress(data, 5)
    if key not in _gz:
        if len(_gz) > 2000:
            _gz.clear()
        _gz[key] = gzip.compress(data, 9)
    return _gz[key]


def locate(path):
    """A URL path to the file that answers it, and the page prefix its relative names hang from:
    (full path, '/learn/') or (None, None). An app's files lie over the shared ones."""
    head, _, rest = path.lstrip("/").partition("/")
    name = _suite.door(head)
    if name:
        layers, rel, prefix = [os.path.join(ROOT, "apps", name, "web"), WEB], rest or "index.html", f"/{head}/"
        if rel == "manifest.json" and head != name:
            rel = f"manifest.{head}.json"          # a door installs as its own app, with its own icon
    elif path == "/login":
        layers, rel, prefix = [WEB], "login.html", "/"
    else:
        layers, rel, prefix = [os.path.join(WEB, "home"), WEB], path.lstrip("/") or "index.html", "/"
    for base in layers:
        full = os.path.realpath(os.path.join(base, rel))
        if full.startswith(os.path.realpath(base) + os.sep) and os.path.isfile(full):
            return full, prefix
    return None, None


_ver = {"at": -1e9, "v": ""}


def static_version():
    """A short tag that changes whenever any page file does (an update, or an edit while writing them).
    Worked out at most every few seconds; pictures (media) are left out, being many and named by the pages."""
    now = time.monotonic()
    if now - _ver["at"] > 3:
        h = hashlib.sha1()
        for base in [WEB] + [os.path.join(ROOT, "apps", n, "web") for n in sorted(SUITE.apps)]:
            for dp, dirs, files in os.walk(base):
                dirs[:] = sorted(d for d in dirs if d != "media")
                for f in sorted(files):
                    st = os.stat(os.path.join(dp, f))
                    h.update(f"{dp}/{f}:{st.st_mtime_ns}:{st.st_size};".encode())
        _ver.update(at=now, v=h.hexdigest()[:10])
    return _ver["v"]


IMPORT = re.compile(r"""(?:\bfrom|^\s*import)\s*['"]([^'"]+)['"]""", re.M)
_graphs = {}


def module_graph(entries, ver):
    """Every module the entries import, at any depth, as URL paths (resolved through the app's layers)."""
    key = (ver, tuple(entries))
    if key not in _graphs:
        seen, todo = [], list(entries)
        while todo:
            url = todo.pop(0)
            if url in seen:
                continue
            full, _ = locate(url)
            if not full or not full.endswith(".js"):
                continue
            seen.append(url)
            with open(full, encoding="utf-8") as f:
                for spec in IMPORT.findall(f.read()):
                    if spec.startswith("."):
                        todo.append(posixpath.normpath(posixpath.join(posixpath.dirname(url), spec)))
        if len(_graphs) > 50:
            _graphs.clear()
        _graphs[key] = seen
    return _graphs[key]


def theme_now():
    """The theme in use: (its name for data-mode, or None for Auto; dark or not; the CSS of the made ones; ground)."""
    s = _suite.store()
    try:
        mode = _db.settings(s).get("mode", "system")
        themes = [dict(r) for r in s.execute("SELECT * FROM theme ORDER BY name")]
    finally:
        s.close()
    slug = lambda n: "t-" + re.sub(r"[^a-z0-9]+", "-", str(n).lower())
    css, dark, ground = [], False, {"dusk": "#1b2224", "ink": "#0d1213"}.get(mode)
    for t in themes:
        try:
            v = json.loads(t.get("vars") or "{}")
        except ValueError:
            v = {}
        decl = "".join(f"{k}:{x};" for k, x in v.items() if str(k).startswith("--"))
        css.append(f':root[data-mode="{slug(t["name"])}"]{{color-scheme:{t.get("scheme") or "light"};{decl}}}')
        if slug(t["name"]) == mode:
            dark, ground = t.get("scheme") == "dark", v.get("--ground") or ground
    known = mode in ("paper", "dusk", "ink") or any(slug(t["name"]) == mode for t in themes)
    return (mode if known and mode != "system" else None, dark, re.sub(r"[<>]", "", "\n".join(css)), ground)


FONTS = ("archivo-latin-500-normal", "archivo-latin-700-normal", "jetbrains-mono-latin-500-normal")


def page_html(html, prefix, ver, theme):
    """A page as sent: its scripts and styles under /_v/<ver>/ (so kept for good), its modules preloaded,
    and the theme on <html> before anything paints."""
    v = f"/_v/{ver}"
    page = lambda u: u if u.startswith("/") else posixpath.normpath(posixpath.join(prefix, u))
    own = re.compile(r'(src|href)="((?!#|[a-z]+:|//|/_v/|/api/)[^"]+\.(?:js|css))"')
    html = own.sub(lambda m: f'{m[1]}="{v}{page(m[2])}"', html)
    entries = [page(u) for u in re.findall(r"""import[^'"]*?from\s*'(\.[^']+)'""", html)]
    entries += [u[len(v):] for u in re.findall(r'<script type="module" src="([^"]+)"', html)]
    html = re.sub(r"""(from\s*)'(\.[^']+)'""", lambda m: f"{m[1]}'{v}{page(m[2])}'", html)
    mode, dark, css, ground = theme
    head = "".join(f'<link rel="modulepreload" href="{v}{u}">' for u in module_graph(entries, ver))
    # the fonts the first paint uses, fetched with the page, so text does not change size once it has drawn
    head += "".join(f'<link rel="preload" href="{v}/assets/fonts/{f}.woff2" as="font" type="font/woff2" crossorigin>' for f in FONTS)
    if css:
        head += f'<style id="themes">{css}</style>'
    if ground:
        html = re.sub(r'<meta name="theme-color"[^>]*>\n?', "", html)
        head += f'<meta name="theme-color" content="{ground}">'
    attrs = (f' data-mode="{mode}"' if mode else "") + (' class="dark"' if dark else "")
    html = html.replace('<html lang="en-GB">', f'<html lang="en-GB"{attrs}>', 1)
    return html.replace("</head>", head + "\n</head>", 1)


def suite_meta():
    """What every page gets besides its own app's meta: the other apps, themes, the theme in use."""
    s = _suite.store()
    try:
        settings = _db.settings(s)
        themes = [dict(r) for r in s.execute("SELECT * FROM theme ORDER BY name")]
    finally:
        s.close()
    return {"apps": [{"name": m.NAME, "title": m.TITLE} for m in SUITE.apps.values()], "doors": _suite.doors(),
            "themes": themes, "settings": {"default_mode": settings.get("mode", "system"), "home": settings.get("home", "")},
            "password_default": _suite.password_is_default(),
            "suite_version": _db.APP_VERSION}


def days_of(frm, to):
    """{date: [item]} from every app's day(db, d) hook, a fortnight at most: shifts, bills, entries, reminders…
    Each item says which app it is from; one app failing leaves the others."""
    try:
        a, b = date.fromisoformat(frm), date.fromisoformat(to)
    except ValueError:
        a = b = date.today()
    ds = [(a + timedelta(days=i)).isoformat() for i in range(max(0, min((b - a).days, 13)) + 1)]
    out = {d: [] for d in ds}
    for name, app in SUITE.apps.items():
        if not hasattr(app, "day"):
            continue
        db = _db.connect(_suite.path(name))
        try:
            for d in ds:
                out[d] += [dict(it, app=name) for it in app.day(db, d)]
        except sqlite3.Error:
            pass
        finally:
            db.close()
    return {"days": out}


def widget():
    """{version, apps: [{app, title, figures: [{label, value, sub}]}]}: what Home shows, figures only."""
    out = []
    for name, app in SUITE.apps.items():
        if not hasattr(app, "home"):
            continue
        db = _db.connect(_suite.path(name))
        try:
            figs = (app.home(db) or {}).get("figures", [])
        except sqlite3.Error:
            figs = []                          # one app failing leaves the others on the widget
        finally:
            db.close()
        out.append({"app": name, "title": app.TITLE,
                    "figures": [{k: f.get(k) for k in ("label", "value", "sub")} for f in figs]})
    return {"version": _db.APP_VERSION, "apps": out}


# --- the calendar feed -------------------------------------------------------------

def _ics_text(s):
    return str(s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line):
    """Lines longer than 75 octets continue on the next, after a space."""
    out, b = [], line.encode()
    while len(b) > 75:
        cut = 75
        while (b[cut] & 0xC0) == 0x80:          # never split a UTF-8 character
            cut -= 1
        out.append(b[:cut].decode())
        b = b" " + b[cut:]
    return "\r\n".join(out + [b.decode()])


def calendar_feed(today=None):
    """Every app's events from a month back to a year ahead, all-day or (with "at") at a time,
    each with an alert if it has an "alarm", and UIDs that stay the same from one fetch to the next."""
    today = today or date.today()
    frm, to = (today - timedelta(days=31)).isoformat(), (today + timedelta(days=366)).isoformat()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Daybook//EN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", "X-WR-CALNAME:Daybook"]
    for name, app in SUITE.apps.items():
        if not hasattr(app, "calendar"):
            continue
        db = _db.connect(_suite.path(name))
        try:
            events = app.calendar(db, frm, to)
        except sqlite3.Error:
            events = []                        # one app failing leaves the others in the feed
        finally:
            db.close()
        for e in events:
            lines += ["BEGIN:VEVENT", f"UID:{name}-{e['uid']}@daybook", f"DTSTAMP:{stamp}"]
            if e.get("at"):                    # at a time of day: half an hour, in the phone's own time zone
                start = datetime.fromisoformat(f"{e['date']}T{e['at']}")
                lines += [f"DTSTART:{start:%Y%m%dT%H%M%S}", f"DTEND:{start + timedelta(minutes=30):%Y%m%dT%H%M%S}"]
            else:
                end = date.fromisoformat(e.get("end") or e["date"]) + timedelta(days=1)
                lines += [f"DTSTART;VALUE=DATE:{e['date'].replace('-', '')}", f"DTEND;VALUE=DATE:{end:%Y%m%d}"]
            lines.append(f"SUMMARY:{_ics_text(e['title'])}")
            if e.get("note"):
                lines.append(f"DESCRIPTION:{_ics_text(e['note'])}")
            if e.get("alarm"):                 # from the event's start: -PT15H is 09:00 the day before an all-day one
                lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_ics_text(e['title'])}",
                          f"TRIGGER:{e['alarm']}", "END:VALARM"]
            lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(x) for x in lines) + "\r\n"


def serve(host="127.0.0.1", port=8765, extra_hosts=()):
    CFG.allowed_hosts = set(LOCAL) | {h.lower() for h in extra_hosts}
    if host not in LOCAL:
        CFG.allowed_hosts.add(host)
        import socket
        try:
            CFG.allowed_hosts.add(socket.gethostname().lower())
            CFG.allowed_hosts.add(lan_ip())
        except OSError:
            pass
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("font/woff2", ".woff2")
    mimetypes.add_type("application/manifest+json", ".webmanifest")
    return ThreadingHTTPServer((host, port), Handler)


def lan_ip():
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()
