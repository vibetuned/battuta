# Changelog

The phase-by-phase record of battuta, newest first: what each phase set
out to do (plan + exit criteria, moved here from
[PLANNING.md](PLANNING.md)) and what actually landed (moved here from the
README's old Status section). Remaining phases — reference layers, OMR
correction — stay in [PLANNING.md](PLANNING.md).

## Unreleased

- **Page-view score player** (▶ / ⏸ / ⏹ next to the view toggle):
  Verovio's timemap drives BOTH the audio and a moving note highlight
  from one timeline, so they cannot drift. Sound is Tone.js's Sampler
  over a self-hosted Salamander piano subset (~2 MB of mp3, every third
  semitone, embedded in the bundle — no CDN); sounding pitch per note id
  comes from `getMIDIValuesForElement` (Verovio resolves key signatures,
  measure accidentals, and ties), note lengths from the timemap's own
  on→off spans, so held/tied notes sound once for their full span. The
  view auto-scrolls when the playing measure leaves the viewport; any
  edit, tab switch, or view switch stops playback (the timemap is stale
  the moment the document changes). The shell smoke gained a probe that
  decodes a sample through WebKitGTK's gstreamer stack — verified on
  Linux.
- **Playback follows the form** (part 2): plain repeat barlines are
  auto-expanded by Verovio's timemap; voltas and one dal-segno/da-capo
  jump (with optional fine) are synthesized into an MEI `<expansion>`
  from battuta's own repeat knowledge (`buildExpansion` in core — pure,
  volta number-sets like [1,2][3] supported, loopback to `rptstart` when
  present else to the top, the recap takes only final endings; exotic
  forms fall back to unexpanded). Repeated passes play as `-rendN` id
  clones, and the highlight maps every clone back to its notated id via
  `renderToExpansionMap` — that mapping was the missing piece the first
  tester round spotted: audio repeated but the notes stopped lighting.
  Probed behaviors that shaped this: with an expansion active Verovio
  does NOT auto-expand plain repeats (the plist must encode everything),
  and `expansionMap[id][0]` is always the notated id.
- **To Coda** joins the `o` cycle (coda → **To Coda** → segno → fine →
  D.S. → D.C. → off). MEI has no separate func for it — both marks are
  `repeatMark func="coda"` — so the TEXT CONTENT is the encoding: bare
  renders Verovio's 𝄌 glyph (the destination), `>To Coda<` renders the
  text (the jump-out marker). Playback honors the pair: a D.S./D.C.
  recap that reaches the To Coda marker jumps to the 𝄌 sign ("al Coda");
  either mark alone stays decorative. Found & fixed underneath: the
  harmony lane's Tab→Enter could commit the PRE-completion buffer — the
  window key listener re-attaches after React effects, so a fast second
  key hit a stale closure; the handler now reads the buffer through a
  ref. (This was the wandering phase5 "flake" at the harm commit.)
- **Tie after tie fixed** (n_n_n): tying the second pair used to
  clobber the shared note's `tie="t"` with `"i"`, orphaning the first
  tie (Verovio drops unmatched halves — it vanished from the page and
  the sound). `ToggleTieCommand` is now chain-aware: the shared note
  becomes `@tie="m"`, and untoggling any link in a chain splits it into
  valid remainders (removing the middle of i-m-m-t leaves two ties).
  Render and playback merge follow automatically.
- **3/2** joins the meter select (common in practice scores). On
  non-empty measures the exact-fit validator still refuses with
  "adjust it first" — by design; set the meter before entering, or on
  whole-measure rests, and it applies freely.
- **The view follows the caret**: when keyboard navigation or note
  entry pushes the caret off-screen, the edit view scrolls it back
  (centered, smooth) — only on real caret moves, never on re-layout or
  zoom ticks, with margins clearing the sticky header and status bar. A
  caret landing in a still-virtualized tile scrolls to its placeholder,
  which triggers the render and completes the follow.
- **One selection model** (tester ask: shift-runs and mouse blocks
  behaved differently): every action now derives the granularity it
  needs from whichever input exists. A shift-run drives measure-shaped
  actions through its bounding measures (voltas, repeat barlines,
  reflection, copy/paste, structural counts); a single-staff mouse
  block drives event-shaped actions through its run (slur, tie chain,
  hairpin, pedal, tuplet, grace pair — edge rests trimmed so span
  endpoints land on notes); transpose/accidentals from a block cover
  every event in it. New behaviors: `r` with a shift-run toggles
  repeats; ctrl+c with a run copies its full measure span.
- **Cross-staff slurs unlocked**: shift-clicking across staves now
  selects an ENDPOINT PAIR (the run model can't span staves), and `S`
  slurs it — `ToggleSlurCommand` accepts cross-staff endpoints and
  writes `staff="1 2"` (probed: Verovio draws them, same-measure and
  across measures). Hairpins accept the pair too; grace-pair and tie
  chain still require one voice and refuse cleanly.
- **Two more stale-closure races fixed** (the harmony-lesson pattern):
  key handlers now read the selection and block through refs, so a
  fast click→key sequence (shift-click an endpoint, immediately press
  S) can't act on the previous selection.
- **Playback respects ties, slurs, and articulations** (tester find:
  tied notes re-attacked). Probed first: Verovio's timemap re-attacks
  tie continuations and its MIDI values neither merge ties nor shorten
  staccato — so the document supplies the truth. New core module
  `playback.ts`: the tie-pair graph (from `@tie` i/m/t chains and
  `<tie>` elements) merges each chain into ONE attack held for the
  summed span (works through repeat-pass clone ids via the expansion
  map), and per-note gates shape the release — slur/phrase spans and
  tenuto sound full value, staccato 50%, staccatissimo 30%, an explicit
  articulation beats the slur, and unshaped notes now get a slight
  detach (90%) so legato is audible by contrast. 7 unit tests + e2e
  plumbing checks.
- **Reflection cycle** (`shift+R` on a block selection): the serial
  forms of the selected material — prime → **inversion** (diatonic
  mirror about each voice's first note) → **retrograde** (pitch content
  reversed over the rhythm skeleton: durations and rests stay put, so
  measures stay valid by construction) → **retrograde inversion** →
  back to prime, byte-identically. Pitch content moves as
  pname/oct/accid triples; each voice in the block reflects
  independently; each press is one undo step. The cycle derives every
  form from the base captured at the first press (version-keyed — any
  other edit re-bases it). Retrograde needs chord sizes to mirror
  (pitches move between events, structure never changes) and is skipped
  with a notice otherwise. Core: `SetPitchesCommand` + pure form math
  in `reflect.ts`, covered by the property fuzzer and 6 unit tests.
- **Toasts get a × dismiss** on their left — close before the timeout;
  as a side effect the toast text is now selectable (error messages get
  copied around), since the whole-body click-to-dismiss is gone.
- **Add staff places the caret**: *add staff below* now lands the caret
  on the new staff's first measure, ready for note entry (selection and
  block cleared; the notice says where it went).
- **Dialogs remember the last folder**: open and save-as start in the
  folder of the last opened or saved score (persisted in settings; the
  shell only applies it when the folder still exists). File-association
  opens seed it too. Tester follow-up: the **"open file…" button** used
  to bypass this entirely — it clicked the hidden browser file input
  even in the shell (WebKit's own chooser, always starting at Home);
  it now routes through the same native open dialog as ctrl+o, keeping
  the input as the browser fallback. The shell also logs the starting
  dir it passes, for future portal debugging.
- **macOS round** (tester findings on an M-series Mac): the `.app`
  launches, file association works; two fixes shipped — (1) **MIDI
  hot-plug**: CoreMIDI posts device-list changes to the run loop of the
  thread that created the MIDI client, and the poll thread only slept,
  so plug/unplug was never seen; on macOS it now pumps a CFRunLoop for
  the poll interval (`core-foundation`, cfg-gated; ALSA/WinMM behavior
  untouched). (2) **Grey dock icon** — root cause found on-device (see
  [mac.md](mac.md)): the icns format was never at fault; macOS 26
  re-themes any icon with TRANSPARENT CORNERS as a legacy pre-shaped
  icon, discarding our white card and repainting the black glyph on a
  system tile that is dark grey under the Dark icon style. Fix: the
  macOS artwork is now fully opaque edge-to-edge (`icons/
  battuta-macos.iconset/`, glyph inset ~12%), icns built natively with
  `iconutil`. The dmg's warning-then-installer behavior is Gatekeeper
  on an unsigned image — expected until a Developer ID is added (the
  CI workflow picks up Apple signing secrets when configured).
- **The D.C./D.S. mark now cuts the first pass** (tester find): a
  mid-score da capo used to play through to the end before restarting —
  the base pass now stops AT the jump mark, the material after it (the
  coda) plays only via the To Coda jump, and a recap that walks back
  into the mark without having jumped ends the piece there (no loop).
  Jumps at the very end of the score behave exactly as before.
- **Tempo + progress** (part 3): a tempo select (0.5×–2×, persisted in
  settings) next to the player — live, the schedule rebuilds at the
  current musical position — plus a clickable progress bar with a
  mm:ss / mm:ss readout showing listening time at the chosen tempo;
  clicking seeks (`transport.seconds`, highlights clear and relight).
  `scorePlayer.stop()` is now a pure no-op until something actually
  played, keeping Tone entirely off the editing path.

First feedback round on the installed 0.0.1 (tested on Linux):

- **Title input**: a *title* button in the header opens an inline editor
  for the MEI `<title>` (meiHead/fileDesc/titleStmt — created when a
  file lacks the chain, one undo step). The button itself relabels to
  the current title, and page view now really prints it — two fixes
  underneath: `serializeForPageView` never carried `meiHead`, and the
  page renderer set Verovio's `header: "none"` (now `"auto"`).
- **Toasts**: errors, save confirmations, and refusal notices now show
  as bottom-right toasts (auto-dismiss, click to close) — errors used to
  hide in the perf status line, invisible in the shell.
- **Dirty marker**: tabs show `*` when the document has unsaved changes
  (undo-stack position vs. the last save; undoing back to the saved
  state reads clean again).
- **Row navigation**: `Insert` toggles note input (both directions),
  `Home`/`End` jump to the start/end of the current engraved row,
  `PageUp`/`PageDown` move to the previous/next row keeping the caret's
  staff and voice where possible.
- **Finger changes**: `alt+6..0` writes a change-of-finger on the note's
  existing fingering — `alt+2` then `alt+6` gives `2-1`; the same key
  removes the substitution, a different one replaces it.
- **Separate QWERTY/AZERTY keymaps**: a layout toggle in the shortcut
  editor (🌣) — merged defaults double-booked keys (QWERTY's simile `'`
  is AZERTY's unshifted digit-4, colliding with durations). Each layout
  has its own defaults and its own saved overrides.
- **Persisted options**: keyboard layout and zoom level survive restarts
  (`localStorage`, `battuta.settings.v1`); new documents open at the
  last-used zoom.
- **Drag-selection overlay**: block-selection drags no longer paint the
  native text-selection highlight in WebKitGTK (`-webkit-user-select`
  applied through the SVG content).
- `node spikes/verify-phase5.mjs` grew to 184 checks covering all of it.
- **License**: AGPL-3.0-only — LICENSE file added, declared in every
  manifest (package.json ×3, Cargo.toml, tauri.conf.json bundle).

## 0.0.1 — 2026-08-08 (first release)

First packaged release: Linux `deb` + `AppImage`, app icon, and `.mei`
file association.

- **Bundles**: `npx tauri build` from `apps/editor` produces
  `battuta_0.0.1_amd64.deb` (~6 MB) and `battuta_0.0.1_amd64.AppImage`
  (~81 MB, WebKitGTK bundled). Production builds no longer embed the
  fixtures corpus (vite `publicDir` is dev-only now, ~13 MB lighter);
  the deb declares the ALSA dependency for the MIDI bridge.
- **`.mei` file association** (three pieces, because Tauri's
  `fileAssociations` alone isn't enough on Linux): a shared-mime-info
  package mapping `*.mei` → `application/x-mei+xml`, a custom desktop
  entry template with `Exec=battuta-editor %F` (Tauri's default omits
  `%F`, so file managers would never pass the clicked file), and
  launch-argument plumbing — the shell stores `argv[1]` and the frontend
  pulls it via an `initial_score` command on mount (pull, not push: a
  Rust-side emit would race the webview subscriber, the same trap the
  MIDI indicator fell into). Double-clicking a `.mei` in a file manager
  opens it in battuta. On macOS the same path is fed by the `Opened`
  run-loop event instead of argv.
- **App icon**: generated from `icons/battuta-white.svg` (the ♭ +
  Bussotti-sharps mark on a white card — the transparent variant
  rendered gray in desktop shells) — full Tauri set (32/128/256/512
  png, multi-res `.ico`, real `.icns`) wired into `bundle.icon`.
- **Sticky top bar**: the header (brand, tabs, save/open/⟲id/🌣) stays
  pinned while the score scrolls, solid background, hairline border.
- **Status-bar dropdowns readable in the shell**: WebKitGTK renders
  select popups natively and ignored the dark option colors
  (tauri#11755) — fixed with `appearance: none` + `color-scheme: dark`
  + a data-URI chevron on all six status-bar selects.
- **Startup banner tells the truth**: `tauri build` enables the tauri
  crate's `custom-protocol` feature directly rather than the app's
  wrapper feature, so the old `#[cfg]`-keyed banner mislabeled bundled
  builds as "DEV SERVER"; it now keys on `tauri::is_dev()`.
- Version bumped to 0.0.1 (tauri.conf.json + Cargo.toml); shell smoke
  grew a launch-with-a-`.mei`-argument check (6 checks total).

### Packaging groundwork (2026-08-05 → 08-08)

- **The embedded-asset build renders**: the Phase-0 WebKitGTK blank-webview
  bug is gone with current WebKitGTK/Tauri (verified: `tauri://localhost`
  loads, workers + WASM boot, tiles render). The startup IPC bench is now
  gated behind `?ipcbench`.
- **Native open/save**: `ctrl+o` opens a score through the system dialog
  (XDG portal via `rfd` — native on Wayland), `ctrl+s` saves silently to
  the score's known path, `ctrl+shift+s` (or an unsaved score) opens
  save-as and renames the tab to the chosen file. In browsers the same
  keys fall back to the file input and a download. The *save* button uses
  the same path-aware logic.
- **Native MIDI**: WebKitGTK has no Web MIDI API, so the shell bridges it —
  a `midir` (ALSA) thread connects every input port, streams note on/off
  to the webview as Tauri events, and polls for hot-plug every 2s; the
  frontend feeds them into the exact same pipeline as Web MIDI (status-bar
  indicator, device list, chords, advance-on-release). Building the shell
  needs `libasound2-dev`.
- **Clean shell UI**: the packaged app starts on a fresh blank score (no
  demo fixtures — the fixtures select is dev-only), and all performance
  numbers (render timings, measure/pool stats, per-tile ms labels) hide
  behind a **⏱ toggle** in the header — off by default in the shell, on
  in dev where the e2e suites read them.
- **Shell smoke**: `sh spikes/verify-tauri.sh` (needs a display and
  `libasound2-dev`) — builds the embedded bundle, launches it, and asserts
  the page loads over `tauri://`, tiles render, `save_score` writes real
  MEI to disk, the MIDI bridge delivers a fake device and note into the
  UI, and a `.mei` launch argument opens as the active tab.

## Phase 5 — Polish (2026-08-05 → 2026-08-08)

**Plan.** Preferences, keymap customization, session restore, crash-safe
autosave (command log replay), MusicXML import via Verovio's converter,
export (MEI, MusicXML, per-page SVG/PDF via Verovio), packaging for
Linux/macOS/Windows through Tauri, docs and sample corpus. Only after
real usage: evaluate whether the core's hot paths (context hashing,
duration arithmetic, fragment splicing) justify the Rust/WASM rewrite
behind the existing interface. *(Moved up from Phase 7, 2026-08-02:
keymap customization, autosave, and import/export matter for daily use
now, while reference layers and OMR are the research-heavy phases.
Reference layers and OMR shifted to Phases 6 and 7 unchanged.)*

**Landed:**

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
- **Shortcut editor** (🌣 in the header — the Phase 5 headliner): every
  key binding routed through a **keymap** — the editor lists all ~30
  actions by group with their current keys, click a binding and press the
  new key to rebind (letters carry case, alt carries, shift is explicit
  for symbols), duplicates get a soft amber warning, *reset all* restores
  defaults, and overrides persist in localStorage. Physical-code bindings
  (durations, fingering, voltas) and system chords are listed but locked.
  The old two-line keyboard hint is gone — the editor is the help.
- **Status-bar navigation aids**: a caret position readout right of the
  INPUT indicator — `[ m 10, s 2, v 1, n 6 ]` (measure, staff, voice,
  note) — and a **zoom** button left of the MIDI square replacing the
  header select: click for **+ / − / reset** (50%–250% in 25% steps), or
  use `ctrl +` / `ctrl −` / `ctrl 0` anywhere (browser page-zoom
  suppressed).
- **Random ids + repair**: `newId()` is now random (`bt-` + 8 base36
  chars, crypto-sourced) — counter enumeration kept re-minting ids that
  already existed in previously saved files, and no seeding survives
  every path. For documents that already accumulated duplicates, the
  **⟲id** header button regenerates every `xml:id` with all
  `#references` (startid/endid/plist/…) rewritten to follow — one undo
  step. Saves are now **pretty-printed** (two-space indent; elements with
  text content stay compact so mixed content is untouched; the parser
  drops whitespace-only text, so formatted files reload to the identical
  tree).
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
  opens the per-note picker with 𝄪); **fermata** = `h`; and `w` **circles
  the four ornaments** — arpeggio (chords) → tremolo (`bTrem` wrap) →
  trill → mordent → off. All follow the dot's target rule (just-entered
  note in input mode, else the caret), toggle on repeat, one undo step
  each. The `o` key cycles the full **repeat-mark family: coda → segno →
  fine → dal segno → da capo → off** (all `repeatMark`s).
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
- **Harmony lanes** (the *harmony* select in the status bar): two typed
  annotation lanes over MEI `<harm>` — **chord symbols** above the staff
  and **Roman numeral analysis** below (`@type="rna"`), independent of
  each other. Picking a lane opens a floating editor at the caret with a
  **closed grammar**: only characters that can extend a valid symbol are
  accepted (roots A–G, qualities m/maj/dim/aug/sus/add/alt, Δ/ø/°/±,
  extensions and alterations, slash basses; numerals I–vii with °/ø/+,
  figured-bass inversions 6/64/65/43/42/2, secondary /X, accidental
  prefixes, N6 and It/Fr/Ger+6 — `o`/`0` normalize to °/ø). Live
  validity coloring, **tab autocompletes** from suggestions, **enter
  commits and advances** to the next event, arrows commit and move,
  escape leaves the lane. Editing an event with an existing symbol loads
  it for correction; committing empty deletes it. One undo step per
  symbol, and the annotations ride copy/paste like every control event.
- **Tuplets** (`shift+t` on a selection): 3 selected notes become a
  **triplet** (3:2), 6 a **sextuplet** (6:4) — the run shrinks to its
  tuplet time and the freed duration becomes rests after it, so the
  measure stays valid; a selection inside a tuplet **unwraps** it,
  consuming those rests back (byte-identical round trip). Refuses wrong
  counts, non-consecutive runs, mixed-duration runs whose freed time
  isn't writable, and unwraps without their rests. Rhythm-edit rules
  apply: the measure unbeams first, and members stay caret-addressable.
  This closed the last Phase 4 leftover besides file watching.
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
  after the file. `node spikes/verify-phase5.mjs` (165 checks).

## Phase 4 — Note entry and MEI round-trip hardening (2026-08-02 → 08-05)

**Plan.** Keyboard note entry at the caret (pitch letters or MIDI input
via Web MIDI, duration keys, chord building, rests, ties, tuplets).
Dotted rhythms, articulations, basic dynamics. In parallel, harden
serialization: preserve-unknown-verbatim round-trip tests over a corpus
of third-party MEI files, id stability across save/load, and
file-watching so external edits reload cleanly.

**Exit criteria (met; file watching deferred, tuplets landed in Phase
5):** transcribe a short passage from scratch by keyboard/MIDI without
touching raw XML; corpus round-trip suite green.

**Landed:**

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
- **Round-trip hardening**: the session keeps the FULL document tree —
  `meiHead`, unknown elements/attributes, comments, `<?xml-model?>` PIs —
  and save serializes all of it. Corpus tests prove serialization is a
  fixpoint, no content is lost across cycles, and a reloaded save needs
  zero new ids. Compatibility note: Verovio rejects comments before the
  root element (PIs are fine), so prologue comments are preserved by moving
  them just inside `<mei>`.
- 172 core tests; the property fuzzer covers the whole command pool (a
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
- **Context editing** (clef… / key… / meter… dropdowns): change or
  add a clef, key signature, or meter at the caret's measure, MEI-natively.
  Mid-piece clef changes are written as **inline `<clef>` elements before
  the barline** (the engraver's position) — interleaved `staffDef` clefs
  render in tiles but are ignored by Verovio's full-document renders, so
  the inline form is what survives page view and export.
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

## Phase 3 — Copy/paste and arranging (2026-08-02)

**Plan.** This phase is the reason the project exists. Serialize
selections to MEI clipboard fragments with context metadata. Implement
the three paste policies (replace-measures, splice-at-caret,
overlay-as-new-layer) with the duration validator gating every commit.
Add multi-document support (tabs or split view) and cross-file block
paste with the meter/key compatibility pass. Add structural measure
commands: insert/delete measures, split/merge, duplicate measure range.

**Exit criteria (met):** the target workflow works start to finish — open
two files, block-select four measures of one staff in file A, paste into
a different staff in file B, transpose, save, and the result opens
correctly in Verovio and mei-friend.

**Landed:**

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
- Deferred from this phase: splice-at-caret and overlay-as-new-layer paste
  policies; split view. (Split/merge measures landed in Phase 4.)

> **Progress note (2026-08-02) — Phases 0–3 delivered, plus view-layer work
> beyond plan.** Phases 0–3 exit criteria all hold, verified by headless e2e
> suites (`spikes/verify-*.mjs`) and 55 core tests including fast-check
> properties (apply/revert identity, duration invariant, interleaved
> undo/redo — all run against real corpus files). Beyond the plan:
> the runner bake-off got a fourth candidate (persistent doc + `select()`:
> rejected, O(document) floor) and a real Tauri IPC measurement (~1–2 ms).

## Phase 2 — Selection, caret, and the command engine (2026-08-02)

**Plan.** Implement event selection (click, shift-click, shift-arrow) and
block selection (measure-range × staff-range), both stored as model
ranges. Implement the caret with model coordinates and keyboard
navigation. Build the command engine: command objects with apply/revert,
dirty-region reporting wired to tile invalidation, undo/redo stack. Ship
the first real edits: transpose by step/octave, toggle accidental,
delete-events-to-rests.

**Exit criteria (met):** arrow-key navigation feels like a text editor;
transposing a selection updates only its tiles within the latency budget;
undo/redo is reliable under property-based tests (random command
sequences, then full unwind, yields a byte-identical document).

**Landed:**

- `@battuta/core`: event index (chords are events, beams/tuplets are
  transparent), caret navigation (left/right across measures, staff
  up/down), event ranges for shift-selection; command engine with
  apply/revert + dirty-region reporting, undo/redo stack; first edits:
  transpose by step/octave, toggle accidental, delete-to-rests.
  40 tests including fast-check properties: random command sequences —
  with interleaved undo/redo — fully unwound restore the document
  byte-identically (run against real corpus files).
- Editor: click/keyboard caret (blinking bar projected from model position),
  shift-click / shift-arrow selection, keymap, edit-latency HUD. Dirty
  tiles re-render via cache-key change alone:
  measured 19 ms edit→screen with exactly 1 tile re-rendered; undo/redo hit
  the tile cache (~4 ms). Verify: `node spikes/verify-phase2.mjs` (16 checks).

## Phase 1 — Read-only tiled viewer (2026-08-02)

**Plan.** Build the real pipeline with no editing: MEI → core tree (with
id generation, effective-context resolver for clef/key/meter per
measure/staff) → tile synthesis → Verovio render → tile cache → flow
layout of tiles into rows → virtualized scrolling. Add the page view
(full Verovio layout) and a toggle between views. Click a note in either
view and it highlights via id.

**Exit criteria (met):** open any MEI file from the existing pipelines
and from mei-friend samples; scroll a 500-measure score smoothly;
clicking notation highlights the corresponding element; context-resolver
tests green.

**Landed:**

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
  (results in BENCHMARKS.md)

## Phase 0 — Skeleton and spike (2026-08-02)

**Plan.** Set up the Tauri + Vite + TypeScript + React workspace with the
core as a separate package (`packages/core`, zero DOM imports). Spike the
two riskiest assumptions: (a) render a single measure slice through
Verovio and confirm the output SVG carries the source `xml:id`s;
(b) measure Verovio render time for a slice vs. a full document on a real
200+ measure file, to validate that tiling is worth it.

**Exit criteria (met):** a window opens, loads an MEI file, renders one
measure tile, and logs timing numbers for slice vs. full render.

**Landed:**

- Slice rendering preserves `xml:id`s end to end (spike A: PASS)
- Tiling beats full re-layout by 30–100× per edit (spike B: PASS)
- Runner decision: **Verovio WASM in a Web Worker pool** — see
  [BENCHMARKS.md](BENCHMARKS.md) for the full bake-off (main thread vs
  worker vs native C++, plus the persistent-document/`select()` variant,
  spike C: rejected)
