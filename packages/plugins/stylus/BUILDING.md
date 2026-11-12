# Building the stylus plugin

The first plugin on a NATIVE host service: the pen is captured by the iOS
and Android shells, and this plugin never touches it — it reads
`ctx.stylus` events and writes `core.enterNote` and `core.mark` messages;
in handwriting mode it also asks the shell's classifier, granita, what a
symbol is (`ctx.stylus.recognize`). Written for the next author, a person
or an agent, who has this file, `packages/plugins/README.md` and nothing
else.

## 1. Origin

Phase 11, in three parts the user set out on 2026-10-29: notes added with
the pen, a held pen popping a cross at its tip — left to right the
duration, top to bottom the pitch (after trying it, the user had the cross
come up at the touch instead: §7); ABC music written by hand with ML Kit
and PencilKit, dropped after feedback on 2026-11-01; and symbols written by
hand and read by granita, battuta's own glyph classifier
(vibetuned/granita), planned on 2026-11-01 (PLANNING.md, Phase 11).

It stands on slice 1, the bridge: `StylusCapture.swift` /
`StylusCapture.kt` in the shell's `battuta-mobile` crate send strokes, a
hold, hover and the buttons to `apps/editor/src/host/stylus.tsx`, which
reads each against the score; and on M2, the model in that same crate.
The user's decisions, each taken as asked:

| Question | Decision |
| --- | --- |
| Where does the pen write? | **Only on the score.** Elsewhere it taps like a finger; while a menu is open over the score, it taps the menu. |
| What duration does a tap give? | First answered "the last one chosen with the cross"; after trying it on the Galaxy tablet the user changed it: **the input's length** — the one digits pick, dots included. |
| What does the cross's length do to the input's? | **It becomes the input's**, as a digit would make it. |
| When is a held note written? | **On lift**: the cross previews, one undo step. |
| When does the cross come up? | First on the shell's hold (half a second still); after trying it, the user: **at the touch** — the hold was too slow. |
| What does the cross look like (the user, 2026-11-12)? | **A small cross** at the touch; past `UNFOLD_PX` (12 px) of drag it **unfolds into two rulers crossing like a crossword's words** (`rulersOf`): across, above the staff, a cell for every length, engraved, one `STEP_X` apart — where the pen chooses it; down the landing's column, a letter for every staff step at its height, lines left and spaces right. The choice lit in both and pulsing at each change; open until the lift. A first version unfolded into five cells of the next step each way; the user: "I mean a ruler". |
| How does the cross stay uncovered? | The tile's frame clips what spills and the next tile covers it — the old cross's arms and label did spill, the bug the handwriting's label had. A ruler is wider than a measure, so **every tile of the landing's row draws its part**: when the pen lands the plugin reads where each tile starts on the page (`ctx.stylus.at` along the ruler's reach), lays the rulers out once in page x and the frames' shared y, and each tile draws them shifted by its own origin — the way the ink spans a row. |
| Chords? | Asked for by the user after trying it: the squeeze or the side button **as a shift**. A press **arms the next stroke** (again: disarms), and the pitch joins **the note under the pen**. |
| What may the API gain? | `ctx.stylus`, the `core.enterNote` message and the `"stylus"` capability — **and nothing else** (1.3.0); then, for the input's length, `editor.entryDur` / `entryDots`, `core.enterNote`'s `dots` and `ctx.setEntryLength` (1.3.1); `core.addChordNote` (1.3.2); the caret on what was written (1.3.3). |
| How is handwriting switched on (2026-11-01)? | **A status-bar item only**, no pen gesture. |
| How are marks written? | **One message, `core.mark { eventId, mark }`**, a closed union the host maps to the session's marks. |
| Where does the model live? | **Copied into `battuta-mobile` and tracked**, a script naming the granita release. |
| When the model is unsure? | **A chooser of the top three** beside the symbol, tapped with the pen; a last row to discard (the user, 2026-11-02). |
| How close is the next stroke of a symbol? | First two staff spaces from its box; the user (2026-11-02): **proportional to the drawing** — half its larger side, at least half a space — so small glyphs follow each other quickly. |
| The heuristics (the user's brief) | The augmentation dot right of a note, a staccato above or below one; accidentals left of a note; fingerings and dynamics never inside the staff; clefs and rests only inside it. |
| What may the API gain for handwriting (1.3.5)? | `StylusScorePoint`'s `staff`, `measure` and `nearestNote`; `ctx.stylus.at`; `ctx.stylus.recognize`; `core.mark` — **and nothing else**. |
| And for the eraser and the ornaments (1.3.7, approved 2026-11-02)? | `Mark`'s `ornament` kind (arpeggio, trill, mordent, turn — the turn new to the core); `StylusScorePoint.nearestMark`; `core.erase { id }` — **and nothing else**. |
| Which classes? | The user's list (2026-11-02): **no barline, pedal, double flat, `m` or `z` alone, and no rest but the quarter** — granita is retrained without them; the table lacks them, so a reading the old model still gives is not offered. Coda classes are coming to the model (a repeat-mark kind to approve when they do). |
| The quarter rest? | **The eraser**: rests are what notes do not take; touching a note it deletes it to rests, touching a mark that stands on its own it removes the mark. |
| Slurs and ties (the user, 2026-11-02) | **A third mode** on the same item: a bow drawn from a note to another — **a tie when they are the same note, a slur otherwise**; the editor judges the pitches. API 1.3.9: `Mark`'s `tie` and `slur` kinds (with `endId`) and `nearestNote.pitch` — **and nothing else**. |
| The replies and the training (the user, 2026-11-02) | **Explicit replies only** — ✓ tapped, a chooser's pick, ✗ then a pick; never the silent ✓, never a bow. The replies **in the app's private data, with a share action**. The training as **plugin commands** — train, reset, share — each ending in a notice. API 1.3.10: `ctx.stylus.reply`, `train`, `resetTraining`, `shareReplies`, `StylusReply`, `StylusTraining` — **and nothing else**. battuta's iOS floor rises to 18 for the multi-function Core ML package. |
| The replies in the plugins page (the user, 2026-11-02, on trying it) | The ✎ item **in the header with the other plugins' buttons** (the status bar before). **The replies' numbers and a train button in the plugins page, as the plugin's settings**: API 1.3.11's `pluginSettings` slot — an item under the plugin's own row — `ctx.stylus.replies()` (the counts, the training in use) and `deleteReplies()` (a delete button, asking first) — **and nothing else**. |
| Engraved symbols (the user, 2026-11-02: "replace the selection text by engraved symbols") | The label and the chooser show each class **as engraved**, not by name (`glyphs.tsx`): Unicode's musical symbols in **Noto Music**, which the editor already bundles for the interface (its musical blocks, behind the interface font) — the accidentals, notes, the quarter rest, clefs, fermata, trill, turn, arpeggio, coda, segno, the dynamics from their letters (𝆍𝆑𝆎); an articulation as a **quarter note wearing it** (a combining mark alone is tofu), the dot as a dotted quarter, a fingering as its digit, Fine / D.S. / D.C. bold italic; the **mordent and the two bows drawn** (Unicode has neither). Checked in the WebView on the Galaxy Tab. The name stays on the button's title and in the notices. No API change. |
| A pen tap on a button in the score area (2026-11-05, the + after the last measure) | **The host's, not this plugin's**: the shell captures the pen over the whole score, so the host presses a `data-pen-tap` button under a pen tap on nothing of the score (`PenTap` in `host/stylus.tsx`). A first draft here reached for `document` and failed the boundary test — a plugin never touches the DOM. |
| granita v10 (2026-11-12, trained with the shells' replies) | No code change for the model: the classes, the input, the context and the tflite's names are v8's. **A trained layer belongs to its release**: the natives keep `stylus/head.model`, a fingerprint of the release's own last layer, and forget a layer trained for another release when the model loads; the replies stay. |
| granita v8 (2026-11-02, the battuta variant, 43 classes) | The context measures the nearest note's **body** — head, stem and flag, a chord's as one, without accidentals, dots or articulations — and carries its size; the flags are "over" / "beside" the body within half a space. The host gives `nearestNote.box` (1.3.8), the plugin sends `noteW` / `noteH`, the natives build the vector from the body. The repeat marks (coda, segno, Fine, D.S., D.C.) came in: `core.mark { kind: "repeatMark" }` (1.3.8), the core setting one by name where the coda key cycles. |

## 2. Manifest

```
id                battuta.stylus
engines.battuta   ^1.3.11
capabilities      stylus
activation        onPointer:coarse
contributes       five commands: battuta.stylus.mode, .train, .resetTraining, .shareReplies, .deleteReplies
```

`onPointer:coarse` wakes it on a tablet; `ctx.stylus.available` is false
everywhere but the iOS and Android shells, and `activate` returns at once
there. The mode command is run by the header item the plugin
adds at RUNTIME (`ctx.slots.add`) once it knows there is a stylus: a
declared slot item would be rendered on the desktop too, where there is
no pen. No keys. Turning the plugin off in the plugins tab is how the pen
is given back.

## 3. API surface

Added for this plugin in `@battuta/api`, each the ceiling the user
approved:

- **`ctx.stylus`** (1.3.0) — `available`, `capture(on)`, `on(listener)`.
  Every event carries `at`: the measure, the nearest staff, that staff's
  event nearest the pen across, the step above the bottom line, the pitch
  there under the clef in force, and the point in the tile's own pixels
  (the overlays point's frame). The host computes it from the drawn page,
  so this plugin knows nothing of Verovio's layout.
- **`core.enterNote`** (1.3.0) — `{ eventId, pname, oct, dur, dots? }`,
  mapped by the host to core's existing `ReplaceEntryCommand` inside the
  unbeam wrap, exactly what the keyboard's entry runs.
- **capability `"stylus"`** — offered by every build, like `workspace`.
- **the input's length** (1.3.1) — `ctx.editor`'s `entryDur` and
  `entryDots`, which a tap writes and the cross starts from; and
  `ctx.setEntryLength(dur, dots)`, which a lifted cross calls.
- **`core.addChordNote`** (1.3.2) — `{ eventId, pname, oct }`, the
  keyboard's chord command.
- **The caret** (1.3.3) — not a call: the host puts it on what a message
  wrote, so any plugin writing leaves the caret where the keyboard would.
- **The symbol's context** (1.3.5) — `StylusScorePoint` gains `staff {
  space, middleY }`, `measure { left, right }` and `nearestNote {
  eventId, x, y } | null`, page px; and `ctx.stylus.at(x, y)` reads any
  page point the same way, so a symbol's centre and its head can be read
  after the strokes (null before the service has loaded, which the first
  `capture` or `on` does).
- **`ctx.stylus.recognize({ strokes, staffSpace, context })`** (1.3.5) —
  the shell's classifier: `[{ label, confidence }]`, best first. The
  plugin sends the raw facts of the place (`rules.ts`'s `contextOf`); the
  native side rasterises the strokes as granita does and builds the model's
  16-feature vector, so there is no port of granita's `context.py` in
  TypeScript. Rejects on the desktop and in a shell without the model.
- **`core.mark { eventId, mark }`** (1.3.5) — accidental, articulation,
  dot, fermata, dynamic, fingering, pedal (with `endId`), clef, rest:
  the keyboard's marks on an event, through the same commands.

Used as they were: `ctx.overlays` (the cross, the feedback), `ctx.execute`,
`ctx.notice`, `ctx.registerCommand`, `ctx.slots`.

## 4. State

Three signals and a few plugin-held values (`index.tsx`):

- **the mode** — `cross`, `handwriting` or `slur`, cycled in that order; the
  cross at every start.
- **the gesture** (`gesture.ts`) — idle, cross (the pen is on a staff and
  the cross is up, with the choice), or ignored (a stroke that landed off a
  staff) — idle and ignored carry the squeeze's arming, the cross whether
  it is a chord. The note length is not the plugin's: it is the editor's
  input length, read on every event and set when a cross is lifted.
- **the writing** (`handwriting.ts`) — the symbol under the pen: its
  finished strokes, the live stroke, its box, where it landed, and the
  deadline after the last lift. The next stroke joins it within the
  deadline and within the box's reach (`marginOf`: half its larger side,
  at least half a staff space — a dot reaches half a space, a sharp's
  first vertical a space and a half). The plugin keeps one `setTimeout`
  for the deadline and feeds `tick` when it fires.
- **the bow** (`bow.ts`) — the note the pen landed on, its points so far,
  where it landed; ended by the lift with the note under it, or none.
- **the ink** (`Feedback.tsx`) — the strokes under the pen, in page px,
  with the page origin of every tile the pen has crossed (`origins`,
  from each event's `at`: the sample less its tile point); every such
  tile draws them in its own frame, so a bow or a symbol shows all over
  the row (the user, 2026-11-02 — before, only the landing measure drew
  it). Drawn until the symbol is read or the bow lifted: the pen is
  captured, so nothing else would show it.
- **the feedback** (`Feedback.tsx`) — nothing, the label of what was read
  with its ✓ ✗ (gone after 3 s, ✓ by default), or the chooser — the
  belonging answers and a last row, *none of these*, that discards; beside it
  the plugin keeps what is shown — its page corner and the reading it came
  from (the symbol, its place, the events it can write on, the other
  answers) — so a pen tap can be matched to a button and ✗ can undo and
  offer the rest. Everything is placed inside the symbol's measure
  (`corner`): to its right, else to its left, and no lower than six spaces
  under the staff's middle — the next tile's layer covers what spills
  right.

## 5. Command messages

- `core.enterNote`, once per cross lifted on a staff — with `dots` when
  the length has them; `core.addChordNote` instead for an armed stroke.
- In handwriting mode, per symbol read: `core.mark` on the right
  neighbour — the note BEFORE the symbol for a dot, the note AFTER it for
  an accidental, the note in its column for an articulation, a fermata or
  a fingering (the host's `nearestNote` alone picks the wrong note when
  two are close: the plugin reads `ctx.stylus.at` just left and just right
  of the symbol's box as well, and falls back to the nearest) — or on the
  event under it (a dynamic, a rest, a clef), or `core.enterNote` for a
  drawn note over the event under its head, at the head's pitch, with the
  class's duration. `rules.ts` holds the table, one entry per class of
  granita's sidecar: its name, where it may sit (the place and the
  neighbours), what it writes or why it cannot. The place governs the
  chooser too: only the readings that belong there are offered (the user,
  2026-11-01: a fingering inside the staff must not even be in the list),
  and when none belongs a notice names the best reading. A write carries
  the other belonging answers, for the ✗; ✗ runs the host's `undo` action
  and shows them.
- The ornaments (1.3.7) are `core.mark { kind: "ornament" }` on the note
  in the column (trill, mordent, turn) or the chord after the symbol
  (arpeggio); the host sets that ornament where the key cycles them.
- The repeat marks (1.3.8) are `core.mark { kind: "repeatMark" }` on the
  event under the symbol, above or below the staff.
- A bow (1.3.9) is `core.mark { kind: "tie" | "slur", endId }` from the
  note the pen landed on to the one it lifted on, the kind by the two
  notes' written pitches (`bowKind`, accidental included; an unknown pitch
  is a slur). The host orders the pair, ties neighbours with the tie key's
  command and a longer run with its chain (every event between a link),
  slurs with the slur key's. ✗ undoes and offers the other kind.
- The quarter rest is `core.erase { id }`: the mark under the symbol
  when `nearestMark` puts one within two spaces of its centre and nearer
  than the note's head (`TOUCH_SPACES`), else the note in its column when
  the symbol is inside the staff or on the head. The host deletes a note
  or chord to rests (a chord's note naming its chord) and removes a mark
  by its id; the caret goes to the rest, or to the mark's event.
- A refusal becomes a notice, `<what> refused: …`, as the keyboard's does;
  so does a mark with no note beside it, an arpeggio on a single note, and
  a reading the table lacks (`not a symbol the editor knows`).

- A reply (1.3.10) is no message: `ctx.stylus.reply({ label, strokes,
  staffSpace, context, read })` after a write the user confirmed — ✓
  tapped, a chooser's pick, ✗ then a pick — with the symbol's strokes as
  the pen gave them (`Symbol.samples`: every sample, time and pressure),
  its context and the classifier's best answer. The silent ✓ sends none
  (the user did not say), nor does a bow (no classifier). The shell
  writes musicset's record; `train`, `resetTraining`, `shareReplies` and
  `deleteReplies` (1.3.11, asking first) are the four commands, each
  ending in a notice — and the four buttons of the plugin's section in the
  plugins page (`Replies.tsx`, the `pluginSettings` slot), which shows
  `ctx.stylus.replies()` re-read after each of them and after a reply.

## 6. Tests

- `test/gesture.test.ts` — the cross as a pure function: at the touch, and
  none off a staff; its duration steps and limits, the dots kept, the pitch
  following the pen; what a tap and a drag write; a cancel; the hold
  ignored; a chord armed, disarmed, kept, and written.
- `test/handwriting.test.ts` — strokes into a symbol: a stroke's samples
  from down to up, the clock at the lift, a stroke near and in time joining,
  one far or late ending the symbol, the reach proportional to the symbol
  with its floor, the clock ending it, a tap as a symbol, a stroke off the
  score and a cancel.
- `test/glyphs.test.ts` — every class and the two bows have a glyph or a
  drawing; the glyphs are the engraved ones; an unknown label its name.
- `test/bow.test.ts` — the note under the pen, within a space of its body;
  tie or slur by written pitch; the stroke events into a bow, and its end.
- `test/rules.test.ts` — the place in staff spaces and in words; each
  rule of the user's brief against the right and the wrong place; the
  eraser touching a note, a mark, nothing; the ornaments; a drawn note's
  pitch and duration; asking below the threshold with the top three by
  confidence; what cannot be written and why, the dropped classes among
  it; the head of a drawn note.
- `test/stylus.test.ts` — the plugin against a fake context: nothing
  without a stylus; capture, the three overlays, the header item and the
  plugins-page section;
  the cross's messages and notices; the mode switched by its command; a
  symbol gathered and read with its place, the mark written on the right
  neighbour; ✓ ✗ — ✗ undoing and the chooser taking over, ✓ and silence
  keeping it; the chooser and the pen's pick on it, its discard row, a
  tap elsewhere dismissing it; the eraser's target by distance; the
  third mode's bows — a slur, a tie, backwards, the refusals, ✗ offering
  the other kind; the rules' refusals, a refused mark and a failed
  classifier as notices; a ✓ tapped and a chooser's pick as replies with
  the symbol's samples as the pen gave them, the silent ✓, the discard row
  and a bow as none; the three training commands and their notices; the
  section's numbers read at activation and after a reply, a training and a
  delete, which asks first. The ink is drawn, not tested: it is a signal the
  overlay reads, with no React in these tests.
- The host's half is the editor's: `core.enterNote`, `core.addChordNote`
  and every kind of `core.mark` against real measures in
  `apps/editor/test/host.test.ts`; the page's shield and the geometry
  helpers in `apps/editor/test/stylus.test.ts`. The classifier is checked
  in the shell itself: debug builds run granita's fixtures through
  `stylus_recognize` at startup (`[granita]` lines in `shell.log` and
  logcat).

## 7. Dead ends

- **The hold.** The cross first waited for the shell's hold — half a
  second still — so a tap and a stroke stayed apart from it. On the
  tablets the wait was too long (the user, 2026-10-29); the cross now
  comes up at the touch, and a tap is a lift where it landed. The cost: every
  stroke on a staff steers the cross, which is why handwriting is a mode of
  its own. The shell still sends the hold; this plugin no longer reads it.
- **A length of the plugin's own.** The first version kept the length the
  last cross chose, apart from the input's; on the Galaxy tablet the user
  found two lengths one too many — the pen and the keyboard now share one.
- **Writing the note at the touch and rewriting it through the drag** —
  offered to the user and not chosen: every step would be an engraving and
  an undo step to merge, for a preview the cross gives for free.
- **The pitch from the drag's distance.** The gesture has no staff
  spacing; the host's `at` already names the step under the pen, so the
  cross follows that — but only while the pen is over the landing's staff
  in the landing's row of tiles.
- **The context from overlay props.** The plugin could have cached each
  tile's `TileOverlayProps` (staves, boxes) and derived the context itself;
  the user wanted it from the API (`ctx.stylus.at`), so every reader of the
  pen gets the same answer as the host's own.
- **A pen gesture for the mode.** The Pencil Pro's double-tap was offered
  for switching; the user chose the status-bar item alone — one way, the
  same on both tablets.

## 8. Recipe

To read a new class: granita must know it first (a release with it in the
sidecar, copied into the shell by `plugins/battuta-mobile/scripts/copy-granita.sh`);
then one entry in `rules.ts`'s table — its name, where it may sit, what
it writes — and a case in `test/rules.test.ts`. To write a new kind of
mark, the `Mark` union in `packages/api/src/messages.ts` and the host's
`core.mark` mapping must gain it first: an API change for the user to
approve, not a plugin's to make. To make the cross set something more —
dots, an accidental — add it to `Choice` and the gesture, draw it in
`Cross.tsx`, and check `core.enterNote` can carry it.
