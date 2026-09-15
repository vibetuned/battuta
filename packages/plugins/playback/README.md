# Playback

Auditioning what you edited. Switch to **page view** and a transport row
appears in the header's second row, beside the score's title and ♩= tempo:
play/pause, stop, a speed select from 0.5× to 2×, a **MIDI** box that
sends to every connected output instead of the built-in piano, a
semitone transpose for those sends, a clickable progress bar and an
elapsed/total readout. What you hear is the score's *form* — repeats,
voltas and one D.S./D.C. jump expanded — with tie chains sounding as one
held note and articulations shortening the release; the notes light up on
the page as they sound, and the view follows the music. The same
performance can be written to a file: **export playback MIDI** in the
battuta menu. Turn it off if you only ever set notation and never listen:
Tone.js and a 2 MB sampled piano then never load, and page view has no
row at all.

## Turning it on and off

battuta menu → 🌣 shortcuts → **plugins** → *Playback*. Off deactivates it
at once: the transport row leaves page view, the **export playback MIDI**
entry leaves the battuta menu, anything sounding is released, any MIDI
ports it opened are handed back, and the highlight is cleared. **Your
score does not change** — playback only ever reads it. The switch is
remembered.

## Keys

None. Playback has no keybinding and never had one: the row is the whole
interface, and it is in page view where it applies. Nothing of this
plugin appears in the shortcut editor or on the on-screen keyboard.

## Settings and storage

| Key | Where | Meaning |
| --- | --- | --- |
| `tempo` | settings | Speed multiplier on the score's own tempo; one of 0.5, 0.75, 1, 1.25, 1.5, 2. Default 1. |
| `midiOut` | settings | Play to the connected MIDI outputs instead of the piano. Default off. |
| `midiTranspose` | settings | Semitones added to the MIDI sends and to the playback-MIDI export (±12 offered, ±24 accepted). Default 0. Never applied to the piano. |
| — | storage | nothing |

All three were editor settings until 0.1.0 and are carried into this
plugin's namespace once, automatically, the first time you run this
version.

## What it does not do

- **No selection playback.** Play is always from the top (or from where
  you seek to); playing just the block you selected is not built.
- **No instrument choice, no volume, no mixer.** One sampled piano, one
  velocity. The MIDI box is the way to hear anything else.
- **Nothing is written to the score.** No playback markings, no cached
  timings — with every plugin off, your MEI is byte-identical.
- **An edit stops it.** Every stamp in the schedule came from the
  document as it was, so any command, undo or redo stops playback rather
  than drifting out of sync.
- **Page view only.** In tile view there is no row and no sound; leaving
  page view stops the player.
- **The export is named for the score, not for the player.** See §7 of
  `BUILDING.md`: reproducing 0.0.3's `<score>-playback.mid` needs one
  thing the API does not yet carry.

## Guide

[Playback](../../../docs/src/content/docs/guide/playback.mdx) in the user
guide.
