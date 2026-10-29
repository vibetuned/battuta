# Stylus

Write notes with the **Apple Pencil** or the **S Pen**, in edit view, on
the iPad and Android tablets.

- **Touch** a staff: a cross comes up at the tip, with a label saying
  what lifting the pen will write — the pitch under the pen, at the
  input's length (the one digits 1–7 pick in input mode, dotted if you
  dotted it).
- **Drag** **right** for a longer note and **left** for a shorter one
  (whole down to 64th; a dot stays), **up and down** for the pitch — a
  step of the staff at a time, a ghost notehead showing where it goes.
- **Lift** the pen to write it, over the note or rest nearest where it
  landed on that staff, the way the keyboard enters a note: a shorter note
  leaves rests for the rest of the time, a longer one takes the events
  after it. A length you dragged to becomes the input's, as if you had
  typed the digit — the next note and the keyboard use it. A **tap** is a
  lift where you touched: the note as the cross first showed it.

**Chords.** Squeeze the Apple Pencil Pro, or press the S Pen's side
button, then touch above or below a note: the cross says "chord", follows
the pitch only, and lifting adds that pitch to the note — or to the
chord it already is — at its own length. A press arms just the next
stroke; press again before touching to disarm it. Holding the S Pen's
button as the tip lands works too. A chord can't be built on a rest, and
a pitch the chord already has is refused.

The key signature supplies the accidental. Every note is one undo step,
and the caret goes to the note you wrote — or to the chord it joined.

The pen writes **only on the score**: everywhere else — the toolbar, the
panels, the on-screen keyboard, a menu open over the score — it taps like
a finger. Fingers scroll and zoom as always, even while the pen writes.

## Turning it on and off

battuta menu → 🌣 shortcuts → **plugins** → *Stylus*. Off gives the pen
back to the page everywhere. The switch is remembered. On the desktop and
in a browser there is no stylus to capture, and the plugin does nothing.

## Keys

None: the pen is the whole interface.

## Settings and storage

| Key | Where | Meaning |
| --- | --- | --- |
| — | settings | nothing |
| — | storage | nothing |

The length is the editor's own input length; the plugin keeps none.

## What it does not do

- **No accidentals or rests** yet: a tap on a note replaces it, and the
  cross sets a duration and a staff step, keeping the input's dots,
  nothing more.
- **No handwriting.** Every stroke on a staff steers the cross; reading
  written music is the plugin's later parts.
- **Not in page view**, where there are no measure tiles to write on.
