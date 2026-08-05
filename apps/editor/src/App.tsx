import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { synthesizeTile, synthesizeRowHeader, contextHash, caretLeft, caretRight, caretVertical, eventRange, normalizeBlock, fragmentToText, type CaretPosition, type TileHeader, type BlockSelection, type ClipboardFragment } from "@battuta/core";
import { RenderPool, type TileResult } from "./render/renderPool";
import { DocumentSession } from "./session";

const FIXTURES = [
  "synthetic-context-changes.mei",
  "Bach-JS_Ein_feste_Burg.mei",
  "Beethoven_Hymn_to_joy.mei",
  "Bach-JS_BrandenburgConcert_No2_I_BWV1047.mei",
  "Beethoven_StringQuartet_Op18_No1.mei",
];

/** Clipboard shared across all open documents (module scope = app scope). */
let sharedClipboard: ClipboardFragment | null = null;

interface OpenDoc {
  id: number;
  name: string;
  session: DocumentSession;
}

interface TileState {
  /** Content key (context + measure + header variant), spacing-agnostic. */
  baseKey: string;
  /** Key of the variant currently displayed (baseKey, or baseKey-ssN). */
  displayKey: string;
  svg: string;
  ms: number;
  cached: boolean;
  /** viewBox dimensions, for uniform-scale display. */
  w: number;
  h: number;
  /** Top staff line offset from the viewBox top (baseline alignment). */
  staffTop: number;
  /** Largest inter-staff gap in this render, in MEI units. */
  maxGapUnits: number;
}

const parseViewBox = (svg: string): { w: number; h: number } => {
  const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 180, h: 240 };
};

/**
 * Staff geometry parsed from a tile's SVG (outer viewBox units; staff paths
 * live in Verovio's inner definition-scale space, ×10).
 * - staffTop: first staff line offset from the viewBox top (baseline pin).
 * - maxGapUnits: the largest inter-staff gap in MEI units — feeding the
 *   document-wide maximum back as Verovio's spacingStaff forces every tile
 *   to identical staff geometry (spacingStaff is a MINIMUM, so the max of
 *   all needs is reachable by all tiles).
 */
const parseStaffGeometry = (svg: string, h: number): { staffTop: number; maxGapUnits: number } => {
  // Staff paths live in the nested definition-scale space, whose ratio to
  // the outer viewBox depends on the render scale (1000/scale, i.e. ×25 at
  // scale 40) — derive it from the two viewBoxes, never assume.
  const innerTag = svg.match(/<svg[^>]*class="definition-scale"[^>]*>/)?.[0];
  const innerH = Number(innerTag?.match(/viewBox="0 0 \d+ (\d+)"/)?.[1] ?? NaN);
  const factor = innerH > 0 && h > 0 ? innerH / h : 10;
  const tops: number[] = [];
  let space = 180 / factor * 2.5; // fallback: one staff space
  for (const m of svg.matchAll(/class="staff"[^>]*>\s*<path d="M\d+ (\d+)[^/]*?\/>\s*<path d="M\d+ (\d+)/g)) {
    tops.push(Number(m[1]) / factor);
    space = (Number(m[2]) - Number(m[1])) / factor;
  }
  tops.sort((a, b) => a - b);
  const unit = space / 2; // 1 MEI unit = half staff space
  let maxGapUnits = 0;
  for (let i = 1; i < tops.length; i++) {
    const gap = tops[i]! - tops[i - 1]! - 8 * unit; // minus the staff height
    maxGapUnits = Math.max(maxGapUnits, gap / unit);
  }
  return { staffTop: tops[0] ?? h * 0.4, maxGapUnits: Math.ceil(maxGapUnits) };
};

const measureTile = (svg: string, baseKey: string, displayKey: string, r: TileResult): TileState => {
  const { w, h } = parseViewBox(svg);
  const geo = parseStaffGeometry(svg, h);
  return { baseKey, displayKey, svg, ms: r.renderMs, cached: r.cached, w, h, staffTop: geo.staffTop, maxGapUnits: geo.maxGapUnits };
};

/** Verovio caps spacingStaff at 48 MEI units; beyond that, adaptive wins. */
const SPACING_STAFF_MAX = 48;

/**
 * Display zoom: Verovio's units-per-staff are constant across documents, so
 * a fixed zoom gives every score the SAME staff size — a big ensemble is
 * simply taller, like a real score. Never derived from tile height (that
 * would shrink orchestral staves to fit). User-adjustable in the header.
 */
export const ZOOM_LEVELS = [0.3, 0.4, 0.5, 0.7, 0.9, 1.1, 1.3] as const;
export const DEFAULT_ZOOM = 0.9;

/**
 * Virtualized, edit-aware tile grid. Visibility (IntersectionObserver) and
 * content sync are separate: any visible tile whose cache key no longer
 * matches the document re-renders; clean tiles are cache hits. After each
 * sync batch settles, onSettled fires (drives the edit-latency HUD).
 */
function TileGrid({ session, version, pool, zoom, onRendered, onSettled }: { session: DocumentSession; version: number; pool: RenderPool; zoom: number; onRendered: (r: TileResult) => void; onSettled: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tiles, setTiles] = useState<ReadonlyMap<number, TileState>>(new Map());
  const [headers, setHeaders] = useState<ReadonlyMap<string, TileState>>(new Map());
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set());
  const [containerW, setContainerW] = useState(1400);
  /** Bumped whenever an unforced measurement lands (drives the forced pass). */
  const [measureTick, setMeasureTick] = useState(0);
  /** Intrinsic inter-staff need per content key — measured on UNFORCED
   * renders only (a forced render reflects the forced gap, not the need). */
  const intrinsicGap = useRef(new Map<string, number>());
  /** Real ink extent above the top staff line per content key (unforced).
   * Forced renders pad above the first staff too (spacingStaff applies to
   * every staff); rows pin to this compact extent and crop the padding. */
  const intrinsicTop = useRef(new Map<string, number>());
  const sliceCache = useRef(new Map<number, { key: string; xml: string }>());
  const requestedBase = useRef(new Map<number, string>());
  const requestedForced = useRef(new Map<number, string>());
  const requestedHeaders = useRef(new Set<string>());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerW(w);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const measureCount = session.score.measures.length;
  const rendered = useMemo(() => [...tiles.values()], [tiles]);
  const estimateW = useMemo(() => {
    const ws = rendered.map((t) => t.w).sort((a, b) => a - b);
    return ws[Math.floor(ws.length / 2)] ?? 150;
  }, [rendered]);
  const headerSlices = useMemo(() => Array.from({ length: measureCount }, (_, i) => synthesizeRowHeader(session.score, session.contexts, i)), [session, measureCount, version]);

  // --- Row layout: greedy fill by real (or estimated) tile widths, each row
  // prefixed by a system-start header cell (clef + keysig for that context).
  const rows = useMemo(() => {
    const out: { headerKey: string; indices: number[] }[] = [];
    const headerW = 110 * zoom;
    let cur: number[] = [];
    let acc = 0;
    for (let i = 0; i < measureCount; i++) {
      const wpx = (tiles.get(i)?.w ?? estimateW) * zoom;
      if (cur.length && acc + wpx > containerW - headerW) {
        out.push({ headerKey: headerSlices[cur[0]!]!.key, indices: cur });
        cur = [i];
        acc = wpx;
      } else {
        cur.push(i);
        acc += wpx;
      }
    }
    if (cur.length) out.push({ headerKey: headerSlices[cur[0]!]!.key, indices: cur });
    return out;
  }, [measureCount, tiles, estimateW, zoom, containerW, headerSlices]);
  const rowsSig = rows.map((r) => r.indices[0]).join(",");

  /** A row's forced gap: the max intrinsic need among its measured tiles. */
  const rowSpacing = (row: { indices: number[] }): number => {
    let ss = 0;
    for (const i of row.indices) {
      const base = sliceCache.current.get(i)?.key;
      const g = base !== undefined ? intrinsicGap.current.get(base) : undefined;
      if (g !== undefined) ss = Math.max(ss, g);
    }
    return Math.min(ss, SPACING_STAFF_MAX);
  };

  // Observe placeholders for lazy rendering. Re-runs when the measure count
  // or row structure changes (row reflow recreates the tile elements), so
  // late tiles — inserted measures, reflowed rows — always get observed.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const io = new IntersectionObserver(
      (entries) => {
        const add: number[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          add.push(Number((entry.target as HTMLElement).dataset["index"]));
        }
        if (add.length) setVisible((prev) => new Set([...prev, ...add]));
      },
      { rootMargin: "600px" },
    );
    for (const el of container.querySelectorAll("[data-index]")) io.observe(el);
    return () => io.disconnect();
  }, [session, measureCount, rowsSig]);

  // --- Pass 1: measurement. Render visible tiles UNFORCED to learn their
  // intrinsic inter-staff need; display immediately when content is new
  // (fresh content beats spacing consistency; pass 2 replaces it shortly).
  // No cancellation: in-flight renders are superseded by key checks only.
  useEffect(() => {
    // Header policy: the row-start header cells own clef/keysig/brackets, so
    // tiles draw only CHANGES (clef/keysig/meter where they differ from the
    // previous measure) plus the meter at the very start of the piece.
    const headerFor = (index: number): TileHeader => {
      if (index === 0) return { clef: false, keysig: false, meter: true, symbols: false };
      const prev = session.contexts[index - 1]!;
      const cur = session.contexts[index]!;
      let clef = false;
      let keysig = false;
      let meter = false;
      for (const [n, staff] of cur) {
        const before = prev.get(n);
        if (!before) return { clef: true, keysig: true, meter: true, symbols: false }; // staff appeared: reorient
        if (before.clef.shape !== staff.clef.shape || before.clef.line !== staff.clef.line || before.clef.dis !== staff.clef.dis || before.clef.disPlace !== staff.clef.disPlace) clef = true;
        if (before.keysig !== staff.keysig) keysig = true;
        if (before.meter.count !== staff.meter.count || before.meter.unit !== staff.meter.unit || before.meter.sym !== staff.meter.sym) meter = true;
      }
      return { clef, keysig, meter, symbols: false };
    };
    const jobs: Promise<unknown>[] = [];
    for (const index of visible) {
      if (index >= session.score.measures.length) continue; // stale after -m
      const slice = synthesizeTile(session.score, session.contexts, index, 1, headerFor(index));
      sliceCache.current.set(index, { key: slice.key, xml: slice.xml });
      if (requestedBase.current.get(index) === slice.key) continue;
      requestedBase.current.set(index, slice.key);
      jobs.push(
        pool.render(slice.key, slice.xml).then((r) => {
          if (!alive.current) return;
          if (requestedBase.current.get(index) !== slice.key) return; // superseded by an edit
          const state = measureTile(r.svg, slice.key, slice.key, r);
          intrinsicGap.current.set(slice.key, r.error ? 0 : state.maxGapUnits);
          intrinsicTop.current.set(slice.key, state.staffTop);
          setTiles((prev) => (prev.get(index)?.baseKey === slice.key ? prev : new Map(prev).set(index, state)));
          setMeasureTick((t) => t + 1);
          onRendered(r);
        }),
      );
    }
    if (jobs.length) {
      void Promise.all(jobs).then(() => {
        if (alive.current) onSettled();
      });
    }
    // onRendered/onSettled are stable sinks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, version, session, pool]);

  // --- Pass 2: consistency. Each row re-renders its tiles (and header) with
  // the row's max intrinsic gap forced as spacingStaff, so all staves in the
  // row share identical geometry — without inflating gap-free rows.
  useEffect(() => {
    for (const row of rows) {
      const ss = rowSpacing(row);
      const sfx = ss > 0 ? `-ss${ss}` : "";
      const options = ss > 0 ? { spacingStaff: ss } : undefined;
      const headerBase = headerSlices[row.indices[0]!]!.key;
      const headerKey = headerBase + sfx;
      if (!requestedHeaders.current.has(headerKey)) {
        requestedHeaders.current.add(headerKey);
        const hs = headerSlices[row.indices[0]!]!;
        void pool.render(headerKey, hs.xml, options).then((r) => {
          if (!alive.current || r.error) return;
          setHeaders((prev) => new Map(prev).set(headerKey, measureTile(r.svg, headerBase, headerKey, r)));
        });
      }
      for (const index of row.indices) {
        const base = sliceCache.current.get(index);
        if (!base) continue;
        const intrinsic = intrinsicGap.current.get(base.key);
        if (intrinsic === undefined) continue; // not measured yet
        // The max-need tile's unforced render already has the row geometry;
        // resolving through the pool makes that case a cache hit while still
        // restoring the display if it holds a stale forced variant.
        const desired = ss === 0 || ss === intrinsic ? base.key : base.key + sfx;
        if (requestedForced.current.get(index) === desired) continue;
        requestedForced.current.set(index, desired);
        void pool.render(desired, base.xml, desired === base.key ? undefined : options).then((r) => {
          if (!alive.current || r.error) return;
          if (sliceCache.current.get(index)?.key !== base.key) return; // superseded
          if (requestedForced.current.get(index) !== desired) return;
          setTiles((prev) => (prev.get(index)?.displayKey === desired ? prev : new Map(prev).set(index, measureTile(r.svg, base.key, desired, r))));
        });
      }
    }
    // rowSpacing reads refs; rows/measureTick are the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsSig, measureTick, headerSlices, pool]);

  // Pin a tile's staff to the row baseline inside the row-uniform box.
  // Offsets can be negative (cropping a forced variant's padding above the
  // first staff); overflow:hidden keeps the crop, and rowTop covers all real
  // ink above the line, so no content is ever clipped.
  const aligned = (t: TileState, rowTop: number, rowBoxH: number) => (
    <div style={{ width: t.w * zoom, height: rowBoxH, overflow: "hidden", position: "relative" }}>
      <div style={{ position: "absolute", top: `${(rowTop - t.staffTop) * zoom}px`, width: t.w * zoom, height: t.h * zoom }} dangerouslySetInnerHTML={{ __html: t.svg }} />
    </div>
  );

  return (
    <div ref={containerRef}>
      {rows.map((row) => {
        const ss = rowSpacing(row);
        const header = headers.get(row.headerKey + (ss > 0 ? `-ss${ss}` : ""));
        const members = row.indices.map((i) => tiles.get(i)).filter((t): t is TileState => !!t);
        const withHeader = header ? [header, ...members] : members;
        // Compact baseline: real ink above the line (intrinsic), not the
        // forced variants' padding. Bottom extents come from what is shown.
        const rowTop = members.reduce((m, t) => Math.max(m, intrinsicTop.current.get(t.baseKey) ?? t.staffTop), 60);
        const rowBottom = withHeader.reduce((m, t) => Math.max(m, t.h - t.staffTop), 140);
        const rowBoxH = (rowTop + rowBottom) * zoom;
        return (
          <div className="score-row" key={row.indices[0]}>
            {header && <div className="rowhdr">{aligned(header, rowTop, rowBoxH)}</div>}
            {row.indices.map((index) => {
              const tile = tiles.get(index);
              return (
                <div className="tile" data-index={index} key={index}>
                  {tile ? (
                    <>
                      <span className="ms">
                        m{index + 1}
                        {tile.cached ? " · cache" : ` · ${tile.ms.toFixed(1)} ms`}
                      </span>
                      {aligned(tile, rowTop, rowBoxH)}
                    </>
                  ) : (
                    <div className="placeholder" style={{ width: estimateW * zoom, height: rowBoxH }}>
                      m{index + 1}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Full Verovio paged layout for proofreading; pages stream in as rendered. */
function PageView({ session, pool }: { session: DocumentSession; pool: RenderPool }) {
  const [pages, setPages] = useState<ReadonlyMap<number, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setPages(new Map());
    // Serialize the CURRENT document (edits included), not the loaded file.
    pool.renderDocumentPages(session.serializeForPageView(), (index, svg) => {
      if (!cancelled) setPages((prev) => new Map(prev).set(index, svg));
    });
    return () => {
      cancelled = true;
    };
  }, [session, pool]);

  return (
    <div className="pages">
      {[...pages.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, svg]) => (
          <div className="page" key={index} dangerouslySetInnerHTML={{ __html: svg }} />
        ))}
      {pages.size === 0 && <p>laying out pages…</p>}
    </div>
  );
}

let nextDocId = 1;

export default function App() {
  const [pool, setPool] = useState<RenderPool | null>(null);
  const [docs, setDocs] = useState<OpenDoc[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [view, setView] = useState<"tiles" | "pages">("tiles");
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [caret, setCaret] = useState<CaretPosition | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [block, setBlock] = useState<BlockSelection | null>(null);
  const [clipInfo, setClipInfo] = useState<string | null>(null);
  const anchor = useRef<CaretPosition | null>(null);
  const dragAnchor = useRef<{ measureIndex: number; staffN: number } | null>(null);
  const dragging = useRef(false);
  const [stats, setStats] = useState({ rendered: 0, freshMs: 0, fresh: 0 });
  const [editLatency, setEditLatency] = useState<number | null>(null);
  const pendingEdit = useRef(false);
  const [caretRect, setCaretRect] = useState<{ left: number; top: number; height: number } | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const zoomByDoc = useRef(new Map<number, number>());
  const mainRef = useRef<HTMLElement>(null);
  // --- note input mode ---
  const [entryMode, setEntryMode] = useState(false);
  const [entryDur, setEntryDur] = useState("4");
  const [entryDots, setEntryDots] = useState(0);
  const lastEntered = useRef<string | null>(null);

  const active = docs.find((d) => d.id === activeId) ?? null;
  const session = active?.session ?? null;

  useEffect(() => {
    const p = new RenderPool();
    setPool(p);
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__POOL__ = p;
    return () => p.dispose();
  }, []);

  const resetDocUiState = useCallback(() => {
    setCaret(null);
    setSelection([]);
    setBlock(null);
    anchor.current = null;
    setEditLatency(null);
    setNotice(null);
    setEntryMode(false);
    lastEntered.current = null;
  }, []);

  const openDoc = useCallback(
    (fixture: string) => {
      setError(null);
      fetch("/" + fixture)
        .then((r) => r.text())
        .then((xml) => {
          const s = new DocumentSession(xml);
          if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__SESSION__ = s;
          const doc: OpenDoc = { id: nextDocId++, name: fixture.replace(/\.mei$/, ""), session: s };
          setDocs((ds) => [...ds, doc]);
          setActiveId(doc.id);
          resetDocUiState();
          setStats({ rendered: 0, freshMs: 0, fresh: 0 });
        })
        .catch((e) => setError(String(e)));
    },
    [resetDocUiState],
  );

  // Open the default document on startup (ref-guarded: StrictMode runs
  // mount effects twice, and two fetches would open two tabs).
  const openedInitial = useRef(false);
  useEffect(() => {
    if (openedInitial.current) return;
    openedInitial.current = true;
    openDoc(FIXTURES[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchDoc = (id: number) => {
    if (id === activeId) return;
    if (activeId !== null) zoomByDoc.current.set(activeId, zoom);
    setActiveId(id);
    setZoom(zoomByDoc.current.get(id) ?? DEFAULT_ZOOM);
    resetDocUiState();
    const s = docs.find((d) => d.id === id)?.session;
    if (s) {
      if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__SESSION__ = s;
      setVersion(s.version);
    }
  };

  const closeDoc = (id: number) => {
    const remaining = docs.filter((d) => d.id !== id);
    setDocs(remaining);
    zoomByDoc.current.delete(id);
    if (id === activeId) {
      const next = remaining[remaining.length - 1] ?? null;
      setActiveId(next?.id ?? null);
      setZoom(next ? zoomByDoc.current.get(next.id) ?? DEFAULT_ZOOM : DEFAULT_ZOOM);
      resetDocUiState();
      if (next) {
        if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__SESSION__ = next.session;
        setVersion(next.session.version);
      }
    }
  };

  const caretId = session && caret ? session.index.eventIdAt(caret) : undefined;

  /** ids an edit applies to: the selection, else the caret event. */
  const editTargets = useCallback((): string[] => {
    if (selection.length) return selection;
    return caretId ? [caretId] : [];
  }, [selection, caretId]);

  const afterCommand = useCallback(
    (s: DocumentSession) => {
      pendingEdit.current = true;
      setVersion(s.version);
      setSelection((sel) => sel.filter((id) => s.index.byId.has(id)));
      setCaret((c) => {
        if (!c) return c;
        const events = s.index.eventsAt(c.measureIndex, c.staffN, c.layerN);
        return events.length === 0 ? null : { ...c, eventIndex: Math.min(c.eventIndex, events.length - 1) };
      });
    },
    [],
  );

  /** Choose the octave that puts pname nearest the previous note (or oct 4). */
  const nearestOctave = useCallback(
    (pname: string, pos: CaretPosition): number => {
      const PN = ["c", "d", "e", "f", "g", "a", "b"];
      const prev = session?.pitchNear(pos);
      if (!prev) return 4;
      const prevAbs = prev.oct * 7 + PN.indexOf(prev.pname);
      let best = 4;
      let bestDist = Infinity;
      for (let oct = prev.oct - 1; oct <= prev.oct + 1; oct++) {
        const dist = Math.abs(oct * 7 + PN.indexOf(pname) - prevAbs);
        if (dist < bestDist) {
          bestDist = dist;
          best = oct;
        }
      }
      return best;
    },
    [session],
  );

  /** Overwrite-mode entry at the caret. Advances the caret unless told not
   * to — MIDI chords enter without advancing and advance on key release. */
  const enterAtCaret = useCallback(
    (spec: { kind: "note" | "rest"; pname?: string; oct?: number; accid?: string }, opts?: { advance?: boolean }) => {
      if (!session || !caret || !caretId) return;
      try {
        const entered = session.enterEvent(caretId, {
          kind: spec.kind,
          ...(spec.pname !== undefined && { pname: spec.pname }),
          ...(spec.oct !== undefined && { oct: spec.oct }),
          ...(spec.accid !== undefined && { accid: spec.accid }),
          dur: entryDur,
          ...(entryDots > 0 && { dots: entryDots }),
        });
        lastEntered.current = entered;
        afterCommand(session);
        if (opts?.advance !== false) setCaret((c) => (c ? caretRight(session.index, session.score, c) ?? c : c));
        setNotice(null);
      } catch (err) {
        setNotice(`entry refused: ${err instanceof Error ? err.message : err}`);
      }
    },
    [session, caret, caretId, entryDur, entryDots, afterCommand],
  );

  /** Apply a clef/key/meter change at the caret's measure (clef: staff). */
  const applyContext = useCallback(
    (kind: "clef" | "key" | "meter", value: string) => {
      if (!session || !caret || !value) return;
      try {
        if (kind === "key") session.changeContext(caret.measureIndex, { keysig: value });
        else if (kind === "meter") {
          const [count, unit] = value.split("/");
          session.changeContext(caret.measureIndex, { meter: { count: count!, unit: unit! } });
        } else {
          const CLEFS: Record<string, { shape: string; line: number; dis?: number; disPlace?: "above" | "below" }> = {
            G2: { shape: "G", line: 2 },
            F4: { shape: "F", line: 4 },
            C3: { shape: "C", line: 3 },
            C4: { shape: "C", line: 4 },
            G2v: { shape: "G", line: 2, dis: 8, disPlace: "below" },
          };
          session.changeContext(caret.measureIndex, { clef: CLEFS[value]!, staffN: caret.staffN });
        }
        afterCommand(session);
        setNotice(`${kind} changed at m${caret.measureIndex + 1}${kind === "clef" ? ` (staff ${caret.staffN})` : ""}`);
      } catch (err) {
        setNotice(`${kind} change refused: ${err instanceof Error ? err.message : err}`);
      }
    },
    [session, caret, afterCommand],
  );

  const structural = useCallback(
    (op: "insert" | "delete" | "duplicate") => {
      if (!session) return;
      const at = block ? block.measureFrom : caret?.measureIndex;
      const count = block ? block.measureTo - block.measureFrom + 1 : 1;
      if (at === undefined) {
        setNotice("place the caret or select a block first");
        return;
      }
      const staffWish = block ? block.staffFrom : caret?.staffN ?? 1;
      if (op === "insert") session.insertMeasures(at + count, count);
      else if (op === "delete") session.deleteMeasures(at, count);
      else session.duplicateMeasures(at, count);
      setBlock(null);
      setSelection([]);
      anchor.current = null;
      lastEntered.current = null;
      setNotice(op === "insert" ? `inserted ${count} empty measure(s) after m${at + count}` : op === "delete" ? `deleted m${at + 1}${count > 1 ? `–m${at + count}` : ""}` : `duplicated m${at + 1}${count > 1 ? `–m${at + count}` : ""}`);
      afterCommand(session);
      // Keep the flow going: the caret lands in the first NEW measure after
      // insert/duplicate, and on the PREVIOUS measure after delete — no
      // re-clicking to continue working (applies to buttons and numpad).
      const total = session.score.measures.length;
      let m = op === "delete" ? at - 1 : at + count;
      m = Math.max(0, Math.min(m, total - 1));
      let next: CaretPosition | null = null;
      if (total > 0) {
        const staves = session.index.stavesPerMeasure.get(m) ?? [];
        const s = staves.includes(staffWish) ? staffWish : staves[0] ?? 1;
        const layers = session.index.layersPerStaff.get(`${m}/${s}`) ?? [];
        const l = layers[0] ?? 1;
        if (session.index.eventsAt(m, s, l).length > 0) next = { measureIndex: m, staffN: s, layerN: l, eventIndex: 0 };
      }
      caretRef.current = next; // MIDI path reads this synchronously
      setCaret(next);
    },
    [session, block, caret, afterCommand],
  );

  // Keyboard: navigation, selection, edits, undo/redo.
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey ? session.stack.canRedo : session.stack.canUndo) {
          e.shiftKey ? session.redo() : session.undo();
          afterCommand(session);
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        if (session.stack.canRedo) {
          session.redo();
          afterCommand(session);
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        // Copy the block selection (falls back to the caret's measure×staff).
        const b = block ?? (caret ? normalizeBlock({ measureIndex: caret.measureIndex, staffN: caret.staffN }, { measureIndex: caret.measureIndex, staffN: caret.staffN }) : null);
        if (!b) return;
        e.preventDefault();
        const frag = session.copyBlock(b);
        if (frag) {
          sharedClipboard = frag;
          setClipInfo(`${frag.measureCount}m × ${frag.staves.length}s`);
          setNotice(`copied ${frag.measureCount} measure(s) × ${frag.staves.length} staff/staves`);
          void navigator.clipboard?.writeText(fragmentToText(frag)).catch(() => undefined);
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        // Replace-measures paste at the block corner or the caret.
        const target = block ? { measureIndex: block.measureFrom, staffN: block.staffFrom } : caret ? { measureIndex: caret.measureIndex, staffN: caret.staffN } : null;
        if (!target || !sharedClipboard) return;
        e.preventDefault();
        const plan = session.planPaste(sharedClipboard, target.measureIndex, target.staffN);
        if (!plan.ok) {
          setNotice(`paste refused: ${plan.reason}`);
          return;
        }
        if (plan.warnings.length && !window.confirm(`Paste with differences?\n\n${plan.warnings.join("\n")}`)) return;
        session.pasteReplace(sharedClipboard, target.measureIndex, target.staffN);
        afterCommand(session);
        setNotice(plan.warnings.length ? `pasted (${plan.warnings.join("; ")})` : "pasted");
        return;
      }
      // Numpad +/−/* mirror the +m/−m/⧉m buttons (physical codes: layout-proof).
      if (e.code === "NumpadAdd" || e.code === "NumpadSubtract" || e.code === "NumpadMultiply") {
        e.preventDefault();
        structural(e.code === "NumpadAdd" ? "insert" : e.code === "NumpadSubtract" ? "delete" : "duplicate");
        return;
      }
      if (!caret) return;

      // --- note input mode: letters enter, digits set duration ---
      if (!entryMode && e.key === "i" && !mod) {
        e.preventDefault();
        setEntryMode(true);
        setNotice("note input: a–g pitch · shift+A–G chord · r rest · 1–7 duration (5=quarter) · . dot · s/v/n sharp/flat/natural · t tie · , stacc · ; accent · shift+F/P dynamics · esc exit");
        return;
      }
      if (entryMode && !mod) {
        const DUR: Record<string, string> = { "7": "1", "6": "2", "5": "4", "4": "8", "3": "16", "2": "32", "1": "64" };
        const applyTo = lastEntered.current && session.index.byId.has(lastEntered.current) ? lastEntered.current : caretId;
        if (e.key === "Escape") {
          setEntryMode(false);
          setNotice(null);
          return;
        }
        // Layout-independence: digits and the dot are matched by PHYSICAL key
        // (e.code) too — on AZERTY the number row and "." need Shift, but the
        // physical positions are the same on every layout.
        // The physical fallback applies only unshifted: AZERTY's shifted
        // digits already arrive as "1".."7", and QWERTY's shift+1 ("!") must
        // stay available as the accent key.
        const digit = /^[1-7]$/.test(e.key) ? e.key : !e.shiftKey ? /^(?:Digit|Numpad)([1-7])$/.exec(e.code)?.[1] : undefined;
        if (digit && DUR[digit]) {
          e.preventDefault();
          setEntryDur(DUR[digit]!);
          return;
        }
        if (/^[a-g]$/.test(e.key) && !e.altKey) {
          e.preventDefault();
          enterAtCaret({ kind: "note", pname: e.key, oct: nearestOctave(e.key, caret) });
          return;
        }
        if (/^[A-G]$/.test(e.key) && applyTo) {
          e.preventDefault();
          const pname = e.key.toLowerCase();
          try {
            const chordId = session.addChordNote(applyTo, pname, nearestOctave(pname, caret));
            if (chordId && lastEntered.current) lastEntered.current = chordId;
            afterCommand(session);
          } catch (err) {
            setNotice(`chord refused: ${err instanceof Error ? err.message : err}`);
          }
          return;
        }
        if (e.key === "r") {
          e.preventDefault();
          enterAtCaret({ kind: "rest" });
          return;
        }
        if (e.key === "t" && applyTo) {
          e.preventDefault();
          // Tie the last entered note back to its predecessor (the natural
          // gesture while transcribing); fall back to tying it forward.
          const ref = session.index.byId.get(applyTo);
          const prevId = ref && ref.eventIndex > 0 ? session.index.eventsAt(ref.measureIndex, ref.staffN, ref.layerN)[ref.eventIndex - 1] : undefined;
          try {
            session.toggleTie(prevId && session.index.byId.get(prevId)?.tag === "note" ? prevId : applyTo);
            afterCommand(session);
          } catch (err) {
            setNotice(`tie refused: ${err instanceof Error ? err.message : err}`);
          }
          return;
        }
        if ((e.key === "s" || e.key === "v" || e.key === "n") && applyTo) {
          e.preventDefault();
          session.toggleAccidental([applyTo], e.key === "v" ? "f" : (e.key as "s" | "n"));
          afterCommand(session);
          return;
        }
        if ((e.key === "," || e.key === ";") && applyTo) {
          e.preventDefault();
          session.toggleArtic([applyTo], e.key === "," ? "stacc" : "acc");
          afterCommand(session);
          return;
        }
        // Dynamics: plain "p" cycles none -> p -> f -> none (layout-proof;
        // alt+f/p kept as a secondary, though browsers may steal alt+F).
        if (!e.altKey && e.key === "p" && applyTo) {
          e.preventDefault();
          session.cycleDynam(applyTo);
          afterCommand(session);
          return;
        }
        if (e.altKey && (e.key === "f" || e.key === "p") && applyTo) {
          e.preventDefault();
          session.toggleDynam(applyTo, e.key);
          afterCommand(session);
          return;
        }
        // arrows and everything else fall through to navigation
      }

      // Dot: "." (QWERTY) or ":" (AZERTY's dedicated unshifted key). Always
      // applies to a real event — the just-entered note, or the note/rest at
      // the caret (existing notes includable). Subsequent entries inherit
      // the resulting dot state; there is no separate prospective toggle.
      if ((e.key === "." || e.key === ":" || e.code === "NumpadDecimal") && !mod && !e.altKey) {
        const target = entryMode && lastEntered.current && session.index.byId.has(lastEntered.current) ? lastEntered.current : caretId;
        if (!target) return;
        e.preventDefault();
        try {
          const result = session.toggleDot(target);
          if (entryMode) {
            lastEntered.current = result.id;
            setEntryDots(result.dots);
          }
          afterCommand(session);
          setNotice(null);
        } catch (err) {
          setNotice(`dot refused: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }

      // merge with next / split in half — same-pitch cleanup for AMT output.
      if ((e.key === "m" || e.key === "x") && !mod && !e.altKey) {
        const target = entryMode && lastEntered.current && session.index.byId.has(lastEntered.current) ? lastEntered.current : caretId;
        if (!target) return;
        e.preventDefault();
        try {
          if (e.key === "m") session.mergeWithNext(target);
          else session.splitInHalf(target);
          afterCommand(session);
          setNotice(null);
        } catch (err) {
          setNotice(`${e.key === "m" ? "merge" : "split"} refused: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }

      // alt+←/→ shortens/lengthens the duration — same target rule as the
      // dot (last entered until the caret moves, else the caret event).
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.altKey) {
        const target = entryMode && lastEntered.current && session.index.byId.has(lastEntered.current) ? lastEntered.current : caretId;
        if (!target) return;
        e.preventDefault();
        try {
          const r = session.changeDurationStep(target, e.key === "ArrowRight" ? 1 : -1);
          if (entryMode) {
            setEntryDur(r.dur);
            setEntryDots(r.dots);
          }
          afterCommand(session);
          setNotice(null);
        } catch (err) {
          setNotice(`duration refused: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const next = e.key === "ArrowRight" ? caretRight(session.index, session.score, caret) : caretLeft(session.index, session.score, caret);
        if (!next) return;
        if (e.shiftKey) {
          if (!anchor.current) anchor.current = caret;
          setSelection(eventRange(session.index, session.score, anchor.current, next));
        } else {
          anchor.current = null;
          setSelection([]);
        }
        lastEntered.current = null; // caret moved: post-entry modifiers follow it
        setCaret(next);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const dir = e.key === "ArrowUp" ? 1 : -1; // musical direction: up = higher pitch
        if (e.altKey) {
          const ids = editTargets();
          if (!ids.length) return;
          e.shiftKey ? session.transposeOctave(ids, dir) : session.transposeStep(ids, dir);
          afterCommand(session);
        } else {
          const next = caretVertical(session.index, caret, e.key === "ArrowUp" ? -1 : 1);
          if (next) {
            anchor.current = null;
            setSelection([]);
            lastEntered.current = null; // caret moved
            setCaret(next);
          }
        }
      } else if (e.key === "s" || e.key === "f" || e.key === "n") {
        const ids = editTargets();
        if (!ids.length) return;
        session.toggleAccidental(ids, e.key as "s" | "f" | "n");
        afterCommand(session);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        // Backspace erases BACKWARD like a text editor: the previous event
        // becomes a rest and the caret moves onto it. (With a selection it
        // deletes the selection, same as Delete.)
        if (e.key === "Backspace" && selection.length === 0) {
          const prev = caretLeft(session.index, session.score, caret);
          if (!prev) return;
          const prevId = session.index.eventIdAt(prev);
          const ref = prevId ? session.index.byId.get(prevId) : undefined;
          if (ref && (ref.tag === "note" || ref.tag === "chord")) {
            session.deleteToRests([prevId!]);
            afterCommand(session);
          }
          anchor.current = null;
          lastEntered.current = null; // caret moved
          setCaret(prev); // steps back even over rests, like a cursor
          return;
        }
        const ids = editTargets();
        if (!ids.length) return;
        session.deleteToRests(ids);
        afterCommand(session);
      } else if (e.key === "Escape") {
        anchor.current = null;
        setSelection([]);
        setBlock(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, caret, block, editTargets, afterCommand, entryMode, caretId, enterAtCaret, nearestOctave, structural]);

  // --- Web MIDI: note-ons enter at the caret while input mode is active;
  // keys held together build a CHORD (like MuseScore). Devices hot-plug via
  // onstatechange, and the HUD shows what is connected.
  const [midiStatus, setMidiStatus] = useState<string | null>(null);
  const heldNotes = useRef(new Set<number>());
  const entryModeRef = useRef(entryMode);
  entryModeRef.current = entryMode;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // MIDI events arrive faster than React re-renders (real playing sends
  // note-ons milliseconds apart), so the whole MIDI path works off refs and
  // the session's synchronously-updated index — never render-fresh closures.
  const caretRef = useRef(caret);
  caretRef.current = caret;
  const entryDurRef = useRef(entryDur);
  entryDurRef.current = entryDur;
  const entryDotsRef = useRef(entryDots);
  entryDotsRef.current = entryDots;

  const midiPitch = (midiNote: number) => {
    const PC = ["c", "c", "d", "d", "e", "f", "f", "g", "g", "a", "a", "b"] as const;
    const SHARP = new Set([1, 3, 6, 8, 10]);
    const pc = midiNote % 12;
    return { pname: PC[pc]!, oct: Math.floor(midiNote / 12) - 1, accid: SHARP.has(pc) ? "s" : undefined };
  };

  const midiNoteOn = useCallback(
    (midiNote: number) => {
      const s = sessionRef.current;
      if (!s) return;
      if (!entryModeRef.current) {
        setNotice("MIDI note received — press i (input mode) to enter notes with your keyboard");
        return;
      }
      const wasHeld = heldNotes.current.size > 0;
      heldNotes.current.add(midiNote);
      const { pname, oct, accid } = midiPitch(midiNote);
      if (wasHeld && lastEntered.current && s.index.byId.has(lastEntered.current)) {
        // Another key is still down: stack onto the held note as a chord.
        // Promotion assigns the chord a NEW id — retarget through it, or the
        // third pitch would fall back to a fresh entry at the caret.
        try {
          const chordId = s.addChordNote(lastEntered.current, pname, oct, accid);
          if (chordId) lastEntered.current = chordId;
          afterCommand(s);
        } catch (err) {
          setNotice(`chord refused: ${err instanceof Error ? err.message : err}`);
        }
      } else {
        // Enter WITHOUT advancing: the caret moves when all keys release,
        // so every pitch of the chord lands on the same event. Target is
        // resolved from the session at event time (race-free).
        const pos = caretRef.current;
        const targetId = pos ? s.index.eventIdAt(pos) : undefined;
        if (!targetId) {
          setNotice("nothing at the caret to enter into");
          return;
        }
        try {
          const entered = s.enterEvent(targetId, {
            kind: "note",
            pname,
            oct,
            ...(accid && { accid }),
            dur: entryDurRef.current,
            ...(entryDotsRef.current > 0 && { dots: entryDotsRef.current }),
          });
          lastEntered.current = entered;
          afterCommand(s);
          midiAdvancePending.current = true;
          setNotice(null);
        } catch (err) {
          setNotice(`entry refused: ${err instanceof Error ? err.message : err}`);
        }
      }
    },
    [afterCommand],
  );
  const midiNoteOnRef = useRef(midiNoteOn);
  midiNoteOnRef.current = midiNoteOn;
  const midiAdvancePending = useRef(false);
  const midiNoteOff = useCallback(
    (midiNote: number) => {
      heldNotes.current.delete(midiNote);
      // Last key released: NOW the caret advances past the finished chord.
      // caretRef updates synchronously so an immediate next note-on already
      // sees the advanced position, before React commits.
      if (heldNotes.current.size === 0 && midiAdvancePending.current) {
        midiAdvancePending.current = false;
        const s = sessionRef.current;
        const pos = caretRef.current;
        if (s && pos) {
          const next = caretRight(s.index, s.score, pos) ?? pos;
          caretRef.current = next;
          setCaret(next);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__MIDI_NOTE__ = (n: number, on = true) => (on ? midiNoteOnRef.current(n) : midiNoteOff(n));
    }
    interface MidiInput {
      name?: string;
      onmidimessage: ((e: { data: Uint8Array | null }) => void) | null;
    }
    interface MidiAccess {
      inputs: Map<string, MidiInput>;
      onstatechange: (() => void) | null;
    }
    const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MidiAccess> };
    if (!nav.requestMIDIAccess) return;
    let closed = false;
    const onMessage = (e: { data: Uint8Array | null }) => {
      const d = e.data;
      if (!d) return;
      const status = (d[0] ?? 0) & 0xf0;
      const note = d[1] ?? 0;
      const velocity = d[2] ?? 0;
      if (status === 0x90 && velocity > 0) midiNoteOnRef.current(note);
      else if (status === 0x80 || (status === 0x90 && velocity === 0)) midiNoteOff(note);
    };
    nav
      .requestMIDIAccess()
      .then((access) => {
        if (closed) return;
        const attach = () => {
          const names: string[] = [];
          for (const input of access.inputs.values()) {
            input.onmidimessage = onMessage;
            names.push(input.name || "device");
          }
          setMidiStatus(names.length ? names.join(", ") : null);
        };
        attach();
        access.onstatechange = attach; // hot-plug: (re)attach and update HUD
      })
      .catch(() => setMidiStatus(null));
    return () => {
      closed = true;
    };
  }, [midiNoteOff]);

  /** Resolve a pointer event to a (measure, staff) position for block drags. */
  const staffPosFromPoint = useCallback(
    (target: globalThis.Element, x: number, y: number): { measureIndex: number; staffN: number } | null => {
      if (!session) return null;
      // 1. an event glyph under the pointer knows its staff
      let g = target.closest("g[id]");
      while (g) {
        const ref = session.index.byId.get(g.id);
        if (ref) return { measureIndex: ref.measureIndex, staffN: ref.staffN };
        const staffRef = session.staffRefById.get(g.id);
        if (staffRef) return staffRef;
        g = g.parentElement?.closest("g[id]") ?? null;
      }
      // 2. otherwise: the tile gives the measure; nearest staff bbox gives n
      const tile = target.closest(".tile") as HTMLElement | null;
      if (!tile) return null;
      const measureIndex = Number(tile.dataset["index"]);
      let best: { staffN: number; d: number } | null = null;
      for (const staffEl of tile.querySelectorAll("g.staff[id]")) {
        const ref = session.staffRefById.get(staffEl.id);
        if (!ref) continue;
        const r = staffEl.getBoundingClientRect();
        const d = Math.abs(y - (r.top + r.height / 2)) + Math.abs(x - Math.max(r.left, Math.min(x, r.right)));
        if (!best || d < best.d) best = { staffN: ref.staffN, d };
      }
      return best ? { measureIndex, staffN: best.staffN } : null;
    },
    [session],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.shiftKey) return;
    dragAnchor.current = staffPosFromPoint(e.target as globalThis.Element, e.clientX, e.clientY);
    dragging.current = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragAnchor.current || e.buttons !== 1) return;
    const pos = staffPosFromPoint(e.target as globalThis.Element, e.clientX, e.clientY);
    if (!pos) return;
    if (!dragging.current && (pos.measureIndex !== dragAnchor.current.measureIndex || pos.staffN !== dragAnchor.current.staffN)) {
      dragging.current = true;
    }
    if (dragging.current) setBlock(normalizeBlock(dragAnchor.current, pos));
  };

  const onPointerUp = () => {
    dragAnchor.current = null;
    // A completed drag suppresses the click-to-caret that follows it.
    setTimeout(() => {
      dragging.current = false;
    }, 0);
  };

  // Click: nearest ancestor g[id] that the event index knows (chords resolve
  // to the chord id even when a child note is hit). If the hit lands on a
  // non-event glyph (slur, barline, staff line), fall back to the closest
  // event bbox in the same tile. Shift-click extends.
  const onClick = (e: React.MouseEvent) => {
    if (!session) return;
    if (dragging.current) return; // block drag, not a caret click
    if (block && !e.shiftKey) setBlock(null);
    let g = (e.target as globalThis.Element).closest("g[id]");
    while (g && !session.index.byId.has(g.id)) g = g.parentElement?.closest("g[id]") ?? null;
    if (!g) {
      const tile = (e.target as globalThis.Element).closest(".tile");
      if (!tile) return;
      let best: { el: globalThis.Element; d: number } | null = null;
      for (const cand of tile.querySelectorAll("g[id]")) {
        if (!session.index.byId.has(cand.id)) continue;
        const r = cand.getBoundingClientRect();
        const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        if (!best || d < best.d) best = { el: cand, d };
      }
      if (!best || best.d > 60) return;
      g = best.el;
    }
    const ref = session.index.byId.get(g.id)!;
    const pos: CaretPosition = { measureIndex: ref.measureIndex, staffN: ref.staffN, layerN: ref.layerN, eventIndex: ref.eventIndex };
    if (e.shiftKey && anchor.current) {
      setSelection(eventRange(session.index, session.score, anchor.current, pos));
    } else {
      anchor.current = pos;
      setSelection([]);
    }
    lastEntered.current = null; // caret moved: post-entry modifiers follow it
    setCaret(pos);
  };

  // Caret overlay: project the caret's model position onto its SVG bbox.
  useEffect(() => {
    const main = mainRef.current;
    if (!main || !caretId) {
      setCaretRect(null);
      return;
    }
    const g = main.querySelector(`g[id="${CSS.escape(caretId)}"]`);
    if (!g) {
      setCaretRect(null);
      return;
    }
    const gr = (g as SVGGElement).getBoundingClientRect();
    const mr = main.getBoundingClientRect();
    setCaretRect({ left: gr.left - mr.left - 4, top: gr.top - mr.top - 6, height: gr.height + 12 });
  }, [caretId, version, layoutTick, view, zoom]);

  const onRendered = useCallback((r: TileResult) => {
    setStats((s) => ({
      rendered: s.rendered + 1,
      freshMs: s.freshMs + (r.cached ? 0 : r.renderMs),
      fresh: s.fresh + (r.cached ? 0 : 1),
    }));
    setLayoutTick((t) => t + 1);
  }, []);

  const onSettled = useCallback(() => {
    setLayoutTick((t) => t + 1);
    if (pendingEdit.current && session) {
      pendingEdit.current = false;
      setEditLatency(performance.now() - session.lastEditStart);
    }
  }, [session]);

  const contextChanges = session ? session.contexts.reduce((n, c, i) => (i > 0 && contextHash(c) !== contextHash(session.contexts[i - 1]!) ? n + 1 : n), 0) : 0;

  const status = error
    ? `error: ${error}`
    : !session || !pool
      ? "loading…"
      : `${session.score.measures.length} measures · ${contextChanges} context changes · ` +
        `${stats.fresh} fresh renders (avg ${stats.fresh ? (stats.freshMs / stats.fresh).toFixed(1) : "–"} ms) · pool ${pool.size}` +
        (editLatency !== null ? ` · last edit → screen ${editLatency.toFixed(0)} ms` : "") +
        ` · undo ${session.stack.undoDepth}` +
        (clipInfo ? ` · clip ${clipInfo}` : "") +
        (block ? ` · block m${block.measureFrom + 1}–${block.measureTo + 1} / staff ${block.staffFrom}–${block.staffTo}` : "") +
        (entryMode ? ` · INPUT ${entryDur}${entryDots ? "." : ""}` : "") +
        (midiStatus ? ` · midi: ${midiStatus}` : "");

  const saveDoc = () => {
    if (!session || !active) return;
    const blob = new Blob([session.saveDocument()], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${active.name}-edited.mei`;
    a.click();
    URL.revokeObjectURL(a.href);
  };


  const selectionCss = selection.length
    ? selection.map((id) => `g[id="${CSS.escape(id)}"] *`).join(", ") + ` { fill: #d22; stroke: #d22; }`
    : "";
  const caretCss = caretId ? `g[id="${CSS.escape(caretId)}"] * { fill: #06c; stroke: #06c; }` : "";
  let blockCss = "";
  if (block && session) {
    const ids: string[] = [];
    for (let m = block.measureFrom; m <= block.measureTo; m++) {
      for (let s = block.staffFrom; s <= block.staffTo; s++) {
        const id = session.staffIdByPos.get(`${m}/${s}`);
        if (id) ids.push(id);
      }
    }
    if (ids.length && ids.length <= 600) {
      blockCss = ids.map((id) => `g[id="${CSS.escape(id)}"] *`).join(", ") + ` { fill: #170; stroke: #170; }`;
    }
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 12 }}>
      <header style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 4, flexWrap: "wrap" }}>
        <strong>battuta</strong>
        <span className="tabs">
          {docs.map((d) => (
            <button key={d.id} className={d.id === activeId ? "tab active" : "tab"} onClick={() => switchDoc(d.id)}>
              {d.name}
              <span
                className="tab-close"
                title="close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeDoc(d.id);
                }}
              >
                ×
              </span>
            </button>
          ))}
        </span>
        <select value="" onChange={(e) => { e.target.blur(); if (e.target.value) openDoc(e.target.value); }}>
          <option value="">open…</option>
          {FIXTURES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button onClick={() => setView(view === "tiles" ? "pages" : "tiles")}>{view === "tiles" ? "page view" : "edit view"}</button>
        <select value={zoom} onChange={(e) => { e.target.blur(); setZoom(Number(e.target.value)); }} title="zoom (staff size)">
          {ZOOM_LEVELS.map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>
        <button onClick={() => structural("insert")}>+m</button>
        <button onClick={() => structural("delete")}>−m</button>
        <button onClick={() => structural("duplicate")}>⧉m</button>
        {/* Blur on change: a focused select swallows the editor keyboard
            (arrows would re-fire the dropdown, not move the caret). */}
        <select value="" title="clef at caret (staff-local)" onChange={(e) => { e.target.blur(); applyContext("clef", e.target.value); }}>
          <option value="">clef…</option>
          <option value="G2">𝄞 treble</option>
          <option value="F4">𝄢 bass</option>
          <option value="C3">𝄡 alto</option>
          <option value="C4">𝄡 tenor</option>
          <option value="G2v">𝄞 octave down</option>
        </select>
        <select value="" title="key signature at caret (score-wide)" onChange={(e) => { e.target.blur(); applyContext("key", e.target.value); }}>
          <option value="">key…</option>
          {["7f", "6f", "5f", "4f", "3f", "2f", "1f", "0", "1s", "2s", "3s", "4s", "5s", "6s", "7s"].map((k) => (
            <option key={k} value={k}>
              {k === "0" ? "C / a (0)" : k.endsWith("s") ? `${k[0]}♯` : `${k[0]}♭`}
            </option>
          ))}
        </select>
        <select value="" title="meter at caret (score-wide; refuses if content no longer fits)" onChange={(e) => { e.target.blur(); applyContext("meter", e.target.value); }}>
          <option value="">meter…</option>
          {["4/4", "3/4", "2/4", "2/2", "6/8", "9/8", "12/8", "5/4", "7/8", "5/8", "3/8"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <button onClick={saveDoc}>save</button>
        <span style={{ color: "#666", fontSize: 13 }} data-status>
          {status}
        </span>
      </header>
      <div style={{ color: "#999", fontSize: 12, marginBottom: 2 }}>
        {entryMode
          ? "INPUT · a–g pitch · shift+A–G chord · r rest · 7..1 duration (5=quarter) · . dot · s/v/n ♯/♭/♮ · t tie · , stacc · ; accent · shift+F/P dyn · esc exit"
          : "click note: caret · drag staves: block · i input mode · ←→ move · ↑↓ staff · shift extend · alt+↑↓ transpose · s/f/n accidental · m merge · x split · del → rest · bksp erases previous · ctrl+c/v copy/paste · ctrl+z undo"}
      </div>
      <div style={{ color: notice?.startsWith("paste refused") ? "#c22" : "#276", fontSize: 12, marginBottom: 4, minHeight: 15 }} data-notice>
        {notice ?? ""}
      </div>
      <style>{`
        .score-row { display: flex; align-items: flex-start; margin: 10px 0; }
        .tile, .rowhdr { position: relative; flex: none; }
        .tile svg, .rowhdr svg { width: 100%; height: 100%; display: block; }
        .tile g.mNum { display: none; } /* every tile is a "system start"; our .ms label already numbers it */
        .tile .ms { position: absolute; top: -4px; right: 2px; font-size: 10px; color: #bbb; z-index: 1; }
        .tile .placeholder { background: #f6f6f6; border-radius: 4px;
          color: #bbb; font-size: 11px; display: flex; align-items: center; justify-content: center; }
        .pages .page { max-width: 900px; margin: 0 auto 16px; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
        .pages .page svg { width: 100%; height: auto; display: block; }
        g[id]:hover { cursor: pointer; }
        .caret { position: absolute; width: 2px; background: #06c; pointer-events: none; animation: blink 1.1s step-end infinite; }
        @keyframes blink { 50% { opacity: 0.15; } }
        .tabs .tab { border: 1px solid #ccc; background: #f6f6f6; padding: 2px 8px; cursor: pointer; }
        .tabs .tab.active { background: #fff; border-bottom-color: #fff; font-weight: 600; }
        .tabs .tab-close { margin-left: 7px; color: #999; padding: 0 2px; }
        .tabs .tab-close:hover { color: #c22; }
        ${caretCss}
        ${selectionCss}
        ${blockCss}
      `}</style>
      <main
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        ref={mainRef}
        style={{ position: "relative", userSelect: "none" }}
        data-caret={caretId ?? ""}
        data-selection={selection.length}
        data-block={block ? `${block.measureFrom}-${block.measureTo}/${block.staffFrom}-${block.staffTo}` : ""}
        data-entry={entryMode ? `${entryDur}${entryDots ? "." : ""}` : ""}
      >
        {session && pool && view === "tiles" && <TileGrid key={activeId ?? -1} session={session} version={version} pool={pool} zoom={zoom} onRendered={onRendered} onSettled={onSettled} />}
        {session && pool && view === "pages" && <PageView key={`${activeId}-${version}`} session={session} pool={pool} />}
        {caretRect && view === "tiles" && <div className="caret" style={caretRect} />}
      </main>
    </div>
  );
}
