/**
 * Tauri IPC benchmark — runs only inside the Tauri shell (window.__TAURI__
 * present, injected via withGlobalTauri). Measures webview -> Rust -> webview
 * round-trips for SVG-sized string payloads, the exact shape a native-Verovio
 * tile renderer would ship, then reports to the bench_report command
 * (which writes $BATTUTA_BENCH_OUT and exits the app).
 */

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Prefer the public global; fall back to the always-injected internal bridge. */
function getInvoke(): Invoke | null {
  const w = window as unknown as {
    __TAURI__?: { core: { invoke: Invoke } };
    __TAURI_INTERNALS__?: { invoke: Invoke };
  };
  return w.__TAURI__?.core.invoke ?? w.__TAURI_INTERNALS__?.invoke ?? null;
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

export async function maybeRunIpcBench(): Promise<void> {
  const invoke = getInvoke();
  if (!invoke) return;
  const log = (msg: string) => void invoke("js_log", { msg }).catch(() => undefined);
  window.addEventListener("error", (e) => log(`window.error: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => log(`unhandledrejection: ${String(e.reason).slice(0, 300)}`));
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    log(`console.error: ${args.map(String).join(" ").slice(0, 300)}`);
    origError(...args);
  };
  log(`bench starting; ua=${navigator.userAgent}`);
  // Payload sizes match measured tile/page SVG sizes (BENCHMARKS.md).
  const sizes = [
    { name: "24KB", bytes: 24 * 1024 },
    { name: "136KB", bytes: 136 * 1024 },
    { name: "402KB", bytes: 402 * 1024 },
    { name: "1MB", bytes: 1024 * 1024 },
  ];
  const ITERS = 20;
  const results = [];
  for (const size of sizes) {
    const payload = "M".repeat(size.bytes);
    await invoke("bench_echo", { payload }); // warmup
    const times: number[] = [];
    for (let i = 0; i < ITERS; i++) {
      const t0 = performance.now();
      await invoke("bench_echo", { payload });
      times.push(performance.now() - t0);
    }
    results.push({ size: size.name, p50: r2(quantile(times, 0.5)), p95: r2(quantile(times, 0.95)), min: r2(times.sort((a, b) => a - b)[0]!) });
  }
  log("bench done, reporting");
  await invoke("bench_report", { report: JSON.stringify({ ua: navigator.userAgent, iters: ITERS, results }, null, 2) });
}
