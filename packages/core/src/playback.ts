/**
 * Notation facts a performance interprets — what the timemap alone cannot
 * say (probed: Verovio neither merges ties nor shortens articulations in
 * timemap/MIDI values), read from MEI and reported as FACTS:
 *  - TIES: which note ties INTO which (`@tie` i/m/t chains and
 *    `<tie startid endid>` elements), chain by chain.
 *  - MARKS: which notes carry a staccato, staccatissimo or tenuto, and
 *    which lie under a slur (or phrase).
 *
 * What those facts MEAN in sound — one attack for a tie chain, a shorter
 * release for a staccato, legato under a slur — is a performance
 * decision, and there can be several performers; it left core for the
 * player on 2026-09-15 (slice 7a). Core reads the document; it does not
 * interpret it.
 */
import { childElements } from "./xml.js";
import { CoreScore } from "./score.js";
import { EventIndex } from "./events.js";
import { targetNotes } from "./commands.js";

/** A mark on a note that a performance may interpret. `slur` covers `<phrase>` too. */
export type NoteMark = "slur" | "tenuto" | "staccato" | "staccatissimo";

export interface NotationFacts {
  /** noteId -> the note it ties INTO (chains resolve link by link). */
  ties: Record<string, string>;
  /** noteId -> its marks, in this order: the note's own (or its chord's) articulations, then `slur` when a slur or phrase spans it. */
  marks: Record<string, NoteMark[]>;
}

const pitchKey = (attrs: Record<string, string>): string => `${attrs["pname"]}/${attrs["oct"]}`;

/** Ordered (eventId, measure) of one voice across the whole score. */
const voiceEvents = (score: CoreScore, index: EventIndex, s: number, l: number): { id: string; measure: number }[] => {
  const out: { id: string; measure: number }[] = [];
  for (let m = 0; m < score.measures.length; m++) {
    for (const id of index.eventsAt(m, s, l)) out.push({ id, measure: m });
  }
  return out;
};

/** The marks an `@artic` value carries, in MEI's own vocabulary. */
const marksOf = (artic: string | undefined): NoteMark[] => {
  if (!artic) return [];
  const parts = artic.split(/\s+/);
  const out: NoteMark[] = [];
  if (parts.includes("stacciss")) out.push("staccatissimo");
  if (parts.includes("stacc")) out.push("staccato");
  if (parts.includes("ten")) out.push("tenuto");
  return out;
};

export function notationFacts(score: CoreScore, index: EventIndex): NotationFacts {
  const ties: Record<string, string> = {};
  const marks: Record<string, NoteMark[]> = {};
  const ctx = { score, index };

  // Voice inventory: every (staff, layer) that appears anywhere.
  const voices = new Set<string>();
  for (let m = 0; m < score.measures.length; m++) {
    for (const s of index.stavesPerMeasure.get(m) ?? []) {
      for (const l of index.layersPerStaff.get(`${m}/${s}`) ?? []) voices.add(`${s}/${l}`);
    }
  }

  // --- ties from @tie chains: i|m links to the NEXT same-pitch note ---
  for (const key of voices) {
    const [s, l] = key.split("/").map(Number);
    const events = voiceEvents(score, index, s!, l!);
    for (let i = 0; i + 1 < events.length; i++) {
      const a = targetNotes(ctx, events[i]!.id);
      const b = targetNotes(ctx, events[i + 1]!.id);
      for (const noteA of a) {
        const t = noteA.attrs["tie"];
        if (t !== "i" && t !== "m") continue;
        const match = b.find((noteB) => {
          const tb = noteB.attrs["tie"];
          return (tb === "m" || tb === "t") && pitchKey(noteB.attrs) === pitchKey(noteA.attrs);
        });
        const idA = noteA.attrs["xml:id"];
        const idB = match?.attrs["xml:id"];
        if (idA && idB) ties[idA] = idB;
      }
    }
  }

  // --- ties from <tie startid endid> control events ---
  for (const measure of score.measures) {
    for (const c of childElements(measure)) {
      if (c.tag !== "tie") continue;
      const from = (c.attrs["startid"] ?? "").replace(/^#/, "");
      const to = (c.attrs["endid"] ?? "").replace(/^#/, "");
      if (from && to) ties[from] = to;
    }
  }

  // --- articulations: a note's own @artic wins; a chord-level @artic
  // covers the members that have none ---
  const findEl = (measureIndex: number, id: string) => {
    const measure = score.measures[measureIndex];
    if (!measure) return null;
    const stack = [measure];
    while (stack.length) {
      const el = stack.pop()!;
      for (const c of childElements(el)) {
        if (c.attrs["xml:id"] === id) return c;
        stack.push(c);
      }
    }
    return null;
  };
  for (const [id, ref] of index.byId) {
    if (ref.tag !== "note" && ref.tag !== "chord") continue;
    const chordMarks = ref.tag === "chord" ? marksOf(findEl(ref.measureIndex, id)?.attrs["artic"]) : [];
    for (const n of targetNotes(ctx, id)) {
      const nid = n.attrs["xml:id"];
      if (!nid) continue;
      const own = marksOf(n.attrs["artic"]);
      const m = own.length ? own : chordMarks;
      if (m.length) marks[nid] = [...m];
    }
  }

  // --- slur (and phrase) spans: every note from start to end ---
  for (const measure of score.measures) {
    for (const c of childElements(measure)) {
      if (c.tag !== "slur" && c.tag !== "phrase") continue;
      const from = (c.attrs["startid"] ?? "").replace(/^#/, "");
      const to = (c.attrs["endid"] ?? "").replace(/^#/, "");
      const a = index.byId.get(from);
      const b = index.byId.get(to);
      if (!a || !b || a.staffN !== b.staffN || a.layerN !== b.layerN) continue;
      const events = voiceEvents(score, index, a.staffN, a.layerN);
      const i = events.findIndex((e) => e.id === from);
      const j = events.findIndex((e) => e.id === to);
      if (i < 0 || j < 0) continue;
      for (let k = Math.min(i, j); k <= Math.max(i, j); k++) {
        for (const n of targetNotes(ctx, events[k]!.id)) {
          const nid = n.attrs["xml:id"];
          if (!nid) continue;
          const list = marks[nid] ?? (marks[nid] = []);
          if (!list.includes("slur")) list.push("slur");
        }
      }
    }
  }

  return { ties, marks };
}
