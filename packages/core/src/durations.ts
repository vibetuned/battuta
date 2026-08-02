/**
 * Duration arithmetic. MEI layers must sum to the measure's notated duration;
 * every paste is gated by this invariant (DESIGN.md). All values are exact
 * rationals in units of whole notes (4/4 measure = 1/1, quarter = 1/4).
 */
import { CoreElement, childElements } from "./xml.js";
import { MeterContext } from "./context.js";
import { EVENT_TAGS } from "./events.js";

export interface Fraction {
  num: number;
  den: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export const frac = (num: number, den: number): Fraction => {
  if (den === 0) throw new Error("zero denominator");
  const sign = den < 0 ? -1 : 1;
  const g = gcd(Math.abs(num), Math.abs(den)) || 1;
  return { num: (sign * num) / g, den: (sign * den) / g };
};
export const fAdd = (a: Fraction, b: Fraction): Fraction => frac(a.num * b.den + b.num * a.den, a.den * b.den);
export const fMul = (a: Fraction, b: Fraction): Fraction => frac(a.num * b.num, a.den * b.den);
export const fEq = (a: Fraction, b: Fraction): boolean => a.num * b.den === b.num * a.den;
export const fCmp = (a: Fraction, b: Fraction): number => a.num * b.den - b.num * a.den;
export const F0: Fraction = { num: 0, den: 1 };

/** Written duration of @dur in whole notes ("4" -> 1/4, "breve" -> 2). */
function durValue(dur: string): Fraction | null {
  if (dur === "breve") return frac(2, 1);
  if (dur === "long") return frac(4, 1);
  const n = Number(dur);
  if (!Number.isInteger(n) || n <= 0) return null;
  return frac(1, n);
}

/**
 * Duration of a single event element (note/chord/rest/space), including dots.
 * Grace notes take no time. Returns null for events without a resolvable
 * written duration (e.g. mRest — the caller treats those as measure-filling).
 */
export function eventDuration(el: CoreElement): Fraction | null {
  if (el.attrs["grace"]) return F0;
  const dur = el.attrs["dur"];
  if (!dur) return null;
  const base = durValue(dur);
  if (!base) return null;
  const dots = Number(el.attrs["dots"] ?? "0");
  // n dots multiply by (2 - 1/2^n)
  return fMul(base, frac(2 ** (dots + 1) - 1, 2 ** dots));
}

export interface LayerDuration {
  total: Fraction;
  /** mRest/mSpace present — the layer fills the measure by definition. */
  fillsMeasure: boolean;
  /** Events whose duration could not be resolved (counted, not summed). */
  unresolved: number;
}

function walkDuration(el: CoreElement, scale: Fraction, acc: LayerDuration): void {
  for (const child of childElements(el)) {
    if (child.tag === "mRest" || child.tag === "mSpace") {
      acc.fillsMeasure = true;
    } else if (EVENT_TAGS.has(child.tag)) {
      const d = eventDuration(child);
      if (d === null) acc.unresolved++;
      else acc.total = fAdd(acc.total, fMul(d, scale));
    } else if (child.tag === "tuplet") {
      const num = Number(child.attrs["num"] ?? "3");
      const numbase = Number(child.attrs["numbase"] ?? "2");
      walkDuration(child, fMul(scale, frac(numbase, num)), acc);
    } else {
      walkDuration(child, scale, acc); // beam, graceGrp, bTrem, …
    }
  }
}

/** Sum a <layer>'s written duration. */
export function layerDuration(layer: CoreElement): LayerDuration {
  const acc: LayerDuration = { total: F0, fillsMeasure: false, unresolved: 0 };
  walkDuration(layer, frac(1, 1), acc);
  return acc;
}

/** Notated capacity of a measure under a meter (4/4 -> 1, 6/8 -> 3/4). */
export function meterCapacity(meter: MeterContext): Fraction | null {
  if (meter.sym === "common") return frac(4, 4);
  if (meter.sym === "cut") return frac(2, 2);
  const count = Number(meter.count);
  const unit = Number(meter.unit);
  if (!count || !unit) return null;
  return frac(count, unit);
}

export interface DurationProblem {
  staffN: number;
  layerN: number;
  expected: Fraction;
  actual: Fraction;
}

/**
 * Validate that every layer of (optionally one staff of) a measure sums to
 * the meter capacity. Layers with unresolved events are skipped rather than
 * failed — unknown notation must not block editing (preserve, don't punish).
 * Upbeat/short measures (@metcon="false") are exempt from the exact check.
 */
export function validateMeasureDurations(measure: CoreElement, meter: MeterContext, onlyStaffN?: number): DurationProblem[] {
  const capacity = meterCapacity(meter);
  if (!capacity) return [];
  if (measure.attrs["metcon"] === "false") return [];
  const problems: DurationProblem[] = [];
  for (const staff of childElements(measure).filter((c) => c.tag === "staff")) {
    const staffN = Number(staff.attrs["n"] ?? "1");
    if (onlyStaffN !== undefined && staffN !== onlyStaffN) continue;
    for (const layer of childElements(staff).filter((c) => c.tag === "layer")) {
      const layerN = Number(layer.attrs["n"] ?? "1");
      const d = layerDuration(layer);
      if (d.fillsMeasure || d.unresolved > 0) continue;
      if (!fEq(d.total, capacity)) {
        problems.push({ staffN, layerN, expected: capacity, actual: d.total });
      }
    }
  }
  return problems;
}
