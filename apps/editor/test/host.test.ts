/**
 * The host's guarantees, without a browser:
 *
 *  - registration validates (manifest, API range, capabilities, duplicate
 *    commands) and a failed plugin is listed but contributes nothing;
 *  - contributed keybindings appear in the keymap store at registration,
 *    a keypress activates the owner lazily (a real dynamic import resolves
 *    to a module NAMESPACE — unwrapped) and runs the handler;
 *  - off = deactivate + every disposable fires (bindings, slot items,
 *    panels gone) with no reload, and the user's rebind survives;
 *  - commands are DATA: execute takes a message, the host maps it to the
 *    core command, an unknown message is refused, and without a document
 *    nothing runs; the query facade answers from the bound adapter;
 *  - the --no-plugins property: with plugins on or off, nothing reaches
 *    the document except through execute, and ?plugins=off registers
 *    nothing at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { API_VERSION, definePlugin, type PluginContext, type PluginEntry, type PluginManifest, type DocumentInfo } from "@battuta/api";
import { SetPitchesCommand } from "@battuta/core";
import { createHost, memorySettings, toCommand, type SessionAdapter } from "../src/host";
import { memoryStorage } from "../src/host/services";
import { dimsDeclared } from "../src/host/slots";

// keymap.ts persists overrides in localStorage; give node one.
const shim = memoryStorage();
(globalThis as unknown as { localStorage: unknown }).localStorage = { ...shim, clear: () => undefined };

const flush = () => new Promise((r) => setTimeout(r, 0));

const manifest = (patch: Partial<PluginManifest> = {}): PluginManifest => ({
  id: "test.echo",
  name: "Echo",
  version: "1.0.0",
  engines: { battuta: `^${API_VERSION}` },
  activationEvents: ["onCommand:test.echo.say"],
  contributes: {
    commands: [{ id: "test.echo.say", title: "Say" }],
    keybindings: [{ command: "test.echo.say", keys: ["Q"], label: "say hello", group: "rhythm", when: "always" }],
  },
  ...patch,
});

/** A plugin that records what happened to it and contributes one of everything. Loads as a module NAMESPACE, like a real import(). */
function echoPlugin(): { entry: PluginEntry; state: { log: string[]; loads: number } } {
  const state = { log: [] as string[], loads: 0 };
  const entry: PluginEntry = {
    manifest: manifest(),
    load: async () => {
      state.loads++;
      return {
        default: definePlugin({
          activate(ctx: PluginContext) {
            state.log.push("activate");
            ctx.registerCommand("test.echo.say", () => {
              state.log.push(`say:${ctx.editor.get().caret ? "caret" : "no caret"}`);
              ctx.notice("hello");
            });
            ctx.slots.add("header", { id: "echo-btn", render: () => null });
            ctx.panels.open({ id: "echo-panel", side: "bottom", title: "Echo", render: () => null });
            ctx.subscriptions.add({ dispose: () => state.log.push("disposed") });
            ctx.storage.set("count", (ctx.storage.get<number>("count") ?? 0) + 1);
            ctx.settings.set("greeting", "hi");
          },
          deactivate() {
            state.log.push("deactivate");
          },
        }),
      };
    },
  };
  return { entry, state };
}

const fakeAdapter = (execute = vi.fn()): SessionAdapter & { execute: ReturnType<typeof vi.fn> } => ({
  execute,
  pitchEventsIn: (block) => [[{ eventId: `e-${block.measureFrom}`, pitches: [{ pname: "c", oct: 4 }] }]],
  blockOf: (ids) => (ids.length ? { measureFrom: 0, measureTo: ids.length - 1, staffFrom: 1, staffTo: 1 } : null),
});

const makeHost = (plugins: PluginEntry[], opts: { noPlugins?: boolean; settings?: ReturnType<typeof memorySettings>; storage?: ReturnType<typeof memoryStorage> } = {}) =>
  createHost({ layout: "qwerty", plugins, settings: opts.settings ?? memorySettings(), storage: opts.storage ?? memoryStorage(), confirm: async () => true, ...(opts.noPlugins !== undefined ? { noPlugins: opts.noPlugins } : {}) });

beforeEach(() => {
  shim.removeItem("battuta.keymap.v1.qwerty");
  shim.removeItem("battuta.keymap.v1.azerty");
});

describe("registration", () => {
  it("lists a valid plugin as ready and contributes its binding and command at once", () => {
    const { entry } = echoPlugin();
    const host = makeHost([entry]);
    expect(host.registry.get().map((p) => [p.id, p.state, p.enabled])).toEqual([["test.echo", "registered", true]]);
    expect(host.keymap.get()["test.echo.say"]).toMatchObject({ keys: ["Q"], label: "say hello", group: "rhythm", plugin: "test.echo" });
    expect(host.commands.ownerOf("test.echo.say")).toBe("test.echo");
  });

  it("keeps a broken manifest on the list, failed, with the reason and no contributions", () => {
    const { entry } = echoPlugin();
    const bad: PluginEntry = { ...entry, manifest: manifest({ id: "Bad Id" }) };
    const host = makeHost([bad]);
    const [p] = host.registry.get();
    expect(p?.state).toBe("failed");
    expect(p?.error).toMatch(/id must be/);
    expect(host.keymap.get()["test.echo.say"]).toBeUndefined();
  });

  it("refuses an API range the host does not satisfy, and a capability it lacks", () => {
    const { entry } = echoPlugin();
    const host = makeHost([
      { ...entry, manifest: manifest({ id: "test.future", engines: { battuta: "^9.0.0" } }) },
      { ...entry, manifest: manifest({ id: "test.needy", capabilities: ["workspace"], contributes: {} }) },
      { ...entry, manifest: manifest({ id: "test.midi", capabilities: ["midi"], contributes: {} }) },
    ]);
    const [future, needy, midi] = host.registry.get();
    expect(future?.error).toContain(`needs @battuta/api ^9.0.0, this host has ${API_VERSION}`);
    expect(needy?.error).toContain('no "workspace" capability');
    expect(midi?.state).toBe("registered"); // midi is offered since slice 3
  });

  it("a second plugin declaring the same command fails; the first keeps it", () => {
    const { entry } = echoPlugin();
    const host = makeHost([entry, { ...entry, manifest: manifest({ id: "test.copycat" }) }]);
    const [first, second] = host.registry.get();
    expect(first?.state).toBe("registered");
    expect(second?.state).toBe("failed");
    expect(second?.error).toContain("already declared by test.echo");
    expect(host.commands.ownerOf("test.echo.say")).toBe("test.echo");
  });

  it("a core action id is never shadowed by a plugin binding", () => {
    const { entry } = echoPlugin();
    const shadow: PluginEntry = {
      ...entry,
      manifest: manifest({ contributes: { commands: [{ id: "rest", title: "steal rest" }], keybindings: [{ command: "rest", keys: ["r"], label: "stolen", group: "entry" }] } }),
    };
    const host = makeHost([shadow]);
    expect(host.keymap.get()["rest"]?.plugin).toBeUndefined();
    expect(host.keymap.get()["rest"]?.label).toBe("enter a rest (also numpad 0)");
  });
});

describe("activation and commands", () => {
  it("loads the code only when the binding is pressed, unwraps the module namespace, runs the handler and notices", async () => {
    const plugin = echoPlugin();
    const host = makeHost([plugin.entry]);
    const notices: string[] = [];
    host.notices.subscribe((n) => n && notices.push(n.text));
    expect(plugin.state.loads).toBe(0);
    // shift+Q = "Q"
    expect(host.dispatchKey({ key: "Q", shiftKey: true, altKey: false })).toBe(true);
    await flush();
    expect(plugin.state.loads).toBe(1);
    expect(plugin.state.log).toEqual(["activate", "say:no caret"]);
    expect(notices).toEqual(["hello"]);
    expect(host.registry.info("test.echo")?.state).toBe("active");
    // second press: no reload, handler again
    host.dispatchKey({ key: "Q", shiftKey: true, altKey: false });
    await flush();
    expect(plugin.state.loads).toBe(1);
    expect(plugin.state.log).toEqual(["activate", "say:no caret", "say:no caret"]);
  });

  it("accepts a module exported directly too, and refuses one without activate()", async () => {
    const direct: PluginEntry = { manifest: manifest({ id: "test.direct", activationEvents: ["onStartup"], contributes: {} }), load: async () => ({ activate: () => undefined }) };
    const broken: PluginEntry = { manifest: manifest({ id: "test.broken", activationEvents: ["onStartup"], contributes: {} }), load: async () => ({ default: {} }) as never };
    const host = makeHost([direct, broken]);
    await host.fire("onStartup");
    expect(host.registry.info("test.direct")?.state).toBe("active");
    expect(host.registry.info("test.broken")?.state).toBe("failed");
    expect(host.registry.info("test.broken")?.error).toMatch(/no activate\(\)/);
  });

  it("ignores keys no plugin bound, and core keys", () => {
    const host = makeHost([echoPlugin().entry]);
    expect(host.dispatchKey({ key: "q", shiftKey: false, altKey: false })).toBe(false);
    expect(host.dispatchKey({ key: "r", shiftKey: false, altKey: false })).toBe(false);
  });

  it("onStartup activates at creation; a plugin whose activate throws is failed with the reason", async () => {
    const boom: PluginEntry = {
      manifest: manifest({ id: "test.boom", activationEvents: ["onStartup"], contributes: {} }),
      load: async () => ({ activate: () => { throw new Error("no such thing"); } }),
    };
    const host = makeHost([boom]);
    const notices: string[] = [];
    host.notices.subscribe((n) => n && notices.push(n.text));
    await host.fire("onStartup");
    expect(host.registry.info("test.boom")?.state).toBe("failed");
    expect(host.registry.info("test.boom")?.error).toBe("activate failed: no such thing");
    expect(notices).toEqual(["plugin test.boom: activate failed: no such thing"]);
  });

  it("a handler registered for a command the manifest did not declare is refused", async () => {
    const sneaky: PluginEntry = {
      manifest: manifest({ id: "test.sneaky", activationEvents: ["onStartup"], contributes: {} }),
      load: async () => ({ activate: (ctx) => { ctx.registerCommand("core.save", () => undefined); } }),
    };
    const host = makeHost([sneaky]);
    await host.fire("onStartup");
    expect(host.registry.info("test.sneaky")?.error).toMatch(/did not declare command core.save/);
  });
});

describe("off and on again", () => {
  it("deactivates, fires every disposable, withdraws bindings/slots/panels, persists the switch", async () => {
    const plugin = echoPlugin();
    const settings = memorySettings();
    const host = makeHost([plugin.entry], { settings });
    host.dispatchKey({ key: "Q", shiftKey: true, altKey: false });
    await flush();
    expect(host.slots.items.get().header.map((i) => i.id)).toEqual(["test.echo:echo-btn"]); // keyed by plugin, like a declared item
    expect(host.panels.panels.get().map((p) => p.id)).toEqual(["echo-panel"]);

    await host.registry.setEnabled("test.echo", false);
    expect(plugin.state.log.slice(-2)).toEqual(["deactivate", "disposed"]);
    expect(host.slots.items.get().header).toEqual([]);
    expect(host.panels.panels.get()).toEqual([]);
    expect(host.keymap.get()["test.echo.say"]).toBeUndefined();
    expect(host.commands.ownerOf("test.echo.say")).toBeUndefined();
    expect(host.registry.info("test.echo")).toMatchObject({ state: "disabled", enabled: false });
    expect(settings.load().plugins?.["test.echo"]?.enabled).toBe(false);
    expect(host.dispatchKey({ key: "Q", shiftKey: true, altKey: false })).toBe(false);

    await host.registry.setEnabled("test.echo", true);
    expect(host.registry.info("test.echo")).toMatchObject({ state: "registered", enabled: true });
    expect(host.keymap.get()["test.echo.say"]?.keys).toEqual(["Q"]);
  });

  it("a rebind of a plugin key survives off/on, and the switch is read back at the next start", async () => {
    const settings = memorySettings();
    const host = makeHost([echoPlugin().entry], { settings });
    host.keymap.rebind("test.echo.say", { keys: ["W"] });
    expect(host.keymap.get()["test.echo.say"]?.keys).toEqual(["W"]);
    await host.registry.setEnabled("test.echo", false);
    await host.registry.setEnabled("test.echo", true);
    expect(host.keymap.get()["test.echo.say"]?.keys).toEqual(["W"]);
    await host.registry.setEnabled("test.echo", false);
    const next = makeHost([echoPlugin().entry], { settings: memorySettings(settings.load()) });
    expect(next.registry.info("test.echo")).toMatchObject({ state: "disabled", enabled: false });
    expect(next.keymap.get()["test.echo.say"]).toBeUndefined();
    expect(next.dispatchKey({ key: "W", shiftKey: true, altKey: false })).toBe(false);
  });

  it("reset-all clears plugin overrides too, and the layout switch keeps contributions", async () => {
    const host = makeHost([echoPlugin().entry]);
    host.keymap.rebind("test.echo.say", { keys: ["W"] });
    host.keymap.setLayout("azerty");
    expect(host.keymap.get()["test.echo.say"]?.keys).toEqual(["Q"]); // overrides are per layout
    host.keymap.setLayout("qwerty");
    expect(host.keymap.get()["test.echo.say"]?.keys).toEqual(["W"]);
    host.keymap.resetOverrides();
    expect(host.keymap.get()["test.echo.say"]?.keys).toEqual(["Q"]);
  });
});

describe("commands as data", () => {
  it("maps core.setPitches to the core command, copying the plugin's data", () => {
    const targets = [{ eventId: "n1", pitches: [{ pname: "e", oct: 4, accid: "s" }] }];
    const cmd = toCommand({ type: "core.setPitches", targets, label: "inversion" });
    expect(cmd).toBeInstanceOf(SetPitchesCommand);
    expect((cmd as SetPitchesCommand).label).toBe("inversion");
    targets[0]!.pitches[0]!.pname = "z"; // a plugin mutating its message afterwards changes nothing inside the command
    expect(JSON.stringify(cmd)).not.toContain('"z"');
  });

  it("refuses a message type the host has not published", () => {
    expect(() => toCommand({ type: "core.deleteEverything" } as never)).toThrow(/unknown command message type "core.deleteEverything"/);
    expect(() => toCommand({ type: "core.setPitches", targets: "nope", label: "" } as never)).toThrow(/targets must be an array/);
  });

  it("execute reaches the bound session as a core command, and throws without a document", () => {
    const host = makeHost([]);
    const adapter = fakeAdapter();
    host.bindSession(adapter);
    host.execute({ type: "core.setPitches", targets: [], label: "t" });
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(adapter.execute.mock.calls[0]![0]).toBeInstanceOf(SetPitchesCommand);
    host.bindSession(null);
    expect(() => host.execute({ type: "core.setPitches", targets: [], label: "t" })).toThrow("no document is open");
  });

  it("the query facade answers from the adapter, and empty without one", () => {
    const host = makeHost([]);
    expect(host.query.pitchEventsIn({ measureFrom: 0, measureTo: 1, staffFrom: 1, staffTo: 1 })).toEqual([]);
    expect(host.query.blockOf(["a"])).toBeNull();
    host.bindSession(fakeAdapter());
    expect(host.query.pitchEventsIn({ measureFrom: 2, measureTo: 3, staffFrom: 1, staffTo: 2 })).toEqual([[{ eventId: "e-2", pitches: [{ pname: "c", oct: 4 }] }]]);
    expect(host.query.blockOf(["a", "b"])).toEqual({ measureFrom: 0, measureTo: 1, staffFrom: 1, staffTo: 1 });
    expect(host.query.blockOf([])).toBeNull();
  });
});

describe("the --no-plugins property", () => {
  it("?plugins=off registers nothing", () => {
    const host = makeHost([echoPlugin().entry], { noPlugins: true });
    expect(host.noPlugins).toBe(true);
    expect(host.registry.get()).toEqual([]);
    expect(host.keymap.get()["test.echo.say"]).toBeUndefined();
  });

  it("registering, activating and disabling a plugin never touches the document: only execute does", async () => {
    const doc: DocumentInfo = { id: "doc-1", version: 7, measureCount: 10, staffCount: 2, title: "Synthetic", tempo: null };
    const before = JSON.stringify(doc);
    const adapter = fakeAdapter();
    const plugin = echoPlugin();
    const host = makeHost([plugin.entry]);
    host.document.set(doc);
    host.bindSession(adapter);
    host.dispatchKey({ key: "Q", shiftKey: true, altKey: false });
    await flush();
    await host.registry.setEnabled("test.echo", false);
    await host.registry.setEnabled("test.echo", true);
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(doc)).toBe(before);
    expect(host.document.get()).toEqual(doc);
  });
});

describe("manifest-declared slot items", () => {
  const withToggle = (): { entry: PluginEntry; state: { log: string[]; loads: number } } => {
    const plugin = echoPlugin();
    plugin.entry.manifest.contributes!.slotItems = [{ id: "toggle", slot: "header", label: "🎹", title: "open it", command: "test.echo.say", order: 5 }];
    return plugin;
  };

  it("appear at registration, before any code loads, keyed by plugin", () => {
    const plugin = withToggle();
    const host = makeHost([plugin.entry]);
    const header = host.slots.items.get().header;
    expect(header.map((i) => i.id)).toEqual(["test.echo:toggle"]);
    expect(header[0]).toMatchObject({ declared: true, command: "test.echo.say", label: "🎹", pluginId: "test.echo" });
    expect(host.slots.items.get().docHeader).toEqual([]);
    expect(plugin.state.loads).toBe(0);
  });

  it("carry dimUntilActive, and it is drawn only while the owner is not active", () => {
    const plugin = withToggle();
    plugin.entry.manifest.contributes!.slotItems![0]!.dimUntilActive = true;
    const host = makeHost([plugin.entry]);
    const item = host.slots.items.get().header[0] as { dimUntilActive?: boolean; pluginId: string };
    expect(item.dimUntilActive).toBe(true);
    // Before the plugin runs, its entry point is drawn de-emphasised: for a
    // button that opens something, "not active" means "not showing".
    expect(dimsDeclared(item, [{ id: "test.echo", state: "registered" } as never])).toBe(true);
    expect(dimsDeclared(item, [{ id: "test.echo", state: "active" } as never])).toBe(false);
    // …and never for a declared item that did not ask: a menu entry is not
    // disabled while its plugin waits to be loaded.
    expect(dimsDeclared({ pluginId: "test.echo" }, [{ id: "test.echo", state: "registered" } as never])).toBe(false);
  });

  it("clicking one runs its command — which loads the plugin", async () => {
    const plugin = withToggle();
    const host = makeHost([plugin.entry]);
    const item = host.slots.items.get().header[0]!;
    expect(item.declared).toBe(true);
    await host.registry.runCommand((item as { command: string }).command);
    expect(plugin.state.loads).toBe(1);
    expect(plugin.state.log).toEqual(["activate", "say:no caret"]);
  });

  it("leave with the plugin's contributions when it is turned off, and come back on", async () => {
    const plugin = withToggle();
    const host = makeHost([plugin.entry]);
    await host.registry.setEnabled("test.echo", false);
    expect(host.slots.items.get().header).toEqual([]);
    await host.registry.setEnabled("test.echo", true);
    expect(host.slots.items.get().header.map((i) => i.id)).toEqual(["test.echo:toggle"]);
  });

  it("must name the plugin's own command and a real slot", () => {
    const bad = echoPlugin();
    bad.entry.manifest.contributes!.slotItems = [{ id: "x", slot: "sidebar" as never, label: "x", command: "core.save" }];
    const host = makeHost([bad.entry]);
    const info = host.registry.info("test.echo")!;
    expect(info.state).toBe("failed");
    expect(info.error).toContain("slot item x needs a slot of header, docHeader, statusBar, menu");
    expect(info.error).toContain("slot item x must name one of the plugin's own commands");
    expect(host.slots.items.get().header).toEqual([]);
  });

  it("runtime items and declared items share a slot, ordered together", async () => {
    const plugin = withToggle();
    const host = makeHost([plugin.entry]);
    host.slots.add("header", { id: "runtime", order: 1, render: () => null });
    expect(host.slots.items.get().header.map((i) => i.id)).toEqual(["runtime", "test.echo:toggle"]);
  });
});

describe("actions on the context: reactive ids and plugin commands through run", () => {
  it("ids is a store: a plugin's commands appear when it is on and vanish when it is off, and the core rules join when the App installs them", async () => {
    const plugin = echoPlugin();
    const ctxIds: (readonly string[])[] = [];
    const watcher: PluginEntry = {
      manifest: manifest({ id: "test.watcher", activationEvents: ["onStartup"], contributes: {} }),
      load: async () => ({
        activate: (ctx) => {
          ctxIds.push(ctx.actions.ids.get());
          ctx.subscriptions.add(ctx.actions.ids.subscribe((v) => ctxIds.push(v)));
        },
      }),
    };
    const host = makeHost([plugin.entry, watcher]);
    await host.fire("onStartup");
    expect(ctxIds[0]).toContain("test.echo.say");
    await host.registry.setEnabled("test.echo", false);
    expect(ctxIds.at(-1)).not.toContain("test.echo.say");
    await host.registry.setEnabled("test.echo", true);
    expect(ctxIds.at(-1)).toContain("test.echo.say");
    host.actions.install([{ kind: "rule", id: "tie", key: () => false, run: () => "handled", preventDefault: true }]);
    expect(ctxIds.at(-1)).toEqual(["tie", "test.echo.say"]);
  });

  it("run(pluginCommandId) activates the owner and runs the handler; an unknown id is false", async () => {
    const plugin = echoPlugin();
    const host = makeHost([plugin.entry]);
    host.bindSession(fakeAdapter());
    // the App would install its table; an empty one has no core rules and no gates
    host.actions.install([]);
    expect(host.actions.run("test.echo.say")).toBe(true);
    await flush();
    expect(plugin.state.log).toEqual(["activate", "say:no caret"]);
    expect(host.actions.run("test.nobody.home")).toBe(false);
  });
});

describe("activatedBy", () => {
  const recorder = (id: string, events: PluginManifest["activationEvents"], seen: (string | null)[]): PluginEntry => ({
    manifest: manifest({ id, activationEvents: events, contributes: { commands: [{ id: `${id}.go`, title: "go" }], keybindings: [{ command: `${id}.go`, keys: ["Q"], label: "go", group: "system" }] } }),
    load: async () => ({ activate: (ctx) => { seen.push(ctx.activatedBy); ctx.registerCommand(`${id}.go`, () => undefined); } }),
  });

  it("names the event that woke the plugin: onStartup, onPointer:coarse, onCommand:<id>, onSettings:<key>, or null from the tab", async () => {
    const seen: (string | null)[] = [];
    const settings = memorySettings({ plugins: { "test.saved": { values: { open: true } } } });
    const host = makeHost(
      [
        recorder("test.startup", ["onStartup"], seen),
        recorder("test.touch", ["onPointer:coarse"], seen),
        recorder("test.key", ["onCommand:test.key.go"], seen),
        recorder("test.saved", ["onSettings:open"], seen),
        recorder("test.tab", [], seen),
      ],
      { settings },
    );
    await host.fireStartupEvents({ coarsePointer: true });
    await host.registry.runCommand("test.key.go"); // what a declared slot item's click or a key does
    await host.registry.setEnabled("test.tab", false);
    await host.registry.setEnabled("test.tab", true);
    await host.registry.activate("test.tab"); // the Plugins tab / a test: no event
    expect(seen).toEqual(["onStartup", "onPointer:coarse", "onSettings:open", "onCommand:test.key.go", null]);
  });

  it("onSettings wakes only a plugin whose OWN setting is truthy, and never on a fine pointer for onPointer:coarse", async () => {
    const seen: (string | null)[] = [];
    const settings = memorySettings({ plugins: { "test.other": { values: { open: true } } } });
    const host = makeHost([recorder("test.saved", ["onSettings:open"], seen), recorder("test.touch", ["onPointer:coarse"], seen)], { settings });
    await host.fireStartupEvents({ coarsePointer: false });
    expect(seen).toEqual([]);
  });
});

describe("a runtime slot item replaces the plugin's declared face while it lives", () => {
  it("declared until active, live while the runtime item exists, declared again after dispose", async () => {
    const plugin = echoPlugin();
    plugin.entry.manifest.contributes!.slotItems = [{ id: "toggle", slot: "header", label: "🎹", command: "test.echo.say" }];
    const host = makeHost([plugin.entry]);
    const face = () => host.slots.items.get().header.map((i) => ("declared" in i && i.declared ? `declared:${i.id}` : `live:${i.id}`));
    expect(face()).toEqual(["declared:test.echo:toggle"]);
    const live = host.slots.add("header", { id: "toggle", render: () => null }, "test.echo");
    expect(face()).toEqual(["live:test.echo:toggle"]);
    live.dispose();
    expect(face()).toEqual(["declared:test.echo:toggle"]);
    // another plugin's "toggle" is a different item
    host.slots.add("header", { id: "toggle", render: () => null }, "test.other");
    expect(face()).toEqual(["declared:test.echo:toggle", "live:test.other:toggle"]);
  });
});

describe("the MIDI service on the context", () => {
  it("is the host's own service: a plugin's virtual input reaches the host's note stream and its device list", async () => {
    const seen: string[] = [];
    const entry: PluginEntry = {
      manifest: manifest({ id: "test.pad", activationEvents: ["onStartup"], capabilities: ["midi"], contributes: {} }),
      load: async () => ({
        activate: (ctx) => {
          const pad = ctx.registerCommand ? ctx.midi.registerInput("chord pad") : null;
          ctx.subscriptions.add(pad!);
          pad!.noteOn(60);
          ctx.subscriptions.add(ctx.midi.onNote((e) => seen.push(`plugin:${e.source}`)));
        },
      }),
    };
    const host = makeHost([entry]);
    host.midi.onNote((e) => seen.push(`host:${e.source}:${e.note}:${e.on}`));
    await host.fire("onStartup");
    expect(seen).toEqual(["host:chord pad:60:true"]);
    expect(host.midi.inputs.get()).toEqual([{ name: "chord pad", virtual: true }]);
    // off: the plugin's input disappears with its disposables
    await host.registry.setEnabled("test.pad", false);
    expect(host.midi.inputs.get()).toEqual([]);
  });
});

describe("storage and settings namespaces", () => {
  it("are keyed per plugin: storage in its own web-storage entry, settings inside the editor's blob", async () => {
    const plugin = echoPlugin();
    const storage = memoryStorage();
    const settings = memorySettings();
    const host = makeHost([plugin.entry], { settings, storage });
    await host.registry.activate("test.echo");
    await host.registry.deactivate("test.echo");
    await host.registry.activate("test.echo");
    expect(plugin.state.log.filter((l) => l === "activate")).toHaveLength(2);
    expect(JSON.parse(storage.getItem("battuta.plugin.test.echo.v1")!)).toEqual({ count: 2 });
    expect(storage.getItem("battuta.plugin.other.v1")).toBeNull();
    expect(settings.load().plugins?.["test.echo"]).toEqual({ values: { greeting: "hi" } });
  });
});
