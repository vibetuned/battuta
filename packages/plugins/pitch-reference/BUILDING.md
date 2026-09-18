# Building the pitch reference

## 1. Origin

A NEW feature, the first reference layer and the plugin that closes Phase
9: nothing of it ever lived in `App.tsx`. Built in-house to the slice 10b
brief in PLANNING.md (five checkpoints — decode and waveform, the YIN
trace, offset-and-rate alignment against the timemap, the per-measure
overlays, polish) after the user replaced the planned MIDI piano-roll
reference with a simpler first consumer (decided 2026-09-18): a wav of a
performance, its pitch traced over the measures against the written
pitch. `App.tsx` before → after: 3,017 → 3,017.

## 2. Manifest

- `contributes.commands`: `battuta.pitch-reference.toggle` — show or hide
  the panel and the traces.
- `contributes.slotItems`: the 🎙 in the `header` slot, `dimUntilActive`,
  running the toggle — the entry point the host renders before a byte of
  this plugin exists; the live item with the same id takes the face over
  while the plugin runs so it can dim with the panel.
- `activationEvents: ["onCommand:battuta.pitch-reference.toggle"]` — the
  one wake-up path. A user who never loads a recording never fetches the
  detector.
- `capabilities: ["audio", "midi"]` — the host's AudioContext decodes and
  plays the file; the MIDI outputs play the written notes (added the same
  day as the transport, when the user asked for "▶ score").
- `engines: ^0.1.16` — `ctx.overlays` and the staff context types.

Deliberately NOT declared: no keybindings (the union keymap snapshot
stays byte-identical); no `onStartup`; no `onSettings:` (nothing
persisted means "in use" — the recording is not kept); no `imports` (a
wav is not a document and must never become a tab); no `exports`; no
lanes.

## 3. API surface

Read: `ctx.document` (get + subscribe — the name for the storage key, the
tempo, the id and version to know when to re-read), `ctx.editor`
(subscribe — the caret, for the playhead to follow), `ctx.query.timemap()`
(the written notes, the measure windows, every id's onset; the score
clock), `ctx.query.eventIdAt(caret)` (which event the caret is on — added
for this plugin, api 0.1.18), `ctx.audio.context()` (decoding, and one buffer source per stretch of
playback), `ctx.midi.openOutputs()` (once, on the first "▶ score", kept
for the activation and closed on deactivate; `MidiOutputs.schedule` /
`panic`), `ctx.storage.get`,
`ctx.activatedBy`.
Write: `ctx.storage.set` (the alignment per document name). Lifecycle:
`ctx.audio.unlock()` (first in the click that opens the file dialog, and
again in the load path so a file arriving another way still gets a
context), `ctx.panels.open` (bottom), `ctx.overlays.add`, `ctx.slots.add`,
`ctx.registerCommand`, `ctx.subscriptions`, `ctx.notice` (once, when an
analysis lands: the take's length, voiced frames and cents — the user
asked not to see it all the time in the panel). No `ctx.execute`.

The API grew for this plugin's HOST half, slice 10a: `ctx.overlays` and
`TileOverlayProps` (0.1.16). During this slice one refinement: a note's
box in `TileOverlayProps.boxes` is its HEAD, not its group — the stem put
the centre a fifth off the pitch, and a pitch axis is the first thing a
consumer fits through those boxes (0.1.17, a documented contract detail).

## 4. State

Transient: the decoded `AudioBuffer` (kept while the take is loaded, for
playback), its envelope and the trace (`PitchFrame[]`), the playhead,
the file's name and length, the status and progress, the written notes
and measure windows read from the timemap, the deviation. All of it goes
with the activation; a plugin turned off drops a running analysis by
bumping a generation counter. Persisted (`ctx.storage`): `align:<document
name>` → `{ offsetMs, recordedTempo, transpose }`, three numbers per score
the user has loaded a recording for (the transpose joined them the same
day, when the user asked for one — the detected trace is kept as `raw`
and the compared one derived from it); the recording itself is never
stored (megabytes,
and the user's file). Document: nothing. Nothing mutates the document
outside `ctx.execute` — and this plugin never calls `ctx.execute`; the
lifecycle test asserts the session adapter received no command, and the
e2e asserts the undo depth stays 0.

## 5. Command messages

None. The pitch reference reads the score and never writes it.

## 6. Tests

`test/yin.test.ts` — the detector on known signals: a 440 Hz sine reads
69 within ten cents on every frame, a low note and an octave jump,
silence and noise unvoiced, the median filter removing a one-frame blip
and keeping a gap, the chunked analysis equal to the whole-signal one.
`test/audio.test.ts` — downmix, resample (a constant, the duration, the
pitch unmoved, upsampling), envelope, the decode through a context-shaped
fake. `test/align.test.ts` — offset and rate invert, the offset at the
first run of voiced frames, written notes and measure windows engraved
from a timemap with clones, the deviation. `test/axis.test.ts` — the
clef's line carries its pitch, an octave is 3½ spaces, F and C and
octave clefs, a percussion clef gives no axis, the fit through heads and
its refusal. `test/pitch-reference.test.ts` — the lifecycle against a
real host with a fake AudioContext and a fake session: the 🎙 before any
code loads, the toggle, a load end to end (unlock on the gesture, decode,
analysis, the score read, the offset, the deviation), the alignment kept
per document and the rate from the tempos, no audio, off and on again.

Run: `npx vitest run --root packages/plugins/pitch-reference`, or
`npm run test:plugins` from the root. The e2e:
`BATTUTA_ROOT=$PWD CHROME=bundled node spikes/verify-pitch-reference.mjs`
— it synthesizes a take from the score's own timemap (sines, 300 ms of
silence first), loads it through the panel's file input and reads the
results off the page: the offset found at the silence's end, the median
deviation near zero, the per-measure layers with the trace on the first
note's head, the checkbox, an offset and a tempo typed in, close and
reopen with the trace kept, a click through the trace still placing the
caret. `spikes/verify-overlays.mjs` stayed green through the head-box
change.

## 6b. Playback and the playhead (added 2026-09-18)

`src/player.ts` plays the recording through the host's context — one
`AudioBufferSourceNode` per stretch, started at the playhead, stopped on
pause, the position read from `currentTime`; the unlock is the first
thing `play` does, so a click resumes the context inside its gesture. The
white line in the strip is the playhead: press or drag anywhere on the
strip (pointer capture, so a drag may leave it), and it follows the
caret — a MOVE of the caret, keyed by its four numbers so a selection
change does not count — to the event's onset through the alignment,
using `ctx.query.eventIdAt` and the onsets of every timemap id (rests
included). Not while playing. Closing the panel, clearing, loading
another take and deactivation all pause. `test/player.test.ts` and the
lifecycle suite cover it; the e2e presses play in headless Chrome, whose
context runs silently, and reads the line moving.

`src/scorePlayer.ts` is the second transport, "▶ score": every written
note from the playhead on is handed to the host's MIDI sink at once as a
plain on/off pair — channel 1, velocity 100, the off 10 ms early so a
repeated pitch re-attacks — at the recording's pace through the
alignment, so both transports from one playhead sound together; the
sink's queue keeps the order and its panic is the pause. The pitches are
moved by the INVERSE of the trace transposition (the user's rule: the
trace is shifted to meet the notes, the notes are played to meet the
voice), and a change of "st" while the score plays restarts it from where
it is in the new register. No performance decisions: that is the
playback plugin's. The outputs are opened once
and kept, as playback does. `test/scorePlayer.test.ts` over a sink-shaped
fake; the lifecycle suite runs it against a fake MIDI backend and reads
the bytes; the e2e presses it in a browser without outputs and reads the
notice.

## 7. Dead ends

- **A trace drawn as one polyline.** Consecutive voiced frames an octave
  apart — a new note, or an octave error — were joined by a vertical wall
  through the strip and across the tile. The pen now lifts on a leap of
  more than six semitones (`LEAP_SEMITONES`), so the trace reads as note
  segments. Found while shooting the docs, together with the bars: the
  written notes of the OTHER staff were drawn on the picked staff's axis,
  so a bass eighth appeared as a faint bar under the treble trace; the
  overlay now fits through and draws only the notes whose head lies in
  the picked staff's band.
- **"The top voice" as the highest pitch per onset.** The docs' synthesized
  take (`docs/scripts/build-shots.mjs`) first sang whatever was highest at
  each onset, which where the melody rests or holds is the accompaniment
  a fifth or more below — the trace dived to the bass eighths and made the
  plugin look wrong. A singer does not drop there: an onset more than
  seven semitones under the previous kept note is skipped. The e2e's take
  keeps the simple rule, because its deviation check takes the nearest
  written pitch and is unaffected.
- **Unlocking only on the button.** The first e2e run failed with "audio
  is not available": Playwright sets the file input directly, no click
  ever ran `unlock`, and the host creates the context on the first
  unlock. A recording can arrive without the button (a test, a drop), so
  the load path unlocks too — outside a gesture the context stays
  suspended, and decoding does not need it running. The button still
  unlocks first, so a real user's context is running for whoever plays
  next.
- **Note boxes as groups.** The first fit through `tile.boxes` put the
  trace a fifth off: a `g.note` group includes the stem and the flag, so
  its centre is not the pitch. Closed in the host — a note's box is its
  `g.notehead` — rather than in the plugin, because every consumer of the
  point would have had to know that.
- **A staff axis from the clef alone.** Right for a measure of rests,
  slightly off the engraved heads otherwise, because a semitone is 7/12
  of a half-space only on average: the fit through the measure's own
  heads is what puts the trace ON the notes. Kept as the fallback.
- **An FFT-based difference function** for YIN (O(W log W) a frame) was
  considered and dropped: plain YIN at 16 kHz is about a third of a
  second per ten seconds of audio in chunks that yield, which the panel
  hides behind a progress figure. Optimise when a take is long enough to
  hurt.
- **A Worker** for the analysis: the same reason, plus a build shape
  (`new Worker(new URL(...))`) no plugin has yet; the yielded chunks keep
  the editor responsive.
- **Beat tracking the recording**: never started. The score's tempo is
  the grid; a take with rubato drifts from the bars, and seeing it is the
  point. Dynamic time warping of the trace against the written pitch
  curve is the next version and needs nothing new from the host.

## 8. Recipe

A layer over the notation from an external signal — a recording, a MIDI
file, an OMR sidecar — looks like this one:

1. Copy `package.json`, `tsconfig.json` (lib DOM if you name a platform
   type), `src/manifest.ts` (rename the ids; keep the declared header
   item and `dimUntilActive`), `src/store.ts`.
2. Put the signal's own maths in pure modules over arrays and api data
   (`yin.ts`, `align.ts`, `axis.ts` here) and test them first; none of
   them should import React or touch `ctx`.
3. `src/index.tsx`: a `signal<State>` the panel and the overlay both
   subscribe to; `mount()` opens the panel AND adds the overlay, `setOpen`
   disposes both; re-read the score on `ctx.document` changes; a
   generation counter to drop stale async work.
4. `src/MeasureOverlay.tsx`: take `TileOverlayProps`, pick the staff by
   `staffAxis(...).centre`, fit through `tile.boxes` of the measure's own
   notes, map time along the notes' onsets, draw translucently.
5. Register in `apps/editor/src/host/plugins.ts` and
   `apps/editor/package.json`, `npm install`, add the row in
   `docs/.../reference/plugins.mdx`.
6. Checks at each step: the plugin's vitest; `npm test -w @battuta/editor`
   (plugin-boundaries and host-boundaries); the e2e that loads a
   synthesized signal; `npm run budget -w @battuta/editor`.
