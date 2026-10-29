/**
 * The plugin against a fake context: without a stylus it does nothing at
 * all; with one it captures the pen, puts its cross on the overlays point,
 * writes what a gesture ends in as `core.enterNote` at the input's length,
 * makes a cross's length the input's, and reports a refused entry as a
 * notice. The gesture itself is `gesture.test.ts`; the host's half — the
 * capture, the score's area, the mapping to core's entry — is the
 * editor's (`apps/editor/test/stylus.test.ts`, `host.test.ts`).
 */
import { describe, it, expect } from "vitest";
import type { CommandMessage, OverlaySpec, PluginContext, StylusEvent, StylusScorePoint } from "@battuta/api";
import plugin from "../src/index";
import { STEP_X } from "../src/gesture";

const at = (step: number): StylusScorePoint => ({ measureIndex: 0, staffN: 1, eventId: "r1", step, pitch: { pname: "cdefgab"[(step + 2) % 7]!, oct: 4 + Math.floor((step + 2) / 7) }, tile: { x: 50, y: 50 } });
const stroke = (phase: "down" | "move" | "up", id: number, x: number, point: StylusScorePoint | null): StylusEvent => ({ type: "stroke", phase, id, samples: [[x, 250, 0, 0.5, 1, 0, null]], predicted: [], at: point });

function fixture(available: boolean, refuse = false) {
  const input = { entryDur: "4", entryDots: 0 };
  const lengths: string[] = [];
  const captures: boolean[] = [];
  const overlays: OverlaySpec[] = [];
  const executed: CommandMessage[] = [];
  const notices: string[] = [];
  let listener: ((e: StylusEvent) => void) | null = null;
  const ctx = {
    stylus: {
      available,
      capture: async (on: boolean) => void captures.push(on),
      on: (l: (e: StylusEvent) => void) => {
        listener = l;
        return { dispose: () => (listener = null) };
      },
    },
    overlays: { add: (spec: OverlaySpec) => (overlays.push(spec), { dispose: () => {} }) },
    execute: (m: CommandMessage) => {
      if (refuse) throw new Error("entry crosses a beam/tuplet/measure boundary");
      executed.push(m);
    },
    notice: (text: string) => void notices.push(text),
    editor: { get: () => input },
    setEntryLength: (dur: string, dots = 0) => {
      input.entryDur = dur;
      input.entryDots = dots;
      lengths.push(`${dur}${".".repeat(dots)}`);
    },
  } as unknown as PluginContext;
  void plugin.activate(ctx);
  const pen = (...events: StylusEvent[]) => events.forEach((e) => listener?.(e));
  return { input, lengths, captures, overlays, executed, notices, pen, listening: () => listener !== null };
}

describe("the stylus plugin", () => {
  it("does nothing where there is no stylus", () => {
    const f = fixture(false);
    expect(f.captures).toEqual([]);
    expect(f.overlays).toEqual([]);
    expect(f.listening()).toBe(false);
  });

  it("captures the pen and puts its cross on the overlays point", () => {
    const f = fixture(true);
    expect(f.captures).toEqual([true]);
    expect(f.overlays.map((o) => o.id)).toEqual(["cross"]);
    expect(f.listening()).toBe(true);
  });

  it("writes a tap at the input's length; a cross's length becomes the input's, for the next tap and the keyboard", () => {
    const f = fixture(true);
    f.input.entryDots = 1;
    f.pen(stroke("down", 1, 150, at(4)), stroke("up", 1, 150, at(4)));
    f.pen(stroke("down", 2, 150, at(4)), stroke("move", 2, 150 - STEP_X, at(2)), stroke("up", 2, 150 - STEP_X, at(2)));
    f.pen(stroke("down", 3, 150, at(0)), stroke("up", 3, 150, at(0)));
    expect(f.executed).toEqual([
      { type: "core.enterNote", eventId: "r1", pname: "b", oct: 4, dur: "4", dots: 1 },
      { type: "core.enterNote", eventId: "r1", pname: "g", oct: 4, dur: "8", dots: 1 },
      { type: "core.enterNote", eventId: "r1", pname: "e", oct: 4, dur: "8", dots: 1 },
    ]);
    expect(f.lengths).toEqual(["8."]);
  });

  it("reports a refused entry as a notice", () => {
    const f = fixture(true, true);
    f.pen(stroke("down", 1, 150, at(4)), stroke("up", 1, 150, at(4)));
    expect(f.notices).toEqual(["entry refused: entry crosses a beam/tuplet/measure boundary"]);
  });
});
