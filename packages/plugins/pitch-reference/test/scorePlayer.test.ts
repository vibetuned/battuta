/**
 * The written notes through a sink-shaped fake: every note from the
 * playhead on is scheduled as on and off at the recording's pace through
 * the alignment, a note already sounding at the playhead starts now, a
 * note over before it is skipped, the position follows the clock, pause
 * panics the sink and keeps the position, and the end reports itself
 * after the last off.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MidiOutputs } from "@battuta/api";
import type { WrittenNote } from "../src/align";
import { ScorePlayer } from "../src/scorePlayer";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const NOTES: WrittenNote[] = [
  { id: "n1", fromMs: 0, toMs: 500, midi: 69, measureId: "m1" },
  { id: "n2", fromMs: 500, toMs: 1000, midi: 71, measureId: "m2" },
];

function fakeSink() {
  const scheduled: { data: number[]; at: number }[] = [];
  const sink = { names: ["fake"], schedule: (data: number[], at: number) => void scheduled.push({ data, at }), send: () => undefined, panic: vi.fn(), close: () => undefined } as unknown as MidiOutputs & { panic: ReturnType<typeof vi.fn> };
  return { sink, scheduled };
}

describe("ScorePlayer", () => {
  it("schedules on and off for every note from the playhead, through the alignment", () => {
    let now = 1000;
    const p = new ScorePlayer(() => now);
    const { sink, scheduled } = fakeSink();
    p.play(sink, NOTES, { offsetMs: 100, rate: 1 }, 0);
    expect(scheduled.map((s) => [s.data, s.at - 1000])).toEqual([
      [[0x90, 69, 100], 100],
      [[0x80, 69, 0], 590], // 600 less the re-attack gap
      [[0x90, 71, 100], 600],
      [[0x80, 71, 0], 1090],
    ]);
    expect(p.playing).toBe(true);
    now = 1250;
    expect(p.position()).toBe(250);
    expect(p.pause()).toBe(250);
    expect(sink.panic).toHaveBeenCalledTimes(1);
    expect(p.playing).toBe(false);
    expect(p.position()).toBe(250);
  });

  it("a note sounding at the playhead starts now; one already over is skipped; half speed stretches", () => {
    const p = new ScorePlayer(() => 0);
    const { sink, scheduled } = fakeSink();
    p.play(sink, NOTES, { offsetMs: 100, rate: 1 }, 700);
    expect(scheduled.map((s) => [s.data[1], s.at])).toEqual([
      [71, 0], // n2 began at 600: it starts at once
      [71, 390],
    ]);
    const slow = fakeSink();
    p.play(slow.sink, NOTES, { offsetMs: 0, rate: 0.5 }, 0);
    expect(slow.scheduled.map((s) => s.at)).toEqual([0, 990, 1000, 1990]);
    // transposed: the take was sung an octave down, so the notes sound an octave down
    const down = fakeSink();
    p.play(down.sink, NOTES, { offsetMs: 0, rate: 1 }, 0, -12);
    expect(down.scheduled.map((s) => s.data[1])).toEqual([57, 57, 59, 59]);
    // a pitch pushed off the keyboard is skipped, not wrapped
    const off = fakeSink();
    p.play(off.sink, [{ id: "hi", fromMs: 0, toMs: 100, midi: 120, measureId: null }], { offsetMs: 0, rate: 1 }, 0, 12);
    expect(off.scheduled).toEqual([]);
  });

  it("reports its end after the last off, and not on pause", () => {
    let now = 0;
    const p = new ScorePlayer(() => now);
    const ended = vi.fn();
    p.onEnded = ended;
    const { sink } = fakeSink();
    p.play(sink, NOTES, { offsetMs: 0, rate: 1 }, 0);
    vi.advanceTimersByTime(900);
    p.pause();
    vi.advanceTimersByTime(500);
    expect(ended).not.toHaveBeenCalled();
    p.play(sink, NOTES, { offsetMs: 0, rate: 1 }, 0);
    now = 0;
    vi.advanceTimersByTime(1040); // 990 + the tail
    expect(ended).toHaveBeenCalledTimes(1);
    expect(p.playing).toBe(false);
    expect(p.position()).toBe(990);
  });
});
