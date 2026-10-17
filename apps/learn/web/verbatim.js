// Text brought in as published (an open textbook's section, word for word: SPEC.md §1), shown as
// its author laid it out: paragraphs, lists, tables, figures and the book's own maths (MathML,
// which browsers draw natively). It arrives as HTML from the import, so it is rebuilt here from a
// short list of elements and attributes; anything else (a script, a handler, a style) is dropped.
const HTML = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'sub', 'sup', 'small', 'code', 'ul', 'ol', 'li', 'table', 'caption',
                      'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'img', 'div', 'span', 'h2', 'h3', 'h4', 'h5', 'blockquote', 'a',
                      'pre', 'dl', 'dt', 'dd']);
const MATH = new Set(['math', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'mspace', 'msub', 'msup', 'msubsup', 'mfrac', 'msqrt', 'mroot',
                      'mfenced', 'mtable', 'mtr', 'mtd', 'munder', 'mover', 'munderover', 'mstyle', 'mpadded', 'mphantom', 'menclose',
                      'semantics', 'mlabeledtr', 'mmultiscripts', 'mprescripts', 'none']);
const KEEP = { td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], img: ['src', 'alt'], a: ['href'], div: ['class'] };
const MATH_ATTRS = new Set(['display', 'mathvariant', 'stretchy', 'fence', 'separator', 'separators', 'open', 'close', 'linethickness',
  'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'lspace', 'rspace', 'width', 'height', 'depth', 'accent', 'accentunder',
  'largeop', 'movablelimits', 'form', 'notation', 'scriptlevel', 'displaystyle', 'columnlines', 'rowlines', 'frame']);
const MATHNS = 'http://www.w3.org/1998/Math/MathML';
import { tex } from './ui/math.js';

function copy(node, into) {
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { into.append(n.data); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.localName, math = n.namespaceURI === MATHNS;
    if (tag === 'script' || tag === 'style') continue;
    if (!(math ? MATH : HTML).has(tag)) { copy(n, into); continue; }          // an unknown element: its words only
    const out = math ? document.createElementNS(MATHNS, tag) : document.createElement(tag);
    for (const a of n.attributes) {
      const ok = math ? MATH_ATTRS.has(a.name) : (KEEP[tag] || []).includes(a.name);
      if (!ok) continue;
      if (a.name === 'src' && !/^media\/(?!.*\.\.)[\w./-]+$/.test(a.value)) continue;   // figures from Daybook's own folder only
      if (a.name === 'href' && !/^https?:\/\//.test(a.value)) continue;
      out.setAttribute(a.name, a.value);
    }
    if (tag === 'a') { out.target = '_blank'; out.rel = 'noopener noreferrer'; }
    if (tag === 'img') { out.loading = 'lazy'; if (!out.getAttribute('src')) continue; }
    copy(n, out);
    into.append(out);
  }
}

/** A div with the published text in it, rebuilt from safe parts. */
export function verbatim(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const box = document.createElement('div');
  box.className = 'rich verbatim';
  copy(doc.body, box);
  typeset(box);
  return box;
}

/** Maths a source wrote as TeX, \( inline \) and \[ displayed \], set as maths (the words stay as they were). */
function typeset(box) {
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT), found = [];
  while (walker.nextNode()) if (/\\[([]/.test(walker.currentNode.data) && !walker.currentNode.parentElement.closest('pre, code')) found.push(walker.currentNode);
  for (const node of found) {
    const parts = node.data.split(/(\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/);
    if (parts.length < 2) continue;
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      const m = part.match(/^\\([([])([\s\S]+)\\[)\]]$/);
      if (!m) { frag.append(part); continue; }
      const math = new DOMParser().parseFromString(tex(m[2], m[1] === '['), 'text/html').body.firstChild;
      frag.append(math ? document.importNode(math, true) : part);
    }
    node.replaceWith(frag);
  }
}
