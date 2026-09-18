/**
 * What the host knows about this plugin WITHOUT loading its code.
 *
 * Two lanes over the same events: chord symbols above the staff and Roman
 * numerals below. Both are DECLARED here, so the status bar's lane box
 * lists them before a byte of this code exists; picking one fires
 * `onLane:<id>`, the plugin activates and registers both specs, and the
 * lane opens. An entry point cannot come from the code it loads — the same
 * lesson as the on-screen keyboard's 🎹 and the lyrics lane.
 *
 * The module imports nothing but a type from `@battuta/api`: the host
 * loads it statically (it rides in the `battuta-shared` chunk), so the
 * plugin's own code must not ride along.
 */
import type { LaneContribution, PluginManifest } from "@battuta/api";

/** Chord symbols: `<harm place="above">Cmaj7</harm>`. */
export const LANE_CHORD = "battuta.harmony.chord";

/** Roman numerals: `<harm type="rna" place="below">V65</harm>`. */
export const LANE_RNA = "battuta.harmony.rna";

/**
 * The two faces, keyed by the lane id. `src/index.ts` spreads these into
 * the specs rather than retyping them, so the status-bar row and the
 * floating editor can never disagree — and the strings stay verbatim from
 * 0.0.3, which is what keeps the e2e's select and the guide reading as
 * they did.
 */
export const LANES: Record<string, LaneContribution> = {
  [LANE_CHORD]: { id: LANE_CHORD, label: "chord symbols (above)", name: "chords", glyph: "♩", place: "above" },
  [LANE_RNA]: { id: LANE_RNA, label: "roman numerals (below)", name: "numerals", glyph: "RN", place: "below" },
};

export const manifest: PluginManifest = {
  id: "battuta.harmony",
  name: "Harmony lanes",
  version: "1.0.0",
  description: "Chord symbols above the staff and Roman numeral analysis below: type at the caret, tab completes, enter commits and advances. Both are startid-anchored <harm> elements in the MEI.",
  // ^0.1.8 carries what harmony needs beyond the lanes point itself: the
  // `core.setHarm` message, `HarmKind` and `ctx.query.harmAt`. Two numbers
  // went by when the grammar came here: 0.1.7 REMOVED `ctx.query.harmValid`
  // (nobody asks the host what a chord symbol is any more), and 0.1.8
  // changed what `core.setHarm` PROMISES — it used to refuse text the
  // grammar rejected and now writes what it is given, as `core.setSyl`
  // always did.
  // ^1.0.0 — the contract as released with battuta 0.1.0 (2026-09-18). The
  // notes above name what of it this plugin needs and the 0.1.x number
  // that first carried it; the range is the release.
  engines: { battuta: "^1.0.0" },
  // The lane box is the only way in — harmony has no key, and never had
  // one. A user who never picks a harmony lane loads none of this.
  activationEvents: [`onLane:${LANE_CHORD}`, `onLane:${LANE_RNA}`],
  contributes: {
    lanes: [LANES[LANE_CHORD]!, LANES[LANE_RNA]!],
  },
  // Deliberately NOT declared: no commands and no keybindings (the union
  // keymap snapshot must stay byte-identical — harmony is picked, not
  // pressed), no capabilities, no `onStartup`, no slot item, no panel.
};
