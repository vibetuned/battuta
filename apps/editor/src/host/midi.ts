/**
 * The MIDI host service: `MidiService` from @battuta/api, implemented over
 * one of two backends.
 *
 *   - Web MIDI (browsers): `requestMIDIAccess`, inputs deduped by name —
 *     some drivers (seen on Windows) register one device as TWO ports and
 *     attaching both fires every note twice; the first port per name wins
 *     and the duplicates are DETACHED, not just unlisted — hot-plug through
 *     `onstatechange`, outputs deduped the same way.
 *   - The shell (WKWebView/WebKitGTK have no Web MIDI): the Rust side
 *     bridges midir over Tauri events ("midi-devices", "midi-note") and
 *     three commands for outputs (`midi_open_outputs`, `midi_send`,
 *     `midi_close_outputs` — the last retracts the virtual "battuta" source
 *     the shell publishes for apps that listen to sources).
 *
 * The service adds what neither backend has: the note stream every
 * consumer listens to (the entry path today, plugins tomorrow), virtual
 * inputs that feed the same stream (the on-screen piano, the e2e hook),
 * and the outputs handle with its panic guarantee (host/midiSink.ts).
 * Virtual inputs are listed as `virtual: true`; the status-bar indicator
 * counts hardware only, so opening the on-screen keyboard never reads as
 * a connected device.
 */
import { toDisposable, type Disposable, type MidiNoteEvent, type MidiOutputs, type MidiPort, type MidiService, type MidiVirtualInput } from "@battuta/api";
import { MidiSink } from "./midiSink";
import { createStore, type WritableStore } from "./store";

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

export interface MidiDelivery {
  /** The hardware input names, deduped, in port order. */
  devices(names: string[]): void;
  note(note: number, on: boolean, velocity: number, source: string): void;
}

export interface OpenedOutputs {
  names: string[];
  transmit(data: number[]): void;
  release(): void;
}

export interface MidiBackend {
  /** Start delivering devices and notes; returns the stop function. */
  start(deliver: MidiDelivery): () => void;
  openOutputs(): Promise<OpenedOutputs | null>;
}

/** Nothing available (node, or a browser without Web MIDI outside the shell). */
export const noMidiBackend: MidiBackend = {
  start: (deliver) => {
    deliver.devices([]);
    return () => undefined;
  },
  openOutputs: async () => null,
};

// --- Web MIDI ------------------------------------------------------------

export interface WebMidiInput {
  name?: string | null;
  onmidimessage: ((e: { data: Uint8Array | number[] | null }) => void) | null;
}
export interface WebMidiOutput {
  name?: string | null;
  send(data: number[]): void;
}
export interface WebMidiAccess {
  inputs: Map<string, WebMidiInput>;
  outputs: Map<string, WebMidiOutput>;
  onstatechange: (() => void) | null;
}
export interface WebMidiNavigator {
  requestMIDIAccess(): Promise<WebMidiAccess>;
}

/** Parse a 3-byte channel message into a note event, or null when it is not one. */
export function parseNoteMessage(d: ArrayLike<number> | null): { note: number; on: boolean; velocity: number } | null {
  if (!d) return null;
  const status = (d[0] ?? 0) & 0xf0;
  const note = d[1] ?? 0;
  const velocity = d[2] ?? 0;
  if (status === NOTE_ON && velocity > 0) return { note, on: true, velocity };
  if (status === NOTE_OFF || (status === NOTE_ON && velocity === 0)) return { note, on: false, velocity: 0 };
  return null;
}

/** Deduped by name; the first port per name wins. */
const dedupe = <T extends { name?: string | null }>(ports: Iterable<T>, fallback: string): { kept: T[]; dropped: T[] } => {
  const seen = new Set<string>();
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const p of ports) {
    const name = p.name || fallback;
    if (seen.has(name)) dropped.push(p);
    else {
      seen.add(name);
      kept.push(p);
    }
  }
  return { kept, dropped };
};

export function webMidiBackend(nav: WebMidiNavigator): MidiBackend {
  return {
    start(deliver) {
      let closed = false;
      nav
        .requestMIDIAccess()
        .then((access) => {
          if (closed) return;
          const attach = () => {
            const { kept, dropped } = dedupe(access.inputs.values(), "device");
            for (const input of dropped) input.onmidimessage = null;
            for (const input of kept) {
              const source = input.name || "device";
              input.onmidimessage = (e) => {
                const n = parseNoteMessage(e.data);
                if (n) deliver.note(n.note, n.on, n.velocity, source);
              };
            }
            deliver.devices(kept.map((i) => i.name || "device"));
          };
          attach();
          access.onstatechange = attach; // hot-plug: (re)attach and republish
        })
        .catch(() => deliver.devices([]));
      return () => {
        closed = true;
      };
    },
    async openOutputs() {
      try {
        const access = await nav.requestMIDIAccess();
        const { kept } = dedupe(access.outputs.values(), "output");
        if (kept.length === 0) return null;
        return {
          names: kept.map((o) => o.name || "output"),
          transmit: (data) => {
            for (const o of kept) o.send(data);
          },
          release: () => undefined, // Web MIDI ports have nothing to give back
        };
      } catch {
        return null;
      }
    },
  };
}

// --- The shell bridge ----------------------------------------------------

export interface ShellMidiBridge {
  listen(event: string, cb: (e: { payload: unknown }) => void): Promise<() => void>;
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

export function shellMidiBackend(shell: ShellMidiBridge): MidiBackend {
  return {
    start(deliver) {
      const subs = [
        shell.listen("midi-note", (e) => {
          const [note, on] = e.payload as [number, boolean];
          deliver.note(note, on, on ? 100 : 0, "shell");
        }),
        shell.listen("midi-devices", (e) => deliver.devices(e.payload as string[])),
      ];
      return () => {
        for (const s of subs) void s.then((un) => un()).catch(() => undefined);
      };
    },
    async openOutputs() {
      try {
        const names = (await shell.invoke("midi_open_outputs")) as string[];
        if (!Array.isArray(names) || names.length === 0) return null;
        return {
          names,
          transmit: (data) => void shell.invoke("midi_send", { data }).catch(() => undefined),
          release: () => void shell.invoke("midi_close_outputs").catch(() => undefined),
        };
      } catch {
        return null;
      }
    },
  };
}

/** Web MIDI where the browser has it, the bridge inside the shell, nothing otherwise. */
export function detectMidiBackend(): MidiBackend {
  if (typeof navigator !== "undefined" && "requestMIDIAccess" in navigator) return webMidiBackend(navigator as unknown as WebMidiNavigator);
  if (typeof window !== "undefined") {
    const t = (window as unknown as { __TAURI__?: { event?: { listen?: ShellMidiBridge["listen"] }; core?: { invoke?: ShellMidiBridge["invoke"] } } }).__TAURI__;
    if (t?.event?.listen && t.core?.invoke) return shellMidiBackend({ listen: t.event.listen, invoke: t.core.invoke });
  }
  return noMidiBackend;
}

// --- The service -----------------------------------------------------------

export class HostMidiService implements MidiService {
  readonly inputs: WritableStore<readonly MidiPort[]> = createStore<readonly MidiPort[]>([]);
  private hardware: string[] = [];
  private readonly virtuals: string[] = [];
  private readonly listeners = new Set<(e: MidiNoteEvent) => void>();
  private stopBackend: (() => void) | null = null;

  constructor(private readonly backend: MidiBackend) {}

  /** Begin enumerating and listening; idempotent. Returns the stop function. */
  start(): () => void {
    if (!this.stopBackend) {
      this.stopBackend = this.backend.start({
        devices: (names) => this.setHardware(names),
        note: (note, on, velocity, source) => this.emit({ note, on, velocity, source }),
      });
    }
    return () => this.stop();
  }

  stop(): void {
    this.stopBackend?.();
    this.stopBackend = null;
    this.setHardware([]);
  }

  onNote(listener: (event: MidiNoteEvent) => void): Disposable {
    this.listeners.add(listener);
    return toDisposable(() => this.listeners.delete(listener));
  }

  registerInput(name: string): MidiVirtualInput {
    this.virtuals.push(name);
    this.publish();
    let live = true;
    return {
      name,
      noteOn: (note, velocity = 100) => {
        if (live) this.emit({ note, on: true, velocity, source: name });
      },
      noteOff: (note) => {
        if (live) this.emit({ note, on: false, velocity: 0, source: name });
      },
      dispose: () => {
        if (!live) return;
        live = false;
        const i = this.virtuals.indexOf(name);
        if (i >= 0) this.virtuals.splice(i, 1);
        this.publish();
      },
    };
  }

  async openOutputs(): Promise<MidiOutputs | null> {
    const opened = await this.backend.openOutputs();
    if (!opened) return null;
    return new MidiSink(opened.names, opened.transmit, opened.release);
  }

  /** Test seam: the e2e scripts set the hardware list without devices (`__MIDI_DEVS__`). */
  injectDevices(names: string[]): void {
    this.setHardware(names);
  }

  private setHardware(names: string[]): void {
    // the shell re-emits every 2s: only republish on a real change
    if (names.length === this.hardware.length && names.every((n, i) => n === this.hardware[i])) return;
    this.hardware = [...names];
    this.publish();
  }

  private publish(): void {
    this.inputs.set([...this.hardware.map((name) => ({ name, virtual: false })), ...this.virtuals.map((name) => ({ name, virtual: true }))]);
  }

  private emit(event: MidiNoteEvent): void {
    for (const l of [...this.listeners]) l(event);
  }
}
