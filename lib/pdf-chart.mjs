/** Lightweight SVG charts for pdfme (TestRail-style status pies / bars). */

export function buildPieChartSvg(slices = [], { size = 240 } = {}) {
  const items = (slices || [])
    .map((slice) => ({
      label: String(slice.label || ""),
      value: Math.max(0, Number(slice.value) || 0),
      color: slice.color || "#94a3b8"
    }))
    .filter((slice) => slice.value > 0);

  const total = items.reduce((sum, slice) => sum + slice.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;

  if (!total) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#e8eef5"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="#ffffff"/>
</svg>`;
  }

  if (items.length === 1) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${items[0].color}"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="#ffffff"/>
</svg>`;
  }

  let angle = -Math.PI / 2;
  const paths = items.map((slice) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    return `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${slice.color}"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  ${paths.join("\n  ")}
  <circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="#ffffff"/>
</svg>`;
}

export function buildStackedBarSvg(slices = [], { width = 520, height = 28 } = {}) {
  const items = (slices || [])
    .map((slice) => ({
      value: Math.max(0, Number(slice.value) || 0),
      color: slice.color || "#94a3b8"
    }))
    .filter((slice) => slice.value > 0);
  const total = items.reduce((sum, slice) => sum + slice.value, 0) || 1;
  let x = 0;
  const rects = items.map((slice) => {
    const w = (slice.value / total) * width;
    const rect = `<rect x="${x.toFixed(2)}" y="0" width="${Math.max(w, 0.5).toFixed(2)}" height="${height}" fill="${slice.color}"/>`;
    x += w;
    return rect;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#e8eef5"/>
  ${rects.join("\n  ")}
</svg>`;
}

export function pct(part, whole) {
  const total = Number(whole) || 0;
  if (!total) return "0%";
  return `${Math.round((Number(part) || 0) / total * 100)}%`;
}

export function withCountPct(count, total) {
  return `${Number(count) || 0}  (${pct(count, total)})`;
}
