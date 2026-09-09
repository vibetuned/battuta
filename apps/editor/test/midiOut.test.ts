/**
 * The MIDI playback sink: timed sends, sounding-note tracking, and the
 * panic guarantee — nothing pending survives, nothing sounding is left
 * hanging on an external synth. Plus openMidiSink's port selection
 * (dedupe, no-outputs → null, shell-bridge fallback).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MidiSink, openMidiSink, NOTE_ON, NOTE_OFF } from "../src/midiOut";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("MidiSink", () => {
  it("sends at the scheduled wall-clock time", () => {
    const sent: number[][] = [];
    const sink = new MidiSink(["fake"], (d) => sent.push(d));
    sink.schedule([NOTE_ON, 60, 102], performance.now() + 100);
    expect(sent).toHaveLength(0);
    // fake timers floor fractional delays: keep a margin on both sides
    vi.advanceTimersByTime(95);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(10);
    expect(sent).toEqual([[NOTE_ON, 60, 102]]);
  });

  it("panic cancels pending sends and releases sounding notes", () => {
    const sent: number[][] = [];
    const sink = new MidiSink(["fake"], (d) => sent.push(d));
    sink.schedule([NOTE_ON, 60, 102], performance.now()); // sounds now
    sink.schedule([NOTE_ON, 64, 102], performance.now() + 500); // pending
    sink.schedule([NOTE_OFF, 60, 0], performance.now() + 1000); // pending off
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([[NOTE_ON, 60, 102]]);
    sink.panic();
    // the pending on/off never fire; the sounding 60 is released; CC 123 sweeps
    expect(sent.slice(1)).toEqual([
      [NOTE_OFF, 60, 0],
      [0xb0, 123, 0],
    ]);
    vi.advanceTimersByTime(2000);
    expect(sent).toHaveLength(3); // nothing pending survived
  });

  it("a note that already got its off is not re-released by panic", () => {
    const sent: number[][] = [];
    const sink = new MidiSink(["fake"], (d) => sent.push(d));
    sink.schedule([NOTE_ON, 60, 102], performance.now());
    sink.schedule([NOTE_OFF, 60, 0], performance.now() + 10);
    vi.advanceTimersByTime(20);
    sink.panic();
    expect(sent).toEqual([
      [NOTE_ON, 60, 102],
      [NOTE_OFF, 60, 0],
      [0xb0, 123, 0], // no duplicate note-off for 60
    ]);
  });
});

describe("openMidiSink", () => {
  const setNavigator = (value: unknown) => Object.defineProperty(globalThis, "navigator", { value, configurable: true });
  afterEach(() => setNavigator(undefined));

  it("uses Web MIDI outputs, deduped by name", async () => {
    const sent: { port: string; data: number[] }[] = [];
    const out = (name: string) => ({ name, send: (d: number[]) => sent.push({ port: name, data: d }) });
    setNavigator({
      requestMIDIAccess: () =>
        Promise.resolve({
          outputs: new Map([
            ["a", out("Synth")],
            ["b", out("Synth")], // driver registered it twice
            ["c", out("Sampler")],
          ]),
        }),
    });
    const sink = await openMidiSink(null);
    expect(sink!.outputs).toEqual(["Synth", "Sampler"]);
    sink!.schedule([NOTE_ON, 60, 102], 0);
    vi.advanceTimersByTime(1);
    expect(sent.map((s) => s.port)).toEqual(["Synth", "Sampler"]); // one send per DEVICE
  });

  it("no Web MIDI outputs → null (caller falls back to audio)", async () => {
    setNavigator({ requestMIDIAccess: () => Promise.resolve({ outputs: new Map() }) });
    expect(await openMidiSink(null)).toBe(null);
  });

  it("no Web MIDI at all → the shell bridge via invoke", async () => {
    setNavigator({});
    const calls: [string, unknown][] = [];
    const invoke = (cmd: string, args?: Record<string, unknown>) => {
      calls.push([cmd, args]);
      return Promise.resolve(cmd === "midi_open_outputs" ? ["IAC Bus"] : undefined);
    };
    const sink = await openMidiSink(invoke);
    expect(sink!.outputs).toEqual(["IAC Bus"]);
    sink!.schedule([NOTE_ON, 60, 102], 0);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([
      ["midi_open_outputs", undefined],
      ["midi_send", { data: [NOTE_ON, 60, 102] }],
    ]);
  });

  it("neither Web MIDI nor a shell → null", async () => {
    setNavigator({});
    expect(await openMidiSink(null)).toBe(null);
  });
});
