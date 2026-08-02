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
  key: string;
  svg: string;
  ms: number;
  cached: boolean;
  /** viewBox dimensions, for uniform-scale display. */
  w: number;
  h: number;
  /** Top staff line offset from the viewBox top (baseline alignment). */
  staffTop: number;
}

const parseViewBox = (svg: string): { w: number; h: number } => {
  const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 180, h: 240 };
};

/**
 * Distance from the tile's viewBox top to its first staff line, in outer
 * viewBox units. Staff paths live in Verovio's inner definition-scale space
 * (×10). Tiles vary here (ledger lines, fermatas, lyrics extend the crop);
 * pinning this offset to a common value aligns staves across the row.
 */
const parseStaffTop = (svg: string, h: number): number => {
  let min = Infinity;
  for (const m of svg.matchAll(/class="staff"[^>]*>\s*<path d="M\d+ (\d+)/g)) {
    const y = Number(m[1]) / 10;
    if (y < min) min = y;
  }
  return Number.isFinite(min) ? min : h * 0.4;
};

const measureTile = (svg: string, key: string, r: TileResult): TileState => {
  const { w, h } = parseViewBox(svg);
  return { key, svg, ms: r.renderMs, cached: r.cached, w, h, staffTop: parseStaffTop(svg, h) };
};

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
  const requestedKey = useRef(new Map<number, string>());
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

  // --- Document-wide vertical metrics: pin every staff to the same y and
  // give every tile the same box height (max extent above/below the staff
  // over all rendered tiles — ledger lines, lyrics, fermatas included).
  const measureCount = session.score.measures.length;
  const rendered = useMemo(() => [...tiles.values()], [tiles]);
  const maxTop = rendered.reduce((m, t) => Math.max(m, t.staffTop), 60);
  const maxBottom = rendered.reduce((m, t) => Math.max(m, t.h - t.staffTop), 140);
  const boxH = (maxTop + maxBottom) * zoom;

  // --- Row layout: greedy fill by real (or estimated) tile widths, each row
  // prefixed by a system-start header cell (clef + keysig for that context).
  const estimateW = useMemo(() => {
    const ws = rendered.map((t) => t.w).sort((a, b) => a - b);
    return ws[Math.floor(ws.length / 2)] ?? 150;
  }, [rendered]);
  const headerSlices = useMemo(() => Array.from({ length: measureCount }, (_, i) => synthesizeRowHeader(session.score, session.contexts, i)), [session, measureCount, version]);
  const rows = useMemo(() => {
    const out: { headerKey: string; indices: number[] }[] = [];
    const headerW = (key: string) => (headers.get(key)?.w ?? 110) * zoom;
    let cur: number[] = [];
    let acc = 0;
    for (let i = 0; i < measureCount; i++) {
      const wpx = (tiles.get(i)?.w ?? estimateW) * zoom;
      const hk = headerSlices[cur.length ? cur[0]! : i]!.key;
      if (cur.length && acc + wpx > containerW - headerW(hk)) {
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
  }, [measureCount, tiles, headers, estimateW, zoom, containerW, headerSlices]);
  const rowsSig = rows.map((r) => r.indices[0]).join(",");

  // Render the header cell for each row (cached by context key).
  useEffect(() => {
    for (const row of rows) {
      const slice = headerSlices[row.indices[0]!]!;
      if (requestedHeaders.current.has(slice.key)) continue;
      requestedHeaders.current.add(slice.key);
      void pool.render(slice.key, slice.xml).then((r) => {
        if (!alive.current || r.error) return;
        setHeaders((prev) => new Map(prev).set(slice.key, measureTile(r.svg, slice.key, r)));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsSig, headerSlices, pool]);

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

  useEffect(() => {
    // No cancellation here: an in-flight render stays valid unless a newer
    // key superseded it for the same tile (checked at resolve time). A
    // cancel-on-rerun flag would drop renders every time `visible` grows
    // during scrolling, permanently (requestedKey already marks them).
    // Header policy: the row-start header cells own clef/keysig/brackets, so
    // tiles draw only CHANGES (clef/keysig/meter where they differ from the
    // previous measure) plus the meter at the very start of the piece.
    // Hidden elements keep their values in force (pitch spelling, staff
    // positions); the page view always shows full engraving.
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
      if (requestedKey.current.get(index) === slice.key) continue;
      requestedKey.current.set(index, slice.key);
      jobs.push(
        pool.render(slice.key, slice.xml).then((r) => {
          if (!alive.current) return;
          if (requestedKey.current.get(index) !== slice.key) return; // superseded by an edit
          setTiles((prev) => new Map(prev).set(index, measureTile(r.svg, slice.key, r)));
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

  // Pin a tile's staff to the shared baseline inside the uniform box.
  const aligned = (t: TileState) => (
    <div style={{ width: t.w * zoom, height: boxH, overflow: "visible", position: "relative" }}>
      <div style={{ position: "absolute", top: (maxTop - t.staffTop) * zoom, width: t.w * zoom, height: t.h * zoom }} dangerouslySetInnerHTML={{ __html: t.svg }} />
    </div>
  );

  return (
    <div ref={containerRef}>
      {rows.map((row) => {
        const header = headers.get(row.headerKey);
        return (
          <div className="score-row" key={row.indices[0]}>
            {header && <div className="rowhdr">{aligned(header)}</div>}
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
                      {aligned(tile)}
                    </>
                  ) : (
                    <div className="placeholder" style={{ width: estimateW * zoom, height: boxH }}>
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
      if (!caret) return;

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        if (e.altKey) return;
        const next = e.key === "ArrowRight" ? caretRight(session.index, session.score, caret) : caretLeft(session.index, session.score, caret);
        if (!next) return;
        if (e.shiftKey) {
          if (!anchor.current) anchor.current = caret;
          setSelection(eventRange(session.index, session.score, anchor.current, next));
        } else {
          anchor.current = null;
          setSelection([]);
        }
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
  }, [session, caret, block, editTargets, afterCommand]);

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
        (block ? ` · block m${block.measureFrom + 1}–${block.measureTo + 1} / staff ${block.staffFrom}–${block.staffTo}` : "");

  const saveDoc = () => {
    if (!session || !active) return;
    const blob = new Blob([session.serializeForPageView()], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${active.name}-edited.mei`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const structural = (op: "insert" | "delete" | "duplicate") => {
    if (!session) return;
    const at = block ? block.measureFrom : caret?.measureIndex;
    const count = block ? block.measureTo - block.measureFrom + 1 : 1;
    if (at === undefined) {
      setNotice("place the caret or select a block first");
      return;
    }
    if (op === "insert") session.insertMeasures(at + count, count);
    else if (op === "delete") session.deleteMeasures(at, count);
    else session.duplicateMeasures(at, count);
    // Measure indexes shifted: a stale caret would silently retarget the
    // NEXT structural op at the wrong measure. Require an explicit target.
    setBlock(null);
    setCaret(null);
    setSelection([]);
    anchor.current = null;
    setNotice(op === "insert" ? `inserted ${count} empty measure(s) after m${at + count}` : op === "delete" ? `deleted m${at + 1}${count > 1 ? `–m${at + count}` : ""}` : `duplicated m${at + 1}${count > 1 ? `–m${at + count}` : ""}`);
    afterCommand(session);
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
            </button>
          ))}
        </span>
        <select value="" onChange={(e) => e.target.value && openDoc(e.target.value)}>
          <option value="">open…</option>
          {FIXTURES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button onClick={() => setView(view === "tiles" ? "pages" : "tiles")}>{view === "tiles" ? "page view" : "edit view"}</button>
        <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))} title="zoom (staff size)">
          {ZOOM_LEVELS.map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>
        <button onClick={() => structural("insert")}>+m</button>
        <button onClick={() => structural("delete")}>−m</button>
        <button onClick={() => structural("duplicate")}>⧉m</button>
        <button onClick={saveDoc}>save</button>
        <span style={{ color: "#666", fontSize: 13 }} data-status>
          {status}
        </span>
      </header>
      <div style={{ color: "#999", fontSize: 12, marginBottom: 2 }}>
        click note: caret · drag staves: block · ←→ move · ↑↓ staff · shift extend · alt+↑↓ transpose · s/f/n accidental · del → rest · ctrl+c/v copy/paste · ctrl+z undo
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
      >
        {session && pool && view === "tiles" && <TileGrid key={activeId ?? -1} session={session} version={version} pool={pool} zoom={zoom} onRendered={onRendered} onSettled={onSettled} />}
        {session && pool && view === "pages" && <PageView key={`${activeId}-${version}`} session={session} pool={pool} />}
        {caretRect && view === "tiles" && <div className="caret" style={caretRect} />}
      </main>
    </div>
  );
}
