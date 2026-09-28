"""Update's check:  python3 tests/test_update.py

A copy of Daybook as a computer has it (data inside, a portable python beside it),
GitHub's archive of a newer commit, and: it is put in place, the data untouched;
the old code is kept and comes back with rollback; a git checkout, a zip that is
not Daybook, and code older than the data are all refused.
"""
import io
import os
import shutil
import sqlite3
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from core import update                              # noqa: E402

tmp = tempfile.TemporaryDirectory()
inst = os.path.join(tmp.name, "Daybook")
shutil.copytree(ROOT, inst, ignore=shutil.ignore_patterns(".git", "__pycache__", "data", "backups", ".previous.zip"))
os.makedirs(os.path.join(inst, "data"))
os.makedirs(os.path.join(inst, "python"))
open(os.path.join(inst, "python", "python.exe"), "w").write("portable")
db = sqlite3.connect(os.path.join(inst, "data", "log.db"))
db.executescript("CREATE TABLE schema_version (n INTEGER PRIMARY KEY); INSERT INTO schema_version VALUES (1);")
db.close()
open(os.path.join(inst, "core", "gone.py"), "w").write("# removed upstream")
before = open(os.path.join(inst, "web", "core", "api.js")).read()


def archive(change=None, drop=()):
    """GitHub's zip of a commit: every file under one folder named after it."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for f in update._code_files(ROOT):
            if f in drop:
                continue
            data = open(os.path.join(ROOT, f), "rb").read()
            if change and f == change[0]:
                data += change[1]
            z.writestr("WillBurke02-Daybook-abc1234/" + f, data)
        z.writestr("WillBurke02-Daybook-abc1234/.gitignore", "data/\n")
    return buf.getvalue()


commit = {"sha": "abc1234", "at": "2026-10-01T09:00:00Z", "message": "Newer"}
update.install(archive(("web/core/api.js", b"\n// newer\n")), commit, inst, os.path.join(inst, "data"))
assert open(os.path.join(inst, "web", "core", "api.js")).read().endswith("// newer\n")
assert not os.path.exists(os.path.join(inst, "core", "gone.py")), "a folder of code is replaced whole"
assert open(os.path.join(inst, "python", "python.exe")).read() == "portable", "what is not code is left alone"
assert os.path.exists(os.path.join(inst, "data", "log.db"))
assert update.current(inst)["sha"] == "abc1234"
assert os.path.isfile(os.path.join(inst, update.PREVIOUS))
assert not [f for f in os.listdir(inst) if f.startswith(".update")], "nothing half-done left behind"
print("ok — newer code put in place; data, a portable python and the rest untouched")

update.rollback(inst)
assert open(os.path.join(inst, "web", "core", "api.js")).read() == before
assert os.path.exists(os.path.join(inst, "core", "gone.py")) and update.current(inst) is None
print("ok — rollback puts the old code back")

for blob, why in ((archive(drop=("core/server.py",)), "not Daybook"),
                  (archive(drop=tuple(f for f in update._code_files(ROOT) if f.startswith("apps/log/migrations/"))),
                   "older than your log data")):
    try:
        update.install(blob, commit, inst, os.path.join(inst, "data"))
        raise SystemExit(f"FAIL: installed code that is {why}")
    except ValueError as e:
        assert why in str(e), e
os.makedirs(os.path.join(inst, ".git"))
try:
    update.install(archive(), commit, inst)
    raise SystemExit("FAIL: overwrote a git checkout")
except ValueError as e:
    assert "git pull" in str(e)
assert open(os.path.join(inst, "web", "core", "api.js")).read() == before
print("ok — refused: not Daybook, older than the data, a git checkout")
print("all update checks passed")
