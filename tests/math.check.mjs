// node tests/math.check.mjs — TeX to MathML, for card text, notes and Log entries.
import assert from 'node:assert/strict';
import { tex, split } from '../web/ui/math.js';

const has = (src, ...parts) => { const m = tex(src); for (const p of parts) assert.ok(m.includes(p), `${src}\n  -> ${m}\n  missing ${p}`); return m; };

has('d = \\tfrac{vt}{2}', '<mi>d</mi><mo>=</mo>', '<mstyle displaystyle="false"><mfrac><mrow><mi>v</mi><mi>t</mi></mrow><mn>2</mn></mfrac></mstyle>');
has('x^2 + y_1', '<msup><mi>x</mi><mn>2</mn></msup>', '<msub><mi>y</mi><mn>1</mn></msub>');
has('x_1^{n+1}', '<msubsup><mi>x</mi><mn>1</mn><mrow><mi>n</mi><mo>+</mo><mn>1</mn></mrow></msubsup>');
has('\\sqrt{b^2 - 4ac}', '<msqrt>', '<mo>−</mo>');
has('\\sqrt[3]{8} = 2', '<mroot><mn>8</mn><mn>3</mn></mroot>');
has('\\alpha + \\Omega', '<mi>α</mi>', '<mi mathvariant="normal">Ω</mi>');
has('\\int_0^1 x\\,dx', '<msubsup><mo largeop="true">∫</mo><mn>0</mn><mn>1</mn></msubsup>', '<mspace width="0.167em"/>');
has('\\sum_{r=1}^{n} r', '<munderover><mo largeop="true" movablelimits="true">∑</mo>');
has('\\lim_{x \\to 0} \\frac{\\sin x}{x}', '<munder><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder>', '<mi>sin</mi>');
has('\\vec{F} = m\\vec{a}', '<mover accent="true"><mi>F</mi><mo stretchy="false">→</mo></mover>');
has('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}', '<mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr><mtr><mtd><mn>3</mn>', '<mo fence="true" stretchy="true">(</mo>');
has('\\begin{bmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{bmatrix}', '<mo fence="true" stretchy="true">[</mo>', '<mtd><mi>i</mi></mtd></mtr></mtable>');
has('v = 5920\\,\\mathrm{m\\,s^{-1}}', '<mn>5920</mn>', '<mi mathvariant="normal">m</mi>', '<msup><mi mathvariant="normal">s</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup>');
has('\\operatorname{rms}(V)', '<mi>rms</mi>');
has('\\left( \\frac{a}{b} \\right)^2', '<mo fence="true" stretchy="true">(</mo>', '<mo fence="true" stretchy="true">)</mo>');
has('20\\log_{10}\\left(\\frac{A_1}{A_2}\\right)\\text{ dB}', '<msub><mi>log</mi><mn>10</mn></msub>', '<mtext> dB</mtext>');
has('f\'(x) = 3x^2', '<mo>′</mo>');
has('a \\le b \\ne c \\approx d \\pm e \\times f', '≤', '≠', '≈', '±', '×');
has('\\Delta V = I R', '<mi mathvariant="normal">Δ</mi>');
has('90^\\circ', '<msup><mn>90</mn><mo>∘</mo></msup>');
has('\\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}', '<mtable columnalign="left">');
has('3.14 \\cdot r', '<mn>3.14</mn><mo>·</mo>');
// never raw HTML: what is typed is escaped
has('a < b', '<mo>&lt;</mo>');
has('\\text{<script>}', '<mtext>&lt;script&gt;</mtext>');
assert.ok(!tex('\\text{<img onerror=x>}').includes('<img'));
// an unknown command shows, rather than vanishing or breaking the rest
has('x + \\nope y', '<merror><mtext>\\nope</mtext></merror>', '<mi>y</mi>');
assert.ok(tex('\\frac{1}{').startsWith('<math>'), 'half-typed input still gives maths');
assert.ok(tex('x', true).startsWith('<math display="block">'));

// the $…$ and $$…$$ in a card's text
assert.deepEqual(split('Pulse-echo: $d = vt/2$, so'), [{ text: 'Pulse-echo: ' }, { math: 'd = vt/2', display: false }, { text: ', so' }]);
assert.deepEqual(split('$$E = mc^2$$'), [{ math: 'E = mc^2', display: true }]);
assert.deepEqual(split('It costs \\$5, and $x$'), [{ text: 'It costs $5, and ' }, { math: 'x', display: false }]);
assert.deepEqual(split('no maths here'), [{ text: 'no maths here' }]);
console.log('ok — maths notation');
