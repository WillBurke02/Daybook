"""Open and official sources besides OpenStax, as published: a web page or a part of one, or a PDF.

    python3 daybook.py learn-import      (with the OpenStax books: content/imports.json, "pages" and "sources")

"sources" names each publisher once: who it is, its licence, and for its web pages what to keep and drop.
"pages" gives a lesson its parts, each word for word:
    {"src": "hse", "url": "https://www.hse.gov.uk/pubns/priced/hsg85.pdf", "pages": [5, 12],
     "part": ["Isolation", "Working live"], "title": "HSG85 Electricity at work"}
  pages   a PDF's pages, first and last (from 1)
  part    from the heading that starts with the first words up to the one that starts with the second
          (or the next heading as high as the first, if there is no second)
A gov.uk page comes through its content API; a DoITPoMS package (url ending /tlplib/<name>/) brings
its whole text, its aims as the lesson's goals, and its own questions with their answers, as marked
cards. Like openstax.py, it writes the lesson's cards, credits and a copy of each part as published
(web/media/<src>/), and keeps the cards Daybook adds to the lesson ("added").
ponytail: PDFs bring their words, not their figures; the original is linked for those. PyMuPDF reads
them (pip install pymupdf), only here, where the import runs.
"""
import hashlib
import http.client
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from html import escape, unescape
from html.parser import HTMLParser

from .openstax import CONTENT, MEDIA as _OX, MATH_TAGS, place, text

MEDIA = os.path.dirname(_OX)
UA = "Daybook lesson importer (personal study app; one copy of each page)"
CACHE = os.path.join(tempfile.gettempdir(), "daybook-import-cache")
_last = {}


def fetch(url, binary=False):
    """A page, once: kept in a cache so a second run asks nothing of the site; a pause between asks."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest())
    if not os.path.exists(path):
        host = urllib.parse.urlsplit(url).netloc
        time.sleep(max(0, 1.0 - (time.time() - _last.get(host, 0))))
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-GB"})
        for wait in (2, 5, 15, 0):                         # a dropped connection is tried again, a few times
            try:
                with urllib.request.urlopen(req, timeout=90) as r:
                    data = r.read()
                break
            except urllib.error.HTTPError:
                raise
            except (OSError, http.client.HTTPException):
                if not wait:
                    raise
                time.sleep(wait)
        _last[host] = time.time()
        open(path, "wb").write(data)
    data = open(path, "rb").read()
    return data if binary else data.decode("utf-8", "replace")


# ---- web pages: a tree from the HTML, then only the parts that carry the words -----------------------

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
BLOCK = {"p", "ul", "ol", "li", "table", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "div", "section", "figure", "pre",
         "blockquote", "dl", "dt", "dd", "article", "main", "header", "footer", "aside", "nav", "form", "caption", "thead", "tbody"}


class Node:
    def __init__(self, tag, attrs=None, parent=None):
        self.tag, self.attrs, self.kids, self.parent = tag, dict(attrs or {}), [], parent

    def cls(self):
        return self.attrs.get("class", "").split()

    def matches(self, sel):
        """'tag', '#id', '.class', 'tag.class', 'tag#id', '[attr=value]'."""
        m = re.fullmatch(r"([\w-]*)(?:#([\w-]+))?(?:\.([\w-]+))?(?:\[([\w-]+)=([^\]]*)\])?", sel)
        tag, id_, cl, an, av = m.groups()
        return ((not tag or self.tag == tag) and (not id_ or self.attrs.get("id") == id_) and (not cl or cl in self.cls())
                and (not an or self.attrs.get(an) == av))

    def find(self, sel):
        for k in self.kids:
            if isinstance(k, Node):
                if k.matches(sel):
                    return k
                got = k.find(sel)
                if got:
                    return got
        return None

    def words(self):
        return "".join(k if isinstance(k, str) else k.words() for k in self.kids)


class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = self.at = Node("root")

    def handle_starttag(self, tag, attrs):
        if tag in BLOCK and self.at.tag == "p":                # a block inside a paragraph ends it
            self.at = self.at.parent
        if tag == "li":
            self._close_to("li", stop={"ul", "ol"})
        if tag in ("td", "th"):
            self._close_to(("td", "th"), stop={"tr", "table"})
        n = Node(tag, attrs, self.at)
        self.at.kids.append(n)
        if tag not in VOID:
            self.at = n

    def handle_startendtag(self, tag, attrs):
        self.at.kids.append(Node(tag, attrs, self.at))

    def _close_to(self, tags, stop):
        tags = (tags,) if isinstance(tags, str) else tags
        n = self.at
        while n.parent and n.tag not in stop:
            if n.tag in tags:
                self.at = n.parent
                return
            n = n.parent

    def handle_endtag(self, tag):
        n = self.at
        while n.parent and n.tag != tag:
            n = n.parent
        if n.parent:
            self.at = n.parent

    def handle_data(self, data):
        self.at.kids.append(data)


def tree(html):
    t = Tree()
    t.feed(html)
    return t.root


def prune(n, drop):
    """Take out what never carries the text (scripts, menus) and what the source says to drop."""
    n.kids = [k for k in n.kids if isinstance(k, str) or not (k.tag in GONE or any(k.matches(s) for s in drop))]
    for k in n.kids:
        if isinstance(k, Node):
            prune(k, drop)
    return n


GONE = {"script", "style", "noscript", "nav", "form", "button", "input", "select", "textarea", "iframe", "svg", "canvas",
        "object", "embed", "video", "audio", "template", "head", "label"}
INLINE = {"strong": "strong", "b": "strong", "em": "em", "i": "em", "u": "u", "sub": "sub", "sup": "sup", "code": "code",
          "small": "small", "kbd": "code", "var": "em", "cite": "em", "dfn": "em", "tt": "code"}
KEEP = {"p", "ul", "ol", "li", "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "figure", "figcaption", "blockquote",
        "pre", "dl", "dt", "dd", "br"}


class Page:
    """One part of a source, as published: its blocks of HTML and its title."""

    def __init__(self, src, spec, url, title=""):
        self.src, self.spec, self.url, self.title = src, spec, url, title
        self.figures = {}                                  # local name: url, to fetch
        self.made = {}                                     # local name: the picture itself (a part of a PDF's page)

    # the cleaned HTML of a node: the same words, in a short list of elements
    def html(self, n, pre=False):
        if isinstance(n, str):
            return escape(n if pre else re.sub(r"\s+", " ", n), quote=False)
        tag = n.tag
        if tag in GONE:
            return ""
        if tag == "math":
            return self.mathml(n)
        inner = lambda: "".join(self.html(k, pre or tag == "pre") for k in n.kids)
        if tag in INLINE:
            body = inner()
            return f"<{INLINE[tag]}>{body}</{INLINE[tag]}>" if body.strip() else body
        if tag == "img":
            return self.figure(n)
        if tag == "a":
            href = urllib.parse.urljoin(self.url, n.attrs.get("href", ""))
            body = inner()
            here = href.split("#")[0] == self.url.split("#")[0]     # a jump within the page: its words only
            return f'<a href="{escape(href)}">{body}</a>' if href.startswith("http") and not here and body.strip() else body
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            return f"<h4>{inner()}</h4>"
        if tag in ("td", "th"):
            span = "".join(f' {k}="{escape(n.attrs[k])}"' for k in ("colspan", "rowspan") if n.attrs.get(k, "1") != "1")
            return f"<{tag}{span}>{inner()}</{tag}>"
        if tag in KEEP:
            return f"<{tag}>{inner()}</{tag}>" if tag != "br" else "<br>"
        return inner()                                     # div, span, section, font…: its words only

    def mathml(self, n):
        if isinstance(n, str):
            return escape(n, quote=False)
        tag = n.tag.split(":")[-1]
        if tag in ("annotation", "annotation-xml"):
            return ""
        body = "".join(self.mathml(k) for k in n.kids)
        return f"<{tag}>{body}</{tag}>" if tag in MATH_TAGS else body

    def figure(self, n):
        src = n.attrs.get("src") or n.attrs.get("data-src") or ""
        if not src or src.startswith("data:"):
            return ""
        url = urllib.parse.urljoin(self.url, src)
        if not re.search(r"\.(png|jpe?g|gif|webp)(\?|$)", url, re.I):
            return ""
        name = re.sub(r"[^\w.-]", "_", urllib.parse.unquote(url.split("/")[-1].split("?")[0]))[-80:]
        name = f"{hashlib.sha1(url.encode()).hexdigest()[:8]}-{name}"
        self.figures[name] = url
        return f'<img src="media/{self.src}/{escape(name)}" alt="{escape(n.attrs.get("alt", ""))}">'

    # ---- a page's blocks: its paragraphs, lists, tables and figures in order, its headings between ----
    def blocks(self, node):
        out = []
        def walk(n):
            for k in n.kids:
                if isinstance(k, str):
                    if k.strip():
                        out.append(("b", f"<p>{self.html(k)}</p>"))
                    continue
                if k.tag in GONE or any(k.matches(s) for s in self.spec.get("drop", [])):
                    continue
                if re.fullmatch(r"h[1-6]", k.tag):
                    words = re.sub(r"\s+", " ", k.words()).strip()
                    if words:
                        out.append(("h", int(k.tag[1]), words))
                elif k.tag in ("div", "section", "article", "main", "span", "font", "center", "header", "aside") and any(
                        isinstance(x, Node) and (x.tag in BLOCK or re.fullmatch(r"h[1-6]", x.tag)) for x in k.kids):
                    walk(k)                                # a wrapper: what is inside it, in order
                else:
                    piece = self.html(k)
                    if text(piece) or "<img" in piece:
                        if k.tag not in KEEP | {"pre"} and not piece.startswith("<"):
                            piece = f"<p>{piece}</p>"
                        elif k.tag in INLINE or k.tag in ("a", "img"):
                            piece = f"<p>{piece}</p>"
                        out.append(("b", piece))
        walk(node)
        return out


def part(blocks, spec):
    """Only the part the plan names: from a heading to the next as high (or to the heading named second)."""
    start, stop = ((spec.get("part") or []) + [None, None])[:2]
    ends = [s.lower() for s in spec.get("stop", [])]
    bare = lambda t: re.sub(r"^[\d.]+\s+", "", t).lower()     # "21.4.1 Thermocouple types" starts "Thermocouple types"
    if start:
        at = next((i for i, b in enumerate(blocks) if b[0] == "h" and bare(b[2]).startswith(start.lower())), None)
        if at is None:
            raise ValueError(f"no heading starting '{start}' in {spec['url']}")
        level, blocks = blocks[at][1], blocks[at:]
    else:
        level = None
    out = []
    for i, b in enumerate(blocks):
        if b[0] == "h" and i:
            if stop and bare(b[2]).startswith(stop.lower()):
                break
            if not stop and level and b[1] <= level:
                break
            if any(b[2].lower().startswith(e) for e in ends):
                break
        out.append(b)
    return out


# ---- PDFs: their words, paragraph by paragraph, the bigger type as headings ------------------------------

def pdf_blocks(data, spec, src, url):
    """A PDF's words, paragraph by paragraph, its larger type as headings, and each diagram or displayed
    equation as a picture of that part of the page (its figures, wherever they are vector drawings)."""
    try:
        import pymupdf
    except ImportError as e:
        raise ValueError("a PDF source needs PyMuPDF where the import runs: pip install pymupdf") from e
    doc = pymupdf.open(stream=data, filetype="pdf")
    first, last = spec.get("pages") or [1, doc.page_count]
    pages = range(first - 1, min(last, doc.page_count))
    figures = {}
    # the body text's size: the size most of the words are in
    sizes = {}
    for p in pages:
        for b in doc[p].get_text("dict")["blocks"]:
            for ln in b.get("lines", []):
                for sp in ln["spans"]:
                    sizes[round(sp["size"], 1)] = sizes.get(round(sp["size"], 1), 0) + len(sp["text"])
    if not sizes:
        return [], doc.metadata.get("title"), figures
    body = max(sizes, key=sizes.get)
    seen = {}
    for p in pages:
        H = doc[p].rect.height
        for b in doc[p].get_text("dict")["blocks"]:
            for ln in b.get("lines", []):                  # line by line, as pdf_paragraphs reads them
                if ln["bbox"][1] < H * 0.14 or ln["bbox"][3] > H * 0.88:
                    key = re.sub(r"\d+", "#", "".join(sp["text"] for sp in ln["spans"]).replace("\t", " ")).strip()
                    seen[key] = seen.get(key, 0) + 1
    heads = {k for k, n in seen.items() if n >= 3 and k}
    out = []
    for p in pages:
        page = doc[p]
        W, H = page.rect.width, page.rect.height
        items = []                                         # (y0, y1, x0, x1, kind, payload)
        for x0, y0, x1, y1, t, spans, item in pdf_paragraphs(page, heads):
            size = max(sp["size"] for sp in spans)
            mathy = sum(len(sp["text"]) for sp in spans if re.match(r"(CMMI|CMSY|CMEX|Symbol|MT|Math)", sp["font"].split("+")[-1]))
            if size < body - 1.5 and len(t.split()) < 40:
                kind = "loose"                             # small type: labels, notes on a figure
            elif size >= body + 1.5 and len(t.split()) <= 16 and not item and (
                    not spec.get("numbered") or re.match(r"^\d+(\.\d+)+\s", t)):   # (a book that numbers its headings)
                kind = "h"
            elif item:
                kind = "item"
            elif (x1 - x0) >= 0.5 * W * 0.7 or len(t.split()) >= 12 and mathy < len(t) / 3:
                kind = "text"
            else:
                kind = "loose"
            tex = any(re.match(r"(CMMI|CMSY|CMEX)", sp["font"].split("+")[-1]) for sp in spans)   # TeX's maths fonts
            if re.match(r"^(Figure|Fig\.|Table)\s+\d", t) and len(t.split()) < 25:
                kind = "loose"                             # a caption goes with its figure
            if all(re.match(r"(CMTT|Courier|.*Mono)", sp["font"].split("+")[-1]) for sp in spans):
                kind, tex = "loose", True                  # code: as a picture, since its spacing and underscores do not survive as text
            items.append([y0, y1, x0, x1, kind, (t, size, mathy > len(t) / 3 or kind == "loose" and tex)])
        paths = page.get_drawings()
        for r in page.cluster_drawings() if hasattr(page, "cluster_drawings") else []:
            inner = [d for d in paths if r.contains(d["rect"])]
            on = [it for it in items if r.x0 - 2 <= (it[2] + it[3]) / 2 <= r.x1 + 2 and r.y0 - 2 <= (it[0] + it[1]) / 2 <= r.y1 + 2]
            cover = sum((it[3] - it[2]) * (it[1] - it[0]) for it in on) / max(1, r.width * r.height)
            if len(inner) <= 2 and all(x[0] == "re" for d in inner for x in d["items"]) and cover < 0.1:
                for it in on:                              # an empty frame (a margin panel) is not a figure; its words are a label
                    it[4] = "loose"
                continue
            if len(inner) <= 6 and len(on) == 1 and cover > 0.3:
                continue                                   # a bar behind one line of words (a heading) is not a figure
            if r.width > 8 and r.height > 8 and r.height < H * 0.9:
                items.append([r.y0, r.y1, r.x0, r.x1, "draw", len(inner)])
            elif max(r.width, r.height) > 8:               # a line: a scale, an arrow, a fraction bar, if words are set on it
                items.append([r.y0, r.y1, r.x0, r.x1, "rule", None])
        for im in page.get_image_info():
            x0, y0, x1, y1 = im["bbox"]
            if (x1 - x0) > 30 and (y1 - y0) > 30:
                items.append([y0, y1, x0, x1, "draw", "image"])
        # a shaded panel or a picture behind paragraphs (a case study, a note) is not a figure: its words are the text;
        # a drawing with only short words on it (a graph, a diagram) is a figure, and those words are its labels
        # (a table is a drawing with many short words in it, and code in a box is mostly symbols: both are figures)
        said = [it for it in items if it[4] in ("text", "h", "item", "loose")]
        inside = lambda d, w, m=2: d[2] - m <= (w[2] + w[3]) / 2 <= d[3] + m and d[0] - m <= (w[0] + w[1]) / 2 <= d[1] + m

        def panel(d):
            if d[5] != "image" and d[5] > 6:               # many lines drawn: a diagram, however much it says
                return False
            on = [w for w in said if inside(d, w)]
            prose = [x for w in on if w[4] != "loose" or len(w[5][0].split()) >= 15 for x in w[5][0].split()]
            labels = sum(len(w[5][0].split()) for w in on if w[4] == "loose" and len(w[5][0].split()) < 15)
            return len(prose) > labels and sum(len(x) == 1 or bool(re.search(r"[;(){}=<>#]", x)) for x in prose) < 0.2 * len(prose)
        items = [it for it in items if not (it[4] == "draw" and panel(it))]
        draws = [it for it in items if it[4] == "draw"]
        for it in items:                                   # (a row of labels set just off a scale counts too)
            if it[4] in ("text", "h") and (any(inside(d, it) for d in draws)
                                          or len(it[5][0].split()) < 12 and any(inside(d, it, 16) for d in draws)):
                it[4] = "loose"
        # two columns (text blocks on both halves, few across both): the left column is read first, then the right
        texts = [it for it in items if it[4] in ("text", "h", "item")]   # (a figure's labels on both halves are not columns)
        left = sum(it[3] <= W * 0.55 for it in texts)
        right = sum(it[2] >= W * 0.45 for it in texts)
        if left >= 3 and right >= 3 and sum(it[3] - it[2] > W * 0.6 for it in texts) <= 2:
            items.sort(key=lambda it: (0 if it[2] < W * 0.45 else 1, it[0], it[2]))
        else:
            items.sort(key=lambda it: (it[0], it[2]))
        # bands: what lies between the paragraphs (labels, drawings, equations), taken together
        seq, band = [], None
        for it in items:
            if it[4] in ("text", "h", "item"):
                if band and it[0] < band[1] - 2 and it[4] == "text" and it[3] - it[2] < W * 0.5:
                    band[5].append(it)                     # a narrow paragraph alongside a drawing is part of it
                    band[1] = max(band[1], it[1]); band[2] = min(band[2], it[2]); band[3] = max(band[3], it[3])
                    continue
                if band:
                    seq.append(band); band = None
                seq.append(it)
            else:
                if band and it[0] <= band[1] + 8:
                    band[1] = max(band[1], it[1]); band[2] = min(band[2], it[2]); band[3] = max(band[3], it[3])
                    band[5].append(it)
                else:
                    if band:
                        seq.append(band)
                    band = [it[0], it[1], it[2], it[3], "band", [it]]
        if band:
            seq.append(band)
        li = False
        for it in seq:
            kind = it[4]
            if kind == "band":
                parts = it[5]
                labels = [x for x in parts if x[4] == "loose" and len(x[5][0].split()) <= 4]
                picture = any(x[4] == "draw" for x in parts) or any(x[5][2] for x in parts if x[4] == "loose") \
                    or any(x[4] == "rule" for x in parts) and len(labels) >= 3
                if picture and (it[1] - it[0]) > 10 and not (p == first - 1 and it[1] < H * 0.14):   # (not the publisher's logo)
                    clip = pymupdf.Rect(max(0, it[2] - 6), max(0, it[0] - 4), min(W, it[3] + 6), min(H, it[1] + 4))
                    photo = any(x[4] == "draw" and x[5] == "image" for x in parts)
                    pix = page.get_pixmap(clip=clip, dpi=110)
                    png = pix.tobytes("jpg", jpg_quality=78) if photo else pix.tobytes("png")
                    name = f"{hashlib.sha1((url + str(p) + str(clip)).encode()).hexdigest()[:12]}.{'jpg' if photo else 'png'}"
                    figures[name] = png
                    out.append(("b", f'<figure><img src="media/{src}/{name}" alt="A figure from page {p + 1} of the original"></figure>'))
                else:
                    for x in parts:                        # no drawing: small type (a footnote) or words set apart
                        if x[4] == "loose" and x[5][0]:
                            small = x[5][1] < body - 1.5
                            out.append(("b", f"<p><small>{escape(x[5][0])}</small></p>" if small else f"<p>{escape(x[5][0])}</p>"))
                continue
            t, size, _ = it[5]
            if kind == "h":
                if out and out[-1][0] == "h" and out[-1][3] == p and len(out[-1][2].split()) < 4:
                    out[-1] = ("h", out[-1][1], out[-1][2] + " " + t, p)   # a section number on its own line, then its title
                else:
                    num = re.match(r"^(\d+(?:\.\d+)*)\s", t)   # 21.4.1: a level-3 heading, whatever its size
                    level = min(4, num.group(1).count(".") + 1) if num else (2 if size >= body + 6 else 3)
                    out.append(("h", level, t, p))
                li = False
                continue
            if kind == "item":
                li = True
            pieces = [x.strip() for x in re.split(r"\s*(?:■\s*)+|\s+(?:●|––)\s+", t)]
            if len([x for x in pieces[1:] if x]) >= 1 and re.search(r"■|\s●\s|\s––\s", t):
                lead, items_ = pieces[0], [x for x in pieces[1:] if x]   # bullets inside the block: a list
                if lead:
                    out.append(("b", f"<p>{escape(lead)}</p>"))
                out.append(("b", "<ul>" + "".join(f"<li>{escape(x)}</li>" for x in items_) + "</ul>"))
                li = False
                continue
            m = re.match(r"^[■•▪●◆–]\s*", t)
            if m or li:
                t = t[m.end():] if m else t
                item = f"<li>{escape(t)}</li>"
                if out and out[-1][0] == "b" and out[-1][1].startswith("<ul>"):
                    out[-1] = ("b", out[-1][1][:-5] + item + "</ul>")
                else:
                    out.append(("b", f"<ul>{item}</ul>"))
                li = False
                continue
            prev = out[-1][1] if out and out[-1][0] == "b" else ""
            if prev.startswith("<p>") and t[:1].islower() and not re.search(r"[.:;!?)”]</p>$", prev):
                out[-1] = ("b", prev[:-4] + " " + escape(t) + "</p>")   # a paragraph carried over a page break
                continue
            out.append(("b", f"<p>{escape(t)}</p>"))
    return [b[:3] for b in out], (doc.metadata.get("title") or "").strip(), figures


BULLET = re.compile(r"^[■•▪●◆–]+$")
BRACKETS = str.maketrans("\x00\x01\x10\x11\x12\x13", "()()()")   # TeX's big brackets (cmex), as plain ones


def pdf_paragraphs(page, heads):
    """A page's paragraphs, rebuilt from its lines: a bullet drawn apart from its words still starts an item,
    a number beside a paragraph still opens it, and two columns are read one after the other.
    Yields (x0, y0, x1, y1, text, spans, is_list_item)."""
    W, H = page.rect.width, page.rect.height
    rows = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for ln in b["lines"]:
            spans = [sp for sp in ln["spans"] if sp["text"].strip()]
            if not spans:
                continue
            x0, y0, x1, y1 = ln["bbox"]
            t = "".join(sp["text"] for sp in ln["spans"]).replace("\t", " ").strip()
            if y1 < H * 0.07 or y0 > H * 0.93:              # running heads, page numbers
                continue
            if (y0 < H * 0.14 or y1 > H * 0.88) and re.sub(r"\d+", "#", t).strip() in heads:
                continue
            if y0 < H * 0.14 and len(t.split()) >= 2 and t.upper() == t and re.search(r"[A-Z]{3}", t):
                continue                                   # A RUNNING HEAD IN CAPITALS
            rows.append([x0, y0, x1, y1, t, spans])
    two = sum(r[2] <= W * 0.55 for r in rows) >= 6 and sum(r[0] >= W * 0.45 for r in rows) >= 6 \
        and sum(r[2] - r[0] > W * 0.6 for r in rows) <= 3
    col = lambda r: (0 if r[0] < W * 0.45 else 1) if two else 0
    rows.sort(key=lambda r: (col(r), round(r[1] / 3), r[0]))
    bullets = [(r[0], r[1], col(r)) for r in rows if BULLET.match(r[4]) or (len(r[4]) == 1 and r[4] in "lnu")]
    rows = [r for r in rows if not (BULLET.match(r[4]) or (len(r[4]) == 1 and r[4] in "lnu"))]
    lines = []                                             # side by side on one baseline: one line
    for r in rows:
        m = lines[-1] if lines else None
        if m and col(m) == col(r) and abs(m[1] - r[1]) < 3 and 0 <= r[0] - m[2] < 40:
            m[2], m[3], m[4], m[5] = r[2], max(m[3], r[3]), m[4] + " " + r[4], m[5] + r[5]
        else:
            lines.append(list(r))
    out, g = [], None
    for r in lines:
        x0, y0, x1, y1, t, spans = r
        size = max(sp["size"] for sp in spans)
        item = any(c == col(r) and abs(by - y0) < 4 and bx < x0 for bx, by, c in bullets) or bool(re.match(r"^[•●■]\s", t))
        numbered = bool(re.match(r"^\d{1,3}\s+\S", t)) and g is not None and x0 <= g["x"] + 2
        caption = re.compile(r"^(Figure|Fig\.|Table)\s+\d")       # a caption is a line of its own
        joins = (g is not None and not item and not numbered and col(r) == g["col"] and abs(size - g["size"]) < 0.6
                 and not caption.match(t) and not caption.match(g["t"])
                 and -max(2.0, (y1 - y0) * 0.4) <= y0 - g["y1"] < max(4.0, (y1 - y0) * 0.7)
                 and x0 <= g["x"] + 20 and x0 >= g["x"] - 25)   # (line boxes taller than the leading overlap)
        if joins:
            g["t"] += " " + t
            g["spans"] += spans
            g["y1"], g["x1"], g["x"] = y1, max(g["x1"], x1), min(g["x"], x0) if g["lines"] == 1 else g["x"]
            g["lines"] += 1
        else:
            if g:
                out.append(g)
            g = {"x": x0, "x0": x0, "y0": y0, "x1": x1, "y1": y1, "t": t, "spans": list(spans), "size": size,
                 "item": item, "col": col(r), "lines": 1}
    if g:
        out.append(g)
    for g in out:
        t = re.sub(r"\s+", " ", re.sub(r"(\w)- (\w)", r"\1\2", g["t"])).strip()
        t = re.sub(r"^[•●■]\s*", "", t)
        t = re.sub(r"[\x00-\x08\x0b-\x1f]", "", t.translate(BRACKETS))
        for lig, plain in (("ﬁ", "fi"), ("ﬂ", "fl"), ("ﬀ", "ff"), ("ﬃ", "ffi"), ("ﬄ", "ffl")):
            t = t.replace(lig, plain)
        yield g["x0"], g["y0"], g["x1"], g["y1"], t, g["spans"], g["item"]


# ---- gov.uk: the page's body from its content API -------------------------------------------------------

def govuk(url):
    path = urllib.parse.urlsplit(url).path
    for _ in range(3):
        d = json.loads(fetch("https://www.gov.uk/api/content" + path))
        if d.get("document_type") == "redirect" and d.get("redirects"):
            path = d["redirects"][0]["destination"].split("#")[0]
            continue
        det = d.get("details", {})
        body = det.get("body") or "".join(f"<h2>{escape(x['title'])}</h2>{x['body']}" for x in det.get("parts", []))
        return d.get("title", ""), body, "https://www.gov.uk" + path
    raise ValueError(f"{url}: too many redirects")


# ---- DoITPoMS: a whole package, its aims, and its questions with their answers ---------------------------

def doitpoms(base, page):
    """Its questions, as marked cards: each option is put to its answer page, which says Correct or not, and why."""
    root = tree(fetch(base + "questions.php"))
    cards = []
    for q in _all(root, "form"):
        qn, kind = _hidden(q, "question"), _hidden(q, "type")
        li = q.parent
        stem = "".join(page.html(k) for k in li.kids if k is not q and not (isinstance(k, Node) and k.tag == "form"))
        opts = [(r.attrs.get("value"), re.sub(r"\s+", " ", tr.words()).strip()) for tr in _all(q, "tr")
                for r in _all(tr, "input") if r.attrs.get("type") in ("radio", "checkbox")]
        if kind in ("1", "2", "4") and opts:
            right, why = None, ""
            for v, _ in opts:
                said = _answer(base, f"question={qn}&response={v}" + ("&button=answer" if kind == "2" else ""))
                if re.match(r"\s*Correct", said):
                    right, why = v, re.sub(r"^\s*Correct\.?\s*", "", said)
            if right is None:
                continue
            labels = [re.sub(rf"^{re.escape(v)}\s+", "", t) for v, t in opts]
            cards.append({"type": "mcq", "stage": "check", "q": text(stem), "q_html": stem, "options": labels,
                          "answer": [v for v, _ in opts].index(right), "why": why or "As the package explains."})
        elif kind == "3":
            ans = _answer(base, f"question={qn}&button=answer")
            worked = _answer(base, f"question={qn}&button=worked")
            back = (ans + ("\n\n" + worked if worked and worked != ans else "")).strip()
            if back:
                cards.append({"type": "flash", "stage": "check", "front": text(stem), "back": back,
                              "front_html": stem, "back_html": "".join(f"<p>{escape(x)}</p>" for x in back.split("\n\n"))})
    aims = tree(fetch(base + "aims.php")).find("div.col-lg-9")
    goals = [re.sub(r"\s+", " ", li.words()).strip() for li in _all(aims, "li")] if aims else []
    return cards, goals


def _all(n, tag):
    out = []
    for k in n.kids:
        if isinstance(k, Node):
            if k.tag == tag:
                out.append(k)
            out += _all(k, tag)
    return out


def _hidden(form, name):
    return next((i.attrs.get("value") for i in _all(form, "input") if i.attrs.get("name") == name), None)


def _answer(base, qs):
    body = tree(fetch(base + "answer.php?" + qs)).find("body")
    words = re.sub(r"\s+", " ", body.words() if body else "").strip()
    words = re.sub(r"^Answer to question \d+\s*", "", words)
    return re.sub(r"\s*Close this window\s*$", "", words)


# ---- a part to its blocks, whatever it is ------------------------------------------------------------------

def load(spec, sources):
    src = sources[spec["src"]]
    url = spec["url"]
    page = Page(spec["src"], {**src, **spec}, url, spec.get("title", ""))
    extra, goals = [], []
    if url.lower().endswith(".pdf") and fetch(url, binary=True)[:4] == b"%PDF":   # (some "PDFs" are web pages now)
        blocks, title, made = pdf_blocks(fetch(url, binary=True), page.spec, spec["src"], url)
        page.title = page.title or title or url.split("/")[-1]
        page.made = made
    elif "www.gov.uk/" in url:
        title, body, page.url = govuk(url)
        page.title = page.title or title
        blocks = page.blocks(tree(body))
    else:
        if re.search(r"/tlplib/[\w-]+/$", url):              # a DoITPoMS package: all of it on one page
            extra, goals = doitpoms(url, page) if spec.get("questions", True) else ([], [])
            fetched, page.url = fetch(url + "printall.php"), url
            if not page.title:                             # (the all-on-one page has no title of its own)
                t = tree(fetch(url + "index.php")).find("title")
                page.title = re.sub(r"\s+", " ", t.words()).strip() if t else ""
        else:
            fetched = fetch(url)
        root = tree(fetched)
        if not page.title:                                 # the page's own heading, else its title
            said = [re.sub(r"\s+", " ", n.words()).strip() for x in page.spec.get("title_from", ["h1", "title"]) for n in _all(root, x.split(".")[0])
                    if n.matches(x)]
            page.title = re.sub(r"\s*\(all content\)$", "", next((t for t in said if t), url))
        keep = next((root.find(s) for s in page.spec.get("keep", ["main", "body"]) if root.find(s)), root)
        blocks = page.blocks(prune(keep, page.spec.get("drop", [])))
    for cut in page.spec.get("cut", []):                   # a credit line or a link label the cards need not repeat
        blocks = [(b[0], b[1].replace(cut, "")) if b[0] == "b" else b for b in blocks]
    if page.spec.get("lead") is False:                     # what comes before the first heading under the title
        first = next((i for i, b in enumerate(blocks) if b[0] == "h" and b[1] > 1), 0)
        blocks = blocks[first:]
    blocks = [b for b in part(blocks, page.spec) if not (b[0] == "h" and b[1] == 1)]
    skip = page.spec.get("skip", [])
    if skip:                                               # parts that stay out of the cards (the page keeps them)
        out, gone = [], None
        for b in blocks:
            if b[0] == "h":
                gone = b[1] if any(s.lower() in b[2].lower() for s in skip) else (gone if gone and b[1] > gone else None)
            if not gone:
                out.append(b)
        blocks = out
    return page, blocks, extra, goals


def cards(blocks, title, prefix):
    out, buf, words, heading = [], [], 0, title
    def flush():
        nonlocal buf, words
        html = "".join(buf)
        if text(html) or "<img" in html:
            out.append({"type": "concept", "stage": "learn", "title": heading, "html": html, "body": text(html)})
        buf, words = [], 0
    for b in blocks:
        if b[0] == "b" and words >= 100 and words + len(text(b[1]).split()) > 280:
            flush()                                        # a long run of reading: a card before it gets too long
        if b[0] == "h":
            if words >= 90 or not buf:                     # a new card; a short part runs on into the next
                flush()
                heading = b[2]
            else:
                buf.append(f"<h4>{escape(b[2])}</h4>")
            continue
        buf.append(b[1])
        words += len(text(b[1]).split())
        if words >= 220:
            flush()
    flush()
    for n, c in enumerate(out, 1):
        c["id"] = f"{prefix}-{n}"
    return out


def save(page, blocks, credit):
    """The figures the part shows, then the part as published, beside them."""
    folder = os.path.join(MEDIA, page.src)
    os.makedirs(folder, exist_ok=True)
    for name, png in page.made.items():
        if f'src="media/{page.src}/{name}"' in "".join(b[1] for b in blocks if b[0] == "b"):
            open(os.path.join(folder, name), "wb").write(png)
    for name, url in page.figures.items():
        dest = os.path.join(folder, name)
        if not os.path.exists(dest):
            try:
                open(dest, "wb").write(fetch(url, binary=True))
            except OSError:
                pass                                       # a figure that will not come is left out of the page
    body = "".join(f"<h{min(4, max(2, b[1]))}>{escape(b[2])}</h{min(4, max(2, b[1]))}>" if b[0] == "h" else b[1] for b in blocks)
    body = re.sub(r'src="media/[\w-]+/', 'src="', body)
    slug = re.sub(r"[^a-z0-9]+", "-", page.title.lower()).strip("-")[:60] or "page"
    slug += "-" + hashlib.sha1((page.url + body).encode()).hexdigest()[:6]   # (two parts of one page are two files)
    open(os.path.join(folder, f"{slug}.html"), "w", encoding="utf-8").write(f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(page.title)}</title>
<link rel="stylesheet" href="../../../ui/tokens.css">
<style>body{{max-width:820px;margin:0 auto;padding:24px 18px 60px;background:var(--panel);color:var(--ink);font:16px/1.6 var(--sans)}}
img{{max-width:100%;height:auto}} table{{border-collapse:collapse;margin:12px 0}} td,th{{border:1px solid var(--rule);padding:4px 8px}}
.credit{{font-size:13px;color:var(--ink-3)}}</style></head><body>
<p class="credit">The original, as published: {escape(credit)} <a href="{escape(page.url)}">{escape(page.url)}</a></p>
<h1>{escape(page.title)}</h1>
{body}
</body></html>
""")
    return f"media/{page.src}/{slug}.html"


def run(plan, files, log=print, only=None):
    sources = plan.get("sources", {})
    for lesson_id, parts in plan.get("links", {}).items():   # a written lesson: more to read, as published
        if only and lesson_id not in only:
            continue
        path = files[lesson_id]
        les = json.load(open(path, encoding="utf-8"))
        res = [r for r in les.get("resources") or [] if not r.get("linked")]
        for spec in parts:
            src = sources[spec["src"]]
            page, blocks, _, _ = load(spec, sources)
            credit = f"{src['by']}, {page.title}. {src['licence']}. As published, from {page.url}"
            res.append({"kind": "read", "title": page.title, "url": save(page, blocks, credit), "by": src["by"], "when": "after",
                        "note": spec.get("note", "More on this, as published"), "linked": True})
        les["resources"] = res
        open(path, "w", encoding="utf-8").write(json.dumps(les, ensure_ascii=False, indent=1) + "\n")
        log(f"{lesson_id}: {len(parts)} more to read")
    for lesson_id, parts in plan.get("pages", {}).items():
        if only and lesson_id not in only:
            continue
        all_cards, goals, credits, resources, names = [], [], [], [], []
        for k, spec in enumerate(parts, 1):
            src = sources[spec["src"]]
            page, blocks, extra, aims = load(spec, sources)
            got = cards(blocks, page.title, f"{spec['src']}{k}")
            for n, c in enumerate(extra, len(got) + 1):
                c["id"] = f"{spec['src']}{k}-{n}"
            got += extra
            credit = f"{src['by']}, {page.title}. {src['licence']}. Imported as published, from {page.url}"
            local = save(page, blocks, credit)
            there = lambda m: m.group(0) if os.path.exists(os.path.join(MEDIA, m.group(1))) else ""
            for c in got:                                  # a figure that would not come is left out of the card
                for key in ("html", "q_html", "front_html", "back_html"):
                    if c.get(key):
                        c[key] = re.sub(r'<img src="media/([^"]+)"[^>]*>', there, c[key])
            # a tab in the source is indentation, not a word
            all_cards += [{key: v.replace("\t", " ") if isinstance(v, str) else v for key, v in c.items()} for c in got]
            goals += aims
            credits.append(credit)
            names.append(f"{spec['src']}: {page.title}")
            resources.append({"kind": "read", "title": f"The original: {page.title}", "url": local, "by": src["by"] + ", as published",
                              "when": "during", "note": "The part as published: this lesson's cards are its words, cut into parts"})
        subject = lesson_id.split(".")[0]
        path = files.get(lesson_id) or os.path.join(CONTENT, subject, lesson_id.split(".")[1], lesson_id.split(".")[-1] + ".json")
        old = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
        if old and not old.get("imported"):
            raise ValueError(f"{lesson_id} is written already: link the source from it instead")
        all_cards = place(all_cards, [c for c in old.get("cards", []) if c.get("added")])
        words = sum(len((c.get("body") or c.get("q") or c.get("front", "") + " " + c.get("back", "")).split()) for c in all_cards)
        lesson = {**{k: v for k, v in old.items() if k in ("title", "level", "prereq", "tags", "summary", "goals")},
                  "id": lesson_id, "imported": {"from": "pages", "sections": names},
                  "minutes": max(10, round(words / 130 + sum(c["type"] in ("flash", "mcq") for c in all_cards))),
                  "sources": credits, "resources": resources, "cards": all_cards}
        if goals:
            lesson["goals"] = goals
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w", encoding="utf-8").write(json.dumps(lesson, ensure_ascii=False, indent=1) + "\n")
        log(f"{lesson_id}: {len(all_cards)} cards from {', '.join(names)}")
