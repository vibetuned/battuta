/**
 * The plugin against a REAL host (`createHost` with memory-backed settings
 * and storage), a fake session whose timemap is two notes in two measures,
 * and a fake AudioContext whose `decodeAudioData` answers half a second of
 * A4. The detector, the alignment and the axis have their own suites; what
 * is left is the lifecycle a panel-and-overlay plugin can get wrong: what
 * shows before any code loads, what a click does, a load end to end (the
 * unlock on the gesture, decode, analysis, the score read, the offset
 * found, the deviation), the alignment kept per document, a platform
 * without audio, off and on again, and the switch taking everything away.
 *
 * Nothing is rendered — a plugin package may not depend on react-dom; the
 * elements `render()` returns carry the whole contract in their props.
 */
import { describe, it, expect } from "vitest";
import type { PluginEntry, Timemap, TileOverlayProps } from "@battuta/api";
import { createHost, memorySettings, HostAudioService, HostMidiService, type Host, type SessionAdapter } from "../../../../apps/editor/src/host";
import { memoryStorage } from "../../../../apps/editor/src/host/services";
import type { MidiBackend } from "../../../../apps/editor/src/host/midi";
import { manifest, COMMAND_TOGGLE, OVERLAY_ID, PANEL_ID, STORAGE_ALIGN } from "../src/manifest";
import type { PanelActions, RefState } from "../src/Panel";
import plugin from "../src/index";

const PLUGIN_ID = manifest.id;
const flush = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
};
/** The analysis yields between chunks and awaits the decode: give it real time. */
const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 5));
};

const TIMEMAP: Timemap = {
  events: [
    { tstamp: 0, on: ["n1"], measureOn: "m1" },
    { tstamp: 500, off: ["n1"], on: ["n2"], measureOn: "m2" },
    { tstamp: 1000, off: ["n2"] },
  ],
  notes: { n1: { pitch: 69, duration: 500 }, n2: { pitch: 71, duration: 500 } },
  idMap: {},
};

const sine = (hz: number, seconds: number, rate: number): Float32Array => {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
};

interface Fixture {
  host: Host;
  /** The fake context's clock, settable. */
  clock(seconds: number): void;
  loads(): number;
  resumes(): number;
  panelIds(): string[];
  overlayIds(): string[];
  headerItems(): { id: string; declared?: boolean }[];
  panel(): { state: { get(): RefState }; actions: PanelActions };
  /** The overlay element the spec renders for a tile, and its props. */
  overlayFor(tile: TileOverlayProps): { tile: TileOverlayProps } | null;
  state(): RefState;
  stored(name: string): unknown;
  executed(): unknown[];
  /** Every MIDI byte triple that reached the fake outputs. */
  sent(): number[][];
  notices(): string[];
  publish(doc: { id: string; name: string; version?: number; tempo?: number | null }): void;
}

function fixture(opts: { audio?: boolean; outputs?: string[] | null } = {}): Fixture {
  let loads = 0;
  let resumes = 0;
  const executed: unknown[] = [];
  const sent: number[][] = [];
  const notices: string[] = [];
  const names = opts.outputs === undefined ? ["Fake synth"] : opts.outputs;
  const backend: MidiBackend = {
    start: (deliver) => {
      deliver.devices([]);
      return () => undefined;
    },
    openOutputs: async () => (names === null ? null : { names, transmit: (data: number[]) => void sent.push(data), release: () => undefined }),
  };
  const entry: PluginEntry = {
    manifest,
    load: async () => {
      loads++;
      return { default: plugin };
    },
  };
  const buffer = { sampleRate: 16000, numberOfChannels: 1, length: 8000, duration: 0.5, getChannelData: () => sine(440, 0.5, 16000) };
  const context = {
    state: "suspended",
    currentTime: 0,
    destination: {},
    resume: async () => {
      resumes++;
      context.state = "running";
    },
    decodeAudioData: async () => buffer,
    createBufferSource: () => ({ buffer: null as unknown, connect: () => undefined, disconnect: () => undefined, start: () => undefined, stop: () => undefined, onended: null as (() => void) | null }),
  };
  const storage = memoryStorage();
  const host = createHost({
    layout: "qwerty",
    plugins: [entry],
    settings: memorySettings(),
    storage,
    confirm: async () => true,
    audio: new HostAudioService(() => (opts.audio === false ? null : (context as unknown as AudioContext))),
    midi: new HostMidiService(backend),
  });
  host.notices.subscribe((n) => {
    if (n?.text) notices.push(n.text);
  });
  const adapter: SessionAdapter = {
    execute: (cmd) => executed.push(cmd),
    pitchEventsIn: () => [],
    blockOf: () => null,
    lyricAt: () => null,
    harmAt: () => "",
    timemap: async () => TIMEMAP,
    notation: () => ({ ties: {}, marks: {} }),
    eventIdAt: (caret) => (caret.measureIndex === 0 ? "n1" : caret.measureIndex === 1 ? "n2" : null),
    mei: () => "",
  };
  host.bindSession(adapter);
  const publish: Fixture["publish"] = ({ id, name, version = 1, tempo = 120 }) => host.document.set({ id, name, dirty: false, version, measureCount: 2, staffCount: 1, title: "", tempo });
  publish({ id: "doc-1", name: "take" });
  const panelEl = () => host.panels.panels.get().find((p) => p.id === PANEL_ID)?.render() as { props: { state: { get(): RefState }; actions: PanelActions } } | undefined;
  return {
    host,
    clock: (seconds) => {
      context.currentTime = seconds;
    },
    loads: () => loads,
    resumes: () => resumes,
    panelIds: () => host.panels.panels.get().map((p) => p.id),
    overlayIds: () => host.overlays.specs.get().map((o) => `${o.pluginId}:${o.id}`),
    headerItems: () => host.slots.items.get().header.map((i) => ({ id: i.id, ...("declared" in i ? { declared: (i as { declared?: boolean }).declared } : {}) })),
    panel: () => {
      const el = panelEl();
      if (!el) throw new Error("no panel");
      return el.props;
    },
    overlayFor: (tile) => {
      const spec = host.overlays.specs.get().find((o) => o.id === OVERLAY_ID);
      const el = spec?.render(tile) as { props: { tile: TileOverlayProps } } | null | undefined;
      return el ? el.props : null;
    },
    state: () => panelEl()!.props.state.get(),
    // the namespace's one blob, as `pluginStorage` keys it
    stored: (name) => (JSON.parse(storage.getItem(`battuta.plugin.${PLUGIN_ID}.v1`) ?? "{}") as Record<string, unknown>)[`${STORAGE_ALIGN}${name}`],
    executed: () => executed,
    sent: () => sent,
    notices: () => notices,
    publish,
  };
}

const take = (name = "take.wav") => ({ name, arrayBuffer: async () => new ArrayBuffer(16) });

describe("before any code loads", () => {
  it("the 🎙 is declared in the header, and nothing else is there", () => {
    const f = fixture();
    expect(f.headerItems().map((i) => i.id)).toEqual([`${PLUGIN_ID}:toggle`]);
    expect(f.loads()).toBe(0);
    expect(f.panelIds()).toEqual([]);
    expect(f.overlayIds()).toEqual([]);
    expect(f.host.keymapView.get().some((e) => e.plugin === PLUGIN_ID)).toBe(false);
  });
});

describe("the toggle", () => {
  it("loads the plugin, opens the bottom panel and mounts the overlay; again closes both", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    await flush();
    expect(f.loads()).toBe(1);
    expect(f.panelIds()).toEqual([PANEL_ID]);
    expect(f.overlayIds()).toEqual([`${PLUGIN_ID}:${OVERLAY_ID}`]);
    expect(f.state().status).toBe("empty");
    expect(f.state().measures).toEqual([
      { id: "m1", fromMs: 0, toMs: 500 },
      { id: "m2", fromMs: 500, toMs: 1000 },
    ]);
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    await flush();
    expect(f.panelIds()).toEqual([]);
    expect(f.overlayIds()).toEqual([]);
    expect(f.loads()).toBe(1);
  });
});

describe("a recording", () => {
  it("is unlocked on the gesture, decoded, analysed, aligned and compared with the score", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    await flush();
    const { actions } = f.panel();
    actions.unlock();
    await flush();
    expect(f.resumes()).toBe(1);
    actions.load(take());
    await settle();
    const s = f.state();
    expect(s.status).toBe("ready");
    expect(s.fileName).toBe("take.wav");
    expect(s.durationMs).toBe(500);
    expect(s.frames.length).toBeGreaterThan(30);
    const voiced = s.frames.filter((fr) => fr.midi !== null);
    expect(voiced.length).toBe(s.frames.length);
    for (const fr of voiced) expect(Math.abs(fr.midi! - 69)).toBeLessThan(0.1);
    expect(s.envelope?.length).toBe(600);
    expect(s.alignment).toEqual({ offsetMs: 0, rate: 1 });
    expect(s.written.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(s.deviation).not.toBeNull();
    expect(s.deviation!.median).toBeLessThan(0.1);
    expect(s.deviation!.compared).toBeGreaterThan(30);
    // the summary is a notice, not panel text
    expect(f.host.notices.get()?.text).toMatch(/^take\.wav: 0\.5 s · \d+ voiced of \d+ frames · within \d+ cents/);
    // the overlay renders for a tile of m1 and refuses a measure the timemap does not know
    const tile: TileOverlayProps = { measureIndex: 0, measureId: "m1", width: 200, height: 100, boxes: {}, staves: [] };
    expect(f.overlayFor(tile)?.tile.measureId).toBe("m1");
    expect(f.executed()).toEqual([]);
  });

  it("keeps the alignment per document and recomputes the rate from the tempos", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    await flush();
    const { actions } = f.panel();
    actions.load(take());
    await settle();
    actions.setOffset(120);
    expect(f.state().alignment.offsetMs).toBe(120);
    expect(f.stored("take")).toEqual({ offsetMs: 120, recordedTempo: null, transpose: 0 });
    actions.setRecordedTempo(90);
    expect(f.state().alignment.rate).toBeCloseTo(0.75, 9); // 90 over the score's 120
    expect(f.stored("take")).toEqual({ offsetMs: 120, recordedTempo: 90, transpose: 0 });
    actions.setRecordedTempo(null);
    expect(f.state().alignment.rate).toBe(1);
    // the transpose shifts the compared trace, not the detected one, and is kept with the alignment
    const before = f.state().deviation!.median;
    actions.setTranspose(-12);
    expect(f.state().transpose).toBe(-12);
    expect(f.state().raw.filter((fr) => fr.midi !== null).every((fr) => Math.abs(fr.midi! - 69) < 0.1)).toBe(true);
    expect(f.state().frames.filter((fr) => fr.midi !== null).every((fr) => Math.abs(fr.midi! - 57) < 0.1)).toBe(true);
    expect(f.state().deviation!.median).toBeGreaterThan(before + 11);
    expect(f.stored("take")).toEqual({ offsetMs: 120, recordedTempo: null, transpose: -12 });
    actions.setTranspose(0);
    expect(f.state().deviation!.median).toBe(before);
    // another document: its own remembered numbers (none yet → untouched offset), then back
    f.publish({ id: "doc-2", name: "other" });
    await flush();
    expect(f.state().alignment.offsetMs).toBe(120);
    actions.setOffset(40);
    expect(f.stored("other")).toEqual({ offsetMs: 40, recordedTempo: null, transpose: 0 });
    f.publish({ id: "doc-1", name: "take" });
    await flush();
    expect(f.state().alignment.offsetMs).toBe(120);
    // the checkbox and clear
    actions.setShowOverlays(false);
    expect(f.state().showOverlays).toBe(false);
    actions.clear();
    expect(f.state().status).toBe("empty");
    expect(f.state().frames).toEqual([]);
    expect(f.state().showOverlays).toBe(false);
    expect(f.state().measures.length).toBe(2); // the score stays
  });

  it("plays from the playhead, pauses where it is, seeks, and follows the caret to the event's moment", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    await flush();
    const { actions } = f.panel();
    actions.load(take());
    await settle();
    expect(f.state().playing).toBe(false);
    expect(f.state().playheadMs).toBe(0); // bar 1 begins at 0 in this take
    actions.seek(100);
    expect(f.state().playheadMs).toBe(100);
    actions.playPause();
    await flush();
    expect(f.state().playing).toBe(true);
    f.clock(0.2);
    await new Promise((r) => setTimeout(r, 120)); // a poll or two
    expect(f.state().playheadMs).toBeCloseTo(300, 0);
    actions.playPause();
    expect(f.state().playing).toBe(false);
    expect(f.state().playheadMs).toBeCloseTo(300, 0);
    // the caret moves to m1's note: the playhead goes to its onset through the alignment
    actions.setOffset(150);
    f.host.editor.set({ ...f.host.editor.get(), caret: { measureIndex: 0, staffN: 1, layerN: 1, eventIndex: 0 } });
    expect(f.state().playheadMs).toBe(150); // 150 + 0
    // m2's note would be at 650 — past this half-second take, so the playhead stops at its end
    f.host.editor.set({ ...f.host.editor.get(), caret: { measureIndex: 1, staffN: 1, layerN: 1, eventIndex: 0 } });
    expect(f.state().playheadMs).toBe(500);
    // the same caret republished (a selection change) moves nothing; a caret beyond the recording is clamped
    actions.seek(20);
    f.host.editor.set({ ...f.host.editor.get(), selection: ["n2"] });
    expect(f.state().playheadMs).toBe(20);
    actions.seek(9000);
    expect(f.state().playheadMs).toBe(500); // the take is half a second
    // clear stops and forgets
    actions.playPause();
    await flush();
    actions.clear();
    expect(f.state().playing).toBe(false);
    expect(f.state().buffer).toBeNull();
    expect(f.executed()).toEqual([]);
  });

  it("plays the written notes through the MIDI outputs from the playhead, plainly, and pause releases them", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    await flush();
    const { actions } = f.panel();
    actions.load(take());
    await settle();
    expect(f.sent()).toEqual([]);
    actions.playPauseScore();
    await flush();
    expect(f.state().playingScore).toBe(true);
    expect(f.notices().some((n) => n.startsWith("written notes → Fake synth"))).toBe(true);
    await new Promise((r) => setTimeout(r, 30)); // n1 is due at once
    expect(f.sent()[0]).toEqual([0x90, 69, 100]);
    expect(f.sent().some((d) => d[0] === 0x90 && d[1] === 71)).toBe(false); // n2 is half a second away
    actions.playPauseScore();
    expect(f.state().playingScore).toBe(false);
    expect(f.sent().some((d) => d[0] === 0x80 && d[1] === 71)).toBe(false); // never attacked, never released
    expect(f.sent().some((d) => d[0] === 0x80 && d[1] === 69)).toBe(true); // the sounding note released by the panic
    expect(f.sent().some((d) => d[0] === 0xb0 && d[1] === 123)).toBe(true); // …and all notes off
    // the recording's transport is separate, and seeking while the score plays restarts it there
    actions.playPauseScore();
    await flush();
    actions.seek(100);
    expect(f.state().playheadMs).toBe(100);
    actions.playPauseScore();
    // the score sounds in the take's register: the inverse of the trace transposition
    const before = f.sent().length;
    actions.setTranspose(12); // the voice sang an octave under the written part
    actions.seek(0);
    actions.playPauseScore();
    await flush();
    await new Promise((r) => setTimeout(r, 30));
    expect(f.sent().slice(before).find((d) => d[0] === 0x90)).toEqual([0x90, 57, 100]); // A4 written, A3 played
    actions.playPauseScore();
    actions.setTranspose(0);
    expect(f.executed()).toEqual([]);
  });

  it("without MIDI outputs the score button says so and nothing plays", async () => {
    const f = fixture({ outputs: null });
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    await flush();
    f.panel().actions.load(take());
    await settle();
    f.panel().actions.playPauseScore();
    await flush();
    expect(f.state().playingScore).toBe(false);
    expect(f.notices().some((n) => /no MIDI outputs found/.test(n))).toBe(true);
    expect(f.sent()).toEqual([]);
  });

  it("says so where there is no audio", async () => {
    const f = fixture({ audio: false });
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    await flush();
    f.panel().actions.load(take());
    await settle();
    expect(f.state().status).toBe("error");
    expect(f.state().error).toMatch(/audio is not available/);
  });
});

describe("off", () => {
  it("takes the panel, the overlay and the live button away, and the declared face comes back", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    await flush();
    expect(f.headerItems().map((i) => i.id)).toEqual([`${PLUGIN_ID}:toggle`]);
    await f.host.registry.setEnabled(PLUGIN_ID, false);
    await flush();
    expect(f.panelIds()).toEqual([]);
    expect(f.overlayIds()).toEqual([]);
    expect(f.headerItems().map((i) => i.id)).toEqual([]);
    await f.host.registry.setEnabled(PLUGIN_ID, true);
    expect(f.headerItems().map((i) => i.id)).toEqual([`${PLUGIN_ID}:toggle`]);
    expect(f.executed()).toEqual([]);
  });
});
