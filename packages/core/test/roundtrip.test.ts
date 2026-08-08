/**
 * Round-trip hardening (Phase 4): preserve-unknown-verbatim over the corpus,
 * serialization fixpoint, and id stability across save/load.
 * True byte-identity with arbitrary third-party formatting is impossible
 * (attribute order, whitespace); the practical guarantees tested here:
 *  1. parse -> serialize -> parse -> serialize is a FIXPOINT (byte-identical
 *     from the first serialization on), so saves are stable.
 *  2. No content is lost: unknown elements, attributes, comments, and
 *     processing instructions survive; tree equality holds across cycles.
 *  3. Ids: everything the editor assigned is written out, so a reloaded
 *     document needs zero new ids and addresses the same elements.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import { scoreFrom } from "./helpers.js";
import { parse } from "./helpers.js";
import { fromDom, serializeDocument, buildScore, ensureIds, findAll, newId, serializePretty, buildEventIndex, RegenerateIdsCommand, type CoreElement, type DomLikeElement, type DomLikeNode } from "../src/index.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

/** Parse a document the way the editor does: prologue + root tree. */
function parseDocument(xml: string): { root: CoreElement; prologue: CoreElement[] } {
  const doc = new DOMParser().parseFromString(xml, "application/xml") as unknown as { childNodes: { length: number; item(i: number): DomLikeNode | null }; documentElement: DomLikeElement };
  const prologue: CoreElement[] = [];
  for (let i = 0; i < doc.childNodes.length; i++) {
    const node = doc.childNodes.item(i);
    if (!node) continue;
    // Skip the source's own <?xml?> declaration (some parsers expose it as a
    // document-level PI); serializeDocument always writes a fresh one.
    if (node.nodeType === 7 && (node as DomLikeElement).nodeName !== "xml") {
      prologue.push({ tag: "#pi", attrs: { target: (node as DomLikeElement).nodeName }, children: [node.nodeValue ?? ""] });
    } else if (node.nodeType === 8) prologue.push({ tag: "#comment", attrs: {}, children: [node.nodeValue ?? ""] });
  }
  return { root: fromDom(doc.documentElement), prologue };
}

const corpus = readdirSync(fixtures).filter((f) => f.endsWith(".mei"));

describe("corpus round-trip", () => {
  it.each(corpus)("%s: serialization is a fixpoint and loses no content", (name) => {
    const original = readFileSync(join(fixtures, name), "utf8");
    const p1 = parseDocument(original);
    const out1 = serializeDocument(p1.root, p1.prologue);
    const p2 = parseDocument(out1);
    const out2 = serializeDocument(p2.root, p2.prologue);
    expect(out2).toBe(out1); // fixpoint
    expect(JSON.stringify(p2.root)).toBe(JSON.stringify(p1.root)); // no content lost
  });

  it.each(corpus)("%s: ids are stable across save/load", (name) => {
    const original = readFileSync(join(fixtures, name), "utf8");
    const p1 = parseDocument(original);
    const score1 = buildScore(p1.root);
    ensureIds(score1.scoreDef);
    for (const m of score1.measures) ensureIds(m);
    const noteIds1 = score1.measures.flatMap((m) => findAll(m, "note").map((n) => n.attrs["xml:id"]));

    const saved = serializeDocument(p1.root, p1.prologue);
    const p2 = parseDocument(saved);
    const score2 = buildScore(p2.root);
    let assigned = 0;
    assigned += ensureIds(score2.scoreDef);
    for (const m of score2.measures) assigned += ensureIds(m);
    expect(assigned).toBe(0); // reload needs no new ids
    const noteIds2 = score2.measures.flatMap((m) => findAll(m, "note").map((n) => n.attrs["xml:id"]));
    expect(noteIds2).toEqual(noteIds1);
  });
});

describe("unknown-content preservation", () => {
  it("keeps unknown elements, attributes, comments, and PIs verbatim", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-model href="https://music-encoding.org/schema/5.0/mei-all.rng" type="application/xml"?>
<!-- license header -->
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
<meiHead><fileDesc><titleStmt><title>t</title></titleStmt><pubStmt/></fileDesc><futureThing xmlns:x="urn:x" x:weird="1"><nested attr="a">text</nested></futureThing></meiHead>
<music><body><mdiv><score>
<scoreDef><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef>
<section><!-- inline comment --><measure n="1"><staff n="1"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="n1"/></layer></staff></measure></section>
</score></mdiv></body></music>
</mei>`;
    const p1 = parseDocument(xml);
    const out = serializeDocument(p1.root, p1.prologue);
    expect(out).toContain("xml-model");
    expect(out).toContain("<!-- license header -->");
    expect(out).toContain("<!-- inline comment -->");
    expect(out).toContain(`x:weird="1"`);
    expect(out).toContain(`<nested attr="a">text</nested>`);
    expect(out).toContain(`xmlns="http://www.music-encoding.org/ns/mei"`);
    const p2 = parseDocument(out);
    expect(serializeDocument(p2.root, p2.prologue)).toBe(out);
  });
});

describe("random ids and regeneration", () => {
  it("newId is random, well-formed, and does not collide at document scale", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const id = newId();
      expect(/^bt-[0-9a-z]{8}$/.test(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it("RegenerateIdsCommand rewrites every id AND the references to them", () => {
    const { score } = scoreFrom(`<?xml version="1.0"?>
<mei xmlns="http://www.music-encoding.org/ns/mei">
  <music><body><mdiv><score>
    <scoreDef meter.count="4" meter.unit="4"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef>
    <section>
      <measure n="1" xml:id="dup">
        <staff n="1"><layer n="1"><note pname="c" oct="4" dur="2" xml:id="a1"/><note pname="d" oct="4" dur="2" xml:id="dup"/></layer></staff>
        <slur startid="#a1" endid="#dup"/>
        <arpeg plist="#a1 #dup" staff="1"/>
      </measure>
    </section>
  </score></mdiv></body></music></mei>`);
    const cmd = new RegenerateIdsCommand();
    const before = serializePretty(score.scoreEl);
    cmd.apply({ score, index: buildEventIndex(score) });
    expect(cmd.count).toBe(3); // the three explicitly-identified elements
    const ids = new Set<string>();
    const walk = (el: CoreElement): void => {
      const id = el.attrs["xml:id"];
      if (id) {
        expect(ids.has(id)).toBe(false); // duplicates repaired
        ids.add(id);
      }
      for (const c of el.children) if (typeof c !== "string") walk(c);
    };
    walk(score.scoreEl);
    // references follow the map (slur/arpeg point at real, fresh ids)
    const slur = findAll(score.scoreEl, "slur")[0]!;
    for (const ref of [slur.attrs["startid"], slur.attrs["endid"]]) {
      expect(ids.has(ref!.slice(1))).toBe(true);
    }
    const plist = findAll(score.scoreEl, "arpeg")[0]!.attrs["plist"]!;
    for (const tok of plist.split(" ")) expect(ids.has(tok.slice(1))).toBe(true);
    cmd.revert({ score, index: buildEventIndex(score) });
    expect(serializePretty(score.scoreEl)).toBe(before);
  });

  it("pretty save is a fixpoint and keeps mixed content compact", () => {
    const xml = `<?xml version="1.0"?>
<mei xmlns="http://www.music-encoding.org/ns/mei">
  <music><body><mdiv><score>
    <scoreDef meter.count="4" meter.unit="4"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef>
    <section><measure n="1"><staff n="1"><layer n="1"><note pname="c" oct="4" dur="1" xml:id="p1"/></layer></staff><harm startid="#p1" staff="1">Cmaj7</harm></measure></section>
  </score></mdiv></body></music></mei>`;
    const root = fromDom(new DOMParser().parseFromString(xml, "application/xml").documentElement as unknown as DomLikeElement);
    const once = serializeDocument(root);
    expect(once).toContain("\n  <music>"); // actually indented
    expect(once).toContain(">Cmaj7</harm>"); // text content stays inline
    const again = serializeDocument(fromDom(new DOMParser().parseFromString(once, "application/xml").documentElement as unknown as DomLikeElement));
    expect(again).toBe(once);
  });

});
