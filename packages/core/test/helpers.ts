import { DOMParser } from "@xmldom/xmldom";
import { fromDom, buildScore, resolveContexts, type CoreElement, type DomLikeElement, type CoreScore, type MeasureContext } from "../src/index.js";

export function parse(xml: string): CoreElement {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return fromDom(doc.documentElement as unknown as DomLikeElement);
}

export function scoreFrom(xml: string): { score: CoreScore; contexts: MeasureContext[] } {
  const score = buildScore(parse(xml));
  return { score, contexts: resolveContexts(score) };
}

/** Minimal two-staff MEI document builder for resolver tests. */
export function mei(bodyContent: string, scoreDefAttrs = `meter.count="4" meter.unit="4" keysig="0"`): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
  <music><body><mdiv><score>
    <scoreDef ${scoreDefAttrs}>
      <staffGrp symbol="brace">
        <label>Piano</label>
        <staffDef n="1" lines="5" clef.shape="G" clef.line="2"/>
        <staffDef n="2" lines="5" clef.shape="F" clef.line="4"/>
      </staffGrp>
    </scoreDef>
    <section>
      ${bodyContent}
    </section>
  </score></mdiv></body></music>
</mei>`;
}

export function measure(n: number, content = ""): string {
  return `<measure n="${n}" xml:id="m${n}">
    <staff n="1"><layer n="1">${content || `<note pname="c" oct="4" dur="1" xml:id="m${n}s1n1"/>`}</layer></staff>
    <staff n="2"><layer n="1"><note pname="c" oct="3" dur="1" xml:id="m${n}s2n1"/></layer></staff>
  </measure>`;
}
