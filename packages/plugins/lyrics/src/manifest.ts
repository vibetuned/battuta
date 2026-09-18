/**
 * What the host knows about this plugin WITHOUT loading its code.
 *
 * The host imports this module statically (it rides in the
 * `battuta-shared` chunk by design), so it must stay tiny and import
 * nothing but a type from `@battuta/api`. The lane id and the command id
 * live here as exported consts and `src/index.ts` imports them, so each is
 * written exactly once.
 *
 * The DECLARED lane is this plugin's entry point, the same lesson as the
 * on-screen keyboard's 🎹: the status bar lists the lane before a byte of
 * this code exists, and picking it fires `onLane:<id>`, which activates
 * the plugin, which registers the spec, and then the lane opens. A lane
 * that could only be listed by the code it loads could not be picked.
 */
import type { PluginManifest } from "@battuta/api";

/** The lane. Verse 1 is all 0.0.3 wrote, and the id says so rather than pretending otherwise. */
export const LANE_ID = "battuta.lyrics.verse1";

/** The command behind the `l` key: open the lane at the caret. */
export const COMMAND_OPEN = "battuta.lyrics.open";

export const manifest: PluginManifest = {
  id: "battuta.lyrics",
  name: "Lyrics lane",
  version: "1.0.0",
  description: "Type syllables under the notes: space or enter advances to the next note, - hyphenates a word across several, and the verse is written into the MEI as <syl> inside <verse>.",
  // ^0.1.5 carries the lanes point itself: `contributes.lanes`,
  // `ctx.lanes`, `core.setSyl` and `ctx.query.lyricAt` all landed in slice
  // 5a. Pinning the range it actually uses is what makes the engine check
  // worth running.
  // ^1.0.0 — the contract as released with battuta 0.1.0 (2026-09-18). The
  // notes above name what of it this plugin needs and the 0.1.x number
  // that first carried it; the range is the release.
  engines: { battuta: "^1.0.0" },
  activationEvents: [
    // Picking the lane in the status bar. The host fires this for a
    // DECLARED lane whose spec nobody has registered yet, waits, and opens
    // the lane once this plugin has registered it.
    `onLane:${LANE_ID}`,
    // The `l` key. The registry fires `onCommand:` implicitly when a
    // contributed binding matches; declaring it says the key is a wake-up
    // path, not just a call.
    `onCommand:${COMMAND_OPEN}`,
  ],
  contributes: {
    commands: [{ id: COMMAND_OPEN, title: "Lyrics lane" }],
    // `l`, with the label, group and text copied VERBATIM from 0.0.3's
    // core keymap entry — that is what keeps the shortcut editor, the
    // on-screen keyboard and the generated keyboard reference reading
    // exactly as they did. No `layouts` override: `l` exists on QWERTY and
    // AZERTY alike.
    keybindings: [
      {
        command: COMMAND_OPEN,
        keys: ["l"],
        label: "lyrics lane: type at the caret, space/enter advances, - hyphenates",
        group: "entry",
      },
    ],
    // The lane's face in the status bar, before and after the code loads.
    lanes: [
      {
        id: LANE_ID,
        label: "lyrics (verse 1, l)",
        name: "lyrics",
        glyph: "♪",
        // Lyrics go UNDER the staff; chord symbols go above. The host
        // places the floating editor from this, and knows nothing else
        // about what the lane holds.
        place: "below",
      },
    ],
  },
  // No `capabilities`: no MIDI, no workspace, no playback. And no
  // `onStartup` — a user who never presses `l` and never picks the lane
  // loads none of this.
};
