"""Updating Daybook from GitHub: the code is replaced; the data is never touched.

    python daybook.py update             take the newest code from GitHub and put it in place
    python daybook.py update --check     say whether there is newer code
    python daybook.py update --rollback  put back the code from before the last update

The code lives on GitHub: change it there, from any computer or phone, and each
computer takes it with this (or Admin → Daybook version). core/, apps/, web/ and
tests/ are replaced whole and the files beside daybook.py are overwritten; data/,
backups/, a portable python/ and anything else not in the repository are left
alone. The code it replaced is kept in .previous.zip for --rollback.
"""
import io
import json
import os
import re
import shutil
import sqlite3
import time
import urllib.error
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CODE = ("core", "apps", "web", "tests")          # folders replaced whole
BUILD = ".daybook-build"                         # which commit this copy came from
PREVIOUS = ".previous.zip"


def _env(k, d):
    return os.environ.get("DAYBOOK_" + k) or d


def repo():
    return _env("UPDATE_REPO", "WillBurke02/Daybook"), _env("UPDATE_BRANCH", "main")


def _get(url, token=None):
    h = {"User-Agent": "daybook", "Accept": "application/vnd.github+json"}
    if token := token or _env("GITHUB_TOKEN", None):
        h["Authorization"] = f"Bearer {token}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=120) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise ValueError(f"GitHub said {e.code} {e.reason}")
    except (urllib.error.URLError, OSError) as e:
        raise ValueError(f"GitHub not reached ({getattr(e, 'reason', e)})")


def current(root=ROOT):
    """{sha, at, message} of the commit this copy came from, if an update put it here."""
    try:
        return json.load(open(os.path.join(root, BUILD), encoding="utf-8"))
    except (OSError, ValueError):
        return None


def latest():
    name, branch = repo()
    c = json.loads(_get(f"https://api.github.com/repos/{name}/commits/{branch}"))
    return {"sha": c["sha"], "at": c["commit"]["committer"]["date"],
            "message": c["commit"]["message"].split("\n")[0]}


def check(root=ROOT):
    have, new = current(root), latest()
    return {"repo": "/".join(repo()), "current": have, "latest": new, "git": _is_git(root),
            "available": not have or have.get("sha") != new["sha"]}


def _is_git(root):
    return os.path.exists(os.path.join(root, ".git"))


def _known(files):
    """{app: highest migration number} in a set of code paths (core/suite_migrations counts as the suite)."""
    out = {}
    for f in files:
        m = re.match(r"(?:apps/([a-z_]+)/migrations|core/(suite)_migrations)/(\d+)_[^/]*\.sql$", f)
        if m:
            app = m.group(1) or m.group(2)
            out[app] = max(out.get(app, 0), int(m.group(3)))
    return out


def _schemas(data):
    """{app: schema} of the databases in a data folder, read without changing them."""
    out = {}
    for f in os.listdir(data) if data and os.path.isdir(data) else []:
        if not f.endswith(".db"):
            continue
        try:
            db = sqlite3.connect(f"file:{os.path.join(data, f)}?mode=ro", uri=True)
            n = db.execute("SELECT MAX(n) FROM schema_version").fetchone()[0]
            db.close()
        except sqlite3.Error:
            continue
        out[f[:-3]] = n or 0
    return out


def _code_files(root):
    for d in CODE:
        for folder, dirs, files in os.walk(os.path.join(root, d)):
            dirs[:] = [x for x in dirs if x != "__pycache__"]
            for f in files:
                yield os.path.relpath(os.path.join(folder, f), root).replace(os.sep, "/")
    for f in os.listdir(root):
        if os.path.isfile(os.path.join(root, f)) and not f.startswith(".") and f != PREVIOUS:
            yield f


def _swap(root, new, keep_previous=True):
    """Put the code in folder `new` in place of root's, keeping root's in .previous.zip."""
    if keep_previous:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in _code_files(root):
                z.write(os.path.join(root, f), f)
        tmp = os.path.join(root, PREVIOUS + ".tmp")
        open(tmp, "wb").write(buf.getvalue())
        os.replace(tmp, os.path.join(root, PREVIOUS))
    old = os.path.join(root, ".update-old")
    shutil.rmtree(old, ignore_errors=True)
    os.makedirs(old)
    for d in CODE:
        if os.path.isdir(os.path.join(new, d)):
            if os.path.isdir(os.path.join(root, d)):
                os.replace(os.path.join(root, d), os.path.join(old, d))
            os.replace(os.path.join(new, d), os.path.join(root, d))
    for f in os.listdir(new):
        if os.path.isfile(os.path.join(new, f)):
            os.replace(os.path.join(new, f), os.path.join(root, f))
    shutil.rmtree(old, ignore_errors=True)


def install(blob, commit, root=ROOT, data=None):
    """Put the code in zip `blob` (GitHub's archive of a commit) in place. Refuses a git
    checkout, a zip that is not Daybook, and code older than the databases."""
    if _is_git(root):
        raise ValueError("This copy is a git checkout: update it with git pull instead.")
    z = zipfile.ZipFile(io.BytesIO(blob))
    top = os.path.commonprefix([n for n in z.namelist() if "/" in n]).split("/")[0] + "/"
    files = [n[len(top):] for n in z.namelist() if n.startswith(top) and not n.endswith("/")]
    if not {"daybook.py", "core/db.py", "core/server.py"} <= set(files):
        raise ValueError("That download is not Daybook.")
    if any(f.startswith("/") or ".." in f.split("/") for f in files):
        raise ValueError("That download has paths outside its folder.")
    known = _known(files)
    for app, n in _schemas(data).items():
        if n > known.get(app, 0):
            raise ValueError(f"That code is older than your {app} data (it knows schema {known.get(app, 0)}, "
                             f"the data is at {n}). Not updated.")
    new = os.path.join(root, ".update-new")
    shutil.rmtree(new, ignore_errors=True)
    for f in files:
        if f.split("/")[0] in CODE or "/" not in f:
            dest = os.path.join(new, *f.split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as out:
                out.write(z.read(top + f))
    _swap(root, new)
    shutil.rmtree(new, ignore_errors=True)
    json.dump(dict(commit, installed=time.strftime("%Y-%m-%d %H:%M")), open(os.path.join(root, BUILD), "w", encoding="utf-8"))
    return commit


def update(root=ROOT, data=None):
    """Fetch the newest commit's code and install it. None if this copy has it already."""
    info = check(root)
    if not info["available"]:
        return None
    name, _ = repo()
    blob = _get(f"https://api.github.com/repos/{name}/zipball/{info['latest']['sha']}")
    return install(blob, info["latest"], root, data)


def rollback(root=ROOT):
    """The code from before the last update, back in place (and that update's kept in its stead)."""
    prev = os.path.join(root, PREVIOUS)
    if not os.path.isfile(prev):
        raise ValueError("There is no earlier code kept here.")
    new = os.path.join(root, ".update-new")
    shutil.rmtree(new, ignore_errors=True)
    zipfile.ZipFile(prev).extractall(new)
    _swap(root, new)
    shutil.rmtree(new, ignore_errors=True)
    try:
        os.remove(os.path.join(root, BUILD))
    except OSError:
        pass
