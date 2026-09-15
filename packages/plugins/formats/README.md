# Format converters

Everything battuta reads and writes beyond its own MEI. Open a
**MusicXML** (`.musicxml`, `.xml`, or a zipped `.mxl`), an **ABC** tune, a
**Plaine & Easie** incipit or a **Humdrum** `**kern` score and it is
converted to MEI as it opens — arriving as a **new unsaved tab** named
after the file, so a plain ctrl+s can never overwrite your source with
MEI. In the other direction the battuta menu gains three rows: **export
MIDI (written score)** (what the page says, not what the player does with
repeats and ties — that is the [playback](../playback/) plugin's export),
**export Humdrum kern** and **export Plaine & Easie**. All of it is
Verovio's Humdrum-enabled build, running in this plugin's own worker,
fetched the first time you actually convert something. Turn it off if you
only ever work in MEI: the ~13 MB toolkit is then never downloaded at
all.

## Turning it on and off

battuta menu → 🌣 shortcuts → **plugins** → *Format converters*. Off
deactivates it at once: the open dialog goes back to listing `.mei`
alone, the three export rows leave the menu, and the toolkit is released
if it had been loaded. **Scores you already imported are untouched** —
they became ordinary MEI documents the moment they opened. The switch is
remembered.

## Keys

None. Importing happens through **open file…** (ctrl+o) and exporting
through the battuta menu; neither is a binding, and nothing of this
plugin appears in the shortcut editor or on the on-screen keyboard.

## Settings and storage

| Key | Where | Meaning |
| --- | --- | --- |
| — | settings | nothing |
| — | storage | nothing |

It keeps no state between sessions. Within one, it keeps the conversion
worker alive after the first use, so every conversion after that is
immediate.

## What it does not do

- **No MusicXML export.** Verovio does not have one; MusicXML is
  import-only. The table in `src/manifest.ts` is held against the real
  toolkit by a test, so it can never promise what Verovio cannot do.
- **No SVG.** That export is still the editor's own, because it is the
  engraved page from the render pool rather than a conversion.
- **No round-trip guarantee.** An import converts once, on open. What you
  then edit and save is MEI — the original file is never written back to,
  and re-exporting to the format you came from is not the same file.
- **Nothing is converted until you ask.** Opening the app, or an `.mei`,
  loads none of this — not the plugin, not the toolkit.
- **No format detection beyond extension and root element.** A `.xml` is
  MEI unless its root says `score-partwise` / `score-timewise`; an
  extension nothing claims is refused with a notice. Detection is the
  editor's, from what this plugin declares.

## Guide

[Files, import and export](../../../docs/src/content/docs/guide/files.mdx)
in the user guide.
