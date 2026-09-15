/**
 * Main-thread handle on this plugin's conversion worker. The worker (and
 * its Humdrum-enabled Verovio, ≈12MB of WASM) is created on the FIRST
 * conversion and kept for the session — imports and exports after the
 * first are instant.
 *
 * The worker is the PLUGIN's, not a host service: `formats` hands a
 * converter a file and takes MEI back, and how the conversion happens —
 * a worker, a thread, a call — is nobody else's business. It is spawned
 * from a `new URL(…, import.meta.url)`, which the bundler emits as its
 * own asset reached only from here.
 */

interface Pending {
  resolve: (result: string) => void;
  reject: (err: Error) => void;
}

class Converter {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 0;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("./convertWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e) => {
      const msg = e.data as { type: string; id: number; result?: string; error?: string };
      if (msg.type !== "done") return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error !== undefined) p.reject(new Error(msg.error));
      else p.resolve(msg.result!);
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || "conversion worker failed");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null; // a fresh attempt gets a fresh worker
    };
    return this.worker;
  }

  private request(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<string> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ensure().postMessage({ ...msg, id }, transfer);
    });
  }

  /** Convert an imported file to MEI. `from` is Verovio's inputFrom (or "mxl"); `data` is text, or bytes for a zip. */
  toMEI(from: string, data: string | ArrayBuffer): Promise<string> {
    return typeof data === "string" ? this.request({ type: "import", from, text: data }) : this.request({ type: "import", from, bytes: data }, [data]);
  }

  /** Export MEI. midi returns base64; humdrum/pae return text. */
  fromMEI(to: "midi" | "humdrum" | "pae", mei: string): Promise<string> {
    return this.request({ type: "export", to, mei });
  }

  /**
   * The plugin was turned off: hand back the ≈12MB the toolkit is holding
   * and fail anything still in flight. `ensure()` spawns a fresh worker if
   * the plugin is turned on again, exactly as it does after an onerror.
   */
  dispose(): void {
    for (const p of this.pending.values()) p.reject(new Error("the formats plugin was turned off"));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}

export const converter = new Converter();
