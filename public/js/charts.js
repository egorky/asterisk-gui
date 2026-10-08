// Gráficos SVG ligeros (sin dependencias) con colores tomados del tema.
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, kids = []) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  kids.forEach((k) => e.append(k));
  return e;
};

let tip;
function tooltip(html, x, y) {
  if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; document.body.append(tip); }
  if (html == null) { tip.style.display = 'none'; return; }
  tip.replaceChildren(...html);
  tip.style.display = 'block';
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(window.innerWidth - w - 8, x + 12)}px`;
  tip.style.top = `${y + 14}px`;
}
const line = (color, label, val) => {
  const r = document.createElement('div');
  const dot = document.createElement('i'); dot.style.background = color;
  r.append(dot, document.createTextNode(`${label}: `));
  const b = document.createElement('b'); b.textContent = val; r.append(b);
  return r;
};

/** Barras apiladas. data: [{ label, short, values: {serie: n} }], series: [{key, label, color}] */
export function stackedBars(data, series, { height = 220 } = {}) {
  const W = 720, H = height, m = { l: 34, r: 8, t: 10, b: 24 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const totals = data.map((d) => series.reduce((a, k) => a + (d.values[k.key] || 0), 0));
  const max = Math.max(1, ...totals);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', preserveAspectRatio: 'none' });
  for (let v = 0; v <= top; v += step) {
    const y = m.t + ih - (v / top) * ih;
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: 'grid' }));
    const t = s('text', { x: m.l - 6, y: y + 3, class: 'axis', 'text-anchor': 'end' }); t.textContent = v; svg.append(t);
  }
  const bw = iw / Math.max(1, data.length);
  const every = Math.ceil(data.length / 12);
  data.forEach((d, i) => {
    let y = m.t + ih;
    const x = m.l + i * bw + bw * 0.15, w = bw * 0.7;
    const g = s('g', { class: 'bar' });
    g.append(s('rect', { x: m.l + i * bw, y: m.t, width: bw, height: ih, fill: 'transparent' }));
    for (const k of series) {
      const v = d.values[k.key] || 0;
      if (!v) continue;
      const hh = (v / top) * ih;
      y -= hh;
      g.append(s('rect', { x, y, width: Math.max(1, w), height: hh, fill: k.color, rx: 1.5 }));
    }
    g.addEventListener('mousemove', (e) => tooltip([Object.assign(document.createElement('div'), { textContent: d.label, className: 'tip-h' }),
      ...series.filter((k) => d.values[k.key]).map((k) => line(k.color, k.label, d.values[k.key])), line('var(--text-3)', 'Total', totals[i])], e.clientX, e.clientY));
    g.addEventListener('mouseleave', () => tooltip(null));
    svg.append(g);
    if (i % every === 0) {
      const t = s('text', { x: m.l + i * bw + bw / 2, y: H - 6, class: 'axis', 'text-anchor': 'middle' }); t.textContent = d.short; svg.append(t);
    }
  });
  return svg;
}

function niceStep(max) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
}

/** Dona. items: [{label, value, color}] */
export function donut(items, { size = 160, center } = {}) {
  const total = items.reduce((a, i) => a + i.value, 0);
  const svg = s('svg', { viewBox: '0 0 100 100', width: size, height: size, class: 'donut' });
  const r = 38, c = 2 * Math.PI * r;
  svg.append(s('circle', { cx: 50, cy: 50, r, fill: 'none', stroke: 'var(--surface-3)', 'stroke-width': 11 }));
  let off = 0;
  if (total) for (const it of items) {
    if (!it.value) continue;
    const len = (it.value / total) * c;
    const seg = s('circle', { cx: 50, cy: 50, r, fill: 'none', stroke: it.color, 'stroke-width': 11, 'stroke-dasharray': `${Math.max(0, len - 1)} ${c - Math.max(0, len - 1)}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 50 50)' });
    seg.addEventListener('mousemove', (e) => tooltip([line(it.color, it.label, `${it.value} (${Math.round(it.value / total * 100)}%)`)], e.clientX, e.clientY));
    seg.addEventListener('mouseleave', () => tooltip(null));
    svg.append(seg);
    off += len;
  }
  if (center) {
    const t1 = s('text', { x: 50, y: 52, 'text-anchor': 'middle', class: 'donut-v' }); t1.textContent = center[0];
    const t2 = s('text', { x: 50, y: 63, 'text-anchor': 'middle', class: 'donut-l' }); t2.textContent = center[1];
    svg.append(t1, t2);
  }
  return svg;
}

export function hbars(items, { color = 'var(--accent)' } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const wrap = document.createElement('div'); wrap.className = 'hbars';
  for (const it of items) {
    const row = document.createElement('div'); row.className = 'hbar';
    const l = document.createElement('span'); l.textContent = it.label;
    const bar = document.createElement('div'); bar.className = 'hbar-track';
    const f = document.createElement('div'); f.style.width = `${(it.value / max) * 100}%`; f.style.background = color; bar.append(f);
    const v = document.createElement('b'); v.textContent = it.value;
    row.append(l, bar, v); wrap.append(row);
  }
  return wrap;
}
