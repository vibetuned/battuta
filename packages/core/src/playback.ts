/**
 * Playback shaping — what the timemap alone cannot say (probed: Verovio
 * neither merges ties nor shortens articulations in timemap/MIDI values):
 *  - TIES: tied notes are ONE sound. The document knows every tie
 *    (@tie i/m/t chains and <tie startid/endid> elements); the pair graph
 *    lets the player merge played spans into a single attack.
 *  - SLURS + ARTICULATIONS: gate factors per note — under a slur (or
 *    tenuto) a note holds its full value, staccato halves it,
 *    staccatissimo shorter still; everything else gets the standard
 *    slight detach so legato is audible by contrast.
 */
import { childElements } from "./xml.js";
import { CoreScore } from "./score.js";
import { EventIndex } from "./events.js";
import { targetNotes } from "./commands.js";

export interface PlaybackShaping {
  /** noteId -> the note it ties INTO (chains resolve link by link). */
  ties: Record<string, string>;
  /** noteId -> duration gate; absent = the player's default detach. */
  gates: Record<string, number>;
}

export const GATE_SLUR = 1.0;
export const GATE_TENUTO = 1.0;
export const GATE_STACCATO = 0.5;
export const GATE_STACCATISSIMO = 0.3;
/** Default for unshaped notes (the player applies it): slight detach. */
export const GATE_DEFAULT = 0.9;

const pitchKey = (attrs: Record<string, string>): string => `${attrs["pname"]}/${attrs["oct"]}`;

/** Ordered (eventId, noteEls) of one voice across the whole score. */
const voiceEvents = (score: CoreScore, index: EventIndex, s: number, l: number): { id: string; measure: number }[] => {
  const out: { id: string; measure: number }[] = [];
  for (let m = 0; m < score.measures.length; m++) {
    for (const id of index.eventsAt(m, s, l)) out.push({ id, measure: m });
  }
  return out;
};

export function playbackShaping(score: CoreScore, index: EventIndex): PlaybackShaping {
  const ties: Record<string, string> = {};
  const gates: Record<string, number> = {};
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

  // --- articulation gates: a note's own artic wins; a chord-level artic
  // covers members without one ---
  const gateFor = (artic: string | undefined): number | undefined => {
    if (!artic) return undefined;
    const parts = artic.split(/\s+/);
    if (parts.includes("stacciss")) return GATE_STACCATISSIMO;
    if (parts.includes("stacc")) return GATE_STACCATO;
    if (parts.includes("ten")) return GATE_TENUTO;
    return undefined;
  };
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
    const eventGate = ref.tag === "chord" ? gateFor(findEl(ref.measureIndex, id)?.attrs["artic"]) : undefined;
    for (const n of targetNotes(ctx, id)) {
      const nid = n.attrs["xml:id"];
      const g = gateFor(n.attrs["artic"]) ?? eventGate;
      if (nid && g !== undefined) gates[nid] = g;
    }
  }

  // --- slur (and phrase) spans: every event from start to end, legato ---
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
          // explicit articulation wins over the slur's legato
          if (nid && gates[nid] === undefined) gates[nid] = GATE_SLUR;
        }
      }
    }
  }

  return { ties, gates };
}

/**
 * Merge tied spans over the PLAYED timemap (repeat passes play clone ids;
 * `vis` maps them back to notated ids for the tie lookup). Returns which
 * played id carries the attack for each note, and the merged duration per
 * attack root. Pure — unit-testable without audio.
 */
export function mergeTiedSpans(
  events: { tstamp: number; on?: string[]; off?: string[] }[],
  ties: Record<string, string>,
  idMap: Record<string, string>,
): { roots: Record<string, string>; durations: Record<string, number> } {
  const vis = (id: string): string => idMap[id] ?? id;
  const onAt = new Map<string, number>();
  const roots: Record<string, string> = {};
  const ends: Record<string, number> = {};
  for (const ev of events) {
    for (const id of ev.off ?? []) {
      const root = roots[id];
      if (root !== undefined) ends[root] = ev.tstamp;
    }
    for (const id of ev.on ?? []) {
      if (onAt.has(id)) continue;
      onAt.set(id, ev.tstamp);
      // a tie continuation starts exactly where its predecessor ends
      const pred = (ev.off ?? []).find((offId) => ties[vis(offId)] === vis(id));
      roots[id] = pred !== undefined ? roots[pred]! : id;
    }
  }
  const durations: Record<string, number> = {};
  for (const [id, root] of Object.entries(roots)) {
    if (id !== root) continue;
    const start = onAt.get(id);
    const end = ends[id];
    if (start !== undefined && end !== undefined) durations[id] = Math.max(60, end - start);
  }
  return { roots, durations };
}
