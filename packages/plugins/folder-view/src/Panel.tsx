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
import { useRef, useState, useSyncExternalStore } from "react";
import type { DirEntry, DocumentInfo, Store } from "@battuta/api";
import { baseOf, renamedName, rowsOf, titleOf } from "./tree";

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
  /** Where "+ score" and "+ folder" create: the last folder clicked, or the folder of the last score opened — the root until either happens. */
  target: string | null;
}

export interface FolderActions {
  pick(): void;
  toggleDir(path: string): void;
  open(path: string): void;
  /** Rename an entry in place; `newName` is the full name (a score's extension already put back). */
  rename(path: string, newName: string): void;
  /** Create a score (`.mei` added, a blank score written, then opened) or a folder in `dir`, from what was typed. */
  create(kind: "file" | "dir", dir: string, typed: string): void;
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
/**
 * The TARGET folder — where "+ score" and "+ folder" create — marked with
 * a bar at its left and a fainter tint than the active score's, so the two
 * never read alike (a folder row is never the active one anyway). When the
 * target is the top folder, its name in the header carries the bar.
 */
const TARGET_BAR = "inset 3px 0 0 #6f9bd1";
const TARGET_ROW: React.CSSProperties = { background: "#eef4fb", boxShadow: TARGET_BAR };
const NOTE: React.CSSProperties = { padding: "10px 10px", fontSize: 12, color: "#567", lineHeight: 1.5 };
const ROW: React.CSSProperties = { display: "block", flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", font: "inherit", fontSize: 12, padding: "3px 8px", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const LINE: React.CSSProperties = { display: "flex", alignItems: "center" };
const PENCIL: React.CSSProperties = { border: "none", background: "none", font: "inherit", fontSize: 12, color: "#789", cursor: "pointer", padding: "0 8px" };
const EDIT: React.CSSProperties = { flex: 1, minWidth: 0, font: "inherit", fontSize: 12, margin: "1px 6px", padding: "1px 4px", border: "1px solid #8ab", borderRadius: 3, outline: "none" };

const NEW_ICON: React.CSSProperties = { fontSize: 12, color: "#345", paddingLeft: 8 };

/**
 * A name being typed — a rename, or a new score or folder. Enter or
 * leaving the field commits what was typed, Escape gives null; `done`
 * makes sure that happens once (Enter unmounts the field, and a browser
 * may or may not send it a blur on the way out). The caller decides what
 * the text means.
 */
function NameField({ use, initial, label, placeholder, onDone }: { use: "rename" | "file" | "dir"; initial: string; label: string; placeholder?: string; onDone: (typed: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (typed: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(typed);
  };
  return (
    <input
      {...(use === "rename" ? { "data-folder-rename-input": "" } : { "data-folder-create-input": use })}
      aria-label={label}
      value={value}
      {...(placeholder ? { placeholder } : {})}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={() => finish(value)}
      style={EDIT}
    />
  );
}

export function FolderPanel({ state, documents, active, available, actions }: PanelProps) {
  const s = useStore(state);
  const docs = useStore(documents);
  const activeDoc = useStore(active);
  /** The row under the pointer shows its ✎; the row being renamed shows a field. Both are the panel's own, not the plugin's state. */
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** "+ score" / "+ folder" pressed: the field for the new name, and the folder it goes in. */
  const [creating, setCreating] = useState<{ kind: "file" | "dir"; dir: string } | null>(null);
  const rows = s.root && !s.error ? rowsOf(s.root, s.loaded, s.expanded) : [];
  // The target as the list can show it: a folder whose row is not visible
  // (a parent collapsed since) falls back to the root, so the field always
  // appears where the new entry will land.
  const target = s.root && s.target && s.target !== s.root && rows.some((r) => r.entry.path === s.target && r.entry.kind === "dir") ? s.target : s.root;
  /** The top folder is the target: its name in the header is marked, as a folder row would be. */
  const rootIsTarget = available && s.root !== null && !s.error && target === s.root;
  const startCreate = (kind: "file" | "dir") => {
    if (!target) return;
    setEditing(null);
    if (target !== s.root && !s.expanded.has(target)) actions.toggleDir(target);
    setCreating({ kind, dir: target });
  };
  const createRow = (depth: number): React.ReactNode =>
    creating && (
      <div key="+create" data-folder-creating={creating.kind} style={{ ...LINE, paddingLeft: depth * 12 }}>
        {creating.kind === "dir" && <span style={NEW_ICON}>▸</span>}
        <NameField
          use={creating.kind}
          initial=""
          label={creating.kind === "dir" ? "name of the new folder" : "name of the new score"}
          placeholder={creating.kind === "dir" ? "new folder" : "new score"}
          onDone={(typed) => {
            const c = creating;
            setCreating(null);
            if (typed !== null && typed.trim()) actions.create(c.kind, c.dir, typed);
          }}
        />
      </div>
    );
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
    const creatingHere = creating !== null && creating.dir === s.root;
    if (rows.length === 0 && !creatingHere) return <p data-folder-empty style={NOTE}>{s.busy ? "reading…" : "No scores in this folder."}</p>;
    return (
      <div data-folder-list>
        {creatingHere && createRow(0)}
        {rows.map(({ entry, depth, expanded }) => {
          const doc = openByPath.get(entry.path);
          const isActive = activeDoc?.path === entry.path;
          const isTarget = entry.kind === "dir" && entry.path === target;
          if (editing === entry.path) {
            return (
              <div key={entry.path} data-folder-renaming={entry.name} style={{ ...LINE, paddingLeft: depth * 12, ...(isActive ? { background: ACTIVE_ROW } : {}) }}>
                <NameField
                  use="rename"
                  initial={entry.kind === "file" ? titleOf(entry.name) : entry.name}
                  label={`new name for ${entry.name}`}
                  onDone={(typed) => {
                    setEditing(null);
                    const name = typed === null ? null : renamedName(entry, typed);
                    if (name !== null) actions.rename(entry.path, name);
                  }}
                />
              </div>
            );
          }
          const row = (
            <div
              key={entry.path}
              {...(isTarget ? { "data-folder-target": "" } : {})}
              style={{ ...LINE, ...(isActive ? { background: ACTIVE_ROW } : {}), ...(isTarget ? TARGET_ROW : {}) }}
              onMouseEnter={() => setHover(entry.path)}
              onMouseLeave={() => setHover((h) => (h === entry.path ? null : h))}
            >
              <button
                data-folder-entry={entry.name}
                {...(entry.kind === "dir" ? { "data-folder-dir": "" } : {})}
                {...(doc ? { "data-folder-open": "" } : {})}
                {...(doc?.dirty ? { "data-folder-dirty": "" } : {})}
                {...(isActive ? { "data-folder-active": "" } : {})}
                title={entry.path}
                onClick={() => (entry.kind === "dir" ? actions.toggleDir(entry.path) : actions.open(entry.path))}
                onKeyDown={(e) => {
                  if (e.key !== "F2") return;
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(entry.path);
                }}
                style={{ ...ROW, paddingLeft: 8 + depth * 12, color: "#345" }}
              >
                {entry.kind === "dir" ? `${expanded ? "▾" : "▸"} ${entry.name}` : `${titleOf(entry.name)}${doc?.dirty ? " *" : ""}`}
              </button>
              {hover === entry.path && (
                <button data-folder-rename={entry.name} title={`rename ${entry.name} (F2)`} aria-label={`rename ${entry.name}`} onClick={() => setEditing(entry.path)} style={PENCIL}>
                  ✎
                </button>
              )}
            </div>
          );
          // the new entry's field goes first inside the folder it lands in
          return creating !== null && creating.dir === entry.path && entry.kind === "dir" ? [row, createRow(depth + 1)] : row;
        })}
      </div>
    );
  };

  return (
    <div data-folder-view>
      <div style={HEAD}>
        <strong
          {...(rootIsTarget ? { "data-folder-target": "" } : {})}
          style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...(rootIsTarget ? { boxShadow: TARGET_BAR, paddingLeft: 6 } : {}) }}
          title={rootIsTarget ? `${s.root} — new scores and folders go here` : (s.root ?? undefined)}
        >
          {s.root ? baseOf(s.root) : "folder view"}
        </strong>
        {available && s.root && !s.error && target && (
          <>
            <button data-folder-new-score title={`new score in ${baseOf(target)}`} onClick={() => startCreate("file")} style={{ fontSize: 12 }}>
              + score
            </button>
            <button data-folder-new-folder title={`new folder in ${baseOf(target)}`} onClick={() => startCreate("dir")} style={{ fontSize: 12 }}>
              + folder
            </button>
          </>
        )}
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
