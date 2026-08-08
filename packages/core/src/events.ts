/**
 * Event index and caret navigation.
 *
 * An "event" is a caret-addressable unit inside a layer: note, chord, rest,
 * mRest, space. Notes inside a chord are not events (the chord is); beams,
 * tuplets and other containers are transparent. The index is rebuilt after
 * every command — a full rebuild is a few ms even on the 313-measure quartet,
 * which is far simpler than incremental maintenance.
 */
import { CoreElement, childElements } from "./xml.js";
import { CoreScore } from "./score.js";

export const EVENT_TAGS = new Set(["note", "chord", "rest", "mRest", "space", "mSpace"]);

/** Caret position in model coordinates (never pixels). */
export interface CaretPosition {
  measureIndex: number;
  staffN: number;
  layerN: number;
  /** Index of the event the caret is on, within its layer. */
  eventIndex: number;
}

export interface EventRef extends CaretPosition {
  id: string;
  tag: string;
}

const layerKey = (m: number, s: number, l: number) => `${m}/${s}/${l}`;

export class EventIndex {
  readonly byId = new Map<string, EventRef>();
  /** `${measure}/${staff}/${layer}` -> ordered event ids. */
  readonly layers = new Map<string, string[]>();
  /** measureIndex -> sorted staff numbers present. */
  readonly stavesPerMeasure = new Map<number, number[]>();
  /** `${measure}/${staff}` -> sorted layer numbers present. */
  readonly layersPerStaff = new Map<string, number[]>();

  eventsAt(m: number, s: number, l: number): string[] {
    return this.layers.get(layerKey(m, s, l)) ?? [];
  }

  eventIdAt(pos: CaretPosition): string | undefined {
    return this.eventsAt(pos.measureIndex, pos.staffN, pos.layerN)[pos.eventIndex];
  }
}

function collectLayerEvents(el: CoreElement, out: CoreElement[]): void {
  for (const c of childElements(el)) {
    if (EVENT_TAGS.has(c.tag)) out.push(c);
    else collectLayerEvents(c, out); // beam, tuplet, graceGrp, btrem, …
  }
}

export function buildEventIndex(score: CoreScore): EventIndex {
  const index = new EventIndex();
  score.measures.forEach((measure, m) => {
    const staffNs: number[] = [];
    for (const staff of childElements(measure).filter((c) => c.tag === "staff")) {
      const s = Number(staff.attrs["n"] ?? "1");
      staffNs.push(s);
      const layerNs: number[] = [];
      for (const layer of childElements(staff).filter((c) => c.tag === "layer")) {
        const l = Number(layer.attrs["n"] ?? "1");
        layerNs.push(l);
        const events: CoreElement[] = [];
        collectLayerEvents(layer, events);
        const ids: string[] = [];
        events.forEach((ev, eventIndex) => {
          const id = ev.attrs["xml:id"];
          if (!id) return; // ensureIds() should have run at import
          ids.push(id);
          index.byId.set(id, { id, tag: ev.tag, measureIndex: m, staffN: s, layerN: l, eventIndex });
        });
        index.layers.set(layerKey(m, s, l), ids);
      }
      index.layersPerStaff.set(`${m}/${s}`, layerNs.sort((a, b) => a - b));
    }
    index.stavesPerMeasure.set(m, staffNs.sort((a, b) => a - b));
  });
  return index;
}

/** Next event in reading order within the same staff/layer. Stops at the
 * voice's edge: if the NEXT measure has no such layer (per-measure voices),
 * the caret stays — no teleporting across the gap. */
export function caretRight(index: EventIndex, score: CoreScore, pos: CaretPosition): CaretPosition | null {
  const here = index.eventsAt(pos.measureIndex, pos.staffN, pos.layerN);
  if (pos.eventIndex + 1 < here.length) return { ...pos, eventIndex: pos.eventIndex + 1 };
  const m = pos.measureIndex + 1;
  if (m >= score.measures.length) return null;
  if (index.eventsAt(m, pos.staffN, pos.layerN).length === 0) return null; // the voice ends here
  return { measureIndex: m, staffN: pos.staffN, layerN: pos.layerN, eventIndex: 0 };
}

/** Previous event in reading order within the same staff/layer; stops where
 * the voice starts (see caretRight). */
export function caretLeft(index: EventIndex, _score: CoreScore, pos: CaretPosition): CaretPosition | null {
  if (pos.eventIndex > 0) return { ...pos, eventIndex: pos.eventIndex - 1 };
  const m = pos.measureIndex - 1;
  if (m < 0) return null;
  const events = index.eventsAt(m, pos.staffN, pos.layerN);
  if (events.length === 0) return null; // the voice starts here
  return { measureIndex: m, staffN: pos.staffN, layerN: pos.layerN, eventIndex: events.length - 1 };
}

/**
 * Move vertically (direction -1 = up, +1 = down) through the measure's
 * flattened (staff, voice) slots: staff 1 voice 1 → staff 1 voice 2 →
 * staff 2 voice 1 → … — voices come before the next staff.
 */
export function caretVertical(index: EventIndex, pos: CaretPosition, direction: -1 | 1): CaretPosition | null {
  const slots: { staffN: number; layerN: number }[] = [];
  for (const staffN of index.stavesPerMeasure.get(pos.measureIndex) ?? []) {
    for (const layerN of index.layersPerStaff.get(`${pos.measureIndex}/${staffN}`) ?? []) {
      slots.push({ staffN, layerN });
    }
  }
  const at = slots.findIndex((s) => s.staffN === pos.staffN && s.layerN === pos.layerN);
  if (at < 0) return null;
  const target = slots[at + direction];
  if (!target) return null;
  const events = index.eventsAt(pos.measureIndex, target.staffN, target.layerN);
  if (events.length === 0) return null;
  return { measureIndex: pos.measureIndex, staffN: target.staffN, layerN: target.layerN, eventIndex: Math.min(pos.eventIndex, events.length - 1) };
}

/**
 * The ordered id range between two events in the SAME staff/layer (inclusive),
 * in reading order — the model behind shift-click / shift-arrow selection.
 */
export function eventRange(index: EventIndex, score: CoreScore, a: CaretPosition, b: CaretPosition): string[] {
  if (a.staffN !== b.staffN || a.layerN !== b.layerN) return [];
  let from = a, to = b;
  if (a.measureIndex > b.measureIndex || (a.measureIndex === b.measureIndex && a.eventIndex > b.eventIndex)) {
    from = b;
    to = a;
  }
  const ids: string[] = [];
  for (let m = from.measureIndex; m <= to.measureIndex; m++) {
    const events = index.eventsAt(m, from.staffN, from.layerN);
    const startIdx = m === from.measureIndex ? from.eventIndex : 0;
    const endIdx = m === to.measureIndex ? to.eventIndex : events.length - 1;
    for (let i = startIdx; i <= endIdx; i++) {
      const id = events[i];
      if (id) ids.push(id);
    }
  }
  return ids;
}
