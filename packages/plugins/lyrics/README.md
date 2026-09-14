# Lyrics lane

Words under the notes. Press **l** at a note (or pick *lyrics (verse 1, l)*
in the status bar's lane box) and a text box opens under the staff: type a
syllable, **space** or **enter** writes it and moves to the next note —
skipping rests — and **-** writes it hyphenated so a word can run across
several notes (*hel-lo*). **Escape** writes what you have and leaves. The
verse is ordinary MEI (`<syl>` inside `<verse n="1">`), so a score you
typed into is a score anyone else can read. Turn it off if you only ever
set instrumental music: it then costs one line of JSON at startup.

## Turning it on and off

battuta menu → 🌣 shortcuts → **plugins** → *Lyrics lane*. Off deactivates
it at once: the **l** key goes (from the shortcut editor and the on-screen
keyboard too), the lane leaves the status bar's list, and an open lane
closes. **Syllables already in your score stay exactly as they are** — they
are notes' own MEI, not the plugin's. The switch is remembered.

## Keys

Its binding appears in the shortcut editor under the *entry* group and on
the on-screen keyboard; the generated reference is at
[reference/keyboard](../../../docs/src/content/docs/reference/keyboard.mdx).
Inside the lane the keys are the host's lane protocol, the same for every
lane: **space** / **enter** / **-** commit and advance, **← →** commit and
step, **Backspace** edits, **Escape** commits and leaves.

## Settings and storage

| Key | Where | Meaning |
| --- | --- | --- |
| — | settings | nothing |
| — | storage | nothing |

It keeps no state at all: the syllable under the caret is read from the
document every time, and everything else is the lane mechanism's.

## What it does not do

- **Verse 1 only.** `<verse n="2">` and multi-verse editing are
  [deliberately deferred](../../../docs/src/content/docs/reference/limits.mdx);
  the lane id says `verse1` so a second verse can be a second lane rather
  than a breaking change.
- **No melisma extenders.** A syllable held over several notes (`<syl
  con="u">`) is not written; `-` hyphenates, and that is the whole of the
  continuation vocabulary.
- **Nothing in entry mode.** `l` is a plain letter there and does nothing,
  as in 0.0.3 — use the status bar's lane box, which leaves entry mode for
  you.
- **Syllables hang on notes.** A commit on a rest is refused with a notice;
  an empty one is allowed, so you can carry the caret past a rest.

## Guide

[Harmony and lyrics](../../../docs/src/content/docs/guide/harmony.mdx) in
the user guide.
