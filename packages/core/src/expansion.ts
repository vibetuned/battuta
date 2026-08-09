/**
 * Playback expansion — the repeat structure battuta itself wrote (repeat
 * barlines, volta brackets, segno/fine/da-capo marks) synthesized into an
 * MEI <expansion> for Verovio's `expand` option, so the page-view player
 * hears the true form. Probed behavior (spikes, Verovio 6.2):
 *  - with an expansion active, plain rptstart/rptend pairs are NOT
 *    auto-expanded — the plist must encode every repeat itself;
 *  - repeated plist entries are cloned with `<id>-rendN` ids, and
 *    renderToExpansionMap maps every id to [notatedId, cloneIds...].
 * The builder is PURE: it wraps the existing measure/ending elements in
 * synthetic <section>s (no cloning, no mutation) — only serialization of
 * the returned tree reads them.
 *
 * Scope (v1): plain repeats, volta groups (number sets, mixed [1,2][3]),
 * and ONE dal-segno/da-capo jump with optional fine (the recap takes only
 * each group's final ending and ignores repeats, per convention). Anything
 * else — several jump marks, dal segno without a segno — returns null and
 * playback stays unexpanded.
 */
import { CoreElement, childElements } from "./xml.js";
import { CoreScore } from "./score.js";

interface Seg {
  id: string;
  el: CoreElement; // synthetic <section> or the existing <ending>
  numbers: number[]; // volta numbers; [] = plain segment
  rptstart: boolean;
  rptend: boolean;
  fine: boolean;
  segno: boolean;
  toCoda: boolean; // last measure carries the jump-out marker
  codaStart: boolean; // first measure carries the 𝄌 destination sign
  jump: "daCapo" | "dalSegno" | null;
  groupFinal: boolean; // ending with the group's highest number (recap path)
}

const markFuncs = (measure: CoreElement): Set<string> => {
  const funcs = new Set<string>();
  for (const c of childElements(measure)) {
    if (c.tag !== "repeatMark" || !c.attrs["func"]) continue;
    // func="coda" is BOTH marks in MEI: bare = the 𝄌 destination sign,
    // text content ("To Coda") = the jump-out marker.
    const hasText = c.children.some((k) => typeof k === "string" && k.trim() !== "");
    funcs.add(c.attrs["func"] === "coda" && hasText ? "toCoda" : c.attrs["func"]!);
  }
  return funcs;
};

const voltaNumbers = (ending: CoreElement): number[] =>
  (ending.attrs["n"] ?? "")
    .split(/[,\s]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 1);

export interface ExpansionPlan {
  /** Wrapper <section> holding <expansion> + all segments in notated order. */
  section: CoreElement;
  /** xml:id of the expansion element (Verovio's `expand` option). */
  expandId: string;
}

/** Build the playback expansion, or null when unexpanded playback is right
 * (no repeat structure, or a form outside the supported scope). */
export function buildExpansion(score: CoreScore): ExpansionPlan | null {
  // Ordered flow units with ending membership (score.items flattens endings).
  type Unit = { kind: "def" | "measure"; el: CoreElement; ending: CoreElement | null };
  const units: Unit[] = [];
  let sawScoreDef = false;
  let nested = false;
  const walk = (el: CoreElement, ending: CoreElement | null): void => {
    for (const child of childElements(el)) {
      if (child.tag === "measure") units.push({ kind: "measure", el: child, ending });
      else if (child.tag === "scoreDef" || child.tag === "staffDef") {
        if (!sawScoreDef && child.tag === "scoreDef") sawScoreDef = true;
        else units.push({ kind: "def", el: child, ending });
      } else if (child.tag === "ending") {
        if (ending) nested = true;
        else walk(child, child);
      } else if (child.tag === "expansion") {
        // an already-encoded expansion is beyond v1 — leave the doc alone
        nested = true;
      } else walk(child, ending);
    }
  };
  walk(score.scoreEl, null);
  if (nested) return null;

  // Segment the flow: endings are their own segments; plain runs split at
  // repeat barriers and jump-mark measures (defs bind to the NEXT measure).
  const segs: Seg[] = [];
  let run: CoreElement[] = [];
  let pendingDefs: CoreElement[] = [];
  let synth = 0;
  const flushRun = () => {
    if (run.length === 0) return;
    const first = run.find((el) => el.tag === "measure");
    const last = [...run].reverse().find((el) => el.tag === "measure");
    segs.push({
      id: `btexp-s${synth++}`,
      el: { tag: "section", attrs: { "xml:id": `btexp-s${synth - 1}` }, children: [...run] },
      numbers: [],
      rptstart: first?.attrs["left"] === "rptstart",
      rptend: last?.attrs["right"] === "rptend",
      fine: last ? markFuncs(last).has("fine") : false,
      segno: first ? markFuncs(first).has("segno") : false,
      toCoda: last ? markFuncs(last).has("toCoda") : false,
      codaStart: first ? markFuncs(first).has("coda") : false,
      jump: last && markFuncs(last).has("daCapo") ? "daCapo" : last && markFuncs(last).has("dalSegno") ? "dalSegno" : null,
      groupFinal: false,
    });
    run = [];
  };
  let currentEnding: CoreElement | null = null;
  for (const u of units) {
    if (u.ending !== currentEnding) {
      flushRun();
      currentEnding = u.ending;
    }
    if (u.kind === "def") {
      pendingDefs.push(u.el);
      continue;
    }
    const funcs = markFuncs(u.el);
    const isBoundaryStart = u.el.attrs["left"] === "rptstart" || funcs.has("segno") || funcs.has("coda");
    if (!u.ending && isBoundaryStart) flushRun();
    run.push(...pendingDefs, u.el);
    pendingDefs = [];
    const isBoundaryEnd = u.el.attrs["right"] === "rptend" || funcs.has("fine") || funcs.has("daCapo") || funcs.has("dalSegno") || funcs.has("toCoda");
    if (!u.ending && isBoundaryEnd) flushRun();
    if (u.ending && u === units.filter((x) => x.ending === u.ending && x.kind === "measure").slice(-1)[0]) {
      // last measure of the ending: close it as ONE segment
      const id = u.ending.attrs["xml:id"];
      if (!id) return null; // endings battuta writes always carry ids
      const numbers = voltaNumbers(u.ending);
      if (numbers.length === 0) return null;
      segs.push({ id, el: u.ending, numbers, rptstart: false, rptend: false, fine: false, segno: false, toCoda: false, codaStart: false, jump: null, groupFinal: false });
      run = [];
      currentEnding = null;
    }
  }
  flushRun();
  if (segs.length === 0) return null;

  // Mark each volta group's final ending (the recap path plays only those).
  for (let i = 0; i < segs.length; ) {
    if (segs[i]!.numbers.length === 0) {
      i++;
      continue;
    }
    let k = i;
    while (k < segs.length && segs[k]!.numbers.length > 0) k++;
    const group = segs.slice(i, k);
    const maxN = Math.max(...group.flatMap((g) => g.numbers));
    for (const g of group) g.groupFinal = g.numbers.includes(maxN);
    i = k;
  }

  const jumps = segs.filter((s) => s.jump);
  if (jumps.length > 1) return null;
  const jump = jumps[0]?.jump ?? null;
  if (jump === "dalSegno" && !segs.some((s) => s.segno)) return null;

  // Base pass: linear flow with repeats and volta passes unrolled.
  const order: string[] = [];
  let repeatStart = 0;
  let repeated = false;
  for (let i = 0; i < segs.length; ) {
    const s = segs[i]!;
    if (s.numbers.length > 0) {
      let k = i;
      while (k < segs.length && segs[k]!.numbers.length > 0) k++;
      const group = segs.slice(i, k);
      const passes = [...new Set(group.flatMap((g) => g.numbers))].sort((a, b) => a - b);
      passes.forEach((p, pi) => {
        if (pi > 0) for (let j = repeatStart; j < i; j++) order.push(segs[j]!.id);
        const e = group.find((g) => g.numbers.includes(p));
        if (e) order.push(e.id);
      });
      repeated = true;
      repeatStart = k;
      i = k;
      continue;
    }
    if (s.rptstart) repeatStart = i;
    order.push(s.id);
    if (s.rptend) {
      for (let j = repeatStart; j <= i; j++) order.push(segs[j]!.id);
      repeated = true;
      repeatStart = i + 1;
    }
    // The D.C./D.S. mark CUTS the first pass here — what follows is the
    // coda (or unreachable trailing material), played only via the recap.
    if (s.jump) break;
    i++;
  }

  // Recap (da capo / dal segno): start (or segno) forward, final endings
  // only, no repeats; a fine stops it, and a "To Coda" marker jumps to the
  // 𝄌 sign when one lies ahead ("al Coda").
  if (jump) {
    const from = jump === "dalSegno" ? segs.findIndex((s) => s.segno) : 0;
    const jumpIdx = segs.indexOf(jumps[0]!);
    const toCodaIdx = segs.findIndex((s) => s.toCoda);
    const codaIdx = segs.findIndex((s) => s.codaStart);
    let j = from;
    let jumped = false;
    while (j >= 0 && j < segs.length) {
      const s = segs[j]!;
      if (!(s.numbers.length > 0 && !s.groupFinal)) order.push(s.id);
      if (s.fine) break;
      if (j === toCodaIdx && codaIdx > j) {
        j = codaIdx;
        jumped = true;
        continue;
      }
      // Walking back INTO the D.C./D.S. measure without having taken the
      // coda jump ends the piece there (never loop; the coda stays
      // reachable only through To Coda).
      if (j === jumpIdx && !jumped) break;
      j++;
    }
    repeated = true;
  }
  if (!repeated) return null;

  const expandId = "btexp";
  const expansion: CoreElement = { tag: "expansion", attrs: { "xml:id": expandId, plist: order.map((id) => `#${id}`).join(" ") }, children: [] };
  const section: CoreElement = { tag: "section", attrs: { "xml:id": "btexp-top" }, children: [expansion, ...segs.map((s) => s.el)] };
  return { section, expandId };
}
