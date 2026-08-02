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

Phase 2 in progress (2026-08-02): caret, selection, command engine.

- `@battuta/core`: event index (chords are events, beams/tuplets are
  transparent), caret navigation (left/right across measures, staff
  up/down), event ranges for shift-selection; command engine with
  apply/revert + dirty-region reporting, undo/redo stack; first edits:
  transpose by step/octave, toggle accidental, delete-to-rests.
  40 tests including fast-check properties: random command sequences —
  with interleaved undo/redo — fully unwound restore the document
  byte-identically (run against real corpus files).
- Editor: click/keyboard caret (blinking bar projected from model position),
  shift-click / shift-arrow selection, keymap (see in-app hint line),
  edit-latency HUD. Dirty tiles re-render via cache-key change alone:
  measured 19 ms edit→screen with exactly 1 tile re-rendered; undo/redo hit
  the tile cache (~4 ms). Verify: `node spikes/verify-phase2.mjs` (16 checks).
- Still open in Phase 2: block selection (measure-range × staff-range) —
  model + drag UI; lands with its consumer (Phase 3 copy/paste).

Phase 3 in progress (2026-08-02): copy/paste and arranging — the reason the
project exists.

- Edit view renders **bare tiles**: clef, key signature, meter, and
  staff-group brackets are hidden (their values stay in force for pitch
  spelling and staff positions). Symbols appear only on the first measure;
  clef/keysig/meter are each re-drawn only on the tile where they *change*.
  Done with MEI visibility attributes (`clef.visible`, `keysig.visible`,
  `meter.form="invis"`, `system.leftline`), not CSS — Verovio reclaims the
  space, so bare tiles are also narrower.
- Tiles join into a **continuous system**: zero side margins, near-linear
  duration spacing (`spacingLinear: 0.03`, `spacingNonLinear: 1.0`) so equal
  durations get equal widths across tiles. Display zoom is a fixed,
  user-selectable factor (header control, per document) — staff size is
  constant across documents and a big ensemble is simply taller, like a real
  score; zoom is never derived from tile height (lesson learned: deriving it
  shrank orchestral staves). Verovio's per-tile measure numbers are
  suppressed (each tile is a "system start").
- **Row layout like a real score**: the editor owns the flow layout (greedy
  fill by rendered tile widths). Each row starts with a synthesized
  **system-start header** (clef + key signature + brackets over an invisible
  measure, cached by context); tiles themselves draw only *changes* plus the
  opening meter. Every tile displays in a uniform box with its **top staff
  line pinned to a shared baseline** (max extents above/below the staff over
  the document — ledger lines, lyrics, fermatas included).
- Known limitation, noted for later: Verovio adapts **inter-staff** spacing
  per tile (lyrics between staves), so lower staves can wobble a few px
  between neighbors; `spacingStaff` is only a minimum and cannot force it.
  The complete fix is **rows-as-single-slices** — render each row as one
  multi-measure Verovio system (DESIGN.md's measure-window idea), which
  makes all internal spacing consistent by construction at the cost of
  row-level (instead of measure-level) re-render on edit (~15–60 ms, still
  within budget). Revisit when polishing the edit view.
- `@battuta/core`: exact-rational **duration model** (dots, tuplets, mRest,
  grace, meter capacity) powering the paste validator; **block selection**
  (measure-range × staff-range) and **clipboard fragments** (plain data +
  readable MEI text for the system clipboard); `planPasteReplace` returns
  typed refusals/warnings; `PasteReplaceMeasuresCommand` (replace-measures
  policy) plus insert/delete/duplicate-measures commands. 54 tests; the
  property suite fuzzes paste + structural commands against the corpus and
  asserts byte-identical unwind AND the duration invariant after every step.
- Editor: document **tabs** with a shared clipboard, **drag block selection**
  across tiles/staves, ctrl+c/ctrl+v (paste refusals surface the validator's
  reason; warnings ask), structural buttons (+m/−m/⧉m), save-to-MEI download.
- E2E (`node spikes/verify-phase3.mjs`): the target workflow start to
  finish — block-copy chorale measures, paste into another document's other
  staff, validator refuses a short measure into a full one, save, and the
  exported file re-parses with zero duration problems and renders in a fresh
  Verovio toolkit.
- Still open in Phase 3: splice-at-caret and overlay-as-new-layer paste
  policies; split/merge measure commands; side-by-side split view.

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
