// The machine in 3D: plain WebGL, no library. Boxes, cylinders, cones and spheres, lit from above,
// each one placed, turned, coloured or shown by formulas over the machine's values.
//
// scene.view = { camera: {target: [x, y, z], yaw: 30, pitch: 25, dist: 4}, floor: 6 (metres; 0 for none), shadows: true, parts: [part, …] }
// part = { id, shape: 'box' | 'cyl' | 'cone' | 'sphere' (none: a group),
//          size: [x, y, z] metres (a cyl or cone stands along y: [diameter, length, diameter]),
//          at: [x, y, z], rot: [x, y, z] degrees (turned about x, then y, then z),
//          color: 'steel' | '#c0ffee' | ['box', 'red'] with shade: formula (which of the list),
//          lit: formula (glows while true; dull while false, like a lamp's lens), alpha: 0.3 (see-through),
//          show: formula, move: {x, y, z: formula} metres, turn: {x, y, z: formula} degrees, scale: {x, y, z: formula},
//          repeat: {n, step: [x, y, z], wrap: metres, shift: formula} (belt cleats, chain links: n copies along step,
//                  moved on by shift and wrapped round within wrap),
//          each: formula giving a list, a conveyor's items: one copy each, with item.x, item.k… in its formulas,
//          label: 'M1 {m1.n:0} rpm', label_at: [x, y, z] (from the part's centre, along the world's axes),
//          press: input (held while the pointer is down on it), toggle: input (flips on a click), shadow: false,
//          parts: [children: placed in this part's frame, not stretched by its size] }
// ponytail: shadows fall on the floor only; no textures or collisions; see-through parts are drawn last, farthest first.
import { formula } from './engine.js';
import { fill } from '../template.js';

export const COLORS = {
  steel: '#a3acb5', dark: '#3b4148', frame: '#58738f', belt: '#2b2e33', rubber: '#1d1f22', black: '#16181b',
  grey: '#8a9199', white: '#eef0f2', green: '#2fa35a', red: '#d6402f', amber: '#f2a900', yellow: '#f0c419',
  blue: '#2f6fd6', orange: '#e8772e', copper: '#b87333', brass: '#c9a227', water: '#3d8fd8', glass: '#cfe6ff',
  box: '#c79c6e', wood: '#a47148', guard: '#f2c200', cable: '#25282c', motor: '#3f6e9a',
};
const rgb = c => {
  const h = (COLORS[c] || c || '#888888').replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
};

// ---- the shapes, each one unit across, centred on the origin ----------------------------------------

function box() {
  const P = [], N = [], I = [];
  const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  for (const [ax, sg] of faces) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3, b = P.length / 3;
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 0, 0]; p[ax] = sg * 0.5; p[u] = a * 0.5; p[v] = c * 0.5 * sg;
      const n = [0, 0, 0]; n[ax] = sg;
      P.push(...p); N.push(...n);
    }
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { P, N, I };
}

function lathe(rings) {   // rings: [[radius, y, normal radial part, normal y part]] round the y axis
  const P = [], N = [], I = [], seg = 28;
  for (const [r, y, nr, ny] of rings) for (let k = 0; k <= seg; k++) {
    const a = k / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    P.push(r * c, y, r * s); N.push(nr * c, ny, nr * s);
  }
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < seg; k++) {
    const a = j * (seg + 1) + k, b = a + seg + 1;
    I.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { P, N, I };
}
const merge = (...ms) => {
  const out = { P: [], N: [], I: [] };
  for (const m of ms) { const b = out.P.length / 3; out.P.push(...m.P); out.N.push(...m.N); out.I.push(...m.I.map(i => i + b)); }
  return out;
};
const cap = (y, up) => lathe([[0, y, 0, up], [0.5, y, 0, up]]);
const SHAPES = {
  box,
  cyl: () => merge(lathe([[0.5, -0.5, 1, 0], [0.5, 0.5, 1, 0]]), cap(0.5, 1), cap(-0.5, -1)),
  cone: () => { const k = 1 / Math.sqrt(1.25); return merge(lathe([[0.5, -0.5, k, 0.5 * k], [0, 0.5, k, 0.5 * k]]), cap(-0.5, -1)); },
  sphere: () => lathe(Array.from({ length: 13 }, (_, j) => { const a = -Math.PI / 2 + j / 12 * Math.PI; return [0.5 * Math.cos(a), 0.5 * Math.sin(a), Math.cos(a), Math.sin(a)]; })),
};

// ---- 4×4 matrices, column by column -------------------------------------------------------------------

const mul = (a, b) => {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
};
const I4 = () => { const o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; };
/** Move to t, then turn by r (degrees about x, then y, then z). */
function frame(t, r) {
  const [a, b, g] = r.map(d => d * Math.PI / 180), ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  return new Float32Array([cb * cg, cb * sg, -sb, 0, sa * sb * cg - ca * sg, sa * sb * sg + ca * cg, sa * cb, 0,
    ca * sb * cg + sa * sg, ca * sb * sg - sa * cg, ca * cb, 0, t[0], t[1], t[2], 1]);
}
const scaled = (F, s) => { const o = Float32Array.from(F); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 4 + r] *= s[c]; return o; };
const normals = (F, s) => { const o = new Float32Array(9); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = F[c * 4 + r] / s[c]; return o; };
function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1; o[14] = 2 * far * near / (near - far);
  return o;
}
const sub = (a, b) => a.map((x, i) => x - b[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
function lookAt(eye, at) {
  const z = unit(sub(eye, at)), x = unit(cross([0, 1, 0], z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
/** The inverse of a 4×4 (for turning a pointer's ray into a part's own space). */
function invert(m) {
  const o = new Float32Array(16), [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  const d = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
  return o;
}
const apply = (m, p, w = 1) => [0, 1, 2, 3].map(r => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * w);

// ---- the parts' formulas, compiled once ----------------------------------------------------------------

function prepare(parts, known) {
  const item = n => known.has(n) || /^item\.\w+$/.test(n);
  const f = src => src == null ? null : formula(src, item);
  for (const p of parts || []) {
    p._f = {
      show: f(p.show), lit: f(p.lit), shade: f(p.shade), each: f(p.each), shift: f(p.repeat?.shift),
      move: Object.entries(p.move || {}).map(([a, s]) => ['xyz'.indexOf(a), f(s)]),
      turn: Object.entries(p.turn || {}).map(([a, s]) => ['xyz'.indexOf(a), f(s)]),
      scale: Object.entries(p.scale || {}).map(([a, s]) => ['xyz'.indexOf(a), f(s)]),
    };
    p._rgb = (Array.isArray(p.color) ? p.color : [p.color || 'steel']).map(rgb);
    prepare(p.parts, known);
  }
}

// the light comes from (0.45, 0.85, 0.35); FLAT squashes a part onto the floor along it, for its shadow
const FLAT = new Float32Array([1, 0, 0, 0, -0.45 / 0.85, 0, -0.35 / 0.85, 0, 0, 0, 1, 0, 0, 0.001, 0, 1]);
const VS = `attribute vec3 p; attribute vec3 n; uniform mat4 mvp; uniform mat3 nm; varying vec3 vn;
void main() { vn = nm * n; gl_Position = mvp * vec4(p, 1.0); }`;
const FS = `precision mediump float; uniform vec3 col; uniform vec3 emit; uniform float a; varying vec3 vn;
void main() { vec3 n = normalize(vn); if (!gl_FrontFacing) n = -n;
  float d = max(dot(n, normalize(vec3(0.45, 0.85, 0.35))), 0.0), sky = 0.5 + 0.5 * n.y;
  gl_FragColor = vec4(col * (0.28 + 0.24 * sky + 0.6 * d) + emit, a); }`;

/**
 * Draw scene.view into a canvas: view3d(canvas, scene, known, {onInput(name, value), toggled(name)}).
 * Returns {draw(env), reset(), zoom(k), destroy()} or null if this device cannot do WebGL.
 */
export function view3d(canvas, scene, known, hooks = {}) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, stencil: true });
  if (!gl) return null;
  const v = scene.view || {}, parts = v.parts || [];
  prepare(parts, known);
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  gl.useProgram(prog);
  const A = { p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n') };
  const U = Object.fromEntries(['mvp', 'nm', 'col', 'emit', 'a'].map(k => [k, gl.getUniformLocation(prog, k)]));
  const meshes = {};
  const mesh = name => meshes[name] ??= (() => {
    const g = SHAPES[name](), buf = data => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); return b; };
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.I), gl.STATIC_DRAW);
    return { p: buf(g.P), n: buf(g.N), i: ib, count: g.I.length };
  })();
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // the page's own colours: the background and a floor a shade off it, for light and dark alike
  const probe = document.createElement('span');
  probe.style.color = 'var(--raised, #ffffff)';
  canvas.parentNode.append(probe);
  const bg = (getComputedStyle(probe).color.match(/[\d.]+/g) || [255, 255, 255]).slice(0, 3).map(x => x / 255);
  probe.remove();
  const darkPage = bg[0] + bg[1] + bg[2] < 1.5, floorRGB = bg.map(x => darkPage ? x + 0.06 : x - 0.07);

  const cam0 = { target: [0, 0.5, 0], yaw: 35, pitch: 25, dist: 4, fov: 40, ...(v.camera || {}) };
  let cam = { ...cam0, target: [...cam0.target] };
  let items = [], VP = null, size = [1, 1];
  const labels = new Map(), layer = canvas.parentNode.querySelector('.s3labels');

  // ---- one frame -----------------------------------------------------------------------------------
  function collect(list, F0, env, out) {
    for (const p of list) {
      if (p.each) {
        const many = p._f.each(env) || [];
        many.forEach((it, k) => {
          for (const [key, val] of Object.entries(it)) env[`item.${key}`] = val;
          one(p, F0, env, out, `${k}`);
        });
        for (const key of Object.keys(many[0] || {})) delete env[`item.${key}`];
      } else one(p, F0, env, out, '');
    }
  }
  function one(p, F0, env, out, tag) {
    const f = p._f;
    if (f.show && !f.show(env)) return;
    const at = [...(p.at || [0, 0, 0])], rot = [...(p.rot || [0, 0, 0])], s = [...(p.size || [0.1, 0.1, 0.1])];
    for (const [k, g] of f.move) at[k] += +g(env) || 0;
    for (const [k, g] of f.turn) rot[k] += (+g(env) || 0) % 360;
    for (const [k, g] of f.scale) s[k] *= +g(env) || 0;
    const lit = f.lit ? !!f.lit(env) : null;
    const base = p._rgb[f.shade ? Math.max(0, Math.min(p._rgb.length - 1, Math.round(+f.shade(env) || 0))) : 0];
    const col = lit === false ? base.map(x => x * 0.42) : base, emit = lit ? base.map(x => x * 0.55) : [0, 0, 0];
    const copies = p.repeat ? Array.from({ length: p.repeat.n || 1 }, (_, k) => {
      const st = p.repeat.step || [0.1, 0, 0], len = Math.hypot(...st) || 1, wrap = p.repeat.wrap || len * (p.repeat.n || 1);
      const d = ((k * len + (f.shift ? +f.shift(env) || 0 : 0)) % wrap + wrap) % wrap;
      return st.map(x => x / len * d);
    }) : [[0, 0, 0]];
    for (const off of copies) {
      const F = mul(F0, frame(at.map((x, k) => x + off[k]), rot));
      if (p.shape && SHAPES[p.shape] && s.every(x => Math.abs(x) > 1e-6))
        out.push({ p, mesh: mesh(p.shape), M: scaled(F, s), N: normals(F, s), col, emit, a: p.alpha ?? 1, F });
      if (p.label && !tag) out.push({ p, label: p.label, F });
      collect(p.parts || [], F, env, out);
    }
  }

  function draw(env) {
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    size = [w, h];
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(...bg, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const yaw = cam.yaw * Math.PI / 180, pitch = cam.pitch * Math.PI / 180;
    const eye = [cam.target[0] + cam.dist * Math.cos(pitch) * Math.sin(yaw), cam.target[1] + cam.dist * Math.sin(pitch), cam.target[2] + cam.dist * Math.cos(pitch) * Math.cos(yaw)];
    const V = lookAt(eye, cam.target);
    // the scene is framed for 16:9; on a taller canvas (a phone) keep its width in view and show more above and below
    const half = Math.atan(Math.tan(cam.fov * Math.PI / 360) * Math.max(1, 16 / 9 / (w / h)));
    VP = mul(perspective(2 * half, w / h, 0.02, 100), V);
    items = [];
    const fl = v.floor ?? 6;
    if (fl) items.push({ p: {}, mesh: mesh('box'), M: scaled(frame([cam0.target[0], -0.005, cam0.target[2]], [0, 0, 0]), [fl, 0.01, fl]), N: normals(I4(), [1, 1, 1]), col: floorRGB, emit: [0, 0, 0], a: 1 });
    collect(parts, I4(), env, items);
    const solid = items.filter(d => d.mesh && d.a >= 1), clear = items.filter(d => d.mesh && d.a < 1)
      .map(d => [d, apply(V, [d.M[12], d.M[13], d.M[14]])[2]]).sort((x, y) => x[1] - y[1]).map(x => x[0]);
    const put = d => {
      gl.bindBuffer(gl.ARRAY_BUFFER, d.mesh.p); gl.enableVertexAttribArray(A.p); gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, d.mesh.n); gl.enableVertexAttribArray(A.n); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, d.mesh.i);
      gl.uniformMatrix4fv(U.mvp, false, mul(VP, d.M)); gl.uniformMatrix3fv(U.nm, false, d.N);
      gl.uniform3fv(U.col, d.col); gl.uniform3fv(U.emit, d.emit); gl.uniform1f(U.a, d.a);
      gl.drawElements(gl.TRIANGLES, d.mesh.count, gl.UNSIGNED_SHORT, 0);
    };
    gl.depthMask(true); solid.forEach(put);
    // shadows: every solid part flattened onto the floor along the light, each floor pixel darkened once (the stencil)
    if (fl && v.shadows !== false) {
      gl.enable(gl.STENCIL_TEST); gl.clear(gl.STENCIL_BUFFER_BIT); gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      gl.depthMask(false); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -4);
      for (const d of solid) if (d.p.shape && d.p.shadow !== false) put({ ...d, M: mul(FLAT, d.M), col: [0, 0, 0], emit: [0, 0, 0], a: darkPage ? 0.35 : 0.13 });
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.disable(gl.STENCIL_TEST);
    }
    gl.depthMask(false); clear.forEach(put); gl.depthMask(true);
    // labels: html over the canvas, where each part's origin lands; kept inside it, and one that would cover an
    // earlier one is left off (they crowd on a phone)
    const seen = new Set(), placed = [];
    if (layer) for (const d of items.filter(x => x.label)) {
      const off = d.p.label_at || [0, 0, 0], q = apply(VP, [d.F[12] + off[0], d.F[13] + off[1], d.F[14] + off[2]]);
      let tag = labels.get(d.p);
      if (!tag) { tag = document.createElement('span'); tag.className = 's3label' + (/\{/.test(d.label) ? ' calc' : ''); layer.append(tag); labels.set(d.p, tag); }
      seen.add(d.p);
      if (q[3] <= 0) { tag.hidden = true; continue; }
      tag.hidden = false;
      const text = fill(d.label, env);
      if (tag.textContent !== text) tag.textContent = text;
      const lw = tag.offsetWidth, lh = tag.offsetHeight;
      const x = Math.min(Math.max((q[0] / q[3] + 1) / 2 * w, lw / 2 + 2), w - lw / 2 - 2), y = Math.max((1 - q[1] / q[3]) / 2 * h, lh + 2);
      const box = [x - lw / 2, y - lh, x + lw / 2, y];
      if (placed.some(b => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) { tag.hidden = true; continue; }
      placed.push(box);
      tag.style.transform = `translate(${box[0].toFixed(1)}px, ${box[1].toFixed(1)}px)`;
    }
    for (const [p, tag] of labels) if (!seen.has(p)) tag.hidden = true;
  }

  // ---- the pointer: turn the view, or press what it is on --------------------------------------------
  function hit(e) {
    if (!VP) return null;
    const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 2 - 1, y = 1 - (e.clientY - r.top) / r.height * 2;
    const inv = invert(VP), a = apply(inv, [x, y, -1]), b = apply(inv, [x, y, 1]);
    const o = a.slice(0, 3).map(c => c / a[3]), far = b.slice(0, 3).map(c => c / b[3]);
    let best = null;
    for (const d of items) {
      if (!d.mesh || !(d.p.press || d.p.toggle)) continue;
      const mi = invert(d.M);
      if (!mi) continue;
      const lo = apply(mi, o), ld = sub(apply(mi, far), lo);
      let t0 = 0, t1 = 1;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(ld[k]) < 1e-12) { if (Math.abs(lo[k]) > 0.5) { t0 = 2; break; } continue; }
        let u = (-0.5 - lo[k]) / ld[k], w = (0.5 - lo[k]) / ld[k];
        if (u > w) [u, w] = [w, u];
        t0 = Math.max(t0, u); t1 = Math.min(t1, w);
      }
      if (t0 <= t1 && (!best || t0 < best.t)) best = { t: t0, p: d.p };
    }
    return best?.p || null;
  }
  let drag = null, held = null;
  let downAt = 0;
  const release = () => {
    if (!held) return;
    const p = held; held = null;
    setTimeout(() => hooks.onInput?.(p.press, 'up'), Math.max(0, 150 - (performance.now() - downAt)));   // a quick tap still lasts a scan or two
  };
  canvas.addEventListener('pointerdown', e => {
    const p = hit(e);
    if (p?.press) { held = p; downAt = performance.now(); hooks.onInput?.(p.press, 'down'); canvas.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: false, p, type: e.pointerType };
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) { canvas.style.cursor = hit(e) ? 'pointer' : 'grab'; return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    cam.yaw = drag.yaw - dx * 0.4;
    if (drag.type !== 'touch') cam.pitch = Math.max(-5, Math.min(85, drag.pitch + dy * 0.3));   // on a phone, up and down scrolls the page
  });
  const up = () => { if (drag && !drag.moved && drag.p?.toggle) hooks.onInput?.(drag.p.toggle, 'toggle'); drag = null; release(); };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(ev, up);
  canvas.addEventListener('pointerleave', () => { if (drag?.type === 'mouse') drag = null; });
  const zoom = k => { cam.dist = Math.max(0.3, Math.min(40, cam.dist * k)); };
  canvas.addEventListener('wheel', e => { if (document.activeElement !== canvas) return; e.preventDefault(); zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1); }, { passive: false });
  canvas.addEventListener('keydown', e => {
    const k = { ArrowLeft: () => { cam.yaw += 8; }, ArrowRight: () => { cam.yaw -= 8; }, ArrowUp: () => { cam.pitch = Math.min(85, cam.pitch + 6); },
      ArrowDown: () => { cam.pitch = Math.max(-5, cam.pitch - 6); }, '+': () => zoom(1 / 1.15), '=': () => zoom(1 / 1.15), '-': () => zoom(1.15), 0: () => reset() }[e.key];
    if (k) { k(); e.preventDefault(); e.stopPropagation(); }
  });
  const reset = () => { cam = { ...cam0, target: [...cam0.target] }; };
  return { draw, reset, zoom, destroy() { labels.forEach(t => t.remove()); gl.getExtension('WEBGL_lose_context')?.loseContext(); } };
}
