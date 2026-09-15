/**
 * The plugin against a REAL host (`createHost` with memory-backed settings
 * and storage) and a fake score of four events, one of them a rest —
 * harmony hangs on any of them, which is the difference from lyrics and
 * the reason `attachesTo` exists.
 *
 * What is NOT here: the key protocol (the buffer, Tab, Backspace, the
 * advance), which is the host's and is tested in
 * `apps/editor/test/lanes.test.ts`; and the grammars themselves, which are
 * `test/grammar.test.ts`. This suite proves the two lanes, what a commit
 * writes, and that the specs wire the grammar in where the point expects
 * it.
 */
import { describe, it, expect } from "vitest";
import type { CaretPosition, LaneSpec, PluginEntry } from "@battuta/api";
import { createHost, memorySettings, type Host, type LaneAdapter, type SessionAdapter } from "../../../../apps/editor/src/host";
import { memoryStorage } from "../../../../apps/editor/src/host/services";
import { manifest, LANE_CHORD, LANE_RNA } from "../src/manifest";
import plugin from "../src/index";

const PLUGIN_ID = manifest.id;
const flush = () => new Promise((r) => setTimeout(r, 0));

/** note, rest, note, note — harmony attaches to every one of them. */
const EVENTS = [
  { id: "e1", kind: "note" as const },
  { id: "e2", kind: "rest" as const },
  { id: "e3", kind: "note" as const },
  { id: "e4", kind: "note" as const },
];

const at = (eventIndex: number): CaretPosition => ({ measureIndex: 0, staffN: 1, layerN: 1, eventIndex });

interface Fixture {
  host: Host;
  loads(): number;
  written(): string[];
  notices(): string[];
  spec(laneId: string): LaneSpec;
  harm: Map<string, string>;
  caret: { pos: CaretPosition | null };
  press(key: string): void;
  type(text: string): void;
  laneOptions(): string[];
  laneOpen(): string | null;
  buffer(): string;
}

function fixture(): Fixture {
  let loads = 0;
  const written: string[] = [];
  const notices: string[] = [];
  /** `${eventId}:${kind}` → text. */
  const harm = new Map<string, string>();
  const caret: { pos: CaretPosition | null } = { pos: at(0) };

  const entry: PluginEntry = {
    manifest,
    load: async () => {
      loads++;
      return { default: plugin };
    },
  };
  const host = createHost({ layout: "qwerty", plugins: [entry], settings: memorySettings(), storage: memoryStorage(), confirm: async () => true });

  const session: SessionAdapter = {
    // The core command the host built from the message; its label is all a
    // plugin package may read of it (applying it would need core).
    execute: (cmd) => void written.push((cmd as { label: string }).label),
    pitchEventsIn: () => [],
    blockOf: () => null,
    lyricAt: () => null,
    harmAt: (eventId, kind) => harm.get(`${eventId}:${kind}`) ?? "",
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
  host.document.set({ id: "doc-1", name: "score", dirty: false, version: 1, measureCount: 1, staffCount: 1, title: "", tempo: null });
  host.editor.set({ ...host.editor.get(), caret: caret.pos });
  host.notices.subscribe((n) => n && notices.push(n.text));

  const press = (key: string) => host.lanes.handleKey({ key, code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: () => undefined });
  return {
    host,
    loads: () => loads,
    written: () => written,
    notices: () => notices,
    spec: (laneId) => host.lanes.specOf(laneId)!,
    harm,
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

const open = async (f: Fixture, laneId: string) => {
  f.host.lanes.open(laneId);
  await flush();
};

describe("before any code loads", () => {
  it("both lanes are in the status bar, from the manifest", () => {
    const f = fixture();
    expect(f.laneOptions()).toEqual([LANE_CHORD, LANE_RNA]);
    expect(f.loads()).toBe(0);
  });

  it("and no key is contributed — harmony is picked, never pressed", () => {
    const f = fixture();
    expect(manifest.contributes?.keybindings).toBeUndefined();
    expect(manifest.contributes?.commands).toBeUndefined();
    expect(f.host.keymapView.get().some((e) => e.plugin === PLUGIN_ID)).toBe(false);
  });

  it("picking either lane wakes the plugin, which registers BOTH", async () => {
    const f = fixture();
    await open(f, LANE_RNA);
    expect(f.loads()).toBe(1);
    expect(f.laneOpen()).toBe(LANE_RNA);
    expect(f.host.lanes.specOf(LANE_CHORD)).toBeDefined();
  });
});

describe("the two lanes differ where they should", () => {
  it("place: chords above the staff, numerals below", async () => {
    const f = fixture();
    await open(f, LANE_CHORD);
    expect(f.spec(LANE_CHORD).place).toBe("above");
    expect(f.spec(LANE_RNA).place).toBe("below");
  });

  it("only the numeral lane rewrites keys", async () => {
    const f = fixture();
    await open(f, LANE_CHORD);
    expect(f.spec(LANE_CHORD).transform).toBeUndefined();
    expect(f.spec(LANE_RNA).transform?.("o")).toBe("°");
  });

  it("both attach to any event and advance event by event — a rest carries a harmony", async () => {
    const f = fixture();
    await open(f, LANE_CHORD);
    for (const id of [LANE_CHORD, LANE_RNA]) {
      expect(f.spec(id).attachesTo).toBe("event");
      expect(f.spec(id).advance).toBe("event");
      expect(f.spec(id).advanceOn).toEqual(["Enter"]);
    }
  });
});

describe("typing a symbol", () => {
  it("commits on Enter and advances one event", async () => {
    const f = fixture();
    await open(f, LANE_CHORD);
    f.type("C7");
    expect(f.buffer()).toBe("C7");
    f.press("Enter");
    expect(f.written()).toHaveLength(1);
    expect(f.caret.pos?.eventIndex).toBe(1); // the rest — harmony attaches there too
    expect(f.spec(LANE_CHORD).commit({ eventId: "e1", buffer: "C7", key: "Enter", prevEventId: null })).toEqual({
      type: "core.setHarm",
      eventId: "e1",
      kind: "chord",
      text: "C7",
    });
  });

  it("…and on a rest, which lyrics would refuse", async () => {
    const f = fixture();
    f.caret.pos = at(1);
    await open(f, LANE_RNA);
    f.type("V7");
    f.press("Enter");
    expect(f.written()).toHaveLength(1);
    expect(f.notices().some((n) => n.includes("attach to notes"))).toBe(false);
  });

  it("the two lanes are independent over the same event", async () => {
    const f = fixture();
    f.harm.set("e1:chord", "C7");
    await open(f, LANE_RNA);
    expect(f.buffer()).toBe(""); // the numeral lane reads its own kind
    expect(f.spec(LANE_RNA).read("e1")).toBe("");
    expect(f.spec(LANE_CHORD).read("e1")).toBe("C7");
  });

  it("unchanged text writes nothing — Enter walks a row of empty events for free", async () => {
    const f = fixture();
    f.harm.set("e1:chord", "C7");
    await open(f, LANE_CHORD);
    expect(f.buffer()).toBe("C7");
    f.press("Enter");
    expect(f.written()).toEqual([]);
    expect(f.caret.pos?.eventIndex).toBe(1);
    // …and an empty buffer over an empty event, the common case
    expect(f.spec(LANE_CHORD).commit({ eventId: "e3", buffer: "", key: "Enter", prevEventId: null })).toBeNull();
  });

  it("an empty buffer over an existing symbol clears it", async () => {
    const f = fixture();
    f.harm.set("e1:chord", "C7");
    await open(f, LANE_CHORD);
    expect(f.spec(LANE_CHORD).commit({ eventId: "e1", buffer: "", key: "Enter", prevEventId: null })).toEqual({
      type: "core.setHarm",
      eventId: "e1",
      kind: "chord",
      text: "",
    });
  });
});

describe("the grammar is the plugin's, and it is the only judge", () => {
  it("`complete` answers from src/grammar.ts — nothing downstream re-checks it", async () => {
    const f = fixture();
    await open(f, LANE_CHORD);
    expect(f.spec(LANE_CHORD).complete?.("C7")).toBe(true);
    expect(f.spec(LANE_CHORD).complete?.("Csus3")).toBe(false);
    expect(f.spec(LANE_RNA).complete?.("V7")).toBe(true);
    expect(f.spec(LANE_RNA).complete?.("V99")).toBe(false);
    // …and each lane judges by ITS grammar, not by "is this harmony".
    expect(f.spec(LANE_CHORD).complete?.("V65")).toBe(false);
    expect(f.spec(LANE_RNA).complete?.("Cmaj7")).toBe(false);
  });

  it("an incomplete buffer never reaches the document: the host refuses it with a notice", async () => {
    const f = fixture();
    await open(f, LANE_CHORD);
    f.type("Csus");
    f.press("Enter");
    expect(f.written()).toEqual([]);
    expect(f.notices().at(-1)).toContain("incomplete chords");
    expect(f.caret.pos?.eventIndex).toBe(0); // the key stopped there
  });

  it("`suggest` offers a continuation only for a head the document would accept", async () => {
    const f = fixture();
    await open(f, LANE_CHORD);
    expect(f.spec(LANE_CHORD).suggest?.("C7")).toContain("C7/");
    expect(f.spec(LANE_CHORD).suggest?.("Cmaj7b")).not.toContain("Cmaj7b/");
  });

  it("`accepts` admits its own charset and refuses the other lane's", async () => {
    const f = fixture();
    await open(f, LANE_CHORD);
    expect(f.spec(LANE_CHORD).accepts?.("C")).toBe(true);
    expect(f.spec(LANE_CHORD).accepts?.("v")).toBe(false);
    expect(f.spec(LANE_RNA).accepts?.("V")).toBe(true);
    expect(f.spec(LANE_RNA).accepts?.("a")).toBe(false);
  });
});

describe("the switch", () => {
  it("off takes both lanes and closes an open one; on puts them back", async () => {
    const f = fixture();
    await open(f, LANE_CHORD);
    expect(f.laneOpen()).toBe(LANE_CHORD);
    await f.host.registry.setEnabled(PLUGIN_ID, false);
    expect(f.laneOptions()).toEqual([]);
    expect(f.laneOpen()).toBeNull();
    await f.host.registry.setEnabled(PLUGIN_ID, true);
    expect(f.laneOptions()).toEqual([LANE_CHORD, LANE_RNA]);
  });

  it("writes nothing to settings or storage", async () => {
    const storage = memoryStorage();
    const settings = memorySettings();
    const host = createHost({ layout: "qwerty", plugins: [{ manifest, load: async () => ({ default: plugin }) }], settings, storage, confirm: async () => true });
    await host.registry.activate(PLUGIN_ID);
    expect(storage.getItem(`battuta.plugin.${PLUGIN_ID}.v1`)).toBeNull();
    expect(settings.load().plugins?.[PLUGIN_ID]?.values).toBeUndefined();
  });
});
