/**
 * The plugin against a REAL host (`createHost` with memory-backed
 * settings and storage) and a FakeEditor standing in for App.tsx.
 *
 * The fake reproduces the one property of the app the plugin actually
 * depends on: the document snapshot is republished AFTER the executor
 * returns, never synchronously — so a plugin cannot observe the result of
 * its own `execute`. Get that wrong and every press re-bases; the
 * "continues the cycle" test below is what catches it.
 *
 * What is NOT tested here: the pitch content of a form (that is
 * test/forms.test.ts) and the write itself (packages/core's
 * pitches.test.ts, plus the host's message→command mapping test). This
 * suite proves the lifecycle and the cycle.
 */
import { describe, it, expect } from "vitest";
import type { BlockSelection, PitchEvent, PluginEntry } from "@battuta/api";
import { createHost, memorySettings, type Host, type SessionAdapter } from "../../../../apps/editor/src/host";
import { memoryStorage } from "../../../../apps/editor/src/host/services";
import { manifest, COMMAND_CYCLE } from "../src/manifest";
import plugin from "../src/index";

const PLUGIN_ID = manifest.id;
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A five-note voice, the same shape core's collectPitchEvents returns. */
const VOICE: PitchEvent[] = [
  { eventId: "r1", pitches: [{ pname: "c", oct: 4 }] },
  { eventId: "r2", pitches: [{ pname: "d", oct: 4 }] },
  { eventId: "r3", pitches: [{ pname: "e", oct: 4 }] },
  { eventId: "r4", pitches: [{ pname: "f", oct: 4 }] },
  { eventId: "r5", pitches: [{ pname: "a", oct: 3 }] },
];

const BLOCK: BlockSelection = { measureFrom: 0, measureTo: 1, staffFrom: 1, staffTo: 1 };

interface Fake {
  host: Host;
  /** Command labels the host built from the plugin's messages, in order. */
  executed: string[];
  /** How many times the plugin asked for the block's pitches (once per re-base). */
  pitchReads: number;
  loads: number;
  notices: string[];
  version(): number;
  /** An edit by somebody else: the version moves without the plugin knowing. */
  externalEdit(): Promise<void>;
  openDocument(id: string): void;
  setBlock(block: BlockSelection | null): void;
  press(): Promise<boolean>;
  voices: PitchEvent[][];
}

function fakeEditor(): Fake {
  const state = { docId: "doc-1", version: 1, executed: [] as string[], pitchReads: 0, loads: 0, notices: [] as string[], voices: [VOICE] as PitchEvent[][] };

  // A real dynamic import settles unpredictably and made this suite flaky
  // one run in six; the module is imported at file scope and `load` just
  // counts, which also makes "no code loaded until the key is pressed" a
  // counted assertion rather than one inferred from registry state.
  const entry: PluginEntry = {
    manifest,
    load: async () => {
      state.loads++;
      return { default: plugin };
    },
  };

  const host = createHost({ layout: "qwerty", plugins: [entry], settings: memorySettings(), storage: memoryStorage(), confirm: async () => true });

  const publish = () => host.document.set({ id: state.docId, name: "score", version: state.version, measureCount: 4, staffCount: 2, title: "", tempo: null });

  const adapter: SessionAdapter = {
    execute: (cmd) => {
      state.executed.push((cmd as { label: string }).label);
      state.version++;
      // App.tsx publishes the new snapshot from a React effect — after
      // the executor returns. Never synchronously.
      queueMicrotask(publish);
    },
    pitchEventsIn: () => {
      state.pitchReads++;
      return state.voices;
    },
    blockOf: (ids) => (ids.length ? BLOCK : null),
  };
  host.bindSession(adapter);
  host.notices.subscribe((n) => n && state.notices.push(n.text));
  publish();
  host.editor.set({ ...host.editor.get(), block: BLOCK });

  return {
    host,
    get executed() {
      return state.executed;
    },
    get pitchReads() {
      return state.pitchReads;
    },
    get loads() {
      return state.loads;
    },
    get notices() {
      return state.notices;
    },
    get voices() {
      return state.voices;
    },
    set voices(v: PitchEvent[][]) {
      state.voices = v;
    },
    version: () => state.version,
    externalEdit: async () => {
      state.version++;
      publish();
      await flush();
    },
    openDocument: (id) => {
      state.docId = id;
      state.version = 1;
      publish();
    },
    setBlock: (block) => host.editor.set({ ...host.editor.get(), block }),
    press: async () => {
      const handled = host.dispatchKey({ key: "R", shiftKey: true, altKey: false });
      await flush();
      return handled;
    },
  };
}

describe("registration and activation", () => {
  it("contributes its binding and command at registration, with no code loaded", () => {
    const f = fakeEditor();
    const info = f.host.registry.info(PLUGIN_ID)!;
    expect(info.state).toBe("registered");
    expect(info.enabled).toBe(true);
    const binding = f.host.keymap.get()[COMMAND_CYCLE];
    expect(binding).toBeDefined();
    expect(binding!.keys).toEqual(["R"]);
    expect(binding!.plugin).toBe(PLUGIN_ID);
    expect(binding!.group).toBe("rhythm");
    expect(binding!.when).toBe("block selection");
    expect(f.host.commands.ownerOf(COMMAND_CYCLE)).toBe(PLUGIN_ID);
    expect(f.loads).toBe(0); // the whole point of onCommand:
  });

  it("loads the code on the first press, and only once", async () => {
    const f = fakeEditor();
    await f.press();
    expect(f.loads).toBe(1);
    expect(f.host.registry.info(PLUGIN_ID)!.state).toBe("active");
    await f.press();
    expect(f.loads).toBe(1);
  });

  it("the binding reads exactly as 0.0.3's core keymap entry did", () => {
    const f = fakeEditor();
    expect(f.host.keymap.get()[COMMAND_CYCLE]!.label).toBe("reflection cycle: inversion → retrograde → retr. inversion → back");
  });
});

describe("the cycle", () => {
  it("four presses are the four forms, in order, each one undo step", async () => {
    const f = fakeEditor();
    for (let i = 0; i < 4; i++) await f.press();
    expect(f.executed).toEqual(["inversion", "retrograde", "retrogradeInversion", "prime"]);
    expect(f.notices).toEqual([
      "reflection: inversion",
      "reflection: retrograde",
      "reflection: retrograde inversion",
      "reflection: back to the original",
    ]);
  });

  it("captures the base ONCE — the plugin's own edits do not re-base it", async () => {
    const f = fakeEditor();
    for (let i = 0; i < 4; i++) await f.press();
    // Reading the version back straight after execute (instead of
    // adopting the next published one) makes this 4 and turns the four
    // forms above into four inversions.
    expect(f.pitchReads).toBe(1);
  });

  it("keeps cycling past the fourth press", async () => {
    const f = fakeEditor();
    for (let i = 0; i < 6; i++) await f.press();
    expect(f.executed.slice(4)).toEqual(["inversion", "retrograde"]);
    expect(f.pitchReads).toBe(1);
  });

  it("re-bases after somebody else's edit (an undo counts)", async () => {
    const f = fakeEditor();
    await f.press();
    await f.press();
    expect(f.executed).toEqual(["inversion", "retrograde"]);
    await f.externalEdit();
    await f.press();
    expect(f.executed[2]).toBe("inversion");
    expect(f.pitchReads).toBe(2);
  });

  it("re-bases when the block changes", async () => {
    const f = fakeEditor();
    await f.press();
    await f.press();
    f.setBlock({ measureFrom: 2, measureTo: 3, staffFrom: 1, staffTo: 1 });
    await f.press();
    expect(f.executed[2]).toBe("inversion");
  });

  it("re-bases in a different document (DocumentInfo.id is identity)", async () => {
    const f = fakeEditor();
    await f.press();
    f.openDocument("doc-2");
    await f.press();
    expect(f.executed).toEqual(["inversion", "inversion"]);
  });

  it("acts on the event selection when there is no drag block", async () => {
    const f = fakeEditor();
    f.setBlock(null);
    f.host.editor.set({ ...f.host.editor.get(), selection: ["r1", "r2"] });
    await f.press();
    expect(f.executed).toEqual(["inversion"]);
  });
});

describe("refusals", () => {
  it("does nothing at all without a block or a selection", async () => {
    const f = fakeEditor();
    f.setBlock(null);
    const handled = await f.press();
    expect(handled).toBe(true); // the key is ours; it simply has nothing to act on
    expect(f.executed).toEqual([]);
    expect(f.notices).toEqual([]); // 0.0.3 said nothing here either
  });

  it("refuses a block with no notes in it", async () => {
    const f = fakeEditor();
    f.voices = [];
    await f.press();
    expect(f.executed).toEqual([]);
    expect(f.notices).toEqual(["reflection refused: no notes in the selection"]);
  });

  it("skips retrograde when chord sizes don't mirror, and says so", async () => {
    const f = fakeEditor();
    f.voices = [[
      { eventId: "c1", pitches: [{ pname: "c", oct: 4 }, { pname: "e", oct: 4 }] },
      { eventId: "n2", pitches: [{ pname: "g", oct: 4 }] },
    ]];
    await f.press();
    expect(f.notices).toEqual(["reflection: inversion"]);
    await f.press();
    // retrograde AND retrograde inversion are both impossible here
    expect(f.executed).toEqual(["inversion", "prime"]);
    expect(f.notices[1]).toBe("reflection: back to the original (retrograde skipped: chord sizes don't mirror)");
  });

  it("refuses when no form applies at all", async () => {
    const f = fakeEditor();
    f.voices = [[{ eventId: "x", pitches: [] }]];
    await f.press();
    expect(f.executed).toEqual([]);
    expect(f.notices).toEqual(["reflection refused: nothing to transform"]);
  });

  it("reports a refused write as a notice instead of throwing", async () => {
    const f = fakeEditor();
    f.host.bindSession({
      execute: () => {
        throw new Error("pitch count does not match the event");
      },
      pitchEventsIn: () => [VOICE],
      blockOf: () => BLOCK,
    });
    await f.press();
    expect(f.notices).toEqual(["reflection refused: pitch count does not match the event"]);
    // …and the failed press did not leave the cycle believing it owns the
    // next published version
    f.host.bindSession({
      execute: () => undefined,
      pitchEventsIn: () => [VOICE],
      blockOf: () => BLOCK,
    });
    await f.externalEdit();
    await f.press();
    expect(f.notices[1]).toBe("reflection: inversion");
  });
});

describe("turning it off", () => {
  it("withdraws the binding, the key does nothing, and the document is untouched", async () => {
    const f = fakeEditor();
    await f.press();
    const afterOnePress = f.version();

    await f.host.registry.setEnabled(PLUGIN_ID, false);
    expect(f.host.keymap.get()[COMMAND_CYCLE]).toBeUndefined();
    expect(f.host.registry.info(PLUGIN_ID)!.state).toBe("disabled");

    const handled = await f.press();
    expect(handled).toBe(false); // the host's dispatcher no longer claims the key
    expect(f.executed).toEqual(["inversion"]);
    expect(f.version()).toBe(afterOnePress);
  });

  it("comes back on, and the cycle starts clean", async () => {
    const f = fakeEditor();
    await f.press();
    await f.host.registry.setEnabled(PLUGIN_ID, false);
    await f.host.registry.setEnabled(PLUGIN_ID, true);
    expect(f.host.keymap.get()[COMMAND_CYCLE]).toBeDefined();
    await f.press();
    expect(f.executed).toEqual(["inversion", "inversion"]);
  });

  // "a rebind of its key survives off/on" is the HOST's guarantee, keyed
  // by command id with nothing plugin-specific about it, and
  // apps/editor/test/host.test.ts already pins it (it shims localStorage,
  // which keymap overrides need and this suite otherwise does not).
});

describe("state", () => {
  it("writes no settings and no storage keys — nothing to leave behind", async () => {
    const settings = memorySettings();
    const storage = memoryStorage();
    const entry: PluginEntry = { manifest, load: async () => ({ default: plugin }) };
    const host = createHost({ layout: "qwerty", plugins: [entry], settings, storage, confirm: async () => true });
    host.bindSession({ execute: () => undefined, pitchEventsIn: () => [VOICE], blockOf: () => BLOCK });
    host.document.set({ id: "doc-1", name: "score", version: 1, measureCount: 4, staffCount: 2, title: "", tempo: null });
    host.editor.set({ ...host.editor.get(), block: BLOCK });
    for (let i = 0; i < 4; i++) {
      host.dispatchKey({ key: "R", shiftKey: true, altKey: false });
      await flush();
    }
    // the enabled flag is the host's own bookkeeping; `values` is the
    // plugin's settings namespace and must be untouched
    expect(settings.load().plugins?.[PLUGIN_ID]?.values).toBeUndefined();
    expect(storage.getItem(`battuta.plugin.${PLUGIN_ID}.v1`)).toBeNull();
  });

  it("contributes nothing at all in a --no-plugins session", () => {
    // PLANNING's "--no-plugins property" had only a fixture plugin to be
    // off until this slice. With the real one: nothing registered, no
    // binding, and the key is not ours — so a document opened and saved
    // in such a session cannot differ by a byte on this plugin's account.
    const entry: PluginEntry = { manifest, load: async () => ({ default: plugin }) };
    const host = createHost({ layout: "qwerty", plugins: [entry], noPlugins: true, settings: memorySettings(), storage: memoryStorage(), confirm: async () => true });
    expect(host.registry.get()).toEqual([]);
    expect(host.keymap.get()[COMMAND_CYCLE]).toBeUndefined();
    expect(host.dispatchKey({ key: "R", shiftKey: true, altKey: false })).toBe(false);
  });

  it("drops its captured base when the document closes", async () => {
    const f = fakeEditor();
    await f.press();
    f.host.document.set(null);
    await flush();
    f.host.document.set({ id: "doc-1", name: "score", version: 9, measureCount: 4, staffCount: 2, title: "", tempo: null });
    await f.press();
    expect(f.executed).toEqual(["inversion", "inversion"]);
  });
});
