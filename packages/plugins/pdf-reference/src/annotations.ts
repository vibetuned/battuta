/**
 * The OMR annotation files: one JSON per page of the PDF — `{ image, width,
 * height, annotations: [{ class, bbox: [x0, y0, x1, y1], id }] }` — the
 * boxes in PIXELS of the page image they were made on (2100 × 2970 for A4
 * at 254 dpi in the examples), each keyed by the MEI id of what it boxes.
 * A piece's `graph.json` (its `nodes` carry the same boxes with a `page`)
 * is read when no page file is given.
 *
 * Of all the classes, two place a measure: `measure` (its box, across every
 * staff) and `system` (the line it sits in). A measure belongs to the
 * system it overlaps most; reading order is page, then system top to
 * bottom, then left to right — which is the order an engraving's measures
 * come in, and the order a score's measures are matched in when their ids
 * are not the annotated ones.
 */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface AnnotatedMeasure {
  /** The MEI id the box was annotated with, or null. */
  id: string | null;
  /** 1-based page of the PDF. */
  page: number;
  /** 0-based system on its page, top to bottom. */
  system: number;
  /** The measure's box, in its page's annotation pixels. */
  box: Box;
  /** The box of the system it sits in. */
  systemBox: Box;
  /** 0-based position in reading order across the piece. */
  order: number;
}

export interface AnnotatedPage {
  page: number;
  /** The annotation image's size; null when only a graph was given (then the rendered page is taken to be the same image). */
  width: number | null;
  height: number | null;
  systems: Box[];
  /** Per system (same index), its staves top to bottom — `system-staff` boxes from the files, the splits of a drawing; empty when unknown. */
  staves: Box[][];
  measures: AnnotatedMeasure[];
}

export interface Annotations {
  pages: AnnotatedPage[];
  /** Every measure in reading order. */
  measures: AnnotatedMeasure[];
  byId: ReadonlyMap<string, AnnotatedMeasure>;
}

/** A file as the panel hands it over. */
export interface TextFile {
  name: string;
  text: string;
}

interface Raw {
  class?: unknown;
  bbox?: unknown;
  id?: unknown;
  page?: unknown;
}

export function boxOf(b: unknown): Box | null {
  if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const [a, c, d, e] = b as [number, number, number, number];
  return { x0: Math.min(a, d), y0: Math.min(c, e), x1: Math.max(a, d), y1: Math.max(c, e) };
}

/** The page a file annotates: `…_page2.json` by its name, else `…_page2.png` in its `image`. */
export function pageNumberOf(fileName: string, json: unknown): number | null {
  const byName = /_page(\d+)\.json$/i.exec(fileName);
  if (byName) return Number(byName[1]);
  const image = (json as { image?: unknown } | null)?.image;
  if (typeof image === "string") {
    const byImage = /_page(\d+)\.[a-z0-9]+$/i.exec(image);
    if (byImage) return Number(byImage[1]);
  }
  return null;
}

const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Rows of measures by vertical overlap — the systems, when none were annotated. */
function rowsOfMeasures(boxes: Box[]): Box[] {
  const rows: Box[] = [];
  for (const b of [...boxes].sort((p, q) => p.y0 - q.y0)) {
    const row = rows.find((r) => overlap(r, b) > 0.5 * Math.min(r.y1 - r.y0, b.y1 - b.y0));
    if (row) {
      row.x0 = Math.min(row.x0, b.x0);
      row.y0 = Math.min(row.y0, b.y0);
      row.x1 = Math.max(row.x1, b.x1);
      row.y1 = Math.max(row.y1, b.y1);
    } else rows.push({ ...b });
  }
  return rows.sort((p, q) => p.y0 - q.y0);
}

/** One page: its systems top to bottom, each measure in the system it overlaps most, measures in reading order (`order` is set by `readAnnotations`). */
export function pageFrom(page: number, width: number | null, height: number | null, raws: readonly Raw[]): AnnotatedPage {
  const measureBoxes = raws.flatMap((r) => {
    const box = r.class === "measure" ? boxOf(r.bbox) : null;
    return box ? [{ id: typeof r.id === "string" && r.id ? r.id : null, box }] : [];
  });
  let systems = raws.flatMap((r) => {
    const box = r.class === "system" ? boxOf(r.bbox) : null;
    return box ? [box] : [];
  });
  systems.sort((p, q) => p.y0 - q.y0);
  if (systems.length === 0) systems = rowsOfMeasures(measureBoxes.map((m) => m.box));
  const measures = measureBoxes
    .map((m) => {
      let best = 0;
      let most = -1;
      systems.forEach((s, i) => {
        const o = overlap(m.box, s);
        if (o > most) {
          most = o;
          best = i;
        }
      });
      return { id: m.id, page, system: best, box: m.box, systemBox: systems[best] ?? m.box, order: 0 };
    })
    .sort((p, q) => p.system - q.system || p.box.x0 - q.box.x0);
  // Each `system-staff` box in the system it overlaps most, top to bottom.
  const staves: Box[][] = systems.map(() => []);
  for (const r of raws) {
    const box = r.class === "system-staff" ? boxOf(r.bbox) : null;
    if (!box || systems.length === 0) continue;
    let best = 0;
    let most = -1;
    systems.forEach((s, i) => {
      const o = overlap(box, s);
      if (o > most) {
        most = o;
        best = i;
      }
    });
    if (most > 0) staves[best]!.push(box);
  }
  for (const list of staves) list.sort((p, q) => p.y0 - q.y0);
  return { page, width, height, systems, staves, measures };
}

/**
 * Read whatever annotation files were given. Page files win; a graph is
 * used only without them. Every file that cannot be used says why in
 * `notes`, and the rest are still read.
 */
export function readAnnotations(files: readonly TextFile[]): { annotations: Annotations | null; notes: string[] } {
  const notes: string[] = [];
  const pages = new Map<number, AnnotatedPage>();
  const graphs: { name: string; nodes: Raw[] }[] = [];
  for (const f of files) {
    let json: unknown;
    try {
      json = JSON.parse(f.text);
    } catch {
      notes.push(`${f.name} is not JSON`);
      continue;
    }
    const o = json as { annotations?: unknown; nodes?: unknown; width?: unknown; height?: unknown };
    if (Array.isArray(o.annotations)) {
      const page = pageNumberOf(f.name, json);
      if (page === null) {
        notes.push(`${f.name}: cannot tell which page it annotates (expected …_page<N>.json)`);
        continue;
      }
      if (pages.has(page)) notes.push(`page ${page} was given twice; ${f.name} is used`);
      pages.set(page, pageFrom(page, typeof o.width === "number" ? o.width : null, typeof o.height === "number" ? o.height : null, o.annotations as Raw[]));
    } else if (Array.isArray(o.nodes)) graphs.push({ name: f.name, nodes: o.nodes as Raw[] });
    else notes.push(`${f.name} is not an annotation file`);
  }
  if (pages.size === 0 && graphs.length > 0) {
    const g = graphs[0]!;
    const byPage = new Map<number, Raw[]>();
    for (const n of g.nodes) {
      const p = typeof n.page === "number" ? n.page : null;
      if (p === null) continue;
      byPage.set(p, [...(byPage.get(p) ?? []), n]);
    }
    for (const [p, nodes] of byPage) pages.set(p, pageFrom(p, null, null, nodes));
  } else if (graphs.length > 0) notes.push(`${graphs.map((g) => g.name).join(", ")} not needed: the page files carry the same boxes`);
  if (pages.size === 0) return { annotations: null, notes };
  const ordered = [...pages.values()].sort((a, b) => a.page - b.page);
  const measures: AnnotatedMeasure[] = [];
  for (const p of ordered) for (const m of p.measures) measures.push(Object.assign(m, { order: measures.length }));
  const byId = new Map<string, AnnotatedMeasure>();
  for (const m of measures) if (m.id !== null && !byId.has(m.id)) byId.set(m.id, m);
  return { annotations: { pages: ordered, measures, byId }, notes };
}
