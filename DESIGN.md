# DESIGN.md — MEI Score Editor

## Vision

A local-first editor for MEI scores that treats notation the way a text editor treats text: a semantic document you navigate with a caret, select in ranges, and manipulate with copy/paste and keyboard commands. It is explicitly **not** an engraver — Verovio does all notation rendering — and explicitly not a "restricted SVG editor" in the MuseScore sense, where the visual layout is the thing you manipulate.

The editor serves three workflows, in priority order:

1. **Arranging** — mixing material measure-by-measure across staves and across files: select measures 5–8 of the sax staff in file A, paste them into the piano right hand of file B, transpose, adjust.
2. **Transcription correction (AMT)** — cleaning up MEI files produced by audio-to-MIDI pipelines (e.g. sound2midi exports), with the raw transcription visible as ghost piano-roll layers behind the score for reference.
3. **OMR correction and annotation** — fixing MEI produced by optical music recognition, with the source scan image displayed per measure via MEI facsimile zones, and navigation driven by model confidence scores.

The unifying idea: the MEI document is the single source of truth; everything on screen is a projection of it; every edit is a reversible command against it.

## Non-goals

The project does not implement music layout (spacing, beaming, collision avoidance, page breaks) — that is Verovio's job, always. It does not aim for full MEI coverage on day one; it targets Common Western Music Notation as produced by Verovio-compatible tools, and unknown MEI elements are preserved verbatim on round-trip rather than understood. It is not a playback/DAW tool; playback is a utility (audition what you edited), not a product pillar. It is not a web service — it is a local desktop application, though the core must remain runnable in a browser context since everything is web technology.

## Architecture overview

The system has four layers with strict one-way knowledge: the UI knows the view model, the view model knows the document, the document knows nothing above it.

**Document core.** An in-memory tree parsed from MEI, holding the semantic structure the editor understands (score structure, scoreDef/staffDef context, measures, staves, layers, events: notes, rests, chords, tuplets, plus control events like slurs, ties, dynamics, dirs) and opaque preserved subtrees for everything else. Every element keeps its `xml:id` (generated on import if missing) — ids are the universal currency of the whole system. The core exposes queries (effective clef/key/meter at any measure/staff, duration sums per layer, element lookup by id) and mutations exclusively through the command layer. The core is pure logic with no I/O and no DOM dependency, so it can later be extracted as a standalone library (batch pipelines, headless CLI, or a Rust/WASM rewrite behind the same interface).

**Command layer.** Every mutation is a command object with `apply()` and `revert()` against the document, e.g. `InsertNote`, `DeleteRange`, `PasteFragment`, `TransposeSelection`, `SplitMeasure`, `ChangeKeySig`. Commands report the set of *dirtied regions* (measure × staff-context) they touched, which drives rendering invalidation. Undo/redo is a stack of command groups (a paste that also retimes neighbors is one undo step). Clipboard content is a serialized MEI fragment plus metadata (source staff context, duration total), so copy/paste works across editor instances and even into a text editor as readable MEI.

**Render layer (Verovio, two modes).**

*Edit view — tiled.* Each measure-window (one measure, or a small horizontal window of measures per system row) is rendered by Verovio as an independent SVG tile from a synthesized slice: the effective `scoreDef`/`staffDef` context at that point plus the measure content. Tiles are cached with the key `(hash of measure content, hash of effective staff context)`. An edit re-renders only the tiles whose key changed; a key-signature or clef change naturally invalidates all downstream tiles because their context hash changes — no special-case logic. The editor performs its own flow layout of tiles into rows (like line-wrapping glyphs), giving O(1) edit latency and trivial virtualization for very large scores. Known cosmetic costs, accepted by design: spacing is locally rather than globally justified, and cross-tile slurs/ties render as broken continuations (the same visual convention as system breaks, occurring more often).

*Page view — full Verovio layout.* For proofreading and export fidelity, the same document is rendered through Verovio's normal paged layout (optionally windowed via Verovio's `select()` by measure range for large scores). Selection and caret state carry over between views because both are expressed in ids and model coordinates, never pixels.

**Interaction layer.** Rendering is read-only; all interaction happens on an overlay above the tiles. Verovio preserves `xml:id` on output SVG elements, so hit-testing is: pointer event → nearest ancestor with an id → document element. The overlay draws the caret, selection highlights, ghost layers, and facsimile strips; it holds all event handlers. The SVG itself is never mutated except for class toggles on highlighted ids.

## The editing model

**Caret.** Caret position is model state, not pixel state: `(measure, staff, layer, event index | gap position)`. Left/Right move through events in the layer (crossing measure boundaries transparently); Up/Down in navigation mode move between staves/layers, and in pitch mode transpose the event under the caret by step; dedicated keys handle octave jumps, duration changes, accidentals. The caret is drawn by projecting model position onto the bounding box of the corresponding SVG element in its tile.

**Selection.** Two selection kinds, both stored as model ranges plus a resolved id-set:

*Event selection* — an ordered set of events within one layer (click, shift-click, shift-arrows). Used for transposition, duration edits, articulation edits.

*Block selection* — a rectangle in the (measure-range × staff-range) grid, the primary tool for arranging. A block resolves to per-staff MEI fragments. This is the "cell range" model: measures are rows of a table, staves are columns, and arranging is spreadsheet-like block manipulation.

**Copy/paste and rhythmic integrity.** MEI layers must sum to the measure's notated duration, so paste is duration-aware by construction. Pasting a block over an equal-shaped block replaces layer contents one-to-one. Pasting into a mismatched target follows explicit, user-visible policies: *replace-measures* (target measures' layer content is replaced wholesale; the default for arranging), *splice-at-caret* (insert events and push/truncate the remainder to fit, filling gaps with rests), or *overlay-as-new-layer* (add a second `<layer>` in the target staff). Every paste result is validated by the core's duration checker before the command commits; a paste that cannot be made valid under the chosen policy fails loudly rather than producing corrupt MEI.

**Cross-file arranging.** Multiple documents open in tabs or split view; the clipboard is shared; block-paste across documents goes through a compatibility pass (meter mismatch → warn and offer replace-measures with retiming disabled; key mismatch → offer written-pitch paste or transposed paste). This is the workflow the project exists for, so it is exercised from Phase 3 onward, not bolted on at the end.

## Reference layers (ghost pitches behind the score)

For transcription work, the editor displays non-notation pitch data time-aligned behind the notation: the raw MIDI stems from a sound2midi export, or another instrument's line for context while transcribing a new part.

Mechanism: Verovio's timemap (`renderToTimemap` / per-tile equivalent) gives score-time → x-coordinate mapping inside each tile. A reference layer is a set of `(onset, offset, pitch, velocity, track)` events (imported from MIDI or JSON); per tile, events overlapping the tile's time span are drawn on the overlay canvas as translucent piano-roll bars, with pitch mapped to staff-line space using the tile's effective clef (so a G4 bar sits on the G4 staff position — the ghost layer and the notation share a vertical pitch axis, which is what makes visual comparison instant). Layers are per-track toggleable with the same solo/mute/color affordances as the sound2midi player. Alignment between reference time and score time is by beat position by default, with an optional per-section offset/tempo map for material that was transcribed freely.

## OMR support (facsimile)

MEI's `<facsimile>`/`<zone>` mechanism links elements to pixel regions of source images via `@facs`. When a document carries zones (or a sidecar JSON from the OMR pipeline provides them), the edit view shows the source image strip for each measure directly above its tile — scan on top, rendering below, correction in between. A confidence sidecar (per-element scores from the OMR/AMT model) drives triage: elements below threshold get a heat tint on the overlay, and a "next flagged" key binding jumps the caret through them in reading order. The editor can also write annotations back (`<annot>` or attribute-level flags) so corrections feed training data for the upstream models.

## Technology decisions

**Language: TypeScript for the application, with the document core behind a strict interface.** The rendering target (SVG), the interaction surface (DOM/canvas overlay), Verovio's first-class bindings, and the author's existing codebase (React + Pixi + Verovio in midi-stroke) are all web-native; TS is the shortest path to a working editor. The document core and command engine are written with no DOM or framework imports and a narrow, serializable API, which keeps the door open to reimplementing that core in Rust/WASM later if profiling or reuse in AI pipelines justifies it. Rust is a deliberate *deferral*, not a rejection.

**Shell: Tauri.** Local-first file access, small binaries, native menus/dialogs, and the frontend remains a plain web app that also runs in a browser for development and demos.

**Rendering: verovio (WASM npm package) + SVG tiles in the DOM + a canvas/Pixi overlay** for ghost layers, selection, and caret (reusing rendering experience from midi-stroke). Plain DOM SVG for tiles keeps id-based hit-testing trivial; the overlay is canvas because ghost layers can be thousands of bars.

**Playback: Verovio timemap → Tone.js**, reusing midi-stroke's audio approach. Playback of the current selection or measure window is the primary use (audition an edit), not full-score performance.

**MEI handling: DOM/XML parse into the core's own tree** (fast native `DOMParser` in the renderer; `fast-xml-parser` or similar in headless contexts), serialization that round-trips unknown content byte-stably where possible. MEI version target: whatever current Verovio consumes (MEI 5.x), validated in CI against sample corpora from the OMR/AMT pipelines and from mei-friend's examples.

## Performance budget

Editing latency (keystroke → updated tile on screen) target under 50 ms for typical measures, under 100 ms worst case; achieved by tile-scoped Verovio renders, cache reuse, and rendering dirtied tiles off the interaction path. Opening a 500-measure, 20-staff score should show the first screen in under 1 s (render only visible tiles; hydrate the rest lazily). Undo/redo is model-only plus tile swap, so effectively instant. The full-page proofreading view is allowed to be slow-ish for huge scores; it uses Verovio `select()` windowing when needed.

## Risks and mitigations

The main technical risk is tile-context correctness: a measure rendered in isolation must receive the exact effective `scoreDef`/`staffDef` (clef, key, meter, transposition, staff lines, ongoing octave displacement) or it renders wrong pitches convincingly. Mitigation: the context resolver lives in the core with exhaustive tests, and the cache key includes the context hash so stale context cannot be displayed. Second risk: control events spanning tiles (slurs, hairpins, pedal) need consistent splitting; mitigation is to normalize them into per-tile segments at slice-synthesis time, with the page view as the ground truth for how they should ultimately look. Third risk: MEI round-trip fidelity for files from diverse tools; mitigation is preserve-unknown-verbatim plus a growing corpus test suite. The scope risk — drifting into engraving — is handled by policy: any rendering complaint is either fixed by changing the MEI/Verovio options or explicitly accepted; the project never draws notation.
