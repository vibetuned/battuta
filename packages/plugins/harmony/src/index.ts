/**
 * The harmony lanes, as a plugin.
 *
 * Two lanes over the same events — chord symbols above the staff, Roman
 * numeral analysis below — on the host's `lanes` point. Pick one in the
 * status bar's lane box and a text box opens at the caret: type, Tab takes
 * the first completion, Enter commits and moves to the next event, Escape
 * commits and leaves.
 *
 * The two specs differ in four values (id/face, place, the transform, and
 * which grammar they ask about), so they are one function of `kind`. What
 * is NOT here is as telling: no buffer, no key handling, no floating
 * editor, no advance logic — all the host's since slice 5a. What IS here
 * is the editor's opinion about the text: what may be typed and what is
 * offered. What a symbol IS stays core's, asked through
 * `ctx.query.harmValid` (2026-09-15: validity sits below every writer).
 *
 * Imports `@battuta/api` and this package's own files, and nothing else.
 * The single write is a `core.setHarm` message the host turns into core's
 * `SetHarmCommand`.
 */
import { definePlugin, type HarmKind, type LaneSpec, type PluginContext } from "@battuta/api";
import { LANE_CHORD, LANE_RNA, LANES } from "./manifest";
import { CHARS, suggestions, transformRna } from "./grammar";

/** Which lane id is which grammar — the one mapping the two halves share. */
const KIND: Record<string, HarmKind> = { [LANE_CHORD]: "chord", [LANE_RNA]: "rna" };

export default definePlugin({
  activate(ctx: PluginContext) {
    const spec = (laneId: string): LaneSpec => {
      const kind = KIND[laneId]!;
      const face = LANES[laneId]!;
      return {
        ...face,
        // A harmony hangs on any event, rests included — it is an
        // annotation of the beat, not of a note. (Lyrics are the opposite,
        // and that is why `attachesTo` exists.)
        attachesTo: "event",
        advance: "event",
        // Enter alone: unlike lyrics, no character of the grammar may
        // double as a commit key — "/" and "-" are part of chord symbols.
        advanceOn: ["Enter"],
        hint: `${kind === "rna" ? "roman numerals" : "chord symbols"}: type at the caret · enter commits + advances · tab completes · esc leaves`,
        accepts: (ch) => CHARS[kind].test(ch),
        // Only the numeral lane rewrites keys (`o` → `°`, `0` → `ø`); the
        // chord lane takes what is typed.
        ...(kind === "rna" ? { transform: transformRna } : {}),
        // Validity is core's grammar, asked through the api: the host
        // refuses an incomplete buffer with a notice before a message is
        // built, and `core.setHarm` would refuse the same text anyway.
        complete: (buffer) => ctx.query.harmValid(kind, buffer),
        suggest: (buffer) => suggestions(kind, buffer, ctx.query.harmValid),
        read: (eventId) => ctx.query.harmAt(eventId, kind),
        // Unchanged text writes nothing — no command, no undo step — which
        // matters here because Enter walks the caret along a row of events
        // that mostly have no harmony at all.
        commit: ({ eventId, buffer }) => (buffer === ctx.query.harmAt(eventId, kind) ? null : { type: "core.setHarm", eventId, kind, text: buffer }),
      };
    };

    ctx.lanes.register(spec(LANE_CHORD));
    ctx.lanes.register(spec(LANE_RNA));
  },
});
