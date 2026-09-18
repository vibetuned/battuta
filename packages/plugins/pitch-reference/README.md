# Pitch reference

Load a recording of the score — your own take, a student's, a reference
performance — and see its pitch traced over the notes: over every measure
in edit view, and over the whole file in a panel at the bottom, with the
written pitch drawn on the same axis. Where the take is sharp, flat, early
or late is visible at the note, without a tuner or a DAW. The pitch is
detected in the editor (plain YIN, no service, nothing uploaded); the
recording never becomes a document and is kept only for the session.

## Turning it on and off

battuta menu → 🌣 shortcuts → **plugins** → Pitch reference. Off
deactivates it at once: the 🎙 in the header, the panel and the traces on
the tiles go, and any analysis in progress is dropped. The switch is
remembered. It has no keys, so nothing changes in the shortcut editor.

## Using it

1. Click the **🎙** in the header. The panel opens at the bottom.
2. **load a recording…** — any format the browser decodes (wav, mp3, ogg,
   flac, m4a). The pitch is detected in the background; the panel shows
   the progress; when it is done a notice says how long the take is, how
   many frames were voiced and how far the trace sits from the written
   pitch, in cents.
3. **▶ song / ▶ score** — two transports from the same white line. *song*
   plays the recording and pauses where it is. *score* plays the written
   notes through every connected MIDI output — plain notes, channel 1,
   one velocity, at the recording's pace, and in the take's register: the
   **st** value is undone on the notes, so a voice singing an octave under
   the written part hears the reference an octave under too. Drag
   anywhere on the strip to move the line;
   click a note in the score and the line goes to that note's moment in
   the recording.
4. **bar 1 at** — where the score begins in the recording. It is found
   for you at the first note; type the milliseconds if the take had a
   count-in.
5. **recorded at ♩=** — the tempo the take was played at, when it is not
   the score's. Empty means the score's tempo (the placeholder shows it).
6. **st** — transpose the trace by that many semitones before it is
   compared and drawn: a voice singing an octave below the written part is
   −12, a transposing instrument its interval. The detected pitch is
   untouched; the number is remembered with the alignment.
7. **on the score** — draw the trace over the measures in edit view. The
   trace takes the staff nearest its pitch and sits exactly on that
   measure's noteheads; a measure of rests uses the clef alone.

The strip at the bottom is the whole recording: the waveform, a tick per
measure through the alignment, the written notes as blue bars, the trace
in yellow, a dashed line where bar 1 begins, and the white playhead.

## Keys

None. The 🎙 is a header button; a key is earned when a user asks for one.

## Settings and storage

| Key | Where | Meaning |
| --- | --- | --- |
| `align:<document name>` | storage | `{ offsetMs, recordedTempo, transpose }` — the alignment you settled on for that score, restored the next time you load a recording for it. Three numbers per score; the recording itself is never stored. |

## What it does not do

- Detect a tempo from the audio. The score's tempo is the grid; the
  recording is placed on it with an offset and a rate.
- Follow rubato within the score. One offset and one rate hold for the
  whole take; measure-by-measure alignment (dynamic time warping) is the
  planned next version.
- Polyphony. YIN reads one pitch at a time — a voice, one instrument. A
  chord or two voices recorded together give a trace that jumps between
  them.
- Repeats. A repeated measure's tile shows the FIRST pass of the take.
- Sound the score by itself. *▶ score* sends plain notes to your MIDI
  outputs — no piano, no ties or articulations; the playback plugin is
  the performer. Without a MIDI output it says so and nothing sounds.
- Load a file beside the score by itself, or keep the recording between
  sessions.
- Write anything to the document.

## Guide

[Pitch reference](../../../docs/src/content/docs/guide/pitch-reference.mdx)
in the user guide.
