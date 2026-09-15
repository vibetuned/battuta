/**
 * The workspace host service over a fake shell bridge: unavailable in a
 * browser (pick → null, read → refused, watch → a no-op), and in the shell
 * the commands with their arguments, watch events routed to the watch that
 * asked and coalesced per path, dispose unwatching, openDocument through
 * the bound adapter and refused without one.
 */
import { describe, it, expect, vi } from "vitest";
import type { WatchEvent } from "@battuta/api";
import { HostWorkspaceService, type WorkspaceBridge } from "../src/host/workspace";

function fakeBridge(answers: Record<string, unknown> = {}) {
  const calls: { cmd: string; args: Record<string, unknown> | undefined }[] = [];
  let emit: ((e: { payload: unknown }) => void) | null = null;
  let nextWatchId = 1;
  const bridge: WorkspaceBridge = {
    invoke: vi.fn(async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "workspace_watch") return nextWatchId++;
      if (cmd in answers) return answers[cmd];
      return null;
    }),
    listen: vi.fn(async (_event, cb) => {
      emit = cb;
      return () => {
        emit = null;
      };
    }),
  };
  return { bridge, calls, emit: (payload: unknown) => emit?.({ payload }), listening: () => emit !== null };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("in a browser (no bridge)", () => {
  it("is unavailable: pick and openFolder answer no, readDir refuses, watch is a no-op disposable", async () => {
    const ws = new HostWorkspaceService(null);
    expect(ws.available).toBe(false);
    expect(await ws.pickFolder()).toBeNull();
    expect(await ws.openFolder("/x")).toBe(false);
    await expect(ws.readDir("/x")).rejects.toThrow(/shell is required/);
    const d = ws.watch("/x", () => undefined);
    d.dispose(); // nothing to undo, nothing thrown
    await expect(ws.openDocument("/x/a.mei")).rejects.toThrow(/no document opener/);
  });
});

describe("in the shell", () => {
  it("pick, openFolder and readDir are the commands with their arguments", async () => {
    const f = fakeBridge({ workspace_pick_folder: "/scores", workspace_open_folder: true, workspace_read_dir: [{ name: "a.mei", path: "/scores/a.mei", kind: "file" }] });
    const ws = new HostWorkspaceService(f.bridge);
    expect(ws.available).toBe(true);
    expect(await ws.pickFolder()).toBe("/scores");
    expect(await ws.openFolder("/scores")).toBe(true);
    expect(await ws.readDir("/scores")).toEqual([{ name: "a.mei", path: "/scores/a.mei", kind: "file" }]);
    expect(f.calls.map((c) => c.cmd)).toEqual(["workspace_pick_folder", "workspace_open_folder", "workspace_read_dir"]);
    expect(f.calls[2]?.args).toEqual({ path: "/scores" });
  });

  it("watch: events are routed to the watch that asked, coalesced per path, and fan out to onChange; dispose unwatches", async () => {
    const f = fakeBridge();
    const ws = new HostWorkspaceService(f.bridge, 10);
    const seenA: WatchEvent[] = [];
    const seenB: WatchEvent[] = [];
    const all: WatchEvent[] = [];
    ws.onChange((e) => all.push(e));
    const a = ws.watch("/a", (e) => seenA.push(e));
    ws.watch("/b", (e) => seenB.push(e));
    await tick(0); // the shell answers the watch ids (1, 2)
    expect(f.listening()).toBe(true);
    // a save: create + two modifies in a burst, all for one path, under watch 1
    f.emit({ id: 1, path: "/a/x.mei", kind: "created" });
    f.emit({ id: 1, path: "/a/x.mei", kind: "modified" });
    f.emit({ id: 1, path: "/a/x.mei", kind: "modified" });
    f.emit({ id: 2, path: "/b/y.mei", kind: "removed" });
    f.emit({ id: 9, path: "/nobody", kind: "modified" }); // an id nobody holds
    await tick(30);
    expect(seenA).toEqual([{ path: "/a/x.mei", kind: "modified" }]); // one event, the last kind
    expect(seenB).toEqual([{ path: "/b/y.mei", kind: "removed" }]);
    expect(all).toHaveLength(2);
    a.dispose();
    expect(f.calls.filter((c) => c.cmd === "workspace_unwatch").map((c) => c.args)).toEqual([{ id: 1 }]);
    f.emit({ id: 1, path: "/a/z.mei", kind: "created" });
    await tick(30);
    expect(seenA).toHaveLength(1); // disposed: nothing more
    expect(all).toHaveLength(2);
  });

  it("a watch disposed before the shell answered is unwatched as soon as it does; pending events die with it", async () => {
    const f = fakeBridge();
    const ws = new HostWorkspaceService(f.bridge, 10);
    const seen: WatchEvent[] = [];
    const d = ws.watch("/a", (e) => seen.push(e));
    d.dispose(); // before the id resolves
    await tick(0);
    expect(f.calls.map((c) => c.cmd)).toEqual(["workspace_watch", "workspace_unwatch"]);
    expect(seen).toEqual([]);
  });

  it("openDocument goes through the bound adapter", async () => {
    const f = fakeBridge();
    const ws = new HostWorkspaceService(f.bridge);
    const opened: string[] = [];
    ws.bind({ openDocument: async (p) => void opened.push(p) });
    await ws.openDocument("/scores/a.mei");
    expect(opened).toEqual(["/scores/a.mei"]);
    ws.bind(null);
    await expect(ws.openDocument("/scores/a.mei")).rejects.toThrow(/no document opener/);
  });
});
