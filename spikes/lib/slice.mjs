/**
 * Shared slice-synthesis helpers for the Phase 0 spikes.
 *
 * A "slice" is a synthetic MEI document containing the scoreDef context plus a
 * window of measures — what a tile render will consume in the real editor.
 * Phase 0 uses the *initial* scoreDef only; the effective-context resolver
 * (clef/key/meter changes mid-piece) is Phase 1 work in @battuta/core.
 */
import { readFileSync } from "node:fs";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const MEI_NS = "http://www.music-encoding.org/ns/mei";

export function parseMei(path) {
  const xml = readFileSync(path, "utf8");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return { xml, doc };
}

function firstByTag(node, tag) {
  const list = node.getElementsByTagName(tag);
  return list.length > 0 ? list.item(0) : null;
}

/**
 * The performed score lives under <music>; headers may embed an <incip> with
 * its own <score>, so never take the document-wide first <score>.
 */
function getBodyScore(doc) {
  const music = firstByTag(doc, "music");
  if (!music) throw new Error("no <music> found");
  const score = firstByTag(music, "score");
  if (!score) throw new Error("no <score> under <music>");
  return score;
}

/** All <measure> elements of the first <mdiv>'s <score>, in document order. */
export function getMeasures(doc) {
  const measures = getBodyScore(doc).getElementsByTagName("measure");
  return Array.from({ length: measures.length }, (_, i) => measures.item(i));
}

export function getScoreDef(doc) {
  const scoreDef = firstByTag(getBodyScore(doc), "scoreDef");
  if (!scoreDef) throw new Error("no <scoreDef> found");
  return scoreDef;
}

const serializer = new XMLSerializer();

/**
 * Build a standalone MEI document from a scoreDef and a run of measures.
 * Returns the serialized XML string.
 */
export function synthesizeSlice(scoreDef, measures) {
  const scoreDefXml = serializer.serializeToString(scoreDef);
  const measuresXml = measures.map((m) => serializer.serializeToString(m)).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="${MEI_NS}" meiversion="5.0">
  <music>
    <body>
      <mdiv>
        <score>
          ${scoreDefXml}
          <section>
            ${measuresXml}
          </section>
        </score>
      </mdiv>
    </body>
  </music>
</mei>`;
}

/** Collect xml:id values of interest inside an element (notation events). */
export function collectIds(el, tags = ["measure", "staff", "layer", "note", "rest", "chord", "beam", "tuplet", "mRest", "space", "clef", "verse", "syl"]) {
  const ids = new Map(); // id -> tag
  for (const tag of tags) {
    const list = el.getElementsByTagName(tag);
    for (let i = 0; i < list.length; i++) {
      const id = list.item(i).getAttribute("xml:id");
      if (id) ids.set(id, tag);
    }
  }
  const own = el.getAttribute && el.getAttribute("xml:id");
  if (own) ids.set(own, el.tagName);
  return ids;
}

/** Verovio options for tile-style rendering (single system, tight box). */
export const TILE_OPTIONS = {
  breaks: "none",
  adjustPageWidth: true,
  adjustPageHeight: true,
  header: "none",
  footer: "none",
  pageMarginLeft: 20,
  pageMarginRight: 20,
  pageMarginTop: 20,
  pageMarginBottom: 20,
  svgViewBox: true,
  scale: 40,
};

/** Verovio options for full-document paged rendering (page view). */
export const PAGE_OPTIONS = {
  breaks: "auto",
  header: "none",
  footer: "none",
  scale: 40,
};
