/**
 * The list model as a table: what is shown, in what order, at what depth,
 * and which folders a change makes stale. Pure functions over what
 * `readDir` returns, so none of this needs a host, a panel or a disk.
 */
import { describe, it, expect } from "vitest";
import type { DirEntry } from "@battuta/api";
import { baseOf, extOf, foldersToRefresh, isScore, listed, parentOf, rowsOf, titleOf } from "../src/tree";

const file = (path: string): DirEntry => ({ name: path.split("/").pop()!, path, kind: "file" });
const dir = (path: string): DirEntry => ({ name: path.split("/").pop()!, path, kind: "dir" });

describe("names and paths", () => {
  it("reads an extension, lower-cased, and ignores a dotfile's leading dot", () => {
    expect(extOf("Bach.mei")).toBe("mei");
    expect(extOf("LOUD.MEI")).toBe("mei");
    expect(extOf("no-extension")).toBe("");
    expect(extOf(".hidden")).toBe(""); // the dot at 0 is not an extension separator
    expect(extOf("two.dots.mei")).toBe("mei");
  });

  it("titles a score the way a tab does: the base name without the extension", () => {
    expect(titleOf("Ein_feste_Burg.mei")).toBe("Ein_feste_Burg");
    expect(titleOf("no-extension")).toBe("no-extension");
  });

  it("finds a parent and a base on both separators — the shell answers in the platform's", () => {
    expect(parentOf("/scores/bach/one.mei")).toBe("/scores/bach");
    expect(parentOf("C:\\scores\\bach\\one.mei")).toBe("C:\\scores\\bach");
    expect(baseOf("/scores/bach")).toBe("bach");
    expect(baseOf("C:\\scores\\bach")).toBe("bach");
  });
});

describe("what is listed", () => {
  it("lists .mei files and every folder", () => {
    expect(isScore("one.mei")).toBe(true);
    expect(isScore("one.MEI")).toBe(true);
    expect(isScore("notes.pdf")).toBe(false);
  });

  it("keeps folders whether or not they hold a score — you cannot know without looking", () => {
    const entries = [dir("/r/sub"), file("/r/one.mei"), file("/r/notes.pdf"), file("/r/cover.png")];
    expect(listed(entries).map((e) => e.name)).toEqual(["sub", "one.mei"]);
  });

  it("lists no importable format yet, and that is the slice's open gap", () => {
    // The editor opens these when @battuta/plugin-formats is on, but the
    // list of extensions is the host's `openExtensions` and is not on the
    // api — see BUILDING.md §7.1. The assertion is here so that closing
    // the gap has a test to change rather than a comment to notice.
    for (const name of ["piece.musicxml", "piece.xml", "piece.mxl", "tune.abc", "incipit.pae", "song.krn"]) {
      expect(isScore(name), `${name} will be listed once ctx.formats.extensions exists`).toBe(false);
    }
  });
});

describe("rowsOf", () => {
  const loaded = new Map<string, DirEntry[]>([
    ["/r", [dir("/r/bach"), dir("/r/empty"), file("/r/top.mei"), file("/r/readme.txt")]],
    ["/r/bach", [dir("/r/bach/cantatas"), file("/r/bach/bwv1.mei")]],
    ["/r/bach/cantatas", [file("/r/bach/cantatas/bwv140.mei")]],
  ]);

  it("shows the root's entries at depth 0 with every folder collapsed", () => {
    const rows = rowsOf("/r", loaded, new Set());
    expect(rows.map((r) => r.entry.name)).toEqual(["bach", "empty", "top.mei"]);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
    expect(rows[0]!.expanded).toBe(false);
  });

  it("splices an expanded folder's entries in beneath it, one depth deeper", () => {
    const rows = rowsOf("/r", loaded, new Set(["/r/bach"]));
    expect(rows.map((r) => `${r.depth}:${r.entry.name}`)).toEqual(["0:bach", "1:cantatas", "1:bwv1.mei", "0:empty", "0:top.mei"]);
    expect(rows[0]!.expanded).toBe(true);
  });

  it("nests as deep as the user has opened", () => {
    const rows = rowsOf("/r", loaded, new Set(["/r/bach", "/r/bach/cantatas"]));
    expect(rows.map((r) => `${r.depth}:${r.entry.name}`)).toEqual(["0:bach", "1:cantatas", "2:bwv140.mei", "1:bwv1.mei", "0:empty", "0:top.mei"]);
  });

  it("an expanded folder that has not arrived yet simply shows nothing under it", () => {
    const rows = rowsOf("/r", loaded, new Set(["/r/empty"]));
    expect(rows.map((r) => r.entry.name)).toEqual(["bach", "empty", "top.mei"]);
    expect(rows.find((r) => r.entry.name === "empty")!.expanded).toBe(true);
  });

  it("is empty before the root has been read", () => {
    expect(rowsOf("/r", new Map(), new Set())).toEqual([]);
  });
});

describe("foldersToRefresh", () => {
  const loaded = new Set(["/r", "/r/bach"]);

  it("a changed file makes its own folder stale, and only that one", () => {
    expect(foldersToRefresh("/r/bach/bwv1.mei", loaded)).toEqual(["/r/bach"]);
  });

  it("a change in a folder nobody has opened makes nothing stale", () => {
    expect(foldersToRefresh("/r/other/deep.mei", loaded)).toEqual([]);
  });

  it("a folder that is itself the event — created, removed, renamed — refreshes it AND its parent", () => {
    // its own row lives in the parent's listing, so both have to be re-read
    expect(foldersToRefresh("/r/bach", loaded)).toEqual(["/r/bach", "/r"]);
  });

  it("the root changing refreshes the root once, not twice", () => {
    expect(foldersToRefresh("/r", loaded)).toEqual(["/r"]);
  });
});
