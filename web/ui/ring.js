// A ring that fills towards a goal: the daily goal on Home and in Learn.
/** A ring filling towards a goal, drawn in SVG. */
export function ring(done, goal, size = 64) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, f = Math.min(1, goal ? done / goal : 0);
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('class', 'ring'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${done} of ${goal}`);
  const circle = (cls, dash) => { const e = document.createElementNS(ns, 'circle');
    Object.entries({ cx: size / 2, cy: size / 2, r, class: cls, 'stroke-dasharray': dash, transform: `rotate(-90 ${size / 2} ${size / 2})` })
      .forEach(([k, v]) => e.setAttribute(k, v)); return e; };
  const t = document.createElementNS(ns, 'text');
  Object.entries({ x: '50%', y: '50%', 'dominant-baseline': 'central', 'text-anchor': 'middle' }).forEach(([k, v]) => t.setAttribute(k, v));
  t.textContent = `${done}/${goal}`;
  t.style.fontSize = `${Math.min(size * 0.2, size * 1.1 / t.textContent.length).toFixed(1)}px`;   // 103/20 still fits inside
  svg.append(circle('track', `${c} 0`), circle('fill', `${c * f} ${c}`), t);
  return svg;
}
