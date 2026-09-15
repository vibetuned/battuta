/**
 * The plugin against a REAL host (`createHost` with memory-backed settings
 * and storage) and a fake score: a four-event timemap, two ties' worth of
 * notation facts, and a MIDI backend that records every byte sent.
 *
 * What makes playback testable without a browser is that the performance
 * drives BOTH sinks identically: choose the MIDI one and the whole
 * transport runs in node — no AudioContext, no Tone.js, no samples — so
 * play/pause/stop, the transpose, and the two things that must stop the
 * player (leaving page view, an edit) are assertions here rather than
 * hopes. The piano half is the browser script's job
 * (`spikes/verify-phase5.mjs`, the playback section), and the
 * interpretation is `test/performance.test.ts`.
 *
 * The row is not rendered — a plugin package may not depend on react-dom,
 * and the host owns the React root. A slot item's `render()` returns an
 * element whose props are the row's whole contract, which is enough to
 * drive every control.
 */
import { describe, it, expect } from "vitest";
import type { PluginEntry, Timemap } from "@battuta/api";
import { createHost, memorySettings, HostMidiService, type Host, type SessionAdapter } from "../../../../apps/editor/src/host";
import { memoryStorage, type SettingsIO } from "../../../../apps/editor/src/host/services";
import type { MidiBackend } from "../../../../apps/editor/src/host/midi";
import { manifest, EXPORT_MIDI, SETTING_MIDI_OUT, SETTING_TEMPO, SETTING_TRANSPOSE } from "../src/manifest";
import { ROW_ID } from "../src/index";
import plugin from "../src/index";

const PLUGIN_ID = manifest.id;
const flush = () => new Promise((r) => setTimeout(r, 0));
/** Long enough for the scheduler's first tick and the sink's 0 ms timers. */
const settle = () => new Promise((r) => setTimeout(r, 30));

/** Two notes, the second a tie continuation of the first, then one more. */
const TIMEMAP: Timemap = {
  events: [
    { tstamp: 0, on: ["n1"], measureOn: "m1" },
    { tstamp: 500, off: ["n1"], on: ["n2"] },
    { tstamp: 1000, off: ["n2"] },
  ],
  notes: { n1: { pitch: 60, duration: 500 }, n2: { pitch: 64, duration: 500 } },
  idMap: {},
};

interface Fixture {
  host: Host;
  settings: SettingsIO;
  /** How many times the host asked for the plugin's code. */
  loads(): number;
  /** Command messages the plugin sent (it sends none — playback never writes). */
  executed(): unknown[];
  /** Every MIDI byte triple that reached a port. */
  sent(): number[][];
  notices(): string[];
  /** The ids listed in the battuta menu's export section. */
  exportIds(): string[];
  /** Ids of the items in the second header row. */
  rowIds(): string[];
  /** The row element's props: the store it draws from, the view it draws in, and every control. */
  row(): { transport: { get(): Record<string, unknown> }; view: { get(): string }; actions: Record<string, (...a: never[]) => void> } | null;
  /** Highlight cues the view adapter received, and clears. */
  lit(): string[];
  cleared(): number;
  view(mode: "tiles" | "pages"): Promise<void>;
  edit(): void;
}

function fixture(saved: Record<string, unknown> = {}, opts: { outputs?: string[] | null } = {}): Fixture {
  let loads = 0;
  const executed: unknown[] = [];
  const sent: number[][] = [];
  const notices: string[] = [];
  const lit: string[] = [];
  let cleared = 0;
  let version = 1;

  // The module is imported at file scope and `load` only counts, so "no
  // code loaded until something asks" is a counted assertion.
  const entry: PluginEntry = {
    manifest,
    load: async () => {
      loads++;
      return { default: plugin };
    },
  };
  const settings = memorySettings({ plugins: { [PLUGIN_ID]: { values: saved } } });
  const names = opts.outputs === undefined ? ["Fake synth"] : opts.outputs;
  const backend: MidiBackend = {
    start: (deliver) => {
      deliver.devices([]);
      return () => undefined;
    },
    openOutputs: async () => (names === null ? null : { names, transmit: (data: number[]) => sent.push(data), release: () => undefined }),
  };
  const host = createHost({ layout: "qwerty", plugins: [entry], settings, storage: memoryStorage(), confirm: async () => true, midi: new HostMidiService(backend) });
  const adapter: SessionAdapter = {
    execute: (cmd) => executed.push(cmd),
    pitchEventsIn: () => [],
    blockOf: () => null,
    lyricAt: () => null,
    harmAt: () => "",
    timemap: async () => TIMEMAP,
    notation: () => ({ ties: {}, marks: {} }),
  };
  host.bindSession(adapter);
  host.bindView({
    highlight: (cue) => lit.push(...cue.on),
    clearHighlight: () => {
      cleared++;
    },
  });
  host.notices.subscribe((n) => n?.text && notices.push(n.text));
  const publish = () => host.document.set({ id: "doc-1", name: "score", version, measureCount: 2, staffCount: 1, title: "", tempo: null });
  publish();

  const items = () => host.slots.items.get().docHeader;
  return {
    host,
    settings,
    loads: () => loads,
    executed: () => executed,
    sent: () => sent,
    notices: () => notices,
    exportIds: () => host.formats.exports.get().map((e) => e.id),
    rowIds: () => items().map((i) => i.id),
    row: () => {
      const item = items().find((i) => i.id === `${PLUGIN_ID}:${ROW_ID}`);
      const el = item?.render?.() as { props?: Record<string, never> } | null | undefined;
      return (el?.props as never) ?? null;
    },
    lit: () => lit,
    cleared: () => cleared,
    view: async (mode) => {
      host.editor.set({ ...host.editor.get(), view: mode });
      await flush();
      await flush();
    },
    edit: () => {
      version++;
      publish();
    },
  };
}

describe("before any of this plugin's code exists", () => {
  it("lists the playback-MIDI export in the menu and adds nothing to the header row", () => {
    const f = fixture();
    expect(f.exportIds()).toEqual([EXPORT_MIDI]);
    expect(f.rowIds()).toEqual([]);
    expect(f.loads()).toBe(0);
  });

  it("opening page view is what loads it — once", async () => {
    const f = fixture();
    await f.view("pages");
    expect(f.loads()).toBe(1);
    expect(f.rowIds()).toEqual([`${PLUGIN_ID}:row`]);
    await f.view("tiles");
    await f.view("pages");
    expect(f.loads()).toBe(1);
  });

  it("picking the export with the plugin cold wakes it and produces an SMF", async () => {
    const f = fixture();
    const payload = await f.host.formats.produce(EXPORT_MIDI);
    expect(f.loads()).toBe(1);
    const bytes = payload.bytes as Uint8Array;
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("MThd");
    // `<name>-playback.mid`, as 0.0.3 saved it — from DocumentInfo.name (BUILDING.md §7.2, resolved)
    expect(payload.filename).toBe("score-playback.mid");
  });
});

describe("the transport row", () => {
  it("draws nothing outside page view and the whole row inside it", async () => {
    const f = fixture();
    await f.view("pages");
    expect(f.row()!.view.get()).toBe("pages");
    // The row ITEM stays registered in tile view; it is the component that
    // renders null, off its own view store — so no slot churn and no
    // remount on every view flip (and none mid-play).
    await f.view("tiles");
    expect(f.rowIds()).toEqual([`${PLUGIN_ID}:row`]);
    expect(f.row()!.view.get()).toBe("tiles");
  });

  it("starts from the plugin's own settings, not from defaults", async () => {
    const f = fixture({ [SETTING_TEMPO]: 1.5, [SETTING_MIDI_OUT]: true, [SETTING_TRANSPOSE]: -12 });
    await f.view("pages");
    expect(f.row()!.transport.get()).toMatchObject({ tempo: 1.5, midiOut: true, transpose: -12 });
  });

  it("refuses a speed the select does not offer and a transpose out of range", async () => {
    const f = fixture({ [SETTING_TEMPO]: 3.7, [SETTING_TRANSPOSE]: 99 });
    await f.view("pages");
    expect(f.row()!.transport.get()).toMatchObject({ tempo: 1, transpose: 0 });
  });

  it("persists every choice into the plugin's namespace as it is made", async () => {
    const f = fixture();
    await f.view("pages");
    const { actions } = f.row()!;
    (actions["setTempo"] as (n: number) => void)(2);
    (actions["setMidiOut"] as (b: boolean) => void)(true);
    (actions["setTranspose"] as (n: number) => void)(7);
    const values = f.settings.load().plugins?.[PLUGIN_ID]?.values;
    expect(values).toMatchObject({ [SETTING_TEMPO]: 2, [SETTING_MIDI_OUT]: true, [SETTING_TRANSPOSE]: 7 });
    // and the root blob is not where they land any more
    expect(f.settings.load().tempo).toBeUndefined();
  });
});

describe("playing to the MIDI outputs", () => {
  const play = async (f: Fixture) => {
    (f.row()!.actions["playPause"] as () => void)();
    await settle();
  };

  it("sends the performance, names the ports, and lights the notation", async () => {
    const f = fixture({ [SETTING_MIDI_OUT]: true });
    await f.view("pages");
    await play(f);
    expect(f.row()!.transport.get()["state"]).toBe("playing");
    expect(f.notices().some((n) => n.includes("Fake synth"))).toBe(true);
    expect(f.sent().filter((d) => d[0] === 0x90).map((d) => d[1])).toContain(60);
    expect(f.lit()).toContain("n1");
    (f.row()!.actions["stop"] as () => void)();
  });

  it("transposes the sends by the setting, and only the sends", async () => {
    const f = fixture({ [SETTING_MIDI_OUT]: true, [SETTING_TRANSPOSE]: 12 });
    await f.view("pages");
    await play(f);
    expect(f.sent().filter((d) => d[0] === 0x90).map((d) => d[1])).toContain(72);
    (f.row()!.actions["stop"] as () => void)();
  });

  it("says so and falls back to the piano when there is no output at all", async () => {
    const f = fixture({ [SETTING_MIDI_OUT]: true }, { outputs: null });
    await f.view("pages");
    (f.row()!.actions["playPause"] as () => void)();
    await settle();
    expect(f.notices()).toContain("no MIDI outputs found — playing through the built-in piano");
  });

  it("stops when the view leaves page view — the row would vanish mid-note", async () => {
    const f = fixture({ [SETTING_MIDI_OUT]: true });
    await f.view("pages");
    await play(f);
    const before = f.cleared();
    await f.view("tiles");
    expect(f.row()!.transport.get()["state"]).toBe("idle");
    expect(f.cleared()).toBeGreaterThan(before); // the highlight went with it
  });

  it("stops on an edit: every stamp in the schedule came from the old document", async () => {
    const f = fixture({ [SETTING_MIDI_OUT]: true });
    await f.view("pages");
    await play(f);
    f.edit();
    await flush();
    expect(f.row()!.transport.get()["state"]).toBe("idle");
  });

  it("pauses and resumes without re-reading the document", async () => {
    const f = fixture({ [SETTING_MIDI_OUT]: true });
    await f.view("pages");
    await play(f);
    (f.row()!.actions["playPause"] as () => void)();
    expect(f.row()!.transport.get()["state"]).toBe("paused");
    (f.row()!.actions["playPause"] as () => void)();
    expect(f.row()!.transport.get()["state"]).toBe("playing");
    (f.row()!.actions["stop"] as () => void)();
  });
});

describe("the export", () => {
  it("writes the same performance the player plays, transposed by the same setting", async () => {
    const plain = await fixture().host.formats.produce(EXPORT_MIDI);
    const up = await fixture({ [SETTING_TRANSPOSE]: 12 }).host.formats.produce(EXPORT_MIDI);
    expect((plain.bytes as Uint8Array).length).toBe((up.bytes as Uint8Array).length);
    expect(Array.from(plain.bytes as Uint8Array)).not.toEqual(Array.from(up.bytes as Uint8Array));
  });

  it("refuses politely with nothing open", async () => {
    const f = fixture();
    f.host.bindSession(null);
    await expect(f.host.formats.produce(EXPORT_MIDI)).rejects.toThrow("no document is open");
  });
});

describe("the switch", () => {
  it("takes the row and the export away together, and writes nothing to the score", async () => {
    const f = fixture();
    await f.view("pages");
    expect(f.rowIds()).toHaveLength(1);
    await f.host.registry.setEnabled(PLUGIN_ID, false);
    expect(f.rowIds()).toEqual([]);
    expect(f.exportIds()).toEqual([]);
    expect(f.executed()).toEqual([]); // playback reads; it never writes
  });
});
