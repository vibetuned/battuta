/**
 * The plugin against a fake context: without a stylus it does nothing at
 * all; with one it captures the pen, puts its cross and its feedback on the
 * overlays point and its mode item in the status bar, writes what a gesture
 * ends in as `core.enterNote` at the input's length, makes a cross's length
 * the input's, and reports a refused entry as a notice. In handwriting
 * mode it gathers a symbol's strokes, asks the shell's classifier with the
 * symbol's place, writes the mark the rules allow, offers a choice when
 * unsure and writes the pen's pick, and reports what is refused. The
 * gesture, the grouping and the rules are their own tests; the host's half
 * is the editor's (`apps/editor/test/stylus.test.ts`, `host.test.ts`).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { CommandHandler, CommandMessage, OverlaySpec, PluginContext, SlotItem, SlotName, StylusEvent, StylusRecognition, StylusRecognizeRequest, StylusScorePoint } from "@battuta/api";
import plugin from "../src/index";
import { STEP_X } from "../src/gesture";
import { GAP_MS } from "../src/handwriting";
import { CONFIRM_W, OPTION_GAP, OPTION_H, OPTION_W } from "../src/Feedback";

afterEach(() => vi.useRealTimers());

const at = (step: number, over: Partial<StylusScorePoint> = {}): StylusScorePoint => ({ measureIndex: 0, staffN: 1, eventId: "r1", step, pitch: { pname: "cdefgab"[(step + 2) % 7]!, oct: 4 + Math.floor((step + 2) / 7) }, tile: { x: 50, y: 50 }, staff: { space: 10, middleY: 250 }, measure: { left: 100, right: 500 }, nearestNote: { eventId: "n1", x: 300, y: 250, box: { left: 293.5, top: 245, right: 306.5, bottom: 255 }, pitch: { pname: "c", oct: 4 } }, nearestMark: null, ...over });
const stroke = (phase: "down" | "move" | "up", id: number, x: number, point: StylusScorePoint | null, y = 250): StylusEvent => ({ type: "stroke", phase, id, samples: [[x, y, 0, 0.5, 1, 0, null]], predicted: [], at: point });

function fixture(available: boolean, refuse = false) {
  const input = { entryDur: "4", entryDots: 0 };
  const lengths: string[] = [];
  const captures: boolean[] = [];
  const overlays: OverlaySpec[] = [];
  const items: { slot: SlotName; item: SlotItem }[] = [];
  const commands: Record<string, CommandHandler> = {};
  const executed: CommandMessage[] = [];
  const notices: string[] = [];
  const actions: string[] = [];
  const requests: StylusRecognizeRequest[] = [];
  let answers: StylusRecognition[] | Error = [];
  let point: StylusScorePoint | null = null;
  let listener: ((e: StylusEvent) => void) | null = null;
  const ctx = {
    stylus: {
      available,
      capture: async (on: boolean) => void captures.push(on),
      on: (l: (e: StylusEvent) => void) => {
        listener = l;
        return { dispose: () => (listener = null) };
      },
      at: () => point,
      recognize: async (req: StylusRecognizeRequest) => {
        requests.push(req);
        if (answers instanceof Error) throw answers;
        return answers;
      },
    },
    overlays: { add: (spec: OverlaySpec) => (overlays.push(spec), { dispose: () => {} }) },
    slots: { add: (slot: SlotName, item: SlotItem) => (items.push({ slot, item }), { dispose: () => {} }) },
    registerCommand: (id: string, handler: CommandHandler) => ((commands[id] = handler), { dispose: () => {} }),
    subscriptions: { add: <T>(d: T) => d },
    execute: (m: CommandMessage) => {
      if (refuse) throw new Error("entry crosses a beam/tuplet/measure boundary");
      executed.push(m);
    },
    notice: (text: string) => void notices.push(text),
    actions: { run: (id: string) => (actions.push(id), true) },
    editor: { get: () => input },
    setEntryLength: (dur: string, dots = 0) => {
      input.entryDur = dur;
      input.entryDots = dots;
      lengths.push(`${dur}${".".repeat(dots)}`);
    },
  } as unknown as PluginContext;
  void plugin.activate(ctx);
  const pen = (...events: StylusEvent[]) => events.forEach((e) => listener?.(e));
  return {
    input,
    lengths,
    captures,
    overlays,
    items,
    executed,
    notices,
    actions,
    requests,
    pen,
    listening: () => listener !== null,
    toggle: () => commands["battuta.stylus.mode"]?.(),
    answer: (a: StylusRecognition[] | Error) => (answers = a),
    place: (p: StylusScorePoint | null) => (point = p),
  };
}

/** A symbol written: a stroke, then the clock; the classifier answered and the outcome shown. */
async function write(f: ReturnType<typeof fixture>, strokes: [number, number][][]) {
  let id = 1;
  for (const s of strokes) {
    f.pen(stroke("down", id, s[0]![0], at(4), s[0]![1]));
    for (const p of s.slice(1)) f.pen(stroke("move", id, p[0], at(4), p[1]));
    f.pen(stroke("up", id, s[s.length - 1]![0], at(4), s[s.length - 1]![1]));
    id++;
  }
  await vi.advanceTimersByTimeAsync(GAP_MS);
  await vi.advanceTimersByTimeAsync(0);
}

describe("the stylus plugin", () => {
  it("does nothing where there is no stylus", () => {
    const f = fixture(false);
    expect(f.captures).toEqual([]);
    expect(f.overlays).toEqual([]);
    expect(f.items).toEqual([]);
    expect(f.listening()).toBe(false);
  });

  it("captures the pen, puts its cross, its ink and its feedback on the overlays point, and its mode item in the status bar", () => {
    const f = fixture(true);
    expect(f.captures).toEqual([true]);
    expect(f.overlays.map((o) => o.id)).toEqual(["cross", "ink", "handwriting"]);
    expect(f.items.map((i) => [i.slot, i.item.id])).toEqual([["statusBar", "mode"]]);
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

  it("adds to a chord after a squeeze", () => {
    const f = fixture(true);
    f.pen({ type: "button", button: "squeeze", phase: "down", x: null, y: null, height: null, at: null }, stroke("down", 1, 150, at(6)), stroke("up", 1, 150, at(6)));
    expect(f.executed).toEqual([{ type: "core.addChordNote", eventId: "r1", pname: "d", oct: 5 }]);
  });

  it("reports a refused entry or chord as a notice", () => {
    const f = fixture(true, true);
    f.pen(stroke("down", 1, 150, at(4)), stroke("up", 1, 150, at(4)));
    f.pen({ type: "button", button: "side", phase: "down", x: null, y: null, height: null, at: null }, stroke("down", 2, 150, at(4)), stroke("up", 2, 150, at(4)));
    expect(f.notices).toEqual(["entry refused: entry crosses a beam/tuplet/measure boundary", "chord refused: entry crosses a beam/tuplet/measure boundary"]);
  });
});

describe("handwriting", () => {
  it("switches on the mode command: a tap no longer writes a note — handwriting, then slurs and ties — and the cross is back after the third switch", async () => {
    vi.useFakeTimers();
    const f = fixture(true);
    f.toggle();
    f.pen(stroke("down", 1, 150, at(4)), stroke("up", 1, 150, at(4)));
    expect(f.executed).toEqual([]);
    f.toggle();
    f.pen(stroke("down", 2, 150, at(4)), stroke("up", 2, 150, at(4)));
    expect(f.executed).toEqual([]);
    expect(f.notices).toEqual([]);
    f.toggle();
    f.pen(stroke("down", 3, 150, at(4)), stroke("up", 3, 150, at(4)));
    expect(f.executed).toHaveLength(1);
  });

  it("gathers a symbol, asks the classifier with its place, writes the mark the rules allow — on the note after a sharp — and says what it read", async () => {
    vi.useFakeTimers();
    const f = fixture(true);
    f.toggle();
    // A sharp two spaces left of the note at (300, 250), on a staff of 10 px spaces: four strokes, the last three within the gap.
    f.place(at(4, { nearestNote: { eventId: "n1", x: 300, y: 250, box: { left: 293.5, top: 245, right: 306.5, bottom: 255 }, pitch: { pname: "c", oct: 4 } } }));
    f.answer([{ label: "accidentalSharp", confidence: 0.93 }, { label: "accidentalNatural", confidence: 0.05 }]);
    await write(f, [
      [[276, 235], [276, 265]],
      [[284, 233], [284, 263]],
      [[270, 244], [290, 240]],
      [[270, 254], [290, 250]],
    ]);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toMatchObject({ staffSpace: 10, context: { yStaff: -0.1, noteDx: -2, width: 2, height: 3.2 } });
    expect(f.requests[0]!.strokes).toHaveLength(4);
    expect(f.executed).toEqual([{ type: "core.mark", eventId: "n1", mark: { kind: "accidental", accid: "s" } }]);
    expect(f.notices).toEqual([]);
  });

  it("confirms what it wrote with ✓ ✗: ✓ or nothing keeps it, ✗ undoes it and offers the other answers", async () => {
    vi.useFakeTimers();
    const f = fixture(true);
    f.toggle();
    f.place(at(4));
    f.answer([{ label: "accidentalSharp", confidence: 0.9 }, { label: "accidentalNatural", confidence: 0.08 }]);
    await write(f, [[[276, 235], [276, 265]]]);
    expect(f.executed).toHaveLength(1);
    // ✗: the label's corner is right of the symbol's box (276 + 8, 235); ✗ is the second button.
    const x = 284 + CONFIRM_W + 4 + CONFIRM_W / 2;
    const y = 235 + 13;
    f.pen(stroke("down", 9, x, at(4), y), stroke("up", 9, x, at(4), y));
    expect(f.actions).toEqual(["undo"]);
    // The chooser is up now, inside the measure: its top is lifted so its rows (two answers and the discard row) end at the staff's foot.
    const oy = Math.min(235, 250 + 60 - 3 * (OPTION_H + OPTION_GAP));
    const ox = 284 + OPTION_W / 2;
    f.pen(stroke("down", 10, ox, at(4), oy + OPTION_H + OPTION_GAP + OPTION_H / 2), stroke("up", 10, ox, at(4), oy + OPTION_H + OPTION_GAP + OPTION_H / 2));
    expect(f.executed[1]).toEqual({ type: "core.mark", eventId: "n1", mark: { kind: "accidental", accid: "n" } });
    // ✓, and leaving it alone, keep it.
    await write(f, [[[276, 235], [276, 265]]]);
    f.pen(stroke("down", 11, 284 + CONFIRM_W / 2, at(4), y), stroke("up", 11, 284 + CONFIRM_W / 2, at(4), y));
    await write(f, [[[276, 235], [276, 265]]]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.actions).toEqual(["undo"]);
    expect(f.executed).toHaveLength(4);
  });

  it("asks when unsure, and the pen's tap on an option writes it; the last row discards; a tap elsewhere dismisses the chooser", async () => {
    vi.useFakeTimers();
    const f = fixture(true);
    f.toggle();
    f.place(at(4));
    f.answer([{ label: "accidentalFlat", confidence: 0.4 }, { label: "accidentalSharp", confidence: 0.35 }, { label: "fing1", confidence: 0.1 }]);
    await write(f, [[[276, 235], [276, 265]]]);
    expect(f.executed).toEqual([]);
    // The chooser's corner: right of the symbol's box (276 + 8), its top lifted so its rows end at the staff's foot (250 + 60).
    const x = 284 + OPTION_W / 2;
    // Only the two accidentals belong beside a note inside the staff: two rows, the fingering left out, then the discard row — three.
    const top = Math.min(235, 310 - 3 * (OPTION_H + OPTION_GAP));
    const row = (i: number): number => top + i * (OPTION_H + OPTION_GAP) + OPTION_H / 2;
    f.pen(stroke("down", 9, x, at(4), row(1)), stroke("up", 9, x, at(4), row(1)));
    expect(f.executed).toEqual([{ type: "core.mark", eventId: "n1", mark: { kind: "accidental", accid: "s" } }]);
    // Unsure again; the discard row writes nothing and is not a symbol.
    await write(f, [[[276, 235], [276, 265]]]);
    f.pen(stroke("down", 10, x, at(4), row(2)), stroke("up", 10, x, at(4), row(2)));
    expect(f.executed).toHaveLength(1);
    expect(f.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(GAP_MS + 1);
    expect(f.requests).toHaveLength(2);
    // Unsure again; a tap elsewhere dismisses it and is a symbol of its own.
    await write(f, [[[276, 235], [276, 265]]]);
    f.pen(stroke("down", 11, 150, at(4)), stroke("up", 11, 150, at(4)));
    expect(f.executed).toHaveLength(1);
    expect(f.requests).toHaveLength(3);
  });

  it("the quarter rest erases: the mark under it when one is nearer than the note, else the note in its column", async () => {
    vi.useFakeTimers();
    const f = fixture(true);
    f.toggle();
    // A fingering at (276, 200), above the staff; the symbol written over it, its centre at (276, 210).
    f.place(at(4, { nearestMark: { id: "f1", kind: "fingering", x: 276, y: 200 } }));
    f.answer([{ label: "restQuarter", confidence: 0.9 }]);
    await write(f, [[[276, 195], [276, 225]]]);
    expect(f.executed).toEqual([{ type: "core.erase", id: "f1" }]);
    // The same mark, the symbol on the note's head inside the staff: the note.
    await write(f, [[[300, 235], [300, 265]]]);
    expect(f.executed[1]).toEqual({ type: "core.erase", id: "n1" });
    // A mark too far from the symbol (three spaces) counts for nothing: the note in the column.
    f.place(at(4, { nearestMark: { id: "d1", kind: "dynamic", x: 300, y: 282 } }));
    await write(f, [[[300, 235], [300, 265]]]);
    expect(f.executed[2]).toEqual({ type: "core.erase", id: "n1" });
    expect(f.executed).toHaveLength(3);
  });

  it("reports what the rules refuse to write, a refused mark, and a classifier that failed", async () => {
    vi.useFakeTimers();
    const f = fixture(true);
    f.toggle();
    f.place(at(4));
    f.answer([{ label: "accidentalSharp", confidence: 0.9 }]);
    f.place(at(4, { nearestNote: null }));
    await write(f, [[[276, 235], [276, 265]]]);
    expect(f.notices).toEqual(["nothing that belongs here — read as sharp (90 %)"]);
    f.place(at(4));
    f.answer(new Error("no stylus shell"));
    await write(f, [[[276, 235], [276, 265]]]);
    expect(f.notices[1]).toBe("handwriting: no stylus shell");
    const g = fixture(true, true);
    g.toggle();
    g.place(at(4));
    g.answer([{ label: "accidentalSharp", confidence: 0.9 }]);
    await write(g, [[[276, 235], [276, 265]]]);
    expect(g.notices).toEqual(["sharp refused: entry crosses a beam/tuplet/measure boundary"]);
  });
});

describe("slurs and ties", () => {
  const note = (eventId: string, x: number, pitch: { pname: string; oct: number; accid?: string } | null) => ({ eventId, x, y: 250, box: { left: x - 6.5, top: 245, right: x + 6.5, bottom: 255 }, pitch });
  const c4 = { pname: "c", oct: 4 }, d4 = { pname: "d", oct: 4 };
  /** A bow from x0 to x1 over the middle line, the pen on `from` as it lands and on `to` as it lifts. */
  const bow = (f: ReturnType<typeof fixture>, id: number, from: ReturnType<typeof note> | null, to: ReturnType<typeof note> | null, x0 = 300, x1 = 400) => {
    f.pen(stroke("down", id, x0, at(4, { nearestNote: from })), stroke("move", id, (x0 + x1) / 2, at(4, { nearestNote: null }), 230), stroke("up", id, x1, at(4, { nearestNote: to })));
  };

  it("is the third mode: a bow from a note to a different one is a slur, to the same note a tie, written at once", () => {
    vi.useFakeTimers();
    const f = fixture(true);
    f.toggle();
    f.toggle();
    bow(f, 1, note("n1", 300, c4), note("n2", 400, d4));
    expect(f.executed).toEqual([{ type: "core.mark", eventId: "n1", mark: { kind: "slur", endId: "n2" } }]);
    expect(f.requests).toHaveLength(0);
    bow(f, 2, note("n1", 300, c4), note("n3", 400, c4));
    expect(f.executed[1]).toEqual({ type: "core.mark", eventId: "n1", mark: { kind: "tie", endId: "n3" } });
    // An accidental makes it another note: a slur.
    bow(f, 3, note("n1", 300, c4), note("n4", 400, { ...c4, accid: "s" }));
    expect(f.executed[2]).toMatchObject({ mark: { kind: "slur", endId: "n4" } });
    // Drawn backwards, the message still goes from where the pen landed; the host orders the pair.
    bow(f, 4, note("n2", 400, d4), note("n1", 300, c4), 400, 300);
    expect(f.executed[3]).toEqual({ type: "core.mark", eventId: "n2", mark: { kind: "slur", endId: "n1" } });
    expect(f.notices).toEqual([]);
  });

  it("needs a note at both ends, and two different ones; off a note the pen draws nothing", () => {
    vi.useFakeTimers();
    const f = fixture(true);
    f.toggle();
    f.toggle();
    bow(f, 1, note("n1", 300, c4), null);
    expect(f.notices).toEqual(["a slur or a tie ends on a note"]);
    bow(f, 2, note("n1", 300, c4), note("n1", 300, c4), 300, 302);
    expect(f.notices[1]).toBe("a slur or a tie goes from one note to another");
    // Landing off any note, or a space and a half from one: no bow, nothing said.
    bow(f, 3, null, note("n2", 400, d4));
    bow(f, 4, note("n1", 280, c4), note("n2", 400, d4));
    expect(f.executed).toEqual([]);
    expect(f.notices).toHaveLength(2);
  });

  it("✗ undoes the bow and offers the other kind; the pick writes it", () => {
    vi.useFakeTimers();
    const f = fixture(true);
    f.toggle();
    f.toggle();
    bow(f, 1, note("n1", 300, c4), note("n2", 400, d4));
    expect(f.executed).toHaveLength(1);
    // The label's corner: right of the bow's box (400 + 8, its top at 230); ✗ is the second button.
    const x = 408 + CONFIRM_W + 4 + CONFIRM_W / 2, y = 230 + 13;
    f.pen(stroke("down", 9, x, at(4), y), stroke("up", 9, x, at(4), y));
    expect(f.actions).toEqual(["undo"]);
    // The chooser does not fit right of the bow inside the measure (500): it goes left of it; the other kind is its first row.
    const cx = Math.max(100, 300 - 8 - OPTION_W) + OPTION_W / 2, cy = Math.min(230, 310 - 2 * (OPTION_H + OPTION_GAP)) + OPTION_H / 2;
    f.pen(stroke("down", 10, cx, at(4), cy), stroke("up", 10, cx, at(4), cy));
    expect(f.executed[1]).toEqual({ type: "core.mark", eventId: "n1", mark: { kind: "tie", endId: "n2" } });
  });
});
