"""Courses from elsewhere, as course packs.

A course pack is a subject folder like the ones under content/: subject.json (the outline)
and a file per lesson. Packs live in the data folder, under courses/, beside learn.db, so an
update of Daybook never touches them; they load with the built-in courses on every start.

    import_file(folder, name, data)   an Anki deck (.apkg), a Moodle XML quiz, a GIFT quiz,
                                      or a course pack (.zip); returns what it made
    export_pack(folders, subject)     a subject, built-in or imported, as a .zip to share
    remove_pack(folder, subject)      an imported subject gone (your progress stays)

Every imported subject says where it came from and under what licence (its note). Only the
kinds of question Learn can mark are brought in; anything else is counted and left out, and
nothing runs anyone else's scripts.
"""
import base64
import html
import io
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import tempfile
import xml.etree.ElementTree as ET
import zipfile

CHUNK = 40                        # cards in a lesson, when a deck is bigger


def folder_of(db_path):
    return os.path.join(os.path.dirname(os.path.abspath(db_path)), "courses")


def _slug(s, n=40):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")[:n].strip("-") or "x"


# --- text from HTML, as Learn's cards write it ------------------------------------------------

def text_of(src, images=None, media=None):
    """HTML (Anki's fields, Moodle's question text) as Learn text: **bold**, *italic*, lists,
    line breaks, $maths$. A dollar sign stays a dollar sign. Pictures go into `images` as
    data URLs, when `media` ({name: bytes}) has them; sounds are dropped."""
    s = str(src or "")
    s = s.replace("$", "\\$")
    s = re.sub(r"\\\((.+?)\\\)", lambda m: "$" + m.group(1).replace("\\$", "$") + "$", s, flags=re.S)
    s = re.sub(r"\\\[(.+?)\\\]", lambda m: "$$" + m.group(1).replace("\\$", "$") + "$$", s, flags=re.S)

    def img(m):
        name = html.unescape(m.group(1)).split("/")[-1]
        data = (media or {}).get(name)
        if images is not None and data:
            mime = mimetypes.guess_type(name)[0] or "image/png"
            if mime.startswith("image/"):
                images.append(f"data:{mime};base64,{base64.b64encode(data).decode()}")
        return ""
    s = re.sub(r"<img[^>]*?src=[\"']([^\"']+)[\"'][^>]*>", img, s, flags=re.I)
    s = re.sub(r"\[sound:[^\]]+\]", "", s)
    s = re.sub(r"<br\s*/?>|</div>|</p>|</li>|</tr>|<hr[^>]*>", "\n", s, flags=re.I)
    s = re.sub(r"<li[^>]*>", "- ", s, flags=re.I)
    s = re.sub(r"</?(b|strong)(\s[^>]*)?>", "**", s, flags=re.I)
    s = re.sub(r"</?(i|em)(\s[^>]*)?>", "*", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\xa0", " ")
    s = re.sub(r"\*\*\s*\*\*", "", s)
    s = "\n".join(line.strip() for line in s.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", s).strip()


def _card(cid, kind, images=(), back_images=(), **fields):
    c = {"id": cid, "type": kind, **{k: v for k, v in fields.items() if v not in (None, "", [])}}
    if images:
        c["img"] = list(images)
    if back_images:
        c["back_img"] = list(back_images)
    return c


def _pack(sid, title, note, groups, source):
    """groups: [(lesson title, [cards])] → the subject and its lessons, a big group cut into lessons of CHUNK."""
    unit = f"{sid}.cards"
    lessons, outline, seen = [], [], set()
    for gtitle, cards in groups:
        cards = [c for c in cards if c]
        for k in range(0, len(cards), CHUNK):
            part = cards[k:k + CHUNK]
            n = len(cards) > CHUNK and k // CHUNK + 1
            lid = f"{unit}.{_slug(gtitle)}" + (f"-{n}" if n else "")
            while lid in seen:
                lid += "-x"
            seen.add(lid)
            t = f"{gtitle} ({n})" if n else gtitle
            outline.append({"id": lid, "title": t, "kind": "facts"})
            lessons.append({"id": lid, "title": t, "cards": part})
    subject = {"id": sid, "title": title, "note": note, "source": source, "pack": True,
               "units": [{"id": unit, "title": "Cards", "lessons": outline}]}
    return subject, lessons


# --- Anki ---------------------------------------------------------------------------------------

def _render(tmpl, fields, cloze=None, front=None):
    """An Anki card template filled in: {{Field}}, {{#Field}}…{{/Field}}, {{^Field}}…{{/Field}},
    {{cloze:Field}}, {{type:Field}}, {{FrontSide}}; filters other than cloze are ignored."""
    def section(m):
        neg, name, body = m.group(1) == "^", m.group(2).strip(), m.group(3)
        has = bool(re.sub(r"<[^>]+>|\s", "", fields.get(name, "")))
        return body if has != neg else ""
    for _ in range(5):                                     # nested sections
        tmpl = re.sub(r"\{\{([#^])([^}]+)\}\}(.*?)\{\{/\2\}\}", section, tmpl, flags=re.S)

    def field(m):
        spec = m.group(1).strip()
        if spec == "FrontSide":
            return front or ""
        parts = spec.split(":")
        name, filters = parts[-1].strip(), [p.strip() for p in parts[:-1]]
        v = fields.get(name, "")
        if "cloze" in filters and cloze is not None:
            n, side = cloze

            def one(c):
                if int(c.group(1)) != n:
                    return c.group(2)
                return f"**{c.group(2)}**" if side == "a" else f"[{c.group(3) or '…'}]"
            v = re.sub(r"\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}", one, v, flags=re.S)
        return v
    return re.sub(r"\{\{([^#^/][^}]*)\}\}", field, tmpl)


def from_anki(data, filename="deck.apkg"):
    z = zipfile.ZipFile(io.BytesIO(data))
    names = set(z.namelist())
    col = next((n for n in ("collection.anki21", "collection.anki2") if n in names), None)
    if not col:
        raise ValueError("That is not an Anki deck (.apkg), or it is in Anki's newest format: export it again "
                         "from Anki with \"Support older Anki versions\" ticked.")
    try:
        index = json.loads(z.read("media")) if "media" in names else {}
    except ValueError:
        index = {}                                        # the newest format keeps this compressed: pictures are left out
    media = {fname: z.read(num) for num, fname in index.items() if num in names}
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "col.db")
        open(path, "wb").write(z.read(col))
        db = sqlite3.connect(path)
        try:
            row = db.execute("SELECT models, decks FROM col").fetchone()
            models, decks = json.loads(row[0]), json.loads(row[1])
            notes = {nid: (str(mid), flds.split("\x1f")) for nid, mid, flds in db.execute("SELECT id, mid, flds FROM notes")}
            cards = db.execute("SELECT nid, did, ord FROM cards ORDER BY did, nid, ord").fetchall()
        finally:
            db.close()
    if "collection.anki21b" in names and len(notes) <= 1:
        raise ValueError("This deck is in Anki's newest format: export it again from Anki with \"Support older Anki versions\" ticked.")
    groups, skipped = {}, 0
    for nid, did, ord_ in cards:
        mid, flds = notes.get(nid, (None, []))
        model = models.get(mid)
        if not model:
            skipped += 1
            continue
        fields = {f["name"]: (flds[i] if i < len(flds) else "") for i, f in enumerate(model["flds"])}
        tmpls = model.get("tmpls") or [{"qfmt": "{{%s}}" % model["flds"][0]["name"], "afmt": "{{FrontSide}}<hr id=answer>" + "".join(
            "{{%s}}" % f["name"] for f in model["flds"][1:])}]
        if model.get("type") == 1:                        # cloze: one card per cloze number
            t, cz = tmpls[0], ord_ + 1
            q = _render(t["qfmt"], fields, (cz, "q"))
            a = _render(t["afmt"], fields, (cz, "a"), front=q)
        else:
            t = tmpls[ord_] if ord_ < len(tmpls) else tmpls[0]
            q = _render(t["qfmt"], fields)
            a = _render(t["afmt"], fields, front=q)
        a = re.split(r"<hr id=['\"]?answer['\"]?\s*/?>", a, maxsplit=1)[-1] if re.search(r"<hr id=['\"]?answer", a) else a.replace(q, "", 1)
        qi, ai = [], []
        front, back = text_of(q, qi, media), text_of(a, ai, media)
        if not (front or qi) or not (back or ai):
            skipped += 1
            continue
        deck = decks.get(str(did), {}).get("name", "Deck").replace("::", " › ")
        groups.setdefault(deck, []).append(_card(f"n{nid}-{ord_}", "flash", qi, ai, front=front or "(picture)", back=back or "(picture)"))
    if not groups:
        raise ValueError("No cards in that deck that Learn can show.")
    title = os.path.splitext(os.path.basename(filename))[0]
    root = os.path.commonprefix(list(groups)).rstrip(" ›") if len(groups) > 1 else next(iter(groups))
    sid = "anki-" + _slug(root or title, 30)
    groups = [(g[len(root):].lstrip(" ›") or g, cs) for g, cs in sorted(groups.items())] if len(groups) > 1 else list(groups.items())
    note = (f"Imported from the Anki deck {filename}. Check its licence where you got it (AnkiWeb shows each "
            f"shared deck's): share it on only if that allows.")
    return _pack(sid, root or title, note, groups, {"kind": "anki", "file": filename}), skipped


# --- Moodle XML --------------------------------------------------------------------------------

def _mtext(node, media):
    """A Moodle <text> element's HTML as Learn text, its pictures (@@PLUGINFILE@@) from <file> beside it."""
    if node is None:
        return "", []
    files = {f.get("name"): base64.b64decode(f.text or "") for f in node.findall("file")}
    files.update(media)
    imgs = []
    return text_of((node.findtext("text") or "").replace("@@PLUGINFILE@@/", ""), imgs, files), imgs


def from_moodle(xml_text, filename="quiz.xml"):
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise ValueError(f"That is not a Moodle XML quiz: {e}")
    if root.tag != "quiz":
        raise ValueError("That is not a Moodle XML quiz (it has no <quiz>).")
    groups, cat, skipped, n = {}, "Questions", 0, 0
    for q in root.findall("question"):
        kind = q.get("type")
        if kind == "category":
            path = (q.findtext("category/text") or "").split("/")
            cat = next((p for p in reversed(path) if p and not p.startswith("$")), "Questions")
            continue
        n += 1
        cid = _slug(q.findtext("name/text") or f"q{n}", 30) + f"-{n}"
        text, imgs = _mtext(q.find("questiontext"), {})
        general = _mtext(q.find("generalfeedback"), {})[0]
        answers = [(float(a.get("fraction") or 0), _mtext(a, {})[0], _mtext(a.find("feedback"), {})[0]) for a in q.findall("answer")]
        card = None
        if kind == "multichoice" and (q.findtext("single") or "true").strip().lower() in ("true", "1"):
            best = max(range(len(answers)), key=lambda i: answers[i][0]) if answers else None
            if best is not None and 2 <= len(answers) <= 6 and answers[best][0] > 0:
                card = _card(cid, "mcq", imgs, q=text, options=[a[1] for a in answers], answer=best,
                             why="\n\n".join(x for x in (answers[best][2], general) if x) or None)
        elif kind == "multichoice":
            right = [a[1] for a in answers if a[0] > 0]
            card = _card(cid, "flash", imgs, front=text + "\n\n(More than one is right.)", back="\n".join(f"- {r}" for r in right))
        elif kind == "truefalse":
            truth = next((a[1].lower().startswith("t") for a in answers if a[0] > 0), None)
            if truth is not None:
                card = _card(cid, "mcq", imgs, q=text, options=["True", "False"], answer=0 if truth else 1,
                             why=general or None, shuffle=False)
        elif kind == "numerical":
            good = [a for a in q.findall("answer") if float(a.get("fraction") or 0) == 100]
            if good:
                try:
                    value = float((good[0].findtext("text") or "").strip())
                    tol = float(good[0].findtext("tolerance") or 0)
                except ValueError:
                    value = None
                if value is not None:
                    unit = q.findtext("units/unit/unit_name")
                    card = _card(cid, "numeric", imgs, q=text, answer=repr(value), abs=tol if tol else None,
                                 tolerance=None if tol else 0.001, unit=unit, why=general or None)
        elif kind == "matching":
            pairs = [[_mtext(s, {})[0], (s.findtext("answer/text") or "").strip()] for s in q.findall("subquestion")]
            pairs = [p for p in pairs if p[0] and p[1]]
            if len(pairs) >= 2:
                card = _card(cid, "match", imgs, q=text, pairs=pairs, why=general or None)
        elif kind == "shortanswer":
            right = [a[1] for a in answers if a[0] == 100]
            if right:
                card = _card(cid, "flash", imgs, front=text, back=" / ".join(right) + (f"\n\n{general}" if general else ""))
        elif kind == "description" and text:
            card = _card(cid, "concept", imgs, title=q.findtext("name/text"), body=text)
        if card:
            groups.setdefault(cat, []).append(card)
        else:
            skipped += 1
    if not groups:
        raise ValueError("No questions in that file that Learn can ask.")
    title = os.path.splitext(os.path.basename(filename))[0]
    note = f"Imported from the Moodle quiz {filename}. Check its licence with whoever made it before you share it on."
    return _pack("moodle-" + _slug(title, 30), title, note, list(groups.items()), {"kind": "moodle", "file": filename}), skipped


# --- GIFT --------------------------------------------------------------------------------------

def _unescape(s):
    return re.sub(r"\\([~=#{}:\\n])", lambda m: "\n" if m.group(1) == "n" else m.group(1), s).strip()


def _split_gift(block):
    """The answer block's parts: (mark, text, feedback), mark '=' or '~' (with a %weight% kept in text)."""
    parts, i, cur, mark = [], 0, "", None
    while i < len(block):
        ch = block[i]
        if ch == "\\" and i + 1 < len(block):
            cur += block[i:i + 2]
            i += 2
            continue
        if ch in "=~":
            if mark is not None:
                parts.append((mark, cur))
            mark, cur = ch, ""
        else:
            cur += ch
        i += 1
    if mark is not None:
        parts.append((mark, cur))
    out = []
    for m, t in parts:
        fb = ""
        k = re.search(r"(?<!\\)#", t)
        if k:
            t, fb = t[:k.start()], t[k.start() + 1:]
        out.append((m, t, _unescape(fb)))
    return out


def from_gift(text, filename="quiz.gift"):
    lines = [l for l in text.replace("\r\n", "\n").split("\n") if not l.lstrip().startswith("//")]
    groups, cat, skipped, n = {}, "Questions", 0, 0
    for chunk in re.split(r"\n\s*\n", "\n".join(lines)):
        chunk = chunk.strip()
        if not chunk:
            continue
        m = re.match(r"\$CATEGORY:\s*(.+)", chunk)
        if m:
            cat = [p for p in m.group(1).strip().split("/") if p and not p.startswith("$")][-1:] or ["Questions"]
            cat = cat[0]
            continue
        n += 1
        title = None
        m = re.match(r"::(.*?)::", chunk, re.S)
        if m:
            title, chunk = m.group(1).strip(), chunk[m.end():]
        chunk = re.sub(r"^\[(html|markdown|plain|moodle)\]", "", chunk.strip())
        m = re.search(r"(?<!\\)\{(.*?)(?<!\\)\}", chunk, re.S)
        if not m:
            q = text_of(_unescape(chunk))
            if q:
                groups.setdefault(cat, []).append(_card(f"{_slug(title or q, 30)}-{n}", "concept", title=title, body=q))
            continue
        before, block, after = chunk[:m.start()], m.group(1).strip(), chunk[m.end():]
        q = text_of(_unescape(before + (" _____ " if after.strip() else "") + after))
        cid = f"{_slug(title or q, 30)}-{n}"
        card = None
        if re.fullmatch(r"T|TRUE|F|FALSE", block.split("#")[0].strip(), re.I):
            truth = block.strip().upper().startswith("T")
            fb = [_unescape(x) for x in block.split("#")[1:]]
            card = _card(cid, "mcq", q=q, options=["True", "False"], answer=0 if truth else 1, shuffle=False,
                         why=(fb[1] if not truth and len(fb) > 1 else fb[0] if fb else None) or None)
        elif block.startswith("#"):
            body = block[1:].strip()
            first = _split_gift(body)[0][1] if body.startswith("=") else body.split("#")[0]
            first = re.sub(r"^%\d+%", "", first).strip()
            rng = re.fullmatch(r"(-?[\d.eE+-]+)\.\.(-?[\d.eE+-]+)", first)
            tol = re.fullmatch(r"(-?[\d.eE+-]+)(?::([\d.eE+-]+))?", first)
            try:
                if rng:
                    lo, hi = float(rng.group(1)), float(rng.group(2))
                    card = _card(cid, "numeric", q=q, answer=repr((lo + hi) / 2), abs=(hi - lo) / 2)
                elif tol:
                    v, t = float(tol.group(1)), float(tol.group(2) or 0)
                    card = _card(cid, "numeric", q=q, answer=repr(v), abs=t if t else None, tolerance=None if t else 0.001)
            except ValueError:
                card = None
        else:
            parts = _split_gift(block)
            if parts and all(p[0] == "=" and "->" in p[1] for p in parts):
                pairs = [[_unescape(a), _unescape(b)] for a, b in (p[1].split("->", 1) for p in parts)]
                card = _card(cid, "match", q=q or "Match each one to its pair.", pairs=pairs)
            elif parts and any(p[0] == "~" for p in parts):
                opts = [(p[0] == "=" or re.match(r"%100%", p[1]), _unescape(re.sub(r"^%-?[\d.]+%", "", p[1])), p[2]) for p in parts]
                right = [i for i, o in enumerate(opts) if o[0]]
                if len(right) == 1 and 2 <= len(opts) <= 6:
                    card = _card(cid, "mcq", q=q, options=[o[1] for o in opts], answer=right[0], why=opts[right[0]][2] or None)
                elif right:
                    card = _card(cid, "flash", front=q + "\n\n(More than one is right.)", back="\n".join(f"- {opts[i][1]}" for i in right))
            elif parts:
                card = _card(cid, "flash", front=q, back=" / ".join(_unescape(re.sub(r"^%\d+%", "", p[1])) for p in parts))
        if card and q:
            groups.setdefault(cat, []).append(card)
        else:
            skipped += 1
    if not groups:
        raise ValueError("No questions in that file that Learn can ask.")
    title = os.path.splitext(os.path.basename(filename))[0]
    note = f"Imported from the GIFT quiz {filename}. Check its licence with whoever made it before you share it on."
    return _pack("gift-" + _slug(title, 30), title, note, list(groups.items()), {"kind": "gift", "file": filename}), skipped


# --- course packs: in, out, gone ----------------------------------------------------------------

def _write(folder, subject, lessons):
    dest = os.path.join(folder, subject["id"])
    tmp = dest + ".new"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    json.dump(subject, open(os.path.join(tmp, "subject.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for k, les in enumerate(lessons):
        json.dump(les, open(os.path.join(tmp, f"{k + 1:03d}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    shutil.rmtree(dest, ignore_errors=True)
    os.replace(tmp, dest)
    return dest


def from_zip(data, taken):
    """A course pack: a zip of one subject folder (subject.json and its lesson files). Checked by
    loading it as Learn would; its subject id must not be one of Learn's own."""
    from .app import read_content
    z = zipfile.ZipFile(io.BytesIO(data))
    with tempfile.TemporaryDirectory() as tmp:
        root = os.path.join(tmp, "pack")
        for n in z.namelist():
            if n.endswith("/") or ".." in n.split("/") or n.startswith("/"):
                continue
            dest = os.path.join(root, *n.split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            open(dest, "wb").write(z.read(n))
        outlines = [os.path.join(d, "subject.json") for d, _, fs in os.walk(root) if "subject.json" in fs]
        if len(outlines) != 1:
            raise ValueError("A course pack is one subject: a zip with one subject.json and its lesson files.")
        sdir = os.path.dirname(outlines[0])
        subject = json.load(open(outlines[0], encoding="utf-8"))
        if subject.get("id") in taken:
            raise ValueError(f"{subject.get('id')} is one of Learn's own subjects: give the pack another id.")
        check = os.path.join(tmp, "check")
        shutil.copytree(sdir, os.path.join(check, subject["id"]))
        read_content(check)                                        # raises ValueError on a broken pack
        lessons = []
        for d, _, fs in os.walk(sdir):
            for f in sorted(fs):
                if f.endswith(".json") and f != "subject.json":
                    lessons.append(json.load(open(os.path.join(d, f), encoding="utf-8")))
    subject["pack"] = True
    return (subject, lessons), 0


def import_file(folder, name, data, taken=()):
    """Whatever was picked, as a pack in `folder`. Returns {subject, title, lessons, cards, skipped}."""
    low = name.lower()
    if low.endswith((".apkg", ".colpkg")):
        (subject, lessons), skipped = from_anki(data, name)
    elif low.endswith(".zip"):
        (subject, lessons), skipped = from_zip(data, taken)
    elif low.endswith(".xml"):
        (subject, lessons), skipped = from_moodle(data.decode("utf-8-sig", errors="replace"), name)
    elif low.endswith((".gift", ".txt")):
        (subject, lessons), skipped = from_gift(data.decode("utf-8-sig", errors="replace"), name)
    else:
        raise ValueError("Learn imports an Anki deck (.apkg), a Moodle XML quiz (.xml), a GIFT quiz (.gift or .txt) "
                         "or a course pack (.zip). For a list of questions and answers, use the CSV import.")
    if subject["id"] in taken:
        raise ValueError(f"{subject['id']} is one of Learn's own subjects.")
    _write(folder, subject, lessons)
    return {"subject": subject["id"], "title": subject["title"], "lessons": len(lessons),
            "cards": sum(len(l["cards"]) for l in lessons), "skipped": skipped}


def packs(folder):
    out = []
    for sid in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        p = os.path.join(folder, sid, "subject.json")
        if os.path.isfile(p):
            s = json.load(open(p, encoding="utf-8"))
            out.append({"id": s["id"], "title": s["title"], "note": s.get("note"), "source": s.get("source")})
    return out


def remove_pack(folder, sid):
    dest = os.path.join(folder, sid)
    if not re.fullmatch(r"[\w.-]+", sid or "") or not os.path.isfile(os.path.join(dest, "subject.json")):
        raise ValueError("No imported course by that name.")
    shutil.rmtree(dest)


def export_pack(folders, sid):
    """The subject's folder as a zip, from wherever it lives (built-in or imported)."""
    for base in folders:
        for d in sorted(os.listdir(base)) if os.path.isdir(base) else []:
            p = os.path.join(base, d, "subject.json")
            if os.path.isfile(p) and json.load(open(p, encoding="utf-8")).get("id") == sid:
                buf = io.BytesIO()
                with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                    for root, _, fs in os.walk(os.path.join(base, d)):
                        for f in sorted(fs):
                            full = os.path.join(root, f)
                            z.write(full, os.path.join(sid, os.path.relpath(full, os.path.join(base, d))))
                return buf.getvalue()
    raise ValueError("No subject by that id.")
