/**
 * The blank score "+ score" writes, held to the editor's "+" tab template
 * (App.tsx's blankScore): one treble staff, 4/4, four measures of rest —
 * and well-formed, with the title escaped. The editor opening it for real
 * is verify-folder-view.mjs's (the browser) and verify-tauri.sh probe7's
 * (the shell).
 */
import { describe, it, expect } from "vitest";
import { blankScore } from "../src/blank";

/** Element names in document order with a stack: throws on a mismatched close. Enough for a template with no comments or CDATA. */
function wellFormed(xml: string): string[] {
  const stack: string[] = [];
  const seen: string[] = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([A-Za-z][\w.:-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , selfClose] = m;
    if (close) {
      const open = stack.pop();
      if (open !== name) throw new Error(`</${name}> closes <${open}>`);
    } else {
      seen.push(name!);
      if (!selfClose) stack.push(name!);
    }
  }
  if (stack.length) throw new Error(`unclosed: ${stack.join(", ")}`);
  return seen;
}

describe("blankScore", () => {
  it("is the editor's blank: one treble staff, 4/4, four measures of rest, MEI 5", () => {
    const xml = blankScore("Etude");
    const names = wellFormed(xml);
    expect(names[0]).toBe("mei");
    expect(xml).toContain('meiversion="5.0"');
    expect(xml).toContain('meter.count="4" meter.unit="4"');
    expect(xml).toContain('clef.shape="G" clef.line="2"');
    expect(names.filter((n) => n === "staffDef")).toHaveLength(1);
    expect(names.filter((n) => n === "measure")).toHaveLength(4);
    expect(names.filter((n) => n === "mRest")).toHaveLength(4);
    expect(xml).toContain("<title>Etude</title>");
  });

  it("escapes the title", () => {
    const xml = blankScore(`Rondo <"alla turca"> & co`);
    expect(xml).toContain("<title>Rondo &lt;&quot;alla turca&quot;&gt; &amp; co</title>");
    expect(() => wellFormed(xml)).not.toThrow();
  });
});
