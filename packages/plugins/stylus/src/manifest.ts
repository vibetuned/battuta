/**
 * What the host knows about this plugin WITHOUT loading its code. The
 * module imports nothing but a type from `@battuta/api`: the host loads it
 * statically (it rides in the `battuta-shared` chunk), so the plugin's own
 * code must not ride along.
 */
import type { PluginManifest } from "@battuta/api";

/** The overlay's id on the host's overlays point (the `data-overlay` hook): the cross at the tip. */
export const OVERLAY_ID = "cross";
/** The overlay of the strokes being written, since the page draws nothing of a captured pen. */
export const INK_ID = "ink";
/** The overlay of handwriting's answer: the label of what was read with its ✓ ✗, or the chooser. */
export const FEEDBACK_ID = "handwriting";
/** The command the status-bar item runs: the cross or handwriting. */
export const MODE_COMMAND = "battuta.stylus.mode";
/** The replies and the training (1.3.10): what the shell learnt from the user, and the file it keeps. */
export const TRAIN_COMMAND = "battuta.stylus.train";
export const RESET_TRAINING_COMMAND = "battuta.stylus.resetTraining";
export const SHARE_REPLIES_COMMAND = "battuta.stylus.shareReplies";
export const DELETE_REPLIES_COMMAND = "battuta.stylus.deleteReplies";

export const manifest: PluginManifest = {
  id: "battuta.stylus",
  name: "Stylus",
  version: "1.4.0",
  description: "Write with the Apple Pencil or the S Pen, two ways. The cross: touch a staff, drag the cross at the tip to set the length (across) and the pitch (up, down), lift to write; squeeze, or press the side button, to add to a chord. Handwriting: write a symbol on the staff — a sharp, a dot, a dynamic, a note — and granita, battuta's own reader, puts it in the score. Slurs and ties: draw from a note to another. The ✎ item in the header switches. iPad and Android tablets.",
  // ^1.3.0 carries `ctx.stylus`, the capability and `core.enterNote`; 1.3.1
  // the input's length (`editor.entryDur` / `entryDots`, `setEntryLength`)
  // and `core.enterNote`'s dots; 1.3.2 `core.addChordNote`; 1.3.3 the caret
  // going to what those two wrote — all for this plugin, approved by the
  // user on 2026-10-29. 1.3.5 (approved 2026-11-01) carries handwriting's:
  // the staff, measure and nearest notehead in `StylusScorePoint`,
  // `ctx.stylus.at`, `ctx.stylus.recognize` and `core.mark`. 1.3.7
  // (approved 2026-11-02): the ornament mark, `nearestMark` and
  // `core.erase`, the quarter rest's. 1.3.8 (the same day, granita v8):
  // the note's body in `nearestNote`, its size in the context, the
  // repeat-mark kind. 1.3.9 (the same day): the tie and slur marks and the
  // note's written pitch in `nearestNote`, for the bows. 1.3.10: the replies
  // (`ctx.stylus.reply`) and the training (`train`, `resetTraining`,
  // `shareReplies`). 1.3.11: the plugins-page section (`pluginSettings`),
  // `replies` and `deleteReplies`.
  engines: { battuta: "^1.3.11" },
  activationEvents: [
    // A tablet: the only devices with a stylus the shell captures. On any
    // other touch device `ctx.stylus.available` is false and the plugin
    // does nothing.
    "onPointer:coarse",
  ],
  capabilities: ["stylus"],
  // The one command: the mode, run by the status-bar item the plugin adds
  // at runtime once it knows there is a stylus (a declared item would show
  // on the desktop too, where there is none). No keys: the pen is the
  // interface, and the score is where it is used.
  contributes: {
    commands: [
      { id: MODE_COMMAND, title: "Stylus: the cross, handwriting or slurs" },
      { id: TRAIN_COMMAND, title: "Stylus: train on my replies" },
      { id: RESET_TRAINING_COMMAND, title: "Stylus: reset the training" },
      { id: SHARE_REPLIES_COMMAND, title: "Stylus: share my replies" },
      { id: DELETE_REPLIES_COMMAND, title: "Stylus: delete my replies" },
    ],
  },
};
