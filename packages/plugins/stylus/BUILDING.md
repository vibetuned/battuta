# Building the stylus plugin

The first plugin on a NATIVE host service: the pen is captured by the iOS
and Android shells, and this plugin never touches it — it reads
`ctx.stylus` events and writes `core.enterNote` messages. Written for the
next author, a person or an agent, who has this file,
`packages/plugins/README.md` and nothing else.

## 1. Origin

Phase 11, part 1 of three the user set out on 2026-10-29: notes added with
the pen, and a held pen popping a cross at its tip — left to right the
duration, top to bottom the pitch. (After trying it, the user had the
cross come up at the touch instead: §7.) (Part 2 is ABC music written by hand;
part 3 a glyph classifier of battuta's own.)

It stands on slice 1, the bridge: `StylusCapture.swift` /
`StylusCapture.kt` in the shell's `battuta-mobile` crate send strokes, a
hold, hover and the buttons to `apps/editor/src/host/stylus.tsx`, which
reads each against the score. The user's decisions for this part
(2026-10-29), each taken as asked:

| Question | Decision |
| --- | --- |
| Where does the pen write? | **Only on the score.** Elsewhere it taps like a finger; while a menu is open over the score, it taps the menu. |
| What duration does a tap give? | First answered "the last one chosen with the cross"; after trying it on the Galaxy tablet the user changed it: **the input's length** — the one digits pick, dots included. |
| What does the cross's length do to the input's? | **It becomes the input's**, as a digit would make it. |
| When is a held note written? | **On lift**: the cross previews, one undo step. |
| When does the cross come up? | First on the shell's hold (half a second still); after trying it, the user: **at the touch** — the hold was too slow. |
| What may the API gain? | `ctx.stylus`, the `core.enterNote` message and the `"stylus"` capability — **and nothing else** (1.3.0); then, for the input's length, `editor.entryDur` / `entryDots`, `core.enterNote`'s `dots` and `ctx.setEntryLength` (1.3.1). |

## 2. Manifest

```
id                battuta.stylus
engines.battuta   ^1.3.1
capabilities      stylus
activation        onPointer:coarse
contributes       nothing
```

`onPointer:coarse` wakes it on a tablet; `ctx.stylus.available` is false
everywhere but the iOS and Android shells, and `activate` returns at once
there. No command, key or slot item: the pen is the interface, and turning
the plugin off in the plugins tab is how the pen is given back.

## 3. API surface

Added for this plugin in `@battuta/api` 1.3.0, the ceiling the user
approved:

- **`ctx.stylus`** — `available`, `capture(on)`, `on(listener)`. Every
  event carries `at`: the measure, the nearest staff, that staff's event
  nearest the pen across, the step above the bottom line, the pitch there
  under the clef in force, and the point in the tile's own pixels (the
  overlays point's frame). The host computes it from the drawn page, so
  this plugin knows nothing of Verovio's layout.
- **`core.enterNote`** — `{ eventId, pname, oct, dur }`, mapped by the
  host to core's existing `ReplaceEntryCommand` inside the unbeam wrap,
  exactly what the keyboard's entry runs. No new core command.
- **capability `"stylus"`** — offered by every build, like `workspace`.
- **the input's length** (1.3.1) — `ctx.editor`'s `entryDur` and
  `entryDots`, which a tap writes and the cross starts from;
  `core.enterNote`'s `dots`; and `ctx.setEntryLength(dur, dots)`, which a
  lifted cross calls, as a digit sets the length in input mode.

Used as they were: `ctx.overlays` (the cross), `ctx.execute`,
`ctx.notice`.

## 4. State

One signal, the gesture (`gesture.ts`): idle, cross (the pen is on a
staff and the cross is up, with the choice), or ignored (a stroke that
landed off a staff and writes nothing). The note length is not the plugin's: it is the editor's input
length, read on every event and set when a cross is lifted.

## 5. Command messages

`core.enterNote`, once per stroke that lands on a staff, when the pen
lifts — with `dots` when the length has them. Refused when the note would cross a beam, tuplet or barline
(core's own rule for entry); the refusal becomes a notice, `entry refused:
…`, as the keyboard's does.

## 6. Tests

- `test/gesture.test.ts` — the gesture as a pure function: the cross at
  the touch, and none off a staff; its duration steps and their limits, the
  dots kept, the pitch following the pen on the landing's staff and not on
  another staff or row; what a tap and a drag write when the pen lifts,
  the length handed back only when the drag changed it; a cancel; the
  hold and another stroke's events ignored.
- `test/stylus.test.ts` — the plugin against a fake context: nothing
  without a stylus; capture, the overlay, the messages, the remembered
  duration, a refusal's notice.
- The host's half is the editor's: `core.enterNote` against a real score
  (a 3/4 measure rest, undone and redone) and its refusals in
  `apps/editor/test/host.test.ts`; the page's shield — a stroke that begins
  on the score is kept from the page, one that begins elsewhere is not —
  in `apps/editor/test/stylus.test.ts`. Which tile, staff and event the pen
  is over, and the score's area, are DOM and native work, checked on the
  two reference tablets.

## 7. Dead ends

- **The hold.** The cross first waited for the shell's hold — half a
  second still — so a tap and a stroke stayed apart from it. On the
  tablets the wait was too long (the user, 2026-10-29); the cross now
  comes up at the touch, and a tap is a lift where it landed. The cost is
  that every stroke on a staff now steers the cross: handwriting (part 2)
  will need a mode of its own. The shell still sends the hold; this
  plugin no longer reads it.
- **A length of the plugin's own.** The first version kept the length the
  last cross chose, apart from the input's; on the Galaxy tablet the user
  found two lengths one too many — the pen and the keyboard now share one.
- **Writing the note at the touch and rewriting it through the drag** —
  offered to the user and not chosen: every step would be an engraving and
  an undo step to merge, for a preview the cross gives for free.
- **The pitch from the drag's distance.** The gesture has no staff
  spacing; the host's `at` already names the step under the pen, so the
  cross follows that — but only while the pen is over the landing's staff
  in the landing's row of tiles (their frames sit level; another row's
  staff of the same number does not count). Off it, the pitch stays.

## 8. Recipe

To make the cross set something more — dots, an accidental — add it to
`Choice` and to the gesture's `held` branch, draw it in `Cross.tsx`, and
check `core.enterNote` can carry it: it carries a pitch letter, an octave,
a duration and dots today, and widening it is an API change for the user to
approve, not a plugin's to make.
