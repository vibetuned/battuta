/**
 * What "+ score" writes: the same blank score as the editor's "+" tab —
 * one treble staff, 4/4, four measures of rest — with the title taken from
 * the file's name, so page view prints something better than "Untitled".
 * The editor's template lives in App.tsx and a plugin cannot import it;
 * `test/blank.test.ts` pins this one's shape, so the two cannot drift
 * apart silently.
 */
const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function blankScore(title: string): string {
  const measures = Array.from({ length: 4 }, (_, i) => `      <measure n="${i + 1}"><staff n="1"><layer n="1"><mRest/></layer></staff></measure>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
  <meiHead><fileDesc><titleStmt><title>${escapeXml(title)}</title></titleStmt><pubStmt/></fileDesc></meiHead>
  <music><body><mdiv><score>
    <scoreDef meter.count="4" meter.unit="4" keysig="0">
      <staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp>
    </scoreDef>
    <section>
${measures}
    </section>
  </score></mdiv></body></music></mei>
`;
}
