/**
 * The stylus host module's arithmetic (1.3.0, phase 11): a height on a staff
 * to steps above its bottom line, and a step to a pitch under the clef in
 * force; and the shield that keeps from the page the pen strokes that begin
 * on the score while capture is on. The DOM half — which tile, which staff,
 * which event, the score's area — is checked on the tablets.
 */
import { describe, it, expect } from "vitest";
import { NOTE_RANGE, nearestOf, pitchAtStep, shieldFromPen, staffGeometry, stepAt } from "../src/host/stylus";

const LINES = [100, 110, 120, 130, 140]; // a five-line staff, 10 px between lines
const name = (p: { pname: string; oct: number } | null) => (p ? `${p.pname}${p.oct}` : null);

describe("stepAt", () => {
  it("counts half-spaces up from the bottom line, below it too, to the nearest", () => {
    expect(stepAt(140, LINES)).toBe(0);
    expect(stepAt(135, LINES)).toBe(1);
    expect(stepAt(120, LINES)).toBe(4);
    expect(stepAt(100, LINES)).toBe(8);
    expect(stepAt(90, LINES)).toBe(10);
    expect(stepAt(150, LINES)).toBe(-2);
    expect(stepAt(133, LINES)).toBe(1); // 7 px above the bottom line: nearer the space than the line
    expect(stepAt(138, LINES)).toBe(0);
  });

  it("works for staves of other line counts, and refuses fewer than two lines", () => {
    expect([120, 110, 100].map((y) => stepAt(y, [100, 120]))).toEqual([0, 1, 2]); // a two-line staff: bottom line, its one space, top line
    expect(stepAt(100, [100])).toBeNull();
    expect(stepAt(100, [100, 100])).toBeNull();
  });
});

describe("pitchAtStep", () => {
  it("reads the treble, bass and alto clefs from their bottom lines", () => {
    const treble = { shape: "G", line: 2 };
    expect(name(pitchAtStep(treble, 0))).toBe("e4");
    expect(name(pitchAtStep(treble, 8))).toBe("f5");
    expect(name(pitchAtStep(treble, -2))).toBe("c4"); // middle C on its ledger line
    const bass = { shape: "F", line: 4 };
    expect(name(pitchAtStep(bass, 0))).toBe("g2");
    expect(name(pitchAtStep(bass, 8))).toBe("a3");
    expect(name(pitchAtStep(bass, 10))).toBe("c4");
    const alto = { shape: "C", line: 3 };
    expect(name(pitchAtStep(alto, 0))).toBe("f3");
    expect(name(pitchAtStep(alto, 4))).toBe("c4");
    const tenor = { shape: "C", line: 4 };
    expect(name(pitchAtStep(tenor, 6))).toBe("c4");
  });

  it("follows an octave clef, and names nothing for a clef without pitches", () => {
    expect(name(pitchAtStep({ shape: "G", line: 2, dis: 8, disPlace: "below" }, 0))).toBe("e3");
    expect(name(pitchAtStep({ shape: "G", line: 2, dis: 15, disPlace: "above" }, 0))).toBe("e6");
    expect(pitchAtStep({ shape: "perc", line: 3 }, 0)).toBeNull();
  });
});

describe("shieldFromPen", () => {
  /** An event as the page gets it: a type, a pointer type or stylus touches, a time, a place (the score is x < 500). */
  const event = (type: string, at: number, extra: { pointerType?: string; touchTypes?: string[]; x?: number; id?: number } = {}): Event => {
    const e = new Event(type, { cancelable: true });
    const x = extra.x ?? 100;
    Object.defineProperty(e, "timeStamp", { value: at });
    Object.defineProperty(e, "clientX", { value: x });
    Object.defineProperty(e, "clientY", { value: 100 });
    Object.defineProperty(e, "pointerId", { value: extra.id ?? 1 });
    if (extra.pointerType !== undefined) Object.defineProperty(e, "pointerType", { value: extra.pointerType });
    if (extra.touchTypes) Object.defineProperty(e, "changedTouches", { value: extra.touchTypes.map((touchType, identifier) => ({ touchType, identifier, clientX: x, clientY: 100 })) });
    return e;
  };
  const setup = () => {
    const target = new EventTarget();
    const down = shieldFromPen(target as unknown as Window, (x) => x < 500);
    const seen: string[] = [];
    for (const t of ["pointerdown", "pointermove", "pointerup", "touchstart", "mousedown", "click"]) target.addEventListener(t, (e) => seen.push(`${t}:${(e as unknown as { pointerType?: string }).pointerType ?? "-"}`));
    return { target, down, seen };
  };

  it("stops the pen's pointer and touch events — without preventing them, which on iPadOS would fail the shell's recognizer — and lets fingers through", () => {
    const { target, seen } = setup();
    const start = event("touchstart", 1, { touchTypes: ["stylus"] });
    target.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(false);
    target.dispatchEvent(event("pointerdown", 0, { pointerType: "pen" }));
    target.dispatchEvent(event("pointermove", 5, { pointerType: "pen" }));
    target.dispatchEvent(event("touchstart", 6, { touchTypes: ["stylus"] }));
    target.dispatchEvent(event("pointerup", 10, { pointerType: "pen" }));
    target.dispatchEvent(event("pointerdown", 2000, { pointerType: "touch" }));
    target.dispatchEvent(event("touchstart", 2001, { touchTypes: ["direct"] }));
    expect(seen).toEqual(["pointerdown:touch", "touchstart:-"]);
  });

  it("stops the mouse events and click after a pen tap — preventing those — not after a finger's, and not long after", () => {
    const { target, seen } = setup();
    target.dispatchEvent(event("pointerup", 100, { pointerType: "pen" }));
    const click = event("mousedown", 150);
    target.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    target.dispatchEvent(event("click", 160));
    target.dispatchEvent(event("click", 1000)); // 900 ms on: a click of its own
    target.dispatchEvent(event("pointerup", 2000, { pointerType: "pen" }));
    target.dispatchEvent(event("pointerdown", 2100, { pointerType: "touch" })); // a finger right after the pen
    target.dispatchEvent(event("click", 2150));
    expect(seen).toEqual(["click:-", "pointerdown:touch", "click:-"]);
  });

  it("lets through a stroke that begins off the score, wherever it goes, and the tap's click", () => {
    const { target, seen } = setup();
    target.dispatchEvent(event("pointerdown", 0, { pointerType: "pen", x: 700 }));
    target.dispatchEvent(event("pointermove", 5, { pointerType: "pen", x: 300 })); // onto the score: still the page's stroke
    target.dispatchEvent(event("pointerup", 10, { pointerType: "pen", x: 300 }));
    target.dispatchEvent(event("click", 20, { x: 300 }));
    target.dispatchEvent(event("touchstart", 30, { touchTypes: ["stylus"], x: 700 }));
    expect(seen).toEqual(["pointerdown:pen", "pointermove:pen", "pointerup:pen", "click:-", "touchstart:-"]);
  });

  it("keeps a stroke that begins on the score, even where it leaves it; and a pen hovering over it", () => {
    const { target, seen } = setup();
    target.dispatchEvent(event("pointerdown", 0, { pointerType: "pen", x: 300 }));
    target.dispatchEvent(event("pointermove", 5, { pointerType: "pen", x: 700 }));
    target.dispatchEvent(event("pointerup", 10, { pointerType: "pen", x: 700 }));
    target.dispatchEvent(event("pointermove", 2000, { pointerType: "pen", x: 300, id: 2 })); // hovering, no stroke
    target.dispatchEvent(event("pointermove", 2010, { pointerType: "pen", x: 700, id: 2 }));
    expect(seen).toEqual(["pointermove:pen"]);
  });

  it("comes down whole", () => {
    const { target, down, seen } = setup();
    down();
    target.dispatchEvent(event("pointerdown", 0, { pointerType: "pen" }));
    expect(seen).toEqual(["pointerdown:pen"]);
  });
});

describe("the symbol's context (1.3.5)", () => {
  it("reads a staff's space and middle line off its lines, however many", () => {
    expect(staffGeometry([100, 112, 124, 136, 148])).toEqual({ space: 12, middleY: 124 });
    expect(staffGeometry([50, 60])).toEqual({ space: 10, middleY: 55 });
  });

  it("finds the notehead nearest a point when one is within reach, and none beyond eight spaces", () => {
    const heads = [
      { eventId: "a", x: 100, y: 100 },
      { eventId: "b", x: 130, y: 90 },
    ];
    expect(nearestOf(heads, 120, 95, NOTE_RANGE * 12)?.eventId).toBe("b");
    expect(nearestOf(heads, 101, 100, 1.5)?.eventId).toBe("a");
    expect(nearestOf(heads, 300, 100, NOTE_RANGE * 12)).toBeNull(); // 170 px away, 96 is the reach
    expect(nearestOf([], 0, 0, 10)).toBeNull();
  });
});
