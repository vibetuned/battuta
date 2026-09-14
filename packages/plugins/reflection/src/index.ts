/**
 * The reflection cycle, as a plugin.
 *
 * shift+R on a block cycles the selected material through its serial
 * forms — prime → inversion → retrograde → retrograde inversion → prime.
 * Every form derives from the BASE captured at the first press, so the
 * cycle never compounds; any other edit (including an undo) re-bases it.
 *
 * Imports `@battuta/api` and this package's own files, and nothing else.
 * Reads are the query facade, the single write is a message the host
 * turns into a core command — so this plugin cannot mutate in a way the
 * host has not published, and `apps/editor/test/plugin-boundaries.test.ts`
 * fails the build if that ever stops being true.
 */
import { definePlugin, type BlockSelection, type PitchEvent, type PluginContext } from "@battuta/api";
import { COMMAND_CYCLE } from "./manifest";
import { REFLECTION_CYCLE, REFLECTION_LABELS, reflectionForm, type ReflectionForm } from "./forms";

/**
 * The live cycle: the base pitches captured at the first press, how far
 * through the four forms we are, and the document state it is valid for.
 * Transient by design — losing it costs the user one press, because the
 * next press simply re-bases from the score as it stands.
 */
interface Cycle {
  /** document id + block rectangle: a different selection is a different cycle. */
  sig: string;
  base: PitchEvent[][];
  step: number;
  /** The document version this base still describes; anything else re-bases. */
  version: number;
}

const signature = (docId: string, b: BlockSelection): string => `${docId}:${b.measureFrom}-${b.measureTo}/${b.staffFrom}-${b.staffTo}`;

export default definePlugin({
  activate(ctx: PluginContext) {
    let cycle: Cycle | null = null;
    /**
     * Set between `execute` and the host's next document publication.
     *
     * A plugin CANNOT observe the result of its own execute
     * synchronously: the host republishes `ctx.document` from the App's
     * render cycle, which has not run when execute returns, so the
     * version read back is the one from BEFORE our edit — which looks
     * exactly like somebody else's edit and re-bases the cycle on every
     * press. The flag lets the subscription below adopt the next
     * published version as ours.
     */
    let ownEditPending = false;

    ctx.subscriptions.add(
      ctx.document.subscribe((doc) => {
        if (!doc) {
          cycle = null; // no document: drop the captured base with it
          ownEditPending = false;
          return;
        }
        if (!cycle) return;
        // A different document (a new tab, a reopened file) is a
        // different cycle; DocumentInfo.id is document identity.
        if (!cycle.sig.startsWith(`${doc.id}:`)) {
          cycle = null;
          ownEditPending = false;
          return;
        }
        if (ownEditPending) {
          ownEditPending = false;
          cycle.version = doc.version; // our own edit continues the cycle
        }
      }),
    );

    ctx.registerCommand(COMMAND_CYCLE, () => {
      const doc = ctx.document.get();
      if (!doc) return;
      const state = ctx.editor.get();
      // The editor acts on the drag block when there is one, else on the
      // rectangle the event selection covers. With neither, 0.0.3 did
      // nothing and said nothing — so neither do we.
      const block = state.block ?? ctx.query.blockOf(state.selection);
      if (!block) return;

      const sig = signature(doc.id, block);
      if (!cycle || cycle.sig !== sig || cycle.version !== doc.version) {
        cycle = { sig, base: ctx.query.pitchEventsIn(block), step: 0, version: doc.version };
      }
      if (cycle.base.length === 0) {
        ctx.notice("reflection refused: no notes in the selection");
        return;
      }

      // Walk the cycle until a form applies to every voice: retrograde is
      // impossible over non-mirroring chord sizes and is skipped, which
      // still advances the step so the user's next press moves on.
      let targets: PitchEvent[] | null = null;
      let form: ReflectionForm = "prime";
      let skipped = false;
      for (let attempts = 0; attempts < REFLECTION_CYCLE.length && !targets; attempts++) {
        form = REFLECTION_CYCLE[cycle.step % REFLECTION_CYCLE.length]!;
        cycle.step++;
        const per = cycle.base.map((seq) => reflectionForm(seq, form));
        if (per.every((t) => t !== null)) targets = per.flatMap((t) => t!);
        else skipped = true;
      }
      if (!targets) {
        ctx.notice("reflection refused: nothing to transform");
        return;
      }

      try {
        ownEditPending = true;
        ctx.execute({ type: "core.setPitches", targets, label: form });
        ctx.notice(`reflection: ${REFLECTION_LABELS[form]}${skipped ? " (retrograde skipped: chord sizes don't mirror)" : ""}`);
      } catch (err) {
        ownEditPending = false;
        ctx.notice(`reflection refused: ${err instanceof Error ? err.message : err}`);
      }
    });
  },
});
