/**
 * The MIDI host service and its outputs handle.
 *
 *  - MidiSink: timed sends, sounding-note tracking, and the panic
 *    guarantee — nothing pending survives, nothing sounding is left
 *    hanging on an external synth; close() panics then releases.
 *  - The Web MIDI backend: inputs deduped by name with the duplicates
 *    DETACHED, hot-plug through onstatechange, note parsing, outputs
 *    deduped the same way.
 *  - The shell backend: the two events in, the three commands out.
 *  - The service: one note stream for hardware and virtual inputs, virtual
 *    inputs listed and unlisted, the test seam the e2e scripts use, and
 *    no-outputs → null (the caller falls back to audio).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MidiNoteEvent } from "@battuta/api";
import { MidiSink, NOTE_ON, NOTE_OFF } from "../src/host/midiSink";
import { HostMidiService, webMidiBackend, shellMidiBackend, noMidiBackend, parseNoteMessage, type WebMidiAccess, type WebMidiInput } from "../src/host/midi";

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

  it("send() is immediate and tracked; close() panics, then releases the backend once", () => {
    const sent: number[][] = [];
    const release = vi.fn();
    const sink = new MidiSink(["fake"], (d) => sent.push(d), release);
    sink.send([NOTE_ON, 62, 90]);
    expect(sent).toEqual([[NOTE_ON, 62, 90]]);
    sink.close();
    expect(sent.slice(1)).toEqual([
      [NOTE_OFF, 62, 0],
      [0xb0, 123, 0],
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("parseNoteMessage", () => {
  it("reads note on, note off, and running-status off (velocity 0); ignores the rest", () => {
    expect(parseNoteMessage([0x90, 60, 100])).toEqual({ note: 60, on: true, velocity: 100 });
    expect(parseNoteMessage([0x91, 60, 100])).toEqual({ note: 60, on: true, velocity: 100 }); // any channel
    expect(parseNoteMessage([0x80, 60, 64])).toEqual({ note: 60, on: false, velocity: 0 });
    expect(parseNoteMessage([0x90, 60, 0])).toEqual({ note: 60, on: false, velocity: 0 });
    expect(parseNoteMessage([0xb0, 7, 100])).toBeNull(); // control change
    expect(parseNoteMessage(null)).toBeNull();
  });
});

/** A fake Web MIDI access object with mutable port maps and a way to press keys. */
function fakeAccess(inputNames: string[], outputNames: string[] = []) {
  const inputs = new Map<string, WebMidiInput & { press(note: number, on?: boolean): void }>();
  inputNames.forEach((name, i) => {
    const port = {
      name,
      onmidimessage: null as WebMidiInput["onmidimessage"],
      press(note: number, on = true) {
        port.onmidimessage?.({ data: [on ? 0x90 : 0x80, note, on ? 100 : 0] });
      },
    };
    inputs.set(`in${i}`, port);
  });
  const sent: { port: string; data: number[] }[] = [];
  const outputs = new Map(outputNames.map((name, i) => [`out${i}`, { name, send: (d: number[]) => sent.push({ port: name, data: d }) }]));
  const access: WebMidiAccess = { inputs, outputs, onstatechange: null };
  return { access, inputs, sent, nav: { requestMIDIAccess: () => Promise.resolve(access) } };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("the Web MIDI backend", () => {
  it("dedupes inputs by name, DETACHES the duplicate port, and delivers notes with the device as source", async () => {
    const { nav, inputs } = fakeAccess(["Keys", "Keys", "Pad"]);
    const service = new HostMidiService(webMidiBackend(nav));
    const notes: MidiNoteEvent[] = [];
    service.onNote((e) => notes.push(e));
    service.start();
    await flush();
    expect(service.inputs.get()).toEqual([
      { name: "Keys", virtual: false },
      { name: "Pad", virtual: false },
    ]);
    inputs.get("in0")!.press(60);
    inputs.get("in1")!.press(60); // the duplicate: detached, so nothing arrives
    inputs.get("in2")!.press(64, false);
    expect(notes).toEqual([
      { note: 60, on: true, velocity: 100, source: "Keys" },
      { note: 64, on: false, velocity: 0, source: "Pad" },
    ]);
    expect(inputs.get("in1")!.onmidimessage).toBeNull();
  });

  it("hot-plug: onstatechange re-attaches and republishes the list", async () => {
    const { nav, access, inputs } = fakeAccess(["Keys"]);
    const service = new HostMidiService(webMidiBackend(nav));
    service.start();
    await flush();
    const plugged = { name: "Pedal", onmidimessage: null as WebMidiInput["onmidimessage"], press: () => undefined };
    inputs.set("in9", plugged);
    access.onstatechange!();
    expect(service.inputs.get().map((p) => p.name)).toEqual(["Keys", "Pedal"]);
    expect(plugged.onmidimessage).not.toBeNull();
  });

  it("a denied request reports no devices; stop() before the grant attaches nothing", async () => {
    const denied = new HostMidiService(webMidiBackend({ requestMIDIAccess: () => Promise.reject(new Error("denied")) }));
    denied.start();
    await flush();
    expect(denied.inputs.get()).toEqual([]);

    const { nav, inputs } = fakeAccess(["Keys"]);
    const stopped = new HostMidiService(webMidiBackend(nav));
    stopped.start()();
    await flush();
    expect(inputs.get("in0")!.onmidimessage).toBeNull();
    expect(stopped.inputs.get()).toEqual([]);
  });

  it("opens Web MIDI outputs deduped by name and sends to each DEVICE once", async () => {
    const { nav, sent } = fakeAccess([], ["Synth", "Synth", "Sampler"]);
    const service = new HostMidiService(webMidiBackend(nav));
    const outs = (await service.openOutputs())!;
    expect(outs.names).toEqual(["Synth", "Sampler"]);
    outs.schedule([NOTE_ON, 60, 102], 0);
    vi.advanceTimersByTime(1);
    expect(sent.map((s) => s.port)).toEqual(["Synth", "Sampler"]);
  });

  it("no outputs → null (the caller falls back to audio)", async () => {
    const { nav } = fakeAccess([]);
    expect(await new HostMidiService(webMidiBackend(nav)).openOutputs()).toBeNull();
  });
});

describe("the shell backend", () => {
  it("listens to the two bridge events, and stop() unlistens", async () => {
    const handlers = new Map<string, (e: { payload: unknown }) => void>();
    const unlisten = vi.fn();
    const service = new HostMidiService(
      shellMidiBackend({
        listen: (ev, cb) => {
          handlers.set(ev, cb);
          return Promise.resolve(unlisten);
        },
        invoke: () => Promise.resolve(undefined),
      }),
    );
    const notes: MidiNoteEvent[] = [];
    service.onNote((e) => notes.push(e));
    const stop = service.start();
    handlers.get("midi-devices")!({ payload: ["Test Piano (fake)"] });
    handlers.get("midi-devices")!({ payload: ["Test Piano (fake)"] }); // the 2s re-emit
    handlers.get("midi-note")!({ payload: [60, true] });
    handlers.get("midi-note")!({ payload: [60, false] });
    expect(service.inputs.get()).toEqual([{ name: "Test Piano (fake)", virtual: false }]);
    expect(notes).toEqual([
      { note: 60, on: true, velocity: 100, source: "shell" },
      { note: 60, on: false, velocity: 0, source: "shell" },
    ]);
    stop();
    await flush();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it("opens outputs through the three commands; close() retracts the virtual source", async () => {
    const calls: [string, unknown][] = [];
    const service = new HostMidiService(
      shellMidiBackend({
        listen: () => Promise.resolve(() => undefined),
        invoke: (cmd, args) => {
          calls.push([cmd, args]);
          return Promise.resolve(cmd === "midi_open_outputs" ? ["IAC Bus"] : undefined);
        },
      }),
    );
    const outs = (await service.openOutputs())!;
    expect(outs.names).toEqual(["IAC Bus"]);
    outs.schedule([NOTE_ON, 60, 102], 0);
    vi.advanceTimersByTime(1);
    outs.close();
    expect(calls.map(([c]) => c)).toEqual(["midi_open_outputs", "midi_send", "midi_send", "midi_send", "midi_close_outputs"]);
    expect(calls[1]).toEqual(["midi_send", { data: [NOTE_ON, 60, 102] }]);
    expect(calls[2]).toEqual(["midi_send", { data: [NOTE_OFF, 60, 0] }]); // the panic released it
  });

  it("no bridge outputs → null", async () => {
    const service = new HostMidiService(shellMidiBackend({ listen: () => Promise.resolve(() => undefined), invoke: () => Promise.resolve([]) }));
    expect(await service.openOutputs()).toBeNull();
  });
});

describe("the service", () => {
  it("virtual inputs are listed after hardware, feed the same stream, and unlist on dispose", () => {
    const service = new HostMidiService(noMidiBackend);
    const notes: MidiNoteEvent[] = [];
    service.onNote((e) => notes.push(e));
    service.start();
    service.injectDevices(["Keys"]);
    const piano = service.registerInput("on-screen piano");
    expect(service.inputs.get()).toEqual([
      { name: "Keys", virtual: false },
      { name: "on-screen piano", virtual: true },
    ]);
    piano.noteOn(60);
    piano.noteOff(60);
    expect(notes).toEqual([
      { note: 60, on: true, velocity: 100, source: "on-screen piano" },
      { note: 60, on: false, velocity: 0, source: "on-screen piano" },
    ]);
    piano.dispose();
    piano.noteOn(62); // a disposed input is silent
    expect(notes).toHaveLength(2);
    expect(service.inputs.get()).toEqual([{ name: "Keys", virtual: false }]);
  });

  it("injectDevices republishes only on a real change; onNote disposables detach", () => {
    const service = new HostMidiService(noMidiBackend);
    let publications = 0;
    service.inputs.subscribe(() => publications++);
    service.injectDevices(["A", "B"]);
    service.injectDevices(["A", "B"]);
    service.injectDevices(["A"]);
    expect(publications).toBe(2);
    const heard: number[] = [];
    const d = service.onNote((e) => heard.push(e.note));
    const v = service.registerInput("v");
    v.noteOn(1);
    d.dispose();
    v.noteOn(2);
    expect(heard).toEqual([1]);
  });

  it("with no backend there are no devices and no outputs", async () => {
    const service = new HostMidiService(noMidiBackend);
    service.start();
    expect(service.inputs.get()).toEqual([]);
    expect(await service.openOutputs()).toBeNull();
  });
});
