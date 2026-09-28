"""HTTP for the whole suite. Stdlib only.

    /                     Home                 /login        the sign-in page
    /<app>/               that app's pages     /<app>/api/…  that app's endpoints
    /api/…                the suite: sign-in, themes, keys
    /cal/<token>.ics      the calendar feed, the only thing open without signing in

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
import ipaddress
import json
import mimetypes
import os
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote, quote

from . import api as _api
from . import db as _db
from . import suite as _suite
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

    def log_message(self, fmt, *a):
        if _suite.env("VERBOSE"):
            super().log_message(fmt, *a)

    # --- plumbing ------------------------------------------------------------
    def _send(self, code, payload, ctype="application/json", extra=None):
        if isinstance(payload, _api.File):
            extra = list(extra or []) + [
                ("Content-Disposition", f'attachment; filename="{payload.name}"')]
            ctype, payload = payload.ctype, payload.data
        data = (payload if isinstance(payload, (bytes, bytearray))
                else json.dumps(payload, default=str).encode())
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if not any(k == "Cache-Control" for k, _ in (extra or [])):
            self.send_header("Cache-Control", "no-store")
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
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return COOKIE in c and _suite.session_ok(c[COOKIE].value)

    def _cookie(self, value, age):
        return (f"{COOKIE}={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}"
                + ("; Secure" if self._https() else ""))

    def _handle(self, method):
        url = urlparse(self.path)
        path = unquote(url.path)
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
            if path in ("/login", "/api/login", "/api/logout") or path.startswith(("/assets/", "/ui/tokens.css")) \
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
            if head in SUITE.apps:
                if rest.startswith("api/"):
                    return self._app_api(head, method, [p for p in rest[4:].split("/") if p], query)
                if share:
                    return self._share(head)
            if method not in ("GET", "HEAD"):
                return self._send(405, {"error": "method not allowed"})
            if path.rstrip("/") == "/admin":
                return self._go(f"/{next(iter(SUITE.apps))}/#/admin")
            if head in SUITE.apps and not path.endswith("/") and not rest:
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
        if p[:1] == ["token"] and len(p) == 2 and p[1] in ("cal", "capture"):
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

    def _capture_ok(self, path):
        """The phone's quick-capture key opens exactly one door: <app>/api/quick."""
        auth = self.headers.get("Authorization", "")
        return (path.endswith("/api/quick") and auth.startswith("Bearer ")
                and _suite.token_ok("capture", auth[7:].strip()))

    # --- an app's endpoints ------------------------------------------------------------
    def _ctx(self, name, meta=False):
        return _api.Ctx(True, _suite.path(name), SUITE.backup_dir, switch=lambda p: _suite.set_path(name, p),
                        app=SUITE.apps[name], meta=suite_meta() if meta else None)

    def _app_api(self, name, method, parts, query):
        body = self._json() if method in WRITE_METHODS else None
        ctx = self._ctx(name, meta=parts == ["meta"])
        db = _db.connect(ctx.db_path)
        try:
            code, payload = _api.route(db, method, parts, query, body, ctx)
            self._send(code, payload)
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
            return self._go(app.share(db, fields, files))
        finally:
            db.close()

    # --- the calendar feed ------------------------------------------------------
    def _calendar(self, path, query):
        tok = path[len("/cal/"):].removesuffix(".ics")
        if not _suite.token_ok("cal", tok):
            return self._send(404, {"error": "not found"})
        extra = [("Content-Disposition", 'attachment; filename="daybook.ics"')] if query.get("download") else None
        return self._send(200, calendar_feed().encode(), "text/calendar; charset=utf-8", extra)

    # --- files -----------------------------------------------------------------
    def _static(self, path):
        """An app's page is its own files laid over the shared ones: /money/core/api.js
        is web/core/api.js, /money/views/hours.js is apps/money/web/views/hours.js.
        Home, at /, is web/home over web."""
        head, _, rest = path.lstrip("/").partition("/")
        if head in SUITE.apps:
            layers, rel = [os.path.join(ROOT, "apps", head, "web"), WEB], rest or "index.html"
        elif path == "/login":
            layers, rel = [WEB], "login.html"
        else:
            layers, rel = [os.path.join(WEB, "home"), WEB], path.lstrip("/") or "index.html"
        for base in layers:
            full = os.path.realpath(os.path.join(base, rel))
            if full.startswith(os.path.realpath(base) + os.sep) and os.path.isfile(full):
                break
        else:
            return self._send(404, {"error": "not found"})
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as f:
            data = f.read()
        extra = [("Cache-Control", "max-age=604800")] if "/assets/" in full else None
        self._send(200, data, ctype, extra=extra)

    def do_GET(self):    self._handle("GET")
    def do_HEAD(self):   self._handle("HEAD")
    def do_POST(self):   self._handle("POST")
    def do_PATCH(self):  self._handle("PATCH")
    def do_DELETE(self): self._handle("DELETE")


def suite_meta():
    """What every page gets besides its own app's meta: the other apps, themes, the theme in use."""
    s = _suite.store()
    try:
        settings = _db.settings(s)
        themes = [dict(r) for r in s.execute("SELECT * FROM theme ORDER BY name")]
    finally:
        s.close()
    return {"apps": [{"name": m.NAME, "title": m.TITLE} for m in SUITE.apps.values()],
            "themes": themes, "settings": {"default_mode": settings.get("mode", "system"), "home": settings.get("home", "")},
            "password_default": _suite.password_is_default(),
            "suite_version": _db.APP_VERSION}


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
    """Every app's events from a month back to a year ahead, as all-day events
    with UIDs that stay the same from one fetch to the next."""
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
            end = date.fromisoformat(e.get("end") or e["date"]) + timedelta(days=1)
            lines += ["BEGIN:VEVENT", f"UID:{name}-{e['uid']}@daybook", f"DTSTAMP:{stamp}",
                      f"DTSTART;VALUE=DATE:{e['date'].replace('-', '')}", f"DTEND;VALUE=DATE:{end:%Y%m%d}",
                      f"SUMMARY:{_ics_text(e['title'])}"]
            if e.get("note"):
                lines.append(f"DESCRIPTION:{_ics_text(e['note'])}")
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
