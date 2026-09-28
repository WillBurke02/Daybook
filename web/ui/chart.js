// SVG charts, no dependencies. Colours come from CSS custom properties, so the
// three themes are the stylesheet's job.
import { el } from '../core/dom.js';
import { money, monthName, taxYearLabel, taxYearOf, mondayOf, dayShort, addMonths } from '../core/format.js';

const SVG = 'http://www.w3.org/2000/svg';
const n = (t, a = {}) => { const e = document.createElementNS(SVG, t);
  for (const k in a) e.setAttribute(k, a[k]); return e; };
// Fixed order, never cycled: a seventh series folds into Other.
export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
const OTHER = 'var(--ink-3)';
const colour = (x, i) => x.color || (x.name === 'Other' ? OTHER : SERIES[i] || OTHER);

export const TYPES = [
  { v: 'bar', label: 'Bar' }, { v: 'stacked', label: 'Stacked' }, { v: 'line', label: 'Line' },
  { v: 'area', label: 'Area' }, { v: 'hbar', label: 'Rows' }, { v: 'pie', label: 'Pie' },
  { v: 'table', label: 'Table' },
];

function ticks(lo, hi, count = 5) {
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find(m => m * mag >= raw) * mag;
  const out = [];
  for (let v = Math.floor(lo / step) * step; v < hi + step - 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

// --- shaping rows into series -------------------------------------------------

const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const isMonth = v => /^\d{4}-\d{2}$/.test(v || '');
export const timeLike = rows => rows.length && rows.slice(0, 5).every(r => isDate(r) || isMonth(r));

export function bucket(v, grain) {
  if (!v) return v;
  if (grain === 'day' && isDate(v)) return v;
  if (grain === 'week' && isDate(v)) return mondayOf(v);
  const m = v.slice(0, 7);
  if (grain === 'quarter') return `${m.slice(0, 4)}-Q${Math.floor((+m.slice(5) - 1) / 3) + 1}`;
  if (grain === 'year') return m.slice(0, 4);
  if (grain === 'taxyear') return String(taxYearOf(isDate(v) ? v : m + '-15'));
  return m;
}
export function bucketLabel(k, grain) {
  if (grain === 'week' || grain === 'day') return dayShort(k);
  if (grain === 'taxyear') return taxYearLabel(+k);
  if (/^\d{4}-\d{2}$/.test(k)) return monthName(k);
  return k;
}

/**
 * rows -> {labels, series}. cfg: {x, y:[..], split, grain, agg, top, names}
 * Time on x: grouped by grain, in order, gaps between months filled.
 * Categories on x: largest first, the tail folded into Other.
 */
export function shape(rows, cfg) {
  const ys = cfg.y || [];
  const time = timeLike(rows.map(r => r[cfg.x]));
  const key = r => time ? bucket(r[cfg.x], cfg.grain || 'month') : (r[cfg.x] ?? '—');
  const val = (r, y) => cfg.agg === 'count' ? 1 : (+r[y] || 0);
  const cell = {};              // x -> series -> total
  const tot = {};               // series -> total
  const xs = {};
  for (const r of rows) {
    const x = key(r);
    xs[x] = (xs[x] || 0);
    const parts = cfg.split ? [[String(r[cfg.split] ?? '—'), ys[0]]] : ys.map(y => [y, y]);
    for (const [s, y] of parts) {
      const v = val(r, y);
      cell[x] = cell[x] || {}; cell[x][s] = (cell[x][s] || 0) + v;
      tot[s] = (tot[s] || 0) + v; xs[x] += v;
    }
  }
  let names = Object.keys(tot);
  if (cfg.split) {
    names.sort((a, b) => tot[b] - tot[a]);
    const keep = cfg.top || 6;
    if (names.length > keep) {
      const kept = names.slice(0, keep - 1);
      for (const x in cell) {
        let o = 0;
        for (const s in cell[x]) if (!kept.includes(s)) o += cell[x][s];
        cell[x].Other = o;
      }
      names = [...kept, 'Other'];
    }
  } else names = ys;
  let keys = Object.keys(xs);
  if (time) {
    keys.sort();
    if ((cfg.grain || 'month') === 'month' && keys.length > 1) {
      const all = [];
      for (let m = keys[0]; m <= keys[keys.length - 1]; m = addMonths(m, 1)) all.push(m);
      keys = all;
    }
  } else {
    keys.sort((a, b) => Math.abs(xs[b]) - Math.abs(xs[a]));
    const cap = cfg.maxCats || 12;
    if (keys.length > cap) {
      const tail = keys.slice(cap - 1);
      const o = {};
      for (const x of tail) for (const s in cell[x]) o[s] = (o[s] || 0) + cell[x][s];
      keys = [...keys.slice(0, cap - 1), 'Other'];
      cell.Other = o;
    }
  }
  return {
    time,
    labels: keys.map(k => time ? bucketLabel(k, cfg.grain || 'month') : k),
    keys,
    series: names.map(s => ({
      name: (cfg.names || {})[s] || s,
      values: keys.map(k => +((cell[k] || {})[s] || 0).toFixed(2)),
    })),
  };
}

// --- drawing ------------------------------------------------------------------

/** chart(mount, {type, labels, series, fmt, height, zeroBase}) */
export function chart(mount, o) {
  const fmt = o.fmt || money;
  const s = o.series.filter(x => x.values.some(v => v));
  mount.innerHTML = '';
  mount.className = 'chart';
  if (!s.length || !o.labels.length) { mount.append(el('div', { class: 'empty' }, 'No data in this period')); return; }
  if (o.type === 'table') { mount.append(dataTable(o.labels, s, fmt)); return; }
  if (o.type === 'pie') { donut(mount, o, s, fmt); return; }
  if (s.length > 1) {
    mount.append(el('div', { class: 'legend' }, s.map((x, i) => el('span', {},
      el('i', { style: `background:${colour(x, i)}` }), x.name))));
  }
  const plot = el('div'); mount.append(plot);
  const tip = el('div', { class: 'tip' }); mount.append(tip);
  const draw = () => render(plot, tip, o, s, fmt);
  draw();
  new ResizeObserver(() => { if (plot.clientWidth !== plot._w) { plot._w = plot.clientWidth; draw(); } }).observe(plot);
}

function dataTable(labels, series, fmt) {
  const tb = el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, ''), series.map(x => el('th', { class: 'n' }, x.name)),
      series.length > 1 ? el('th', { class: 'n' }, 'Total') : null)),
    el('tbody', {}, labels.map((l, i) => el('tr', {}, el('td', {}, l),
      series.map(x => el('td', { class: 'n' }, x.values[i] ? fmt(x.values[i]) : '')),
      series.length > 1 ? el('td', { class: 'n' }, fmt(series.reduce((a, x) => a + (x.values[i] || 0), 0))) : null))),
    el('tfoot', {}, el('tr', { class: 'total' }, el('td', {}, 'Total'),
      series.map(x => el('td', { class: 'n' }, fmt(x.values.reduce((a, v) => a + (v || 0), 0)))),
      series.length > 1 ? el('td', { class: 'n' }, fmt(series.reduce((a, x) => a + x.values.reduce((b, v) => b + (v || 0), 0), 0))) : null)));
  return el('div', { class: 'scroll mid' }, tb);
}

function donut(mount, o, s, fmt) {
  // one series: a slice per label. several: a slice per series.
  let slices = s.length === 1
    ? o.labels.map((l, i) => ({ name: l, v: Math.max(0, s[0].values[i] || 0) }))
    : s.map(x => ({ name: x.name, v: Math.max(0, x.values.reduce((a, b) => a + (b || 0), 0)) }));
  slices = slices.filter(x => x.v > 0).sort((a, b) => (a.name === 'Other') - (b.name === 'Other') || b.v - a.v);
  if (slices.length > 6) {
    const rest = slices.slice(5).reduce((a, x) => a + x.v, 0);
    slices = [...slices.slice(0, 5), { name: 'Other', v: rest }];
  }
  const total = slices.reduce((a, x) => a + x.v, 0);
  if (!total) { mount.append(el('div', { class: 'empty' }, 'No data in this period')); return; }
  const R = 90, r = 56, C = 100;
  const svg = n('svg', { viewBox: '0 0 200 200', role: 'img' });
  const tip = el('div', { class: 'tip' });
  let a0 = -Math.PI / 2;
  slices.forEach((x, i) => {
    const a1 = a0 + (x.v / total) * Math.PI * 2;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => `${C + rad * Math.cos(a)} ${C + rad * Math.sin(a)}`;
    const d = slices.length === 1
      ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} L ${C - 0.01} ${C - r} A ${r} ${r} 0 1 0 ${C} ${C - r} Z`
      : `M ${p(R, a0)} A ${R} ${R} 0 ${big} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${big} 0 ${p(r, a0)} Z`;
    const col = o.colors?.[x.name] || (x.name === 'Other' ? OTHER : SERIES[i] || OTHER);
    const path = n('path', { d, fill: col, stroke: 'var(--panel)', 'stroke-width': 2 });
    path.addEventListener('pointerenter', ev => {
      tip.innerHTML = `<b>${x.name}</b><br>${fmt(x.v)} · ${(x.v / total * 100).toFixed(1)}%`;
      tip.style.opacity = 1; tip.style.left = '8px'; tip.style.top = '8px';
    });
    path.addEventListener('pointerleave', () => { tip.style.opacity = 0; });
    svg.append(path);
    a0 = a1;
  });
  const mid = n('text', { x: C, y: C + 5, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 15,
                          'font-weight': 700, 'font-family': 'var(--mono)' });
  mid.textContent = fmt(total, true);
  svg.append(mid);
  mount.append(el('div', { class: 'donut' }, el('div', { style: 'position:relative' }, svg, tip),
    el('div', { class: 'legend' }, slices.map((x, i) => el('span', {},
      el('span', {}, el('i', { style: `background:${o.colors?.[x.name] || (x.name === 'Other' ? OTHER : SERIES[i] || OTHER)}` }), x.name),
      el('b', {}, `${fmt(x.v)} · ${Math.round(x.v / total * 100)}%`))))));
}

function render(plot, tip, o, s, fmt) {
  const W = plot.clientWidth || 600, H = o.height || 220;
  const horizontal = o.type === 'hbar';
  const stacked = o.type === 'stacked' || (o.type === 'area' && s.length > 1);
  const line = o.type === 'line' || o.type === 'area';
  const labW = horizontal ? Math.min(160, Math.max(60, ...o.labels.map(l => Math.min(24, l.length) * 6.4))) : 0;
  const pad = horizontal ? { t: 6, r: 14, b: 22, l: labW + 8 } : { t: 10, r: 10, b: 24, l: 52 };
  const Hh = horizontal ? Math.max(H, o.labels.length * 22 + pad.t + pad.b) : H;
  const iw = Math.max(40, W - pad.l - pad.r), ih = Hh - pad.t - pad.b;

  let lo = 0, hi = 0;
  o.labels.forEach((_, i) => {
    if (stacked) {
      let p = 0, m = 0;
      s.forEach(x => { const v = x.values[i] || 0; v >= 0 ? p += v : m += v; });
      hi = Math.max(hi, p); lo = Math.min(lo, m);
    } else s.forEach(x => { const v = x.values[i]; if (v == null) return; hi = Math.max(hi, v); lo = Math.min(lo, v); });
  });
  if (o.zeroBase === false && line) {
    lo = Math.min(...s.flatMap(x => x.values.filter(v => v != null)));
    if (lo === hi) { lo -= 1; hi += 1; }
  }
  const tk = ticks(lo, hi);
  lo = Math.min(lo, tk[0]); hi = Math.max(hi, tk[tk.length - 1]);
  const spanV = hi - lo || 1;
  const vpos = v => (v - lo) / spanV;
  const vx = v => pad.l + vpos(v) * iw;
  const vy = v => pad.t + (1 - vpos(v)) * ih;
  const band = (horizontal ? ih : iw) / o.labels.length;
  const cpos = i => (horizontal ? pad.t : pad.l) + band * (i + 0.5);

  const svg = n('svg', { viewBox: `0 0 ${W} ${Hh}`, height: Hh, role: 'img' });
  tk.forEach(v => {
    const g = n('line', { stroke: v === 0 ? 'var(--rule)' : 'var(--rule-soft)', 'stroke-width': 1 });
    if (horizontal) { g.setAttribute('x1', vx(v)); g.setAttribute('x2', vx(v)); g.setAttribute('y1', pad.t); g.setAttribute('y2', pad.t + ih); }
    else { g.setAttribute('y1', vy(v)); g.setAttribute('y2', vy(v)); g.setAttribute('x1', pad.l); g.setAttribute('x2', pad.l + iw); }
    svg.append(g);
    const lab = n('text', { fill: 'var(--ink-3)', 'font-size': 10.5 });
    if (horizontal) { lab.setAttribute('x', vx(v)); lab.setAttribute('y', Hh - 6); lab.setAttribute('text-anchor', 'middle'); }
    else { lab.setAttribute('x', pad.l - 6); lab.setAttribute('y', vy(v) + 4); lab.setAttribute('text-anchor', 'end'); }
    lab.textContent = fmt(v, true);
    svg.append(lab);
  });
  const every = horizontal ? 1 : Math.ceil(o.labels.length / Math.max(2, Math.floor(iw / 58)));
  o.labels.forEach((l, i) => {
    if (i % every) return;
    const t = n('text', { fill: 'var(--ink-3)', 'font-size': 10.5 });
    if (horizontal) { t.setAttribute('x', pad.l - 6); t.setAttribute('y', cpos(i) + 4); t.setAttribute('text-anchor', 'end'); }
    else { t.setAttribute('x', cpos(i)); t.setAttribute('y', Hh - 6); t.setAttribute('text-anchor', 'middle'); }
    t.textContent = l.length > 24 ? l.slice(0, 23) + '…' : l;
    svg.append(t);
  });

  const hits = [];
  if (line) {
    const acc = o.labels.map(() => 0);
    s.forEach((x, si) => {
      const col = colour(x, si);
      const top = x.values.map((v, i) => stacked ? (acc[i] += (v || 0)) : v);
      const base = stacked ? top.map((t, i) => t - (x.values[i] || 0)) : null;
      const pts = top.map((v, i) => v == null ? null : [cpos(i), vy(v)]).filter(Boolean);
      if (o.type === 'area' && pts.length > 1) {
        const bottom = stacked ? base.map((b, i) => [cpos(i), vy(b)]).reverse() : [[pts[pts.length - 1][0], vy(Math.max(lo, 0))], [pts[0][0], vy(Math.max(lo, 0))]];
        svg.append(n('path', { d: 'M' + [...pts, ...bottom].map(p => p.join(' ')).join(' L ') + ' Z',
          fill: col, 'fill-opacity': stacked ? 0.55 : 0.18, stroke: 'none' }));
      }
      if (pts.length > 1) svg.append(n('path', { d: 'M' + pts.map(p => p.join(' ')).join(' L '),
        fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      if (pts.length <= 40) pts.forEach(p => svg.append(n('circle', { cx: p[0], cy: p[1], r: 3.5, fill: col,
        stroke: 'var(--panel)', 'stroke-width': 2 })));
    });
    o.labels.forEach((l, i) => hits.push({ x: cpos(i) - band / 2, y: pad.t, w: band, h: ih, i, cx: cpos(i), cy: pad.t + 10 }));
    svg.append(n('line', { class: 'cross', stroke: 'var(--rule)', 'stroke-width': 1, 'stroke-dasharray': '3 3',
      y1: pad.t, y2: pad.t + ih, x1: -99, x2: -99 }));
  } else {
    const groups = stacked ? 1 : s.length, gap = 2;
    const thick = Math.max(2, Math.min(horizontal ? 16 : 48, (band * 0.72) / groups - (groups > 1 ? gap : 0)));
    o.labels.forEach((l, i) => {
      const acc = { p: 0, m: 0 };
      s.forEach((x, si) => {
        const v = x.values[i];
        if (!v) return;
        const col = (s.length === 1 && o.colors?.[o.labels[i]]) || colour(x, si);
        let from, to;
        if (stacked) { const b = v >= 0 ? acc.p : acc.m; from = b; to = b + v; v >= 0 ? acc.p = to : acc.m = to; }
        else { from = Math.max(0, Math.min(lo, 0)); to = v; }
        const off = stacked ? 0 : (si - (groups - 1) / 2) * (thick + gap);
        const a = horizontal ? vx(from) : vy(from), b = horizontal ? vx(to) : vy(to);
        let x0 = Math.min(a, b), len = Math.abs(b - a);
        if (stacked && len > gap) { len -= gap; if (b < a) x0 += gap; }
        const c = cpos(i) + off - thick / 2;
        const r = n('rect', { fill: col, rx: 3, ry: 3 });
        if (horizontal) { r.setAttribute('x', x0); r.setAttribute('y', c); r.setAttribute('width', Math.max(1, len)); r.setAttribute('height', thick); }
        else { r.setAttribute('x', c); r.setAttribute('y', x0); r.setAttribute('width', thick); r.setAttribute('height', Math.max(1, len)); }
        svg.append(r);
      });
      hits.push({ x: horizontal ? pad.l : cpos(i) - band / 2, y: horizontal ? cpos(i) - band / 2 : pad.t,
                  w: horizontal ? iw : band, h: horizontal ? band : ih, i,
                  cx: horizontal ? pad.l + iw / 2 : cpos(i), cy: horizontal ? cpos(i) : pad.t + 10 });
    });
  }

  const cross = svg.querySelector('.cross');
  hits.forEach(h => {
    const r = n('rect', { x: h.x, y: h.y, width: Math.max(1, h.w), height: Math.max(1, h.h), fill: 'transparent' });
    r.addEventListener('pointerenter', () => {
      const lines = [`<b>${o.labels[h.i]}</b>`];
      s.forEach((x, k) => {
        const v = x.values[h.i]; if (!v) return;
        lines.push(`<span style="color:${colour(x, k)}">●</span> ${s.length > 1 ? x.name + ' ' : ''}${fmt(v)}`);
      });
      if (s.length > 1 && stacked) lines.push(`Total ${fmt(s.reduce((a, x) => a + (x.values[h.i] || 0), 0))}`);
      tip.innerHTML = lines.join('<br>');
      tip.style.opacity = 1;
      const sc = plot.clientWidth / W;
      tip.style.left = Math.min(plot.clientWidth - 150, Math.max(0, h.cx * sc + 10)) + 'px';
      tip.style.top = Math.max(0, h.cy * sc) + 'px';
      if (cross) { cross.setAttribute('x1', h.cx); cross.setAttribute('x2', h.cx); }
    });
    r.addEventListener('pointerleave', () => { tip.style.opacity = 0;
      if (cross) { cross.setAttribute('x1', -99); cross.setAttribute('x2', -99); } });
    svg.append(r);
  });
  plot.innerHTML = '';
  plot.append(svg);
}
