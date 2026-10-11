/**
 * The workspace host service (capability "workspace"): the folders the
 * user opened and the files in them — a platform capability with a shell
 * backend (Tauri commands behind this facade) and a browser backend that
 * reports itself unavailable. Slice 9a, 2026-09-16.
 *
 * SCOPED: only folders the user picked (or a plugin re-admitted from an
 * earlier session with `openFolder`) can be listed, read, watched or
 * written in; the shell refuses everything outside them. The writes
 * (1.1.0, 2026-10-11, the folder view's) are `rename` in place and
 * `createFolder` / `createFile`, which are create-only: nothing here
 * overwrites, deletes or moves between folders, and an existing file's
 * contents are written only by the host's save path.
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
  /**
   * Rename a file or folder in place — `newName` is a name, never a path —
   * and resolve with its new path. Rejects with the reason: an empty or
   * dot-led name, a separator in it, a name that already exists there, a
   * picked root itself, anything outside the roots, or no shell. The host
   * follows the rename: an open document at (or, for a folder, under) the
   * old path takes the new one, so it saves where the file now is, and a
   * renamed file's tab takes its new name. Added in 1.1.0 for the folder
   * view.
   */
  rename(path: string, newName: string): Promise<string>;
  /**
   * Create an empty folder named `name` in the folder `dir` (a picked root
   * or a folder under one) and resolve with its path. Rejects with the
   * reason: a name refused as `rename` refuses it, a name that already
   * exists, `dir` outside the roots or not a folder, or no shell. Added in
   * 1.1.0 for the folder view.
   */
  createFolder(dir: string, name: string): Promise<string>;
  /**
   * Create a NEW file named `name` in `dir` with `contents` (UTF-8 text)
   * and resolve with its path. Create-only: an existing name is refused,
   * never overwritten — writing an existing file is the host's save path,
   * not this. Rejections as `createFolder`. Added in 1.1.0 for the folder
   * view's new score; open the result with `openDocument`.
   */
  createFile(dir: string, name: string, contents: string): Promise<string>;
}
