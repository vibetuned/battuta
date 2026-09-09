# PLANNING.md — MEI Score Editor

Each phase ends in something usable day-to-day; nothing in a later phase is required for an earlier phase to be useful. Phase estimates assume solo development with heavy Claude Code assistance and reuse of midi-stroke's Verovio/Pixi/Tone experience. Exit criteria are the gate for moving on — resist starting the next phase before they hold.

> **Phases 0–5 are complete and released as 0.0.1 (2026-08-08); the
> 0.0.2 round (2026-08-30) added the score tempo, the on-screen
> keyboard, import/export of every Verovio-convertible format, session
> restore + close confirmation + the external-change guard, and the
> distribution pipeline (signed macOS builds, Homebrew tap, apt repo,
> winget).** Plans, exit criteria, and progress notes live in
> [CHANGELOG.md](CHANGELOG.md). Still open from those rounds:
> splice-at-caret and overlay-as-new-layer paste policies, split view,
> live (rather than save-time) file watching, MusicXML *export* (no
> Verovio support — needs another engine), and the possible Rust/WASM
> core rewrite — all fold into the phases below or future point
> releases.

## Phase 8 — Quality of life (v0.0.3, current)

**Decision (2026-09-05): phases 6 and 7 are deferred, not started.**
User requests arriving since the 0.0.2 release range from small
quality-of-life fixes to changes that cut deeper into the engine;
serving real users beats starting a research phase. This phase collects
and ships the small-to-medium ones as 0.0.3; requests that change the
engine deeply get their own phase entries here once triaged.

Request triage (grows as requests land; every decision is recorded in
CHANGELOG.md as always — S fits 0.0.3, M needs its own slot, L is a
phase):

- **S — 6/4 time signature** in the meter list. _(shipped)_
- **S — numpad 0 enters a rest** in input mode (numpad digits already
  set durations; 0 completes the row). _(shipped)_
- **S — changing a duration clears the dot** (alt+←/→ on a note, and
  the pending-entry digits 1–7 likewise). _(shipped)_
- **M — mouse-free context bar** _(shipped)_: F6 focuses the
  status bar, ←/→ move between the selects, ↑/↓ cycle values applying
  live (each step is an undoable command), esc returns to the score.
- **M — group/ungroup staves** _(shipped)_: one key
  (shift+G) on a block selection spanning staves cycles the group
  symbol none → brace → bracket; bar-through follows the symbol.
- **S — shell confirm dialogs** (dirty-close alert invisible in the
  Tauri build — window.confirm is a no-op in wry; all three confirm
  guards now use a native dialog in the shell). _(shipped)_
- **S — MIDI transpose** (±12 st select on MIDI sends and the
  playback-MIDI export; the sampler stays at written pitch). _(shipped)_
- **M — playback to MIDI devices** (checkbox in the player row: play
  sends to every connected MIDI output instead of the built-in piano;
  Web MIDI in browsers, a midir output bridge in the shell). _(shipped)_
- **M — lyrics entry** _(shipped)_: one verse,
  MuseScore-style typing in the harmony-lane mechanism — space/enter
  commits the syllable and advances to the next note, "-" commits with
  a continuation hyphen. Un-defers lyrics from the "deliberately
  deferred" list; multi-verse and melisma extenders stay deferred.

Exit criteria: the triaged S/M requests shipped as 0.0.3, each with
tests in the suites that guard its area, docs updated (user guide and,
for anything architectural, DESIGN.md), and the changelog carrying the
decision trail.

## Phase 6 — Reference layers for transcription (≈2–3 weeks, deferred)

Import MIDI (and a JSON sidecar format emitted by sound2midi) as reference tracks. Per-tile timemap extraction, ghost piano-roll rendering on the overlay aligned to the tile's clef-based pitch axis, per-track solo/mute/color, beat-aligned by default with an optional section offset map. Add selection playback via timemap → Tone.js so an edit can be auditioned instantly against the reference audio grid.

Exit criteria: load a stems MIDI behind its exported MEI, visually spot a transcription error from the ghost layer, fix it with the editor, and hear the corrected measure.

## Phase 7 — OMR correction mode (≈2–3 weeks, deferred)

Facsimile support: parse `<facsimile>`/`<zone>` (and a sidecar JSON alternative for pipelines that don't emit MEI zones), display the source-image strip above each tile, click-through between scan region and notation. Confidence sidecar ingestion, heat tinting, and next-flagged-element navigation. Annotation write-back for corrections so the pipeline can harvest training data.

Exit criteria: correct a real OMR output measure-by-measure using scan strips and flag navigation, measurably faster than doing it in mei-friend.

## Cross-cutting practices

Testing leans on properties, not just examples: every command must satisfy apply-then-revert identity; every paste must satisfy the duration invariant; every save must satisfy round-trip stability on the corpus. Performance numbers (tile render p50/p95, edit latency) are logged in dev builds from Phase 1 so regressions are visible immediately. MEI corpus files live in the repo under `fixtures/` and grow every time a real-world file breaks something. Verovio is pinned per release and upgraded deliberately, with the corpus suite as the gate.

## Deliberately deferred

Figured bass editing (lyrics un-deferred into Phase 8: one verse of
syllables; multi-verse and melisma extenders still deferred);
percussion-map editing UI; part extraction and transposed part views; engraving option panels beyond a small curated set; plugin system; collaborative editing; any form of custom notation drawing (permanently out, per DESIGN.md).
