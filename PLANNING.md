# PLANNING.md — MEI Score Editor

Each phase ends in something usable day-to-day; nothing in a later phase is required for an earlier phase to be useful. Phase estimates assume solo development with heavy Claude Code assistance and reuse of midi-stroke's Verovio/Pixi/Tone experience. Exit criteria are the gate for moving on — resist starting the next phase before they hold.

> **Phases 0–5 are complete and released as 0.0.1 (2026-08-08).** Their
> plans, exit criteria, and progress notes moved to
> [CHANGELOG.md](CHANGELOG.md). Still open from those phases:
> splice-at-caret and overlay-as-new-layer paste policies, split view,
> file watching for external edits, session restore, crash-safe
> autosave, MusicXML import/export, and the possible Rust/WASM core
> rewrite — all fold into the phases below or future point releases.

## Phase 6 — Reference layers for transcription (≈2–3 weeks)

Import MIDI (and a JSON sidecar format emitted by sound2midi) as reference tracks. Per-tile timemap extraction, ghost piano-roll rendering on the overlay aligned to the tile's clef-based pitch axis, per-track solo/mute/color, beat-aligned by default with an optional section offset map. Add selection playback via timemap → Tone.js so an edit can be auditioned instantly against the reference audio grid.

Exit criteria: load a stems MIDI behind its exported MEI, visually spot a transcription error from the ghost layer, fix it with the editor, and hear the corrected measure.

## Phase 7 — OMR correction mode (≈2–3 weeks)

Facsimile support: parse `<facsimile>`/`<zone>` (and a sidecar JSON alternative for pipelines that don't emit MEI zones), display the source-image strip above each tile, click-through between scan region and notation. Confidence sidecar ingestion, heat tinting, and next-flagged-element navigation. Annotation write-back for corrections so the pipeline can harvest training data.

Exit criteria: correct a real OMR output measure-by-measure using scan strips and flag navigation, measurably faster than doing it in mei-friend.

## Cross-cutting practices

Testing leans on properties, not just examples: every command must satisfy apply-then-revert identity; every paste must satisfy the duration invariant; every save must satisfy round-trip stability on the corpus. Performance numbers (tile render p50/p95, edit latency) are logged in dev builds from Phase 1 so regressions are visible immediately. MEI corpus files live in the repo under `fixtures/` and grow every time a real-world file breaks something. Verovio is pinned per release and upgraded deliberately, with the corpus suite as the gate.

## Deliberately deferred

Lyrics and figured bass editing; percussion-map editing UI; part extraction and transposed part views; engraving option panels beyond a small curated set; plugin system; collaborative editing; any form of custom notation drawing (permanently out, per DESIGN.md).
