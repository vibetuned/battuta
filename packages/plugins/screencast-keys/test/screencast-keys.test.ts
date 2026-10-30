/**
 * The plugin against a fake context: it opens its feed in the float area,
 * names a key's action from the keymap, adds the notes played, and clears
 * its timer when it goes. Off by default and the float area itself are the
 * host's (`apps/editor/test/host.test.ts`); the feed is `feed.test.ts`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Feed } from "../src/feed";
import type { KeyPress, MidiNoteEvent, PanelSpec, PluginContext, Store } from "@battuta/api";
import { DisposableStore } from "@battuta/api";
import plugin from "../src/index";
import { manifest } from "../src/manifest";

afterEach(() => vi.useRealTimers());

function fixture() {
  vi.useFakeTimers();
  const panels: PanelSpec[] = [];
  let onKey: ((p: KeyPress) => void) | null = null;
  let onNote: ((e: MidiNoteEvent) => void) | null = null;
  const subscriptions = new DisposableStore();
  const ctx = {
    panels: { open: (p: PanelSpec) => (panels.push(p), { dispose: () => {} }) },
    keys: { on: (l: (p: KeyPress) => void) => ((onKey = l), { dispose: () => {} }) },
    midi: { onNote: (l: (e: MidiNoteEvent) => void) => ((onNote = l), { dispose: () => {} }) },
    keymap: { get: () => [{ id: "tie", label: "tie · tie chain (selection)", group: "marks", keys: ["t"], locked: false }] },
    subscriptions,
  } as unknown as PluginContext;
  void plugin.activate(ctx);
  const feed = () => ((panels[0]!.render() as { props: { feed: Store<Feed> } }).props.feed.get());
  const key = (k: string, action: string | null, mods: Partial<KeyPress> = {}) => onKey?.({ key: k, code: "", ctrl: false, alt: false, shift: false, meta: false, action, ...mods });
  const note = (n: number, on = true) => onNote?.({ note: n, on, velocity: on ? 90 : 0, source: "test" });
  return { panels, feed, key, note, subscriptions };
}

describe("the screencast keys plugin", () => {
  it("is off until turned on, and wakes at startup once it is", () => {
    expect(manifest.enabledByDefault).toBe(false);
    expect(manifest.activationEvents).toEqual(["onStartup"]);
  });

  it("opens its feed in the float area", () => {
    const f = fixture();
    expect(f.panels.map((p) => [p.id, p.side])).toEqual([["screencast-keys", "float"]]);
  });

  it("names a key's action by its keymap label's first part, else by its id, and skips a modifier alone", () => {
    const f = fixture();
    f.key("t", "tie");
    f.key("Shift", null, { shift: true });
    f.key("z", "undo", { ctrl: true });
    f.key("ArrowLeft", "nav.left");
    expect(f.feed().entries.map((e) => [e.text, e.action])).toEqual([
      ["T", "tie"],
      ["Ctrl Z", "undo"],
      ["←", "nav left"],
    ]);
  });

  it("shows the notes played — on, not off — and lets everything fade away", () => {
    const f = fixture();
    f.note(60);
    f.note(64);
    f.note(60, false);
    expect(f.feed().entries.map((e) => e.text)).toEqual(["C4 E4"]);
    vi.advanceTimersByTime(5000);
    expect(f.feed().entries).toEqual([]);
  });

  it("clears its timer when it deactivates", () => {
    const f = fixture();
    f.key("a", null);
    expect(vi.getTimerCount()).toBe(1);
    f.subscriptions.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
