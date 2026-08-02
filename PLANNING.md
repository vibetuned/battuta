# PLANNING.md — MEI Score Editor

Each phase ends in something usable day-to-day; nothing in a later phase is required for an earlier phase to be useful. Phase estimates assume solo development with heavy Claude Code assistance and reuse of midi-stroke's Verovio/Pixi/Tone experience. Exit criteria are the gate for moving on — resist starting the next phase before they hold.

## Phase 0 — Skeleton and spike (≈1 week)

Set up the Tauri + Vite + TypeScript + React workspace with the core as a separate package (`packages/core`, zero DOM imports, enforced by lint). Spike the two riskiest assumptions before committing to the architecture: (a) render a single measure slice through Verovio by synthesizing `scoreDef` + one measure, and confirm the output SVG carries the source `xml:id`s; (b) measure Verovio render time for a slice vs. a full document on a real 200+ measure file from the sound2midi pipeline, to validate that tiling is worth it and to set the performance budget with data rather than belief.

Exit criteria: a window opens, loads an MEI file, renders one measure tile, and logs timing numbers for slice vs. full render.

## Phase 1 — Read-only tiled viewer (≈2–3 weeks)

Build the real pipeline with no editing: MEI → core tree (with id generation, effective-context resolver for clef/key/meter per measure/staff) → tile synthesis → Verovio render → tile cache → flow layout of tiles into rows → virtualized scrolling. Add the page view (full Verovio layout, `select()` windowing for large files) and a toggle between views. Click a note in either view and it highlights via id; this proves the id plumbing end to end.

The context resolver gets its test suite now — clef changes mid-piece, key changes, meter changes, transposing staves — because every later phase leans on it.

Exit criteria: open any MEI file from the existing pipelines and from mei-friend samples; scroll a 500-measure score smoothly; clicking notation highlights the corresponding element; context-resolver tests green.

## Phase 2 — Selection, caret, and the command engine (≈3 weeks)

Implement event selection (click, shift-click, shift-arrow) and block selection (measure-range × staff-range, via drag or keyboard), both stored as model ranges. Implement the caret with model coordinates and keyboard navigation (left/right through events, staff/layer switching). Build the command engine: command objects with apply/revert, dirty-region reporting wired to tile invalidation, undo/redo stack. Ship the first real edits to exercise the whole loop: transpose selection by step/octave (the pitch-only fast path), toggle accidental, delete-events-to-rests.

Exit criteria: arrow-key navigation feels like a text editor; transposing a selection updates only its tiles within the latency budget; undo/redo is reliable under property-based tests (random command sequences, then full unwind, yields a byte-identical document).

## Phase 3 — Copy/paste and arranging (≈3–4 weeks)

This phase is the reason the project exists. Serialize selections to MEI clipboard fragments with context metadata. Implement the three paste policies (replace-measures, splice-at-caret, overlay-as-new-layer) with the duration validator gating every commit. Add multi-document support (tabs or split view) and cross-file block paste with the meter/key compatibility pass. Add structural measure commands: insert/delete measures, split/merge, duplicate measure range.

Exit criteria: the target workflow works start to finish — open two files, block-select four measures of one staff in file A, paste into a different staff in file B, transpose, save, and the result opens correctly in Verovio and mei-friend.

## Phase 4 — Note entry and MEI round-trip hardening (≈2–3 weeks)

Keyboard note entry at the caret (pitch letters or MIDI input via Web MIDI, duration keys, chord building, rests, ties, tuplets — reusing midi-stroke's input handling where it fits). Dotted rhythms, articulations, basic dynamics. In parallel, harden serialization: preserve-unknown-verbatim round-trip tests over a corpus of third-party MEI files, id stability across save/load, and file-watching so external edits (e.g. from a text editor) reload cleanly.

Exit criteria: transcribe a short passage from scratch by keyboard/MIDI without touching raw XML; corpus round-trip suite green.

## Phase 5 — Reference layers for transcription (≈2–3 weeks)

Import MIDI (and a JSON sidecar format emitted by sound2midi) as reference tracks. Per-tile timemap extraction, ghost piano-roll rendering on the overlay aligned to the tile's clef-based pitch axis, per-track solo/mute/color, beat-aligned by default with an optional section offset map. Add selection playback via timemap → Tone.js so an edit can be auditioned instantly against the reference audio grid.

Exit criteria: load a stems MIDI behind its exported MEI, visually spot a transcription error from the ghost layer, fix it with the editor, and hear the corrected measure.

## Phase 6 — OMR correction mode (≈2–3 weeks)

Facsimile support: parse `<facsimile>`/`<zone>` (and a sidecar JSON alternative for pipelines that don't emit MEI zones), display the source-image strip above each tile, click-through between scan region and notation. Confidence sidecar ingestion, heat tinting, and next-flagged-element navigation. Annotation write-back for corrections so the pipeline can harvest training data.

Exit criteria: correct a real OMR output measure-by-measure using scan strips and flag navigation, measurably faster than doing it in mei-friend.

## Phase 7 — Polish and release (ongoing)

Preferences, keymap customization, session restore, crash-safe autosave (command log replay), MusicXML import via Verovio's converter, export (MEI, MusicXML, per-page SVG/PDF via Verovio), packaging for Linux/macOS/Windows through Tauri, docs and sample corpus. Only after real usage: evaluate whether the core's hot paths (context hashing, duration arithmetic, fragment splicing) justify the Rust/WASM rewrite behind the existing interface.

## Cross-cutting practices

Testing leans on properties, not just examples: every command must satisfy apply-then-revert identity; every paste must satisfy the duration invariant; every save must satisfy round-trip stability on the corpus. Performance numbers (tile render p50/p95, edit latency) are logged in dev builds from Phase 1 so regressions are visible immediately. MEI corpus files live in the repo under `fixtures/` and grow every time a real-world file breaks something. Verovio is pinned per release and upgraded deliberately, with the corpus suite as the gate.

## Deliberately deferred

Lyrics and figured bass editing; percussion-map editing UI; part extraction and transposed part views; engraving option panels beyond a small curated set; plugin system; collaborative editing; any form of custom notation drawing (permanently out, per DESIGN.md).
