/**
 * The workspace host service (capability "workspace"): the folders the
 * user opened, read-only, and the files in them — a platform capability
 * with a shell backend (Tauri commands behind this facade) and a browser
 * backend that reports itself unavailable. Slice 9a, 2026-09-16.
 *
 * SCOPED: only folders the user picked (or a plugin re-admitted from an
 * earlier session with `openFolder`) can be listed, read or watched; the
 * shell refuses everything outside them. Nothing here writes — the save
 * path is the host's.
 */
import type { Disposable } from "./disposable.js";

export interface DirEntry {
  name: string;
  /** Absolute path, the form every other call here takes. */
  path: string;
  kind: "file" | "dir";
}

export type WatchEventKind = "created" | "modified" | "removed";

export interface WatchEvent {
  path: string;
  kind: WatchEventKind;
}

export interface WorkspaceService {
  /** False in a browser build: tell the user the shell is required, and do nothing else. */
  readonly available: boolean;
  /** The native folder dialog. The picked folder becomes readable; null when cancelled or unavailable. */
  pickFolder(): Promise<string | null>;
  /** Re-admit a folder picked in an earlier session (a plugin persists the path). False when it no longer exists or the shell is unavailable. */
  openFolder(path: string): Promise<boolean>;
  /** The entries of a folder inside a picked root: folders first, then files, hidden entries skipped. Rejects outside the roots. */
  readDir(path: string): Promise<DirEntry[]>;
  /** Open a score through the host's open path: imports convert, the tab is focused if it is already open. Rejects outside the roots. */
  openDocument(path: string): Promise<void>;
  /** Watch a folder (recursively) inside a picked root; events are coalesced per path. Dispose to stop. A no-op disposable when unavailable. */
  watch(path: string, listener: (event: WatchEvent) => void): Disposable;
}
