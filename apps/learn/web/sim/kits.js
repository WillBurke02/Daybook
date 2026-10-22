// Kits: whole pieces of plant for a scene's 3D view, so a new machine is a few lines, not a few hundred.
// A part with "kit" is replaced by a group of plain parts (view.js draws them); everything else on it
// (id, at, rot, move, turn, show, label…) stays on the group, and press or toggle is passed to each piece.
//
//   {"kit": "motor", "at": [0, 0.2, 0], "d": 0.2, "len": 0.3, "turns": "m.turns", "lit": "m.on"}   along +x, shaft out at +x
//   {"kit": "pump", "d": 0.24, "turns": "m.turns"}            volute on the x axis, suction at −x, discharge up (+y)
//   {"kit": "pipe", "path": [[0,0,0], [1,0,0], [1,1,0]], "d": 0.06, "full": "pp.Q > 0.5"}   straight runs and elbows
//   {"kit": "valve", "d": 0.08, "open": "dv / 100", "axis": "x", "handle": "wheel" | "lever"}
//   {"kit": "gauge", "value": "pp.Pd", "max": 6, "d": 0.1}    a dial facing +z, its needle swept 270°
//   {"kit": "panel", "size": [0.5, 0.6, 0.2], "items": [{"press": "start", "color": "green"}, {"lit": "run", "color": "green"}]}
//   {"kit": "contactor", "lit": "k1_in"}                      on a DIN rail; the window lights while it is pulled in
//   {"kit": "cylinder", "bore": 0.05, "stroke": 0.2, "pos": "a.pos", "reeds": [{"at": 0, "lit": "a.ret"}]}   along +x
//   {"kit": "table", "size": [1.2, 0.8, 0.6]}                 a frame with a top, its top at y = height
// ponytail: pipes run along x, y or z only; a slanted run would need a turn worked out from its direction.

const r3 = v => v.map(x => Math.round(x * 1e4) / 1e4);

const KITS = {
  motor({ d = 0.2, len = 0.3, turns = null, slow = 25, lit = null, color = 'motor' }) {
    const ax = [0, 0, 90], h = len / 2;
    return [
      { shape: 'cyl', size: [d, len, d], rot: ax, color },
      { shape: 'cyl', size: [d * 1.08, 0.012, d * 1.08], at: [-h + len / 6, 0, 0], rot: ax, color, repeat: { n: 5, step: [len / 6, 0, 0] } },
      { shape: 'cyl', size: [d * 0.96, 0.07, d * 0.96], at: [-h - 0.035, 0, 0], rot: ax, color: 'dark' },
      { shape: 'cyl', size: [d * 0.9, 0.02, d * 0.9], at: [h + 0.01, 0, 0], rot: ax, color },
      { shape: 'box', size: [d * 0.45, d * 0.3, d * 0.45], at: [0, d / 2 + d * 0.12, 0], color },
      lit ? { shape: 'sphere', size: [d * 0.14, d * 0.14, d * 0.14], at: [0, d / 2 + d * 0.3, 0], color: 'green', lit } : null,
      { shape: 'box', size: [len * 0.8, 0.03, d * 0.9], at: [0, -d / 2 - 0.015, 0], color },
      { shape: 'cyl', size: [d * 0.18, 0.1, d * 0.18], at: [h + 0.07, 0, 0], rot: ax, color: 'steel',
        turn: turns ? { x: `(${turns}) * 360 / ${slow}` } : undefined,
        parts: [{ shape: 'box', size: [d * 0.06, 0.06, d * 0.21], color: 'yellow' }] },
    ];
  },

  pump({ d = 0.24, turns = null, slow = 25, color = 'red' }) {
    const ax = [0, 0, 90];
    return [
      { shape: 'cyl', size: [d, d * 0.42, d], rot: ax, color },
      { shape: 'cyl', size: [d * 0.38, d * 0.5, d * 0.38], at: [-d * 0.45, 0, 0], rot: ax, color },
      { shape: 'cyl', size: [d * 0.52, 0.025, d * 0.52], at: [-d * 0.7, 0, 0], rot: ax, color: 'dark' },
      { shape: 'cyl', size: [d * 0.32, d * 0.45, d * 0.32], at: [0, d * 0.55, 0], color },
      { shape: 'cyl', size: [d * 0.46, 0.025, d * 0.46], at: [0, d * 0.78, 0], color: 'dark' },
      { shape: 'cyl', size: [d * 0.35, d * 0.7, d * 0.35], at: [d * 0.5, 0, 0], rot: ax, color },
      { shape: 'box', size: [d * 0.5, d * 0.45, d * 0.6], at: [d * 0.45, -d * 0.35, 0], color },
      { shape: 'cyl', size: [d * 0.3, d * 0.22, d * 0.3], at: [d * 0.95, 0, 0], rot: ax, color: 'dark',
        turn: turns ? { x: `(${turns}) * 360 / ${slow}` } : undefined,
        parts: [{ shape: 'box', size: [d * 0.06, d * 0.23, d * 0.31], color: 'yellow' }] },
    ];
  },

  pipe({ path = [], d = 0.06, color = 'steel', full = null }) {
    const out = [];
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k], diff = b.map((v, j) => v - a[j]);
      const axes = diff.map(Math.abs).map(v => v > 1e-9);
      if (axes.filter(Boolean).length !== 1) throw new Error(`a pipe runs along x, y or z: ${JSON.stringify(a)} to ${JSON.stringify(b)} does not`);
      const ax = axes.indexOf(true), len = Math.abs(diff[ax]), mid = r3(a.map((v, j) => (v + b[j]) / 2));
      const rot = ax === 0 ? [0, 0, 90] : ax === 2 ? [90, 0, 0] : undefined;
      out.push({ shape: 'cyl', size: [d, len, d], at: mid, rot, color });
      if (full) out.push({ shape: 'cyl', size: [d * 1.02, len * 0.98, d * 1.02], at: mid, rot, color: 'water', alpha: 0.35, show: full, shadow: false });
      if (k > 1) out.push({ shape: 'sphere', size: [d * 1.25, d * 1.25, d * 1.25], at: r3(a), color });
    }
    return out;
  },

  valve({ d = 0.08, open = '1', axis = 'x', handle = 'wheel', color = 'steel', top = 'blue' }) {
    const rot = axis === 'z' ? [90, 0, 0] : [0, 0, 90], at = axis === 'z' ? [0, 0, 1] : [1, 0, 0];
    const f = s => r3(at.map(v => v * s));
    return [
      { shape: 'sphere', size: [d * 1.9, d * 1.9, d * 1.9], color },
      { shape: 'cyl', size: [d * 1.9, d * 0.3, d * 1.9], at: f(-d * 1.05), rot, color },
      { shape: 'cyl', size: [d * 1.9, d * 0.3, d * 1.9], at: f(d * 1.05), rot, color },
      { shape: 'cyl', size: [d * 0.7, d * 1.2, d * 0.7], at: [0, d * 1.3, 0], color },
      handle === 'lever'
        ? { shape: 'box', size: [d * 2.6, d * 0.18, d * 0.3], at: [0, d * 2.0, 0], color: top, turn: { y: `(1 - (${open})) * 90` } }
        : { at: [0, d * 2.1, 0], move: { y: `${d * 0.6} * (${open})` }, parts: [
            { shape: 'cyl', size: [d * 0.2, d * 0.9, d * 0.2], at: [0, -d * 0.3, 0], color: 'steel' },
            { shape: 'cyl', size: [d * 2.2, d * 0.18, d * 2.2], color: top, turn: { y: `(${open}) * 720` },
              parts: [{ shape: 'box', size: [d * 2.1, d * 0.2, d * 0.18], color: top }, { shape: 'box', size: [d * 0.18, d * 0.2, d * 2.1], color: top }] }] },
    ];
  },

  gauge({ value = '0', max = 10, min = 0, d = 0.1, color = 'dark' }) {
    const sweep = `135 - 270 * MAX(0, MIN(1, ((${value}) - ${min}) / ${max - min}))`;
    return [
      { shape: 'cyl', size: [d * 0.18, d * 0.5, d * 0.18], at: [0, -d * 0.6, 0], color: 'brass' },
      { shape: 'cyl', size: [d, d * 0.25, d], rot: [90, 0, 0], color },
      { shape: 'cyl', size: [d * 0.86, d * 0.02, d * 0.86], at: [0, 0, d * 0.13], rot: [90, 0, 0], color: 'white' },
      { at: [0, 0, d * 0.15], turn: { z: sweep }, parts: [{ shape: 'box', size: [d * 0.04, d * 0.4, d * 0.015], at: [0, d * 0.18, 0], color: 'red' }] },
    ];
  },

  panel({ size = [0.5, 0.6, 0.2], items = [], cols = 4, color = 'grey', legs = 0 }) {
    const [w, h, dp] = size, out = [{ shape: 'box', size, color }];
    if (legs) for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) out.push({ shape: 'box', size: [0.05, legs, 0.05], at: r3([x, -h / 2 - legs / 2, 0]), color });
    const rows = Math.ceil(items.length / cols), gx = w / (cols + 1), gy = Math.min(0.12, h / (rows + 1));
    items.forEach((it, k) => {
      const at = r3([-w / 2 + gx * (k % cols + 1), h / 2 - gy * (Math.floor(k / cols) + 1), dp / 2 + 0.01]);
      const s = Math.min(0.06, gx * 0.6);
      if (it.press || it.toggle) out.push({ shape: 'cyl', size: [s, 0.03, s], at, rot: [90, 0, 0], color: it.color || 'black', press: it.press, toggle: it.toggle, lit: it.lit });
      else out.push({ shape: 'sphere', size: [s * 0.85, s * 0.85, s * 0.85], at, color: it.color || 'green', lit: it.lit });
    });
    return out;
  },

  contactor({ lit = '0', color = 'grey' }) {
    return [
      { shape: 'box', size: [0.05, 0.085, 0.075], color },
      { shape: 'box', size: [0.03, 0.02, 0.004], at: [0, 0.015, 0.039], color: 'orange', lit },
      { shape: 'box', size: [0.046, 0.012, 0.01], at: [0, 0.037, 0.035], color: 'dark' },
      { shape: 'box', size: [0.046, 0.012, 0.01], at: [0, -0.037, 0.035], color: 'dark' },
    ];
  },

  cylinder({ bore = 0.05, stroke = 0.2, pos = '0', reeds = [], color = 'steel' }) {
    const ax = [0, 0, 90], L = stroke + bore * 1.2;
    return [
      { shape: 'cyl', size: [bore, L, bore], at: [L / 2, 0, 0], rot: ax, color },
      { shape: 'box', size: [bore * 0.35, bore * 1.25, bore * 1.25], at: [0, 0, 0], color: 'dark' },
      { shape: 'box', size: [bore * 0.35, bore * 1.25, bore * 1.25], at: [L, 0, 0], color: 'dark' },
      { at: [L, 0, 0], move: { x: `${pos}` }, parts: [
        { shape: 'cyl', size: [bore * 0.4, stroke, bore * 0.4], at: [-stroke / 2 + 0.01, 0, 0], rot: ax, color: 'white' },
        { shape: 'box', size: [bore * 0.5, bore * 0.8, bore * 0.8], at: [bore * 0.25, 0, 0], color: 'dark' }] },
      ...reeds.map(r => ({ shape: 'box', size: [bore * 0.4, bore * 0.2, bore * 0.25], at: r3([bore * 0.6 + r.at, bore * 0.55, 0]), color: 'red', lit: r.lit })),
    ];
  },

  table({ size = [1.2, 0.8, 0.6], color = 'frame', top = 'dark' }) {
    const [w, h, dp] = size, out = [{ shape: 'box', size: [w, 0.04, dp], at: [0, h - 0.02, 0], color: top }];
    for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) for (const z of [-dp / 2 + 0.03, dp / 2 - 0.03])
      out.push({ shape: 'box', size: [0.05, h - 0.04, 0.05], at: r3([x, (h - 0.04) / 2, z]), color });
    return out;
  },
};

// each kit's own settings: taken off the group and handed to the kit
const OWN = { motor: ['d', 'len', 'turns', 'slow', 'lit', 'color'], pump: ['d', 'turns', 'slow', 'color'], pipe: ['path', 'd', 'color', 'full'],
  valve: ['d', 'open', 'axis', 'handle', 'color', 'top'], gauge: ['value', 'max', 'min', 'd', 'color'],
  panel: ['size', 'items', 'cols', 'color', 'legs'], contactor: ['lit', 'color'], cylinder: ['bore', 'stroke', 'pos', 'reeds', 'color'],
  table: ['size', 'color', 'top'] };
const done = new WeakMap();

/** The parts with every kit replaced by its pieces (worked out once for each list). */
export function expand(parts) {
  if (!parts) return parts;
  if (done.has(parts)) return done.get(parts);
  const out = parts.map(p => {
    if (!p.kit) return p.parts ? { ...p, parts: expand(p.parts) } : p;
    const make = KITS[p.kit];
    if (!make) throw new Error(`there is no kit called ${p.kit} (there are ${Object.keys(KITS).join(', ')})`);
    const group = { ...p }, opts = {};
    delete group.kit;
    for (const k of OWN[p.kit]) if (k in p) { opts[k] = p[k]; delete group[k]; }
    const pass = Object.fromEntries(['press', 'toggle'].filter(k => p[k]).map(k => [k, p[k]]));
    const pieces = make(opts).filter(Boolean).map(q => ({ ...q, ...pass }));
    return { ...group, parts: [...pieces, ...expand(p.parts || [])] };
  });
  done.set(parts, out);
  return out;
}
