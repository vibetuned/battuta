# On-screen keyboard

Every battuta action is a keystroke, which is a problem on a tablet. This
plugin puts the whole keymap on screen: a two-octave piano that enters
notes exactly as a MIDI controller does, sticky **alt** and **shift**
latches, a digit pad that becomes durations, voltas, fingering or finger
change depending on the latch, and one button per action — generated from
your *live* bindings, so a rebind or a brand-new action (core's or another
plugin's) shows up on its own. On a touch device it opens by itself; with
a mouse it doubles as a clickable cheat sheet, and the latch relabelling
is a quick way to discover what shift or alt does to a key before pressing
it. Turn it off if you only ever use a physical keyboard: it then costs
you one line of JSON at startup and nothing else.

## Turning it on and off

battuta menu → 🌣 shortcuts → **plugins** → *On-screen keyboard*. Off
deactivates it at once: the panel closes, the **🎹** leaves the header row,
and the "on-screen piano" disappears from the MIDI device list. No
document changes — the panel never edits anything itself, it only runs the
editor's own actions. The switch is remembered.

Inside the editor: **🎹** in the header puts the panel up and puts it away
again (it dims while the panel is down), its **×** hides it too, and that
choice is remembered — leave it up and it is up again next time you open
battuta.

## Keys

This plugin contributes **no keybinding of its own** — it is a projection
of everybody else's. What each button does is what the bound key does; the
generated reference is at
[reference/keyboard](../../../docs/src/content/docs/reference/keyboard.mdx),
and the shortcut editor (🌣) is the live list.

## Settings and storage

| Key | Where | Meaning |
| --- | --- | --- |
| `open` | settings (`battuta.settings.v1` → `plugins["battuta.onscreen-keyboard"].values`) | is the panel up? Absent means "up on a touch device, down otherwise". Written when you use 🎹 or ×, never by the automatic touch-device open. Migrated once from the pre-0.1.0 top-level `vkeys`. It is also what brings the panel back at startup (`onSettings:open`). |
| — | storage | nothing |

## What it does not do

- **No ctrl latch.** Every ctrl chord the editor has is its own button in
  the *system* group (save, open, undo, redo, copy, paste, zoom), so the
  latch's only remaining power was reaching chords nobody meant to press.
- **It cannot type.** While a lyrics or harmony lane is open, the lane owns
  the keyboard; the panel's buttons do nothing until you leave it — and
  there is no ⏎ button, because "commit the lane" is not an action the host
  names.
- **It shows no button the editor cannot run.** A button appears only for
  an action the host actually has, so a latch that reaches nothing dims
  rather than lying — including another plugin's binding when you turn that
  plugin off.
- **It never edits the score.** Buttons run the editor's named actions; the
  piano feeds the MIDI service. Nothing here writes to a document.

## Guide

[The on-screen keyboard](../../../docs/src/content/docs/guide/virtual-keyboard.mdx)
in the user guide.
