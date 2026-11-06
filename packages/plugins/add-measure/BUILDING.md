# Add measure — how it was built

## 1. Origin

The user, 2026-11-05: "the plugin will add a gray measure with a + in the
middle of the staff, this will be a button that will add the ability to add
measure without the need of the keyboard, specially handy when writing
score with the stylus" — asked together with the editor's own flow at the
end of the score (a note entered at the last event makes a new measure,
`DocumentSession.advanceAfterEntry`), which the keyboard and MIDI get for
free and the pen, writing where it touches, does not.

## 2. Manifest

```
id                battuta.add-measure
engines.battuta   ^1.3.12
capabilities      none
activation        onStartup
contributes       nothing: the tile after the last measure is the whole interface
```

## 3. API surface

Added for this plugin in `@battuta/api` 1.3.12, each the ceiling the user
asked for:

- **`OverlaySpec.end`** — a renderer for the tile after the last measure, in
  the last row of edit view: the host packs a tile of a typical width after
  the last measure and gives `EndOverlayProps { measureCount, width, height,
  staves }`, the staves measured off the last tile so a drawing of them
  lines up with the row (a row holding only this tile takes the row
  before it). Nothing is mounted while no `end` is registered.
- **`core.appendMeasure`** — a measure after the last, as the keyboard's ⊞+
  makes one, whatever the caret; the new measure's rest is what it "wrote",
  so the caret goes there like after anything a plugin writes.

Used as they were: `ctx.overlays`, `ctx.execute`, `ctx.notice`.

## 4. State

None. The tile is drawn from what the host gives it; the measure is the
document's, one undo step.

## 5. Command messages

`core.appendMeasure`, on a tap. A refusal (no measure to shape the new one
after) becomes a notice.

## 6. Tests

`test/add-measure.test.ts` — the manifest's startup activation; one `end`
overlay registered; the tile a `button` marked `data-pen-tap` whose press
sends `core.appendMeasure`; a refusal as a notice; the + in the middle of
the staves (the middle line of one, between the staves of a system, the
box's middle without any). The host's half: `core.appendMeasure` in
`apps/editor/test/host.test.ts`, the session's flow at the end in
`apps/editor/test/session.test.ts`, the grid's end tile in the e2e.

## 7. Dead ends

- **A header button** would have taken the hand off the score; the user
  asked for the measure itself to be the button, where the next note goes.
- **A pen tap reaching the button by itself** does not happen: the shell
  captures the pen over the whole score area. The stylus plugin presses a
  `data-pen-tap` button under a pen tap off the staves (`tap.ts`); a finger
  or a mouse clicks it as any button.

## 8. Recipe

A plugin that draws after the score: `ctx.overlays.add({ id, end })`, draw
with the staves you are given, send a message on the tap.
