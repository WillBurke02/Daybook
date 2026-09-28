// Colour maths for the theme randomiser. No page needed, so it can be checked
// on its own: node tests/formula.check.mjs.
//
// A random theme starts from one hue for the page and picks the accent by a
// colour-wheel rule (opposite, a third round, split, or next door). Every colour
// that is read or seen against the panels is then pushed lighter or darker until
// it passes a contrast ratio: text 7:1, quieter text and money 4.5:1, chart
// colours 3:1. So a chart line can never vanish into the background.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** HSL (degrees, %, %) to '#rrggbb'. */
export function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

/** WCAG relative luminance and contrast ratio. */
export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** The colour at hue h and saturation s, moved away from `bg` until it reaches `ratio`. */
export function fit(h, s, l, bg, ratio, dark) {
  let c = hsl(h, s, l);
  for (let i = 0; i < 101 && contrast(c, bg) < ratio; i++) c = hsl(h, s, l = clamp(l + (dark ? 1 : -1), 0, 100));
  return c;
}

const RULES = { opposite: 180, third: 120, split: 150, 'next door': 35 };

/** A whole theme's colours. rand is Math.random, or anything like it (the check passes a seeded one). */
export function randomTheme(rand = Math.random, dark = rand() < 0.5) {
  const pick = a => a[Math.floor(rand() * a.length)];
  const jig = n => (rand() - 0.5) * 2 * n;
  const H = rand() * 360, rule = pick(Object.keys(RULES)), A = H + RULES[rule];
  const tint = 5 + rand() * 12;                               // how far the greys lean to the page's hue
  const L = dark ? { ground: 7 + jig(2), panel: 11 + jig(2), panel2: 17, raised: 14 }
                 : { ground: 91 + jig(2), panel: 97 + jig(1.5), panel2: 88, raised: 99.5 };
  const panel = hsl(H, tint, L.panel), ground = hsl(H, tint, L.ground);
  const accent = fit(A, 55 + rand() * 30, dark ? 62 : 40, panel, 4.5, dark);
  const onAccent = ['#ffffff', hsl(A, 30, 8)].sort((x, y) => contrast(y, accent) - contrast(x, accent))[0];
  const leaveH = Math.abs(((A - 275 + 540) % 360) - 180) < 45 ? 325 : 275;   // days off: purple, unless the accent is
  const step = 360 / 6, start = A + jig(10);
  const v = {
    '--ground': ground, '--panel': panel, '--panel-2': hsl(H, tint, L.panel2), '--raised': hsl(H, tint * 0.6, L.raised),
    '--ink': fit(H, 14, dark ? 92 : 12, panel, 10, dark),
    '--ink-2': fit(H, 10, dark ? 72 : 34, panel, 5.5, dark),
    '--ink-3': fit(H, 8, dark ? 58 : 48, panel, 3.3, dark),
    '--rule': hsl(H, tint, dark ? L.panel + 13 : L.panel - 16),
    '--rule-soft': hsl(H, tint, dark ? L.panel + 7 : L.panel - 9),
    '--accent': accent, '--accent-soft': hsl(A, 40, dark ? 20 : 89), '--accent-ink': onAccent,
    '--debit': fit(4, 72, dark ? 66 : 42, panel, 4.5, dark),
    '--credit': fit(142, 55, dark ? 60 : 30, panel, 4.5, dark),
    '--flag': fit(42, 85, dark ? 58 : 34, panel, 4.5, dark),
    '--leave': fit(leaveH, 50, dark ? 70 : 48, panel, 3, dark), '--leave-soft': hsl(leaveH, 45, dark ? 22 : 91),
    '--bh-soft': hsl(45, 70, dark ? 20 : 85),
    '--th-bg': panel, '--th-ink': null, '--row-line': null,
  };
  // six chart colours spread round the wheel from the accent, each clear of the panel
  const hardest = dark ? panel : ground;                      // the background nearest a chart colour's lightness
  for (let i = 0; i < 6; i++) v[`--s${i + 1}`] = fit(start + i * step, 58 + jig(8), dark ? 60 : 46, hardest, 3, dark);
  // the calendar and heatmaps: one hue, faint to strong
  (dark ? [19, 29, 39, 51, 64] : [88, 74, 60, 46, 33]).forEach((l, i) => { v[`--seq-${i + 1}`] = hsl(A, 30 + i * 10, l); });
  v['--th-ink'] = v['--ink-3']; v['--row-line'] = v['--rule-soft'];
  return { scheme: dark ? 'dark' : 'light', rule, vars: v };
}
