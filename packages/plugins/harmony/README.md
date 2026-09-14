# Harmony lanes

Two lanes of analysis over the same music: **chord symbols** above the
staff (`Cmaj7`, `F#m7b5`, `G/B`) and **Roman numerals** below (`V65`,
`vii°7`, `Ger+6`). Pick one in the status bar's lane box and a text box
opens at the caret: type, **Tab** takes the first completion, **Enter**
writes it and moves to the next event, **Escape** writes it and leaves.
Both are ordinary MEI — startid-anchored `<harm>` elements — so tiles,
copy/paste and undo treat them like any other control event, and a score
you analysed is a score anyone else can read. The two lanes are
independent: an event can carry a chord symbol, a numeral, both, or
neither.

## Turning it on and off

battuta menu → 🌣 shortcuts → **plugins** → *Harmony lanes*. Off
deactivates it at once: both lanes leave the status bar's lane box and an
open one closes (with no lanes left at all, the box hides itself). **The
harmony already in your scores stays exactly as it is** — it is the
document's MEI, not the plugin's. The switch is remembered.

## Keys

This plugin contributes **no keybinding** — and never had one: harmony is
picked from the lane box, not pressed. Inside a lane the keys are the
host's lane protocol, the same for every lane: **Enter** commits and
advances, **← →** commit and step, **Tab** takes the first suggestion,
**Backspace** edits, **Escape** commits and leaves.

Two conveniences are this plugin's own:

- **completions** — after a root or a numeral, the six nearest symbols are
  offered beside the buffer;
- **`o` → `°` and `0` → `ø`** in the numeral lane, for the two glyphs no
  keyboard has.

## Settings and storage

| Key | Where | Meaning |
| --- | --- | --- |
| — | settings | nothing |
| — | storage | nothing |

It keeps no state: what is under the caret is read from the document every
time, and the buffer belongs to the lane mechanism.

## What it does not do

- **It does not decide what a symbol is.** The grammar that accepts
  `Cmaj7` and rejects `Csus3` is the document core's, and every writer of
  a harmony is held to it — this lane asks it through the api, so a
  buffer the editor shows in red cannot be committed, and a generator
  plugin writing harmonies would be refused the same text. What this
  plugin owns is the typing: which keys extend a buffer, what `o` becomes
  in the numeral lane, and what is offered as a completion. Turn the
  plugin off and that goes with it — the harmony already written stays,
  because that is the document's.
- **Verse-style figured bass** is
  [deliberately deferred](../../../docs/src/content/docs/reference/limits.mdx);
  these two lanes are chord symbols and Roman numerals, nothing else.
- **No analysis.** Nothing here derives a numeral from the notes; you type
  what you hear.
- **No transposition follow-up.** Transposing the music does not rewrite a
  chord symbol — the text is yours.

## Guide

[Harmony and lyrics](../../../docs/src/content/docs/guide/harmony.mdx) in
the user guide.
