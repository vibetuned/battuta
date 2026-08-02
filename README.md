# battuta

A local-first MEI score editor that treats notation the way a text editor
treats text: the MEI document is the single source of truth, everything on
screen is a projection of it, and every edit is a reversible command against
it. Verovio does all notation rendering — battuta never draws notation.

- [DESIGN.md](DESIGN.md) — architecture and editing model
- [PLANNING.md](PLANNING.md) — phased plan with exit criteria
- [BENCHMARKS.md](BENCHMARKS.md) — Phase 0 spike results and the render-runner decision

## Status

Phase 0 complete (2026-08-02): both riskiest assumptions validated with data.

- Slice rendering preserves `xml:id`s end to end (spike A: PASS)
- Tiling beats full re-layout by 30–100× per edit (spike B: PASS)
- Runner decision: **Verovio WASM in a Web Worker pool** — see BENCHMARKS.md
  for the full bake-off (main thread vs worker vs native C++, plus the
  persistent-document/`select()` variant, spike C: rejected)

Phase 1 in progress (2026-08-02):

- `@battuta/core`: MEI tree, score builder, **effective-context resolver**
  (clef/key/meter/staff-lines/transposition per measure × staff; attribute and
  child-element forms; interleaved scoreDef/staffDef; inline clefs) with a
  19-test vitest suite plus a Verovio smoke test (507/507 corpus tiles render;
  `npm test -w @battuta/core`, `node spikes/verify-core-tiles.mjs`)
- Editor: worker pool (hardware-scaled), tile cache keyed by
  context-hash + content-hash, virtualized tile grid (shared
  IntersectionObserver), page-view toggle (full Verovio paged layout),
  id-based click selection in both views
- End-to-end check: `node spikes/verify-app.mjs` (context fixture renders
  correct key/clef/meter per tile; 313-measure scroll; page view)
- Control-event segmentation at tile boundaries: boundary-crossing
  slurs/ties/phrases/hairpins are rewritten as tstamp-anchored continuation
  stubs (incoming stubs injected from a per-score span index); verified at
  the render level on both synthetic and corpus files
- Tauri 2 shell in `apps/editor/src-tauri` with a real IPC benchmark
  (results in BENCHMARKS.md); desktop packaging has one open WebKitGTK
  issue, see Native/Tauri notes below

## Layout

```
packages/core/   @battuta/core — document tree, context resolver, commands.
                 Pure logic; no DOM (enforced: tsconfig lib=[ES2022], types=[]).
apps/editor/     Vite + React shell. Verovio in a worker, tile flow layout,
                 id-based hit-testing. Runs in any browser; Tauri shell later.
spikes/          Phase 0 spikes + runner benchmarks. Throwaway by design.
fixtures/        MEI corpus (music-encoding/sample-encodings). Grows every
                 time a real-world file breaks something.
```

## Quickstart

```sh
npm install
npm run dev --workspace @battuta/editor   # open the printed URL
```

Spikes and benchmarks: see the reproduce block at the top of
[BENCHMARKS.md](BENCHMARKS.md).

## Native/Tauri notes

The Tauri shell lives in `apps/editor/src-tauri` (Tauri 2; needs
`libwebkit2gtk-4.1-dev` and Rust). To run it against the dev server:

```sh
npm run dev --workspace @battuta/editor   # serves on :5173
cd apps/editor/src-tauri && cargo run --release
```

Self-contained builds (`cargo build --release --features custom-protocol`
after `npm run build -w @battuta/editor`) currently show a blank webview on
WebKitGTK 2.52 — see the packaging note at the end of BENCHMARKS.md.

The native Verovio benchmark needs a
[verovio](https://github.com/rism-digital/verovio) checkout built with
`cmake -B build -S cmake -DBUILD_AS_LIBRARY=ON -DCMAKE_BUILD_TYPE=Release`.
