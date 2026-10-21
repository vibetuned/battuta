/**
 * pdfMissing(): what pdf.js calls with no fallback, read from the running
 * system — the real module (its library loads only inside renderPdf).
 */
import { describe, it, expect } from "vitest";
import { pdfMissing } from "../src/pdf";

describe("pdfMissing", () => {
  it("names what the system lacks, and only that", () => {
    const math = Math as unknown as Record<string, unknown>;
    const had = math["sumPrecise"];
    math["sumPrecise"] = (values: Iterable<number>) => [...values].reduce((a, b) => a + b, 0);
    try {
      const before = pdfMissing();
      expect(before).not.toContain("Math.sumPrecise");
      delete math["sumPrecise"];
      expect(pdfMissing()).toEqual([...before, "Math.sumPrecise"]);
    } finally {
      if (had === undefined) delete math["sumPrecise"];
      else math["sumPrecise"] = had;
    }
  });
});
