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
import { ensureIds } from "./ids.js";

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

export interface ClipboardFragment {
  measureCount: number;
  staves: ClipboardStaff[];
  meter: MeterContext;
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
  for (let n = block.staffFrom; n <= block.staffTo; n++) {
    const measures: CoreElement[] = [];
    for (let m = block.measureFrom; m <= block.measureTo; m++) {
      const measure = score.measures[m];
      const staff = measure ? findStaffInMeasure(measure, n) : null;
      // A missing staff still occupies its slot (pastes as empty).
      measures.push(staff ? deepClone(staff) : emptyStaff(n));
    }
    staves.push({ sourceStaffN: n, measures, keysig: ctx.get(n)?.keysig ?? "0" });
  }
  if (staves.length === 0) return null;
  const firstStaff = ctx.get(block.staffFrom);
  return { measureCount: block.measureTo - block.measureFrom + 1, staves, meter: firstStaff ? { ...firstStaff.meter } : {} };
}

/** Readable MEI text form (for the system clipboard / interop). */
export function fragmentToText(frag: ClipboardFragment): string {
  const measures: string[] = [];
  for (let m = 0; m < frag.measureCount; m++) {
    measures.push(`<measure n="${m + 1}">\n${frag.staves.map((s) => (s.measures[m] ? serialize(s.measures[m]!) : "")).join("\n")}\n</measure>`);
  }
  return `<!-- battuta clipboard: ${frag.measureCount} measure(s) × ${frag.staves.length} staff/staves, meter ${frag.meter.count ?? "?"}/${frag.meter.unit ?? "?"} -->\n${measures.join("\n")}`;
}

/** Clone a fragment staff for insertion, with all-new ids (never collide). */
export function materializeStaff(staff: CoreElement): CoreElement {
  const el = deepClone(staff);
  const strip = (e: CoreElement): void => {
    delete e.attrs["xml:id"];
    for (const c of childElements(e)) strip(c);
  };
  strip(el);
  ensureIds(el);
  return el;
}
