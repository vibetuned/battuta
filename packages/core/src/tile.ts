/**
 * Tile slice synthesis: a standalone MEI document for a window of measures,
 * carrying the EFFECTIVE context for the window's first measure (from the
 * resolver), with cosmetic elements that must not appear on every tile
 * (instrument labels, page headers) stripped.
 */
import { CoreElement, childElements, deepClone, hashString, serialize } from "./xml.js";
import { CoreScore } from "./score.js";
import { MeasureContext, contextHash } from "./context.js";

const MEI_NS = "http://www.music-encoding.org/ns/mei";
const STRIP_TAGS = new Set(["label", "labelAbbr", "pgHead", "pgHead2", "pgFoot", "pgFoot2", "grpSym"]);
/** staffDef children replaced by the attribute form of the effective context. */
const STRIP_DEF_CHILDREN = new Set(["clef", "keySig", "meterSig", "meterSigGrp"]);

function stripCosmetics(el: CoreElement): void {
  el.children = el.children.filter((c) => typeof c === "string" || !STRIP_TAGS.has(c.tag));
  for (const c of childElements(el)) stripCosmetics(c);
}

/** Build the tile's <scoreDef>: original staffGrp skeleton + effective attrs. */
export function synthesizeScoreDef(score: CoreScore, ctx: MeasureContext): CoreElement {
  const def = deepClone(score.scoreDef);
  stripCosmetics(def);
  // Score-level keysig/meter would fight the per-staff values; remove them.
  for (const key of Object.keys(def.attrs)) {
    if (key === "keysig" || key === "key.sig" || key.startsWith("meter.") || key.startsWith("key.")) delete def.attrs[key];
  }
  const apply = (el: CoreElement): void => {
    if (el.tag === "staffDef") {
      const n = Number(el.attrs["n"] ?? "1");
      const staff = ctx.get(n);
      if (staff) {
        el.children = el.children.filter((c) => typeof c === "string" || !STRIP_DEF_CHILDREN.has(c.tag));
        for (const key of Object.keys(el.attrs)) {
          if (key.startsWith("clef.") || key === "keysig" || key === "key.sig" || key.startsWith("meter.")) delete el.attrs[key];
        }
        el.attrs["lines"] = String(staff.lines);
        el.attrs["clef.shape"] = staff.clef.shape;
        el.attrs["clef.line"] = String(staff.clef.line);
        if (staff.clef.dis) el.attrs["clef.dis"] = String(staff.clef.dis);
        if (staff.clef.disPlace) el.attrs["clef.dis.place"] = staff.clef.disPlace;
        el.attrs["keysig"] = staff.keysig;
        if (staff.meter.count) el.attrs["meter.count"] = staff.meter.count;
        if (staff.meter.unit) el.attrs["meter.unit"] = staff.meter.unit;
        if (staff.meter.sym) el.attrs["meter.sym"] = staff.meter.sym;
        if (staff.transSemi !== undefined) el.attrs["trans.semi"] = String(staff.transSemi);
        if (staff.transDiat !== undefined) el.attrs["trans.diat"] = String(staff.transDiat);
      }
    }
    for (const c of childElements(el)) apply(c);
  };
  apply(def);
  return def;
}

export interface TileSlice {
  xml: string;
  /** Cache key: hash of effective context + measure content. */
  key: string;
  measureIds: string[];
}

/** Control events that span time and can be stubbed with tstamp/tstamp2. */
const SPAN_TAGS = new Set(["slur", "tie", "phrase", "hairpin"]);

function collectSliceIds(el: CoreElement, out: Set<string>): void {
  const id = el.attrs["xml:id"];
  if (id) out.add(id);
  for (const c of childElements(el)) collectSliceIds(c, out);
}

function mapIdsToStaff(measure: CoreElement, out: Map<string, string>): void {
  for (const staff of childElements(measure).filter((c) => c.tag === "staff")) {
    const n = staff.attrs["n"] ?? "1";
    const walk = (el: CoreElement): void => {
      const id = el.attrs["xml:id"];
      if (id) out.set(id, n);
      for (const c of childElements(el)) walk(c);
    };
    walk(staff);
  }
}

const stripHash = (v: string | undefined) => (v ? v.replace(/^#/, "") : undefined);

interface SpanEnd {
  el: CoreElement;
  measureIndex: number;
  endRef: string;
}

/**
 * Index of span events (slur/tie/…) by their end reference, built once per
 * score: a tile needs to know about curves that START in an earlier measure
 * and END inside the tile, because the event element lives with its start.
 */
const spanEndIndexCache = new WeakMap<CoreScore, SpanEnd[]>();

function getSpanEndIndex(score: CoreScore): SpanEnd[] {
  let index = spanEndIndexCache.get(score);
  if (index) return index;
  index = [];
  score.measures.forEach((measure, measureIndex) => {
    for (const child of childElements(measure)) {
      if (!SPAN_TAGS.has(child.tag)) continue;
      const endRef = stripHash(child.attrs["endid"]);
      if (endRef) index.push({ el: child, measureIndex, endRef });
    }
  });
  spanEndIndexCache.set(score, index);
  return index;
}

/**
 * Normalize control events for an isolated slice (DESIGN.md risk #2).
 * A curve crossing the slice boundary is rewritten as a continuation stub:
 * incoming (start outside) -> tstamp-anchored, injected into the measure that
 * holds its end note; outgoing (end outside) -> tstamp2-anchored to the end
 * of the slice. Events whose anchors are all outside are dropped. Curves that
 * pass entirely over the slice are not drawn (accepted, like system breaks).
 * Mutates the (cloned) measures in place.
 */
function segmentControlEvents(measures: CoreElement[], beatsPerMeasure: number, incomingCandidates: SpanEnd[]): void {
  const ids = new Set<string>();
  const staffOf = new Map<string, string>();
  const perMeasureIds: Set<string>[] = measures.map((m) => {
    const set = new Set<string>();
    collectSliceIds(m, set);
    mapIdsToStaff(m, staffOf);
    for (const id of set) ids.add(id);
    return set;
  });

  const ensureStaff = (el: CoreElement, anchor: string | undefined) => {
    if (!el.attrs["staff"] && anchor) {
      const staff = staffOf.get(anchor);
      if (staff) el.attrs["staff"] = staff;
    }
  };

  measures.forEach((measure, k) => {
    measure.children = measure.children.filter((child) => {
      if (typeof child === "string" || child.tag === "staff") return true;
      const start = stripHash(child.attrs["startid"]);
      const end = stripHash(child.attrs["endid"]);
      const startIn = start === undefined || ids.has(start);
      const endIn = end === undefined || ids.has(end);
      if (startIn && endIn) return true;
      if (!SPAN_TAGS.has(child.tag)) return startIn; // point events: keep only if anchored
      if (!startIn && !endIn) return false;
      ensureStaff(child, startIn ? start : end);
      if (!startIn) {
        delete child.attrs["startid"];
        if (!child.attrs["tstamp"]) child.attrs["tstamp"] = "0";
      }
      if (!endIn) {
        delete child.attrs["endid"];
        if (!child.attrs["tstamp2"]) child.attrs["tstamp2"] = `${measures.length - 1 - k}m+${beatsPerMeasure + 1}`;
      }
      return true;
    });
  });

  // Inject incoming continuations: events living BEFORE the slice whose end
  // note is inside it. The stub is anchored at tstamp 0 of the end's measure.
  for (const candidate of incomingCandidates) {
    const k = perMeasureIds.findIndex((set) => set.has(candidate.endRef));
    if (k < 0) continue;
    const stub = deepClone(candidate.el);
    delete stub.attrs["startid"];
    delete stub.attrs["xml:id"]; // avoid duplicating the original event's id
    stub.attrs["tstamp"] = "0";
    ensureStaff(stub, candidate.endRef);
    measures[k]!.children.push(stub);
  }
}

/** Synthesize the slice document for measures [from, from+count). */
export function synthesizeTile(score: CoreScore, contexts: MeasureContext[], from: number, count = 1): TileSlice {
  const ctx = contexts[from];
  if (!ctx) throw new Error(`no context for measure index ${from}`);
  const scoreDefXml = serialize(synthesizeScoreDef(score, ctx));
  const measures = score.measures.slice(from, from + count).map(deepClone);
  const firstStaff = ctx.values().next().value;
  const incoming = getSpanEndIndex(score).filter((s) => s.measureIndex < from);
  segmentControlEvents(measures, Number(firstStaff?.meter.count ?? "4") || 4, incoming);
  const measuresXml = measures.map((m) => serialize(m)).join("\n");
  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<mei xmlns="${MEI_NS}" meiversion="5.0">`,
    `<music><body><mdiv><score>`,
    scoreDefXml,
    `<section>`,
    measuresXml,
    `</section>`,
    `</score></mdiv></body></music>`,
    `</mei>`,
  ].join("\n");
  const key = `${contextHash(ctx)}-${hashString(measuresXml)}`;
  const measureIds = measures.map((m) => m.attrs["xml:id"] ?? "");
  return { xml, key, measureIds };
}
