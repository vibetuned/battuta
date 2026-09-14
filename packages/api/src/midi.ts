/**
 * The MIDI host service — the first "platform capability with a browser
 * backend and a shell backend, consumed by features" to live in the host
 * rather than in a plugin. Web MIDI in browsers, the midir bridge in the
 * Tauri shell; plugins see one interface and never ask which.
 *
 * Inputs are deduped by port name (some drivers register a device twice)
 * and hot-plugged. A plugin may register a VIRTUAL input — the on-screen
 * piano is one — so every input surface feeds the same note stream the
 * entry path listens to, and nobody asks whether "the MIDI plugin" is
 * installed. Outputs open all at once; the handle schedules sends on the
 * performance.now() clock and its panic() releases everything sounding.
 */
import type { Disposable } from "./disposable.js";
import type { Store } from "./context.js";

/** An input port. Virtual ones were registered by the host or a plugin, not enumerated from hardware. */
export interface MidiPort {
  name: string;
  virtual: boolean;
}

/** One note on/off from any input; `source` is the port name. */
export interface MidiNoteEvent {
  note: number;
  on: boolean;
  /** 0 for an off. */
  velocity: number;
  source: string;
}

/** A software input the service treats like a device. Dispose to unregister. */
export interface MidiVirtualInput extends Disposable {
  readonly name: string;
  noteOn(note: number, velocity?: number): void;
  noteOff(note: number): void;
}

/** Every output port, opened together. Sends go to all of them. */
export interface MidiOutputs {
  /** Deduped port names (for notices). */
  readonly names: readonly string[];
  /** Send at `atMs` on the performance.now() clock; past times send now. */
  schedule(data: number[], atMs: number): void;
  /** Send now. */
  send(data: number[]): void;
  /** Cancel every pending send and release every sounding note (note-offs + CC 123). */
  panic(): void;
  /** panic() and release the ports (the shell retracts its virtual source). */
  close(): void;
}

export interface MidiService {
  /** Hardware inputs (deduped, hot-plugged) followed by registered virtual inputs. */
  readonly inputs: Store<readonly MidiPort[]>;
  /** Every note on/off from every input, hardware or virtual. */
  onNote(listener: (event: MidiNoteEvent) => void): Disposable;
  /** Add an input the service will report and route like a device. */
  registerInput(name: string): MidiVirtualInput;
  /** Open every available output; null when there is none (callers fall back to audio). */
  openOutputs(): Promise<MidiOutputs | null>;
}
