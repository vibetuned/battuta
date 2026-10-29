/**
 * The stylus plugin (1.3.0, phase 11 part 1): notes written with the Apple
 * Pencil or the S Pen. The pen is the host's — `ctx.stylus` captures it on
 * the score and reads every event against it — and a note is a
 * `core.enterNote` message, the keyboard's own overwrite entry; this
 * plugin is the gesture between the two (`gesture.ts`) and the cross that
 * shows it (`Cross.tsx`, on the overlays point).
 */
import { definePlugin, type PluginContext } from "@battuta/api";
import { Cross } from "./Cross";
import { IDLE, lengthOf, next, type Gesture } from "./gesture";
import { OVERLAY_ID } from "./manifest";
import { signal } from "./store";

export default definePlugin({
  activate(ctx: PluginContext) {
    // Anything but the iOS and Android shells: no stylus to capture.
    if (!ctx.stylus.available) return;
    const gesture = signal<Gesture>(IDLE);
    ctx.overlays.add({ id: OVERLAY_ID, render: (tile) => <Cross tile={tile} state={gesture} /> });
    ctx.stylus.on((e) => {
      const { entryDur, entryDots } = ctx.editor.get();
      const step = next(gesture.get(), e, lengthOf(entryDur, entryDots));
      gesture.set(step.gesture);
      if (!step.write) return;
      try {
        ctx.execute(step.write);
        // The cross's length becomes the input's, as a digit would make it.
        if (step.length) ctx.setEntryLength(step.length.dur, step.length.dots);
      } catch (err) {
        ctx.notice(`${step.write.type === "core.addChordNote" ? "chord" : "entry"} refused: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    // On for as long as the plugin is: the host gives the pen back to the
    // page wherever there is no score (another view, a menu over it).
    void ctx.stylus.capture(true);
  },
});
