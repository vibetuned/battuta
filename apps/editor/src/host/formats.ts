/**
 * The `formats` point — both halves (exports since slice 7a, imports since
 * 8a, 2026-09-15): the registry behind the battuta menu's export rows, the
 * open dialog's accept list and the open path's detection, and behind
 * `ctx.formats.registerExport` / `registerImport`.
 *
 * Two kinds of entry live in it, as with lanes. An INTERNAL one is
 * registered by the App itself with its producer or converter and needs no
 * manifest. A DECLARED one comes from a plugin's manifest
 * (`contributes.exports`, `contributes.imports`): the menu lists the export
 * and the open dialog accepts the import's extensions before the plugin's
 * code loads, and producing or converting wakes the plugin with
 * `onFormat:<id>` when nothing is registered yet — an entry point cannot
 * come from the code it loads. The App owns the SAVE path (download or the
 * shell's dialog) and the OPEN path (the new tab); this store owns who
 * produces and who converts, and what a file name means.
 */
import { toDisposable, type Disposable, type ExportContribution, type ExportPayload, type ImportContribution, type ImportFile } from "@battuta/api";
import { createStore, type WritableStore } from "./store";

/** A manifest-declared export, with the plugin it came from. */
export interface DeclaredExport extends ExportContribution {
  pluginId: string;
}

/** A manifest-declared import, with the plugin it came from. */
export interface DeclaredImport extends ImportContribution {
  pluginId: string;
}

/** One menu row: internal exports first, then declared ones, in order. */
export type ExportOption = ExportContribution;
/** One import the open path knows: internal first, then declared. */
export type ImportOption = ImportContribution;

export type Producer = () => Promise<ExportPayload>;
export type Converter = (file: ImportFile) => Promise<string>;

export interface FormatsDeps {
  /** Wake the plugin that declared an export or import, with `onFormat:<id>` as the reason. */
  activate(formatId: string, pluginId: string): Promise<boolean>;
}

const extOf = (filename: string): string => filename.toLowerCase().split(/[\\/]/).pop()?.split(".").pop() ?? "";

export class FormatStore {
  private readonly declaredExports = new Map<string, DeclaredExport>();
  private readonly internalExports: ExportContribution[] = [];
  private readonly producers = new Map<string, Producer>();
  private readonly declaredImports = new Map<string, DeclaredImport>();
  private readonly internalImports: ImportContribution[] = [];
  private readonly converters = new Map<string, Converter>();
  /** What the menu lists. */
  readonly exports: WritableStore<readonly ExportOption[]> = createStore<readonly ExportOption[]>([]);
  /** Every import the open path knows, internal first. */
  readonly imports: WritableStore<readonly ImportOption[]> = createStore<readonly ImportOption[]>([]);
  /** What the open dialog accepts: `mei`, then every import's extensions, once each. */
  readonly openExtensions: WritableStore<readonly string[]> = createStore<readonly string[]>(["mei"]);

  constructor(private readonly deps: FormatsDeps) {}

  // ---------------------------------------------------------------- exports

  /** An export declared in a manifest. Refused when another plugin (or the host) already has the id. */
  declare(entry: DeclaredExport): Disposable {
    const owner = this.declaredExports.get(entry.id)?.pluginId;
    if ((owner !== undefined && owner !== entry.pluginId) || this.internalExports.some((e) => e.id === entry.id)) throw new Error(`export ${entry.id} is already declared by ${owner ?? "the host"}`);
    this.declaredExports.set(entry.id, entry);
    this.publishExports();
    return toDisposable(() => {
      if (this.declaredExports.get(entry.id) !== entry) return;
      this.declaredExports.delete(entry.id);
      this.producers.delete(entry.id);
      this.publishExports();
    });
  }

  /** The host's own export, with its producer; no manifest. */
  register(entry: ExportContribution, produce: Producer): Disposable {
    const owner = this.declaredExports.get(entry.id)?.pluginId;
    if (owner !== undefined) throw new Error(`export ${entry.id} is already declared by ${owner}`);
    const at = this.internalExports.findIndex((e) => e.id === entry.id);
    if (at >= 0) this.internalExports[at] = entry;
    else this.internalExports.push(entry);
    this.producers.set(entry.id, produce);
    this.publishExports();
    return toDisposable(() => {
      if (this.producers.get(entry.id) !== produce) return;
      this.producers.delete(entry.id);
      const i = this.internalExports.findIndex((e) => e.id === entry.id);
      if (i >= 0) this.internalExports.splice(i, 1);
      this.publishExports();
    });
  }

  /** A plugin's producer for an export it declared (the context checks the manifest; this is the second lock). */
  registerExport(id: string, produce: Producer, pluginId: string): Disposable {
    if (this.declaredExports.get(id)?.pluginId !== pluginId) throw new Error(`plugin ${pluginId} did not declare export ${id} in its manifest`);
    this.producers.set(id, produce);
    return toDisposable(() => {
      if (this.producers.get(id) === produce) this.producers.delete(id);
    });
  }

  infoOf(id: string): ExportOption | undefined {
    return this.internalExports.find((e) => e.id === id) ?? this.declaredExports.get(id);
  }

  /**
   * Produce an export. A declared one with no producer yet wakes its
   * plugin first (`onFormat:<id>`) and asks again once. Rejects for an
   * unknown id, and when the plugin registered nothing.
   */
  async produce(id: string): Promise<ExportPayload> {
    let producer = this.producers.get(id);
    if (!producer) {
      const entry = this.declaredExports.get(id);
      if (!entry) throw new Error(`unknown export ${id}`);
      await this.deps.activate(id, entry.pluginId);
      producer = this.producers.get(id);
      if (!producer) throw new Error(`${entry.label}: its plugin registered no export`);
    }
    return producer();
  }

  // ---------------------------------------------------------------- imports

  /** An import declared in a manifest. Refused when another plugin (or the host) already has the id. */
  declareImport(entry: DeclaredImport): Disposable {
    const owner = this.declaredImports.get(entry.id)?.pluginId;
    if ((owner !== undefined && owner !== entry.pluginId) || this.internalImports.some((e) => e.id === entry.id)) throw new Error(`import ${entry.id} is already declared by ${owner ?? "the host"}`);
    this.declaredImports.set(entry.id, entry);
    this.publishImports();
    return toDisposable(() => {
      if (this.declaredImports.get(entry.id) !== entry) return;
      this.declaredImports.delete(entry.id);
      this.converters.delete(entry.id);
      this.publishImports();
    });
  }

  /** The host's own import, with its converter; no manifest. */
  registerImport(entry: ImportContribution, convert: Converter): Disposable {
    const owner = this.declaredImports.get(entry.id)?.pluginId;
    if (owner !== undefined) throw new Error(`import ${entry.id} is already declared by ${owner}`);
    const at = this.internalImports.findIndex((e) => e.id === entry.id);
    if (at >= 0) this.internalImports[at] = entry;
    else this.internalImports.push(entry);
    this.converters.set(entry.id, convert);
    this.publishImports();
    return toDisposable(() => {
      if (this.converters.get(entry.id) !== convert) return;
      this.converters.delete(entry.id);
      const i = this.internalImports.findIndex((e) => e.id === entry.id);
      if (i >= 0) this.internalImports.splice(i, 1);
      this.publishImports();
    });
  }

  /** A plugin's converter for an import it declared (the context checks the manifest; this is the second lock). */
  provideImport(id: string, convert: Converter, pluginId: string): Disposable {
    if (this.declaredImports.get(id)?.pluginId !== pluginId) throw new Error(`plugin ${pluginId} did not declare import ${id} in its manifest`);
    this.converters.set(id, convert);
    return toDisposable(() => {
      if (this.converters.get(id) === convert) this.converters.delete(id);
    });
  }

  importInfo(id: string): ImportOption | undefined {
    return this.internalImports.find((e) => e.id === id) ?? this.declaredImports.get(id);
  }

  /** How the open path must read a file of this import: as text, or as bytes for a `binary` format (a zip). */
  readAs(id: string): "text" | "bytes" {
    return this.importInfo(id)?.binary ? "bytes" : "text";
  }

  /** The extensions that must be read as bytes — for the shell's dialog, which reads the file itself. */
  binaryExtensions(): string[] {
    return this.allImports()
      .filter((i) => i.binary)
      .flatMap((i) => i.exts);
  }

  /**
   * What an opened file is: "mei" (the native path), an import id, or null
   * for an extension nothing claims. `.xml` is MEI's other extension and
   * MusicXML's too, so it is MEI unless an import claiming `xml` declares
   * `roots` and the content's root element is one of them; without content
   * it stays MEI (the historical default). Detection is the host's: a
   * plugin declares extensions and roots, never a sniffer.
   */
  detect(filename: string, content?: string): "mei" | string | null {
    const e = extOf(filename);
    if (e === "mei") return "mei";
    const candidates = this.allImports().filter((i) => i.exts.includes(e));
    if (e === "xml") {
      if (content) {
        for (const c of candidates) {
          if (c.roots?.length && new RegExp(`<(${c.roots.join("|")})[\\s>]`).test(content)) return c.id;
        }
      }
      return "mei";
    }
    const plain = candidates.find((c) => !c.roots?.length) ?? candidates[0];
    return plain ? plain.id : null;
  }

  /**
   * Convert a file to MEI through the import's converter. A declared
   * import with no converter yet wakes its plugin first (`onFormat:<id>`)
   * and asks again once. Rejects for an unknown id, and when the plugin
   * registered nothing.
   */
  async importFile(id: string, file: ImportFile): Promise<string> {
    let convert = this.converters.get(id);
    if (!convert) {
      const entry = this.declaredImports.get(id);
      if (!entry) throw new Error(`unknown import ${id}`);
      await this.deps.activate(id, entry.pluginId);
      convert = this.converters.get(id);
      if (!convert) throw new Error(`${entry.label}: its plugin registered no converter`);
    }
    return convert(file);
  }

  private allImports(): ImportContribution[] {
    return [...this.internalImports, ...this.declaredImports.values()];
  }

  private publishExports(): void {
    const out: ExportOption[] = [...this.internalExports];
    for (const d of this.declaredExports.values()) {
      const { pluginId: _owner, ...entry } = d;
      out.push(entry);
    }
    this.exports.set(out);
  }

  private publishImports(): void {
    const all = this.allImports();
    this.imports.set(all.map((i) => ("pluginId" in i ? (({ pluginId: _o, ...rest }) => rest)(i as DeclaredImport) : i)));
    const exts = ["mei"];
    for (const i of all) for (const x of i.exts) if (!exts.includes(x)) exts.push(x);
    this.openExtensions.set(exts);
  }
}
