/**
 * The plugin against a REAL host (`createHost` with memory-backed settings
 * and storage) and a fake shell bridge — the `workspace_*` commands and
 * the `workspace-change` event, answered from an in-memory folder.
 *
 * The list model itself is `test/tree.test.ts`; what is left for this
 * suite is the lifecycle, which is where a panel plugin can be wrong:
 * what the user sees before any code loads, every path that wakes it up,
 * what a click does, what the watch does to the list, what the switch
 * takes away — and the two things a NEW feature has to get right that an
 * extraction never faces: a platform that is not there (a browser), and a
 * folder that was there last session and is not now.
 *
 * The panel is not rendered — a plugin package may not depend on
 * react-dom, and the host owns the React root. A panel spec's `render()`
 * returns an element whose props are the whole contract.
 */
import { describe, it, expect } from "vitest";
import type { DirEntry, DocumentInfo, PluginEntry, Store } from "@battuta/api";
import { createHost, memorySettings, HostWorkspaceService, type Host, type SessionAdapter, type WorkspaceBridge } from "../../../../apps/editor/src/host";
import { memoryStorage, type SettingsIO } from "../../../../apps/editor/src/host/services";
import { manifest, COMMAND_TOGGLE, PANEL_ID, SETTING_FOLDER } from "../src/manifest";
import type { FolderActions, FolderState } from "../src/Panel";
import plugin from "../src/index";

const PLUGIN_ID = manifest.id;
const ROOT = "/scores";
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const file = (path: string): DirEntry => ({ name: path.split("/").pop()!, path, kind: "file" });
const dir = (path: string): DirEntry => ({ name: path.split("/").pop()!, path, kind: "dir" });

/** The folder the fake shell serves. */
const FOLDER: Record<string, DirEntry[]> = {
  [ROOT]: [dir(`${ROOT}/bach`), file(`${ROOT}/one.mei`), file(`${ROOT}/notes.pdf`)],
  [`${ROOT}/bach`]: [file(`${ROOT}/bach/bwv1.mei`)],
};

interface Fixture {
  host: Host;
  settings: SettingsIO;
  loads(): number;
  /** Every `workspace_*` command the service sent the shell. */
  invoked(): { cmd: string; args?: Record<string, unknown> }[];
  panelIds(): string[];
  headerItems(): { id: string; command?: string; declared?: boolean }[];
  /** The panel element's props — the state store, and every control. */
  panel(): { state: Store<FolderState>; documents: Store<readonly DocumentInfo[]>; active: Store<DocumentInfo | null>; available: boolean; actions: FolderActions };
  /** The names the list would draw, in order, at their depth. */
  rows(): string[];
  savedFolder(): string | undefined;
  notices(): string[];
  /** Fire a coalesced change from the fake watcher. */
  change(path: string, kind?: "created" | "modified" | "removed"): Promise<void>;
  /** Paths the host was asked to open. */
  opened(): string[];
  /** Renames the host followed (an open tab would take the new path). */
  followed(): [string, string][];
  /** Files the fake shell created, path → contents. */
  created(): Map<string, string>;
}

function fixture(opts: { saved?: string; shell?: boolean; folder?: Record<string, DirEntry[]> } = {}): Fixture {
  const shell = opts.shell ?? true;
  const folder = opts.folder ?? FOLDER;
  let loads = 0;
  const invoked: { cmd: string; args?: Record<string, unknown> }[] = [];
  const notices: string[] = [];
  const opened: string[] = [];
  const followed: [string, string][] = [];
  /** Files the fake shell created, path → contents. */
  const created = new Map<string, string>();
  let emit: ((e: { payload: unknown }) => void) | null = null;
  let nextWatch = 1;

  const entry: PluginEntry = {
    manifest,
    load: async () => {
      loads++;
      return { default: plugin };
    },
  };
  const settings = memorySettings(opts.saved === undefined ? {} : { plugins: { [PLUGIN_ID]: { values: { [SETTING_FOLDER]: opts.saved } } } });

  const bridge: WorkspaceBridge = {
    invoke: async (cmd, args) => {
      invoked.push({ cmd, ...(args ? { args } : {}) });
      if (cmd === "workspace_pick_folder") return ROOT;
      if (cmd === "workspace_open_folder") return folder[String(args?.["path"])] !== undefined;
      if (cmd === "workspace_read_dir") {
        const entries = folder[String(args?.["path"])];
        if (!entries) throw new Error("outside the opened folders");
        return entries;
      }
      if (cmd === "workspace_watch") return nextWatch++;
      if (cmd === "workspace_create_folder" || cmd === "workspace_create_file") {
        // the shell's create-only rule and its listing order: folders first, then by name
        const dir = String(args?.["path"]);
        const name = String(args?.["name"]);
        const at = folder[dir];
        if (!at) throw new Error(`${dir} is outside the opened folders`);
        if (at.some((e) => e.name === name)) throw new Error(`"${name}" already exists in this folder`);
        const kind = cmd === "workspace_create_folder" ? "dir" : "file";
        const path = `${dir}/${name}`;
        folder[dir] = [...at, { name, path, kind }].sort((a, b) => Number(a.kind !== "dir") - Number(b.kind !== "dir") || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        if (kind === "dir") folder[path] = [];
        else created.set(path, String(args?.["contents"]));
        return path;
      }
      if (cmd === "workspace_rename") {
        // what the shell does, on the in-memory folder: refuse an existing
        // name, otherwise move the entry and (for a folder) its subtree
        const from = String(args?.["path"]);
        const name = String(args?.["newName"]);
        const parent = from.slice(0, from.lastIndexOf("/"));
        const to = `${parent}/${name}`;
        if ((folder[parent] ?? []).some((e) => e.name === name)) throw new Error(`"${name}" already exists in this folder`);
        folder[parent] = (folder[parent] ?? []).map((e) => (e.path === from ? { ...e, name, path: to } : e));
        for (const key of Object.keys(folder)) {
          if (key !== from && !key.startsWith(`${from}/`)) continue;
          const moved = to + key.slice(from.length);
          folder[moved] = folder[key]!.map((e) => ({ ...e, path: to + e.path.slice(from.length) }));
          delete folder[key];
        }
        return to;
      }
      return undefined;
    },
    listen: async (_event, cb) => {
      emit = cb;
      return () => undefined;
    },
  };

  // coalesceMs 1: the host's 150 ms window is a real-time nicety, not a
  // behaviour this suite is testing.
  const workspace = shell ? new HostWorkspaceService(bridge, 1) : new HostWorkspaceService(null, 1);
  const host = createHost({ layout: "qwerty", plugins: [entry], settings, storage: memoryStorage(), confirm: async () => true, workspace });
  const adapter: SessionAdapter = {
    execute: () => undefined,
    pitchEventsIn: () => [],
    blockOf: () => null,
    lyricAt: () => null,
    harmAt: () => "",
    timemap: async () => ({ events: [], notes: {}, idMap: {} }),
    notation: () => ({ ties: {}, marks: {} }),
    eventIdAt: () => null,
    mei: () => "",
  };
  host.bindSession(adapter);
  host.bindWorkspace({
    openDocument: async (path) => {
      opened.push(path);
    },
    renamed: (from, to) => void followed.push([from, to]),
  });
  host.notices.subscribe((n) => n?.text && notices.push(n.text));

  const panelSpec = () => host.panels.panels.get().find((p) => p.id === PANEL_ID);
  const props = () => (panelSpec()!.render() as { props: ReturnType<Fixture["panel"]> }).props;
  return {
    host,
    settings,
    loads: () => loads,
    invoked: () => invoked,
    panelIds: () => host.panels.panels.get().map((p) => p.id),
    headerItems: () => host.slots.items.get().header as { id: string; command?: string; declared?: boolean }[],
    panel: props,
    rows: () => {
      const s = props().state.get();
      if (!s.root) return [];
      // the same walk the panel draws, flattened to "depth:name"
      const out: string[] = [];
      const walk = (d: string, depth: number) => {
        for (const e of s.loaded.get(d) ?? []) {
          if (e.kind !== "dir" && !e.name.toLowerCase().endsWith(".mei")) continue;
          out.push(`${depth}:${e.name}`);
          if (e.kind === "dir" && s.expanded.has(e.path)) walk(e.path, depth + 1);
        }
      };
      walk(s.root, 0);
      return out;
    },
    savedFolder: () => settings.load().plugins?.[PLUGIN_ID]?.values?.[SETTING_FOLDER] as string | undefined,
    notices: () => notices,
    change: async (path, kind = "modified") => {
      emit?.({ payload: { id: 1, path, kind } });
      await flush();
    },
    opened: () => opened,
    followed: () => followed,
    created: () => created,
  };
}

describe("before any of this plugin's code exists", () => {
  it("the 📁 is already in the header, rendered by the host from the manifest", () => {
    const f = fixture();
    expect(f.headerItems()).toHaveLength(1);
    expect(f.headerItems()[0]).toMatchObject({ id: `${PLUGIN_ID}:toggle`, command: COMMAND_TOGGLE, declared: true });
    expect(f.panelIds()).toEqual([]);
    expect(f.loads()).toBe(0);
  });

  it("registers cleanly: the host offers the workspace capability it asks for", () => {
    const f = fixture();
    expect(f.host.registry.info(PLUGIN_ID)).toMatchObject({ state: "registered", enabled: true, error: null });
  });

  it("contributes no keybinding: a new feature earns a key when someone asks for one", () => {
    const f = fixture();
    expect(manifest.contributes?.keybindings).toBeUndefined();
    expect(f.host.keymapView.get().some((e) => e.plugin === PLUGIN_ID)).toBe(false);
  });
});

describe("the wake-up paths", () => {
  it("the 📁 loads the code and opens the panel; a second one hides it", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    expect(f.loads()).toBe(1);
    expect(f.panelIds()).toEqual([PANEL_ID]);
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    expect(f.panelIds()).toEqual([]);
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    expect(f.panelIds()).toEqual([PANEL_ID]);
  });

  it("a folder left open comes back at startup, re-admitted through the service", async () => {
    const f = fixture({ saved: ROOT });
    await f.host.fireStartupEvents({ coarsePointer: false });
    await flush();
    expect(f.loads()).toBe(1);
    expect(f.panelIds()).toEqual([PANEL_ID]);
    // the shell only grants what the user picked: last session's path has to be asked for again
    expect(f.invoked().map((i) => i.cmd)).toContain("workspace_open_folder");
    expect(f.rows()).toEqual(["0:bach", "0:one.mei"]);
  });

  it("no folder remembered means no startup activation at all", async () => {
    const f = fixture();
    await f.host.fireStartupEvents({ coarsePointer: false });
    await flush();
    expect(f.loads()).toBe(0);
    expect(f.panelIds()).toEqual([]);
  });
});

describe("picking and listing", () => {
  const opened = async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    f.panel().actions.pick();
    await flush();
    return f;
  };

  it("picking a folder lists its scores and its folders, and remembers it", async () => {
    const f = await opened();
    expect(f.rows()).toEqual(["0:bach", "0:one.mei"]); // notes.pdf is not a score
    expect(f.savedFolder()).toBe(ROOT);
  });

  it("a folder opens on click and its contents arrive beneath it", async () => {
    const f = await opened();
    f.panel().actions.toggleDir(`${ROOT}/bach`);
    await flush();
    expect(f.rows()).toEqual(["0:bach", "1:bwv1.mei", "0:one.mei"]);
    f.panel().actions.toggleDir(`${ROOT}/bach`);
    expect(f.rows()).toEqual(["0:bach", "0:one.mei"]);
  });

  it("a sub-folder is read once, not on every expand", async () => {
    const f = await opened();
    f.panel().actions.toggleDir(`${ROOT}/bach`);
    await flush();
    f.panel().actions.toggleDir(`${ROOT}/bach`);
    f.panel().actions.toggleDir(`${ROOT}/bach`);
    await flush();
    expect(f.invoked().filter((i) => i.cmd === "workspace_read_dir" && i.args?.["path"] === `${ROOT}/bach`)).toHaveLength(1);
  });

  it("clicking a score opens it through the host's ONE open path", async () => {
    const f = await opened();
    f.panel().actions.open(`${ROOT}/one.mei`);
    await flush();
    expect(f.opened()).toEqual([`${ROOT}/one.mei`]);
  });

  it("watches the root once — the watch is recursive, so expanding adds none", async () => {
    const f = await opened();
    f.panel().actions.toggleDir(`${ROOT}/bach`);
    await flush();
    expect(f.invoked().filter((i) => i.cmd === "workspace_watch")).toHaveLength(1);
  });
});

describe("renaming in place", () => {
  /** A private copy of the folder: a rename moves entries, and the shared FOLDER must not change under other tests. */
  const copy = (): Record<string, DirEntry[]> => Object.fromEntries(Object.entries(FOLDER).map(([k, v]) => [k, v.map((e) => ({ ...e }))]));
  const picked = async () => {
    const f = fixture({ folder: copy() });
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    f.panel().actions.pick();
    await flush();
    return f;
  };

  it("a score: the shell is asked with a NAME, the host follows, the list shows the new name at once", async () => {
    const f = await picked();
    f.panel().actions.rename(`${ROOT}/one.mei`, "first.mei");
    await flush();
    expect(f.invoked().find((i) => i.cmd === "workspace_rename")?.args).toEqual({ path: `${ROOT}/one.mei`, newName: "first.mei" });
    expect(f.followed()).toEqual([[`${ROOT}/one.mei`, `${ROOT}/first.mei`]]);
    expect(f.rows()).toEqual(["0:bach", "0:first.mei"]);
    expect(f.notices()).toEqual([]);
  });

  it("an open folder stays open under its new name, its contents with it", async () => {
    const f = await picked();
    f.panel().actions.toggleDir(`${ROOT}/bach`);
    await flush();
    f.panel().actions.rename(`${ROOT}/bach`, "Bach");
    await flush();
    expect(f.rows()).toEqual(["0:Bach", "1:bwv1.mei", "0:one.mei"]);
    expect(f.panel().state.get().expanded.has(`${ROOT}/Bach`)).toBe(true);
    expect(f.panel().state.get().loaded.get(`${ROOT}/Bach`)?.[0]?.path).toBe(`${ROOT}/Bach/bwv1.mei`);
    expect(f.followed()).toEqual([[`${ROOT}/bach`, `${ROOT}/Bach`]]);
  });

  it("a refusal is a notice with the shell's reason, and nothing moves", async () => {
    const f = await picked();
    f.panel().actions.rename(`${ROOT}/one.mei`, "bach");
    await flush();
    expect(f.notices().some((n) => /could not rename one\.mei: "bach" already exists/.test(n))).toBe(true);
    expect(f.rows()).toEqual(["0:bach", "0:one.mei"]);
    expect(f.followed()).toEqual([]);
  });
});

describe("creating a score or a folder", () => {
  const copy = (): Record<string, DirEntry[]> => Object.fromEntries(Object.entries(FOLDER).map(([k, v]) => [k, v.map((e) => ({ ...e }))]));
  const picked = async () => {
    const f = fixture({ folder: copy() });
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    f.panel().actions.pick();
    await flush();
    return f;
  };

  it("the target is the root until a folder is clicked or a score opened", async () => {
    const f = await picked();
    expect(f.panel().state.get().target).toBe(ROOT);
    f.panel().actions.toggleDir(`${ROOT}/bach`);
    expect(f.panel().state.get().target).toBe(`${ROOT}/bach`);
    f.panel().actions.open(`${ROOT}/one.mei`);
    expect(f.panel().state.get().target).toBe(ROOT);
    f.panel().actions.open(`${ROOT}/bach/bwv1.mei`);
    expect(f.panel().state.get().target).toBe(`${ROOT}/bach`);
  });

  it("a score: .mei added, a blank score titled after it written, listed, and opened through the host", async () => {
    const f = await picked();
    f.panel().actions.create("file", ROOT, "Etude");
    await flush();
    const call = f.invoked().find((i) => i.cmd === "workspace_create_file");
    expect(call?.args?.["path"]).toBe(ROOT);
    expect(call?.args?.["name"]).toBe("Etude.mei");
    expect(f.created().get(`${ROOT}/Etude.mei`)).toContain("<title>Etude</title>");
    expect(f.rows()).toEqual(["0:bach", "0:Etude.mei", "0:one.mei"]);
    expect(f.opened()).toEqual([`${ROOT}/Etude.mei`]);
    expect(f.notices()).toEqual([]);
  });

  it("a folder: created in the target, shown open and empty, and the next score goes in it", async () => {
    const f = await picked();
    f.panel().actions.toggleDir(`${ROOT}/bach`);
    await flush();
    f.panel().actions.create("dir", `${ROOT}/bach`, "  Fugues ");
    await flush();
    expect(f.invoked().find((i) => i.cmd === "workspace_create_folder")?.args).toEqual({ path: `${ROOT}/bach`, name: "Fugues" });
    expect(f.rows()).toEqual(["0:bach", "1:Fugues", "1:bwv1.mei", "0:one.mei"]);
    expect(f.panel().state.get().target).toBe(`${ROOT}/bach/Fugues`);
    f.panel().actions.create("file", f.panel().state.get().target!, "Fugue 1");
    await flush();
    expect(f.rows()).toEqual(["0:bach", "1:Fugues", "2:Fugue 1.mei", "1:bwv1.mei", "0:one.mei"]);
  });

  it("an existing name is refused with a notice and nothing opens; an empty one does nothing at all", async () => {
    const f = await picked();
    f.panel().actions.create("file", ROOT, "one");
    await flush();
    expect(f.notices().some((n) => /could not create one\.mei: "one\.mei" already exists/.test(n))).toBe(true);
    expect(f.opened()).toEqual([]);
    const before = f.invoked().length;
    f.panel().actions.create("dir", ROOT, "   ");
    await flush();
    expect(f.invoked().length).toBe(before);
  });

  it("renaming the target folder moves the target with it", async () => {
    const f = await picked();
    f.panel().actions.toggleDir(`${ROOT}/bach`);
    await flush();
    f.panel().actions.rename(`${ROOT}/bach`, "Bach");
    await flush();
    expect(f.panel().state.get().target).toBe(`${ROOT}/Bach`);
  });
});

describe("following the folder", () => {
  const opened = async (folder?: Record<string, DirEntry[]>) => {
    const f = fixture(folder ? { folder } : {});
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    f.panel().actions.pick();
    await flush();
    return f;
  };

  it("a score added on disk appears without anyone asking", async () => {
    const tree: Record<string, DirEntry[]> = { [ROOT]: [...FOLDER[ROOT]!], [`${ROOT}/bach`]: [...FOLDER[`${ROOT}/bach`]!] };
    const f = await opened(tree);
    expect(f.rows()).toEqual(["0:bach", "0:one.mei"]);
    tree[ROOT] = [...tree[ROOT]!, file(`${ROOT}/two.mei`)];
    await f.change(`${ROOT}/two.mei`, "created");
    expect(f.rows()).toEqual(["0:bach", "0:one.mei", "0:two.mei"]);
  });

  it("re-reads only the folder a change touches", async () => {
    const f = await opened();
    f.panel().actions.toggleDir(`${ROOT}/bach`);
    await flush();
    const before = f.invoked().filter((i) => i.cmd === "workspace_read_dir").length;
    await f.change(`${ROOT}/bach/bwv1.mei`);
    const reads = f.invoked().filter((i) => i.cmd === "workspace_read_dir").slice(before);
    expect(reads.map((r) => r.args?.["path"])).toEqual([`${ROOT}/bach`]);
  });

  it("a change in a folder nobody has opened costs nothing", async () => {
    const f = await opened();
    const before = f.invoked().filter((i) => i.cmd === "workspace_read_dir").length;
    await f.change(`${ROOT}/bach/bwv1.mei`); // /scores/bach is not expanded
    expect(f.invoked().filter((i) => i.cmd === "workspace_read_dir")).toHaveLength(before);
  });

  it("a sub-folder that goes away leaves the tree instead of blanking the panel", async () => {
    const tree: Record<string, DirEntry[]> = { [ROOT]: [...FOLDER[ROOT]!], [`${ROOT}/bach`]: [...FOLDER[`${ROOT}/bach`]!] };
    const f = await opened(tree);
    f.panel().actions.toggleDir(`${ROOT}/bach`);
    await flush();
    expect(f.rows()).toContain("1:bwv1.mei");
    delete tree[`${ROOT}/bach`];
    tree[ROOT] = tree[ROOT]!.filter((e) => e.name !== "bach");
    await f.change(`${ROOT}/bach`, "removed");
    expect(f.rows()).toEqual(["0:one.mei"]);
    expect(f.panel().state.get().error).toBeNull(); // not an error: it is the news
  });
});

describe("what is open, from the tabs and never the DOM", () => {
  it("marks open documents and their unsaved marker", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    f.panel().actions.pick();
    await flush();
    const info = (path: string, dirty: boolean): DocumentInfo => ({ id: `doc-${path}`, name: "x", path, dirty, version: 1, measureCount: 1, staffCount: 1, title: "", tempo: null });
    f.host.documents.set([info(`${ROOT}/one.mei`, true)]);
    const docs = f.panel().documents.get();
    expect(docs.map((d) => d.path)).toEqual([`${ROOT}/one.mei`]);
    expect(docs[0]!.dirty).toBe(true);
    // the panel reads the store the host publishes; nothing here touches a tab
    expect(f.panel().state.get().root).toBe(ROOT);
  });
});

describe("when the platform is not there", () => {
  it("a browser build says the shell is required and asks for nothing", async () => {
    const f = fixture({ shell: false });
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    expect(f.panelIds()).toEqual([PANEL_ID]);
    expect(f.panel().available).toBe(false);
    expect(f.invoked()).toEqual([]);
  });

  it("and does NOT forget the folder the desktop app remembered", async () => {
    const f = fixture({ saved: ROOT, shell: false });
    await f.host.fireStartupEvents({ coarsePointer: false });
    await flush();
    // `openFolder` answers false here because there is no shell, not
    // because the folder is gone: wiping the setting would lose it for the
    // desktop app too.
    expect(f.savedFolder()).toBe(ROOT);
  });

  it("a folder that is genuinely gone IS forgotten, with a message", async () => {
    const f = fixture({ saved: "/scores/moved" });
    await f.host.fireStartupEvents({ coarsePointer: false });
    await flush();
    expect(f.savedFolder()).toBe("");
    expect(f.panel().state.get().error).toContain("no longer available");
  });
});

describe("the switch", () => {
  it("takes the panel and the 📁 away together, and stops watching", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    f.panel().actions.pick();
    await flush();
    expect(f.invoked().filter((i) => i.cmd === "workspace_watch")).toHaveLength(1);
    await f.host.registry.setEnabled(PLUGIN_ID, false);
    await flush();
    expect(f.panelIds()).toEqual([]);
    expect(f.headerItems()).toEqual([]);
    expect(f.invoked().filter((i) => i.cmd === "workspace_unwatch")).toHaveLength(1);
  });

  it("remembers the folder across off and on", async () => {
    const f = fixture();
    await f.host.registry.runCommand(COMMAND_TOGGLE);
    f.panel().actions.pick();
    await flush();
    await f.host.registry.setEnabled(PLUGIN_ID, false);
    await f.host.registry.setEnabled(PLUGIN_ID, true);
    await flush();
    expect(f.savedFolder()).toBe(ROOT);
  });
});
