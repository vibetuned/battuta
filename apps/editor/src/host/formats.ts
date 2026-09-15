/**
 * The `formats` point, export half (slice 7a, 2026-09-15): the registry
 * behind the battuta menu's export rows and `ctx.formats.registerExport`.
 * Slice 8 adds the import half here.
 *
 * Two kinds of export live in it, as with lanes. An INTERNAL one is
 * registered by the App itself with its producer (the Verovio-backed
 * exports, and the playback-MIDI export until 7b moves it) and needs no
 * manifest. A DECLARED one comes from a plugin's manifest
 * (`contributes.exports`): the menu lists it before the plugin's code
 * loads, and producing it wakes the plugin with `onFormat:<id>` when no
 * producer is registered yet — an entry point cannot come from the code
 * it loads. The App owns the SAVE path (download or the shell's dialog);
 * this store owns who produces what.
 */
import { toDisposable, type Disposable, type ExportContribution, type ExportPayload } from "@battuta/api";
import { createStore, type WritableStore } from "./store";

/** A manifest-declared export, with the plugin it came from. */
export interface DeclaredExport extends ExportContribution {
  pluginId: string;
}

/** One menu row: internal exports first, then declared ones, in order. */
export type ExportOption = ExportContribution;

export type Producer = () => Promise<ExportPayload>;

export interface FormatsDeps {
  /** Wake the plugin that declared an export, with `onFormat:<id>` as the reason. */
  activate(exportId: string, pluginId: string): Promise<boolean>;
}

export class ExportStore {
  private readonly declared = new Map<string, DeclaredExport>();
  private readonly internal: ExportContribution[] = [];
  private readonly producers = new Map<string, Producer>();
  /** What the menu lists. */
  readonly exports: WritableStore<readonly ExportOption[]> = createStore<readonly ExportOption[]>([]);

  constructor(private readonly deps: FormatsDeps) {}

  /** An export declared in a manifest. Refused when another plugin (or the host) already has the id. */
  declare(entry: DeclaredExport): Disposable {
    const owner = this.declared.get(entry.id)?.pluginId;
    if ((owner !== undefined && owner !== entry.pluginId) || this.internal.some((e) => e.id === entry.id)) throw new Error(`export ${entry.id} is already declared by ${owner ?? "the host"}`);
    this.declared.set(entry.id, entry);
    this.publish();
    return toDisposable(() => {
      if (this.declared.get(entry.id) !== entry) return;
      this.declared.delete(entry.id);
      this.producers.delete(entry.id);
      this.publish();
    });
  }

  /** The host's own export, with its producer; no manifest. */
  register(entry: ExportContribution, produce: Producer): Disposable {
    const owner = this.declared.get(entry.id)?.pluginId;
    if (owner !== undefined) throw new Error(`export ${entry.id} is already declared by ${owner}`);
    const at = this.internal.findIndex((e) => e.id === entry.id);
    if (at >= 0) this.internal[at] = entry;
    else this.internal.push(entry);
    this.producers.set(entry.id, produce);
    this.publish();
    return toDisposable(() => {
      if (this.producers.get(entry.id) !== produce) return;
      this.producers.delete(entry.id);
      const i = this.internal.findIndex((e) => e.id === entry.id);
      if (i >= 0) this.internal.splice(i, 1);
      this.publish();
    });
  }

  /** A plugin's producer for an export it declared (the context checks the manifest; this is the second lock). */
  registerExport(id: string, produce: Producer, pluginId: string): Disposable {
    if (this.declared.get(id)?.pluginId !== pluginId) throw new Error(`plugin ${pluginId} did not declare export ${id} in its manifest`);
    this.producers.set(id, produce);
    return toDisposable(() => {
      if (this.producers.get(id) === produce) this.producers.delete(id);
    });
  }

  infoOf(id: string): ExportOption | undefined {
    return this.internal.find((e) => e.id === id) ?? this.declared.get(id);
  }

  /**
   * Produce an export. A declared one with no producer yet wakes its
   * plugin first (`onFormat:<id>`) and asks again once. Rejects for an
   * unknown id, and when the plugin registered nothing.
   */
  async produce(id: string): Promise<ExportPayload> {
    let producer = this.producers.get(id);
    if (!producer) {
      const entry = this.declared.get(id);
      if (!entry) throw new Error(`unknown export ${id}`);
      await this.deps.activate(id, entry.pluginId);
      producer = this.producers.get(id);
      if (!producer) throw new Error(`${entry.label}: its plugin registered no export`);
    }
    return producer();
  }

  private publish(): void {
    const out: ExportOption[] = [...this.internal];
    for (const d of this.declared.values()) {
      const { pluginId: _owner, ...entry } = d;
      out.push(entry);
    }
    this.exports.set(out);
  }
}
