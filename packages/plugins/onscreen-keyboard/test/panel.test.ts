/**
 * The plugin against a REAL host (`createHost` with memory-backed settings
 * and storage): what the user sees before any code loads, every path that
 * wakes the plugin up, what the switch takes away, and the piano.
 *
 * The panel itself is NOT rendered here — a plugin package may not depend
 * on react-dom, and the host owns the React root. What a unit test can do
 * is call the panel spec's `render()` and read the element's props, which
 * is enough to drive the × (its `onClose`). The pixels are the browser
 * script's job (`spikes/verify-onscreen-keyboard.mjs`, 24 checks by
 * tapping); the key model is `test/keys.test.ts`.
 */
import { describe, it, expect } from "vitest";
import type { MidiNoteEvent, PluginEntry } from "@battuta/api";
import { createHost, memorySettings, type Host, type SessionAdapter } from "../../../../apps/editor/src/host";
import { memoryStorage, type SettingsIO } from "../../../../apps/editor/src/host/services";
import { manifest, COMMAND_TOGGLE, PANEL_ID, SETTING_OPEN } from "../src/manifest";
import plugin from "../src/index";

const PLUGIN_ID = manifest.id;

interface Fixture {
  host: Host;
  settings: SettingsIO;
  /** How many times the host asked for the plugin's code. */
  loads(): number;
  /** Command messages the plugin sent (it sends none — that is the point). */
  executed(): unknown[];
  panelIds(): string[];
  headerItems(): { id: string; command?: string; declared?: boolean }[];
  /** The panel spec's element props — where the × lives. */
  close(): void;
  savedOpen(): boolean | undefined;
}

function fixture(saved?: { open?: boolean; enabled?: boolean }): Fixture {
  let loads = 0;
  const executed: unknown[] = [];
  // A real dynamic import settles unpredictably; the module is imported at
  // file scope and `load` just counts, so "no code loaded until something
  // asks" is a counted assertion rather than one inferred from state.
  const entry: PluginEntry = {
    manifest,
    load: async () => {
      loads++;
      return { default: plugin };
    },
  };
  const settings = memorySettings(
    saved === undefined
      ? {}
      : {
          plugins: {
            [PLUGIN_ID]: {
              ...(saved.enabled !== undefined ? { enabled: saved.enabled } : {}),
              ...(saved.open !== undefined ? { values: { [SETTING_OPEN]: saved.open } } : {}),
            },
          },
        },
  );
  const host = createHost({ layout: "qwerty", plugins: [entry], settings, storage: memoryStorage(), confirm: async () => true });
  const adapter: SessionAdapter = {
    execute: (cmd) => executed.push(cmd),
    pitchEventsIn: () => [],
    blockOf: () => null,
    lyricAt: () => null,
    harmAt: () => "",
    timemap: async () => ({ events: [], notes: {}, idMap: {} }),
    notation: () => ({ ties: {}, marks: {} }),
    mei: () => "",
  };
  host.bindSession(adapter);
  host.document.set({ id: "doc-1", name: "score", dirty: false, version: 1, measureCount: 4, staffCount: 2, title: "", tempo: null });

  return {
    host,
    settings,
    loads: () => loads,
    executed: () => executed,
    panelIds: () => host.panels.panels.get().map((p) => p.id),
    headerItems: () => host.slots.items.get().header as { id: string; command?: string; declared?: boolean }[],
    close: () => {
      const spec = host.panels.panels.get().find((p) => p.id === PANEL_ID)!;
      const element = spec.render() as { props: { onClose: () => void } };
      element.props.onClose();
    },
    savedOpen: () => settings.load().plugins?.[PLUGIN_ID]?.values?.[SETTING_OPEN] as boolean | undefined,
  };
}

describe("before any code loads", () => {
  it("the 🎹 is already in the header, rendered by the host from the manifest", () => {
    const f = fixture();
    const items = f.headerItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: `${PLUGIN_ID}:toggle`, command: COMMAND_TOGGLE, declared: true });
    expect(f.loads()).toBe(0);
    expect(f.panelIds()).toEqual([]);
  });

  it("contributes no keybinding: an extraction leaves the union keymap alone", () => {
    const f = fixture();
    expect(manifest.contributes?.keybindings).toBeUndefined();
    expect(f.host.keymapView.get().some((e) => e.plugin === PLUGIN_ID)).toBe(false);
  });

  it("registers cleanly: the host offers the midi capability it asks for", () => {
    const f = fixture();
    expect(f.host.registry.info(PLUGIN_ID)).toMatchObject({ state: "registered", enabled: true, error: null });
  });
});

describe("the wake-up paths", () => {
  // Activation runs BEFORE the handler that caused it, so every row of
  // this table is a chance to open a panel the handler then closes.
  // `ctx.activatedBy` is what tells them apart.
  it("the 🎹 loads the code and opens the panel", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    expect(f.loads()).toBe(1);
    expect(f.panelIds()).toEqual([PANEL_ID]);
    expect(f.savedOpen()).toBe(true);
  });

  it("…and a second 🎹 hides it again: the 0.0.3 gesture, not an open-only button", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    expect(f.panelIds()).toEqual([]);
    expect(f.savedOpen()).toBe(false);
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    expect(f.panelIds()).toEqual([PANEL_ID]);
  });

  it("a coarse pointer opens it at startup, without a click and without persisting a choice", async () => {
    const f = fixture();
    await f.host.fire("onPointer:coarse");
    expect(f.panelIds()).toEqual([PANEL_ID]);
    // The 0.0.3 default was not persisted either: only the user's own
    // toggle wrote `vkeys`.
    expect(f.savedOpen()).toBeUndefined();
  });

  it("…unless the user closed it before: the saved choice wins over the device", async () => {
    const f = fixture({ open: false });
    await f.host.fire("onPointer:coarse");
    expect(f.loads()).toBe(1);
    expect(f.panelIds()).toEqual([]);
  });

  it("a panel left open comes back at startup, on any pointer, through onSettings:open", async () => {
    const f = fixture({ open: true });
    await f.host.fireStartupEvents({ coarsePointer: false });
    expect(f.panelIds()).toEqual([PANEL_ID]);
  });

  it("…and a closed one does not load a byte", async () => {
    const f = fixture({ open: false });
    await f.host.fireStartupEvents({ coarsePointer: false });
    expect(f.loads()).toBe(0);
    expect(f.panelIds()).toEqual([]);
  });

  it("the 🎹 that WOKE the plugin opens the panel exactly once — activation leaves it to the handler", async () => {
    // The trap: `activate` opens, then the handler toggles it shut and the
    // user's tap appears to do nothing. Both orders end open.
    for (const saved of [undefined, true] as const) {
      const f = fixture(saved === undefined ? undefined : { open: saved });
      await f.host.registry.runCommand(COMMAND_TOGGLE);
      expect(f.panelIds(), `saved open=${String(saved)}`).toEqual([PANEL_ID]);
    }
  });

  it("nothing else wakes it: onStartup is not declared", async () => {
    const f = fixture();
    await f.host.fire("onStartup");
    expect(f.loads()).toBe(0);
    expect(f.panelIds()).toEqual([]);
  });
});

describe("the panel", () => {
  it("× closes it and the choice is persisted", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    f.close();
    expect(f.panelIds()).toEqual([]);
    expect(f.savedOpen()).toBe(false);
  });

  it("opens in the bottom area, once, under a stable id", async () => {
    const f = fixture();
    await f.host.fire("onPointer:coarse"); // the touch default…
    await f.host.registry.runCommand(COMMAND_TOGGLE); // …then hidden
    await f.host.registry.runCommand(COMMAND_TOGGLE); // …then shown again
    const panels = f.host.panels.panels.get();
    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({ id: PANEL_ID, side: "bottom" });
  });
});

describe("the piano", () => {
  it("is a virtual MIDI input, so the entry path hears it like a controller", async () => {
    const f = fixture();
    await f.host.fire("onPointer:coarse");
    expect(f.host.midi.inputs.get()).toContainEqual({ name: "on-screen piano", virtual: true });

    const heard: MidiNoteEvent[] = [];
    f.host.midi.onNote((e) => heard.push(e));
    const spec = f.host.panels.panels.get()[0]!;
    const element = spec.render() as { props: { onNoteOn: (n: number) => void; onNoteOff: (n: number) => void } };
    element.props.onNoteOn(62);
    element.props.onNoteOff(62);
    expect(heard).toEqual([
      { note: 62, on: true, velocity: 100, source: "on-screen piano" },
      { note: 62, on: false, velocity: 0, source: "on-screen piano" },
    ]);
  });
});

describe("the switch", () => {
  it("off takes the panel, the 🎹 and the piano away, with no document change", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    expect(f.panelIds()).toEqual([PANEL_ID]);

    await f.host.registry.setEnabled(PLUGIN_ID, false);
    expect(f.panelIds()).toEqual([]);
    expect(f.headerItems()).toEqual([]);
    expect(f.host.midi.inputs.get()).not.toContainEqual({ name: "on-screen piano", virtual: true });
    expect(f.host.registry.info(PLUGIN_ID)?.state).toBe("disabled");
    expect(f.executed()).toEqual([]);
  });

  it("the 🎹 becomes live while the plugin is active, and declared again when it stops", async () => {
    const f = fixture();
    expect(f.headerItems()[0]).toMatchObject({ id: `${PLUGIN_ID}:toggle`, declared: true });
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    // Same key, so it REPLACES the declared face rather than adding a
    // second 🎹 — which is what lets the button dim when the panel is down.
    const live = f.headerItems();
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: `${PLUGIN_ID}:toggle` });
    expect(live[0]!.declared).toBeUndefined();
    await f.host.registry.setEnabled(PLUGIN_ID, false);
    await f.host.registry.setEnabled(PLUGIN_ID, true);
    expect(f.headerItems()[0]).toMatchObject({ id: `${PLUGIN_ID}:toggle`, declared: true });
  });

  it("on puts the 🎹 back, and the panel returns on the next click", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    await f.host.registry.setEnabled(PLUGIN_ID, false);
    await f.host.registry.setEnabled(PLUGIN_ID, true);
    expect(f.headerItems()).toHaveLength(1);
    expect(f.panelIds()).toEqual([]); // a disabled plugin does not restart itself
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    expect(f.panelIds()).toEqual([PANEL_ID]);
  });

  it("a plugin the user turned off earlier never loads", async () => {
    const f = fixture({ enabled: false });
    await f.host.fire("onPointer:coarse");
    expect(f.loads()).toBe(0);
    expect(f.headerItems()).toEqual([]);
  });
});

describe("what it never does", () => {
  it("sends no command message: every button is an action id, not an edit", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    const spec = f.host.panels.panels.get()[0]!;
    const element = spec.render() as { props: { onAction: (id: string) => void } };
    element.props.onAction("undo"); // no table installed here: run() answers false
    expect(f.executed()).toEqual([]);
  });

  it("writes nothing to its storage namespace — one settings key is all it keeps", async () => {
    const storage = memoryStorage();
    const entry: PluginEntry = { manifest, load: async () => ({ default: plugin }) };
    const settings = memorySettings();
    const host = createHost({ layout: "qwerty", plugins: [entry], settings, storage, confirm: async () => true });
    await host.registry.runCommand(COMMAND_TOGGLE);
    expect(storage.getItem(`battuta.plugin.${PLUGIN_ID}.v1`)).toBeNull();
    expect(Object.keys(settings.load().plugins?.[PLUGIN_ID]?.values ?? {})).toEqual([SETTING_OPEN]);
  });
});
