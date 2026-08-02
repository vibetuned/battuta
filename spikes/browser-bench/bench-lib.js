/** Shared timing helpers for main-thread and worker benches. */

export const TILE_OPTIONS = {
  breaks: "none",
  adjustPageWidth: true,
  adjustPageHeight: true,
  header: "none",
  footer: "none",
  pageMarginLeft: 20,
  pageMarginRight: 20,
  pageMarginTop: 20,
  pageMarginBottom: 20,
  svgViewBox: true,
  scale: 40,
};

export const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
export const round2 = (x) => Math.round(x * 100) / 100;
export const stats = (xs) => ({ p50: round2(quantile(xs, 0.5)), p95: round2(quantile(xs, 0.95)), n: xs.length });

/** Render each slice ITERS times with a warmup; returns per-group timings. */
export function benchSlices(toolkit, sliceXmls, iters = 8) {
  const times = [];
  let svg = "";
  for (const xml of sliceXmls) {
    toolkit.loadData(xml);
    toolkit.renderToSVG(1); // warmup for this content
    for (let i = 0; i < iters; i++) {
      const t0 = performance.now();
      toolkit.loadData(xml);
      svg = toolkit.renderToSVG(1);
      times.push(performance.now() - t0);
    }
  }
  return { times, svg };
}
