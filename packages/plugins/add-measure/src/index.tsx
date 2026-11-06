/**
 * The add-measure plugin (the user, 2026-11-05): "a gray measure with a +
 * in the middle of the staff" after the last measure, a button that adds a
 * measure without the keyboard — handy when writing with the stylus. It is
 * the overlays point's `end` tile (1.3.12) and one message,
 * `core.appendMeasure`; the caret goes to the new measure's rest, as it
 * goes to anything a plugin writes. Nothing else: no commands, no keys.
 */
import { definePlugin, type PluginContext } from "@battuta/api";
import { OVERLAY_ID } from "./manifest";
import { Plus } from "./Plus";

export default definePlugin({
  activate(ctx: PluginContext) {
    const add = (): void => {
      try {
        ctx.execute({ type: "core.appendMeasure" });
      } catch (err) {
        ctx.notice(`add measure refused: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    ctx.overlays.add({ id: OVERLAY_ID, end: (end) => <Plus end={end} onAdd={add} /> });
  },
});
