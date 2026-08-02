/**
 * Effective-context resolver: for every (measure, staff) pair, the clef, key
 * signature, meter, staff lines, and transposition in force at that point.
 *
 * This is the correctness backbone of tiled rendering (DESIGN.md risk #1):
 * a measure rendered in isolation with the wrong context renders wrong
 * pitches convincingly. Sources handled, in flow order:
 *   - the initial <scoreDef>/<staffDef>s (attribute or child-element form)
 *   - <scoreDef>/<staffDef> elements interleaved between measures
 *   - inline <clef> elements inside a measure's layers (the context of
 *     FOLLOWING measures; the measure containing the clef renders it itself)
 *
 * Granularity is per measure: a mid-measure clef change affects the next
 * measure's context. Sub-measure context (for caret/pitch logic) is Phase 2+.
 */
import { CoreElement, childElements, findAll, hashString } from "./xml.js";
import { CoreScore } from "./score.js";

export interface ClefContext {
  shape: string;
  line: number;
  /** Octave displacement (8, 15) and its direction, e.g. G-clef ottava bassa. */
  dis?: number;
  disPlace?: "above" | "below";
}
export interface MeterContext {
  count?: string;
  unit?: string;
  sym?: string;
}
export interface StaffContext {
  n: number;
  lines: number;
  clef: ClefContext;
  /** MEI keysig value: "0", "3s", "2f", … */
  keysig: string;
  meter: MeterContext;
  /** Chromatic/diatonic transposition of a transposing staff, if any. */
  transSemi?: number;
  transDiat?: number;
}

/** Contexts for one measure, keyed by staff @n. */
export type MeasureContext = ReadonlyMap<number, StaffContext>;

const DEFAULT_CLEF: ClefContext = { shape: "G", line: 2 };

function readClefFrom(el: CoreElement, attrPrefix: string): Partial<ClefContext> | null {
  const a = el.attrs;
  const shape = a[`${attrPrefix}shape`];
  const line = a[`${attrPrefix}line`];
  if (!shape && !line) return null;
  const clef: Partial<ClefContext> = {};
  if (shape) clef.shape = shape;
  if (line) clef.line = Number(line);
  const dis = a[`${attrPrefix}dis`];
  if (dis) clef.dis = Number(dis);
  const disPlace = a[`${attrPrefix}dis.place`];
  if (disPlace === "above" || disPlace === "below") clef.disPlace = disPlace;
  return clef;
}

/** Read clef from a def element: clef.* attributes or a <clef> child. */
function readClef(def: CoreElement): Partial<ClefContext> | null {
  const fromAttrs = readClefFrom(def, "clef.");
  if (fromAttrs) return fromAttrs;
  const child = childElements(def).find((c) => c.tag === "clef");
  return child ? readClefFrom(child, "") : null;
}

/** Read key signature: @keysig (MEI 5) / @key.sig (MEI 4) / <keySig @sig>. */
function readKeysig(def: CoreElement): string | null {
  const a = def.attrs["keysig"] ?? def.attrs["key.sig"];
  if (a) return a;
  const child = childElements(def).find((c) => c.tag === "keySig");
  return child?.attrs["sig"] ?? null;
}

/** Read meter: meter.* attributes or a <meterSig> child. */
function readMeter(def: CoreElement): MeterContext | null {
  const meter: MeterContext = {};
  const a = def.attrs;
  if (a["meter.count"]) meter.count = a["meter.count"];
  if (a["meter.unit"]) meter.unit = a["meter.unit"];
  if (a["meter.sym"]) meter.sym = a["meter.sym"];
  if (meter.count || meter.unit || meter.sym) return meter;
  const child = childElements(def).find((c) => c.tag === "meterSig");
  if (!child) return null;
  const m: MeterContext = {};
  if (child.attrs["count"]) m.count = child.attrs["count"];
  if (child.attrs["unit"]) m.unit = child.attrs["unit"];
  if (child.attrs["sym"]) m.sym = child.attrs["sym"];
  return m.count || m.unit || m.sym ? m : null;
}

interface ResolverState {
  staves: Map<number, StaffContext>;
}

function applyStaffDef(state: ResolverState, def: CoreElement, scoreKeysig: string | null, scoreMeter: MeterContext | null): void {
  const n = Number(def.attrs["n"] ?? "1");
  const existing = state.staves.get(n);
  const ctx: StaffContext = existing ?? {
    n,
    lines: 5,
    clef: { ...DEFAULT_CLEF },
    keysig: scoreKeysig ?? "0",
    meter: scoreMeter ? { ...scoreMeter } : {},
  };
  if (def.attrs["lines"]) ctx.lines = Number(def.attrs["lines"]);
  const clef = readClef(def);
  if (clef) ctx.clef = { ...DEFAULT_CLEF, ...clef } as ClefContext;
  const keysig = readKeysig(def);
  if (keysig) ctx.keysig = keysig;
  const meter = readMeter(def);
  if (meter) ctx.meter = { ...meter };
  if (def.attrs["trans.semi"]) ctx.transSemi = Number(def.attrs["trans.semi"]);
  if (def.attrs["trans.diat"]) ctx.transDiat = Number(def.attrs["trans.diat"]);
  state.staves.set(n, ctx);
}

function applyScoreDef(state: ResolverState, def: CoreElement): void {
  const keysig = readKeysig(def);
  const meter = readMeter(def);
  // Score-level context applies to every staff; per-staffDef values override.
  for (const ctx of state.staves.values()) {
    if (keysig) ctx.keysig = keysig;
    if (meter) ctx.meter = { ...meter };
  }
  for (const staffDef of findAll(def, "staffDef")) {
    applyStaffDef(state, staffDef, keysig, meter);
  }
}

/** Post-measure pass: the last inline <clef> per staff sets the new state. */
function applyInlineClefs(state: ResolverState, measure: CoreElement): void {
  for (const staff of childElements(measure).filter((c) => c.tag === "staff")) {
    const n = Number(staff.attrs["n"] ?? "1");
    const ctx = state.staves.get(n);
    if (!ctx) continue;
    const clefs = findAll(staff, "clef");
    const last = clefs[clefs.length - 1];
    if (!last) continue;
    const clef = readClefFrom(last, "");
    if (clef) ctx.clef = { ...DEFAULT_CLEF, ...clef } as ClefContext;
  }
}

function snapshot(state: ResolverState): MeasureContext {
  const out = new Map<number, StaffContext>();
  for (const [n, ctx] of state.staves) {
    out.set(n, { ...ctx, clef: { ...ctx.clef }, meter: { ...ctx.meter } });
  }
  return out;
}

/**
 * Resolve the effective context in force at the START of every measure.
 * Returned array is indexed by measure index.
 */
export function resolveContexts(score: CoreScore): MeasureContext[] {
  const state: ResolverState = { staves: new Map() };
  applyScoreDef(state, score.scoreDef);

  const contexts: MeasureContext[] = [];
  for (const item of score.items) {
    if (item.kind === "def") {
      if (item.el.tag === "scoreDef") applyScoreDef(state, item.el);
      else applyStaffDef(state, item.el, null, null);
    } else {
      contexts[item.index] = snapshot(state);
      applyInlineClefs(state, item.el);
    }
  }
  return contexts;
}

/** Stable hash of a measure context — part of every tile cache key. */
export function contextHash(ctx: MeasureContext): string {
  const staves = [...ctx.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, c]) =>
      [n, c.lines, c.clef.shape, c.clef.line, c.clef.dis ?? "", c.clef.disPlace ?? "", c.keysig, c.meter.count ?? "", c.meter.unit ?? "", c.meter.sym ?? "", c.transSemi ?? "", c.transDiat ?? ""].join(","),
    )
    .join(";");
  return hashString(staves);
}
