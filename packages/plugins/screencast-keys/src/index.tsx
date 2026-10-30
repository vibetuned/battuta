/**
 * The screencast keys plugin (1.3.0): the keys pressed, with the action
 * each ran, and the MIDI notes played, shown in the window's bottom-left
 * corner for video demos and screenshots — like Blender's Screencast Keys
 * add-on. The keys come from `ctx.keys`, the action names from
 * `ctx.keymap`, the notes from `ctx.midi`; the feed is `feed.ts`, drawn in
 * the host's float area by `Screencast.tsx`.
 */
import { definePlugin, toDisposable, type PluginContext } from "@battuta/api";
import { addKey, addNote, comboOf, EMPTY, expire, noteName, type Feed } from "./feed";
import { PANEL_ID } from "./manifest";
import { Screencast } from "./Screencast";
import { signal } from "./store";

/** How often the feed is re-read while it shows something, ms: the fade's steps. */
const TICK = 100;

export default definePlugin({
  activate(ctx: PluginContext) {
    const feed = signal<Feed>(EMPTY);
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = (): void => {
      const next = expire(feed.get(), Date.now());
      feed.set(next);
      if (next.entries.length === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const show = (next: Feed): void => {
      feed.set(next);
      if (timer === null) timer = setInterval(tick, TICK);
    };
    // An action's name: its keymap label up to the first " · " ("tie · tie
    // chain (selection)" → "tie"); an action with no entry of its own — the
    // locked keys, listed by group (undo, the arrows, the pitch letters) —
    // by its id ("nav.left" → "nav left").
    const label = (id: string): string => ctx.keymap.get().find((e) => e.id === id)?.label.split(" · ")[0] ?? id.replace(/\./g, " ");

    ctx.panels.open({ id: PANEL_ID, side: "float", title: "Screencast keys", render: () => <Screencast feed={feed} /> });
    ctx.keys.on((press) => {
      const text = comboOf(press);
      if (text) show(addKey(feed.get(), text, press.action ? label(press.action) : null, Date.now()));
    });
    ctx.midi.onNote((e) => {
      if (e.on) show(addNote(feed.get(), noteName(e.note), Date.now()));
    });
    ctx.subscriptions.add(toDisposable(() => timer !== null && clearInterval(timer)));
  },
});
