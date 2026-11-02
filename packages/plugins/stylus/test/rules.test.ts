/**
 * The rules as pure functions: the symbol's place in staff spaces from the
 * host's reading of its centre; that place in words, with granita's
 * thresholds; what each class writes, where it may sit (the user's brief:
 * the dot right of a note, accidentals left of one, fingerings and
 * dynamics outside the staff, clefs and rests inside it), the choice among
 * the classifier's answers and when it asks instead; the head of a drawn
 * note.
 */
import { describe, it, expect } from "vitest";
import type { StylusScorePoint } from "@battuta/api";
import { CHOICES, THRESHOLD, choose, contextOf, headOf, nameOf, placeOf, writeAs } from "../src/rules";
import type { Symbol } from "../src/handwriting";

/** A note by its head's centre, its body the head alone (1.3 x 1 staff spaces of 10 px): a whole note. */
const head = (eventId: string, x: number, y: number) => ({ eventId, x, y, box: { left: x - 6.5, top: y - 5, right: x + 6.5, bottom: y + 5 } });
/** A staff of 10 px spaces around y 300, a measure from x 100 to 500, a notehead at (300, 300). */
const at = (over: Partial<StylusScorePoint> = {}): StylusScorePoint => ({ measureIndex: 0, staffN: 1, eventId: "r1", step: 4, pitch: { pname: "b", oct: 4 }, tile: { x: 0, y: 0 }, staff: { space: 10, middleY: 300 }, measure: { left: 100, right: 500 }, nearestNote: head("n1", 300, 300), nearestMark: null, ...over });
const box = (cx: number, cy: number, w = 6, h = 6) => ({ minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2 });
const targets = { event: "r1", note: "n1", left: null, right: null, column: null, mark: null };
const r = (label: string, confidence: number) => ({ label, confidence });

describe("the symbol's place", () => {
  it("is measured in staff spaces: from the middle line, along the measure, to the barline, from the note's body and with its size; and the symbol's size", () => {
    expect(contextOf(box(320, 302), at())).toEqual({ yStaff: 0.2, xMeasure: 0.55, barline: 18, noteDx: 2, noteDy: 0.2, noteW: 1.3, noteH: 1, width: 0.6, height: 0.6 });
    expect(contextOf(box(320, 302), at({ nearestNote: null }))).toMatchObject({ noteDx: null, noteDy: null, noteW: null, noteH: null });
    // A stemmed note: the body is head and stem, the offsets from its centre.
    const stemmed = at({ nearestNote: { eventId: "n1", x: 300, y: 300, box: { left: 293.5, top: 265, right: 306.5, bottom: 305 } } });
    expect(contextOf(box(320, 302), stemmed)).toMatchObject({ noteDx: 2, noteDy: 1.7, noteW: 1.3, noteH: 4 });
  });

  it("is named with granita's thresholds: beside the body within half a space of its top and bottom, over it within half a space of its sides", () => {
    expect(placeOf(contextOf(box(320, 302), at()))).toMatchObject({ inStaff: true, hasNote: true, right: true, left: false, aboveNote: false, belowNote: false, onNote: false, atStart: false });
    expect(placeOf(contextOf(box(300, 270), at()))).toMatchObject({ inStaff: false, above: true, aboveNote: true, left: false, right: false });
    expect(placeOf(contextOf(box(300, 330), at()))).toMatchObject({ below: true, belowNote: true });
    expect(placeOf(contextOf(box(280, 300), at()))).toMatchObject({ left: true, right: false, onNote: false });
    expect(placeOf(contextOf(box(302, 301), at()))).toMatchObject({ onNote: true, left: false, right: false, aboveNote: false, belowNote: false });
    expect(placeOf(contextOf(box(120, 300), at({ nearestNote: null })))).toMatchObject({ atStart: true, hasNote: false, inStaff: true });
    // A stemmed note (stem up to y 265): a staccato over the stem's top is above it; a mark beside the stem is beside the note, not above it.
    const stemmed = at({ nearestNote: { eventId: "n1", x: 300, y: 300, box: { left: 293.5, top: 265, right: 306.5, bottom: 305 } } });
    expect(placeOf(contextOf(box(300, 258), stemmed))).toMatchObject({ aboveNote: true, left: false, right: false });
    expect(placeOf(contextOf(box(320, 270), stemmed))).toMatchObject({ right: true, aboveNote: false });
    expect(placeOf(contextOf(box(300, 280), stemmed))).toMatchObject({ onNote: true });
  });
});

describe("what the classifier's answers write", () => {
  it("a dot right of a note is the augmentation dot; above it, a staccato", () => {
    const top = [r("augmentationDot", 0.9), r("articStaccatoAbove", 0.1)];
    expect(choose(top, contextOf(box(320, 302), at()), targets, null)).toMatchObject({ kind: "write", name: "augmentation dot", confidence: 0.9, message: { type: "core.mark", eventId: "n1", mark: { kind: "dot" } } });
    // Above the note the dot's rule fails and the staccato's passes — at 10 % it asks.
    expect(choose(top, contextOf(box(300, 270), at()), targets, null)).toMatchObject({ kind: "choose", options: [r("articStaccatoAbove", 0.1)] });
    expect(choose([r("articStaccatoAbove", 0.8), r("augmentationDot", 0.2)], contextOf(box(300, 270), at()), targets, null)).toMatchObject({ kind: "write", message: { eventId: "n1", mark: { kind: "articulation", artic: "stacc" } } });
  });

  it("an accidental goes on the note to its right; right of a note nothing fits, and it asks", () => {
    expect(choose([r("accidentalSharp", 0.93)], contextOf(box(280, 300), at()), targets, null)).toMatchObject({ kind: "write", name: "sharp", message: { eventId: "n1", mark: { kind: "accidental", accid: "s" } } });
    expect(choose([r("accidentalSharp", 0.93)], contextOf(box(320, 300), at()), targets, null)).toMatchObject({ kind: "nothing", reason: "nothing that belongs here — read as sharp (93 %)" });
  });

  it("fingerings and dynamics never inside the staff; clefs only inside it, at the start", () => {
    expect(choose([r("fing3", 0.8)], contextOf(box(300, 270), at()), targets, null)).toMatchObject({ kind: "write", message: { eventId: "n1", mark: { kind: "fingering", finger: "3" } } });
    expect(choose([r("fing3", 0.8)], contextOf(box(300, 300), at()), targets, null)).toMatchObject({ kind: "nothing", reason: /read as fingering 3/ });
    expect(choose([r("dynamicPiano", 0.8)], contextOf(box(300, 360), at()), targets, null)).toMatchObject({ kind: "write", name: "p", message: { eventId: "r1", mark: { kind: "dynamic", value: "p" } } });
    expect(choose([r("dynamicPiano", 0.8)], contextOf(box(300, 240), at()), targets, null)).toMatchObject({ kind: "nothing" });
    expect(choose([r("gClef", 0.8)], contextOf(box(120, 300, 20, 60), at({ nearestNote: null })), targets, null)).toMatchObject({ kind: "write", name: "G clef", message: { eventId: "r1", mark: { kind: "clef", shape: "G" } } });
    expect(choose([r("gClef", 0.8)], contextOf(box(300, 300, 20, 60), at()), targets, null)).toMatchObject({ kind: "nothing" });
  });

  it("the quarter rest is the eraser: touching a note it erases the note, touching a mark the mark, elsewhere nothing", () => {
    const over = { ...targets, column: "n1" };
    expect(choose([r("restQuarter", 0.9)], contextOf(box(300, 300, 10, 30), at()), over, null)).toMatchObject({ kind: "write", name: "erase", message: { type: "core.erase", id: "n1" } });
    // A fingering above the staff, under the symbol: the mark, not the note under it.
    expect(choose([r("restQuarter", 0.9)], contextOf(box(300, 260, 10, 30), at()), { ...over, mark: { id: "f1", kind: "fingering" } }, null)).toMatchObject({ kind: "write", name: "erase", message: { type: "core.erase", id: "f1" } });
    // Inside the staff with no note in the column, or above it with no mark: nothing to erase.
    expect(choose([r("restQuarter", 0.9)], contextOf(box(400, 300, 10, 30), at()), targets, null)).toMatchObject({ kind: "nothing", reason: /read as erase/ });
    expect(choose([r("restQuarter", 0.9)], contextOf(box(300, 260, 10, 30), at()), over, null)).toMatchObject({ kind: "nothing" });
    // On the head of a note above the staff (a ledger line): the note.
    expect(choose([r("restQuarter", 0.9)], contextOf(box(300, 262, 10, 30), at({ nearestNote: head("n1", 300, 260) })), over, null)).toMatchObject({ kind: "write", message: { type: "core.erase", id: "n1" } });
    expect(writeAs("restQuarter", 0.9, targets, null)).toMatchObject({ kind: "nothing", reason: /needs a note or a mark under it/ });
  });

  it("ornaments: a trill, mordent or turn over a note goes on it, never inside the staff; the arpeggio on the chord after it", () => {
    expect(choose([r("trill", 0.9)], contextOf(box(300, 270, 20, 10), at()), { ...targets, column: "n1" }, null)).toMatchObject({ kind: "write", name: "trill", message: { type: "core.mark", eventId: "n1", mark: { kind: "ornament", ornament: "trill" } } });
    expect(choose([r("mordent", 0.9)], contextOf(box(300, 270, 20, 10), at()), targets, null)).toMatchObject({ kind: "write", message: { eventId: "n1", mark: { kind: "ornament", ornament: "mordent" } } });
    expect(choose([r("turn", 0.9)], contextOf(box(300, 300, 20, 10), at()), { ...targets, column: "n1" }, null)).toMatchObject({ kind: "nothing" });
    expect(choose([r("arpeg", 0.9)], contextOf(box(280, 300, 6, 30), at()), { ...targets, right: "c1" }, null)).toMatchObject({ kind: "write", name: "arpeggio", message: { eventId: "c1", mark: { kind: "ornament", ornament: "arpeg" } } });
    expect(choose([r("arpeg", 0.9)], contextOf(box(320, 300, 6, 30), at()), targets, null)).toMatchObject({ kind: "nothing" }); // right of the note
  });

  it("repeat marks: a coda or segno sign, Fine, D.S. or D.C. above or below the staff goes on the event under it, never inside the staff", () => {
    expect(choose([r("coda", 0.9)], contextOf(box(300, 265, 20, 20), at()), targets, null)).toMatchObject({ kind: "write", name: "coda", message: { type: "core.mark", eventId: "r1", mark: { kind: "repeatMark", mark: "coda" } } });
    expect(choose([r("segno", 0.9)], contextOf(box(120, 265, 20, 20), at({ nearestNote: null })), targets, null)).toMatchObject({ kind: "write", message: { eventId: "r1", mark: { kind: "repeatMark", mark: "segno" } } });
    expect(choose([r("daCapo", 0.9)], contextOf(box(450, 335, 30, 12), at()), targets, null)).toMatchObject({ kind: "write", name: "D.C.", message: { eventId: "r1", mark: { kind: "repeatMark", mark: "daCapo" } } });
    expect(choose([r("fine", 0.9)], contextOf(box(300, 300, 30, 12), at()), targets, null)).toMatchObject({ kind: "nothing" });
    expect(writeAs("dalSegno", 0.9, { ...targets, event: null }, null)).toMatchObject({ kind: "nothing", reason: /needs an event under it/ });
  });

  it("goes by the neighbour that matters, not the nearest: a dot on the note before it, an accidental on the note after it, a mark on the note in its column", () => {
    // A dot between two notes, nearer the next one: the context says "left of a note", the dot's rule asks for a note before it.
    const between = { event: "r1", note: "nB", left: "nA", right: "nB", column: null, mark: null };
    expect(choose([r("augmentationDot", 0.9)], contextOf(box(280, 300), at({ nearestNote: head("nB", 300, 300) })), between, null)).toMatchObject({ kind: "write", message: { eventId: "nA", mark: { kind: "dot" } } });
    expect(choose([r("accidentalSharp", 0.9)], contextOf(box(280, 300), at()), between, null)).toMatchObject({ kind: "write", message: { eventId: "nB", mark: { kind: "accidental", accid: "s" } } });
    // A staccato over a note that is not the nearest head (a chord's other note is): the column's.
    const over = { event: "r1", note: "nX", left: null, right: null, column: "nC", mark: null };
    expect(choose([r("articStaccatoAbove", 0.9)], contextOf(box(300, 270), at()), over, null)).toMatchObject({ kind: "write", message: { eventId: "nC", mark: { kind: "articulation", artic: "stacc" } } });
    expect(choose([r("fing2", 0.9)], contextOf(box(300, 270), at({ nearestNote: null })), over, null)).toMatchObject({ kind: "write", message: { eventId: "nC", mark: { kind: "fingering", finger: "2" } } });
    // Nothing before it: a dot right of nothing belongs nowhere.
    expect(choose([r("augmentationDot", 0.9)], contextOf(box(320, 302), at({ nearestNote: null })), targets, null)).toMatchObject({ kind: "nothing" });
    // A write carries the other answers, for the ✗.
    const o = choose([r("accidentalSharp", 0.9), r("fing2", 0.3), r("accidentalNatural", 0.08)], contextOf(box(280, 300), at()), targets, null);
    expect(o.kind === "write" && o.options.map((x) => x.label)).toEqual(["accidentalSharp", "accidentalNatural"]);
  });

  it("a drawn note is entered over the event at its head's pitch with the class's duration", () => {
    expect(choose([r("noteQuarter", 0.95)], contextOf(box(300, 300, 10, 40), at()), targets, { pname: "g", oct: 4 })).toMatchObject({ kind: "write", name: "quarter note", message: { type: "core.enterNote", eventId: "r1", pname: "g", oct: 4, dur: "4" } });
    expect(choose([r("note8th", 0.95)], contextOf(box(300, 300, 10, 40), at()), targets, null)).toMatchObject({ kind: "nothing", reason: /no pitch under the notehead/ });
  });

  it("asks below the threshold, offering only the answers that belong there, by confidence", () => {
    const top = [r("accidentalNatural", 0.15), r("fing1", 0.45), r("accidentalFlat", 0.4), r("dynamicPiano", 0.12), r("accidentalSharp", 0.35)];
    const o = choose(top, contextOf(box(280, 300), at()), targets, null);
    expect(o.kind).toBe("choose");
    // Inside the staff beside a note: the accidentals; neither the fingering nor the dynamic, however sure.
    if (o.kind === "choose") expect(o.options.map((x) => x.label)).toEqual(["accidentalFlat", "accidentalSharp", "accidentalNatural"]);
    expect(CHOICES).toBe(3);
    expect(choose([r("accidentalFlat", THRESHOLD)], contextOf(box(280, 300), at()), targets, null).kind).toBe("write");
  });

  it("says what it cannot write: a class the table lacks (the user's list: the barline, the pedal, the double flat, the other rests), a mark with no note beside it, a class it does not know", () => {
    for (const label of ["barlineSingle", "pedal", "accidentalDoubleFlat", "accidentalDoubleSharp", "restWholeHalf", "rest8th", "dynamicZ", "dynamicMezzo", "note32nd"]) {
      expect(writeAs(label, 0.9, targets, null)).toMatchObject({ kind: "nothing", reason: /not a symbol the editor knows/ });
      expect(choose([r(label, 0.9)], contextOf(box(300, 300), at()), targets, null)).toMatchObject({ kind: "nothing" });
    }
    const alone = { ...targets, note: null };
    expect(writeAs("augmentationDot", 0.9, alone, null)).toMatchObject({ kind: "nothing", reason: /needs a note before it/ });
    expect(writeAs("accidentalSharp", 0.9, alone, null)).toMatchObject({ kind: "nothing", reason: /needs a note after it/ });
    expect(writeAs("arpeg", 0.9, alone, null)).toMatchObject({ kind: "nothing", reason: /needs a note after it/ });
    expect(writeAs("trill", 0.9, alone, null)).toMatchObject({ kind: "nothing", reason: /needs a note under or over it/ });
    expect(writeAs("dynamicForte", 0.9, { ...alone, event: null }, null)).toMatchObject({ kind: "nothing", reason: /needs an event under it/ });
    expect(writeAs("nope", 0.9, targets, null)).toMatchObject({ kind: "nothing" });
    // The chooser's pick writes regardless of where the symbol sat.
    expect(writeAs("accidentalFlat", 0.4, targets, null)).toMatchObject({ kind: "write", name: "flat" });
    expect(nameOf("restQuarter")).toBe("erase");
    expect(nameOf("unknown")).toBe("unknown");
  });
});

describe("the head of a drawn note", () => {
  const symbol = (strokes: [number, number][][]): Symbol => {
    const pts = strokes.flat();
    return { strokes, box: { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])) }, landing: { point: pts[0]!, at: at() } };
  };

  it("is the end with more of the pen's samples for a stemmed note, the centre for a stemless one", () => {
    const stemUp = symbol([[[100, 100], [103, 103], [100, 106], [97, 103], [100, 100]], [[103, 103], [103, 60]]]);
    const [x, y] = headOf(stemUp, 10);
    expect(x).toBeCloseTo(100.5, 1);
    expect(y).toBeCloseTo(102.5, 1);
    const stemDown = symbol([[[100, 60], [103, 63], [100, 66], [97, 63], [100, 60]], [[97, 63], [97, 106]]]);
    expect(headOf(stemDown, 10)[1]).toBeCloseTo(62.4, 0);
    expect(headOf(symbol([[[100, 100], [110, 110]]]), 10)).toEqual([105, 105]);
  });
});
