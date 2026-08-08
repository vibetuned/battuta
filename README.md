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
- **Uniform inter-staff spacing via two-pass feedback, per row**: pass 1
  renders tiles unforced and parses the inter-staff gap their content needs
  (lyrics push staves apart) plus the real ink extent above the top staff
  line; pass 2 re-renders each row with the row's max need forced as
  Verovio's `spacingStaff` (a minimum, so the max of all needs is reachable
  by all). Row box heights hug their own content — a lyric-free row stays
  compact. `spacingStaff` also pads above the *first* staff, so tiles pin
  to the intrinsic ink extent and crop the padding. Staff lines verified
  pixel-identical across each row. Chosen over rendering whole rows as
  single slices, which would have made structural edits, row sizing, and
  per-measure drag-and-drop harder.
- Tabs have close buttons; zoom is per-document.
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
  reason; warnings ask), structural buttons (+m/−m/⧉m, also on numpad +/−/*), save-to-MEI download.
- E2E (`node spikes/verify-phase3.mjs`): the target workflow start to
  finish — block-copy chorale measures, paste into another document's other
  staff, validator refuses a short measure into a full one, save, and the
  exported file re-parses with zero duration problems and renders in a fresh
  Verovio toolkit.
- Still open in Phase 3: splice-at-caret and overlay-as-new-layer paste
  policies; split/merge measure commands; side-by-side split view.

Phase 4 in progress (2026-08-02): note entry + round-trip hardening.

- **Note input mode** (`i` to toggle): overwrite-mode entry that is
  duration-invariant by construction — equal swaps in place, shorter fills
  the remainder with rests, longer consumes following events (refusing
  loudly at beam/tuplet/measure boundaries); a–g pitches with
  nearest-octave guessing, shift+A–G chord building, `r` rests, 7..1
  durations (5 = quarter), `.` dot, s/v/n accidentals, `t` tie (back to the
  predecessor — across the barline when the note opens the measure; works
  outside input mode too, on the caret note; pitch-checked), `,` staccato, `;`/`!` accent, and `p` cycling
  dynamics (none → p → mp → mf → f → none). **Web MIDI is a first-class input**: in
  input mode, note-ons enter at the caret, keys held together build chords
  (note-off tracking), devices hot-plug via `onstatechange`, the HUD shows
  what is connected, and a note played outside input mode hints at pressing
  `i`. **Keyboard-layout independent**: duration
  digits also match by physical key position (`e.code`), so AZERTY's
  unshifted number row works without Shift; the dot is `.` or `:` (both
  character-based — `:` is unshifted on AZERTY), accent is `;` — no physical
  key serves two different actions on any layout. The dot always applies to
  a real event — the just-entered note, or the note/rest at the caret (in
  or out of input mode) — re-entered in place with the duration difference
  consumed from / released to the following rests; subsequent entries
  inherit the resulting dot state (no separate prospective toggle).
  **Web MIDI** note-on enters at the caret while in input mode.
- **Round-trip hardening**: the session now keeps the FULL document tree —
  `meiHead`, unknown elements/attributes, comments, `<?xml-model?>` PIs —
  and save serializes all of it. Corpus tests prove serialization is a
  fixpoint, no content is lost across cycles, and a reloaded save needs
  zero new ids. Compatibility note: Verovio rejects comments before the
  root element (PIs are fine), so prologue comments are preserved by moving
  them just inside `<mei>`.
- 161 core tests; the property fuzzer covers the whole command pool (a
  stale modulo had silenced part of it) and promptly caught a real bug:
  measures inserted or duplicated at a mid-piece context change landed
  AFTER the interleaved def, adopting the next section's meter — a
  duplicated 4/4 measure inside a fresh 7/8 region. Structural inserts now
  stay in their source region (defs bind to the measure they precede);
  `node spikes/verify-phase4.mjs` covers the exit criterion: transcribe a
  passage from scratch by keyboard, no XML touched, durations always valid.
- **Merge/split** (`m` / `x`): merge the caret event with the next — same
  pitch (or both rests / identical chord pitch-sets), adjacent in the same
  container, sum expressible as one written duration (quarter+eighth →
  dotted quarter; half+eighth → refused) — keeps the first event's id and
  dissolves the inner tie pair. Split halves any note/rest/chord in place
  (dur×2, dots preserved: dotted half → two dotted quarters), ties
  redistributed. Whole-measure rests participate too: `x` splits an mRest
  into two half-capacity rest runs (meter-aware — 6/8 gives two dotted
  quarters), and merging rests back up to the full measure collapses them
  into an mRest — so the shortcuts work in freshly inserted measures. Backspace erases the *previous* note and steps back
  (text-editor semantics); Delete stays at the caret.
- **Context editing** (clef… / key… / meter… header dropdowns): change or
  add a clef, key signature, or meter at the caret's measure, MEI-natively.
  At measure 1 the initial `scoreDef`/`staffDef` attributes are edited in
  place (conflicting child elements and per-staff overrides removed);
  mid-piece an interleaved `scoreDef` (key/meter, score-wide) or
  `staffDef n` (clef, staff-local) is inserted before the measure — or
  merged into one already sitting there, so repeated changes never stack
  defs. Meter changes are validated against every measure up to the next
  meter change and refused naming the first measure that no longer fits;
  whole-measure rests always fit, so preparing empty sections works freely.
  Downstream tiles re-render (context propagates), and the changed-context
  header policy makes the new key/meter visible exactly where it changes.
  One undo step each.
- **Cross-measure slurs** (`S`): select notes with shift+click/shift+arrows
  (any number of measures apart) — or just place the caret to slur to the
  next event — and press `S`; the same pair again removes it. The `<slur>`
  control event lives in the START measure of the real MEI document (no
  shadow state, save stays a plain serialize): per-measure tiles render it
  through the existing span segmentation — the start tile draws an outgoing
  curve to the slice edge, the end tile an incoming stub, and measures the
  curve merely passes over stay untouched. Staff-local, one undo step,
  fully covered by the property fuzzer. (Verovio occasionally draws an
  exuberant curve on a continuation stub — cosmetic, upstream.)
- **Chord accidentals are per-note**: pressing s/v/n (or s/f/n outside
  input mode) on a chord no longer sharps every note — a small picker pops
  up at the chord listing its notes (`1:c4 2:e4 3:g4`); press the note's
  letter or number to apply the accidental to just that note, esc to
  cancel. One undo step. (MIDI entry is untouched — it knows exact
  pitches.) Chord children aren't indexed events, so this rides a
  dedicated `ChordNoteAccidentalCommand` anchored on the chord's id.
- **Multi-measure ties** (`t` on a selection): a note held across measures
  is a chain of ties, so selecting the same-pitch run and pressing `t`
  ties every consecutive pair in one undo step, with proper MEI `@tie`
  values (`i`/`m`/`t`, merging with ties that continue past the run's
  edges); the same selection unties it. Refuses loudly on pitch changes or
  gaps. Rendering fix underneath: Verovio *skips* an unmatched `@tie` half
  in an isolated slice, so boundary-crossing ties never drew their curves
  on either tile — the segmenter now injects explicit `<tie>` continuation
  stubs for edge notes (incoming and outgoing), which also fixes the
  plain cross-barline `t` tie from note entry.
- Still open in Phase 4: tuplet entry; file-watching for external edits
  (needs the Tauri shell or the File System Access API).

Phase 5 in progress (2026-08-05): polish.

- **Status bar** (VSCode-style, bottom): `INPUT (i)` toggles note input on
  click and becomes `1/8 ♪ (4)` while active — current duration, its
  glyph (dot included), and the digit key that selects it, updating live;
  the clef / key / meter selects live here too and always display the
  **context in force at the caret** (clef per staff — stepping onto a
  tenor-clef staff flips the indicator; key and meter score-wide), with
  picking a value still applying the change at the caret's measure;
  `MIDI ><` flips to a green `MIDI <>` with a device count when
  controllers are present (hot-plug aware) and clicking it lists the
  connected devices. A **staves select** sits beside the context ones,
  showing the staff count: *add staff below* appends a treble staffDef and
  an mRest staff to every measure (valid under any meter by construction);
  *remove caret staff* takes out the caret's staff everywhere — its
  staffDef, mid-piece staffDefs, and staff-anchored control events — one
  undo step each, last staff refused.
- **Fingering** (`alt+1..5`): sets the fingering on the target note or
  chord — rendered by Verovio as a small digit above the staff (`<fing>`
  control events; the same number again removes it, a different one
  replaces it). `alt+shift+1..5` stacks additional fingers (chords,
  substitutions) and removes exactly that number if present. Same target
  rule as the dot — the just-entered note in input mode, else the caret
  note — and matched by physical key, so AZERTY's shifted digit row works
  identically. One undo step each. (`<fingGrp>` is unsupported by Verovio,
  so plural fingering = several stacked `<fing>` elements.)
- **Auto-beam** (`alt+b`): groups the caret measure's eighth-and-shorter
  notes into beams — every measure the selection touches with one press —
  with the longest beam spanning **half the measure regardless of meter**
  (onset decides the half; rests and longer notes break groups; runs of
  one stay unbeamed). Idempotent: existing beams are lifted and regrouped.
  The other half of the policy: **beams are formatting, and rhythm edits
  dissolve them** — entry, duration changes, merge/split, and
  delete-to-rests unbeam their measure *first* (so overwrite entry never
  refuses at a beam boundary) and no broken beams survive; re-beam with
  `alt+b` once the rhythm settles. All one-undo-step, byte-identical
  unwind (the un/re-beam travels with the edit).
- **Single markings** (tester round): **marcato** = the accent key
  shifted (`shift+;` — on AZERTY that's `.`, so the dot keeps its
  unshifted forms `.`/`:` and gains nothing new to learn); **staccatissimo**
  = the staccato key shifted (`<` / AZERTY `?`); **double sharp** = `S`
  with no selection (with a selection `S` is still the slur; on chords it
  opens the per-note picker with 𝄪); **fermata** = `h`; **coda** = `o`
  (MEI `repeatMark func="coda"`); and `w` **circles the four ornaments**
  — arpeggio (chords) → tremolo (`bTrem` wrap) → trill → mordent → off.
  All follow the dot's target rule (just-entered note in input mode, else
  the caret), toggle on repeat, one undo step each. The `o` key cycles the
  full **repeat-mark family: coda → segno → fine → dal segno → da capo →
  off** (all `repeatMark`s).
- **Simile and measure repeats** (the physical `ù`/`'` key): unshifted
  replaces **one beat** at the target with the simile slash (`<beatRpt/>`,
  consuming sub-beat events exactly like overwrite entry, refusing at
  boundaries; the slash toggles back to a beat rest); shifted (`%` on
  AZERTY, `"` on QWERTY) cycles the caret measure's voice through
  **content → `%` (mRpt) → `%%` (mRpt2, claiming the next measure) →
  empty** — the original content returns via undo. The duration model
  knows all three: measure repeats fill their measure, the beat repeat
  counts as an unresolved beat.
- **Block-selection feedback round**: with two selected notes of
  *different* pitches, `m` cycles the first into a **grace note** —
  acciaccatura (slashed) → appoggiatura → none — folding its written time
  into the main note like a merge and giving it back on the way out
  (same-pitch pairs still merge); `P` toggles a **pedal** line over the
  selection (down at the first note, up at the last); and `shift+1..9` on a
  block toggles that **volta number** on the bracket — numbers build up
  into mixes like `[1, 2][3]` (one `<ending n="1, 2">`, one `n="3"`),
  removing the last number removes the bracket, and ranges crossing an
  existing ending are refused. Closing **barlines renormalize across the
  bracket group**: every bracket with a later sibling ends with a repeat
  barline, the last with a double barline — unless it closes the score,
  whose final barline is left alone. Per-measure tiles draw their bracket
  segment, and page view shows the true spanning bracket — its serializer
  now keeps structural containers instead of flattening measures into a
  bare section.
- **Multiple voices** (per staff, per measure): a *voices* dropdown in
  the status bar shows the caret's voice, switches between the staff's
  voices, and *add a voice* puts a new layer (whole-measure rests) into
  that staff **from the caret's measure onward** — like clef/key/meter
  changes; at m1 that means the whole score. Mid-piece additions draw
  the engraver's **double barline** at the boundary (existing special
  barlines are left alone). *Remove this voice* takes it out from the
  caret's measure on, with its anchored control events; a staff's last
  voice is refused. Note entry works in any voice exactly like voice 1
  (Verovio stems voice 1 up, voice 2 down). **Voice colors**: where a
  staff has more than one voice, voice 1 turns blue and voice 2 violet
  (3 amber, 4 magenta) — zero-specificity CSS driven by Verovio's
  `data-n`, so the caret/selection colors always win. Plain ↑/↓ traverse
  voices before staves and continue onto the next/previous **line** when
  the measure's slots run out (text-editor rows: entering at the top slot
  going down, the bottom slot coming up, nearest note under the caret's
  x); ←/→ stop at a voice's start and end (no jumping
  across measures the voice doesn't reach), and inserted measures mirror
  every voice of their neighbor. All single undo steps, byte-identical
  revert.
- **Repeats** (`r` on a block selection): wraps the selected measures in
  repeat barlines (`@left="rptstart"` / `@right="rptend"` — the bis);
  the same block again removes them, and undo restores any barline the
  repeat overwrote (double bars survive). In input mode `r` still enters
  rests.
- **Copy/paste carries control events**: fingering, dynamics, hairpins,
  and slurs whose anchors live inside the copied block travel with it —
  pasted with freshly remapped anchor ids and retargeted staff numbers;
  events reaching outside the block (half a hairpin) stay behind, and
  control events attached to the *replaced* region are cleaned up rather
  than left dangling. Paste also normalizes measure `@n` like the
  structural ops, so stale numbering from older saves heals on the first
  paste. Byte-identical undo covers all of it.
- **Hairpins** (`p` with a selection): select a run of notes — across
  measures too — and `p` cycles a hairpin over it: none → crescendo →
  decrescendo → none (`<hairpin>` with startid/endid in the start
  measure, rendered across tile boundaries by the span segmentation).
  With no selection, `p` keeps cycling p/f dynamics on the note. One
  undo step per press.
- **Measure numbers stay sane**: insert/delete/duplicate renumber `@n`
  sequentially (page view prints it at every system start — this used to
  show compounding "4aaaa" template names). A surviving pickup keeps its
  0-based numbering; non-numeric editorial numbering is never touched;
  undo restores the original numbers exactly.
- **Tabs**: a `+` button opens a fresh blank score (one treble staff, 4/4,
  four empty measures, named untitled-1, -2, …) ready for note entry, and
  **open file…** loads any `.mei`/`.xml` from disk into a new tab named
  after the file. `node spikes/verify-phase5.mjs` (124 checks).

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
