/**
 * The side panel. Everything it SHOWS arrives from a store it subscribes
 * to itself; everything it DOES arrives as a callback from `activate`.
 * That split is what lets a test read the wiring straight off the element
 * `render()` returns, and it is why this file holds no workspace call and
 * no settings write.
 *
 * It subscribes IN PLACE (`useSyncExternalStore`) rather than being
 * re-opened with new props: a panel spec's `render()` runs on every
 * re-render of the host's panel area, and re-opening would remount the
 * component — collapsing every folder the user had expanded each time a
 * tab's dirty marker changed. That is 4b's §7.6, and it bites harder here
 * because `ctx.documents` republishes on every edit.
 */
import { useSyncExternalStore } from "react";
import type { DirEntry, DocumentInfo, Store } from "@battuta/api";
import { baseOf, rowsOf, titleOf } from "./tree";

/** React over a host store — six lines, so the panel subscribes in place. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(
    (onChange) => {
      const d = store.subscribe(onChange);
      return () => d.dispose();
    },
    () => store.get(),
    () => store.get(),
  );
}

/** What the panel draws. One object, so one subscription serves the whole list. */
export interface FolderState {
  /** The picked folder, or null before there is one. */
  root: string | null;
  /** Folder path → its entries, for every folder that has been read. */
  loaded: ReadonlyMap<string, readonly DirEntry[]>;
  /** Folder paths the user opened. */
  expanded: ReadonlySet<string>;
  /** Shown instead of the list: a folder that has gone, a read that failed. */
  error: string | null;
  /** A read is in flight and there is nothing to show yet. */
  busy: boolean;
}

export interface FolderActions {
  pick(): void;
  toggleDir(path: string): void;
  open(path: string): void;
  close(): void;
}

export interface PanelProps {
  state: Store<FolderState>;
  /** Every open tab: which files are open, and which have unsaved changes. */
  documents: Store<readonly DocumentInfo[]>;
  /** The active tab: its file is the highlighted row. */
  active: Store<DocumentInfo | null>;
  /** False in a browser build: the panel says so and offers nothing else. */
  available: boolean;
  actions: FolderActions;
}


const HEAD: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderBottom: "1px solid #e3e7ec", position: "sticky", top: 0, background: "#fff" };
/** The row of the score in the ACTIVE tab (the user's request: a small highlight, no dot, no bold). */
const ACTIVE_ROW = "#cfe2f5";
const NOTE: React.CSSProperties = { padding: "10px 10px", fontSize: 12, color: "#567", lineHeight: 1.5 };
const ROW: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", border: "none", background: "none", font: "inherit", fontSize: 12, padding: "3px 8px", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

export function FolderPanel({ state, documents, active, available, actions }: PanelProps) {
  const s = useStore(state);
  const docs = useStore(documents);
  const activeDoc = useStore(active);
  // Which listed files are open, and which of those are unsaved. Keyed by
  // the path the host reports, which is the same string `readDir` gave us.
  const openByPath = new Map<string, DocumentInfo>();
  for (const d of docs) if (d.path) openByPath.set(d.path, d);

  const body = (): React.ReactNode => {
    if (!available) {
      return (
        <p data-folder-unavailable style={NOTE}>
          The folder view needs the <strong>desktop app</strong>: a browser tab cannot be given a folder to read. Everything else in battuta works here.
        </p>
      );
    }
    // A folder that has gone is the commonest error, and it must not be a
    // dead end: the message comes with the way out. (The shell smoke found
    // this — a remembered folder from a previous run had been deleted, and
    // the panel showed the reason with no button to pick another.)
    const picker = (
      <p style={NOTE}>
        <button data-folder-pick onClick={() => actions.pick()}>
          choose a folder…
        </button>
        <br />
        Its scores are listed here; click one to open it.
      </p>
    );
    if (s.error) {
      return (
        <>
          <p data-folder-error style={NOTE}>
            {s.error}
          </p>
          {!s.root && picker}
        </>
      );
    }
    if (!s.root) return picker;
    const rows = rowsOf(s.root, s.loaded, s.expanded);
    if (rows.length === 0) return <p data-folder-empty style={NOTE}>{s.busy ? "reading…" : "No scores in this folder."}</p>;
    return (
      <div data-folder-list>
        {rows.map(({ entry, depth, expanded }) => {
          const doc = openByPath.get(entry.path);
          return (
            <button
              key={entry.path}
              data-folder-entry={entry.name}
              {...(entry.kind === "dir" ? { "data-folder-dir": "" } : {})}
              {...(doc ? { "data-folder-open": "" } : {})}
              {...(doc?.dirty ? { "data-folder-dirty": "" } : {})}
              {...(activeDoc?.path === entry.path ? { "data-folder-active": "" } : {})}
              title={entry.path}
              onClick={() => (entry.kind === "dir" ? actions.toggleDir(entry.path) : actions.open(entry.path))}
              style={{ ...ROW, paddingLeft: 8 + depth * 12, color: "#345", ...(activeDoc?.path === entry.path ? { background: ACTIVE_ROW } : {}) }}
            >
              {entry.kind === "dir" ? `${expanded ? "▾" : "▸"} ${entry.name}` : `${titleOf(entry.name)}${doc?.dirty ? " *" : ""}`}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div data-folder-view>
      <div style={HEAD}>
        <strong style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.root ?? undefined}>
          {s.root ? baseOf(s.root) : "folder view"}
        </strong>
        {available && s.root && (
          <button data-folder-pick title="open a different folder" onClick={() => actions.pick()} style={{ fontSize: 12 }}>
            …
          </button>
        )}
        <button data-folder-close title="close the folder view" onClick={() => actions.close()} style={{ fontSize: 12 }}>
          ×
        </button>
      </div>
      {body()}
    </div>
  );
}
