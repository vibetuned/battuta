/**
 * A pen tap off the staves presses the button under it (1.3.12): a stroke
 * that begins on nothing of the score and ends as a tap — within a few px,
 * within half a second — presses a `data-pen-tap` button at its point; a
 * drag, a slow press, a stroke that began on the score, or a point with no
 * such button is nothing. The event itself still reaches the plugins.
 */
import { describe, it, expect } from "vitest";
import { PenTap, pressUnder, TAP_MS, TAP_PX } from "../src/host/stylus";

describe("pressUnder", () => {
  it("presses the pen-tap button under the point, and nothing else", () => {
    const pressed: string[] = [];
    const button = { click: () => void pressed.push("add") };
    const doc = (hit: { closest?: (s: string) => typeof button | null } | null) => ({ elementFromPoint: () => hit });
    expect(pressUnder(10, 20, doc({ closest: (s) => (s === "[data-pen-tap]" ? button : null) }))).toBe(true);
    expect(pressed).toEqual(["add"]);
    expect(pressUnder(10, 20, doc({ closest: () => null }))).toBe(false);
    expect(pressUnder(10, 20, doc(null))).toBe(false);
    expect(pressUnder(10, 20, undefined)).toBe(false);
    expect(pressed).toEqual(["add"]);
  });
});

describe("PenTap", () => {
  const fixture = () => {
    let now = 1000;
    const presses: [number, number][] = [];
    const tap = new PenTap(
      (x, y) => {
        presses.push([x, y]);
        return true;
      },
      () => now,
    );
    return { tap, presses, tick: (ms: number) => (now += ms) };
  };

  it("a tap off the score presses the button under its lift; a drag or a slow press does not", () => {
    const f = fixture();
    expect(f.tap.event({ phase: "down", id: 1, x: 500, y: 300, onScore: false })).toBe(false);
    f.tick(120);
    expect(f.tap.event({ phase: "up", id: 1, x: 503, y: 302, onScore: false })).toBe(true);
    expect(f.presses).toEqual([[503, 302]]);
    // a drag: moved too far
    f.tap.event({ phase: "down", id: 2, x: 500, y: 300, onScore: false });
    f.tap.event({ phase: "move", id: 2, x: 500 + TAP_PX + 1, y: 300, onScore: false });
    expect(f.tap.event({ phase: "up", id: 2, x: 540, y: 300, onScore: false })).toBe(false);
    // a slow press
    f.tap.event({ phase: "down", id: 3, x: 500, y: 300, onScore: false });
    f.tick(TAP_MS + 1);
    expect(f.tap.event({ phase: "up", id: 3, x: 500, y: 300, onScore: false })).toBe(false);
    // a cancel, another stroke's up
    f.tap.event({ phase: "down", id: 4, x: 500, y: 300, onScore: false });
    expect(f.tap.event({ phase: "cancel", id: 4, x: 500, y: 300, onScore: false })).toBe(false);
    expect(f.tap.event({ phase: "up", id: 4, x: 500, y: 300, onScore: false })).toBe(false);
    expect(f.presses).toHaveLength(1);
  });

  it("a stroke that began on the score never presses, wherever it lifts", () => {
    const f = fixture();
    f.tap.event({ phase: "down", id: 1, x: 300, y: 250, onScore: true });
    expect(f.tap.event({ phase: "up", id: 1, x: 300, y: 250, onScore: false })).toBe(false);
    expect(f.presses).toEqual([]);
  });

  it("nothing under the point is nothing", () => {
    const tap = new PenTap(() => false, () => 0);
    tap.event({ phase: "down", id: 1, x: 1, y: 1, onScore: false });
    expect(tap.event({ phase: "up", id: 1, x: 1, y: 1, onScore: false })).toBe(false);
  });
});
