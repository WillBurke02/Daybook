"""Text out of a PDF with the standard library alone: enough to read a statement (lines of
words and figures), not a general PDF reader.

Handles Flate, ASCII85 and hex streams, object streams (PDF 1.5), fonts with a ToUnicode map (what
Chrome, Word, LibreOffice and most report writers make) and simple fonts as Windows-1252.
Words are put back into lines by where they sit on the page.
ponytail: no encryption, no LZW, no Type3 fonts; statements do not use them.
"""
import base64
import re
import zlib


class Ref(tuple):
    """An indirect reference: 12 0 R."""


class Name(str):
    """/Name, without the slash."""


_DELIM = b"()<>[]{}/%"
_WS = b" \t\r\n\f\x00"
_NUM = re.compile(rb"[+-]?(?:\d+\.?\d*|\.\d+)")
_REF = re.compile(rb"\s*(\d+)\s+R(?![A-Za-z])")


def _skip(b, i):
    while i < len(b):
        if b[i] in _WS:
            i += 1
        elif b[i] == 0x25:                       # % comment to the end of the line
            while i < len(b) and b[i] not in b"\r\n":
                i += 1
        else:
            break
    return i


def _string(b, i):
    """A (literal string) starting at b[i] == '('. Returns (bytes, next index)."""
    out, depth, i = bytearray(), 1, i + 1
    esc = {ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12}
    while i < len(b):
        c = b[i]
        if c == 0x5C:                            # backslash
            i += 1
            c = b[i]
            if c in esc:
                out.append(esc[c])
            elif 0x30 <= c <= 0x37:
                m = re.match(rb"[0-7]{1,3}", b[i:i + 3])
                out.append(int(m.group(), 8) & 255)
                i += len(m.group()) - 1
            elif c in b"\r\n":
                if c == 13 and b[i + 1:i + 2] == b"\n":
                    i += 1
            else:
                out.append(c)
        elif c == 0x28:
            depth += 1
            out.append(c)
        elif c == 0x29:
            depth -= 1
            if not depth:
                return bytes(out), i + 1
            out.append(c)
        else:
            out.append(c)
        i += 1
    return bytes(out), i


def parse(b, i=0):
    """One PDF object from bytes b at i: (value, next index). Dicts have str keys, names are Name,
    strings are bytes, references are Ref, operators (in a content stream) are ('op', word)."""
    i = _skip(b, i)
    if i >= len(b):
        return None, i
    c = b[i:i + 1]
    if b[i:i + 2] == b"<<":
        d, i = {}, i + 2
        while True:
            i = _skip(b, i)
            if b[i:i + 2] == b">>" or i >= len(b):
                return d, i + 2
            k, i = parse(b, i)
            v, i = parse(b, i)
            d[str(k)] = v
    if c == b"[":
        arr, i = [], i + 1
        while True:
            i = _skip(b, i)
            if b[i:i + 1] == b"]" or i >= len(b):
                return arr, i + 1
            v, i = parse(b, i)
            arr.append(v)
    if c == b"(":
        return _string(b, i)
    if c == b"<":
        j = b.index(b">", i)
        h = re.sub(rb"\s", b"", b[i + 1:j])
        return bytes.fromhex((h + b"0" * (len(h) % 2)).decode()), j + 1
    if c == b"/":
        j = i + 1
        while j < len(b) and b[j] not in _WS and b[j] not in _DELIM:
            j += 1
        return Name(re.sub(rb"#([0-9A-Fa-f]{2})", lambda m: bytes([int(m.group(1), 16)]), b[i + 1:j]).decode("latin-1")), j
    m = _NUM.match(b, i)
    if m:
        s = m.group()
        r = _REF.match(b, m.end()) if re.fullmatch(rb"\d+", s) else None
        if r:
            return Ref((int(s), int(r.group(1)))), r.end()
        return (float(s) if b"." in s else int(s)), m.end()
    j = i
    while j < len(b) and b[j] not in _WS and b[j] not in _DELIM:
        j += 1
    if j == i:                                   # a stray delimiter: step over it
        return ("op", c.decode("latin-1")), i + 1
    w = b[i:j].decode("latin-1")
    return {"true": True, "false": False, "null": None}.get(w, ("op", w)), j


class PDF:
    def __init__(self, data):
        self.data, self.objs, self.streams = data, {}, {}
        for m in re.finditer(rb"(?<![0-9])(\d+)\s+(\d+)\s+obj\b", data):
            n = int(m.group(1))
            try:
                v, i = parse(data, m.end())
            except (ValueError, IndexError):
                continue
            self.objs[n] = v
            j = _skip(data, i)
            if isinstance(v, dict) and data.startswith(b"stream", j):
                j += 6
                j += 2 if data[j:j + 2] == b"\r\n" else 1
                n_len = v.get("Length")
                end = j + n_len if isinstance(n_len, int) and data[j + n_len:j + n_len + 30].lstrip().startswith(b"endstream") \
                    else data.find(b"endstream", j)
                self.streams[n] = data[j:end]
        for n, v in list(self.objs.items()):     # objects packed inside object streams
            if isinstance(v, dict) and v.get("Type") == "ObjStm":
                try:
                    raw = self.stream(n)
                    head = [int(x) for x in raw[:v["First"]].split()]
                    for k in range(0, len(head), 2):
                        self.objs.setdefault(head[k], parse(raw, v["First"] + head[k + 1])[0])
                except (ValueError, IndexError, KeyError, zlib.error):
                    pass

    def get(self, v):
        seen = 0
        while isinstance(v, Ref) and seen < 20:
            v, seen = self.objs.get(v[0]), seen + 1
        return v

    def stream(self, n):
        n = n[0] if isinstance(n, Ref) else n
        raw, d = self.streams.get(n, b""), self.objs.get(n) or {}
        f = self.get(d.get("Filter"))
        for f in (f if isinstance(f, list) else [f] if f else []):
            f = self.get(f)
            if f == "FlateDecode":
                try:
                    raw = zlib.decompress(raw)
                except zlib.error:
                    raw = zlib.decompressobj().decompress(raw)     # a truncated stream: what there is
            elif f == "ASCII85Decode":
                raw = base64.a85decode(re.sub(rb"\s", b"", raw).removeprefix(b"<~").split(b"~>")[0])
            elif f == "ASCIIHexDecode":
                h = re.sub(rb"[^0-9A-Fa-f]", b"", raw.split(b">")[0])
                raw = bytes.fromhex((h + b"0" * (len(h) % 2)).decode())
            else:
                return b""                                         # a filter we cannot undo (images mostly)
        return raw

    def pages(self):
        """[(page dict, its resources)] in reading order."""
        root = self.get(self.get(self._trailer().get("Root")) or {}).get("Pages") if self._trailer() else None
        out = []

        def walk(node, res, depth=0):
            node = self.get(node)
            if not isinstance(node, dict) or depth > 50:
                return
            res = self.get(node.get("Resources")) or res
            if node.get("Type") == "Page" or "Contents" in node:
                out.append((node, res or {}))
            for k in self.get(node.get("Kids")) or []:
                walk(k, res, depth + 1)
        if root:
            walk(root, None)
        if not out:                                                # no usable trailer: every page object
            out = [(v, self.get(v.get("Resources")) or {}) for _, v in sorted(self.objs.items())
                   if isinstance(v, dict) and v.get("Type") == "Page"]
        return out

    def _trailer(self):
        if not hasattr(self, "_tr"):
            self._tr = {}
            for m in re.finditer(rb"trailer\s*<<", self.data):
                self._tr.update(parse(self.data, m.end() - 2)[0])
            for n, v in self.objs.items():                         # a cross-reference stream is the trailer
                if isinstance(v, dict) and v.get("Type") == "XRef" and "Root" in v:
                    self._tr.setdefault("Root", v["Root"])
        return self._tr


def _cmap(raw):
    """A ToUnicode map: ({code bytes: text}, code length in bytes)."""
    out, width = {}, 1
    t = raw.decode("latin-1")
    m = re.search(r"begincodespacerange\s*<([0-9A-Fa-f]+)>", t)
    if m:
        width = max(1, len(m.group(1)) // 2)
    hexs = lambda s: bytes.fromhex(s + "0" * (len(s) % 2))
    u16 = lambda s: hexs(s).decode("utf-16-be", "replace")
    for block in re.findall(r"beginbfchar(.*?)endbfchar", t, re.S):
        for a, b in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>", block):
            out[hexs(a)] = u16(b)
    for block in re.findall(r"beginbfrange(.*?)endbfrange", t, re.S):
        for a, b, dest in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f]*>)", block):
            lo, hi, n = int(a, 16), int(b, 16), len(a) // 2
            if hi - lo > 65535:
                continue
            if dest.startswith("["):
                for k, d in enumerate(re.findall(r"<([0-9A-Fa-f]*)>", dest)):
                    out[(lo + k).to_bytes(n, "big")] = u16(d)
            else:
                base = int(dest[1:-1] or "0", 16)
                dl = max(len(dest) - 2, 4) // 2
                for k in range(hi - lo + 1):
                    out[(lo + k).to_bytes(n, "big")] = (base + k).to_bytes(dl, "big").decode("utf-16-be", "replace")
    return out, width


class _Font:
    def __init__(self, pdf, d):
        d = pdf.get(d) or {}
        self.map, self.width = {}, 1
        if d.get("Subtype") == "Type0":
            self.width = 2
        tu = d.get("ToUnicode")
        if isinstance(tu, Ref):
            self.map, self.width = _cmap(pdf.stream(tu))

    def decode(self, s):
        if self.map:
            out, i = [], 0
            while i < len(s):
                for w in (self.width, 1, 2, 3, 4):
                    ch = self.map.get(s[i:i + w])
                    if ch is not None:
                        out.append(ch)
                        i += w
                        break
                else:
                    i += self.width
            return "".join(out)
        if self.width == 2:
            return ""                                              # glyph ids with no map: unreadable
        return s.decode("cp1252", "replace")


def _mul(a, b):
    return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2],
            a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]


def _runs(pdf, content, res, fonts):
    """(y, x, size, text) for every piece of text a content stream shows."""
    fdict = pdf.get(res.get("Font")) or {}
    out, stack, ops = [], [], []
    ctm, saved = [1, 0, 0, 1, 0, 0], []
    tm = lm = [1, 0, 0, 1, 0, 0]
    font, size, lead = None, 10, 0
    i, n = 0, len(content)

    def show(s):
        if font is None or not isinstance(s, bytes):
            return
        t = font.decode(s)
        if t:
            m = _mul(tm, ctm)
            out.append((m[5], m[4], abs(size * (m[3] or m[0])) or 10, t))

    while i < n:
        try:
            v, i = parse(content, i)
        except (ValueError, IndexError):
            i += 1
            continue
        if not (isinstance(v, tuple) and not isinstance(v, Ref) and len(v) == 2 and v[0] == "op"):
            ops.append(v)
            continue
        op = v[1]
        a = ops
        ops = []
        if op == "BI":                                             # an inline image: skip to its end
            j = content.find(b"EI", i)
            i = n if j < 0 else j + 2
        elif op == "q":
            saved.append(ctm)
        elif op == "Q":
            ctm = saved.pop() if saved else ctm
        elif op == "cm" and len(a) >= 6:
            ctm = _mul([float(x) for x in a[-6:]], ctm)
        elif op == "BT":
            tm = lm = [1, 0, 0, 1, 0, 0]
        elif op == "Tf" and len(a) >= 2:
            key = str(a[-2])
            if key not in fonts:
                fonts[key] = _Font(pdf, fdict.get(key))
            font, size = fonts[key], float(a[-1]) if isinstance(a[-1], (int, float)) else 10
        elif op == "TL" and a:
            lead = float(a[-1])
        elif op in ("Td", "TD") and len(a) >= 2:
            if op == "TD":
                lead = -float(a[-1])
            tm = lm = _mul([1, 0, 0, 1, float(a[-2]), float(a[-1])], lm)
        elif op == "Tm" and len(a) >= 6:
            tm = lm = [float(x) for x in a[-6:]]
        elif op == "T*":
            tm = lm = _mul([1, 0, 0, 1, 0, -lead], lm)
        elif op == "Tj" and a:
            show(a[-1])
        elif op in ("'", '"') and a:
            tm = lm = _mul([1, 0, 0, 1, 0, -lead], lm)
            show(a[-1])
        elif op == "TJ" and a and isinstance(a[-1], list):
            parts, x = [], 0.0
            for p in a[-1]:
                if isinstance(p, bytes):
                    parts.append(font.decode(p) if font else "")
                elif isinstance(p, (int, float)) and p < -250:
                    parts.append(" ")                              # a wide gap in a TJ array is a space
            if font and "".join(parts).strip():
                m = _mul(tm, ctm)
                out.append((m[5], m[4], abs(size * (m[3] or m[0])) or 10, "".join(parts)))
        elif op == "Do" and a:                                     # a form XObject: its text too
            xo = pdf.get((pdf.get(res.get("XObject")) or {}).get(str(a[-1])))
            if isinstance(xo, dict) and xo.get("Subtype") == "Form" and len(saved) < 20:
                ref = (pdf.get(res.get("XObject")) or {}).get(str(a[-1]))
                sub = pdf.get(xo.get("Resources")) or res
                m = xo.get("Matrix") or [1, 0, 0, 1, 0, 0]
                inner = _runs(pdf, pdf.stream(ref), sub, {})
                out.extend((y * m[3] + ctm[5], x * m[0] + ctm[4], s, t) for y, x, s, t in inner)
    return out


def _lines(runs):
    """Runs to lines: top to bottom, left to right, a wide gap kept as two spaces."""
    runs = sorted(runs, key=lambda r: (-round(r[0], 0), r[1]))
    lines, cur, cy = [], [], None
    for y, x, s, t in runs:
        if cy is None or abs(y - cy) > max(2.0, s * 0.4):
            if cur:
                lines.append(cur)
            cur, cy = [], y
        cur.append((x, s, t))
    if cur:
        lines.append(cur)
    out = []
    for ln in lines:
        ln.sort()
        text, end = "", None
        for x, s, t in ln:
            if end is not None:
                gap = x - end
                text += "  " if gap > s * 1.2 else " " if gap > s * 0.25 and not text.endswith(" ") and not t.startswith(" ") else ""
            text += t
            end = x + len(t) * s * 0.5                             # ponytail: a guessed width (half an em a letter)
        out.append(re.sub(r"[ \t]+$", "", text))
    return out


def text(data):
    """All the text in a PDF (bytes), a line per line on the page, pages apart by a blank line.
    Raises ValueError if it is not a PDF or holds no readable text."""
    if not data.lstrip()[:5] == b"%PDF-":
        raise ValueError("that is not a PDF")
    if re.search(rb"/Encrypt\s", data):
        raise ValueError("the PDF is encrypted: save or print it as a new PDF, then try that")
    pdf = PDF(data)
    pages = []
    for page, res in pdf.pages():
        cont = pdf.get(page.get("Contents"))
        refs = cont if isinstance(cont, list) else [page.get("Contents")]
        content = b"\n".join(pdf.stream(r) for r in refs if isinstance(r, Ref))
        pages.append("\n".join(_lines(_runs(pdf, content, res, {}))))
    out = "\n\n".join(p for p in pages if p.strip())
    if not out.strip():
        raise ValueError("no text in this PDF (a scan is a picture: it needs typing in)")
    return out
