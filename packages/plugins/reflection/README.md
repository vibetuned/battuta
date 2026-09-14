# Reflection cycle

The classic serial forms of a passage, on one key. Select a block of
music and press <kbd>shift</kbd> + <kbd>r</kbd> repeatedly: the selection
becomes its **inversion**, then its **retrograde**, then its **retrograde
inversion**, then the original again. Inversion is diatonic, mirrored
about each voice's first note; retrograde reverses the pitch content
across the rhythm as it stands. Only pitch content moves — durations,
rests and everything else stay exactly where they are, so the measures
remain valid and a full cycle restores the file byte for byte. Each press
is one undo step, and every form derives from the state captured at the
first press, so the cycle never compounds.

Turn it off if you do not write serial music: you lose one key and
nothing else, and no score you have ever edited with it changes.

## Turning it on and off

battuta menu → 🌣 shortcuts → **plugins** → Reflection cycle. Off
deactivates it at once: the binding leaves the shortcut editor, the
on-screen keyboard stops captioning the shifted **rest** key "reflect",
and <kbd>shift</kbd> + <kbd>r</kbd> does nothing. No reload, and no
change to any document. The switch is remembered; a rebind of its key
survives off and on.

## Keys

One binding, in the *rhythm* group, applying to a block selection. It
appears in the shortcut editor (marked ⚡ as contributed by a plugin) and
on the on-screen keyboard as the shift latch on the **rest** key; the
generated list is in the [keyboard reference](../../../docs/src/content/docs/reference/keyboard.mdx).
Rebind it there like any core key.

## Settings and storage

None. The plugin keeps the running cycle in memory only — which block,
which pitches it started from, how far through the four forms you are —
and writes no settings key and no storage key. Losing that state costs
you one press: the next one re-bases from the score as it stands.

## What it does not do

- **Nothing chromatic.** Inversion is a diatonic mirror; it does not
  preserve interval quality, and it is not a twelve-tone operation.
- **No transposition of the row.** There is no T*n*; the anchor is always
  each voice's own first note.
- **No structure moves.** Retrograde moves pitch sets between events, so
  it needs the chord sizes in the passage to mirror each other; when they
  do not it is skipped with a notice rather than rewriting the rhythm.
- **No state in your score.** Nothing marks a passage as "inverted" —
  the result is ordinary notes, indistinguishable from ones typed by hand.

## Guide

[Arranging → Serial forms](../../../docs/src/content/docs/guide/arranging.mdx)
