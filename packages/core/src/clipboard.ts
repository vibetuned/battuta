/**
 * Block selection and clipboard fragments — the arranging model.
 *
 * A block is a rectangle in the (measure-range × staff-range) grid. Copying
 * a block yields per-staff, per-measure staff-content fragments plus the
 * source context metadata needed for the paste compatibility pass. Fragments
 * are plain data (CoreElement is JSON-serializable): they survive
 * structuredClone, cross documents, and render as readable MEI text for the
 * system clipboard.
 */
import { CoreElement, childElements, deepClone, serialize } from "./xml.js";
import { CoreScore } from "./score.js";
import { MeasureContext, MeterContext } from "./context.js";
import { newId } from "./ids.js";

export interface BlockSelection {
  measureFrom: number;
  measureTo: number; // inclusive
  staffFrom: number;
  staffTo: number; // inclusive
}

export const normalizeBlock = (a: { measureIndex: number; staffN: number }, b: { measureIndex: number; staffN: number }): BlockSelection => ({
  measureFrom: Math.min(a.measureIndex, b.measureIndex),
  measureTo: Math.max(a.measureIndex, b.measureIndex),
  staffFrom: Math.min(a.staffN, b.staffN),
  staffTo: Math.max(a.staffN, b.staffN),
});

export interface ClipboardStaff {
  /** Source staff @n (provenance; paste remaps to the target staff). */
  sourceStaffN: number;
  /** One <staff> element clone per measure of the block, in order. */
  measures: CoreElement[];
  keysig: string;
}

/** A control event travelling with the block (fing, dynam, hairpin, …). */
export interface ClipboardControl {
  /** Measure offset within the block. */
  atMeasure: number;
  /** Source staff minus block.staffFrom (paste retargets @staff by this). */
  staffOffset: number;
  el: CoreElement;
}

export interface ClipboardFragment {
  measureCount: number;
  staves: ClipboardStaff[];
  meter: MeterContext;
  /** Control events whose anchors all live inside the block. */
  controls: ClipboardControl[];
}

const REF_ATTRS = ["startid", "endid"] as const;
export const derefId = (v: string | undefined): string | undefined => (v ? v.replace(/^#/, "") : undefined);

/** All id-refs of a measure-level control event. */
export function controlRefs(el: CoreElement): string[] {
  return REF_ATTRS.map((a) => derefId(el.attrs[a])).filter((r): r is string => r !== undefined);
}

export function findStaffInMeasure(measure: CoreElement, staffN: number): CoreElement | null {
  return childElements(measure).find((c) => c.tag === "staff" && Number(c.attrs["n"] ?? "1") === staffN) ?? null;
}

const emptyStaff = (n: number): CoreElement => ({
  tag: "staff",
  attrs: { n: String(n) },
  children: [{ tag: "layer", attrs: { n: "1" }, children: [{ tag: "mRest", attrs: {}, children: [] }] }],
});

/** Copy a block out of a score. Returns null if the block is empty. */
export function copyBlock(score: CoreScore, contexts: MeasureContext[], block: BlockSelection): ClipboardFragment | null {
  const ctx = contexts[block.measureFrom];
  if (!ctx) return null;
  const staves: ClipboardStaff[] = [];
  const staffOfId = new Map<string, number>(); // copied event id -> source staff n
  for (let n = block.staffFrom; n <= block.staffTo; n++) {
    const measures: CoreElement[] = [];
    for (let m = block.measureFrom; m <= block.measureTo; m++) {
      const measure = score.measures[m];
      const staff = measure ? findStaffInMeasure(measure, n) : null;
      if (staff) {
        const index = (e: CoreElement): void => {
          const id = e.attrs["xml:id"];
          if (id) staffOfId.set(id, n);
          for (const c of childElements(e)) index(c);
        };
        index(staff);
      }
      // A missing staff still occupies its slot (pastes as empty).
      measures.push(staff ? deepClone(staff) : emptyStaff(n));
    }
    staves.push({ sourceStaffN: n, measures, keysig: ctx.get(n)?.keysig ?? "0" });
  }
  if (staves.length === 0) return null;
  // Control events riding along: measure children (fing/dynam/hairpin/slur/…)
  // whose every id anchor lives inside the copied block. Anchors reaching
  // outside (half a hairpin) stay behind; tstamp-only events too.
  const controls: ClipboardControl[] = [];
  for (let m = block.measureFrom; m <= block.measureTo; m++) {
    const measure = score.measures[m];
    if (!measure) continue;
    for (const child of childElements(measure)) {
      if (child.tag === "staff") continue;
      const refs = controlRefs(child);
      if (refs.length === 0 || !refs.every((r) => staffOfId.has(r))) continue;
      controls.push({ atMeasure: m - block.measureFrom, staffOffset: staffOfId.get(refs[0]!)! - block.staffFrom, el: deepClone(child) });
    }
  }
  const firstStaff = ctx.get(block.staffFrom);
  return { measureCount: block.measureTo - block.measureFrom + 1, staves, meter: firstStaff ? { ...firstStaff.meter } : {}, controls };
}

/** Readable MEI text form (for the system clipboard / interop). */
export function fragmentToText(frag: ClipboardFragment): string {
  const measures: string[] = [];
  for (let m = 0; m < frag.measureCount; m++) {
    measures.push(`<measure n="${m + 1}">\n${frag.staves.map((s) => (s.measures[m] ? serialize(s.measures[m]!) : "")).join("\n")}\n</measure>`);
  }
  return `<!-- battuta clipboard: ${frag.measureCount} measure(s) × ${frag.staves.length} staff/staves, meter ${frag.meter.count ?? "?"}/${frag.meter.unit ?? "?"} -->\n${measures.join("\n")}`;
}

/** Clone a fragment staff for insertion, with all-new ids (never collide).
 * `idMap` (optional) records old→new so control-event anchors can follow. */
export function materializeStaff(staff: CoreElement, idMap?: Map<string, string>): CoreElement {
  const el = deepClone(staff);
  const walk = (e: CoreElement): void => {
    const old = e.attrs["xml:id"];
    const fresh = newId();
    e.attrs["xml:id"] = fresh;
    if (old && idMap) idMap.set(old, fresh);
    for (const c of childElements(e)) walk(c);
  };
  walk(el);
  return el;
}
