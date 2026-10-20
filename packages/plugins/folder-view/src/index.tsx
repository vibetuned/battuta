/**
 * The folder view, as a plugin.
 *
 * A side panel listing the scores in a folder the user opened: click one
 * to open it, see which are already open and which have unsaved changes,
 * and watch the list follow the folder as files appear, change or go.
 * The first plugin in this repository that is a NEW FEATURE rather than
 * an extraction — nothing of it ever lived in `App.tsx` — which is what
 * makes it the measurement the phase wanted: it cost the host nothing.
 *
 * Everything it can do is `ctx`: the folders the user picked
 * (`ctx.workspace`, scoped by the shell), what is open (`ctx.documents`),
 * a panel and a header button. It writes nothing to the document, and to
 * disk only what the user asks for, through the workspace service: a
 * rename in place (which the host follows with any open tab), a new
 * folder, a new blank score — create-only, never an existing file. It
 * persists one string, the folder's path.
 *
 * Imports `@battuta/api`, `react` and this package's own files, and
 * nothing else.
 */
import { definePlugin, toDisposable, type ActivationEvent, type DirEntry, type Disposable, type PluginContext, type Store, type WatchEvent } from "@battuta/api";
import { COMMAND_TOGGLE, PANEL_ID, SETTING_FOLDER } from "./manifest";
import { FolderPanel, useStore, type FolderState } from "./Panel";
import { blankScore } from "./blank";
import { baseOf, foldersToRefresh, movedPath, newScoreName, parentOf, titleOf } from "./tree";

/** A host-store-shaped holder for the state this plugin owns. */
interface Signal<T> extends Store<T> {
  set(value: T): void;
}

function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const listeners = new Set<(v: T) => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of [...listeners]) l(value);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return toDisposable(() => listeners.delete(listener));
    },
  };
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * The 📁 once the plugin is active. The manifest DECLARES this item so the
 * host can render it before any of this code exists; a runtime item with
 * the same id replaces that static face while the plugin lives, which is
 * what lets the button dim when the panel is down. On deactivate the
 * declared face comes back.
 */
function ToggleButton({ open, onToggle }: { open: Store<boolean>; onToggle: () => void }) {
  const isOpen = useStore(open);
  return (
    <button data-folder-toggle title="folder view — the scores in a folder you opened" onClick={onToggle} style={{ opacity: isOpen ? 1 : 0.45 }}>
      📁
    </button>
  );
}

/** The one activation path that must NOT open the panel here — see the table in activate(). */
const WOKEN_BY_THE_BUTTON: ActivationEvent = `onCommand:${COMMAND_TOGGLE}`;

export default definePlugin({
  activate(ctx: PluginContext) {
    const state = signal<FolderState>({ root: null, home: null, loaded: new Map(), expanded: new Set(), error: null, busy: false, target: null });
    const open = signal(false);
    const patch = (fields: Partial<FolderState>) => state.set({ ...state.get(), ...fields });
    let panel: Disposable | null = null;
    let watching: Disposable | null = null;

    /**
     * Read one folder into the list. A folder that has gone is not an
     * error unless it is the ROOT: a sub-folder someone deleted just
     * leaves the tree, which is what the watch event that brought us here
     * was reporting.
     */
    const readInto = async (dir: string): Promise<void> => {
      try {
        const entries = await ctx.workspace.readDir(dir);
        const loaded = new Map(state.get().loaded);
        loaded.set(dir, entries);
        patch({ loaded, error: null, busy: false });
      } catch (e) {
        if (dir === state.get().root) {
          patch({ error: `Could not read this folder: ${message(e)}`, busy: false });
          return;
        }
        const loaded = new Map(state.get().loaded);
        const expanded = new Set(state.get().expanded);
        loaded.delete(dir);
        expanded.delete(dir);
        patch({ loaded, expanded, busy: false, ...(state.get().target === dir ? { target: state.get().root } : {}) });
      }
    };

    /** A change under the watched root: re-read exactly the folders it touches. */
    const onChange = (event: WatchEvent): void => {
      for (const dir of foldersToRefresh(event.path, new Set(state.get().loaded.keys()))) void readInto(dir);
    };

    /** Make `root` the listed folder: forget the old tree, read it, watch it. */
    const adopt = async (root: string, opts: { persist?: boolean } = {}): Promise<void> => {
      watching?.dispose();
      watching = null;
      patch({ root, loaded: new Map(), expanded: new Set(), error: null, busy: true, target: root });
      if (opts.persist) ctx.settings.set(SETTING_FOLDER, root);
      await readInto(root);
      // The watch is recursive and the host coalesces per path, so one
      // watch on the root serves every folder the user expands.
      watching = ctx.workspace.watch(root, onChange);
    };

    const actions = {
      goHome: () => {
        const home = state.get().home;
        if (home) void adopt(home, { persist: true });
      },
      pick: () => {
        void ctx.workspace
          .pickFolder()
          .then((root) => {
            if (root) void adopt(root, { persist: true });
          })
          .catch((e) => ctx.notice(`could not open that folder: ${message(e)}`));
      },
      // A click on a folder also makes it where "+ score" and "+ folder"
      // create, as a file manager's selection does.
      toggleDir: (path: string) => {
        const expanded = new Set(state.get().expanded);
        if (expanded.has(path)) {
          expanded.delete(path);
          patch({ expanded, target: path });
          return;
        }
        expanded.add(path);
        patch({ expanded, target: path });
        if (!state.get().loaded.has(path)) void readInto(path);
      },
      // The host's ONE open path: an import converts, an already-open tab
      // is focused instead of opened twice, the mtime is recorded for the
      // external-change guard. None of that is this plugin's to reproduce.
      open: (path: string) => {
        patch({ target: parentOf(path) }); // a score's folder is where the next "+" creates
        void ctx.workspace.openDocument(path).catch((e) => ctx.notice(`could not open ${baseOf(path)}: ${message(e)}`));
      },
      // In place, through the workspace service — the host follows with any
      // open tab. What this plugin keeps by path (the folders read, the
      // folders expanded) moves too, so a renamed folder stays open; then
      // the parent is re-read at once rather than waiting for the watch.
      rename: (path: string, newName: string) => {
        void ctx.workspace
          .rename(path, newName)
          .then((to) => {
            if (to === path) return;
            const s = state.get();
            const loaded = new Map<string, readonly DirEntry[]>();
            for (const [dir, entries] of s.loaded) loaded.set(movedPath(dir, path, to), entries.map((e) => ({ ...e, path: movedPath(e.path, path, to) })));
            patch({ loaded, expanded: new Set([...s.expanded].map((p) => movedPath(p, path, to))), target: s.target === null ? null : movedPath(s.target, path, to) });
            return readInto(parentOf(to));
          })
          .catch((e) => ctx.notice(`could not rename ${baseOf(path)}: ${message(e)}`));
      },
      // Create-only, through the workspace service. A new score is a blank
      // score titled after its name, and it opens at once through the
      // host's one open path — the point of making it is to write in it.
      // A new folder opens, empty, and becomes the target: the next
      // "+ score" goes in it.
      create: (kind: "file" | "dir", dir: string, typed: string) => {
        const name = kind === "file" ? newScoreName(typed) : typed.trim();
        if (!name) return;
        const made = kind === "file" ? ctx.workspace.createFile(dir, name, blankScore(titleOf(name))) : ctx.workspace.createFolder(dir, name);
        void made
          .then(async (path) => {
            await readInto(dir);
            if (kind === "dir") {
              const expanded = new Set(state.get().expanded);
              const loaded = new Map(state.get().loaded);
              expanded.add(path);
              if (!loaded.has(path)) loaded.set(path, []);
              patch({ expanded, loaded, target: path });
              return;
            }
            patch({ target: dir });
            await ctx.workspace.openDocument(path).catch((e) => ctx.notice(`created ${name}, but could not open it: ${message(e)}`));
          })
          .catch((e) => ctx.notice(`could not create ${name}: ${message(e)}`));
      },
      close: () => setOpen(false),
    };

    const mount = () => {
      if (panel) return;
      panel = ctx.panels.open({
        id: PANEL_ID,
        side: "side",
        title: "folder view",
        render: () => <FolderPanel state={state} documents={ctx.documents} active={ctx.document} available={ctx.workspace.available} actions={actions} />,
      });
      open.set(true);
    };
    const setOpen = (next: boolean) => {
      if (next) mount();
      else {
        panel?.dispose();
        panel = null;
        open.set(false);
      }
    };

    // The 📁 becomes live, so it dims while the panel is down.
    ctx.slots.add("header", { id: "toggle", render: () => <ToggleButton open={open} onToggle={() => setOpen(panel === null)} /> });

    // The wake-up table (BUILDING.md §7.2): open now unless the click that
    // woke us is about to toggle the panel itself — activation runs BEFORE
    // the handler it caused, so without `ctx.activatedBy` this would open
    // and immediately close.
    //
    //   onSettings:folder   a folder was open when I quit  → open it
    //   onCommand:<toggle>  the 📁                         → the handler's
    //   null                the Plugins tab, a test        → open
    if (ctx.activatedBy !== WOKEN_BY_THE_BUTTON) mount();

    // The folder the user left open, re-admitted through the service (the
    // shell only grants what the user picked, so a path from last session
    // has to be asked for again). Runs on every wake-up path, including
    // the 📁: the folder is there when the panel opens.
    // The folder the user chose last, else the platform's own (a tablet's
    // battuta folder: there, the view always has a folder to show).
    const saved = ctx.settings.get<string>(SETTING_FOLDER);
    void ctx.workspace
      .home()
      .then((home) => {
        patch({ home });
        if (!saved) return home ? adopt(home) : undefined;
        return ctx.workspace.openFolder(saved).then((ok) => {
          if (ok) return adopt(saved);
          // Only forget it when the shell was actually asked. In a browser
          // `openFolder` answers false because there is no shell, and
          // wiping the setting there would lose the folder for the desktop
          // app too.
          if (!ctx.workspace.available) return undefined;
          ctx.settings.set(SETTING_FOLDER, "");
          if (home) {
            ctx.notice(`The folder "${baseOf(saved)}" is no longer available — back to battuta's folder.`);
            return adopt(home);
          }
          patch({ error: `The folder "${baseOf(saved)}" is no longer available. Choose another one.` });
          return undefined;
        });
      })
      .catch((e) => patch({ error: `Could not reopen that folder: ${message(e)}` }));

    ctx.registerCommand(COMMAND_TOGGLE, () => setOpen(panel === null));

    // The watch is the one thing the host did not hand out, so it is the
    // one thing to give back. Added last, disposed first.
    ctx.subscriptions.add(
      toDisposable(() => {
        watching?.dispose();
        watching = null;
      }),
    );
  },
});
