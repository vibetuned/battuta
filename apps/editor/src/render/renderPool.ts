/**
 * Pool of Verovio render workers + tile cache.
 *
 * Tiles are cached by the core's cache key (context hash + content hash), so
 * an edit invalidates exactly the tiles whose key changed — including all
 * downstream tiles after a clef/key/meter change, whose context hash changes
 * with no special-case logic (DESIGN.md).
 */

export interface TileResult {
  svg: string;
  renderMs: number;
  cached: boolean;
  error?: string;
}

/** One timemap entry: what turns on/off at a real-time millisecond stamp. */
export interface TimemapEvent {
  tstamp: number;
  on?: string[];
  off?: string[];
  measureOn?: string;
}

/** Playback data for a document: timeline + sounding pitch per note id.
 * With repeats expanded, `idMap` sends each cloned pass id (`<id>-rendN`)
 * back to the notated id the SVG actually contains. */
export interface PlaybackData {
  events: TimemapEvent[];
  notes: Record<string, { pitch: number; duration: number }>;
  idMap: Record<string, string>;
  /** Ties + gates from the document (attached by the app, not the worker). */
  shaping?: { ties: Record<string, string>; gates: Record<string, number> };
  error?: string;
}

interface Job {
  xml: string;
  key: string;
  optionsJson: string;
  resolve: (r: TileResult) => void;
}

class PoolWorker {
  readonly worker: Worker;
  ready: Promise<void>;
  busy = false;
  private handlers = new Map<number, (msg: { svg: string; renderMs: number; error?: string }) => void>();
  private pageHandlers = new Map<number, { onPage: (index: number, svg: string) => void; done: (pageCount: number) => void }>();
  private timemapHandlers = new Map<number, (data: PlaybackData) => void>();

  constructor() {
    this.worker = new Worker(new URL("./verovioWorker.ts", import.meta.url), { type: "module" });
    this.worker.onerror = (e) => console.error("verovio worker error:", e.message);
    this.ready = new Promise((resolve) => {
      this.worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === "ready") resolve();
        else if (msg.type === "tile") {
          const h = this.handlers.get(msg.id);
          this.handlers.delete(msg.id);
          h?.(msg);
        } else if (msg.type === "page") {
          this.pageHandlers.get(msg.id)?.onPage(msg.index, msg.svg);
        } else if (msg.type === "pagesDone") {
          const h = this.pageHandlers.get(msg.id);
          this.pageHandlers.delete(msg.id);
          h?.done(msg.pageCount);
        } else if (msg.type === "timemapDone") {
          const h = this.timemapHandlers.get(msg.id);
          this.timemapHandlers.delete(msg.id);
          h?.({ events: msg.events, notes: msg.notes, idMap: msg.idMap ?? {}, ...(msg.error !== undefined && { error: msg.error }) });
        }
      };
      this.worker.postMessage({ type: "init" });
    });
  }

  renderTile(id: number, xml: string, optionsJson: string, onDone: (msg: { svg: string; renderMs: number; error?: string }) => void) {
    this.handlers.set(id, onDone);
    this.worker.postMessage({ type: "render", id, xml, optionsJson });
  }

  renderPages(id: number, xml: string, onPage: (index: number, svg: string) => void, done: (pageCount: number) => void) {
    this.pageHandlers.set(id, { onPage, done });
    this.worker.postMessage({ type: "renderPages", id, xml });
  }

  timemap(id: number, xml: string, expand: string | null, done: (data: PlaybackData) => void) {
    this.timemapHandlers.set(id, done);
    this.worker.postMessage({ type: "timemap", id, xml, ...(expand ? { expand } : {}) });
  }
}

const CACHE_MAX = 2000;

export class RenderPool {
  readonly size: number;
  private workers: PoolWorker[] = [];
  private queue: Job[] = [];
  private nextId = 0;
  private cache = new Map<string, string>(); // key -> svg (LRU by re-insertion)
  private inFlight = new Map<string, Promise<TileResult>>();
  hits = 0;
  misses = 0;

  constructor(size?: number) {
    const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
    // ?pool=N caps the fleet (e2e uses 2 so parallel suite runs + the dev
    // server can't exhaust the machine; each worker holds a Verovio WASM).
    const override = typeof location !== "undefined" ? Number(new URLSearchParams(location.search).get("pool")) : NaN;
    this.size = size ?? (Number.isFinite(override) && override >= 1 ? Math.min(16, override) : Math.min(4, Math.max(2, hw - 2)));
    for (let i = 0; i < this.size; i++) this.workers.push(new PoolWorker());
  }

  ready(): Promise<void> {
    return Promise.all(this.workers.map((w) => w.ready)).then(() => undefined);
  }

  /**
   * Render a slice. `options` are per-document Verovio overrides (e.g. the
   * forced spacingStaff); the CALLER must fold them into `key`.
   */
  render(key: string, xml: string, options?: Record<string, unknown>): Promise<TileResult> {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.hits++;
      this.cache.delete(key);
      this.cache.set(key, cached); // refresh LRU position
      return Promise.resolve({ svg: cached, renderMs: 0, cached: true });
    }
    const inFlight = this.inFlight.get(key);
    if (inFlight) return inFlight;
    this.misses++;
    const p = new Promise<TileResult>((resolve) => {
      this.queue.push({ xml, key, optionsJson: JSON.stringify(options ?? {}), resolve });
      this.pump();
    });
    this.inFlight.set(key, p);
    return p;
  }

  /** Full-document paged rendering (page view); streams pages as they finish. */
  async renderDocumentPages(xml: string, onPage: (index: number, svg: string) => void): Promise<number> {
    const w = this.workers[0]!;
    await w.ready;
    return new Promise((resolve) => {
      w.renderPages(this.nextId++, xml, onPage, resolve);
    });
  }

  /** Timemap + per-note MIDI values for playback (page view player). */
  async documentTimemap(xml: string, expand: string | null = null): Promise<PlaybackData> {
    const w = this.workers[0]!;
    await w.ready;
    return new Promise((resolve) => {
      w.timemap(this.nextId++, xml, expand, resolve);
    });
  }

  private async pump() {
    const worker = this.workers.find((w) => !w.busy);
    if (!worker) return;
    const job = this.queue.shift();
    if (!job) return;
    worker.busy = true;
    await worker.ready;
    worker.renderTile(this.nextId++, job.xml, job.optionsJson, ({ svg, renderMs, error }) => {
      if (error === undefined) {
        this.cache.set(job.key, svg);
        if (this.cache.size > CACHE_MAX) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }
      } else {
        console.error("tile render failed:", error);
      }
      this.inFlight.delete(job.key);
      worker.busy = false;
      job.resolve({ svg, renderMs, cached: false, ...(error !== undefined && { error }) });
      this.pump();
    });
    // A newly freed worker may allow another queued job to start.
    if (this.queue.length > 0) this.pump();
  }

  /** Dev diagnostics: what is the pool doing right now? */
  debugState() {
    return {
      queue: this.queue.length,
      busy: this.workers.map((w) => w.busy),
      inFlight: [...this.inFlight.keys()],
      cache: this.cache.size,
      hits: this.hits,
      misses: this.misses,
    };
  }

  dispose() {
    for (const w of this.workers) w.worker.terminate();
  }
}
