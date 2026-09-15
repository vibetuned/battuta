/**
 * The plugin against a REAL host (`createHost` with memory-backed settings
 * and storage) and a fake score: four events in one layer — note, rest,
 * note, note — which is what the lane's advance rule needs to be tested on
 * (it skips the rest) and what the browser script types over.
 *
 * What is NOT here: the key protocol itself (Backspace, Tab, the buffer,
 * the floating editor) — that is the host's, tested in
 * `apps/editor/test/lanes.test.ts`. This suite proves the lifecycle and
 * the three things that are lyrics': the lane it declares, the key that
 * opens it, and what a commit writes.
 */
import { describe, it, expect } from "vitest";
import type { CaretPosition, LaneSpec, PluginEntry, SylValue } from "@battuta/api";
import { createHost, memorySettings, type Host, type LaneAdapter, type SessionAdapter } from "../../../../apps/editor/src/host";
import { memoryStorage } from "../../../../apps/editor/src/host/services";
import { manifest, COMMAND_OPEN, LANE_ID } from "../src/manifest";
import plugin from "../src/index";

const PLUGIN_ID = manifest.id;
const flush = () => new Promise((r) => setTimeout(r, 0));

/** note, rest, note, note — one layer, addressed by eventIndex. */
const EVENTS = [
  { id: "n1", kind: "note" as const },
  { id: "r1", kind: "rest" as const },
  { id: "n2", kind: "note" as const },
  { id: "n3", kind: "note" as const },
];

const at = (eventIndex: number): CaretPosition => ({ measureIndex: 0, staffN: 1, layerN: 1, eventIndex });

interface Fixture {
  host: Host;
  loads(): number;
  /**
   * The core commands the host built from the plugin's messages, by label
   * — the adapter is where a test can see them, because the lane store
   * holds the host's own executor and not `host.execute`.
   */
  written(): string[];
  /** The registered spec, for asserting the MESSAGE a commit returns. */
  spec(): LaneSpec;
  notices(): string[];
  syllables: Map<string, SylValue>;
  caret: { pos: CaretPosition | null };
  press(key: string): void;
  type(text: string): void;
  laneOptions(): string[];
  laneOpen(): string | null;
  buffer(): string;
}

function fixture(opts: { entryMode?: boolean } = {}): Fixture {
  let loads = 0;
  const written: string[] = [];
  const notices: string[] = [];
  const syllables = new Map<string, SylValue>();
  const caret: { pos: CaretPosition | null } = { pos: at(0) };

  const entry: PluginEntry = {
    manifest,
    load: async () => {
      loads++;
      return { default: plugin };
    },
  };
  const host = createHost({ layout: "qwerty", plugins: [entry], settings: memorySettings(), storage: memoryStorage(), confirm: async () => true });

  // Stands in for the App's executor. It receives the CORE COMMAND the
  // host built from the plugin's message — `SetSylCommand`, whose label is
  // all a plugin test can read of it (applying it would need core, which a
  // plugin package may not have). The message itself is asserted straight
  // off the spec instead; `test/syllable.test.ts` is the value table.
  const session: SessionAdapter = {
    execute: (cmd) => void written.push((cmd as { label: string }).label),
    pitchEventsIn: () => [],
    blockOf: () => null,
    lyricAt: (id) => syllables.get(id) ?? null,
    harmAt: () => "",
    timemap: async () => ({ events: [], notes: {}, idMap: {} }),
    notation: () => ({ ties: {}, marks: {} }),
  };
  host.bindSession(session);

  const adapter: LaneAdapter = {
    caret: () => caret.pos,
    eventAt: (pos) => {
      const e = EVENTS[pos.eventIndex];
      return e ? { id: e.id, kind: e.kind } : null;
    },
    step: (pos, dir) => {
      const next = pos.eventIndex + dir;
      return next >= 0 && next < EVENTS.length ? at(next) : null;
    },
    setCaret: (pos) => {
      caret.pos = pos;
    },
    leaveEntryMode: () => host.editor.set({ ...host.editor.get(), entryMode: false }),
  };
  host.lanes.bind(adapter);
  host.document.set({ id: "doc-1", version: 1, measureCount: 1, staffCount: 1, title: "", tempo: null });
  host.editor.set({ ...host.editor.get(), caret: caret.pos, entryMode: opts.entryMode ?? false });
  host.notices.subscribe((n) => n && notices.push(n.text));

  const press = (key: string) => host.lanes.handleKey({ key, code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: () => undefined });
  return {
    host,
    loads: () => loads,
    written: () => written,
    spec: () => host.lanes.specOf(LANE_ID)!,
    notices: () => notices,
    syllables,
    caret,
    press,
    type: (text) => {
      for (const ch of text) press(ch);
    },
    laneOptions: () => host.lanes.options.get().map((o) => o.id),
    laneOpen: () => host.lanes.state.get()?.id ?? null,
    buffer: () => host.lanes.state.get()?.buffer ?? "",
  };
}

describe("before any code loads", () => {
  it("the lane is already in the status bar, from the manifest", () => {
    const f = fixture();
    expect(f.laneOptions()).toEqual([LANE_ID]);
    expect(f.loads()).toBe(0);
  });

  it("the `l` binding is in the union keymap, marked as this plugin's", () => {
    const f = fixture();
    const l = f.host.keymapView.get().find((e) => e.id === COMMAND_OPEN);
    expect(l).toMatchObject({ keys: ["l"], group: "entry", plugin: PLUGIN_ID });
    // The label is 0.0.3's, verbatim — the shortcut editor and the
    // on-screen keyboard read it and must not change wording.
    expect(l?.label).toBe("lyrics lane: type at the caret, space/enter advances, - hyphenates");
    expect(f.loads()).toBe(0);
  });
});

describe("opening the lane", () => {
  it("`l` loads the plugin and opens the lane at the caret", async () => {
    const f = fixture();
    f.host.dispatchKey({ key: "l", shiftKey: false, altKey: false });
    await flush();
    expect(f.loads()).toBe(1);
    expect(f.laneOpen()).toBe(LANE_ID);
  });

  it("`l` does nothing in note entry — 0.0.3's rule, kept by the handler", async () => {
    const f = fixture({ entryMode: true });
    f.host.dispatchKey({ key: "l", shiftKey: false, altKey: false });
    await flush();
    expect(f.loads()).toBe(1); // the key still woke the plugin…
    expect(f.laneOpen()).toBeNull(); // …and the handler declined
  });

  it("picking the lane in the status bar wakes the plugin and opens it — no key involved", async () => {
    const f = fixture();
    expect(f.host.lanes.open(LANE_ID)).toBe(true);
    await flush();
    expect(f.loads()).toBe(1);
    expect(f.laneOpen()).toBe(LANE_ID);
    // The select leaves entry mode even though the key would not have.
    const g = fixture({ entryMode: true });
    g.host.lanes.open(LANE_ID);
    await flush();
    expect(g.laneOpen()).toBe(LANE_ID);
    expect(g.host.editor.get().entryMode).toBe(false);
  });
});

describe("typing a verse", () => {
  const open = async (f: Fixture) => {
    f.host.lanes.open(LANE_ID);
    await flush();
  };

  it('"hel" + "-" hyphenates and advances over the rest to the next NOTE', async () => {
    const f = fixture();
    await open(f);
    f.type("hel");
    expect(f.buffer()).toBe("hel");
    f.press("-");
    expect(f.written()).toEqual(['lyric "hel"']);
    expect(f.caret.pos?.eventIndex).toBe(2); // n2 — the rest was skipped
    // …and the message behind that command, from the spec itself:
    expect(f.spec().commit({ eventId: "n1", buffer: "hel", key: "-", prevEventId: null })).toEqual({
      type: "core.setSyl",
      eventId: "n1",
      value: { text: "hel", wordpos: "i", con: "d" },
    });
  });

  it('…then "lo" + space closes the word on the next note', async () => {
    const f = fixture();
    await open(f);
    f.type("hel");
    f.press("-");
    // The first syllable is in the document now, hyphenated…
    f.syllables.set("n1", { text: "hel", wordpos: "i", con: "d" });
    f.type("lo");
    f.press(" ");
    expect(f.written()).toEqual(['lyric "hel"', 'lyric "lo"']);
    expect(f.caret.pos?.eventIndex).toBe(3);
    // …so the second closes the word, which it learns from the PREVIOUS
    // note through `lyricAt` — the only model access lyrics has.
    expect(f.spec().commit({ eventId: "n2", buffer: "lo", key: " ", prevEventId: "n1" })).toEqual({
      type: "core.setSyl",
      eventId: "n2",
      value: { text: "lo", wordpos: "t" },
    });
  });

  it("the buffer reloads from the document when the caret returns to a syllable", async () => {
    const f = fixture();
    f.syllables.set("n1", { text: "hel", wordpos: "i", con: "d" });
    await open(f);
    expect(f.buffer()).toBe("hel");
  });

  it("crossing an unchanged syllable writes nothing — no command, no undo step", async () => {
    const f = fixture();
    f.syllables.set("n1", { text: "hel", wordpos: "i", con: "d" });
    await open(f);
    f.press("Escape");
    expect(f.written()).toEqual([]);
    expect(f.laneOpen()).toBeNull();
  });

  it("an empty commit clears the syllable", async () => {
    const f = fixture();
    f.syllables.set("n1", { text: "hel" });
    await open(f);
    f.press("Backspace");
    f.press("Backspace");
    f.press("Backspace");
    f.press("Enter");
    expect(f.written()).toEqual(["lyric removed"]);
    expect(f.spec().commit({ eventId: "n1", buffer: "", key: "Enter", prevEventId: null })).toEqual({
      type: "core.setSyl",
      eventId: "n1",
      value: { text: "" },
    });
  });
});

describe("what the lane refuses", () => {
  it("a syllable on a rest: a notice, no command (the host's rule, on this lane's attachesTo)", async () => {
    const f = fixture();
    f.caret.pos = at(1); // the rest
    f.host.lanes.open(LANE_ID);
    await flush();
    f.type("x");
    f.press("Enter");
    expect(f.written()).toEqual([]);
    expect(f.notices().at(-1)).toContain("lyrics attach to notes");
  });

  it("…but an EMPTY buffer may pass a rest by", async () => {
    const f = fixture();
    f.caret.pos = at(1);
    f.host.lanes.open(LANE_ID);
    await flush();
    f.press(" ");
    expect(f.written()).toEqual([]);
    expect(f.caret.pos?.eventIndex).toBe(2); // moved on to the next note
  });
});

describe("the switch", () => {
  it("off takes the lane, the key and the option together", async () => {
    const f = fixture();
    await f.host.registry.setEnabled(PLUGIN_ID, false);
    expect(f.laneOptions()).toEqual([]);
    expect(f.host.keymapView.get().some((e) => e.id === COMMAND_OPEN)).toBe(false);
    expect(f.host.dispatchKey({ key: "l", shiftKey: false, altKey: false })).toBe(false);
  });

  it("…and an open lane closes with it", async () => {
    const f = fixture();
    f.host.lanes.open(LANE_ID);
    await flush();
    expect(f.laneOpen()).toBe(LANE_ID);
    await f.host.registry.setEnabled(PLUGIN_ID, false);
    expect(f.laneOpen()).toBeNull();
  });

  it("on puts all three back", async () => {
    const f = fixture();
    await f.host.registry.setEnabled(PLUGIN_ID, false);
    await f.host.registry.setEnabled(PLUGIN_ID, true);
    expect(f.laneOptions()).toEqual([LANE_ID]);
    expect(f.host.keymapView.get().some((e) => e.id === COMMAND_OPEN)).toBe(true);
  });
});
