"""Log and GitHub: your activity on each day (commits, pull requests, issues), Log backed up to a
private repository as Markdown, a file a month, and every database there too, encrypted, on a branch
of its own. Stdlib only. The token lives in suite.db's secret table, never in log.db; the username and
the repository are Log settings (github_user, github_repo).
"""
import base64
import hashlib
import hmac
import io
import json
import os
import sqlite3
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
import zlib
from datetime import date, datetime
from itertools import groupby

from core import db as _db, sync as _sync

API = "https://api.github.com"


def _gh(token, method, path, body=None, timeout=30):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                                          "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "daybook"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as ex:
        if ex.code == 404 and method == "GET":
            return None
        raise ValueError(f"GitHub said {ex.code} {ex.reason}" + (": check the token" if ex.code in (401, 403) else ""))
    except (urllib.error.URLError, OSError) as ex:
        raise ValueError(f"GitHub not reached ({getattr(ex, 'reason', ex)})")


# --- your activity, a day at a time -------------------------------------------------------------

def rows_of(ev):
    """One GitHub event as gh_event rows: a push is a row a commit; most other kinds are not kept."""
    t = datetime.fromisoformat(ev["created_at"].replace("Z", "+00:00")).astimezone()     # the computer's own time zone
    day, at, repo, p, k = t.date().isoformat(), t.strftime("%H:%M"), ev["repo"]["name"], ev.get("payload") or {}, ev["type"]
    home = f"https://github.com/{repo}"
    row = lambda kind, text, url, rid=ev["id"]: (str(rid), day, at, repo, kind, text[:300], url)
    if k == "PushEvent":
        commits = [c for c in p.get("commits") or [] if c.get("distinct", True)]
        if commits:
            return [row("commit", c["message"].split("\n")[0], f"{home}/commit/{c['sha']}", c["sha"]) for c in commits]
        n = p.get("distinct_size") or p.get("size") or 1          # GitHub may leave the commits out of the event
        return [row("commit", f"Pushed {n} commit{'s' if n != 1 else ''} to {(p.get('ref') or '').removeprefix('refs/heads/')}",
                    f"{home}/commits/{p['head']}" if p.get("head") else home)]
    if k in ("PullRequestEvent", "IssuesEvent") and p.get("action") in ("opened", "closed", "reopened"):
        x = p.get("pull_request") or p.get("issue") or {}
        act = "Merged" if x.get("merged") else p["action"].capitalize()
        what = "pull request" if k == "PullRequestEvent" else "issue"
        return [row("pr" if what == "pull request" else "issue", f"{act} {what} #{x.get('number', '?')}: {x.get('title', '')}",
                    x.get("html_url") or home)]
    if k == "PullRequestReviewEvent":
        x = p.get("pull_request") or {}
        return [row("review", f"Reviewed pull request #{x.get('number', '?')}: {x.get('title', '')}", x.get("html_url") or home)]
    if k == "IssueCommentEvent":
        x = p.get("issue") or {}
        return [row("comment", f"Commented on #{x.get('number', '?')}: {x.get('title', '')}", (p.get("comment") or {}).get("html_url") or home)]
    if k == "ReleaseEvent":
        x = p.get("release") or {}
        return [row("release", f"Released {x.get('name') or x.get('tag_name', '')}", x.get("html_url") or home)]
    if k == "CreateEvent" and p.get("ref_type") in ("repository", "branch", "tag"):
        return [row("create", f"Created {p['ref_type']} {p.get('ref') or repo}", home)]
    return []


def pull(db, user, token):
    """Your recent events (GitHub keeps 90 days, 300 at most), each kept once. Returns how many are new."""
    rows = []
    for page in (1, 2, 3):
        got = _gh(token, "GET", f"/users/{user}/events?per_page=100&page={page}") or []
        rows += [r for ev in got for r in rows_of(ev)]
        if len(got) < 100:
            break
    before = db.execute("SELECT COUNT(*) FROM gh_event").fetchone()[0]
    db.executemany("INSERT OR IGNORE INTO gh_event (id, day, at, repo, kind, text, url) VALUES (?,?,?,?,?,?,?)", rows)
    db.execute("INSERT OR REPLACE INTO setting (key, value) VALUES ('github_pulled', ?)", (datetime.now().strftime("%Y-%m-%d %H:%M"),))
    db.commit()
    return db.execute("SELECT COUNT(*) FROM gh_event").fetchone()[0] - before


# --- Log as Markdown, a file a month ------------------------------------------------------------

def _long(d):
    d = date.fromisoformat(d)
    return f"{d:%A} {d.day} {d:%B %Y}"


def month_md(db, ym):
    """One month of Log as Markdown: a heading a day, the diary, then the work entries by time."""
    rows = db.execute("SELECT * FROM v_entry WHERE substr(day, 1, 7) = ? ORDER BY day, kind = 'work', COALESCE(at, '99:99'), id",
                      (ym,)).fetchall()
    out = [f"# Log, {date.fromisoformat(ym + '-01'):%B %Y}", ""]
    for day, es in groupby(rows, key=lambda r: r["day"]):
        out += [f"## {_long(day)}", ""]
        for e in es:
            media = ", ".join(f"{n} {w}{'s' if n != 1 else ''}" for n, w in
                              ((e["photos"], "photo"), (e["videos"], "video"), (e["voices"], "voice note")) if n)
            text = (e["text"] or "").strip()
            if e["kind"] == "day":
                out += [f"**Diary.** {text}" + (f" _({media})_" if media else ""), ""]
            else:
                out.append(f"- **{e['at'] or '--:--'}** {text}".rstrip().replace("\n", "\n  ") + (f" _({media})_" if media else ""))
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def tags_md(db):
    rows = db.execute("SELECT tag, n, last_day, note FROM v_tag ORDER BY n DESC, tag").fetchall()
    return "# Tags\n\n" + "".join(f"- **#{r['tag']}** ({r['n']}, last {r['last_day']})" + (f": {r['note']}" if r["note"] else "") + "\n"
                                  for r in rows)


def backup(db, token, repo, branch="main"):
    """Each month with entries as log/YYYY/YYYY-MM.md, and log/tags.md, in the repository. Only what changed
    since the last backup is sent. Returns how many files were."""
    sent = json.loads(_db.settings(db).get("github_sent") or "{}")
    files = {f"log/{ym[:4]}/{ym}.md": month_md(db, ym)
             for (ym,) in db.execute("SELECT DISTINCT substr(day, 1, 7) FROM entry ORDER BY 1")}
    files["log/tags.md"] = tags_md(db)
    n = 0
    for path, text in files.items():
        h = hashlib.sha1(text.encode()).hexdigest()
        if sent.get(path, [None])[0] == h:
            continue
        body = {"message": f"Log: {path.rsplit('/', 1)[-1]}", "branch": branch, "content": base64.b64encode(text.encode()).decode()}
        for attempt in (1, 2):
            old = sent.get(path, [None, None])[1] if attempt == 1 else ((_gh(token, "GET", f"/repos/{repo}/contents/{path}?ref={branch}") or {}).get("sha"))
            if old:
                body["sha"] = old
            try:
                r = _gh(token, "PUT", f"/repos/{repo}/contents/{path}", body)
                break
            except ValueError as ex:                # changed on GitHub since (409), or never sent from here (422): ask its sha
                if attempt == 2 or not any(c in str(ex) for c in ("409", "422")):
                    raise
                body.pop("sha", None)
        sent[path] = [h, r["content"]["sha"]]
        n += 1
    db.execute("INSERT OR REPLACE INTO setting (key, value) VALUES ('github_sent', ?)", (json.dumps(sent),))
    db.execute("INSERT OR REPLACE INTO setting (key, value) VALUES ('github_backed_up', ?)", (datetime.now().strftime("%Y-%m-%d %H:%M"),))
    db.commit()
    return n


# --- everything, encrypted, on a branch of its own ----------------------------------------------
# Each database goes as a copy, compressed and sealed with the backup code (sync's seal: encrypt, then
# MAC). Log's photos, voice notes and videos are taken out of its copy and go once each, as
# media/<keyed hash of the bytes>, so a day's backup sends the databases and only what is new. The
# branch is one commit, replaced each time, so old copies do not pile up in the repository (the
# computer keeps 30 days of its own). ponytail: the seal is pure Python, about 1–2 MB a second on a
# Pi, so the first backup of a big Log takes minutes and a day's after that seconds.

BRANCH = "daybook-backup"
PART = 16 * 1024 * 1024        # GitHub takes up to 100 MB a file; parts keep each request, and the seal's memory, small
MEDIA = (("attachment", "id", "data"), ("clip_data", "clip_id", "data"))     # photos and voice notes (data URLs), videos (bytes)
PACE = 8                       # seconds between files once 60 have gone: GitHub takes about 500 new files an hour, so a
                               # first backup of hundreds of photos is spread over an hour or two rather than refused


def _send(token, repo, key, path, data, keep):
    """data sealed, as blobs path.0, path.1…; their shas go in keep."""
    for n, i in enumerate(range(0, max(len(data), 1), PART)):
        keep[f"{path}.{n}"] = _gh(token, "POST", f"/repos/{repo}/git/blobs", {
            "content": base64.b64encode(_sync.seal(key, data[i:i + PART])).decode(), "encoding": "base64"}, timeout=600)["sha"]


def backup_all(token, repo, key, dbs, courses=None):
    """Every database in dbs ({file name: path}), and the courses folder, as the one commit on BRANCH.
    Returns (files sent, bytes sent)."""
    tree = _gh(token, "GET", f"/repos/{repo}/git/trees/{BRANCH}?recursive=1") or {"tree": []}
    have = {x["path"]: x["sha"] for x in tree["tree"] if x["type"] == "blob"}
    names = hmac.digest(key, b"daybook backup: names", "sha256")
    keep, sent = {}, [0, 0]

    def send(path, data):
        if sent[0] >= 60:
            time.sleep(PACE)
        _send(token, repo, key, path, data, keep)
        sent[0] += 1
        sent[1] += len(data)

    for name, path in dbs.items():
        with tempfile.TemporaryDirectory(dir=os.path.dirname(path)) as tmp:      # beside it: /tmp may be memory
            copy = os.path.join(tmp, name)
            src, db = sqlite3.connect(path), sqlite3.connect(copy)
            src.backup(db)                        # safe on a database in use
            src.close()
            _sync.drop_triggers(db)               # made again where it is restored
            for t, k, c in MEDIA:
                if not db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (t,)).fetchone():
                    continue
                db.execute("CREATE TABLE IF NOT EXISTS backup_media (tbl TEXT, id INTEGER, file TEXT)")
                for (rid,) in db.execute(f"SELECT {k} FROM {t}").fetchall():
                    v = db.execute(f"SELECT {c} FROM {t} WHERE {k} = ?", (rid,)).fetchone()[0]
                    raw = v.encode() if isinstance(v, str) else v
                    f = "media/" + hmac.new(names, raw, "sha256").hexdigest()[:32]
                    n = 0
                    while f"{f}.{n}" in have:              # sent on an earlier day
                        keep[f"{f}.{n}"] = have[f"{f}.{n}"]
                        n += 1
                    if not n and f"{f}.0" not in keep:
                        send(f, zlib.compress(raw, 6) if isinstance(v, str) else raw)     # a data URL squeezes back to about its bytes
                    db.execute("INSERT INTO backup_media (tbl, id, file) VALUES (?, ?, ?)", (t, rid, f))
                # what is left of a data URL ('data:image/jpeg;base64,') still passes the table's CHECK
                db.execute(f"UPDATE {t} SET {c} = CASE WHEN typeof({c}) = 'text' THEN substr({c}, 1, instr({c}, ',')) ELSE x'' END")
            db.commit()
            db.execute("VACUUM")
            db.close()
            with open(copy, "rb") as fh:
                send(f"db/{name}", zlib.compress(fh.read(), 6))
    if courses and os.path.isdir(courses):        # courses imported into Learn are files, beside learn.db
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for folder, _dirs, files in os.walk(courses):
                for f in files:
                    z.write(os.path.join(folder, f), os.path.relpath(os.path.join(folder, f), courses))
        send("courses.zip", buf.getvalue())
    t = _gh(token, "POST", f"/repos/{repo}/git/trees",
            {"tree": [{"path": p, "mode": "100644", "type": "blob", "sha": s} for p, s in sorted(keep.items())]})
    c = _gh(token, "POST", f"/repos/{repo}/git/commits",
            {"message": f"Daybook backup, {datetime.now():%Y-%m-%d %H:%M}", "tree": t["sha"], "parents": []})
    try:
        _gh(token, "PATCH", f"/repos/{repo}/git/refs/heads/{BRANCH}", {"sha": c["sha"], "force": True})
    except ValueError:                            # the first time: no branch yet
        _gh(token, "POST", f"/repos/{repo}/git/refs", {"ref": f"refs/heads/{BRANCH}", "sha": c["sha"]})
    return tuple(sent)


def restore_all(token, repo, key, folder):
    """The branch back into folder: each database with its media put back in, and the courses. Returns what was written."""
    tree = _gh(token, "GET", f"/repos/{repo}/git/trees/{BRANCH}?recursive=1")
    if not tree:
        raise ValueError(f"There is no backup in {repo} (it would be on the branch {BRANCH}).")
    have = {x["path"]: x["sha"] for x in tree["tree"] if x["type"] == "blob"}

    def get(path):
        out = []
        while f"{path}.{len(out)}" in have:
            blob = _gh(token, "GET", f"/repos/{repo}/git/blobs/{have[f'{path}.{len(out)}']}", timeout=600)
            try:
                out.append(_sync.unseal(key, base64.b64decode(blob["content"])))
            except ValueError:
                raise ValueError("That backup code does not open this backup.")
        if not out:
            raise ValueError(f"{path} is missing from the backup.")
        return b"".join(out)

    written, cols = [], {t: (k, c) for t, k, c in MEDIA}
    for p in sorted(have):
        if not (p.startswith("db/") and p.endswith(".0")):
            continue
        dest = os.path.join(folder, p[3:-2])
        with open(dest, "wb") as fh:
            fh.write(zlib.decompress(get(p[:-2])))
        db = sqlite3.connect(dest)
        if db.execute("SELECT 1 FROM sqlite_master WHERE name = 'backup_media'").fetchone():
            for t, rid, f in db.execute("SELECT tbl, id, file FROM backup_media").fetchall():
                k, c = cols[t]
                raw = get(f)
                v = db.execute(f"SELECT {c} FROM {t} WHERE {k} = ?", (rid,)).fetchone()[0]
                db.execute(f"UPDATE {t} SET {c} = ? WHERE {k} = ?", (zlib.decompress(raw).decode() if isinstance(v, str) else raw, rid))
            db.execute("DROP TABLE backup_media")
            db.commit()
        db.close()
        written.append(dest)
    if "courses.zip.0" in have:
        zipfile.ZipFile(io.BytesIO(get("courses.zip"))).extractall(os.path.join(folder, "courses"))
        written.append(os.path.join(folder, "courses"))
    return written
