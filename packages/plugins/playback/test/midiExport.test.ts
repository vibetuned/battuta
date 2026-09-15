/**
 * The playback-MIDI encoder must write a valid SMF that matches the
 * player's interpretation: one attack per tie chain held for the merged
 * span, articulation gates shortening releases, chord notes together. It
 * encodes the same Performance the player plays (performance.ts, from the
 * host's timemap and the document's notation facts).
 */
import { describe, it, expect } from "vitest";
import type { NotationFacts, Timemap } from "@battuta/api";
import { playbackToMidi } from "../src/midiExport";
import { buildPerformance } from "../src/performance";

/** Tiny SMF reader: header fields + the note on/off events of track 0. */
function parseSmf(bytes: Uint8Array) {
  const str = (at: number, len: number) => String.fromCharCode(...bytes.subarray(at, at + len));
  expect(str(0, 4)).toBe("MThd");
  const division = (bytes[12]! << 8) | bytes[13]!;
  expect(str(14, 4)).toBe("MTrk");
  const events: { tick: number; on: boolean; pitch: number; velocity: number }[] = [];
  let at = 22;
  let tick = 0;
  while (at < bytes.length) {
    let delta = 0;
    while (bytes[at]! & 0x80) delta = (delta << 7) | (bytes[at++]! & 0x7f);
    delta = (delta << 7) | bytes[at++]!;
    tick += delta;
    const status = bytes[at++]!;
    if (status === 0xff) {
      const type = bytes[at++]!;
      const len = bytes[at++]!;
      at += len;
      if (type === 0x2f) break;
    } else {
      const pitch = bytes[at++]!;
      const velocity = bytes[at++]!;
      events.push({ tick, on: (status & 0xf0) === 0x90, pitch, velocity });
    }
  }
  return { division, events };
}

/** The performance of a timemap plus facts — what the player would play. */
const perf = (timemap: Partial<Timemap>, facts: Partial<NotationFacts> = {}) => buildPerformance({ events: [], notes: {}, idMap: {}, ...timemap }, { ties: {}, marks: {}, ...facts });

describe("playbackToMidi", () => {
  it("writes 1 tick = 1 ms and balanced note on/off pairs", () => {
    const p = perf({
      events: [
        { tstamp: 0, on: ["a"] },
        { tstamp: 500, on: ["b"], off: ["a"] },
        { tstamp: 1000, off: ["b"] },
      ],
      notes: { a: { pitch: 60, duration: 500 }, b: { pitch: 62, duration: 500 } },
    });
    const { division, events } = parseSmf(playbackToMidi(p));
    expect(division).toBe(500); // at tempo 500000 µs/quarter: 1 tick = 1 ms
    expect(events.filter((e) => e.on)).toHaveLength(2);
    expect(events.filter((e) => !e.on)).toHaveLength(2);
    expect(events[0]).toMatchObject({ tick: 0, on: true, pitch: 60 });
    // default gate: slightly detached, so the off lands before 500
    const offA = events.find((e) => !e.on && e.pitch === 60)!;
    expect(offA.tick).toBeLessThan(500);
    expect(offA.tick).toBeGreaterThan(300);
  });

  it("a tie chain sounds ONCE for the merged span", () => {
    const p = perf(
      {
        events: [
          { tstamp: 0, on: ["a"] },
          { tstamp: 500, on: ["b"], off: ["a"] }, // b continues a
          { tstamp: 1000, off: ["b"] },
        ],
        notes: { a: { pitch: 60, duration: 500 }, b: { pitch: 60, duration: 500 } },
      },
      { ties: { a: "b" } }, // a ties INTO b
    );
    const { events } = parseSmf(playbackToMidi(p));
    expect(events.filter((e) => e.on)).toHaveLength(1); // one attack
    const off = events.find((e) => !e.on)!;
    expect(off.tick).toBeGreaterThan(500); // held across the barline span
  });

  it("marks shape the release: staccato half, legato full", () => {
    const p = perf(
      {
        events: [
          { tstamp: 0, on: ["stac"] },
          { tstamp: 500, on: ["leg"], off: ["stac"] },
          { tstamp: 1000, off: ["leg"] },
        ],
        notes: { stac: { pitch: 60, duration: 500 }, leg: { pitch: 64, duration: 500 } },
      },
      { marks: { stac: ["staccato"], leg: ["slur"] } },
    );
    const { events } = parseSmf(playbackToMidi(p));
    expect(events.find((e) => !e.on && e.pitch === 60)!.tick).toBe(250); // staccato: half
    expect(events.find((e) => !e.on && e.pitch === 64)!.tick).toBe(1000); // legato: full
  });

  it("marks are looked up by the NOTATED id for cloned repeat passes (idMap)", () => {
    const p = perf(
      {
        events: [
          { tstamp: 0, on: ["n1-rend2"] },
          { tstamp: 500, off: ["n1-rend2"] },
        ],
        notes: { "n1-rend2": { pitch: 60, duration: 500 } },
        idMap: { "n1-rend2": "n1" },
      },
      { marks: { n1: ["staccato"] } }, // keyed by the notated id
    );
    const { events } = parseSmf(playbackToMidi(p));
    expect(events.find((e) => !e.on)!.tick).toBe(250);
  });

  it("transposes every pitch by the semitone offset, clamped to MIDI range", () => {
    const p = perf({
      events: [
        { tstamp: 0, on: ["lo", "hi"] },
        { tstamp: 500, off: ["lo", "hi"] },
      ],
      notes: { lo: { pitch: 1, duration: 500 }, hi: { pitch: 126, duration: 500 } },
    });
    const { events } = parseSmf(playbackToMidi(p, { transpose: -12 }));
    expect(events.filter((e) => e.on).map((e) => e.pitch).sort((a, b) => a - b)).toEqual([0, 114]);
  });

  it("at the same tick, offs come before ons so a repeated pitch re-attacks", () => {
    // the legato gate (1.0) makes a's off land exactly on b's on
    const p2 = perf(
      {
        events: [
          { tstamp: 0, on: ["a"] },
          { tstamp: 500, off: ["a"], on: ["b"] },
          { tstamp: 1000, off: ["b"] },
        ],
        notes: { a: { pitch: 60, duration: 500 }, b: { pitch: 60, duration: 500 } },
      },
      { marks: { a: ["slur"], b: ["slur"] } },
    );
    const { events } = parseSmf(playbackToMidi(p2));
    const at500 = events.filter((e) => e.tick === 500);
    expect(at500.map((e) => e.on)).toEqual([false, true]);
  });
});
