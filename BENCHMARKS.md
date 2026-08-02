# BENCHMARKS.md — Phase 0 spike results and runner decision

Measured 2026-08-02 on Intel Core Ultra 9 285K (24 cores), 91 GB RAM, Linux 6.17,
Node 24.12, Chrome (headless via Playwright), Verovio 6.2.0-43f8060, g++ 15.2 `-O2`.

All numbers are `loadData + renderToSVG(page 1)` per protocol, warmup excluded,
p50/p95 over ≥8 iterations per input. Tile options: `breaks: none`,
`adjustPageWidth/Height`, no header/footer, scale 40. Reproduce with:

```
npm run spike:a        # slice synthesis + xml:id preservation
npm run spike:b        # slice vs full timing (Node/WASM)
npm run spike:c        # persistent doc + select() vs slice reload
npm run bench:browser  # main thread vs Web Worker (Playwright + Chrome)
VEROVIO_SRC=<verovio checkout with build/libverovio.so> node spikes/native-bench/run-native.mjs
```

## Spike A — slice rendering and xml:id preservation: PASS

A synthesized slice (`scoreDef` + measure window wrapped in a minimal MEI
document) renders correctly, and **every source `xml:id` inside the measure
appears as an `id` on the output SVG** (17/17 on the Bach chorale, 25/25 on the
Beethoven quartet). Hit-testing via `closest("g[id]")` is proven in the app
shell. In these corpus files only notes and measures carry source ids; Verovio
generates ids for the rest — consistent with DESIGN.md's generate-on-import rule.

Two structural gotchas found and handled:

- MEI headers may embed an `<incip>` with its own `<score>`; the performed
  score must be located under `<music>`, never document-wide.
- Multi-movement files hold several `<mdiv>`s; "the score" is per-mdiv
  (the Beethoven quartet's first movement alone is 313 measures).

## Spike B — slice vs full-document render (Node/WASM): tiling validated

| Fixture | Measures | Full load+layout p50 | Slice(1) p50/p95 | Slice(4) p50/p95 |
|---|---|---|---|---|
| Bach chorale (4 staves) | 14 | 17.8 ms | 3.8 / 4.0 ms | 5.7 / 6.2 ms |
| Beethoven Hymn (orchestral) | 61 | 372.7 ms | 11.5 / 15.6 ms | 29.1 / 43.6 ms |
| Brandenburg 2/I (9 staves) | 119 | 439.9 ms | 6.4 / 7.4 ms | 14.5 / 17.3 ms |
| Beethoven quartet Op.18/1 (4 staves) | 313 | 334.5 ms | 3.6 / 4.4 ms | 5.9 / 7.1 ms |

Full-document layout costs 330–440 ms on real files — 7–9× the 50 ms edit
budget, so re-layout-on-keystroke is off the table. Single-measure tiles cost
3.6–11.5 ms p50; even the worst case observed (orchestral 4-measure window,
43.6 ms p95) fits inside the budget. **Tiling is worth it: 30–100× cheaper than
full layout per edit.**

## Runner bake-off — WASM main thread vs Web Worker vs native C++

Same slice files for all runners. Browser = Chrome headless; native = g++ -O2
against `libverovio.so` (the same code a Tauri Rust FFI hook would call).

**Per-tile render, p50 (p95) in ms:**

| Input | svg size | WASM main thread | WASM worker (compute) | WASM worker round-trip¹ | Native C++ |
|---|---|---|---|---|---|
| Hymn, 1 measure | 136 KB | 11.9 (14.6) | 11.2 (12.8) | 11.3 (12.5) | 7.4 (8.7) |
| Hymn, 4 measures | 402 KB | 30.3 (40.4) | 30.6 (39.9) | 31.4 (41.4) | 20.7 (27.4) |
| Quartet, 1 measure | 24 KB | 3.7 (5.5) | 3.6 (4.4) | 3.9 (4.8) | 1.4 (2.6) |
| Quartet, 4 measures | 59 KB | 5.8 (6.6) | 5.8 (6.6) | 6.0 (6.9) | 3.1 (4.2) |

¹ Round-trip measured on the main thread: post slice XML → worker renders →
SVG string structured-cloned back.

Supporting numbers:

- **Worker init** (WASM compile + instantiate + font setup): 181 ms total,
  91 ms inside the worker. One-time, amortized at startup; a pool of N workers
  can init in parallel.
- **Transfer overhead** (round-trip minus compute): ~0.2–1.1 ms even for the
  402 KB SVG payload. Structured clone of strings is effectively free at tile
  scale.
- **JSON serialize+parse of the SVG payload** (the shape of Tauri's IPC
  serialization cost): 0.1–0.8 ms p50. The in-process part of IPC is cheap;
  the unknown is the webview bridge itself.
- Node and Chrome WASM numbers agree within noise (same V8), so Node benches
  are a valid proxy for renderer-process performance.

## Spike C — persistent document + select() vs slice reload per render

Hypothesis tested: if `loadData(slice)` dominated per-tile cost, keeping the
full document loaded in each worker and rendering tiles via
`select({measureRange}) + redoLayout()` might win, or tiles should get wider.
Both parts came back negative.

**Per-tile totals, p50/p95 in ms (Node/WASM):**

| Input | Slice reload (loadData + render) | Persistent (select + redoLayout + render) |
|---|---|---|
| Hymn (orchestral), 1 measure | 13.1 / 14.8 (load 4.6, render 8.7) | 71.1 / 78.5 (select 62.9, render 8.7) |
| Hymn, 4 measures | 33.9 / 44.2 (load 7.9, render 26.0) | 84.5 / 97.5 (select 60.3, render 26.6) |
| Hymn, 8 measures | 64.2 / 83.8 (load 12.3, render 51.6) | 111.1 / 129.1 (select 61.7, render 51.6) |
| Quartet, 1 measure | 3.9 / 4.5 (load 2.2, render 1.7) | 50.8 / 57.1 (select 48.8, render 1.9) |
| Quartet, 4 measures | 6.0 / 6.6 (load 2.7, render 3.4) | 51.5 / 55.7 (select 47.8, render 3.6) |
| Quartet, 8 measures | 9.0 / 10.9 (load 3.3, render 5.8) | 53.9 / 58.2 (select 48.3, render 5.9) |

Persistent init (full `loadData` with a pending 1-measure selection): 155–181 ms
per worker per document — and again after **every edit**, since edits
invalidate the loaded document.

Findings:

1. **`loadData` on a slice does not dominate** — it is 35–56 % of tile cost at
   1 measure and shrinks as tiles widen; rendering is the bigger half. There
   is no pressure toward fewer/larger tiles from the loading side.
2. **`select()` + `redoLayout()` has a ~50–63 ms floor independent of
   selection width** — it un-casts-off and re-extracts against the whole
   loaded document, so the cost is O(document), not O(selection). Verified in
   source (`Toolkit::RedoLayout` → `InitSelectionDoc`) and by measurement
   (the floor is flat across 1/4/8-measure selections on both fixtures). A
   single 1-measure tile via select() already exceeds the 50 ms edit budget.
3. **Tile width must be content-aware.** Render cost scales with notated
   content: 8 quartet measures cost 9 ms, 8 orchestral measures cost 64 ms
   p50 / 84 ms p95 (over budget). The flow layout should cap tile windows by
   staff count / density — roughly ≤4 measures for dense orchestral scores,
   wider allowed for small ensembles.

Selection correctness was verified per render (expected measure `xml:id`
present in the output SVG) — no wrong-content renders observed.

## Decision: Verovio WASM in a Web Worker pool

Adopted as the default runner:

1. **The budget is met without native.** Worst observed tile render is ~40 ms
   p95 (orchestral 4-measure window); typical tiles are 4–12 ms. Both fit the
   50 ms edit budget with headroom for overlay work.
2. **Workers cost nothing.** Compute in a worker equals main-thread compute,
   and transfer is ~1 ms. In exchange the main thread never blocks (no input
   jank during scroll-driven re-renders), and a pool gives real parallelism
   for cold-opening large scores: 500 tiles × ~4 ms ÷ 8 workers ≈ 250 ms of
   wall clock — comfortably inside the 1 s first-screen budget.
3. **Native is 1.5–2.6× faster on compute but buys nothing we need yet,** and
   it costs: an IPC hop with unmeasured webview-bridge overhead on every tile,
   loss of browser-runnability (DESIGN.md requires the app to run as a plain
   web app), per-platform packaging of a 12 MB shared library, and an async
   process boundary in the middle of the hottest path.
4. Mirrors the DESIGN.md stance on Rust: **native is a deferral, not a
   rejection.** The `TileRenderer` interface (slice XML in → SVG + timing out)
   is runner-agnostic; a Tauri-hosted native renderer can be swapped in later
   without touching callers.
5. **Per-render slice loading is the right worker protocol** (spike C):
   `loadData` on a slice is a minority of tile cost, while the alternative —
   a persistently loaded document rendered via `select()` — carries a
   ~50–63 ms O(document) floor per tile plus a full re-load after every edit.
   Workers stay stateless; all document state lives in the core.

**What would reopen the decision:** profiling on real AMT/OMR scores showing
tile p95 over budget on target hardware (older laptops, not this 24-core
workstation — rerun the benches there); or batch operations (e.g. re-rendering
hundreds of downstream tiles after a key change) where 2× native compute would
materially matter.

**Tauri IPC round-trip — measured (2026-08-02, Tauri 2 release build,
WebKitGTK 2.52.3).** `invoke("bench_echo", payload)` from the webview to a
Rust command and back, string payloads sized like real tile/page SVGs;
20 iterations; WebKit quantizes `performance.now()` to 1 ms so values are ±1:

| Payload | p50 | p95 |
|---|---|---|
| 24 KB (quartet tile) | ~1 ms | 31 ms (first-call warmup outlier) |
| 136 KB (orchestral tile) | ~1 ms | ~1 ms |
| 402 KB (4-measure orchestral) | ~2 ms | ~2 ms |
| 1 MB (page-view scale) | ~5 ms | ~8 ms |

So a hypothetical native-Verovio tile path would cost ≈ native render + 1–2 ms
IPC: e.g. quartet tile 1.4 + ~1.5 ≈ 3 ms vs 3.9 ms for the WASM worker;
orchestral 7.4 + ~2 ≈ 9.5 ms vs 11.3 ms. Mildly faster, not transformative —
the decision above stands (parallel worker pool, browser parity, no native
packaging). IPC is not a blocker if profiling ever motivates the native path.

**Shell packaging note:** on this machine (WebKitGTK 2.52.3, Wayland) the
release binary with embedded assets (`--features custom-protocol`) shows a
blank webview — the page never loads over the `tauri://` protocol; the same
binary loading the vite `devUrl` works fine (that is how the IPC bench ran:
`npx vite --port 5173` + `cargo run --release`). Investigate before shipping
the desktop build: try `useHttpsScheme`, a newer/older WebKitGTK, or Tauri
updates. Tracked as a Phase 7 packaging task; does not affect editor
development, which is browser-first.

## Open issues logged for Phase 1

- ~~The app shell renders every tile with the *initial* scoreDef~~ — resolved:
  the effective-context resolver landed with its test suite (2026-08-02).
- ~~Control events crossing tile boundaries~~ — resolved: per-tile
  segmentation rewrites boundary-crossing slurs/ties/phrases/hairpins as
  tstamp-anchored continuation stubs (incoming stubs are injected from a
  per-score span index, since the event element lives in its start measure).
  Curves passing entirely *over* a one-measure tile are not drawn — accepted,
  same convention as system breaks.
- First render in a fresh toolkit is ~2–4× slower than steady state (font/
  glyph warmup); pool workers render a throwaway slice at init (done).

## Fallback on file: staff-windowing for dense scores

If editing-latency budgets are ever missed on orchestral material, the next
lever is slicing by **staff range** as well as measure range (prune whole
`staffGrp` subtrees from the tile scoreDef, keeping grouped staves together).
Current data says it is not needed: the editing hot path re-renders only the
dirtied tile, and a single orchestral measure is ~11–12 ms — inside budget.
The over-budget cases are only wide *windows* (4–8 measures) on dense scores,
which content-aware tile width already addresses. Prefer staff-range pruning
over **layer**-level pruning if it comes to that: removing one layer from a
two-layer staff changes stem directions and spacing, so the tile would no
longer look like the page view. Revisit with profiles from Phase 2 editing.
