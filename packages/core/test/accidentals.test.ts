import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEventIndex, serialize, findAll, keyFifths, writtenAccid, gesturalAccid, syncGesturalAccidentals, WithGesturalAccidentals, alterationsBefore, spellMidi,
  ToggleAccidentalCommand, TransposeStepCommand, ReplaceEntryCommand, resolveContexts, type CoreElement,
} from "../src/index.js";
import { scoreFrom, mei } from "./helpers.js";

const inKey = (keysig: string) => `meter.count="4" meter.unit="4" keysig="${keysig}"`;
const noteIn = (root: CoreElement) => (id: string) => findAll(root, "note").find((n) => n.attrs["xml:id"] === id)!;
/** Sync a document, then read each note's gestural accidental. */
const gesOf = (body: string, keysig: string) => {
  const { score, contexts } = scoreFrom(mei(body, inKey(keysig)));
  syncGesturalAccidentals(score, contexts);
  const note = noteIn(score.scoreEl);
  return (id: string) => gesturalAccid(note(id));
};

describe("keyFifths", () => {
  it("reads MEI keysig values", () => {
    expect([keyFifths("0"), keyFifths("1f"), keyFifths("3s"), keyFifths("7f"), keyFifths("mixed")]).toEqual([0, -1, 3, -7, 0]);
  });
});

describe("syncGesturalAccidentals (@accid.ges in the document)", () => {
  it("gives unmarked notes their key signature, takes a wrong one away, leaves written ones alone", () => {
    const ges = gesOf(`<measure n="1" xml:id="m1"><staff n="1"><layer n="1">
      <note xml:id="b" pname="b" oct="4" dur="4"/><note xml:id="c" pname="c" oct="5" dur="4"/>
      <note xml:id="bn" pname="b" oct="3" dur="4" accid="n"/><note xml:id="e" pname="e" oct="4" dur="4" accid.ges="f"/>
    </layer></staff></measure>`, "1f");
    expect([ges("b"), ges("c"), ges("bn"), ges("e")]).toEqual(["f", undefined, undefined, undefined]);
  });

  it("lets a written accidental hold for the rest of the measure — same letter and octave, any layer", () => {
    const ges = gesOf(`<measure n="1" xml:id="m1"><staff n="1">
      <layer n="1"><note xml:id="a1" pname="b" oct="4" dur="4" accid="n"/><note xml:id="a2" pname="b" oct="4" dur="4"/><note xml:id="a3" pname="b" oct="5" dur="2"/></layer>
      <layer n="2"><note xml:id="l2" pname="b" oct="4" dur="2"/><note xml:id="l2b" pname="b" oct="4" dur="2"/></layer>
    </staff></measure>
    <measure n="2" xml:id="m2"><staff n="1"><layer n="1"><note xml:id="next" pname="b" oct="4" dur="1"/></layer></staff></measure>`, "1f");
    // l2 sounds WITH a1 (same onset, a1 first in layer order): the natural holds
    expect([ges("a2"), ges("a3"), ges("l2"), ges("l2b"), ges("next")]).toEqual([undefined, "f", undefined, undefined, "f"]);
  });

  it("carries a tie across the barline — @tie chains and <tie> elements — and reads <accid> children", () => {
    const ges = gesOf(`<measure n="1" xml:id="m1"><staff n="1"><layer n="1">
      <note xml:id="w" pname="c" oct="5" dur="4"><accid accid="s"/></note><note xml:id="t1" pname="c" oct="5" dur="4" tie="i"/>
      <note xml:id="f1" pname="f" oct="4" dur="2" accid="s"/>
    </layer></staff><tie startid="#f1" endid="#f2"/></measure>
    <measure n="2" xml:id="m2"><staff n="1"><layer n="1">
      <note xml:id="t2" pname="c" oct="5" dur="4" tie="t"/><note xml:id="y" pname="c" oct="5" dur="4"/><note xml:id="f2" pname="f" oct="4" dur="2"/>
    </layer></staff></measure>`, "0");
    // the sharp holds to t1, the ties carry it (and f1's) over the barline, the next C is plain again
    expect([ges("w"), ges("t1"), ges("t2"), ges("y"), ges("f2")]).toEqual([undefined, "s", "s", undefined, "s"]);
  });

  it("follows key changes, chords and tuplets", () => {
    const ges = gesOf(`<measure n="1" xml:id="m1"><staff n="1"><layer n="1">
      <chord xml:id="ch" dur="2"><note xml:id="cf" pname="f" oct="4"/><note xml:id="cc" pname="c" oct="5"/></chord>
      <tuplet num="3" numbase="2"><note xml:id="u1" pname="f" oct="4" dur="4" accid="n"/><note xml:id="u2" pname="f" oct="4" dur="4"/><note xml:id="u3" pname="g" oct="4" dur="4"/></tuplet>
    </layer></staff></measure>
    <scoreDef keysig="3f"/>
    <measure n="2" xml:id="m2"><staff n="1"><layer n="1"><note xml:id="e" pname="e" oct="4" dur="1"/></layer></staff></measure>`, "2s");
    expect([ges("cf"), ges("cc"), ges("u2"), ges("u3"), ges("e")]).toEqual(["s", "s", undefined, undefined, "f"]);
  });

  it("writes into an <accid> child when the note has one, never beside it", () => {
    const { score, contexts } = scoreFrom(mei(`<measure n="1" xml:id="m1"><staff n="1"><layer n="1">
      <note xml:id="b" pname="b" oct="4" dur="2" accid.ges="n"><accid xml:id="ac"/></note><note xml:id="a" pname="a" oct="4" dur="2"/>
    </layer></staff></measure>`, inKey("1f")));
    syncGesturalAccidentals(score, contexts);
    const b = noteIn(score.scoreEl)("b");
    expect(b.attrs["accid.ges"]).toBeUndefined();
    expect(findAll(b, "accid")[0]!.attrs["accid.ges"]).toBe("f");
    expect(syncGesturalAccidentals(score, contexts).mementos).toHaveLength(0); // in step: a second pass changes nothing
  });
});

describe("WithGesturalAccidentals (every edit keeps them in step)", () => {
  const body = `<measure n="1" xml:id="m1"><staff n="1"><layer n="1">
    <note xml:id="n1" pname="b" oct="4" dur="4"/><note xml:id="n2" pname="b" oct="4" dur="4"/>
    <note xml:id="n3" pname="g" oct="4" dur="4"/><rest xml:id="r" dur="4"/>
  </layer></staff></measure>`;
  const setup = () => {
    const { score, contexts } = scoreFrom(mei(body, inKey("1f")));
    syncGesturalAccidentals(score, contexts);
    return { score, note: noteIn(score.scoreEl), ctx: () => ({ score, index: buildEventIndex(score) }) };
  };

  it("a written natural takes the flat off the notes after it, in the same undo step", () => {
    const { score, note, ctx } = setup();
    const before = serialize(score.scoreEl);
    expect([gesturalAccid(note("n1")), gesturalAccid(note("n2"))]).toEqual(["f", "f"]);
    const cmd = new WithGesturalAccidentals(new ToggleAccidentalCommand(["n1"], "n"));
    cmd.apply(ctx());
    expect([writtenAccid(note("n1")), gesturalAccid(note("n1")), gesturalAccid(note("n2"))]).toEqual(["n", undefined, undefined]);
    cmd.revert(ctx());
    expect(serialize(score.scoreEl)).toBe(before);
  });

  it("an entered note gets its gestural accidental with the entry", () => {
    const { note, ctx, score } = setup();
    const entry = new ReplaceEntryCommand("r", { kind: "note", pname: "b", oct: 4, dur: "4" });
    new WithGesturalAccidentals(entry).apply(ctx());
    const entered = findAll(score.scoreEl, "note").find((n) => !["n1", "n2", "n3"].includes(n.attrs["xml:id"]!))!;
    expect(gesturalAccid(entered)).toBe("f");
    expect(gesturalAccid(note("n3"))).toBeUndefined();
  });

  it("a step transposition re-derives it, the <accid> child included", () => {
    const { score, contexts } = scoreFrom(mei(`<measure n="1" xml:id="m1"><staff n="1"><layer n="1">
      <note xml:id="x" pname="a" oct="4" dur="1"><accid accid="s"/></note>
    </layer></staff></measure>`, inKey("1f")));
    syncGesturalAccidentals(score, contexts);
    new WithGesturalAccidentals(new TransposeStepCommand(["x"], 1)).apply({ score, index: buildEventIndex(score) });
    const x = noteIn(score.scoreEl)("x");
    // a♯ up a step is a plain B: the key's flat, gestural, in the child
    expect([x.attrs["pname"], writtenAccid(x), gesturalAccid(x), x.attrs["accid"], x.attrs["accid.ges"]]).toEqual(["b", undefined, "f", undefined, undefined]);
  });

  it("toggles an accidental in the <accid> child, never a second one on the note", () => {
    const { score, contexts } = scoreFrom(mei(`<measure n="1" xml:id="m1"><staff n="1"><layer n="1">
      <note xml:id="x" pname="f" oct="4" dur="1"><accid accid="s"/></note>
    </layer></staff></measure>`, inKey("0")));
    syncGesturalAccidentals(score, contexts);
    new WithGesturalAccidentals(new ToggleAccidentalCommand(["x"], "n")).apply({ score, index: buildEventIndex(score) });
    const x = noteIn(score.scoreEl)("x");
    expect([x.attrs["accid"], findAll(x, "accid")[0]!.attrs["accid"]]).toEqual([undefined, "n"]);
  });
});

// The corpus lives outside the repo (fixtures/ is local-only).
const brandenburg = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/Bach-JS_BrandenburgConcert_No2_I_BWV1047.mei");
describe.runIf(existsSync(brandenburg))("against a real encoding", () => {
  it("re-derives every one of the Brandenburg's 971 encoded gestural accidentals, and adds none", () => {
    const { score } = scoreFrom(readFileSync(brandenburg, "utf8"));
    const notes = findAll(score.scoreEl, "note");
    const encoded = new Map(notes.map((n) => [n, gesturalAccid(n)]));
    for (const n of notes) delete n.attrs["accid.ges"];
    syncGesturalAccidentals(score, resolveContexts(score));
    const differ = notes.filter((n) => gesturalAccid(n) !== encoded.get(n));
    expect([...encoded.values()].filter(Boolean)).toHaveLength(971);
    expect(differ.map((n) => n.attrs["xml:id"])).toEqual([]);
  });
});

describe("spellMidi (MIDI entry)", () => {
  const plain = () => 0;
  const spell = (midi: number, keysig: string, at: (p: string, o: number) => number = (p) => (keysig === "1f" && p === "b" ? -1 : 0)) => spellMidi(midi, keyFifths(keysig), at);

  it("under one flat: B♭ is a plain B, B is B♮ written", () => {
    expect(spell(70, "1f")).toEqual({ pname: "b", oct: 4 });
    expect(spell(71, "1f")).toEqual({ pname: "b", oct: 4, accid: "n" });
    expect(spell(61, "1f")).toEqual({ pname: "c", oct: 4, accid: "s" }); // D minor's leading tone
    expect(spell(63, "1f")).toEqual({ pname: "e", oct: 4, accid: "f" });
  });

  it("in C: C♯ E♭ F♯ G♯ B♭, white keys plain", () => {
    expect([61, 63, 66, 68, 70].map((m) => spell(m, "0", plain)).map((p) => p.pname + p.accid)).toEqual(["cs", "ef", "fs", "gs", "bf"]);
    expect(spell(60, "0", plain)).toEqual({ pname: "c", oct: 4 });
  });

  it("sharp keys spell their own notes plain and the rest toward the key", () => {
    const d = (p: string) => (p === "f" || p === "c" ? 1 : 0);
    expect(spell(66, "2s", d)).toEqual({ pname: "f", oct: 4 });
    expect(spell(65, "2s", d)).toEqual({ pname: "f", oct: 4, accid: "n" });
    expect(spell(70, "2s", d)).toEqual({ pname: "a", oct: 4, accid: "s" }); // B minor's leading tone
    // a white key is its own letter: B major's G is G♮ (not F𝄪), E major's C is C♮ (not B♯)
    expect(spell(67, "5s", (p) => ("fcgda".includes(p) ? 1 : 0))).toEqual({ pname: "g", oct: 4, accid: "n" });
    expect(spell(60, "4s", (p) => ("fcgd".includes(p) ? 1 : 0))).toEqual({ pname: "c", oct: 4, accid: "n" });
    expect(spell(64, "6f", (p) => ("beadgc".includes(p) ? -1 : 0))).toEqual({ pname: "e", oct: 4, accid: "n" });
  });

  it("an accidental already in the measure wins: after B♮ under one flat, B is plain and B♭ needs its flat", () => {
    const afterNatural = () => 0;
    expect(spell(71, "1f", afterNatural)).toEqual({ pname: "b", oct: 4 });
    expect(spell(70, "1f", afterNatural)).toEqual({ pname: "b", oct: 4, accid: "f" });
  });

  it("octaves follow the letter (B♯3 / C♭5 sit across the octave line)", () => {
    expect(spell(60, "7s", () => 1)).toEqual({ pname: "b", oct: 3 }); // seven sharps: every letter sharp
    expect(spell(71, "7f", () => -1)).toEqual({ pname: "c", oct: 5 }); // seven flats: every letter flat
  });
});

describe("alterationsBefore", () => {
  it("reads the key, then written accidentals strictly before the event", () => {
    const { score, contexts } = scoreFrom(mei(`<measure n="1" xml:id="m1"><staff n="1"><layer n="1">
      <note xml:id="n1" pname="b" oct="4" dur="4"/><note xml:id="n2" pname="b" oct="4" dur="4" accid="n"/>
      <note xml:id="n3" pname="g" oct="4" dur="4"/><note xml:id="n4" pname="b" oct="4" dur="4"/>
    </layer></staff></measure>`, inKey("1f")));
    buildEventIndex(score);
    expect(alterationsBefore(score, contexts, 0, 1, "n2")("b", 4)).toBe(-1);
    expect(alterationsBefore(score, contexts, 0, 1, "n4")("b", 4)).toBe(0);
    expect(alterationsBefore(score, contexts, 0, 1, "n4")("b", 3)).toBe(-1);
  });
});
