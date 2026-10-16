"""Open textbooks in, as published: OpenStax sections, from their source on GitHub (CNXML).

    python3 daybook.py learn-import      every import in content/imports.json (it fetches: run it where GitHub is reachable)

What content/imports.json lists becomes, for each section:
  - a page of its own, exactly as published ("The original"), under web/media/openstax/<book>/<section>.html,
    linked from the lesson's reading list (its figures: the cards' own here, the rest from GitHub);
  - for a lesson listed under "lessons" (one with no cards of its own), the lesson's cards: its
    text as reading cards, its worked examples, and its exercises that come with an answer, as
    self-rated cards. Word for word, with the book's own maths (MathML) and figures: nothing here
    rewrites a word (SPEC.md §1). Its learning objectives become the lesson's goals.
A lesson already written from a section ("originals") only gains the link to that original page.
OpenStax books are © Rice University; the editions on GitHub are CC BY-NC-SA 4.0, and each
import says so. ponytail: the result is committed with the rest of the content, so a computer
without GitHub (the Pi) needs nothing fetched.
"""
import json
import os
import re
import urllib.request
import xml.etree.ElementTree as ET
from html import escape

HERE = os.path.dirname(os.path.abspath(__file__))
CONTENT = os.path.join(HERE, "content")
MEDIA = os.path.join(HERE, "web", "media", "openstax")
RAW = "https://raw.githubusercontent.com/openstax/{repo}/main/{path}"
NS = {"c": "http://cnx.rice.edu/cnxml", "m": "http://www.w3.org/1998/Math/MathML",
      "col": "http://cnx.rice.edu/collxml", "md": "http://cnx.rice.edu/mdml"}
C, M = "{%s}" % NS["c"], "{%s}" % NS["m"]
LICENCE = "CC BY-NC-SA 4.0, https://creativecommons.org/licenses/by-nc-sa/4.0/"
# MathML as the book wrote it: these elements and attributes, nothing else
MATH_TAGS = {"math", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace", "msub", "msup", "msubsup", "mfrac", "msqrt", "mroot",
             "mfenced", "mtable", "mtr", "mtd", "munder", "mover", "munderover", "mstyle", "mpadded", "mphantom", "menclose",
             "semantics", "mlabeledtr", "maligngroup", "malignmark", "mmultiscripts", "mprescripts", "none"}
MATH_ATTRS = {"display", "mathvariant", "stretchy", "fence", "separator", "separators", "open", "close", "linethickness",
              "columnalign", "rowalign", "columnspacing", "rowspacing", "lspace", "rspace", "width", "height", "depth",
              "accent", "accentunder", "largeop", "movablelimits", "form", "notation", "scriptlevel", "displaystyle", "columnlines", "rowlines", "frame"}


def fetch(repo, path, binary=False):
    with urllib.request.urlopen(RAW.format(repo=repo, path=path), timeout=60) as r:
        data = r.read()
    return data if binary else data.decode("utf-8")


class Book:
    """A book's sections by number: 11.1 is chapter 11's first section (its introduction is 11.0)."""
    def __init__(self, slug, repo, title, by=""):
        self.slug, self.repo, self.title, self.by = slug, repo, title, by
        root = ET.fromstring(fetch(repo, f"collections/{slug}.collection.xml"))
        self.modules, chapters = {}, []
        def walk(content):                                  # a chapter holds modules; a unit holds chapters
            for sub in content.findall("col:subcollection", NS):
                inner = sub.find("col:content", NS)
                if inner.findall("col:module", NS):
                    chapters.append(inner)
                else:
                    walk(inner)
        walk(root.find("col:content", NS))
        for ch, inner in enumerate(chapters, 1):
            for k, mod in enumerate(inner.findall("col:module", NS)):
                self.modules[f"{ch}.{k}"] = mod.get("document")

    def section(self, number):
        mid = self.modules.get(number)
        if not mid:
            raise ValueError(f"{self.title} has no section {number}")
        return Section(self, number, ET.fromstring(fetch(self.repo, f"modules/{mid}/index.cnxml")))


def _slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


class Section:
    def __init__(self, book, number, root):
        self.book, self.number, self.root = book, number, root
        self.title = root.find("c:title", NS).text.strip()
        self.content = root.find("c:content", NS)
        self.media = set()                                     # figures it uses, to fetch
        self.ids = {e.get("id"): e.tag.replace(C, "") for e in root.iter() if e.get("id")}   # what a link points at

    @property
    def url(self):
        return f"https://openstax.org/books/{self.book.slug}/pages/{self.number.replace('.', '-')}-{_slug(self.title)}"

    @property
    def credit(self):
        return (f"OpenStax, {self.book.title}{', ' + self.book.by if self.book.by else ''}, section {self.number} {self.title}. "
                f"© Rice University. {LICENCE}. Imported as published, from {self.url}")

    @property
    def page(self):
        return f"media/openstax/{self.book.slug}/{self.number}.html"

    # ---- CNXML to HTML: the same words, the same maths, in the same order --------------------------
    def html(self, e, depth=3):
        """An element and what follows it inside its parent (its tail) is the caller's business."""
        tag = e.tag.replace(C, "")
        inner = lambda d=depth: self.kids(e, d)
        if e.tag.startswith(M):
            return self.mathml(e)
        if tag in ("para", "commentary"):
            return f"<p>{inner()}</p>"
        if tag == "title":
            return f"<h{depth}>{inner()}</h{depth}>"
        if tag == "label":
            return ""
        if tag in ("emphasis",):
            t = {"italics": "em", "underline": "u"}.get(e.get("effect"), "strong")
            return f"<{t}>{inner()}</{t}>"
        if tag == "term":
            return f"<strong>{inner()}</strong>"
        if tag in ("sub", "sup", "code"):
            return f"<{tag}>{inner()}</{tag}>"
        if tag in ("foreign", "span", "quote", "cite"):
            return inner()
        if tag == "newline":
            return "<br>"
        if tag == "footnote":
            return f" <small>({inner()})</small>"
        if tag == "link":
            url = e.get("url")
            if url and url.startswith("http"):
                return f'<a href="{escape(url)}" target="_blank" rel="noopener noreferrer">{inner()}</a>'
            # the book numbers its figures and tables when it prints them, so a link to one is empty here: say what it is
            words = inner()
            if words.strip():
                return words
            if e.get("document"):
                return "another section"
            return {"figure": "the figure", "table": "the table", "example": "the example", "equation": "the equation",
                    "exercise": "the exercise", "note": "the box", "section": "the section"}.get(self.ids.get(e.get("target-id")), "the text")
        if tag == "list":
            t = "ol" if e.get("list-type") == "enumerated" else "ul"
            title = e.find("c:title", NS)
            items = "".join(f"<li>{self.kids(i, depth)}</li>" for i in e.findall("c:item", NS))
            return (self.html(title, depth + 1) if title is not None else "") + f"<{t}>{items}</{t}>"
        if tag == "equation":
            return f'<div class="eq">{inner()}</div>'
        if tag == "figure":
            return self.figure(e)
        if tag in ("media", "image"):
            return self.figure(e)
        if tag == "table":
            return self.table(e)
        if tag == "definition":
            term, meaning = e.find("c:term", NS), e.find("c:meaning", NS)
            return f"<p><strong>{self.kids(term, depth) if term is not None else ''}</strong> {self.kids(meaning, depth) if meaning is not None else ''}</p>"
        if tag in ("note", "example", "section", "exercise", "problem", "solution"):
            cls = " ".join(filter(None, [tag, e.get("class")]))
            return f'<div class="{escape(cls)}">{inner(depth + 1)}</div>'
        return inner()

    def kids(self, e, depth=3):
        out = [escape(e.text or "")]
        for k in e:
            out.append(self.html(k, depth))
            out.append(escape(k.tail or ""))
        return "".join(out)

    def mathml(self, e):
        name = e.tag.replace(M, "")
        if name == "annotation" or name == "annotation-xml":
            return ""
        if name not in MATH_TAGS:
            return "".join(self.mathml(k) + escape(k.tail or "") for k in e)
        attrs = "".join(f' {k}="{escape(v)}"' for k, v in e.attrib.items() if k in MATH_ATTRS)
        body = escape(e.text or "") + "".join(self.mathml(k) + escape(k.tail or "") for k in e)
        return f"<{name}{attrs}>{body}</{name}>"

    def figure(self, e):
        img = e if e.tag == C + "image" else e.find(".//c:image", NS)
        media = e if e.tag == C + "media" else e.find(".//c:media", NS)
        cap = e.find("c:caption", NS)
        if img is None:
            return ""
        name = os.path.basename(img.get("src", ""))
        self.media.add(name)
        alt = media.get("alt", "") if media is not None else ""
        return (f'<figure><img src="media/openstax/{self.book.slug}/{escape(name)}" alt="{escape(alt)}">'
                + (f"<figcaption>{self.kids(cap)}</figcaption>" if cap is not None else "") + "</figure>")

    def table(self, e):
        rows = []
        for part, cell in (("thead", "th"), ("tbody", "td")):
            for row in e.findall(f".//c:{part}/c:row", NS):
                rows.append("<tr>" + "".join(f"<{cell}>{self.kids(x)}</{cell}>" for x in row.findall("c:entry", NS)) + "</tr>")
        title = e.find("c:title", NS)
        return "<table>" + (f"<caption>{self.kids(title)}</caption>" if title is not None else "") + "".join(rows) + "</table>"

    # ---- the whole section, as published ---------------------------------------------------------
    def page_html(self):
        body = self.kids(self.content, 2)
        glossary = self.root.find("c:glossary", NS)
        if glossary is not None:
            body += "<h2>Key terms</h2>" + self.kids(glossary, 3)
        # the page sits beside the figures the cards show; its others load from the book's own copy online
        # ponytail: so a figure only the page shows needs the internet; download them all if the page must work offline
        here = set(os.listdir(os.path.join(MEDIA, self.book.slug)))
        body = re.sub(f'src="media/openstax/{self.book.slug}/([^"]+)"',
                      lambda m: f'src="{m[1] if m[1] in here else RAW.format(repo=self.book.repo, path="media/" + m[1])}"', body)
        return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(self.number + ' ' + self.title)} · {escape(self.book.title)}</title>
<link rel="stylesheet" href="../../../ui/tokens.css">
<style>body{{max-width:820px;margin:0 auto;padding:24px 18px 60px;background:var(--panel);color:var(--ink);font:16px/1.6 var(--sans)}}
figure{{margin:16px 0}} img{{max-width:100%;height:auto}} table{{border-collapse:collapse;margin:12px 0}} td,th{{border:1px solid var(--rule);padding:4px 8px}}
.note,.example{{border-left:3px solid var(--rule);padding:4px 14px;margin:14px 0}} .solution{{background:var(--panel-2);padding:4px 12px}}
.credit{{font-size:13px;color:var(--ink-3)}} .eq{{margin:10px 0;text-align:center}}</style></head><body>
<p class="credit">The original, as published: {escape(self.credit)}</p>
<h1>{escape(self.number + ' ' + self.title)}</h1>
{body}
</body></html>
"""

    # ---- the section as cards: reading, examples, exercises with their answers --------------------
    def cards(self, prefix):
        out, buf, words, heading, tried, shown = [], [], 0, None, set(), {}
        n = 0
        def flush():
            nonlocal buf, words
            html = "".join(buf)
            if text(html) or "<img" in html or "<math" in html:       # nothing but white space: no card
                out.append({"type": "concept", "stage": "learn", "title": heading or self.title, "html": html, "body": text(html)})
            buf, words = [], 0
        def walk(parent):
            nonlocal heading, words
            for e in parent:
                tag, cls = e.tag.replace(C, ""), e.get("class") or ""
                if tag == "title":
                    continue
                if tag == "note" and "learning-objective" in cls:
                    continue                                           # the lesson's goals
                if tag == "section":
                    flush()
                    t = e.find("c:title", NS)
                    if any(k in cls.split() for k in SKIP):
                        continue          # objectives (the goals), exam prep, reading lists, another course's review: the original page has them
                    if t is not None and text(self.kids(t)) == "Proof":
                        continue          # a proof stays whole, in the original page, not cut into cards
                    heading = text(self.kids(t)) if t is not None else heading
                    if any(k in cls.split() for k in BANK):
                        bank.extend(x for x in exercises(e, None) if not ALONE.search(x["front"]))   # the end-of-section set: its last few become the check
                    else:
                        walk(e)
                    continue
                if tag == "example":
                    flush()
                    if e.find("c:title", NS) is not None and text(self.kids(e.find("c:title", NS))) == "Proof":
                        continue
                    shown[heading] = shown.get(heading, 0) + 1
                    if shown[heading] > 2:
                        continue          # two worked examples a heading; the rest are in the original page
                    out.append({"type": "concept", "stage": "example", "title": f"Example: {text(self.kids(e.find('c:title', NS))) if e.find('c:title', NS) is not None else heading or self.title}",
                                "html": self.html(e), "body": text(self.html(e))})
                    continue
                if tag == "note" and ("try" in cls.split() or "check-understanding" in cls):
                    flush()
                    # one Try It a heading, the first that stands alone: the book gives one after nearly every example, and
                    # all of them in Review is the same question over and over. The rest, and any that needs something a
                    # card cannot show (a graph, a table, an earlier example), stay in the original page.
                    if heading not in tried:
                        got = [x for x in exercises(e, "practise") if not ALONE.search(x["front"])][:1]
                        if got:
                            tried.add(heading)
                            out.extend(got)
                    continue
                piece = self.html(e)
                buf.append(piece)
                words += len(text(piece).split())
                if words >= 220:                                       # a long run of reading: a card at the next element
                    flush()
        def exercises(parent, stage, lead=""):
            # "For the following exercises, solve…" comes once before a run of them: each card carries it
            got = []
            for ex in parent:
                tag = ex.tag.replace(C, "")
                if tag == "para" and re.match(r"(For|In) (the following|exercises?)", text(self.kids(ex))):
                    lead = self.html(ex)
                elif tag == "section":
                    got += exercises(ex, stage)
                elif tag != "exercise":
                    got += exercises(ex, stage, lead)
                else:
                    prob, sol = ex.find("c:problem", NS), ex.find("c:solution", NS)
                    if prob is None or sol is None:
                        continue                                       # no answer given: it stays in the original page
                    p, s = lead + self.kids(prob), self.kids(sol)
                    got.append({"type": "flash", "stage": stage, "front": text(p) or "(see the figure)", "back": text(s) or "(see the figure)",
                                "front_html": p, "back_html": s})
            return got
        bank = []
        walk(self.content)
        flush()
        # The section's own exercise set is long (a hundred or so); the lesson takes the last three that
        # come with an answer as its check, and the whole set is in the original page, as published.
        # ponytail: the rest of the set is not in Review; add it as practice cards if Practice runs dry.
        for c in bank[-3:]:
            c["stage"] = "check"
            out.append(c)
        for c in out:
            n += 1
            c["id"] = f"{prefix}-{n}"
        self.media = set(re.findall(r'src="media/openstax/[^/"]+/([^"]+)"',      # the figures the cards show, to fetch
                                    " ".join(c.get(k, "") for c in out for k in ("html", "front_html", "back_html"))))
        return out

    def goals(self):
        """Its learning objectives: in the abstract ("In this section, you will:"), or a note at the top."""
        ab = self.root.find(".//md:abstract", NS)
        if ab is not None and ab.find(".//c:item", NS) is not None:
            return [text(self.kids(i)) for i in ab.iter(C + "item")]
        note = next((x for x in self.content.iter() if x.tag in (C + "note", C + "section") and "learning-objective" in (x.get("class") or "")), None)
        return [text(self.kids(i)) for i in note.iter(C + "item")] if note is not None else []

    def save_page(self):
        """The figures the cards made so far show, then the page."""
        folder = os.path.join(MEDIA, self.book.slug)
        os.makedirs(folder, exist_ok=True)
        for name in sorted(self.media):
            dest = os.path.join(folder, name)
            if not os.path.exists(dest):
                open(dest, "wb").write(fetch(self.book.repo, f"media/{name}", binary=True))
        open(os.path.join(folder, f"{self.number}.html"), "w", encoding="utf-8").write(self.page_html())


# a section of these classes is left out of the cards, or (BANK) is the exercise set the check comes from
SKIP = {"coreq-skills", "learning-objectives", "ap-test-prep", "references"}
BANK = {"section-exercises", "section-exercise", "problems-exercises", "conceptual-questions", "exercises", "practice",
        "free-response", "bring-together-homework", "review-problems", "review-conceptual-questions"}

# words that mean an exercise leans on something the card cannot show
ALONE = re.compile(r"\b(the figure|the table|the example|the box|another section|graph(ed)? (in|below|above|shown)|shown (in|below|above)|"
                   r"refer to|using the data|use the data|in the previous|from the previous|the graph|graphing (calculator|utility))\b|^\(see the figure\)", re.I)


def text(html):
    """The words of some HTML, for search and lists: tags out, spaces tidied."""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').strip()


def place(cards, added):
    """What Daybook adds to a lesson from a book (context, questions, machines), kept through a fresh import:
    each added card goes after the book's card it names ("after"), else before the lesson's last check, in order."""
    out = list(cards)
    end = len(out)
    while end and out[end - 1].get("stage") == "check":
        end -= 1
    for c in added:
        at = next((i + 1 for i, x in enumerate(out) if x["id"] == c.get("after")), None)
        if at is None:
            at = end
        end += at <= end
        out.insert(at, c)
    return out


def run(plan_file=os.path.join(CONTENT, "imports.json"), log=print, only=None):
    """Do every import the plan lists. Lessons: written to their file (cards, goals, sources, the original).
    Originals: the page, and a link to it added to the lesson's reading list."""
    plan = json.load(open(plan_file, encoding="utf-8"))
    books = {}
    book = lambda slug: books.setdefault(slug, Book(slug, **plan["books"][slug]))
    files = {}
    for root, _dirs, fs in os.walk(CONTENT):
        for f in fs:
            if f.endswith(".json") and f not in ("subject.json", "tracks.json", "imports.json", "calibrate.json"):
                p = os.path.join(root, f)
                try:
                    files[json.load(open(p, encoding="utf-8")).get("id")] = p
                except (ValueError, AttributeError):
                    pass
    for lesson_id, sections in plan.get("lessons", {}).items():
        if only and lesson_id not in only:
            continue
        secs = [book(b).section(n) for b, n in sections]
        cards, goals = [], []
        for k, s in enumerate(secs):
            cards += s.cards(f"ox{k + 1}")
            s.save_page()
            goals += s.goals()
        # a tab in the source is indentation, not a word: a space reads the same and keeps JSON free of control characters
        cards = [{k: v.replace("\t", " ") if isinstance(v, str) else v for k, v in c.items()} for c in cards]
        subject = lesson_id.split(".")[0]
        path = files.get(lesson_id) or os.path.join(CONTENT, subject, lesson_id.split(".")[1], lesson_id.split(".")[-1] + ".json")
        old = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
        if old and not old.get("imported"):
            raise ValueError(f"{lesson_id} is written already: list it under originals, not lessons")
        cards = place(cards, [c for c in old.get("cards", []) if c.get("added")])
        words = sum(len((c.get("body") or c.get("front", "") + " " + c.get("back", "")).split()) for c in cards)
        lesson = {**{k: v for k, v in old.items() if k in ("title", "level", "prereq", "tags", "summary")},
                  "id": lesson_id, "imported": {"from": "openstax", "sections": [f"{s.book.slug} {s.number}" for s in secs]},
                  "minutes": max(10, round(words / 130 + sum(c["type"] == "flash" for c in cards))),
                  "goals": goals, "sources": [s.credit for s in secs],
                  "resources": [{"kind": "read", "title": f"The original: {s.book.title}, {s.number} {s.title}", "url": s.page,
                                 "by": "OpenStax, as published", "when": "during",
                                 "note": "The section as published: this lesson's cards are its words, cut into parts"} for s in secs],
                  "cards": cards}
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w", encoding="utf-8").write(json.dumps(lesson, ensure_ascii=False, indent=1) + "\n")
        log(f"{lesson_id}: {len(cards)} cards from {', '.join(s.book.title + ' ' + s.number for s in secs)}")
    for lesson_id, sections in plan.get("originals", {}).items():
        if only and lesson_id not in only:
            continue
        path = files[lesson_id]
        les = json.load(open(path, encoding="utf-8"))
        res = [r for r in les.get("resources") or [] if not str(r.get("url", "")).startswith("media/openstax/")]
        for b, n in sections:
            s = book(b).section(n)
            s.save_page()
            res.append({"kind": "read", "title": f"The original: {s.book.title}, {s.number} {s.title}", "url": s.page,
                        "by": "OpenStax, as published", "when": "during",
                        "note": "What this lesson was adapted from, word for word"})
        les["resources"] = res
        open(path, "w", encoding="utf-8").write(json.dumps(les, ensure_ascii=False, indent=1) + "\n")
        log(f"{lesson_id}: the original of {len(sections)} section(s) linked")
    from . import sources                                  # the other open and official sources
    sources.run(plan, files, log, only)
