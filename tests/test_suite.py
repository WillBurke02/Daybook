"""The suite's check:  python3 tests/test_suite.py

The doors (Host, Origin, the X-Daybook header, sign-in), sessions, the default
password rule, the file overlay (an app's files over the shared ones), the
calendar feed, phone capture, the launcher, and removing an app.
"""
import http.client
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from core import db as _db, server, suite          # noqa: E402
from core.suite import SUITE                         # noqa: E402

tmp = tempfile.TemporaryDirectory()
suite.setup(os.path.join(tmp.name, "data"))
suite.open_all()
assert {"money"} <= set(SUITE.apps), SUITE.apps
assert os.path.exists(suite.store_path()) and all(os.path.exists(suite.path(n)) for n in SUITE.apps)
# every database stays out of WAL: the sidecar file and a yanked stick don't mix
for p in [suite.store_path()] + [suite.path(n) for n in SUITE.apps]:
    c = _db.connect(p)
    assert c.execute("PRAGMA journal_mode").fetchone()[0].lower() in ("delete", "truncate"), p
    c.close()

# === the password and sessions ================================================
assert suite.password_is_default() and suite.password_ok("pass") and not suite.password_ok("nope")
s1 = suite.make_session()
assert suite.session_ok(s1) and not suite.session_ok(s1[:-1] + "0") and not suite.session_ok("rubbish")
assert not suite.session_ok(suite.make_session(days=-1)), "an expired session is refused"
for bad in ("short", "pass"):
    try:
        suite.set_password(bad); raise SystemExit(f"FAIL: accepted password {bad!r}")
    except ValueError:
        pass
print("ok — password and sessions")

# === the server ================================================================
srv = server.serve("127.0.0.1", 0, extra_hosts=["pi.tail1234.ts.net"])
threading.Thread(target=srv.serve_forever, daemon=True).start()
PORT = srv.server_address[1]
W = {"Content-Type": "application/json", "X-Daybook": "1"}


def raw(path, method="GET", body=None, headers=None, host=None):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
    h = dict(headers or {})
    if host:
        h["Host"] = host
    c.request(method, path, body=json.dumps(body) if isinstance(body, (dict, list)) else body, headers=h)
    r = c.getresponse()
    out = r.status, dict(r.getheaders()), r.read()
    c.close()
    return out


# locked until signed in: pages go to the sign-in page, the API says 401
code, hdr, _ = raw("/money/")
assert code == 302 and hdr["Location"].startswith("/login?next="), (code, hdr)
assert raw("/money/api/meta")[0] == 401 and raw("/api/meta")[0] == 401
assert raw("/")[0] == 302
# what the sign-in page needs is open; a manifest too (browsers fetch it without cookies)
assert raw("/login")[0] == 200 and raw("/ui/tokens.css")[0] == 200 and raw("/assets/icons/favicon-32.png")[0] == 200
assert json.loads(raw("/money/manifest.json")[2])["start_url"] == "/money/"
# while the password is the default, only this machine may connect: by name as well as socket
assert raw("/login", host="pi.tail1234.ts.net")[0] == 403, "Tailscale Serve connects from 127.0.0.1 too"
assert raw("/login", host="100.101.102.103:8765")[0] == 403

# signing in: a cookie the page cannot read, kept to this site, good for 30 days
assert raw("/api/login", "POST", {"password": "wrong"}, W)[0] == 403
code, hdr, _ = raw("/api/login", "POST", {"password": "pass"}, W)
assert code == 200 and "HttpOnly" in hdr["Set-Cookie"] and "SameSite=Strict" in hdr["Set-Cookie"], hdr
assert f"Max-Age={30 * 86400}" in hdr["Set-Cookie"] and "Secure" not in hdr["Set-Cookie"]
C = {"Cookie": hdr["Set-Cookie"].split(";")[0]}
CW = dict(W, **C)
meta = json.loads(raw("/api/meta", headers=C)[2])
assert meta["password_default"] and [a["name"] for a in meta["apps"]][0] == "money"
m = json.loads(raw("/money/api/meta", headers=C)[2])
assert m["app"] == "money" and m["apps"] == meta["apps"] and m["settings"]["default_mode"] == "system"
assert "payday" in m["settings"], "the app's own settings are there too"

# the file overlay: an app's own files first, then the shared ones
assert raw("/money/app.js", headers=C)[0] == 200                     # apps/money/web/app.js
assert raw("/money/core/api.js", headers=C)[0] == 200                # web/core/api.js
assert b"start(app)" in raw("/money/", headers=C)[2]                  # the shared shell
assert raw("/money", headers=C)[1].get("Location") == "/money/"       # so relative imports resolve inside it
assert b"home.js" in raw("/", headers=C)[2]
for bad in ("/../core/db.py", "/money/..%2f..%2fcore/db.py", "/money/../../core/db.py", "/money/../apps/money/app.py"):
    assert raw(bad, headers=C)[0] == 404, bad
assert raw("/admin", headers=C)[1]["Location"] == "/money/#/admin"

# CSRF: a cross-site form POST cannot set a custom header, so it is refused
assert raw("/money/api/t/tag", "POST", {"name": "csrf"}, dict(C, **{"Content-Type": "text/plain"}))[0] == 403
assert raw("/money/api/t/tag", "POST", {"name": "csrf2"}, dict(CW, Origin="https://evil.example"))[0] == 403
assert raw("/money/api/t/tag", "POST", {"name": "Kitchen"}, CW)[0] == 200
assert raw("/money/api/t/tag", "POST", {"name": "nosession"}, W)[0] == 401
tags = [t["name"] for t in json.loads(raw("/money/api/t/tag", headers=C)[2])]
assert "Kitchen" in tags and not {"csrf", "csrf2", "nosession"} & set(tags)
# DNS rebinding: the Host header is checked, not the socket
assert raw("/money/api/meta", headers=C, host="attacker.example")[0] == 421
assert raw("/money/api/meta", headers=C, host="LOCALHOST")[0] == 200
# the suite's own tables: themes and the theme in use, through the same generic API
assert raw("/api/t/theme", "POST", {"name": "Mine", "scheme": "dark", "vars": '{"--accent":"#224488"}'}, CW)[0] == 200
assert raw("/api/t/setting", "POST", {"key": "mode", "value": "t-mine"}, CW)[0] == 200
m = json.loads(raw("/money/api/meta", headers=C)[2])
assert m["themes"][0]["name"] == "Mine" and m["settings"]["default_mode"] == "t-mine"
assert raw("/api/t/secret", headers=C)[0] == 404 and raw("/api/t/app_db", headers=C)[0] == 404
assert raw("/money/api/admin/download", headers=C)[2][:15] == b"SQLite format 3"
# a blank filter means IS NULL, so it must reach the database rather than be dropped
raw("/money/api/t/category", "POST", [{"id": 901, "name": "Top"}, {"id": 902, "name": "Child", "parent_id": 901}], CW)
tops = [c["name"] for c in json.loads(raw("/money/api/t/category?parent_id=", headers=C)[2])]
assert "Top" in tops and "Child" not in tops, tops
print("ok — doors, sign-in, overlay")

# === the calendar feed: open by its key alone ===================================
tok = json.loads(raw("/api/token/cal", headers=C)[2])["token"]
assert raw("/cal/wrong.ics")[0] == 404
code, hdr, body = raw(f"/cal/{tok}.ics")
ics = body.decode()
assert code == 200 and hdr["Content-Type"].startswith("text/calendar") and ics.startswith("BEGIN:VCALENDAR\r\n"), ics[:80]
assert ics.endswith("END:VCALENDAR\r\n") and "SUMMARY:Payday" in ics and "UID:money-payday-" in ics
assert all(len(line.encode()) <= 75 for line in ics.split("\r\n")), "lines fold at 75 octets"
uids = [l for l in ics.split("\r\n") if l.startswith("UID:")]
assert len(uids) == len(set(uids)), "UIDs are unique"
assert "attachment" in raw(f"/cal/{tok}.ics?download=1")[1].get("Content-Disposition", "")
new = json.loads(raw("/api/token/cal", "POST", {}, CW)[2])["token"]
assert new != tok and raw(f"/cal/{tok}.ics")[0] == 404 and raw(f"/cal/{new}.ics")[0] == 200, "reset ends the old key"
assert server._fold("SUMMARY:" + "é" * 60).count("\r\n ") == 1 and server._ics_text("a,b;c\nd") == "a\\,b\\;c\\nd"
print("ok — calendar feed")

# === the phone: a share-sheet form post, and the capture key for a Shortcut =========
if "log" in SUITE.apps:
    B = "----daybook"
    form = (f"--{B}\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\nShared note #site\r\n"
            f"--{B}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"p.png\"\r\nContent-Type: image/png\r\n\r\n"
            ).encode() + b"\x89PNG\r\n\x1a\n" + b"\0" * 32 + f"\r\n--{B}--\r\n".encode()
    FORM = {"Content-Type": f"multipart/form-data; boundary={B}"}
    assert raw("/log/share", "POST", form, FORM)[0] == 401, "no cookie, no entry"
    assert raw("/log/share", "POST", form, dict(FORM, Origin="https://evil.example", **C))[0] == 403
    code, hdr, _ = raw("/log/share", "POST", form, dict(FORM, Origin="null", **C))     # no X-Daybook: a form cannot send it
    assert code == 303 and hdr["Location"].startswith("/log/#/day"), (code, hdr)
    inbox = json.loads(raw("/log/api/t/inbox", headers=C)[2])
    assert len(inbox) == 1 and inbox[0]["mime"] == "image/png"
    key = json.loads(raw("/api/token/capture", headers=C)[2])["token"]
    K = {"Authorization": f"Bearer {key}", **W}
    assert raw("/log/api/quick", "POST", {"text": "From the Shortcut"}, K)[0] == 200
    assert raw("/log/api/quick", "POST", {"text": "x"}, dict(W, Authorization="Bearer wrong"))[0] == 401
    assert raw("/log/api/t/entry", headers=K)[0] == 401 and raw("/money/api/meta", headers=K)[0] == 401, "the key opens one door"
    days = json.loads(raw(f"/log/api/day?d={date.today().isoformat()}", headers=C)[2])
    assert [e["text"] for e in days["entries"]][-2:] == ["Shared note #site", "From the Shortcut"], days
    print("ok — share sheet and capture key")

# === a new password signs every other device out ==================================
assert raw("/api/password", "POST", {"old": "nope", "new": "s3cret-pw"}, CW)[0] == 403
code, hdr, _ = raw("/api/password", "POST", {"old": "pass", "new": "s3cret-pw"}, CW)
assert code == 200 and raw("/money/api/meta", headers=C)[0] == 401, "the old session is void"
C = {"Cookie": hdr["Set-Cookie"].split(";")[0]}                      # this device got a fresh one
CW = dict(W, **C)
assert raw("/money/api/meta", headers=C)[0] == 200 and not suite.password_is_default()
assert raw("/login", host="pi.tail1234.ts.net")[0] == 200, "open to the tailnet once the password is changed"
assert "Secure" in raw("/api/login", "POST", {"password": "s3cret-pw"}, W, host="pi.tail1234.ts.net")[1]["Set-Cookie"]
code, hdr, _ = raw("/api/logout", "POST", {}, CW)
assert "Max-Age=0" in hdr["Set-Cookie"]
# wrong passwords are rate-limited: 8 in 5 minutes
server.CFG.fails.clear()
codes = [raw("/api/login", "POST", {"password": "x"}, W)[0] for _ in range(9)]
assert codes[:8] == [403] * 8 and codes[8] == 429, codes
server.CFG.fails.clear()
print("ok — password change, lock, rate limit")

# === the default password keeps it to this machine =================================
import argparse, contextlib, io           # noqa: E402,E401
import daybook                              # noqa: E402
with tempfile.TemporaryDirectory() as t4:
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            daybook.cmd_serve(argparse.Namespace(data=t4, backup_dir=None, no_backup=True, db=None,
                                                 host="0.0.0.0", port=0, open=False, allow_host=[]))
        raise SystemExit("FAIL: served to the network on the default password")
    except _db.Stop as e:
        assert "pass" in str(e)
suite.setup(os.path.join(tmp.name, "data"))

# === the launcher stops the server only once its window's browser has gone =========
import importlib.machinery, importlib.util      # noqa: E402,E401
_ld = importlib.machinery.SourceFileLoader("launcher", os.path.join(ROOT, "Daybook.pyw"))
launcher = importlib.util.module_from_spec(importlib.util.spec_from_loader("launcher", _ld)); _ld.exec_module(launcher)
launcher.PROFILE = os.path.join(tmp.name, "window"); os.makedirs(launcher.PROFILE)
assert not launcher.in_use()
if os.name != "nt":
    os.symlink(f"host-{os.getpid()}", os.path.join(launcher.PROFILE, "SingletonLock"))
    assert launcher.in_use()                                   # a live browser holds it
    os.remove(os.path.join(launcher.PROFILE, "SingletonLock"))
    os.symlink("host-999999999", os.path.join(launcher.PROFILE, "SingletonLock"))
    assert not launcher.in_use()                               # left behind by a crash
launcher.URL = f"http://127.0.0.1:{PORT}"
assert launcher.running(), "a second start finds the first and only opens the window"
seen, popen = [], launcher.subprocess.Popen
launcher.browser = lambda: "/usr/bin/true"
launcher.subprocess.Popen = lambda args: seen.append(args) or "window"
launcher.launch()
launcher.subprocess.Popen = popen
assert seen[0][1] == f"--app={launcher.URL}/" and not any("popup" in a or "tabs" in a for a in seen[0]), \
    "one app window (no tabs, no address bar), opening on Home"
ico = open(launcher.ICON, "rb").read()
assert ico[:4] == b"\0\0\1\0" and ico[4] >= 5, "the taskbar icon is a real .ico with several sizes"
print("ok — launcher")

# === an app is a folder: without one, the others carry on ============================
apps = dict(SUITE.apps)
SUITE.apps = {k: v for k, v in apps.items() if k != "money"}
assert raw("/money/api/meta", headers=C)[0] in (302, 401, 404)
SUITE.apps = apps
srv.shutdown()
tmp.cleanup()
print("\nok — all suite checks passed")
