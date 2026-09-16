/**
 * The list model, as pure functions over what `ctx.workspace.readDir`
 * returns — no React, no context, no host. Everything the panel decides
 * about WHAT to show is here, so it can be read and tested as a table.
 *
 * A folder view is a tree of one shape: the picked root's entries, with
 * any folder the user expanded spliced in beneath it. Folders are listed
 * whether or not they hold a score (you cannot know without looking, and
 * looking eagerly would walk the whole disk); files are listed only when
 * they are scores.
 */
import type { DirEntry } from "@battuta/api";

/**
 * Which files are scores. **`.mei` only, deliberately** — and this is the
 * slice's one open gap, not an opinion about formats.
 *
 * The editor opens every extension its import table claims (`.musicxml`,
 * `.xml`, `.mxl`, `.abc`, `.pae`, `.krn`, `.kern` while
 * @battuta/plugin-formats is on), and the host knows that list exactly:
 * `host.formats.openExtensions`. It is not on `@battuta/api`, a plugin
 * cannot ask for it, and COPYING it here is the one thing that must not
 * happen — the list changes when a format plugin is turned on or off, and
 * a copy would be wrong the first time someone did that. So the panel
 * lists what it can name for certain, and BUILDING.md §7.1 carries the
 * addition to propose (`ctx.formats.extensions`).
 */
export const SCORE_EXTS: readonly string[] = ["mei"];

/** The extension of a file name, lower-case, without the dot ("" when it has none). */
export const extOf = (name: string): string => {
  const at = name.lastIndexOf(".");
  return at <= 0 ? "" : name.slice(at + 1).toLowerCase();
};

export const isScore = (name: string): boolean => SCORE_EXTS.includes(extOf(name));

/** The folder an entry sits in. Handles both separators: the shell answers in the platform's. */
export const parentOf = (path: string): string => {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at <= 0 ? path : path.slice(0, at);
};

/** The last segment of a path — the folder's own name, for the panel's header. */
export const baseOf = (path: string): string => {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at < 0 || at === path.length - 1 ? path : path.slice(at + 1);
};

/** A score's display name: the base name without its extension, as a tab shows it. */
export const titleOf = (name: string): string => {
  const at = name.lastIndexOf(".");
  return at <= 0 ? name : name.slice(0, at);
};

/** What the panel draws for one entry of a loaded folder. */
export function listed(entries: readonly DirEntry[]): DirEntry[] {
  return entries.filter((e) => e.kind === "dir" || isScore(e.name));
}

export interface Row {
  entry: DirEntry;
  /** 0 for the root's own entries; one more per folder you opened to get here. */
  depth: number;
  /** Folders only: whether this one is open. */
  expanded: boolean;
}

/**
 * The flat list the panel renders, depth-first: a folder's rows follow it
 * when it is expanded AND its contents have arrived. An expanded folder
 * that has not been read yet simply shows nothing under it — the panel
 * asks for it and the rows appear when the answer does.
 */
export function rowsOf(root: string, loaded: ReadonlyMap<string, readonly DirEntry[]>, expanded: ReadonlySet<string>): Row[] {
  const out: Row[] = [];
  const walk = (dir: string, depth: number): void => {
    for (const entry of listed(loaded.get(dir) ?? [])) {
      const open = entry.kind === "dir" && expanded.has(entry.path);
      out.push({ entry, depth, expanded: open });
      if (open) walk(entry.path, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Which loaded folders a change touches, so the panel re-reads those and
 * nothing else. A file's own folder, always; and when the path IS a
 * loaded folder (it was created, removed or renamed), that folder and its
 * parent — a removed folder's row lives in the parent's listing.
 */
export function foldersToRefresh(path: string, loaded: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const add = (dir: string) => {
    if (loaded.has(dir) && !out.includes(dir)) out.push(dir);
  };
  if (loaded.has(path)) add(path);
  add(parentOf(path));
  return out;
}
