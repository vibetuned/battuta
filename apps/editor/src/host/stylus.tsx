/**
 * The stylus (1.3.0, phase 11 — a host module the user approved on
 * 2026-10-29): the Apple Pencil and the S Pen, captured natively by the
 * shell and read against the score — what `ctx.stylus` (capability
 * "stylus") hands a plugin. `host/index.ts` fetches this module the first
 * time a plugin uses the stylus, so a desktop never loads it.
 *
 *   - **The bridge.** While some plugin claims capture, the shell
 *     (`stylus_capture`) takes the pen's strokes that begin inside the
 *     score's area, and its `stylus` events carry what the pen does:
 *     strokes (samples batched per screen frame), a hold, hover and the
 *     buttons (the Pencil Pro's squeeze and double-tap, the S Pen's side
 *     button). `StylusCapture.swift` / `StylusCapture.kt` produce them.
 *   - **The pen writes only on the score** (the user, 2026-10-29). The area
 *     is the window's part between the header, the bottom bar and panels
 *     and the side panel — none at all outside edit view, or while a menu,
 *     a picker, a lane or a dialog is open over the score — and this module
 *     keeps the shell told of it (`stylus_area`). Elsewhere the pen taps
 *     like a finger.
 *   - **The score under the pen.** `resolvePoint` reads a page point as
 *     the measure of the tile under it, the staff nearest it, that staff's
 *     event nearest it across, and the pitch at that height from the
 *     staff's drawn lines and the clef in force.
 */
import type { ClefContext, Disposable, Pitch, StaffContext, StylusEvent, StylusRecognition, StylusRecognizeRequest, StylusSample, StylusScorePoint } from "@battuta/api";
import { shellPlatform, tauriInvoke } from "./shell";

// --- the score under the pen ----------------------------------------------------

const LETTERS = "cdefgab";
const diatonic = (pname: string, oct: number): number => oct * 7 + LETTERS.indexOf(pname);
/** The pitch a clef names on its own line, before any octave displacement. */
const CLEF_PITCH: Record<string, number> = { G: diatonic("g", 4), F: diatonic("f", 3), C: diatonic("c", 4) };

/**
 * Steps above a staff's bottom line at height `y`: 0 the bottom line, 1 the
 * space above it, … negative below it. `lines` are the staff's line
 * heights, top to bottom, in the same coordinates as `y`. Null for a staff
 * of fewer than two lines.
 */
export function stepAt(y: number, lines: readonly number[]): number | null {
  if (lines.length < 2) return null;
  const bottom = lines[lines.length - 1]!;
  const half = (bottom - lines[0]!) / (lines.length - 1) / 2;
  return half > 0 ? Math.round((bottom - y) / half) : null;
}

/** The pitch at a step above the bottom line, under `clef`. Null for a clef that names no pitch (percussion, TAB). */
export function pitchAtStep(clef: ClefContext, step: number): Pitch | null {
  const named = CLEF_PITCH[clef.shape];
  if (named === undefined) return null;
  const octaves = clef.dis === 8 ? 1 : clef.dis === 15 ? 2 : clef.dis === 22 ? 3 : 0;
  const bottom = named + octaves * 7 * (clef.disPlace === "below" ? -1 : 1) - 2 * (clef.line - 1);
  const d = bottom + step;
  return { pname: LETTERS[((d % 7) + 7) % 7]!, oct: Math.floor(d / 7) };
}

export interface ScoreLookups {
  staffNOf(staffId: string): number | undefined;
  contextOf(measureIndex: number, staffN: number): StaffContext | undefined;
}

/** The engraved events a pen can land on (Verovio's classes); a chord's own notes are not events of their own. */
const EVENTS = "g.note[id], g.chord[id], g.rest[id], g.mRest[id]";

/** The staff's event nearest `x` across: its head's box for a note, its own for the rest. Null on an empty staff. */
function nearestEvent(staff: Element, x: number): string | null {
  let best: { id: string; d: number } | null = null;
  for (const g of staff.querySelectorAll(EVENTS)) {
    if (g.classList.contains("note") && g.parentElement?.closest("g.chord")) continue;
    const r = ((g.classList.contains("note") && g.querySelector(":scope > g.notehead")) || g).getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (!best || d < best.d) best = { id: g.id, d };
  }
  return best?.id ?? null;
}

/** Staff spaces within which a notehead is a symbol's neighbour (granita's `NOTE_RANGE`). */
export const NOTE_RANGE = 8;

/** A staff's geometry from its lines' y, top to bottom: the space between two lines and the middle line. */
export function staffGeometry(lines: readonly number[]): { space: number; middleY: number } {
  const top = lines[0]!;
  const bottom = lines[lines.length - 1]!;
  return { space: (bottom - top) / (lines.length - 1), middleY: (top + bottom) / 2 };
}

/** The head nearest a point, when one is within `reach`. */
export function nearestOf<T extends { x: number; y: number }>(heads: readonly T[], x: number, y: number, reach: number): T | null {
  let best: { head: T; d: number } | null = null;
  for (const head of heads) {
    const d = Math.hypot(head.x - x, head.y - y);
    if (!best || d < best.d) best = { head, d };
  }
  return best && best.d <= reach ? best.head : null;
}

/** Every notehead of a staff — a chord's notes each their own — with its centre in page px. */
function headsOf(staff: Element): { eventId: string; x: number; y: number }[] {
  const heads: { eventId: string; x: number; y: number }[] = [];
  for (const g of staff.querySelectorAll("g.note[id]")) {
    const r = (g.querySelector(":scope > g.notehead") ?? g).getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    heads.push({ eventId: g.id, x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }
  return heads;
}

/**
 * Where a page point falls in edit view: the tile under it, the staff nearest it, that
 * staff's event nearest it, the pitch at that height; and (1.3.5) the staff's geometry,
 * the measure's extent and the nearest notehead. Null off the measures.
 */
export function resolvePoint(x: number, y: number, lookups: ScoreLookups): StylusScorePoint | null {
  const tile = document.elementsFromPoint(x, y).map((e) => e.closest<HTMLElement>(".tile[data-index]")).find((t): t is HTMLElement => t !== null);
  const frame = tile?.querySelector<HTMLElement>("[data-tile-frame]");
  if (!tile || !frame) return null;
  const measureIndex = Number(tile.dataset["index"]);
  let best: { n: number; g: Element; lines: number[]; left: number; right: number; d: number } | null = null;
  for (const g of tile.querySelectorAll<SVGGElement>("g.staff[id]")) {
    const n = lookups.staffNOf(g.id);
    if (n === undefined) continue;
    let left = Infinity;
    let right = -Infinity;
    const lines = [...g.children]
      .filter((c) => c.tagName === "path")
      .map((p) => {
        const r = p.getBoundingClientRect();
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
        return r.top + r.height / 2;
      })
      .sort((a, b) => a - b);
    if (lines.length < 2) continue;
    const d = y < lines[0]! ? lines[0]! - y : y > lines[lines.length - 1]! ? y - lines[lines.length - 1]! : 0;
    if (!best || d < best.d) best = { n, g, lines, left, right, d };
  }
  if (!best) return null;
  const step = stepAt(y, best.lines);
  if (step === null) return null;
  const context = lookups.contextOf(measureIndex, best.n);
  const origin = frame.getBoundingClientRect();
  const staff = staffGeometry(best.lines);
  return {
    measureIndex,
    staffN: best.n,
    eventId: nearestEvent(best.g, x),
    step,
    pitch: context ? pitchAtStep(context.clef, step) : null,
    tile: { x: x - origin.left, y: y - origin.top },
    staff,
    measure: { left: best.left, right: best.right },
    nearestNote: nearestOf(headsOf(best.g), x, y, NOTE_RANGE * staff.space),
  };
}

// --- where the pen writes ---------------------------------------------------------

/** A rectangle in page (viewport) pixels: x, y, width, height — the shell's own points and dp. */
export type AreaRect = readonly [x: number, y: number, width: number, height: number];

/** What, open over the score, gives the pen back to the page: menus, pickers, a lane, the dialogs. */
const OVER_THE_SCORE = "[data-menu-backdrop], [data-app-menu], [data-bar-menu], [data-zoom-panel], [data-accid-pick], [data-lane], [data-shortcuts], [data-about]";

/**
 * The score's area: the part of the window `main` shows between the header,
 * the bottom bar and panels and the side panel, while its measure tiles are
 * up (edit view). Empty while anything is open over it.
 */
export function scoreArea(doc: Document = document, view: { innerWidth: number; innerHeight: number } = window): AreaRect[] {
  const main = doc.querySelector("main");
  if (!main?.querySelector(".tile[data-index]") || doc.querySelector(OVER_THE_SCORE)) return [];
  // Across, `main`'s own edges; down, the window's, less the chrome fixed
  // over it — so the area does not move when the page scrolls.
  const m = main.getBoundingClientRect();
  let top = 0;
  let bottom = view.innerHeight;
  let left = Math.max(0, m.left);
  const right = Math.min(view.innerWidth, m.right);
  const header = doc.querySelector("header")?.getBoundingClientRect();
  if (header && header.height > 0) top = Math.max(top, header.bottom);
  for (const el of doc.querySelectorAll("footer[data-statusbar], aside[data-panels='bottom']")) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) bottom = Math.min(bottom, r.top);
  }
  const side = doc.querySelector("aside[data-panels='side']")?.getBoundingClientRect();
  if (side && side.width > 0 && side.height > 0) left = Math.max(left, side.right);
  return right > left && bottom > top ? [[left, top, right - left, bottom - top]] : [];
}

const within = (area: readonly AreaRect[], x: number, y: number): boolean => area.some(([ax, ay, w, h]) => x >= ax && x < ax + w && y >= ay && y < ay + h);

/**
 * The page keeps no pen stroke that begins on the score while capture is
 * on. On Android the shell takes those strokes before the WebView, so the
 * page gets nothing; on iPadOS the shell's recognizer stops WebKit from
 * scrolling with the Pencil but not from handing the page the Pencil's own
 * events — whole strokes, down to up (the debug log, 2026-10-29). So the
 * page stops them itself, at the window, before anything else sees them:
 * the pen pointer events of a stroke that began inside `inArea`, its touch
 * events, the mouse events and click a stopped pen tap is followed by (not
 * a finger's: a finger's own pointer event ends that window), and a
 * hovering pen over the area. A stroke that began outside it is the
 * page's, wherever it goes. Returns the function that takes the shield down.
 *
 * Stopped, never prevented: on iPadOS a `touchstart` the page prevents
 * makes WebKit fail every native gesture recognizer waiting on its own —
 * the shell's Pencil recognizer included, which then saw a stroke's down
 * and never its moves or its lift (2026-10-29: the cross stayed up, no
 * note was written). Only the mouse events and click a tap turns into are
 * prevented, which have no gesture behind them.
 */
export function shieldFromPen(target: Window = window, inArea: (x: number, y: number) => boolean = () => true): () => void {
  let penAt = -Infinity;
  const strokes = new Map<number, boolean>(); // pointerId → stopped
  const touches = new Map<number, boolean>(); // touch identifier → stopped
  const stop = (e: Event, prevent = false): void => {
    penAt = e.timeStamp;
    e.stopImmediatePropagation();
    if (prevent && e.cancelable) e.preventDefault();
  };
  const pointer = (e: Event): void => {
    const p = e as PointerEvent;
    if (p.pointerType !== "pen") {
      if (e.type === "pointerdown") penAt = -Infinity;
      return;
    }
    let stopped = strokes.get(p.pointerId);
    if (e.type === "pointerdown") strokes.set(p.pointerId, (stopped = inArea(p.clientX, p.clientY)));
    if (e.type === "pointerup" || e.type === "pointercancel") strokes.delete(p.pointerId);
    if (stopped ?? inArea(p.clientX, p.clientY)) stop(e);
  };
  const touch = (e: Event): void => {
    const changed = [...(e as TouchEvent).changedTouches] as (Touch & { touchType?: string })[];
    if (changed.length === 0 || !changed.every((t) => t.touchType === "stylus")) return;
    let stopped = false;
    for (const t of changed) {
      if (e.type === "touchstart") touches.set(t.identifier, inArea(t.clientX, t.clientY));
      stopped ||= touches.get(t.identifier) ?? false;
      if (e.type === "touchend" || e.type === "touchcancel") touches.delete(t.identifier);
    }
    if (stopped) stop(e);
  };
  const after = (e: Event): void => {
    const type = (e as Partial<PointerEvent>).pointerType;
    if (type === "pen" ? inArea((e as MouseEvent).clientX, (e as MouseEvent).clientY) : !type && e.timeStamp - penAt < 800) stop(e, true);
  };
  const listeners: [string, (e: Event) => void][] = [
    ...["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerover", "pointerout", "pointerenter", "pointerleave", "gotpointercapture", "lostpointercapture"].map((t): [string, (e: Event) => void] => [t, pointer]),
    ...["touchstart", "touchmove", "touchend", "touchcancel"].map((t): [string, (e: Event) => void] => [t, touch]),
    ...["mousedown", "mousemove", "mouseup", "click", "dblclick", "contextmenu", "auxclick"].map((t): [string, (e: Event) => void] => [t, after]),
  ];
  for (const [type, fn] of listeners) target.addEventListener(type, fn, { capture: true, passive: false });
  return () => {
    for (const [type, fn] of listeners) target.removeEventListener(type, fn, { capture: true });
  };
}

// --- the bridge -----------------------------------------------------------------

type Listen = (event: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;

/** An event as the shell sends it: everything but where it falls on the score. */
type ShellEvent = StylusEvent extends infer E ? (E extends unknown ? Omit<E, "at"> : never) : never;

/** The page point an event is read at: a stroke's last sample, else its own point. */
const pointOf = (e: ShellEvent): { x: number; y: number } | null => {
  if (e.type === "stroke") {
    const s: StylusSample | undefined = e.samples[e.samples.length - 1];
    return s ? { x: s[0], y: s[1] } : null;
  }
  return e.x !== null && e.y !== null ? { x: e.x, y: e.y } : null;
};

export class StylusService {
  /** The active score's lookups (`host.bindStylus`); null while no document is open. */
  lookups: () => ScoreLookups | null = () => null;
  private readonly claims = new Set<string>();
  private readonly listeners = new Set<(e: StylusEvent) => void>();
  private subscribed = false;
  private area: AreaRect[] = [];
  private release: (() => void) | null = null;

  /** In the iOS and Android shells, which capture the stylus natively. */
  get available(): boolean {
    return shellPlatform()?.mobile === true && tauriInvoke() !== null;
  }

  /** Capture is on while any plugin claims it; `owner` is the plugin's id. */
  claim(owner: string, on: boolean): Promise<void> {
    const before = this.claims.size > 0;
    if (on) this.claims.add(owner);
    else this.claims.delete(owner);
    const after = this.claims.size > 0;
    const invoke = tauriInvoke();
    if (after === before || !invoke || !this.available) return Promise.resolve();
    if (after) {
      const unshield = shieldFromPen(window, (x, y) => within(this.area, x, y));
      const unwatch = this.watchArea(invoke);
      this.release = () => {
        unshield();
        unwatch();
      };
    } else {
      this.release?.();
      this.release = null;
      this.area = [];
    }
    return invoke("stylus_capture", { on: after }).then(() => undefined);
  }

  /** Where a page point falls on the score (1.3.5); null with no document open or off the measures. */
  at(x: number, y: number): StylusScorePoint | null {
    const lookups = this.lookups();
    return lookups ? resolvePoint(x, y, lookups) : null;
  }

  /** The shell's classifier on a symbol (1.3.5): the request checked at the door, the answer the shell's. */
  recognize(request: StylusRecognizeRequest): Promise<readonly StylusRecognition[]> {
    const invoke = tauriInvoke();
    if (!invoke || !this.available) return Promise.reject(new Error("recognize: no stylus shell"));
    const strokes = request.strokes;
    if (!Array.isArray(strokes) || strokes.length === 0 || !strokes.every((s) => Array.isArray(s) && s.length > 0 && s.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(v))))) {
      return Promise.reject(new Error("recognize: strokes must be non-empty arrays of [x, y] points"));
    }
    if (!(Number.isFinite(request.staffSpace) && request.staffSpace > 0)) return Promise.reject(new Error("recognize: staffSpace must be a positive number"));
    const c = request.context;
    const context = c
      ? {
          yStaff: Number(c.yStaff),
          xMeasure: Number(c.xMeasure),
          barline: Number(c.barline),
          noteDx: c.noteDx === null ? null : Number(c.noteDx),
          noteDy: c.noteDy === null ? null : Number(c.noteDy),
          width: Number(c.width),
          height: Number(c.height),
        }
      : null;
    return invoke("stylus_recognize", { strokes: request.strokes.map((s) => s.map((p) => [p[0], p[1]])), staffSpace: request.staffSpace, context }).then((answer) =>
      (Array.isArray(answer) ? answer : []).map((a: { label?: unknown; confidence?: unknown }) => ({ label: String(a.label), confidence: Number(a.confidence) })),
    );
  }

  /** Every event, read against the score; the disposable unsubscribes. */
  on(listener: (e: StylusEvent) => void): Disposable {
    this.listeners.add(listener);
    if (!this.subscribed) {
      const listen = (window as unknown as { __TAURI__?: { event?: { listen?: Listen } } }).__TAURI__?.event?.listen;
      if (listen) {
        this.subscribed = true;
        void listen("stylus", (e) => this.dispatch(e.payload as ShellEvent));
      }
    }
    return { dispose: () => void this.listeners.delete(listener) };
  }

  private dispatch(raw: ShellEvent): void {
    // Debug builds: what the native side has to say about itself.
    const note = raw as unknown as { type: string; msg?: string };
    if (note.type === "debug") {
      void tauriInvoke()?.("js_log", { msg: `[stylus-native] ${note.msg ?? ""}` }).catch(() => undefined);
      return;
    }
    const p = pointOf(raw);
    const lookups = this.lookups();
    const at = p && lookups && within(this.area, p.x, p.y) ? resolvePoint(p.x, p.y, lookups) : null;
    const event = { ...raw, at } as StylusEvent;
    // Debug builds: the shell log names every event but the per-frame ones.
    if (shellPlatform()?.debug && raw.type !== "hover" && !(raw.type === "stroke" && raw.phase === "move")) {
      const what = raw.type === "stroke" ? `stroke ${raw.phase} #${raw.id}` : raw.type === "hold" ? `hold #${raw.id}` : `${raw.button} ${raw.phase}`;
      void tauriInvoke()?.("js_log", { msg: `[stylus] ${what} at ${at ? `m${at.measureIndex + 1} staff ${at.staffN} ${at.eventId ?? "-"} step ${at.step}` : "-"}` }).catch(() => undefined);
    }
    for (const l of [...this.listeners]) l(event);
  }

  /** Keep the shell told of the score's area, once per frame at most, while capture is on. */
  private watchArea(invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>): () => void {
    let frame = 0;
    let sent = "";
    const update = (): void => {
      frame = 0;
      this.area = scoreArea();
      const key = JSON.stringify(this.area.map((r) => r.map(Math.round)));
      if (key === sent) return;
      sent = key;
      void invoke("stylus_area", { rects: this.area });
    };
    const later = (): void => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new MutationObserver(later);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", later);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", later);
      cancelAnimationFrame(frame);
    };
  }
}

export const stylusService = new StylusService();
