# Stylus

Write with the **Apple Pencil** or the **S Pen**, in edit view, on the
iPad and Android tablets — three ways, cycled by the **✎** item in the
header, beside the other plugins' buttons: **the cross**, for notes; **handwriting**, for the symbols
around them; and **slurs and ties**, drawn from note to note.

## The cross

- **Touch** a staff: a small cross comes up at the tip, with a ghost
  notehead where the note will go — the pitch under the pen, at the
  input's length (the one digits 1–7 pick in input mode, dotted if you
  dotted it).
- **Drag**, and past a few pixels the cross **unfolds** into two rulers
  that cross like a crossword's words. Across, above the staff, a cell for
  every length as an engraved note, each where the pen has to be to
  choose it: drag **right** for a longer note and **left** for a shorter
  one (whole down to 64th; a dot stays). Down through the note, a letter
  for every step of the staff at its height — the lines' letters on the
  left, the spaces' on the right: drag **up and down** for the pitch, a
  step at a time. The choice is lit in both, the pitch with its octave,
  and pulses at every change. The rulers reach over the neighbouring
  measures, which no longer cover them.
- **Lift** the pen to write it, over the note or rest nearest where it
  landed on that staff, the way the keyboard enters a note: a shorter note
  leaves rests for the rest of the time, a longer one takes the events
  after it. A length you dragged to becomes the input's, as if you had
  typed the digit — the next note and the keyboard use it. A **tap** is a
  lift where you touched: the note as the cross first showed it.

**Chords.** Squeeze the Apple Pencil Pro, or press the S Pen's side
button, then touch above or below a note: the cross follows the pitch
only — the letters, no ruler across — and lifting
adds that pitch to the note — or to the
chord it already is — at its own length. A press arms just the next
stroke; press again before touching to disarm it. Holding the S Pen's
button as the tip lands works too. A chord can't be built on a rest, and
a pitch the chord already has is refused.

The key signature supplies the accidental. Every note is one undo step,
and the caret goes to the note you wrote — or to the chord it joined.

## Handwriting

Tap **✎ cross** in the header: it reads **✎ hand**, and the pen
writes symbols instead. Write one as you would on paper, at its natural
size, where it belongs — a sharp just left of its note, a dot just right
of it, a staccato above it, a fingering or a trill above the staff, a
dynamic below it, a clef on the staff, a note with its head where the
pitch is. The strokes that follow each other closely are one symbol: within
about half a second of the last lift, and within reach of what is drawn
— half its size, at least half a staff space, so a sharp's four strokes
join while a staccato written right after one on the next note is its
own. A moment after the last lift the symbol is read by **granita**,
battuta's own classifier, which runs in the app and sends nothing
anywhere.

The strokes show in blue as you write, until the symbol is read. What it
reads is put in the score as the keyboard would put it, one undo step,
and a small label shows what was read **as it is engraved** — ♯, 𝅘𝅥, a
note wearing its staccato, 𝆑𝆑 — and how sure it was (93 %), with a **✓
✗** beside it for three seconds: tap ✓, or nothing,
and it stays; tap ✗ and it is undone, and the other readings are offered
to choose from. The caret goes to the event it was put on. The rules of
notation settle what the shapes cannot: a dot is an augmentation dot on
the note before it and a staccato on the note under or over it;
accidentals go on the note after them; fingerings, dynamics and
ornaments are never inside the staff; a clef only inside it, at the start
of its measure.

**The eraser.** A **quarter rest** is never written: it erases. Draw one
on a note and the note becomes a rest of its length, as the Delete key
does it (on one note of a chord, the whole chord); draw one on a
fingering, a dynamic, a fermata or an ornament and that mark goes. The
other rests are not written either — rests are what notes do not take: a
shorter note entered with the cross leaves them.

**When it isn't sure** — the best reading under 50 % — up to three
choices appear beside the symbol, each as engraved, with their
percentages: only readings
that belong where you wrote (no fingering inside the staff, no rest above
it). Tap one with the pen (or a finger) to write it, **none of these** —
the last row — to discard the symbol, or write somewhere else to dismiss
them. When nothing it read belongs there, a notice says
so and names the best reading. Everything stays inside the measure you
wrote in: beside the symbol, or to its left near a barline.

**What it reads** (granita's battuta set, 43 symbols): the accidentals
(sharp, flat, natural), staccato, tenuto, accent, staccatissimo and
marcato, the augmentation dot, the fermata, fingerings 1–5, the ornaments
(a trill, mordent or turn above its note, an arpeggio just left of its
chord), the dynamics (`p` to `fff`, `sfz`, `sf`, `fz`), notes from whole
to 16th (entered over the event under the head, at the head's pitch), the
G, F and C clefs, the repeat marks (the coda and segno signs, *Fine*,
*D.S.* and *D.C.*, above or below the staff, on the event under them) —
and the quarter rest, which erases.

A note is measured by its **body** — head, stem and flag, a chord's as
one — so "left of the note", "above it" and "on it" are read against
that box, half a space to spare: a staccato over the stem's end is above
the note, a dot beside its head is right of it.

## Slurs and ties

Tap **✎ hand**: it reads **✎ slur**, and the pen draws bows. Touch a note
(or a chord — its head, its stem, up to a space around), draw to another
note and lift on it: the two are **tied** when they are the same note —
the same written pitch, accidental included — and **slurred** otherwise.
Either direction. A tie between notes that are not neighbours ties every
note between them, as the keyboard's tie does over a selection, so all of
them must be that pitch; the editor refuses anything else with a notice,
as it refuses a tie between different pitches. The bow is written as it
is lifted, with the ✓ ✗ of handwriting: ✗ undoes it and offers the other
kind. Lifting off a note, or on the note you started from, writes
nothing and says so; landing off a note draws nothing.

In every mode the pen writes **only on the score**: everywhere else —
the toolbar, the panels, the on-screen keyboard, a menu open over the
score — it taps like a finger. On the score, a tap on nothing of it
presses what asks for the pen there: the gray **+** measure after the
last one (the *Add measure* plugin) adds a measure, so a score grows
without the keyboard. Fingers scroll and zoom as always, even while the
pen writes.

## Replies and training

The classifier learns from you — when you tell it. A reading you confirm
with **✓**, pick from the chooser, or pick after a **✗** is a **reply**:
the class the symbol was, with the strokes as the pen gave them (every
sample, its time and pressure), where it sat, and what the classifier
read. A reading you leave alone is not: you did not say. Replies are kept
on the tablet, in the app's own data (`stylus/replies.jsonl`, one a line
in musicset's contribution format), never sent anywhere; they are
battuta's dataset for the next granita.

The plugin's row in battuta menu → 🌣 shortcuts → **plugins** shows the
replies kept on this tablet, how many of them the buffer would take, and
the layer reading now — the released classifier, or the last training
with its numbers — and four buttons: **train**, **reset**, **share** and
**delete replies** (it asks first; the classifier keeps what it learnt
until you reset it). The same as commands, bindable to a key in 🌣
shortcuts:

- **Stylus: train on my replies** retrains the classifier's last layer
  on the tablet from every reply — well under a second — and reads with
  it from then on; the notice says how many replies, how many of the
  newest eight of each class it trained on, and how far it drifted from
  the released model's answers, which it is held to.
- **Stylus: reset the training** puts the released classifier back. The
  replies stay.

A new release of the classifier forgets the trained layer: it was trained
on the old classifier's reading of your symbols. The replies stay; train
again.
- **Stylus: share my replies** puts the file on the share sheet — AirDrop,
  Mail, Files, another app — to contribute it.
- **Stylus: delete my replies** deletes the file, after asking.

## Turning it on and off

battuta menu → 🌣 shortcuts → **plugins** → *Stylus*. Off gives the pen
back to the page everywhere. The switch is remembered; the mode is not —
every start is the cross. On the desktop and in a browser there is no
stylus to capture, and the plugin does nothing, not even the ✎ item.

## Keys

None: the pen is the whole interface. The ✎ item runs *Stylus: the cross,
handwriting or slurs*; the four replies commands above have no key of
their own.

## Settings and storage

| Key | Where | Meaning |
| --- | --- | --- |
| — | settings | nothing |
| — | storage | nothing |

The length is the editor's own input length; the plugin keeps none.

## What it does not do

- **No rests, pedal, double accidentals, 32nd or 64th notes, or barline
  by hand**: rests are what notes leave and the quarter rest is the
  eraser; a pedal needs the event it ends on; the editor has no double
  flat and the double sharp, the short notes and the barline are not in
  granita's set (the cross writes any note exactly).
- **The eraser does not take an articulation, an accidental or a dot**:
  they are part of their note — write the same mark again to remove it,
  or erase the note.
- **An arpeggio on a single note** is refused by the editor: it rolls a
  chord.
- **Not in page view**, where there are no measure tiles to write on.
