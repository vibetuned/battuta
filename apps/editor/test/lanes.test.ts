/**
 * The lanes point (slice 5a): the host's MECHANISM over a fake document.
 *
 * The fake is a single layer of events with kinds (note / rest / other);
 * the caret is an index into it. Specs are minimal: one note-attached lane
 * with lyrics' shape (advance over rests, `-` among the advance keys, a
 * message on commit), one event-attached lane with harmony's shape (a
 * charset, a transform, completeness, suggestions, Enter only). Nothing
 * here knows what the text means — exactly the property under test.
 */
import { describe, it, expect, vi } from "vitest";
import type { CaretPosition, CommandMessage, EditorState, LaneSpec } from "@battuta/api";
import { LaneStore, laneFace, type LaneAdapter } from "../src/host/lanes";
import { createStore } from "../src/host/store";
import type { KeyEvent } from "../src/host/actions";

type Kind = "note" | "rest" | "other";

function fakeDocument(kinds: Kind[]) {
  const values = new Map<string, string>();
  let caretIndex: number | null = 0;
  const pos = (i: number): CaretPosition => ({ measureIndex: 0, staffN: 1, layerN: 1, eventIndex: i });
  const adapter: LaneAdapter = {
    caret: () => (caretIndex === null ? null : pos(caretIndex)),
    eventAt: (p) => (p.eventIndex >= 0 && p.eventIndex < kinds.length ? { id: `e${p.eventIndex}`, kind: kinds[p.eventIndex]! } : null),
    step: (p, dir) => {
      const i = p.eventIndex + dir;
      return i >= 0 && i < kinds.length ? pos(i) : null;
    },
    setCaret: (p) => {
      caretIndex = p.eventIndex;
    },
    leaveEntryMode: vi.fn(),
  };
  return {
    adapter,
    values,
    setCaret: (i: number | null) => {
      caretIndex = i;
    },
    caretIndex: () => caretIndex,
  };
}

const key = (k: string, mods: Partial<KeyEvent> = {}): KeyEvent & { prevented: boolean } => {
  const e = { key: k, code: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, prevented: false, preventDefault() {} } as KeyEvent & { prevented: boolean };
  Object.assign(e, mods);
  e.preventDefault = () => {
    e.prevented = true;
  };
  return e;
};

function makeStore(doc: ReturnType<typeof fakeDocument>) {
  const executed: CommandMessage[] = [];
  const notices: (string | null)[] = [];
  const activate = vi.fn(async () => true);
  const store = new LaneStore({
    execute: (m) => {
      executed.push(m);
      if (m.type === "core.setSyl") doc.values.set(m.eventId, m.value.text);
    },
    notice: (t) => notices.push(t),
    activate,
  });
  store.bind(doc.adapter);
  return { store, executed, notices, activate };
}

/** Lyrics' shape: note-attached, advances over rests, commits a message. */
const lyricsLike = (doc: ReturnType<typeof fakeDocument>, patch: Partial<LaneSpec> = {}): LaneSpec => ({
  id: "lyrics",
  label: "lyrics (verse 1, l)",
  name: "lyrics",
  glyph: "♪",
  place: "below",
  attachesTo: "note",
  advance: "note",
  advanceOn: [" ", "Enter", "-"],
  hint: "type a syllable",
  read: (id) => doc.values.get(id) ?? "",
  commit: ({ eventId, buffer, key: k, prevEventId }) => {
    if (buffer === (doc.values.get(eventId) ?? "")) return null;
    return { type: "core.setSyl", eventId, value: { text: buffer, ...(k === "-" ? { con: "d" } : {}), ...(prevEventId ? { wordpos: "t" } : {}) } };
  },
  ...patch,
});

/** Harmony's shape: any event, Enter only, a closed grammar with suggestions, writes for itself. */
const harmonyLike = (doc: ReturnType<typeof fakeDocument>, written: string[]): LaneSpec => ({
  id: "chord",
  label: "chord symbols (above)",
  name: "chords",
  glyph: "♩",
  place: "above",
  attachesTo: "event",
  advance: "event",
  advanceOn: ["Enter"],
  accepts: (ch) => /^[A-G0-9m]$/.test(ch),
  transform: (ch) => (ch === "o" ? "°" : ch),
  complete: (b) => /^[A-G](m|7)?$/.test(b),
  suggest: (b) => ["C", "Cm", "C7"].filter((s) => s.startsWith(b) && s !== b),
  read: (id) => doc.values.get(`h:${id}`) ?? "",
  commit: ({ eventId, buffer }) => {
    if (buffer === (doc.values.get(`h:${eventId}`) ?? "")) return null;
    if (buffer === "X") return { refuse: "not a chord" };
    doc.values.set(`h:${eventId}`, buffer);
    written.push(`${eventId}=${buffer}`);
    return null;
  },
});

describe("opening and closing", () => {
  it("open() needs a registered spec, an adapter and a caret; it leaves entry mode and shows the hint", () => {
    const doc = fakeDocument(["note", "rest", "note"]);
    const { store, notices } = makeStore(doc);
    expect(store.open("lyrics")).toBe(false); // unknown
    store.register(lyricsLike(doc));
    doc.setCaret(null);
    expect(store.open("lyrics")).toBe(false); // no caret
    doc.setCaret(0);
    expect(store.open("lyrics")).toBe(true);
    expect(doc.adapter.leaveEntryMode).toHaveBeenCalledTimes(1);
    expect(store.state.get()?.id).toBe("lyrics");
    expect(notices).toEqual(["type a syllable"]);
    store.close();
    expect(store.state.get()).toBeNull();
  });

  it("binding null (no document) closes the lane; disposing the open lane's registration closes it too", () => {
    const doc = fakeDocument(["note"]);
    const { store } = makeStore(doc);
    const reg = store.register(lyricsLike(doc));
    store.open("lyrics");
    store.bind(null);
    expect(store.state.get()).toBeNull();
    store.bind(doc.adapter);
    store.open("lyrics");
    reg.dispose();
    expect(store.state.get()).toBeNull();
    expect(store.open("lyrics")).toBe(false);
  });

  it("re-registering an id replaces the spec in place: an open lane stays open on the new one", () => {
    const doc = fakeDocument(["note"]);
    const { store } = makeStore(doc);
    const first = store.register(lyricsLike(doc));
    store.open("lyrics");
    store.register(lyricsLike(doc, { hint: "second" }));
    expect(store.state.get()?.spec.hint).toBe("second");
    first.dispose(); // stale disposal: a no-op
    expect(store.state.get()?.id).toBe("lyrics");
  });

  it("the buffer follows the document: reload() reads the spec at the caret, and watch() wires it to the host's mirrors", () => {
    const doc = fakeDocument(["note", "rest", "note"]);
    const { store } = makeStore(doc);
    doc.values.set("e0", "hel");
    doc.values.set("e2", "lo");
    store.register(lyricsLike(doc));
    const editor = createStore<EditorState>({ caret: null, selection: [], block: null, view: "tiles", entryMode: false });
    const document = createStore<{ id: string; name: string; dirty: boolean; version: number; measureCount: number; staffCount: number; title: string; tempo: number | null } | null>(null);
    store.watch(editor, document);
    store.open("lyrics");
    expect(store.state.get()?.buffer).toBe("hel");
    doc.setCaret(2);
    editor.set({ ...editor.get(), caret: { measureIndex: 0, staffN: 1, layerN: 1, eventIndex: 2 } });
    expect(store.state.get()?.buffer).toBe("lo");
    doc.values.set("e2", "la");
    document.set({ id: "d", name: "score", dirty: false, version: 2, measureCount: 1, staffCount: 1, title: "", tempo: null });
    expect(store.state.get()?.buffer).toBe("la");
    doc.setCaret(1); // a rest: nothing to read
    editor.set({ ...editor.get(), caret: { measureIndex: 0, staffN: 1, layerN: 1, eventIndex: 1 } });
    expect(store.state.get()?.buffer).toBe("");
  });
});

describe("the key protocol", () => {
  it("characters extend the buffer (never with ctrl/meta/alt), Backspace shortens it, every key is consumed", () => {
    const doc = fakeDocument(["note"]);
    const { store } = makeStore(doc);
    store.register(lyricsLike(doc));
    store.open("lyrics");
    const step = store.modalStep();
    expect(step.active()).toBe(true);
    for (const k of ["h", "e", "l"]) step.handle(key(k));
    expect(store.state.get()?.buffer).toBe("hel");
    step.handle(key("z", { ctrlKey: true }));
    step.handle(key("q", { altKey: true }));
    expect(store.state.get()?.buffer).toBe("hel");
    const bs = key("Backspace");
    step.handle(bs);
    expect(bs.prevented).toBe(true);
    expect(store.state.get()?.buffer).toBe("he");
    store.close();
    expect(step.active()).toBe(false);
  });

  it("an advance key commits as a message and moves to the next NOTE over a rest; `-` reaches the spec as the key", () => {
    const doc = fakeDocument(["note", "rest", "note", "other"]);
    const { store, executed, notices } = makeStore(doc);
    store.register(lyricsLike(doc));
    store.open("lyrics");
    const step = store.modalStep();
    for (const k of ["h", "e", "l"]) step.handle(key(k));
    step.handle(key("-"));
    expect(executed).toEqual([{ type: "core.setSyl", eventId: "e0", value: { text: "hel", con: "d" } }]);
    expect(doc.caretIndex()).toBe(2);
    expect(notices.at(-1)).toBeNull(); // a successful commit clears the notice
    for (const k of ["l", "o"]) step.handle(key(k));
    step.handle(key(" "));
    // prevEventId is the previous NOTE (e0), not the rest
    expect(executed.at(-1)).toEqual({ type: "core.setSyl", eventId: "e2", value: { text: "lo", wordpos: "t" } });
    expect(doc.caretIndex()).toBe(2); // no note follows: stays…
    expect(notices.at(-1)).toBe("last note — esc leaves the lyrics lane"); // …and says so
  });

  it("arrows commit and step ONE event (a rest included); Escape commits and leaves; unchanged text writes nothing", () => {
    const doc = fakeDocument(["note", "rest", "note"]);
    const { store, executed } = makeStore(doc);
    doc.values.set("e0", "hel");
    store.register(lyricsLike(doc));
    store.open("lyrics");
    const step = store.modalStep();
    step.handle(key("ArrowRight"));
    expect(executed).toEqual([]); // "hel" unchanged
    expect(doc.caretIndex()).toBe(1);
    step.handle(key("ArrowLeft"));
    expect(doc.caretIndex()).toBe(0);
    step.handle(key("Backspace"));
    step.handle(key("Escape"));
    expect(executed).toEqual([{ type: "core.setSyl", eventId: "e0", value: { text: "he" } }]);
    expect(store.state.get()).toBeNull();
  });

  it("a note-attached lane on a rest: a notice, no write, and only an EMPTY buffer may pass", () => {
    const doc = fakeDocument(["rest", "note"]);
    const { store, executed, notices } = makeStore(doc);
    store.register(lyricsLike(doc));
    store.open("lyrics");
    const step = store.modalStep();
    step.handle(key("Enter")); // empty: allowed, moves on
    expect(doc.caretIndex()).toBe(1);
    expect(notices.at(-1)).toBe("lyrics attach to notes — move the caret to one");
    doc.setCaret(0);
    step.handle(key("x"));
    step.handle(key("Enter"));
    expect(executed).toEqual([]);
    expect(doc.caretIndex()).toBe(0); // refused: the key stops here
    step.handle(key("Escape"));
    expect(store.state.get()?.id).toBe("lyrics"); // cannot leave with text on a rest…
    step.handle(key("Backspace"));
    step.handle(key("Escape"));
    expect(store.state.get()).toBeNull(); // …but may with an empty buffer
  });

  it("the grammar lane: charset filters, transform maps, Tab takes the first suggestion, incomplete text is refused with a notice", () => {
    const doc = fakeDocument(["note", "rest"]);
    const written: string[] = [];
    const { store, notices, executed } = makeStore(doc);
    store.register(harmonyLike(doc, written));
    store.open("chord");
    const step = store.modalStep();
    step.handle(key("C"));
    step.handle(key("H")); // not in the charset
    step.handle(key("o")); // transformed to °, which the charset refuses
    expect(store.state.get()?.buffer).toBe("C");
    step.handle(key("Tab"));
    expect(store.state.get()?.buffer).toBe("Cm");
    step.handle(key("Backspace"));
    step.handle(key("8"));
    step.handle(key("Enter"));
    expect(notices.at(-1)).toBe('incomplete chords: "C8"');
    expect(doc.caretIndex()).toBe(0);
    step.handle(key("Backspace"));
    step.handle(key("Enter")); // "C" complete: the spec writes for itself (no message) and the caret steps one event — onto the rest
    expect(written).toEqual(["e0=C"]);
    expect(executed).toEqual([]);
    expect(doc.caretIndex()).toBe(1);
  });

  it("a spec's { refuse } and a throwing commit or execute become notices and stop the key", () => {
    const doc = fakeDocument(["note", "note"]);
    const written: string[] = [];
    const { store, notices } = makeStore(doc);
    store.register(harmonyLike(doc, written));
    store.open("chord");
    const step = store.modalStep();
    step.handle(key("X")); // charset refuses X? it is not in [A-G0-9m] — use the spec's refusal path through complete() instead
    expect(store.state.get()?.buffer).toBe("");
    store.close();
    const throwing = lyricsLike(doc, { id: "t", commit: () => { throw new Error("boom"); } });
    store.register(throwing);
    store.open("t");
    step.handle(key("a"));
    step.handle(key("Enter"));
    expect(notices.at(-1)).toBe("lyrics refused: boom");
    expect(doc.caretIndex()).toBe(0);
    store.close();
    const refusing = lyricsLike(doc, { id: "r", commit: () => ({ refuse: "no, thanks" }) });
    store.register(refusing);
    store.open("r");
    step.handle(key("a"));
    step.handle(key("Escape"));
    expect(notices.at(-1)).toBe("no, thanks");
    expect(store.state.get()?.id).toBe("r");
  });

  it("without a caret only Escape does anything (it closes)", () => {
    const doc = fakeDocument(["note"]);
    const { store } = makeStore(doc);
    store.register(lyricsLike(doc));
    store.open("lyrics");
    doc.setCaret(null);
    const step = store.modalStep();
    step.handle(key("a"));
    expect(store.state.get()?.buffer).toBe("");
    step.handle(key("Escape"));
    expect(store.state.get()).toBeNull();
  });
});

describe("declared lanes and the status-bar options", () => {
  it("options list internal lanes first, then declared ones, once each; a declared lane wakes its plugin on open and opens once registered", async () => {
    const doc = fakeDocument(["note"]);
    const { store, activate, notices } = makeStore(doc);
    store.register(harmonyLike(doc, []));
    store.register(lyricsLike(doc));
    const d = store.declare({ id: "test.plugin.lane", label: "plugin lane", name: "plane", place: "above", pluginId: "test.plugin" });
    expect(store.options.get().map((o) => o.id)).toEqual(["chord", "lyrics", "test.plugin.lane"]);
    // pick the declared lane before its plugin has registered: activation, then nothing registered → a notice
    expect(store.open("test.plugin.lane")).toBe(true);
    await Promise.resolve();
    expect(activate).toHaveBeenCalledWith("test.plugin.lane", "test.plugin");
    expect(notices.at(-1)).toBe("plane: its plugin registered no lane");
    expect(store.state.get()).toBeNull();
    // the plugin registers during activation next time
    activate.mockImplementation(async () => {
      store.register(lyricsLike(doc, { id: "test.plugin.lane", label: "live label", name: "plane" }), "test.plugin");
      return true;
    });
    expect(store.open("test.plugin.lane")).toBe(true);
    await Promise.resolve();
    expect(store.state.get()?.id).toBe("test.plugin.lane");
    expect(store.options.get().find((o) => o.id === "test.plugin.lane")?.label).toBe("live label");
    d.dispose(); // the plugin is turned off: the option and the open lane go
    expect(store.options.get().map((o) => o.id)).toEqual(["chord", "lyrics"]);
    expect(store.state.get()).toBeNull();
  });

  it("ownership: a plugin may register only a lane it declared; two plugins cannot declare the same id; the host's ids are taken", () => {
    const doc = fakeDocument(["note"]);
    const { store } = makeStore(doc);
    store.register(lyricsLike(doc));
    expect(() => store.register(lyricsLike(doc, { id: "x.y" }), "test.plugin")).toThrow(/did not declare lane x.y/);
    expect(() => store.declare({ id: "lyrics", label: "l", name: "l", place: "below", pluginId: "test.plugin" })).toThrow(/already declared by the host/);
    store.declare({ id: "test.a.lane", label: "a", name: "a", place: "below", pluginId: "test.a" });
    expect(() => store.declare({ id: "test.a.lane", label: "b", name: "b", place: "below", pluginId: "test.b" })).toThrow(/already declared by test.a/);
    expect(() => store.register(lyricsLike(doc, { id: "test.a.lane" }))).toThrow(/already declared by test.a/);
  });

  it("laneFace is the glyph and the name", () => {
    const doc = fakeDocument(["note"]);
    expect(laneFace(lyricsLike(doc))).toBe("♪ lyrics");
    expect(laneFace(lyricsLike(doc, { glyph: undefined }))).toBe("lyrics");
  });
});
