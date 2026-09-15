/**
 * The performance — the player's reading of the host's timemap and the
 * document's notation facts (performance.ts). The tie-merging cases moved
 * here from core's playback.test.ts when the interpretation left core
 * (slice 7a): one attack per tie chain, a release gated by the marks,
 * clones lighting the engraved note.
 */
import { describe, it, expect } from "vitest";
import type { NotationFacts, Timemap } from "@battuta/api";
import { buildPerformance, gateFor, mergeTiedSpans, GATE_DEFAULT, GATE_STACCATO, GATE_STACCATISSIMO, GATE_SLUR, GATE_TENUTO } from "../src/performance";

const facts = (patch: Partial<NotationFacts> = {}): NotationFacts => ({ ties: {}, marks: {}, ...patch });
const timemap = (patch: Partial<Timemap>): Timemap => ({ events: [], notes: {}, idMap: {}, ...patch });

describe("mergeTiedSpans", () => {
  const events = [
    { tstamp: 0, on: ["a"] },
    { tstamp: 1000, off: ["a"], on: ["b"] },
    { tstamp: 2000, off: ["b"], on: ["x"] },
    { tstamp: 2500, off: ["x"] },
  ];

  it("merges a tie chain into one attack with the summed duration", () => {
    const { roots, durations } = mergeTiedSpans(events, { a: "b" }, {});
    expect(roots["a"]).toBe("a");
    expect(roots["b"]).toBe("a"); // continuation: no attack
    expect(durations["a"]).toBe(2000);
    expect(durations["x"]).toBe(500);
  });

  it("same-pitch repeats WITHOUT a tie re-attack normally", () => {
    const { roots, durations } = mergeTiedSpans(events, {}, {});
    expect(roots["b"]).toBe("b");
    expect(durations["a"]).toBe(1000);
    expect(durations["b"]).toBe(1000);
  });

  it("clone ids resolve through idMap (repeat passes stay tied)", () => {
    const cloned = [
      { tstamp: 0, on: ["a-rend2"] },
      { tstamp: 1000, off: ["a-rend2"], on: ["b-rend2"] },
      { tstamp: 2000, off: ["b-rend2"] },
    ];
    const { roots, durations } = mergeTiedSpans(cloned, { a: "b" }, { "a-rend2": "a", "b-rend2": "b" });
    expect(roots["b-rend2"]).toBe("a-rend2");
    expect(durations["a-rend2"]).toBe(2000);
  });
});

describe("gateFor: what the marks mean in sound", () => {
  it("an explicit articulation beats the slur's legato; unmarked notes detach slightly", () => {
    expect(gateFor(undefined)).toBe(GATE_DEFAULT);
    expect(gateFor([])).toBe(GATE_DEFAULT);
    expect(gateFor(["slur"])).toBe(GATE_SLUR);
    expect(gateFor(["staccato", "slur"])).toBe(GATE_STACCATO); // portato-ish: stacc beats the slur
    expect(gateFor(["staccatissimo"])).toBe(GATE_STACCATISSIMO);
    expect(gateFor(["tenuto"])).toBe(GATE_TENUTO);
    expect(GATE_DEFAULT).toBeLessThan(1.0);
  });
});

describe("buildPerformance", () => {
  it("one attack per tie chain, held for the merged span; the notes keep time order", () => {
    const perf = buildPerformance(
      timemap({
        events: [
          { tstamp: 0, on: ["a"] },
          { tstamp: 500, on: ["b"], off: ["a"] },
          { tstamp: 1000, off: ["b"], on: ["c"] },
          { tstamp: 1500, off: ["c"] },
        ],
        notes: { a: { pitch: 60, duration: 500 }, b: { pitch: 60, duration: 500 }, c: { pitch: 62, duration: 500 } },
      }),
      facts({ ties: { a: "b" } }),
    );
    expect(perf.notes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(perf.notes[0]).toMatchObject({ pitch: 60, onMs: 0, durMs: 1000 * GATE_DEFAULT });
    expect(perf.notes[1]).toMatchObject({ pitch: 62, onMs: 1000, durMs: 500 * GATE_DEFAULT });
    expect(perf.totalMs).toBe(1500);
  });

  it("gates shape the release from the marks of the ENGRAVED id; clones light the engraved note", () => {
    const perf = buildPerformance(
      timemap({
        events: [
          { tstamp: 0, on: ["n1-rend2"], measureOn: "m1-rend2" },
          { tstamp: 500, off: ["n1-rend2"] },
        ],
        notes: { "n1-rend2": { pitch: 64, duration: 500 } },
        idMap: { "n1-rend2": "n1", "m1-rend2": "m1" },
      }),
      facts({ marks: { n1: ["staccato"] } }),
    );
    expect(perf.notes).toEqual([{ id: "n1-rend2", visId: "n1", pitch: 64, onMs: 0, durMs: 250 }]);
    expect(perf.cues[0]).toEqual({ atMs: 0, on: ["n1"], off: [], measureOn: "m1" });
    expect(perf.cues[1]).toEqual({ atMs: 500, on: [], off: ["n1"] });
  });

  it("cues keep only the events that change something; a note with no timemap entry is skipped", () => {
    const perf = buildPerformance(
      timemap({
        events: [
          { tstamp: 0, on: ["a"] },
          { tstamp: 100 }, // nothing happens here
          { tstamp: 500, off: ["a"], on: ["ghost"] },
        ],
        notes: { a: { pitch: 60, duration: 500 } },
      }),
      facts(),
    );
    expect(perf.cues.map((c) => c.atMs)).toEqual([0, 500]);
    expect(perf.notes.map((n) => n.id)).toEqual(["a"]); // "ghost" has no pitch: not played
  });

  it("an empty timemap is an empty performance", () => {
    expect(buildPerformance(timemap({}), facts())).toEqual({ notes: [], cues: [], totalMs: 0 });
  });
});
