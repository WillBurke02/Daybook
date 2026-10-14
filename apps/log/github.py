"""Log and GitHub: your activity on each day (commits, pull requests, issues), and Log backed up to a
private repository as Markdown, a file a month. Stdlib only. The token lives in suite.db's secret
table, never in log.db; the username and the repository are Log settings (github_user, github_repo).
"""
import base64
import hashlib
import json
import urllib.error
import urllib.request
from datetime import date, datetime
from itertools import groupby

from core import db as _db

API = "https://api.github.com"


def _gh(token, method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                                          "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "daybook"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
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
