"""Sync's check:  python3 tests/test_sync.py

Two computers (two data folders) and one sync folder. Joining, edits both ways,
the same field changed on both, a delete against an edit, the same day's diary
started on both, references between tables, a payslip moved to another date,
a wrong code, a file tampered with, a newer computer's files, and a copy made
in Admin staying out of it.
"""
import json
import os
import sqlite3
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from core import api, db as _db, suite, sync          # noqa: E402
from core.suite import SUITE                          # noqa: E402

tmp = tempfile.TemporaryDirectory()
A, B = os.path.join(tmp.name, "a"), os.path.join(tmp.name, "b")
FOLDER = os.path.join(tmp.name, "OneDrive", "Daybook")
os.makedirs(FOLDER)


def use(data):
    suite.setup(data)
    suite.open_all()


def con(app):
    return _db.connect(suite.path(app))


def q(app, sql, *args):
    c = con(app)
    try:
        return [tuple(r) for r in c.execute(sql, args)]
    finally:
        c.close()


def run(sql_by_app):
    for app, sqls in sql_by_app.items():
        c = con(app)
        for sql, args in sqls:
            c.execute(sql, args)
        c.commit()
        c.close()


def both(fn):
    """The same answer on both computers, after a round each way."""
    use(A); sync.run()
    use(B); sync.run()
    use(A); sync.run()
    a = fn()
    use(B)
    b = fn()
    assert a == b, f"\n A: {a}\n B: {b}"
    return a


# === A has data before sync is switched on ====================================
use(A)
run({"log": [("INSERT INTO entry (day, at, kind, text) VALUES ('2026-09-01', '08:00', 'work', 'Swapped the drive #site')", ()),
             ("INSERT INTO attachment (entry_id, type, data) VALUES (1, 'photo', 'data:image/jpeg;base64,AAAA')", ())],
     "money": [("INSERT INTO account (name, kind) VALUES ('Current', 'current')", ()),
               ("INSERT INTO category (parent_id, name) VALUES (NULL, 'Bench')", ()),
               ("INSERT INTO txn (account_id, date, description, amount, category_id) "
                "VALUES (1, '2026-09-02', 'SCREWFIX', -12.5, (SELECT id FROM category WHERE name = 'Bench'))", ()),
               # a transfer: two rows that name each other, made before sync was on
               ("INSERT INTO account (name, kind) VALUES ('Saver', 'savings')", ()),
               ("INSERT INTO txn (account_id, date, description, amount) VALUES (1, '2026-09-02', 'TO SAVER', -100)", ()),
               ("INSERT INTO txn (account_id, date, description, amount) VALUES (2, '2026-09-02', 'FROM CURRENT', 100)", ()),
               ("UPDATE txn SET link_id = (SELECT id FROM txn WHERE amount = 100) WHERE amount = -100", ()),
               ("UPDATE txn SET link_id = (SELECT id FROM txn WHERE amount = -100) WHERE amount = 100", ()),
               ("INSERT INTO payslip (pay_date) VALUES ('2026-08-28')", ()),
               ("INSERT INTO payslip_line (pay_date, grp, label, amount) VALUES ('2026-08-28', 'pay', 'Basic', 2400)", ())],
     "learn": [("INSERT INTO card (id, lesson_id, type, text, data, source) VALUES ('own/x', 'mine.cards', 'flash', 'Q', '{}', 'own')", ()),
               ("INSERT INTO answer (card_id, mode, correct) VALUES ('own/x', 'feed', 1)", ())]})
file_cards = q("learn", "SELECT COUNT(*) FROM card WHERE source = 'file'")[0][0]
categories = q("money", "SELECT COUNT(*) FROM category")[0][0]
settings = q("money", "SELECT COUNT(*) FROM setting")[0][0]
holidays = q("money", "SELECT COUNT(*) FROM bank_holiday")[0][0]
assert file_cards > 50 and categories == 1 and settings > 5 and holidays > 20

code = sync.setup("folder", path=FOLDER)
assert len(code.replace("-", "")) == 32
assert sync.status()["on"] and not sync.status()["last"]["error"], sync.status()
files = [f for _, _, fs in os.walk(FOLDER) for f in fs]
assert "daybook-sync.json" in files and any(f.endswith(".dbk") for f in files)
blob = b"".join(open(os.path.join(d, f), "rb").read() for d, _, fs in os.walk(FOLDER) for f in fs if f.endswith(".dbk"))
assert b"SCREWFIX" not in blob and b"Swapped" not in blob, "the files in the folder are encrypted"
try:
    sync.setup("folder", path=FOLDER)
    raise SystemExit("FAIL: set up twice")
except ValueError:
    pass
print("ok — switched on; the folder holds only encrypted files")

# === B joins =================================================================
use(B)
try:
    sync.setup("folder", path=FOLDER)
    raise SystemExit("FAIL: joined without the code")
except ValueError as e:
    assert "sync code" in str(e)
try:
    sync.setup("folder", path=FOLDER, code="AAAA-" * 7 + "AAAA")
    raise SystemExit("FAIL: joined with the wrong code")
except ValueError as e:
    assert "does not open" in str(e)
assert not sync.config(), "a failed join leaves nothing switched on"
sync.setup("folder", path=FOLDER, code=code.lower().replace("-", " "))
assert q("log", "SELECT day, text FROM entry") == [("2026-09-01", "Swapped the drive #site")]
assert q("log", "SELECT COUNT(*) FROM attachment")[0][0] == 1
assert q("money", "SELECT a.name, t.amount, c.name FROM txn t JOIN account a ON a.id = t.account_id "
                  "JOIN category c ON c.id = t.category_id") == [("Current", -12.5, "Bench")]
assert q("money", "SELECT t.description, u.description FROM txn t JOIN txn u ON u.id = t.link_id ORDER BY t.amount") == [
    ("TO SAVER", "FROM CURRENT"), ("FROM CURRENT", "TO SAVER")], "rows that name each other arrive whole"
assert q("money", "SELECT label, amount FROM payslip_line") == [("Basic", 2400.0)]
assert q("money", "SELECT COUNT(*) FROM category")[0][0] == categories
assert q("money", "SELECT COUNT(*) FROM setting")[0][0] == settings, "the defaults made on both are one set"
assert q("money", "SELECT COUNT(*) FROM bank_holiday")[0][0] == holidays
assert q("learn", "SELECT COUNT(*) FROM card WHERE source = 'file'")[0][0] == file_cards, "course cards never travel"
assert q("learn", "SELECT id FROM card WHERE source = 'own'") == [("own/x",)]
assert q("learn", "SELECT card_id, correct FROM answer") == [("own/x", 1)]
print("ok — a computer joins and takes everything, the defaults matched rather than doubled")

# === edits both ways, and references between tables =============================
run({"money": [("INSERT INTO category (parent_id, name) VALUES (NULL, 'Van')", ()),
               ("INSERT INTO category (parent_id, name) VALUES ((SELECT id FROM category WHERE name = 'Van'), 'Diesel')", ()),
               ("INSERT INTO txn (account_id, date, description, amount, category_id) VALUES "
                "((SELECT id FROM account WHERE name = 'Current'), '2026-09-03', 'SHELL', -60, "
                "(SELECT id FROM category WHERE name = 'Diesel'))", ())],
     "log": [("INSERT INTO entry (day, kind, text) VALUES ('2026-09-03', 'work', 'Commissioned line 2')", ())]})
use(A)
run({"money": [("INSERT INTO tag (name) VALUES ('Job 12')", ()),
               ("INSERT INTO txn_tag (txn_id, tag_id) VALUES ((SELECT id FROM txn WHERE description = 'SCREWFIX'), "
                "(SELECT id FROM tag WHERE name = 'Job 12'))", ())]})
got = both(lambda: q("money", "SELECT t.description, c.name, p.name FROM txn t JOIN category c ON c.id = t.category_id "
                              "LEFT JOIN category p ON p.id = c.parent_id ORDER BY t.date"))
assert got == [("SCREWFIX", "Bench", None), ("SHELL", "Diesel", "Van")], got
assert both(lambda: q("money", "SELECT t.description, g.name FROM txn_tag x JOIN txn t ON t.id = x.txn_id "
                               "JOIN tag g ON g.id = x.tag_id")) == [("SCREWFIX", "Job 12")]
assert both(lambda: q("log", "SELECT day, text FROM entry ORDER BY day")) == [
    ("2026-09-01", "Swapped the drive #site"), ("2026-09-03", "Commissioned line 2")]
print("ok — rows made on either computer reach the other, with their references")

# === the same field changed on both =============================================
use(A)
run({"log": [("UPDATE entry SET text = 'Swapped the drive (A)' WHERE day = '2026-09-01'", ())]})
use(B)
run({"log": [("UPDATE entry SET text = 'Swapped the drive (B)' WHERE day = '2026-09-01'", ())]})
use(A); sync.run()
use(B); sync.run()                       # B's change is the later one: it wins, and A keeps its own in history
got = both(lambda: q("log", "SELECT text FROM entry WHERE day = '2026-09-01'"))
assert got == [("Swapped the drive (B)",)], got
use(A)
hist = q("log", "SELECT id, summary, detail FROM change_log WHERE action = 'sync'")
assert len(hist) == 1 and "changed here and on" in hist[0][1] and "(A)" in hist[0][2], hist
c = con("log")
api.undo(c, hist[0][0])                  # put A's back: that is an edit like any other, and syncs
c.close()
assert both(lambda: q("log", "SELECT text FROM entry WHERE day = '2026-09-01'")) == [("Swapped the drive (A)",)]
print("ok — the later change wins; the other is kept in Change history, and Undo brings it back everywhere")

# === a delete against an edit ===================================================
use(A)
run({"log": [("DELETE FROM entry WHERE day = '2026-09-03'", ())]})
use(B)
run({"log": [("UPDATE entry SET text = 'Commissioned line 2, then lunch' WHERE day = '2026-09-03'", ())]})
assert both(lambda: q("log", "SELECT COUNT(*) FROM entry WHERE day = '2026-09-03'")) == [(0,)]
use(A)
run({"log": [("DELETE FROM entry WHERE day = '2026-09-01'", ())]})       # its photo goes with it (a cascade)
assert both(lambda: q("log", "SELECT COUNT(*) FROM attachment")) == [(0,)]
print("ok — a deleted row stays deleted, its children with it")

# === the same day's diary started on both =======================================
use(A)
run({"log": [("INSERT INTO entry (day, kind, text) VALUES ('2026-09-05', 'day', 'Rain all day.')", ())]})
use(B)
run({"log": [("INSERT INTO entry (day, kind, text) VALUES ('2026-09-05', 'day', 'Finished the FAT.')", ())]})
got = both(lambda: q("log", "SELECT text FROM entry WHERE day = '2026-09-05' AND kind = 'day'"))
assert got == [("Finished the FAT.\n\nRain all day.",)], got
print("ok — a diary started on both keeps both texts, one entry")

# === a payslip moved to another date, lines and all ===============================
use(A)
run({"money": [("INSERT INTO payslip (pay_date) VALUES ('2026-09-25')", ()),
               ("INSERT INTO payslip_line (pay_date, grp, label, amount) VALUES ('2026-09-25', 'pay', 'Basic', 2500)", ())]})
use(A); sync.run()
use(B); sync.run()
run({"money": [("UPDATE payslip SET pay_date = '2026-09-26' WHERE pay_date = '2026-09-25'", ())]})
assert both(lambda: q("money", "SELECT p.pay_date, l.label, l.amount FROM payslip p JOIN payslip_line l USING (pay_date) WHERE pay_date > '2026-09'")) == [
    ("2026-09-26", "Basic", 2500.0)]
print("ok — a row whose own key changes moves, its children with it")

# === a row with a unique name made on both (an INSERT OR REPLACE included) =========
use(A)
run({"money": [("INSERT INTO merchant (name) VALUES ('SCREWFIX')", ())]})
use(B)
run({"money": [("INSERT INTO merchant (name, note) VALUES ('SCREWFIX', 'tools')", ())]})
assert both(lambda: q("money", "SELECT name, note FROM merchant")) == [("SCREWFIX", "tools")]
use(A)
c = con("money")
mid = c.execute("SELECT id FROM merchant").fetchone()[0]
c.execute("INSERT INTO match_rule (merchant_id, kind, pattern) VALUES (?, 'contains', 'SCREW')", (mid,))
c.execute("INSERT OR REPLACE INTO match_rule (merchant_id, kind, pattern, priority) VALUES (?, 'contains', 'SCREW', 5)", (mid,))
c.commit()
c.close()
assert both(lambda: q("money", "SELECT pattern, priority FROM match_rule")) == [("SCREW", 5)]
print("ok — the same thing made on both is one row")

# === a later migration adding the same default row on both ==========================
for d in (A, B):
    use(d)
    c = con("money")
    c.execute("UPDATE sync_meta SET v = 1 WHERE k = 'applying'")       # as a migration runs: no triggers
    c.execute("INSERT INTO category (parent_id, name, kind) VALUES (NULL, 'Pension', 'saving')")
    c.execute("UPDATE sync_meta SET v = 0 WHERE k = 'applying'")
    _db.rebuild_views(c, SUITE.apps["money"])                           # every start: rows without a key are given one
    c.close()
assert both(lambda: q("money", "SELECT COUNT(*) FROM category WHERE name = 'Pension'")) == [(1,)]
print("ok — a default a migration adds on each computer is one row, not two")

# === a file tampered with, and one from a newer Daybook ==============================
use(A)
run({"log": [("INSERT INTO entry (day, kind, text) VALUES ('2026-09-06', 'work', 'Tampered')", ())]})
sync.run()
mine = sync.config()["dev"]
folder = os.path.join(FOLDER, "log", mine)
newest = sorted(os.listdir(folder))[-1]
raw = bytearray(open(os.path.join(folder, newest), "rb").read())
raw[30] ^= 1
open(os.path.join(folder, newest), "wb").write(raw)
use(B)
res = sync.run()
assert res["apps"]["log"]["problems"] and "does not open" in res["apps"]["log"]["problems"][0], res
assert q("log", "SELECT COUNT(*) FROM entry WHERE text = 'Tampered'") == [(0,)]
os.remove(os.path.join(folder, newest))

key = bytes.fromhex(sync.config()["key"])
sync._write(FOLDER, "log", "future-pc", key, 999, [{"t": 1, "tbl": "entry", "op": "i", "key": "zz",
                                                    "data": {"day": "2026-09-07", "kind": "work", "text": "From the future"}}])
res = sync.run()
assert any("newer Daybook" in p for p in res["apps"]["log"]["problems"]), res
assert q("log", "SELECT COUNT(*) FROM entry WHERE text = 'From the future'") == [(0,)]
print("ok — a changed file is refused; a newer Daybook's files wait for an update")

# === a copy made in Admin stays out of it ==========================================
use(B)
ctx = api.Ctx(True, suite.path("log"), None, switch=lambda p: suite.set_path("log", p), app=SUITE.apps["log"])
api.new_db(ctx, {"name": "log-sandbox", "copy": True})
assert suite.path("log").endswith("log-sandbox.db")
run({"log": [("INSERT INTO entry (day, kind, text) VALUES ('2026-09-08', 'work', 'Only in the sandbox')", ())]})
assert sync.run()["apps"]["log"] == {"off": True}
use(A); sync.run()
assert q("log", "SELECT COUNT(*) FROM entry WHERE text = 'Only in the sandbox'") == [(0,)]
print("ok — a copy made to try things on does not sync")

# === through GitHub: a fake of the three calls it makes ===============================
import base64, hashlib, http.client, threading                          # noqa: E401,E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer     # noqa: E402

REPO, SEEN = {}, []


class FakeGitHub(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        SEEN.append(self.headers.get("Authorization"))
        if self.path.endswith("/repos/will/daybook-data"):
            return self._json(200, {"private": True})
        if self.path.endswith("/repos/will/daybook"):
            return self._json(200, {"private": False})
        if "/git/trees/" in self.path:
            if not REPO:
                return self._json(409, {"message": "Git Repository is empty."})
            return self._json(200, {"tree": [{"path": p, "type": "blob", "sha": hashlib.sha1(d).hexdigest()} for p, d in REPO.items()]})
        sha = self.path.rsplit("/", 1)[1]
        d = next(d for d in REPO.values() if hashlib.sha1(d).hexdigest() == sha)
        self._json(200, {"content": base64.b64encode(d).decode(), "encoding": "base64"})

    def do_PUT(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        path = self.path.split("/contents/", 1)[1]
        assert path not in REPO, "a file is never sent twice"
        REPO[path] = base64.b64decode(body["content"])
        self._json(201, {})


gh = ThreadingHTTPServer(("127.0.0.1", 0), FakeGitHub)
threading.Thread(target=gh.serve_forever, daemon=True).start()
sync.API = f"http://127.0.0.1:{gh.server_address[1]}"
C, D = os.path.join(tmp.name, "c"), os.path.join(tmp.name, "d")
use(C)
run({"log": [("INSERT INTO entry (day, kind, text) VALUES ('2026-10-01', 'work', 'Sent by GitHub')", ())]})
try:
    sync.setup("github", repo="will/daybook", token="tok")
    raise SystemExit("FAIL: synced into a public repository")
except ValueError as e:
    assert "public" in str(e)
gcode = sync.setup("github", repo="will/daybook-data", token="tok")
assert "daybook-sync/daybook-sync.json" in REPO and any(p.startswith("daybook-sync/log/") for p in REPO), list(REPO)
assert b"Sent by GitHub" not in b"".join(REPO.values())
use(D)
sync.setup("github", repo="will/daybook-data", token="tok", code=gcode)
assert q("log", "SELECT text FROM entry") == [("Sent by GitHub",)]
run({"log": [("UPDATE entry SET text = 'Back by GitHub' WHERE day = '2026-10-01'", ())]})
sync.run()
use(C)
sync.run()
assert q("log", "SELECT text FROM entry") == [("Back by GitHub",)]
assert set(SEEN) == {"Bearer tok"}
gh.shutdown()
sync.API = "http://127.0.0.1:9"                   # nothing there: GitHub out of reach
run({"log": [("INSERT INTO entry (day, kind, text) VALUES ('2026-10-02', 'work', 'Written offline')", ())]})
res = sync.run()
assert "GitHub not reached" in res["error"] and res["apps"]["log"]["sent"] == 1, res
print("ok — through a GitHub repository, and offline from it: changes wait in the local copy")

# === the endpoints Admin uses =======================================================
from core import server                                                 # noqa: E402
E = os.path.join(tmp.name, "e")
use(E)
srv = server.serve("127.0.0.1", 0)
threading.Thread(target=srv.serve_forever, daemon=True).start()


def call(method, path, body=None, cookie=""):
    c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=30)
    c.request(method, path, body=json.dumps(body) if body is not None else None,
              headers={"Content-Type": "application/json", "X-Daybook": "1", "Cookie": cookie})
    r = c.getresponse()
    return r.status, json.loads(r.read() or b"{}"), r.getheader("Set-Cookie") or ""


st, _, ck = call("POST", "/api/login", {"password": "pass"})
ck = ck.split(";")[0]
assert call("GET", "/api/sync", cookie=ck)[:2] == (200, {"on": False})
st, got, _ = call("POST", "/api/sync", {"kind": "folder", "path": os.path.join(tmp.name, "nowhere")}, cookie=ck)
assert st == 400 and "folder that exists" in got["error"], got
st, got, _ = call("POST", "/api/sync", {"kind": "folder", "path": FOLDER, "code": code}, cookie=ck)
assert st == 200 and got["on"] and got["code"] == code, got
assert call("GET", "/api/sync/code", cookie=ck)[1]["code"] == code
assert q("log", "SELECT COUNT(*) FROM entry WHERE day = '2026-09-05'") == [(1,)], "joined, and took the folder's rows"
assert call("POST", "/api/sync/leave", {}, cookie=ck)[1] == {"on": False}
assert call("GET", "/api/sync")[0] == 401, "signed in only"
srv.shutdown()
print("ok — Admin's endpoints: status, start or join, the code, leave")

# === leaving ============================================================================
use(A)
sync.leave()
assert not sync.config() and not q("log", "SELECT name FROM sqlite_master WHERE name LIKE 'sync%'")
print("ok — leaving takes sync out and leaves the data")
print("all sync checks passed")
