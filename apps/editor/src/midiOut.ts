/**
 * MIDI OUTPUT sink for playback: when the page view's MIDI box is
 * checked, the player sends note on/off to every connected MIDI output
 * (each one is some synth's input) instead of the built-in piano.
 *
 * Browsers use Web MIDI outputs; the shell bridges midir outputs over
 * two commands (WKWebView/WebKitGTK have no Web MIDI). Both paths share
 * this class: events are scheduled with plain timers (a few ms of
 * jitter, fine for MIDI), every sounding note is tracked, and panic()
 * cancels what is pending and RELEASES what is sounding — pause, seek,
 * tempo changes and stop must never leave a note hanging on an
 * external synth.
 */

export const NOTE_ON = 0x90;
export const NOTE_OFF = 0x80;
const ALL_NOTES_OFF = [0xb0, 123, 0];

export class MidiSink {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private sounding = new Set<number>();

  constructor(
    /** Deduped names of the ports being sent to (HUD/notice text). */
    readonly outputs: string[],
    private readonly transmit: (data: number[]) => void,
  ) {}

  /** Send at `atMs` (performance.now() clock); past times send now. */
  schedule(data: number[], atMs: number): void {
    const delay = Math.max(0, atMs - performance.now());
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.track(data);
      this.transmit(data);
    }, delay);
    this.timers.add(t);
  }

  private track(data: number[]): void {
    const [status, pitch, velocity] = data;
    if (status === undefined || pitch === undefined) return;
    if ((status & 0xf0) === NOTE_ON && (velocity ?? 0) > 0) this.sounding.add(pitch);
    else if ((status & 0xf0) === NOTE_OFF || ((status & 0xf0) === NOTE_ON && velocity === 0)) this.sounding.delete(pitch);
  }

  /** Cancel everything pending and release everything sounding. */
  panic(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const pitch of this.sounding) this.transmit([NOTE_OFF, pitch, 0]);
    this.sounding.clear();
    this.transmit(ALL_NOTES_OFF); // belt and braces for anything missed
  }
}

interface WebMidiOutput {
  name: string | null;
  send(data: number[]): void;
}

/**
 * Open a sink over whatever this environment offers: Web MIDI outputs
 * where the API exists, else the shell's midir bridge. Returns null
 * when no output port is available — the caller falls back to audio.
 */
export async function openMidiSink(invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null): Promise<MidiSink | null> {
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<{ outputs: Map<string, WebMidiOutput> }> };
  if (nav.requestMIDIAccess) {
    try {
      const access = await nav.requestMIDIAccess();
      // Same driver quirk as inputs: dedupe ports by name.
      const seen = new Set<string>();
      const outs = [...access.outputs.values()].filter((o) => {
        const name = o.name || "output";
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      });
      if (outs.length === 0) return null;
      return new MidiSink(
        outs.map((o) => o.name || "output"),
        (data) => {
          for (const o of outs) o.send(data);
        },
      );
    } catch {
      return null;
    }
  }
  if (!invoke) return null;
  try {
    const names = (await invoke("midi_open_outputs")) as string[];
    if (!Array.isArray(names) || names.length === 0) return null;
    return new MidiSink(names, (data) => void invoke("midi_send", { data }).catch(() => undefined));
  } catch {
    return null;
  }
}
