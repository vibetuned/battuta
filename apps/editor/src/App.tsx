import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { synthesizeTile, synthesizeRowHeader, contextHash, caretLeft, caretRight, caretVertical, eventRange, normalizeBlock, fragmentToText, isHarmText, harmSuggestions, HARM_CHARS, reflectionForm, REFLECTION_CYCLE, REFLECTION_LABELS, type ReflectionForm, type PitchEvent, type HarmKind, type CaretPosition, type TileHeader, type BlockSelection, type ClipboardFragment } from "@battuta/core";
import { RenderPool, type TileResult } from "./render/renderPool";
import { loadKeymap, saveKeymapOverride, clearKeymapOverrides, keyMatches, type Keymap, type Layout } from "./keymap";
import { ShortcutEditor } from "./ShortcutEditor";
import { loadSettings, saveSettings, detectLayout } from "./settings";
import { scorePlayer, type PlayerState } from "./player";
import { DocumentSession } from "./session";
import { VirtualKeyboard } from "./VirtualKeyboard";
import { converter } from "./converter";
import { detectImport, IMPORT_FORMATS, EXPORT_FORMATS, OPEN_EXTENSIONS, type ExportFormat } from "./formats";
import { playbackToMidi } from "./midiExport";
import { saveStoredSession, loadStoredSession, clearStoredSession, type StoredSession } from "./sessionStore";

/** savedMarks sentinel for restored-dirty docs: never equals an editMark,
 * so the tab shows its star until the user actually saves. */
const RESTORED_DIRTY: unknown = { restoredDirty: true };

/** Auto-opened on dev startup (the dev server serves fixtures/ at the root). */
const DEV_FIXTURE = "synthetic-context-changes.mei";

/** Clipboard shared across all open documents (module scope = app scope). */
let sharedClipboard: ClipboardFragment | null = null;

interface OpenDoc {
  id: number;
  name: string;
  session: DocumentSession;
  /** Disk path when opened/saved natively (Tauri shell). */
  path?: string;
}

/** Tauri v2 global invoke (withGlobalTauri), or null in the browser. */
/** Tab name from a native path: both separators (Windows), any case. */
const OPEN_EXT_RE = new RegExp(`\\.(${OPEN_EXTENSIONS.join("|")})$`, "i");
const docNameFromPath = (path: string): string => path.split(/[\\/]/).pop()?.replace(OPEN_EXT_RE, "") || "score";

/** Folder of a native path (either separator); remembered for dialogs. */
const rememberDir = (path: string): void => {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (cut > 0) saveSettings({ lastDir: path.slice(0, cut) });
};

const tauriInvoke = (): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null => {
  const t = (window as unknown as { __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__;
  return t?.core?.invoke ?? null;
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
/** Blank score for the tabs' "+" button: one treble staff, 4/4, four
 * empty measures — everything else is a context/structural edit away. */
const blankScore = (): string => `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
  <meiHead><fileDesc><titleStmt><title>Untitled</title></titleStmt><pubStmt/></fileDesc></meiHead>
  <music><body><mdiv><score>
    <scoreDef meter.count="4" meter.unit="4" keysig="0">
      <staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp>
    </scoreDef>
    <section>
${Array.from({ length: 4 }, (_, i) => `      <measure n="${i + 1}"><staff n="1"><layer n="1"><mRest/></layer></staff></measure>`).join("\n")}
    </section>
  </score></mdiv></body></music></mei>
`;

/** Status-bar select chrome (dark, borderless like VSCode indicators). */
const STATUSBAR_SELECT: React.CSSProperties = {
  // appearance:none + color-scheme:dark: WebKitGTK renders native select
  // popups from the GTK side (tauri#11755) — this combination is the
  // closest CSS gets; the chevron returns via the .sbsel background image.
  appearance: "none",
  WebkitAppearance: "none",
  colorScheme: "dark",
  background: "#1f2733",
  color: "#cdd",
  border: "1px solid #3a4656",
  borderRadius: 3,
  fontSize: 12,
  padding: "0 16px 0 4px",
};

/** Clefs offered by the status-bar context select. */
const CLEFS: Record<string, { shape: string; line: number; dis?: number; disPlace?: "above" | "below" }> = {
  G2: { shape: "G", line: 2 },
  F4: { shape: "F", line: 4 },
  C3: { shape: "C", line: 3 },
  C4: { shape: "C", line: 4 },
  G2v: { shape: "G", line: 2, dis: 8, disPlace: "below" },
};
const CLEF_LABELS: Record<string, string> = { G2: "\u{1D11E} treble", F4: "\u{1D122} bass", C3: "\u{1D121} alto", C4: "\u{1D121} tenor", G2v: "\u{1D11E} octave down" };

/** Status-bar entry indicator: "1/8 ♪ (4)" = duration, glyph, digit key. */
const DUR_GLYPHS: Record<string, string> = { breve: "\u{1D15C}", "1": "\u{1D15D}", "2": "\u{1D15E}", "4": "\u2669", "8": "\u266A", "16": "\u{1D161}", "32": "\u{1D162}", "64": "\u{1D163}", "128": "\u{1D164}" };
const DUR_KEYS: Record<string, string> = { "1": "7", "2": "6", "4": "5", "8": "4", "16": "3", "32": "2", "64": "1" };

/** App-menu entry (the dropdown under the battuta name). */
const MENU_ITEM: React.CSSProperties = { textAlign: "left", background: "none", border: "none", padding: "7px 10px", fontSize: 13, cursor: "pointer", borderRadius: 4, fontFamily: "inherit", color: "#223", whiteSpace: "nowrap" };
const durIndicator = (dur: string, dots: number): string => {
  const dot = dots ? "." : "";
  const key = DUR_KEYS[dur];
  return `${dur === "breve" ? "2/1" : `1/${dur}`}${dot} ${DUR_GLYPHS[dur] ?? dur}${dot}${key ? ` (${key})` : ""}`;
};

export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5] as const;
export const DEFAULT_ZOOM = 1;

/** Playback tempo multipliers offered by the page-view player. */
const TEMPO_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** mm:ss for the player readout. */
const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Virtualized, edit-aware tile grid. Visibility (IntersectionObserver) and
 * content sync are separate: any visible tile whose cache key no longer
 * matches the document re-renders; clean tiles are cache hits. After each
 * sync batch settles, onSettled fires (drives the edit-latency HUD).
 */
function TileGrid({ session, version, pool, zoom, onRendered, onSettled, onLayout }: { session: DocumentSession; version: number; pool: RenderPool; zoom: number; onRendered: (r: TileResult) => void; onSettled: () => void; onLayout: () => void }) {
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

  // Any commit that can move tiles (fresh renders, the forced spacing pass,
  // header cells, zoom, container resize) must re-project overlays like the
  // caret — the parent recomputes them from the DOM after this fires.
  useEffect(() => {
    onLayout();
  }, [tiles, headers, measureTick, zoom, containerW, onLayout]);
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
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [playerPos, setPlayerPos] = useState(0);
  const [playerTotal, setPlayerTotal] = useState(0);
  const [playerTempo, setPlayerTempo] = useState(() => {
    const t = loadSettings().tempo;
    return t !== undefined && TEMPO_STEPS.includes(t as (typeof TEMPO_STEPS)[number]) ? t : 1;
  });
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Both render as bottom-right toasts and dismiss themselves (or on click).
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 10000);
    return () => clearTimeout(t);
  }, [error]);
  /** ⏱ toggle: render timings, measure counts, pool stats (off by default;
   * flip it in the battuta menu). */
  const [showPerf, setShowPerf] = useState(false);
  const [layout, setLayoutState] = useState<Layout>(() => loadSettings().layout ?? detectLayout());
  const [keymap, setKeymap] = useState<Keymap>(() => loadKeymap(layout));
  const setLayout = (l: Layout) => {
    setLayoutState(l);
    saveSettings({ layout: l });
    setKeymap(loadKeymap(l));
  };
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** App menu under the battuta name (open/save/tools). */
  const [menuOpen, setMenuOpen] = useState(false);
  /** On-screen keyboard drawer — defaults to visible on touch devices. */
  const [vkOpen, setVkOpen] = useState<boolean>(() => loadSettings().vkeys ?? (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches));
  const toggleVk = (open: boolean) => {
    setVkOpen(open);
    saveSettings({ vkeys: open });
  };
  /** Title editor buffer — null while closed (the header shows the button). */
  const [titleOpen, setTitleOpen] = useState<string | null>(null);
  /** Tempo editor buffer — same open/closed convention as the title. */
  const [tempoOpen, setTempoOpen] = useState<string | null>(null);
  /** Harmony lane: typed chord symbols / roman numerals at the caret. */
  const [harmLane, setHarmLane] = useState<HarmKind | null>(null);
  // The buffer state renders the floating editor; the REF is what the key
  // handler reads and writes. The window listener re-attaches only after
  // effects re-run, so a closure read races fast key sequences (Tab then
  // Enter committed the PRE-completion buffer); the ref cannot go stale.
  const [harmBuffer, _setHarmBuffer] = useState("");
  const harmBufRef = useRef("");
  const setHarmBuffer = useCallback((v: string | ((prev: string) => string)) => {
    harmBufRef.current = typeof v === "function" ? v(harmBufRef.current) : v;
    _setHarmBuffer(harmBufRef.current);
  }, []);

  /** Chord accidental picker: which note of the chord gets the accidental. */
  const [accidPick, setAccidPick] = useState<{ accid: "s" | "f" | "n" | "x"; chordId: string; notes: { id: string; pname: string; oct: string; accid?: string }[]; x: number; y: number } | null>(null);
  const [caret, setCaret] = useState<CaretPosition | null>(null);
  // Selection state renders highlights; the REFS are what key handlers
  // read — the window listener re-attaches only after effects re-run, so
  // a closure read races a fast click→key sequence (the harmony-buffer
  // lesson: shift-click a slur endpoint and press S immediately).
  const [selection, _setSelection] = useState<string[]>([]);
  const selectionRef = useRef<string[]>([]);
  const setSelection = useCallback((v: string[] | ((prev: string[]) => string[])) => {
    selectionRef.current = typeof v === "function" ? v(selectionRef.current) : v;
    _setSelection(selectionRef.current);
  }, []);
  const [block, _setBlock] = useState<BlockSelection | null>(null);
  const blockRef = useRef<BlockSelection | null>(null);
  const setBlock = useCallback((v: BlockSelection | null | ((prev: BlockSelection | null) => BlockSelection | null)) => {
    blockRef.current = typeof v === "function" ? v(blockRef.current) : v;
    _setBlock(blockRef.current);
  }, []);
  const [clipInfo, setClipInfo] = useState<string | null>(null);
  const anchor = useRef<CaretPosition | null>(null);
  const dragAnchor = useRef<{ measureIndex: number; staffN: number } | null>(null);
  const dragging = useRef(false);
  const [stats, setStats] = useState({ rendered: 0, freshMs: 0, fresh: 0 });
  const [editLatency, setEditLatency] = useState<number | null>(null);
  const pendingEdit = useRef(false);
  const [caretRect, setCaretRect] = useState<{ left: number; top: number; height: number } | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  // Zoom persists across sessions: the saved level seeds startup and is
  // the default every newly opened document starts at.
  const [zoom, setZoom] = useState(() => {
    const z = loadSettings().zoom;
    return z !== undefined && (ZOOM_LEVELS as readonly number[]).includes(z) ? z : DEFAULT_ZOOM;
  });
  useEffect(() => {
    saveSettings({ zoom });
  }, [zoom]);
  const zoomByDoc = useRef(new Map<number, number>());
  // Undo-stack top at the last save, per doc: dirty = the top moved. Undoing
  // back to the saved command reads clean again, like a text editor.
  const savedMarks = useRef(new Map<number, unknown>());
  /** shift+R cycle state: the base pitches captured at the first press.
   * version-keyed — any other edit (or undo) re-bases the cycle. */
  const reflectCycle = useRef<{ sig: string; base: PitchEvent[][]; step: number; version: number } | null>(null);
  /** The caret id the view last followed — scroll only on real moves. */
  const lastScrolledCaret = useRef<string | undefined>(undefined);
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
    scorePlayer.stop();
  }, []);

  /** Disk mtime per open path, recorded at open/save — the save path
   * compares against it so an EXTERNAL change is alerted before it
   * would be overwritten (shell only; browsers have no file identity). */
  const diskMtimes = useRef(new Map<string, number>());
  const recordMtime = useCallback((path: string) => {
    const invoke = tauriInvoke();
    if (!invoke) return;
    invoke("file_mtime", { path })
      .then((m) => {
        if (typeof m === "number") diskMtimes.current.set(path, m);
      })
      .catch(() => undefined);
  }, []);

  /** Open a document from raw MEI text (fixtures and disk files alike). */
  const openXml = useCallback(
    (name: string, xml: string, path?: string) => {
      setError(null);
      try {
        const s = new DocumentSession(xml);
        if (import.meta.env.DEV || "__TAURI__" in window) (window as unknown as Record<string, unknown>).__SESSION__ = s;
        const doc: OpenDoc = { id: nextDocId++, name, session: s, ...(path ? { path } : {}) };
        savedMarks.current.set(doc.id, s.editMark);
        if (path) recordMtime(path);
        setDocs((ds) => [...ds, doc]);
        setActiveId(doc.id);
        resetDocUiState();
        setStats({ rendered: 0, freshMs: 0, fresh: 0 });
      } catch (e) {
        setError(String(e));
      }
    },
    [resetDocUiState, recordMtime],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openDoc = useCallback(
    (fixture: string) => {
      setError(null);
      fetch("/" + fixture)
        .then((r) => r.text())
        .then((xml) => openXml(fixture.replace(/\.mei$/, ""), xml))
        .catch((e) => setError(String(e)));
    },
    [openXml],
  );

  /** "+" tab: a fresh blank score, named untitled-1, -2, … */
  const newDoc = useCallback(() => {
    try {
      const s = new DocumentSession(blankScore());
      if (import.meta.env.DEV || "__TAURI__" in window) (window as unknown as Record<string, unknown>).__SESSION__ = s;
      const id = nextDocId++;
      savedMarks.current.set(id, s.editMark);
      setDocs((ds) => {
        const n = ds.filter((d) => d.name.startsWith("untitled-")).length + 1;
        return [...ds, { id, name: `untitled-${n}`, session: s }];
      });
      setActiveId(id);
      resetDocUiState();
      setStats({ rendered: 0, freshMs: 0, fresh: 0 });
    } catch (e) {
      setError(String(e));
    }
  }, [resetDocUiState]);

  // Open the default document on startup (ref-guarded: StrictMode runs
  // mount effects twice, and two fetches would open two tabs).
  /** Bring back the persisted tabs (crash/close recovery). */
  const restoreSession = useCallback(
    (s: StoredSession): boolean => {
      try {
        const created: OpenDoc[] = [];
        for (const sd of s.docs) {
          const sess = new DocumentSession(sd.xml);
          const id = nextDocId++;
          created.push({ id, name: sd.name, session: sess, ...(sd.path ? { path: sd.path } : {}) });
          savedMarks.current.set(id, sd.dirty ? RESTORED_DIRTY : sess.editMark);
        }
        if (created.length === 0) return false;
        setDocs(created);
        const act = created[Math.min(Math.max(0, s.active), created.length - 1)]!;
        setActiveId(act.id);
        if (import.meta.env.DEV || "__TAURI__" in window) (window as unknown as Record<string, unknown>).__SESSION__ = act.session;
        setVersion(act.session.version);
        setNotice(`session restored (${created.length} document${created.length > 1 ? "s" : ""})`);
        return true;
      } catch (e) {
        setError(`session restore failed: ${e instanceof Error ? e.message : e}`);
        clearStoredSession(); // a poisoned blob must not block every start
        return false;
      }
    },
    [],
  );

  const openedInitial = useRef(false);
  useEffect(() => {
    if (openedInitial.current) return;
    openedInitial.current = true;
    // Crash/close recovery first. DEV restores only when unsaved work is
    // at stake (the fixture is the dev workflow; e2e contexts are fresh).
    const stored = loadStoredSession();
    const restored = stored !== null && stored.docs.length > 0 && (!import.meta.env.DEV || stored.docs.some((d) => d.dirty)) ? restoreSession(stored) : false;
    if (import.meta.env.DEV) {
      if (!restored) openDoc(DEV_FIXTURE);
      return;
    }
    // Shell: a score double-clicked in the file manager arrives as a
    // launch argument; pull it (a Rust-side emit would race this mount).
    const invoke = tauriInvoke();
    if (!invoke) {
      if (!restored) newDoc();
      return;
    }
    invoke("initial_score")
      .then((r) => {
        const pair = r as [string, string] | null;
        if (pair) {
          rememberDir(pair[0]);
          importText(pair[0], pair[1], pair[0]); // alongside restored tabs
        } else if (!restored) newDoc();
      })
      .catch(() => {
        if (!restored) newDoc();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchDoc = (id: number) => {
    if (id === activeId) return;
    if (activeId !== null) zoomByDoc.current.set(activeId, zoom);
    setActiveId(id);
    setZoom(zoomByDoc.current.get(id) ?? zoom);
    resetDocUiState();
    const s = docs.find((d) => d.id === id)?.session;
    if (s) {
      if (import.meta.env.DEV || "__TAURI__" in window) (window as unknown as Record<string, unknown>).__SESSION__ = s;
      setVersion(s.version);
    }
  };

  // --- crash/close recovery: persist the open tabs, debounced after
  // every change, and once more synchronously on beforeunload (covers
  // the app window closing; a hard crash loses at most the debounce).
  const buildStoredSession = useCallback((): StoredSession | null => {
    if (docs.length === 0) return null;
    return {
      docs: docs.map((d) => ({
        name: d.name,
        ...(d.path ? { path: d.path } : {}),
        xml: d.session.saveDocument(),
        dirty: d.session.editMark !== (savedMarks.current.get(d.id) ?? null),
      })),
      active: Math.max(0, docs.findIndex((d) => d.id === activeId)),
    };
  }, [docs, activeId]);
  const buildStoredRef = useRef(buildStoredSession);
  buildStoredRef.current = buildStoredSession;
  const persistSession = useCallback(() => {
    const s = buildStoredRef.current();
    if (s) saveStoredSession(s);
    else clearStoredSession();
  }, []);
  useEffect(() => {
    const t = setTimeout(persistSession, 1000);
    return () => clearTimeout(t);
  }, [docs, activeId, version, persistSession]);
  useEffect(() => {
    window.addEventListener("beforeunload", persistSession);
    return () => window.removeEventListener("beforeunload", persistSession);
  }, [persistSession]);

  const closeDoc = (id: number) => {
    // A dirty tab asks before its work is discarded (the session store
    // keeps CLOSED-APP work, not individually closed tabs).
    const doc = docs.find((d) => d.id === id);
    if (doc && doc.session.editMark !== (savedMarks.current.get(id) ?? null) && !window.confirm(`"${doc.name}" has unsaved changes — close it anyway?`)) return;
    const remaining = docs.filter((d) => d.id !== id);
    setDocs(remaining);
    zoomByDoc.current.delete(id);
    if (id === activeId) {
      const next = remaining[remaining.length - 1] ?? null;
      setActiveId(next?.id ?? null);
      if (next) setZoom(zoomByDoc.current.get(next.id) ?? zoom);
      resetDocUiState();
      if (next) {
        if (import.meta.env.DEV || "__TAURI__" in window) (window as unknown as Record<string, unknown>).__SESSION__ = next.session;
        setVersion(next.session.version);
      }
    }
  };

  const caretId = session && caret ? session.index.eventIdAt(caret) : undefined;

  // --- one selection model: shift-runs and mouse blocks are two INPUTS;
  // every action derives the granularity it needs from whichever exists ---

  /** Bounding block of an event-id selection (measure span × staff span). */
  const blockFromSelection = useCallback((): BlockSelection | null => {
    const sel = selectionRef.current;
    if (!session || sel.length === 0) return null;
    let mFrom = Infinity, mTo = -1, sFrom = Infinity, sTo = -1;
    for (const id of sel) {
      const r = session.index.byId.get(id);
      if (!r) continue;
      mFrom = Math.min(mFrom, r.measureIndex);
      mTo = Math.max(mTo, r.measureIndex);
      sFrom = Math.min(sFrom, r.staffN);
      sTo = Math.max(sTo, r.staffN);
    }
    return mTo < 0 ? null : { measureFrom: mFrom, measureTo: mTo, staffFrom: sFrom, staffTo: sTo };
  }, [session, selection]);

  /** Event run of a single-staff block: the caret's voice when it sits
   * inside the block, else voice 1. Multi-staff blocks have no run. */
  const runFromBlock = useCallback((): string[] => {
    const b = blockRef.current;
    if (!session || !b || b.staffFrom !== b.staffTo) return [];
    const s = b.staffFrom;
    const inBlock = caret && caret.staffN === s && caret.measureIndex >= b.measureFrom && caret.measureIndex <= b.measureTo;
    const l = inBlock ? caret.layerN : 1;
    const ids: string[] = [];
    for (let m = b.measureFrom; m <= b.measureTo; m++) ids.push(...session.index.eventsAt(m, s, l));
    // A dragged box is coarse: trim rests at the edges so span endpoints
    // (slur/hairpin/pedal) land on real notes; inner rests stay.
    const pitched = (id: string) => {
      const tag = session.index.byId.get(id)?.tag;
      return tag === "note" || tag === "chord";
    };
    let from = 0;
    let to = ids.length - 1;
    while (from <= to && !pitched(ids[from]!)) from++;
    while (to >= from && !pitched(ids[to]!)) to--;
    return ids.slice(from, to + 1);
  }, [session, block, caret]);

  /** ids an edit applies to: the selection, else every event under the
   * mouse block (all staves and voices), else the caret event. */
  const editTargets = useCallback((): string[] => {
    if (selectionRef.current.length) return selectionRef.current;
    const b = blockRef.current;
    if (session && b) {
      const ids: string[] = [];
      for (let m = b.measureFrom; m <= b.measureTo; m++) {
        for (const s of session.index.stavesPerMeasure.get(m) ?? []) {
          if (s < b.staffFrom || s > b.staffTo) continue;
          for (const l of session.index.layersPerStaff.get(`${m}/${s}`) ?? []) ids.push(...session.index.eventsAt(m, s, l));
        }
      }
      if (ids.length) return ids;
    }
    return caretId ? [caretId] : [];
  }, [selection, caretId, session, block]);

  const afterCommand = useCallback(
    (s: DocumentSession) => {
      pendingEdit.current = true;
      scorePlayer.stop(); // an edit invalidates the scheduled timemap
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

  // --- page-view player: audio + highlight ride the same timemap ---
  useEffect(() => {
    scorePlayer.onStateChange = setPlayerState;
    scorePlayer.onHighlight = (on, off, measureOn) => {
      const root = document.querySelector(".pages");
      if (!root) return;
      if (on.length === 0 && off.length === 0 && !measureOn) {
        for (const el of root.querySelectorAll("g.playing")) el.classList.remove("playing");
        return;
      }
      for (const id of off) root.querySelector(`g[id="${CSS.escape(id)}"]`)?.classList.remove("playing");
      for (const id of on) root.querySelector(`g[id="${CSS.escape(id)}"]`)?.classList.add("playing");
      if (measureOn) {
        const m = root.querySelector(`g[id="${CSS.escape(measureOn)}"]`);
        if (m) {
          const r = m.getBoundingClientRect();
          // Follow the music, but only when it actually leaves the viewport.
          if (r.top < 60 || r.bottom > window.innerHeight - 60) m.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
    };
    scorePlayer.setTempo(playerTempo); // restore the persisted tempo
    return () => scorePlayer.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (view !== "pages") scorePlayer.stop();
  }, [view]);
  // Progress polling: 4 Hz while the player is active.
  useEffect(() => {
    if (playerState === "idle" || playerState === "loading") {
      setPlayerPos(0);
      setPlayerTotal(0);
      return;
    }
    const tick = () => {
      setPlayerPos(scorePlayer.position());
      setPlayerTotal(scorePlayer.total());
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [playerState]);
  const onPlayPause = useCallback(() => {
    if (playerState === "playing") {
      scorePlayer.pause();
      return;
    }
    if (playerState === "paused") {
      scorePlayer.resume();
      return;
    }
    if (playerState === "loading" || !session || !pool) return;
    void scorePlayer.unlock(); // inside the gesture, before any await
    const { xml, expand } = session.serializeForPlayback();
    pool
      .documentTimemap(xml, expand)
      .then((data) => {
        if (data.error) {
          setNotice(`playback failed: ${data.error}`);
          return;
        }
        data.shaping = session.playbackShaping(); // ties + slur/artic gates
        if (import.meta.env.DEV || "__TAURI__" in window) (window as unknown as Record<string, unknown>).__PLAYBACK__ = data;
        return scorePlayer.play(data);
      })
      .catch((e) => setNotice(`playback failed: ${e instanceof Error ? e.message : e}`));
  }, [playerState, session, pool]);

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
      if (!session || !value) return;
      if (!caret) {
        setNotice("place the caret first");
        return;
      }
      try {
        if (kind === "key") session.changeContext(caret.measureIndex, { keysig: value });
        else if (kind === "meter") {
          const [count, unit] = value.split("/");
          session.changeContext(caret.measureIndex, { meter: { count: count!, unit: unit! } });
        } else {
          if (!CLEFS[value]) return;
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
      const b = block ?? blockFromSelection();
      const at = b ? b.measureFrom : caret?.measureIndex;
      const count = b ? b.measureTo - b.measureFrom + 1 : 1;
      if (at === undefined) {
        setNotice("place the caret or select a block first");
        return;
      }
      const staffWish = b ? b.staffFrom : caret?.staffN ?? 1;
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
    [session, block, caret, afterCommand, blockFromSelection],
  );

  // A harmony lane edits the harm at the caret: (re)load its text whenever
  // the caret moves (click, arrows, commit-advance).
  useEffect(() => {
    if (!harmLane || !session || !caretId) return;
    setHarmBuffer(session.harmAt(caretId, harmLane));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harmLane, caretId, session, version]);

  /** Chord accidentals are per-note (an all-notes sharp is rarely meant):
   * for a chord target, open a picker near the glyph instead of applying. */
  const openAccidPicker = useCallback(
    (chordId: string, accid: "s" | "f" | "n" | "x"): boolean => {
      if (!session || session.index.byId.get(chordId)?.tag !== "chord") return false;
      const notes = session.chordNotes(chordId);
      if (notes.length === 0) return false;
      const r = document.querySelector(`g[id="${CSS.escape(chordId)}"]`)?.getBoundingClientRect();
      setAccidPick({ accid, chordId, notes, x: r ? r.left : window.innerWidth / 2, y: r ? r.bottom + 6 : window.innerHeight / 3 });
      return true;
    },
    [session],
  );

  /**
   * Open any supported TEXT format: MEI directly (keeps its path), the
   * rest converted to MEI through the lazy Verovio worker. Converted
   * documents carry NO path — a plain ctrl+s must never overwrite the
   * .musicxml/.abc/.krn source with MEI.
   */
  const importText = useCallback(
    (filename: string, contents: string, path?: string) => {
      const fmt = detectImport(filename, contents);
      if (fmt === null) {
        setNotice(`unsupported file type: ${filename}`);
        return;
      }
      if (fmt === "mei") {
        openXml(docNameFromPath(filename), contents, path);
        return;
      }
      const label = IMPORT_FORMATS.find((x) => x.id === fmt)?.label ?? fmt;
      setNotice(`converting ${label}…`);
      converter
        .toMEI(fmt, contents)
        .then((mei) => {
          openXml(docNameFromPath(filename), mei);
          setNotice(`imported ${filename} (${label} → MEI)`);
        })
        .catch((e) => setError(`import failed: ${e instanceof Error ? e.message : e}`));
    },
    [openXml],
  );

  /** Compressed MusicXML (.mxl) is a zip — it arrives as bytes. */
  const importBinary = useCallback(
    (filename: string, bytes: ArrayBuffer) => {
      setNotice("converting compressed MusicXML…");
      converter
        .toMEI("mxl", bytes)
        .then((mei) => {
          openXml(docNameFromPath(filename), mei);
          setNotice(`imported ${filename} (compressed MusicXML → MEI)`);
        })
        .catch((e) => setError(`import failed: ${e instanceof Error ? e.message : e}`));
    },
    [openXml],
  );

  /** ctrl+o: native dialog in the shell, the hidden file input in browsers. */
  const openScore = useCallback(() => {
    const invoke = tauriInvoke();
    if (!invoke) {
      fileInputRef.current?.click();
      return;
    }
    invoke("open_score", { dir: loadSettings().lastDir ?? null })
      .then((r) => {
        const pair = r as [string, string] | null;
        if (!pair) return; // cancelled
        const [path, contents] = pair;
        rememberDir(path);
        // The shell base64-encodes .mxl (zip) contents — see open_score.
        if (path.toLowerCase().endsWith(".mxl")) {
          const bin = Uint8Array.from(atob(contents), (c) => c.charCodeAt(0));
          importBinary(path, bin.buffer);
        } else importText(path, contents, path);
      })
      .catch((e) => setNotice(`open failed: ${e}`));
  }, [importText, importBinary]);

  /** ctrl+s / ctrl+shift+s: silent save to the known path, else save-as
   * dialog (shell); browsers keep the download. */
  const saveActive = useCallback(
    (saveAs = false) => {
      if (!session || !active) return;
      const xml = session.saveDocument();
      const invoke = tauriInvoke();
      const markSaved = () => {
        savedMarks.current.set(active.id, active.session.editMark);
        setDocs((ds) => [...ds]); // re-render: the tab's dirty star clears
      };
      if (!invoke) {
        const blob = new Blob([xml], { type: "application/xml" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${active.name}.mei`;
        a.click();
        URL.revokeObjectURL(a.href);
        markSaved();
        setNotice(`downloaded ${active.name}.mei`);
        return;
      }
      if (!saveAs && active.path) {
        const path = active.path;
        const write = () =>
          invoke("save_score", { path, contents: xml })
            .then(() => {
              markSaved();
              recordMtime(path);
              setNotice(`saved ${path}`);
            })
            .catch((e) => setNotice(`save failed: ${e}`));
        // External-change guard: the file may have been edited by another
        // program since it was opened/last saved — alert before clobbering.
        invoke("file_mtime", { path })
          .then((m) => {
            const known = diskMtimes.current.get(path);
            if (typeof m === "number" && known !== undefined && m !== known && !window.confirm(`"${path}" changed on disk since it was opened here.\n\nOverwrite the external changes?`)) {
              setNotice("save cancelled — the file changed on disk (save-as keeps both)");
              return;
            }
            void write();
          })
          .catch(() => void write()); // mtime unavailable: save normally
        return;
      }
      invoke("save_score_as", { contents: xml, suggested: `${active.name}.mei`, dir: loadSettings().lastDir ?? null })
        .then((r) => {
          const path = r as string | null;
          if (!path) return; // cancelled
          rememberDir(path);
          recordMtime(path);
          const name = docNameFromPath(path);
          markSaved();
          setDocs((ds) => ds.map((d) => (d.id === active.id ? { ...d, path, name } : d)));
          setNotice(`saved ${path}`);
        })
        .catch((e) => setNotice(`save failed: ${e}`));
    },
    [session, active, recordMtime],
  );
  const saveDoc = () => saveActive(false);

  /** Write an export: download in browsers, native save dialog in the shell. */
  const saveExport = useCallback((filename: string, data: string | Uint8Array, mime: string): Promise<void> => {
    const invoke = tauriInvoke();
    if (!invoke) {
      const blob = new Blob([data as BlobPart], { type: mime });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      return Promise.resolve();
    }
    const bytes = typeof data === "string" ? Array.from(new TextEncoder().encode(data)) : Array.from(data);
    return invoke("export_file", { bytes, suggested: filename, dir: loadSettings().lastDir ?? null }).then((r) => {
      const path = r as string | null;
      if (path) rememberDir(path);
    });
  }, []);

  /** Export the active score in a Verovio-backed format (battuta menu). */
  const exportAs = useCallback(
    (id: ExportFormat["id"]) => {
      if (!session || !active || !pool) return;
      const f = EXPORT_FORMATS.find((x) => x.id === id)!;
      const run = async () => {
        if (id === "svg") {
          // The page-view engraving, one file per page (1-based indices).
          const svgs: string[] = [];
          const count = await pool.renderDocumentPages(session.serializeForPageView(), (i, svg) => {
            svgs[i - 1] = svg;
          });
          for (let i = 0; i < count; i++) await saveExport(count > 1 ? `${active.name}-p${i + 1}.svg` : `${active.name}.svg`, svgs[i]!, f.mime);
          setNotice(`exported ${count} SVG page${count > 1 ? "s" : ""}`);
          return;
        }
        const out = await converter.fromMEI(id, session.serializeForPageView());
        // The worker returns MIDI as base64 (a standard .mid file's bytes).
        const payload = f.binary ? Uint8Array.from(atob(out), (c) => c.charCodeAt(0)) : out;
        await saveExport(`${active.name}.${f.ext}`, payload, f.mime);
        setNotice(`exported ${active.name}.${f.ext}`);
      };
      setNotice(`exporting ${f.label}…`);
      run().catch((e) => setError(`export failed: ${e instanceof Error ? e.message : e}`));
    },
    [session, active, pool, saveExport],
  );

  /**
   * battuta's playback as MIDI — the SOLVED form the player performs
   * (repeats/voltas/jump expanded, ties merged, articulation gates),
   * not Verovio's written-score MIDI.
   */
  const exportPlaybackMidi = useCallback(() => {
    if (!session || !active || !pool) return;
    setNotice("exporting playback MIDI…");
    const { xml, expand } = session.serializeForPlayback();
    pool
      .documentTimemap(xml, expand)
      .then((data) => {
        if (data.error) throw new Error(data.error);
        if (data.events.length === 0) throw new Error("nothing to play");
        data.shaping = session.playbackShaping();
        return saveExport(`${active.name}-playback.mid`, playbackToMidi(data), "audio/midi");
      })
      .then(() => setNotice(`exported ${active.name}-playback.mid`))
      .catch((e) => setError(`export failed: ${e instanceof Error ? e.message : e}`));
  }, [session, active, pool, saveExport]);

  /** ctrl+± and the loupe buttons step through the fixed zoom levels. */
  const zoomStep = useCallback(
    (dir: -1 | 1) => {
      setZoom((z) => {
        const at = ZOOM_LEVELS.reduce((best, lv, i) => (Math.abs(lv - z) < Math.abs(ZOOM_LEVELS[best]! - z) ? i : best), 0);
        return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, at + dir))]!;
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
      if (shortcutsOpen) return; // the shortcut editor owns the keyboard
      const mod = e.ctrlKey || e.metaKey;
      const hit = (id: string) => keyMatches(keymap[id], e);
      // Either input serves every action: the run for event-shaped ones
      // (from a single-staff block when there is no shift-run), the block
      // for measure-shaped ones (bounding the shift-run when not dragged).
      const run = selectionRef.current.length ? selectionRef.current : runFromBlock();
      const bsel = blockRef.current ?? blockFromSelection();

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey ? session.stack.canRedo : session.stack.canUndo) {
          e.shiftKey ? session.redo() : session.undo();
          afterCommand(session);
        }
        return;
      }
      if (mod && (e.key === "+" || e.key === "=")) {
        e.preventDefault(); // never the browser's page zoom
        zoomStep(1);
        return;
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        zoomStep(-1);
        return;
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        setZoom(DEFAULT_ZOOM);
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault(); // the browser's own save dialog must never win
        saveActive(e.shiftKey);
        return;
      }
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openScore();
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
        const b = bsel ?? (caret ? normalizeBlock({ measureIndex: caret.measureIndex, staffN: caret.staffN }, { measureIndex: caret.measureIndex, staffN: caret.staffN }) : null);
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
        const target = bsel ? { measureIndex: bsel.measureFrom, staffN: bsel.staffFrom } : caret ? { measureIndex: caret.measureIndex, staffN: caret.staffN } : null;
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
      if (!mod && (e.code === "NumpadAdd" || e.code === "NumpadSubtract" || e.code === "NumpadMultiply")) {
        e.preventDefault();
        structural(e.code === "NumpadAdd" ? "insert" : e.code === "NumpadSubtract" ? "delete" : "duplicate");
        return;
      }
      if (!caret) return;

      // --- note input mode: letters enter, digits set duration ---
      // The Insert key toggles input mode in both directions (i only
      // enters; inside the mode "i" stays available to future bindings).
      if (e.key === "Insert" && !mod) {
        e.preventDefault();
        setEntryMode(!entryMode);
        setNotice(entryMode ? null : "note input: a–g pitch · shift+A–G chord · 1–7 duration · esc exit · all keys under 🌣");
        return;
      }
      if (!entryMode && hit("inputMode") && !mod) {
        e.preventDefault();
        setEntryMode(true);
        setNotice("note input: a–g pitch · shift+A–G chord · 1–7 duration · esc exit · all keys under 🌣");
        return;
      }
      if (accidPick) {
        // The picker owns the keyboard: letter (or number) picks the chord
        // note, anything else cancels.
        e.preventDefault();
        const pick = /^[1-9]$/.test(e.key)
          ? accidPick.notes[Number(e.key) - 1]
          : /^[a-g]$/i.test(e.key)
            ? accidPick.notes.find((n) => n.pname === e.key.toLowerCase())
            : undefined;
        setAccidPick(null);
        if (pick) {
          try {
            session.chordNoteAccidental(accidPick.chordId, pick.id, accidPick.accid);
            afterCommand(session);
            setNotice(null);
          } catch (err) {
            setNotice(`accidental refused: ${err instanceof Error ? err.message : err}`);
          }
        }
        return;
      }
      if (harmLane) {
        // The harmony lane owns the keyboard: a closed grammar of chord
        // symbols / numerals, Enter commits + advances, Tab autocompletes,
        // arrows commit + move, Escape leaves the lane.
        e.preventDefault();
        if (!caret || !caretId) {
          if (e.key === "Escape") setHarmLane(null);
          return;
        }
        const buf = harmBufRef.current; // ref, not closure: see declaration
        const commit = (): boolean => {
          const existing = session.harmAt(caretId, harmLane);
          if (buf === existing) return true; // nothing to do
          if (buf !== "" && !isHarmText(harmLane, buf)) {
            setNotice(`incomplete ${harmLane === "rna" ? "numeral" : "chord symbol"}: "${buf}"`);
            return false;
          }
          try {
            session.setHarm(caretId, buf, harmLane);
            afterCommand(session);
            setNotice(null);
            return true;
          } catch (err) {
            setNotice(`harmony refused: ${err instanceof Error ? err.message : err}`);
            return false;
          }
        };
        if (e.key === "Escape") {
          if (commit()) setHarmLane(null);
          return;
        }
        if (e.key === "Enter" || e.key === "ArrowRight" || e.key === "ArrowLeft") {
          if (!commit()) return;
          const next = e.key === "ArrowLeft" ? caretLeft(session.index, session.score, caret) : caretRight(session.index, session.score, caret);
          if (next) {
            lastEntered.current = null;
            setCaret(next);
          }
          return;
        }
        if (e.key === "Backspace") {
          setHarmBuffer((b) => b.slice(0, -1));
          return;
        }
        if (e.key === "Tab") {
          const s = harmSuggestions(harmLane, buf)[0];
          if (s) setHarmBuffer(s);
          return;
        }
        if (e.key.length === 1) {
          let ch = e.key;
          if (harmLane === "rna") {
            if (ch === "o") ch = "°";
            if (ch === "0") ch = "ø";
          }
          if (HARM_CHARS[harmLane].test(ch)) setHarmBuffer((b) => b + ch);
        }
        return;
      }
      if (hit("slurDoubleSharp") && !mod) {
        e.preventDefault();
        // With a selection: slur between its ends (unchanged). On a single
        // target: DOUBLE SHARP — shift+s, mirroring plain s (tester ask).
        if (run.length >= 2) {
          try {
            session.toggleSlur(run[0]!, run[run.length - 1]!);
            afterCommand(session);
            setNotice("slur toggled");
          } catch (err) {
            setNotice(`slur refused: ${err instanceof Error ? err.message : err}`);
          }
          return;
        }
        const target = entryMode && lastEntered.current && session.index.byId.has(lastEntered.current) ? lastEntered.current : caretId;
        if (!target) return;
        try {
          if (openAccidPicker(target, "x")) return;
          session.toggleAccidental([target], "x");
          afterCommand(session);
          setNotice(null);
        } catch (err) {
          setNotice(`double sharp refused: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
      if (!mod && !e.altKey) {
        // Single markings (tester round). Same target rule as the dot.
        const target = entryMode && lastEntered.current && session.index.byId.has(lastEntered.current) ? lastEntered.current : caretId;
        const markTry = (fn: () => void, what: string) => {
          e.preventDefault();
          try {
            fn();
            afterCommand(session);
            setNotice(null);
          } catch (err) {
            setNotice(`${what} refused: ${err instanceof Error ? err.message : err}`);
          }
        };
        // marcato: the accent key SHIFTED (AZERTY shift+; = "." · QWERTY
        // shift+; = ":" · shift+. = ">"); the dot keeps the unshifted forms
        if (hit("marcato") && target) {
          markTry(() => session.toggleArtic([target], "marc"), "marcato");
          return;
        }
        // staccatissimo: the staccato key shifted ("<" QWERTY, "?" AZERTY)
        if (hit("staccatissimo") && target) {
          markTry(() => session.toggleArtic([target], "stacciss"), "staccatissimo");
          return;
        }
        if (hit("fermata") && target) {
          markTry(() => session.toggleMark(target, "fermata"), "fermata");
          return;
        }
        if (hit("coda") && target) {
          markTry(() => session.toggleMark(target, "coda"), "coda");
          return;
        }
        // simile slash: the ù/' key (physical Quote) replaces one beat
        if (hit("simile") && target) {
          markTry(() => session.simile(target), "simile");
          return;
        }
        // measure repeats: shift on the same key ("%" AZERTY, '"' QWERTY)
        // cycles content → % → %% → empty at the caret's voice
        if (hit("measureRepeat") && caret) {
          markTry(() => session.measureRepeat(caret), "measure repeat");
          return;
        }
        // attack intensity (I — plain i toggles note input): a dynam
        // cycling sf → sfz → rinf → rfz → off at the target
        if (hit("intensity") && target) {
          markTry(() => session.cycleDynam(target, ["sf", "sfz", "rinf", "rfz"]), "intensity");
          return;
        }
        // one key circles the four ornaments: arpeggio (chords) → tremolo
        // → trill → mordent → off
        if (hit("ornament") && target) {
          markTry(() => session.cycleOrnament(target), "ornament");
          return;
        }
      }
      if (hit("tie") && !mod && run.length >= 2) {
        e.preventDefault();
        // Multi-measure tie: the selected run becomes one tie chain
        // (i/m/t), one undo step; same selection again unties it.
        try {
          session.tieChain(run);
          afterCommand(session);
          setNotice("tie chain toggled");
        } catch (err) {
          setNotice(`tie refused: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
      if (hit("tie") && !mod) {
        // Tie the note back to its predecessor — ACROSS the barline when it
        // opens the measure (same gesture everywhere); only with no previous
        // note at all (piece start, rest before) does it tie forward.
        const applyTo = entryMode && lastEntered.current && session.index.byId.has(lastEntered.current) ? lastEntered.current : caretId;
        if (!applyTo) return;
        e.preventDefault();
        const ref = session.index.byId.get(applyTo);
        const prevId = ref
          ? ref.eventIndex > 0
            ? session.index.eventsAt(ref.measureIndex, ref.staffN, ref.layerN)[ref.eventIndex - 1]
            : session.index.eventsAt(ref.measureIndex - 1, ref.staffN, ref.layerN).at(-1)
          : undefined;
        try {
          session.toggleTie(prevId && session.index.byId.get(prevId)?.tag === "note" ? prevId : applyTo);
          afterCommand(session);
        } catch (err) {
          setNotice(`tie refused: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
      if (hit("merge") && !mod && run.length === 2) {
        // Two selected notes: same pitch still merges; DIFFERENT pitches
        // cycle the first into a grace note — acciaccatura → appoggiatura
        // → none — folding its time into the second (tester ask).
        const [aId, bId] = [run[0]!, run[1]!];
        const a = session.index.byId.get(aId);
        const b = session.index.byId.get(bId);
        if (a?.tag === "note" && b?.tag === "note" && a.staffN === b.staffN && a.layerN === b.layerN) {
          e.preventDefault();
          try {
            const samePitch = (() => {
              const pick = (rid: string) => {
                const m = session.score.measures[session.index.byId.get(rid)!.measureIndex]!;
                const walk = (e2: import("@battuta/core").CoreElement): import("@battuta/core").CoreElement | null => {
                  if (e2.attrs["xml:id"] === rid) return e2;
                  for (const c of e2.children) if (typeof c !== "string") { const r = walk(c); if (r) return r; }
                  return null;
                };
                return walk(m);
              };
              const na = pick(aId);
              const nb = pick(bId);
              return !!na && !!nb && na.attrs["pname"] === nb.attrs["pname"] && na.attrs["oct"] === nb.attrs["oct"];
            })();
            if (samePitch) session.mergeWithNext(aId);
            else session.toggleGrace(aId, bId);
            afterCommand(session);
            setNotice(null);
          } catch (err) {
            setNotice(`grace/merge refused: ${err instanceof Error ? err.message : err}`);
          }
          return;
        }
      }
      if (hit("tuplet") && !mod && run.length >= 1) {
        // shift+t: 3 selected notes -> triplet, 6 -> sextuplet; a selection
        // inside a tuplet unwraps it (freed time <-> rests after).
        e.preventDefault();
        try {
          session.toggleTuplet(selection);
          afterCommand(session);
          setNotice(null);
        } catch (err) {
          setNotice(`tuplet refused: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
      if (hit("pedal") && !mod && run.length >= 2) {
        // Pedal line over the selection: down at the first note, up at the
        // last; the same selection removes it.
        e.preventDefault();
        try {
          session.togglePedal(run[0]!, run[run.length - 1]!);
          afterCommand(session);
          setNotice("pedal toggled");
        } catch (err) {
          setNotice(`pedal refused: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
      if (e.shiftKey && !mod && !e.altKey && !entryMode && bsel) {
        // shift+1..9 toggles that volta number on the block's bracket —
        // mixes like [1, 2][3] build up number by number; removing the
        // last number removes the bracket. Barlines renormalize across
        // the group (rptend before a later bracket, dbl on the last).
        const volta = /^Digit([1-9])$/.exec(e.code)?.[1];
        if (volta) {
          e.preventDefault();
          try {
            session.toggleVolta(bsel.measureFrom, bsel.measureTo, Number(volta));
            afterCommand(session);
            setNotice(`volta ${volta} toggled on m${bsel.measureFrom + 1}–m${bsel.measureTo + 1}`);
          } catch (err) {
            setNotice(`volta refused: ${err instanceof Error ? err.message : err}`);
          }
          return;
        }
      }
      if (hit("repeatBarlines") && !mod && !entryMode && bsel) {
        // "r" on a block selection toggles repeat barlines around it — the
        // bis. In input mode r still enters rests.
        e.preventDefault();
        try {
          session.toggleRepeat(bsel.measureFrom, bsel.measureTo);
          afterCommand(session);
          setNotice(`repeat toggled around m${bsel.measureFrom + 1}–m${bsel.measureTo + 1} (𝄆 𝄇)`);
        } catch (err) {
          setNotice(`repeat refused: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
      if (hit("reflect") && !mod && bsel) {
        // shift+R on a block: the serial forms of the selection — prime →
        // inversion → retrograde → retrograde inversion → prime. Every
        // form derives from the BASE captured at the first press (no
        // compounding); any other edit in between re-bases the cycle.
        e.preventDefault();
        const sig = `${activeId}:${bsel.measureFrom}-${bsel.measureTo}/${bsel.staffFrom}-${bsel.staffTo}`;
        let cyc = reflectCycle.current;
        if (!cyc || cyc.sig !== sig || cyc.version !== session.version) {
          cyc = { sig, base: session.blockPitchEvents(bsel), step: 0, version: session.version };
        }
        if (cyc.base.length === 0) {
          setNotice("reflection refused: no notes in the selection");
          return;
        }
        let targets: PitchEvent[] | null = null;
        let form: ReflectionForm = "prime";
        let skipped = false;
        for (let attempts = 0; attempts < REFLECTION_CYCLE.length && !targets; attempts++) {
          form = REFLECTION_CYCLE[cyc.step % REFLECTION_CYCLE.length]!;
          cyc.step++;
          const per = cyc.base.map((seq) => reflectionForm(seq, form));
          if (per.every((t) => t !== null)) targets = per.flatMap((t) => t!);
          else skipped = true; // retrograde over non-mirroring chord sizes
        }
        if (!targets) {
          setNotice("reflection refused: nothing to transform");
          return;
        }
        try {
          session.setPitches(targets, form);
          afterCommand(session);
          cyc.version = session.version; // our own edit continues the cycle
          reflectCycle.current = cyc;
          setNotice(`reflection: ${REFLECTION_LABELS[form]}${skipped ? " (retrograde skipped: chord sizes don't mirror)" : ""}`);
        } catch (err) {
          setNotice(`reflection refused: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
      if (hit("dynamics") && !mod && run.length >= 2) {
        // With a block of notes selected, "p" cycles a hairpin over it:
        // none -> crescendo -> decrescendo -> none (single-note "p" still
        // cycles p/f dynamics).
        e.preventDefault();
        try {
          session.cycleHairpin(run[0]!, run[run.length - 1]!);
          afterCommand(session);
          setNotice("hairpin: none → < → > → none");
        } catch (err) {
          setNotice(`hairpin refused: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
      if (hit("beam") && !mod) {
        // alt+b: auto-beam the caret's measure (or every measure the
        // selection touches) — beam groups span at most half the measure.
        e.preventDefault();
        const measures = selection.length
          ? [...new Set(selection.map((id) => session.index.byId.get(id)?.measureIndex).filter((m): m is number => m !== undefined))]
          : caret
            ? [caret.measureIndex]
            : [];
        if (!measures.length) {
          setNotice("place the caret or select notes first");
          return;
        }
        try {
          session.autoBeam(measures);
          afterCommand(session);
          setNotice(`auto-beamed ${measures.length > 1 ? `${measures.length} measures` : `m${measures[0]! + 1}`} (groups of half a measure)`);
        } catch (err) {
          setNotice(`beam refused: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
      if (e.altKey && !mod) {
        // alt+1..5 = SET fingering (same number again removes); with shift
        // = ADD one more finger (chords, substitutions). Physical-key match
        // so AZERTY's shifted digit row works identically.
        const fing = /^(?:Digit|Numpad)([1-5])$/.exec(e.code)?.[1];
        if (fing) {
          const target = entryMode && lastEntered.current && session.index.byId.has(lastEntered.current) ? lastEntered.current : caretId;
          if (!target) return;
          e.preventDefault();
          try {
            session.toggleFing(target, fing, e.shiftKey);
            afterCommand(session);
            setNotice(null);
          } catch (err) {
            setNotice(`fingering refused: ${err instanceof Error ? err.message : err}`);
          }
          return;
        }
        // alt+6..0 = CHANGE of finger on the same note ("3-1"): the second
        // half of the digit row maps to the new finger (6→1 … 0→5). Needs a
        // plain fingering to change from; the same key again removes the
        // substitution, a different one replaces it.
        const subKey = /^(?:Digit|Numpad)([6-9]|0)$/.exec(e.code)?.[1];
        if (subKey) {
          const target = entryMode && lastEntered.current && session.index.byId.has(lastEntered.current) ? lastEntered.current : caretId;
          if (!target) return;
          e.preventDefault();
          const finger = subKey === "0" ? "5" : String(Number(subKey) - 5);
          const texts = session.fingAt(target);
          const single = texts.length === 1 ? /^([1-5])(?:-([1-5]))?$/.exec(texts[0]!) : null;
          if (!single) {
            setNotice(`finger change refused: ${texts.length ? `"${texts.join(",")}" is not a single plain fingering` : "set a starting finger first (alt+1..5)"}`);
            return;
          }
          const [, from, to] = single;
          try {
            if (to === finger) session.toggleFing(target, from!, false); // same key: substitution off
            else if (from === finger && !to) setNotice("finger change refused: same finger as the start");
            else session.toggleFing(target, `${from}-${finger}`, false);
            afterCommand(session);
          } catch (err) {
            setNotice(`finger change refused: ${err instanceof Error ? err.message : err}`);
          }
          return;
        }
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
        if (hit("rest")) {
          e.preventDefault();
          enterAtCaret({ kind: "rest" });
          return;
        }
        if ((hit("sharp") || hit("flat") || hit("natural")) && applyTo) {
          e.preventDefault();
          const accid: "s" | "f" | "n" = hit("flat") ? "f" : hit("sharp") ? "s" : "n";
          if (openAccidPicker(applyTo, accid)) return;
          session.toggleAccidental([applyTo], accid);
          afterCommand(session);
          return;
        }
        if ((hit("staccato") || hit("accent")) && applyTo) {
          e.preventDefault();
          session.toggleArtic([applyTo], hit("staccato") ? "stacc" : "acc");
          afterCommand(session);
          return;
        }
        // Dynamics: plain "p" cycles none -> p -> f -> none (layout-proof;
        // alt+f/p kept as a secondary, though browsers may steal alt+F).
        if (hit("dynamics") && applyTo) {
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
      if ((hit("dot") || (e.code === "NumpadDecimal" && !e.altKey)) && !mod) {
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
      if ((hit("merge") || hit("split")) && !mod) {
        const target = entryMode && lastEntered.current && session.index.byId.has(lastEntered.current) ? lastEntered.current : caretId;
        if (!target) return;
        e.preventDefault();
        try {
          if (hit("merge")) session.mergeWithNext(target);
          else session.splitInHalf(target);
          afterCommand(session);
          setNotice(null);
        } catch (err) {
          setNotice(`${hit("merge") ? "merge" : "split"} refused: ${err instanceof Error ? err.message : err}`);
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

      // --- row-level navigation (DOM rows = engraved systems) ---
      /** Slots (staff, voice) of a measure, in traversal order. */
      const slotsOf = (mi: number): { staffN: number; layerN: number }[] => {
        const slots: { staffN: number; layerN: number }[] = [];
        for (const staffN of session.index.stavesPerMeasure.get(mi) ?? []) {
          for (const layerN of session.index.layersPerStaff.get(`${mi}/${staffN}`) ?? []) slots.push({ staffN, layerN });
        }
        return slots;
      };
      /** The caret's slot in the target measure, else the edge slot. */
      const nearSlot = (mi: number, edge: 1 | -1): { staffN: number; layerN: number } | undefined => {
        const slots = slotsOf(mi);
        return slots.find((s) => s.staffN === caret.staffN && s.layerN === caret.layerN) ?? (edge === 1 ? slots[0] : slots[slots.length - 1]);
      };
      const rowOfMeasure = (mi: number): Element | null => mainRef.current?.querySelector(`.tile[data-index="${mi}"]`)?.closest(".score-row") ?? null;
      const rowMeasures = (row: Element): number[] => [...row.querySelectorAll<HTMLElement>(".tile[data-index]")].map((t) => Number(t.dataset["index"]));
      /**
       * Cross to the adjacent engraved row: the measure under the caret's x,
       * nearest event. Slot: "edge" = top slot going down / bottom coming up
       * (the ↓/↑ text-editor continuation); "same" = keep the caret's
       * staff+voice when the target measure has it (PageUp/PageDown).
       */
      const lineJump = (dir: 1 | -1, pick: "edge" | "same"): CaretPosition | null => {
        const main = mainRef.current;
        const caretG = caretId ? main?.querySelector(`g[id="${CSS.escape(caretId)}"]`) : null;
        const anchorEl = caretG ?? main?.querySelector(`.tile[data-index="${caret.measureIndex}"]`);
        const row = rowOfMeasure(caret.measureIndex);
        const rows = main ? [...main.querySelectorAll(".score-row")] : [];
        const r = row ? rows.indexOf(row) : -1;
        const targetRow = r >= 0 ? rows[r + dir] : undefined;
        if (!targetRow || !anchorEl) return null;
        const x = anchorEl.getBoundingClientRect().left;
        let best: { m: number; d: number } | null = null;
        for (const t of targetRow.querySelectorAll<HTMLElement>(".tile[data-index]")) {
          const tr = t.getBoundingClientRect();
          const d = x >= tr.left && x <= tr.right ? 0 : Math.min(Math.abs(x - tr.left), Math.abs(x - tr.right));
          if (!best || d < best.d) best = { m: Number(t.dataset["index"]), d };
        }
        if (!best) return null;
        const slots = slotsOf(best.m);
        const slot = pick === "same" ? nearSlot(best.m, dir) : dir === 1 ? slots[0] : slots[slots.length - 1];
        if (!slot) return null;
        const events = session.index.eventsAt(best.m, slot.staffN, slot.layerN);
        if (!events.length) return null;
        // nearest event to the caret's x within the target measure
        let ei = 0;
        let bd = Infinity;
        events.forEach((id, i) => {
          const g = main?.querySelector(`g[id="${CSS.escape(id)}"]`);
          if (!g) return;
          const d = Math.abs(g.getBoundingClientRect().left - x);
          if (d < bd) {
            bd = d;
            ei = i;
          }
        });
        return { measureIndex: best.m, staffN: slot.staffN, layerN: slot.layerN, eventIndex: ei };
      };
      const moveCaret = (next: CaretPosition) => {
        anchor.current = null;
        setSelection([]);
        lastEntered.current = null; // caret moved
        setCaret(next);
      };
      if ((e.key === "Home" || e.key === "End") && !mod) {
        // Start / end of the current row, like a text editor line.
        e.preventDefault();
        const row = rowOfMeasure(caret.measureIndex);
        const list = row ? rowMeasures(row) : [];
        const mi = e.key === "Home" ? list[0] : list[list.length - 1];
        if (mi === undefined) return;
        const slot = nearSlot(mi, e.key === "Home" ? 1 : -1);
        if (!slot) return;
        const events = session.index.eventsAt(mi, slot.staffN, slot.layerN);
        if (!events.length) return;
        moveCaret({ measureIndex: mi, staffN: slot.staffN, layerN: slot.layerN, eventIndex: e.key === "Home" ? 0 : events.length - 1 });
        return;
      }
      if ((e.key === "PageUp" || e.key === "PageDown") && !mod) {
        // Previous / next row, keeping the caret's staff and voice when the
        // landing measure has them.
        e.preventDefault();
        const next = lineJump(e.key === "PageUp" ? -1 : 1, "same");
        if (next) moveCaret(next);
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
          const dir = e.key === "ArrowUp" ? -1 : 1;
          // Out of (staff, voice) slots in this measure: continue to the
          // adjacent LINE like a text editor — top slot going down, bottom
          // slot coming up, nearest event under the caret's x (lineJump).
          const next = caretVertical(session.index, caret, dir) ?? lineJump(dir, "edge");
          if (next) moveCaret(next);
        }
      } else if (hit("sharp") || hit("flat") || hit("natural")) {
        const ids = editTargets();
        if (!ids.length) return;
        const accid: "s" | "f" | "n" = hit("flat") ? "f" : hit("sharp") ? "s" : "n";
        if (ids.length === 1 && openAccidPicker(ids[0]!, accid)) return;
        session.toggleAccidental(ids, accid);
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
  }, [session, caret, block, editTargets, afterCommand, entryMode, caretId, enterAtCaret, nearestOctave, structural, selection, accidPick, openAccidPicker, harmLane, harmBuffer, saveActive, openScore, zoomStep, keymap, shortcutsOpen, runFromBlock, blockFromSelection, activeId]);

  // --- Web MIDI: note-ons enter at the caret while input mode is active;
  // keys held together build a CHORD (like MuseScore). Devices hot-plug via
  // onstatechange, and the HUD shows what is connected.
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [midiPanel, setMidiPanel] = useState(false);
  const [zoomPanel, setZoomPanel] = useState(false);
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
      (window as unknown as Record<string, unknown>).__MIDI_DEVS__ = (names: string[]) => setMidiDevices(names);
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
    if (!nav.requestMIDIAccess) {
      // WebKitGTK has no Web MIDI: in the Tauri shell the Rust side bridges
      // midir over events — same note/device pipeline from here on.
      const t = (window as unknown as { __TAURI__?: { event?: { listen?: (ev: string, cb: (e: { payload: unknown }) => void) => Promise<() => void> } } }).__TAURI__;
      if (!t?.event?.listen) return;
      const subs = [
        t.event.listen("midi-note", (e) => {
          const [note, on] = e.payload as [number, boolean];
          if (on) midiNoteOnRef.current(note);
          else midiNoteOff(note);
        }),
        t.event.listen("midi-devices", (e) => {
          const names = e.payload as string[];
          // the bridge re-emits every 2s: only re-render on real changes
          setMidiDevices((prev) => (prev.length === names.length && prev.every((n, i) => n === names[i]) ? prev : names));
        }),
      ];
      return () => {
        for (const s of subs) void s.then((un) => un());
      };
    }
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
          setMidiDevices(names);
        };
        attach();
        access.onstatechange = attach; // hot-plug: (re)attach and update HUD
      })
      .catch(() => setMidiDevices([]));
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
      const run = eventRange(session.index, session.score, anchor.current, pos);
      if (run.length) setSelection(run);
      else {
        // Cross-staff/voice shift-click: an ENDPOINT PAIR — enough for the
        // spans that legitimately cross staves (slur, hairpin).
        const a = session.index.eventIdAt(anchor.current);
        const b = session.index.eventIdAt(pos);
        setSelection(a && b && a !== b ? [a, b] : []);
      }
    } else {
      anchor.current = pos;
      setSelection([]);
    }
    lastEntered.current = null; // caret moved: post-entry modifiers follow it
    setAccidPick(null);
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
      // The caret landed in a virtualized (unrendered) tile: scroll to its
      // placeholder so the observer renders it — the caret follows on the
      // next layout tick. (lastScrolledCaret stays unset: the g branch
      // finishes the follow once the element exists.)
      if (caret && caretId !== lastScrolledCaret.current) {
        main.querySelector(`.tile[data-index="${caret.measureIndex}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      return;
    }
    const gr = (g as SVGGElement).getBoundingClientRect();
    const mr = main.getBoundingClientRect();
    setCaretRect({ left: gr.left - mr.left - 4, top: gr.top - mr.top - 6, height: gr.height + 12 });
    // Follow the caret when IT moved (keyboard nav, entry advancing past
    // the fold) — never on re-layout/zoom ticks, which would yank the
    // view. Margins clear the sticky header and the status bar.
    if (caretId !== lastScrolledCaret.current) {
      lastScrolledCaret.current = caretId;
      if (gr.top < 70 || gr.bottom > window.innerHeight - 45) {
        g.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caret is caretId's source
  }, [caretId, version, layoutTick, view, zoom]);

  const onRendered = useCallback((r: TileResult) => {
    setStats((s) => ({
      rendered: s.rendered + 1,
      freshMs: s.freshMs + (r.cached ? 0 : r.renderMs),
      fresh: s.fresh + (r.cached ? 0 : 1),
    }));
    setLayoutTick((t) => t + 1);
  }, []);

  const onLayout = useCallback(() => setLayoutTick((t) => t + 1), []);

  const onSettled = useCallback(() => {
    setLayoutTick((t) => t + 1);
    if (pendingEdit.current && session) {
      pendingEdit.current = false;
      setEditLatency(performance.now() - session.lastEditStart);
    }
  }, [session]);

  // Current context at the caret (score opening when there is no caret) —
  // the status-bar selects display it and apply changes at the caret.
  const shownCtx = session ? (caret ? session.contexts[caret.measureIndex]?.get(caret.staffN) : undefined) ?? session.contexts[0]?.values().next().value : undefined;
  const shownClef = shownCtx?.clef ? `${shownCtx.clef.shape}${shownCtx.clef.line}${shownCtx.clef.dis === 8 && shownCtx.clef.disPlace === "below" ? "v" : ""}` : "";
  const shownKeysig = shownCtx?.keysig ?? "";
  const shownMeter = shownCtx?.meter?.count ? `${shownCtx.meter.count}/${shownCtx.meter.unit}` : shownCtx?.meter?.sym ?? "";

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
        "";




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
    <div className={showPerf ? undefined : "no-perf"} style={{ fontFamily: "system-ui, sans-serif", padding: 12, paddingBottom: 36 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 6, position: "sticky", top: 0, zIndex: 35, background: "#fff", margin: "-12px -12px 4px", padding: "12px 12px 6px", borderBottom: "1px solid #e3e7ec" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ position: "relative" }}>
          <button data-menu-toggle onClick={() => setMenuOpen((o) => !o)} style={{ fontWeight: 700, fontSize: 14, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
            battuta ▾
          </button>
          {menuOpen && (
            <>
              {/* Transparent backdrop: any click outside closes the menu. */}
              <div data-menu-backdrop onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 38 }} />
              <div data-app-menu style={{ position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 40, background: "#fff", border: "1px solid #d6dde5", borderRadius: 6, boxShadow: "0 6px 24px rgba(0,0,0,.15)", padding: 4, display: "flex", flexDirection: "column", minWidth: 210 }}>
                {/* Routes through openScore: the NATIVE dialog in the shell
                    (with the remembered folder); browsers get the hidden
                    file input via openScore's fallback. */}
                <button
                  style={MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    openScore();
                  }}
                >
                  open file…
                </button>
                <button
                  style={MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    saveDoc();
                  }}
                >
                  save
                </button>
                <button
                  data-export="playback-midi"
                  title="the player's interpretation: repeats, voltas and D.S./D.C. expanded, ties merged, staccato/legato gates applied"
                  style={MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    exportPlaybackMidi();
                  }}
                >
                  export playback MIDI (.mid)
                </button>
                {/* Verovio-backed exports; imports ride "open file…" (any
                    supported extension converts on open). */}
                {EXPORT_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    data-export={f.id}
                    style={MENU_ITEM}
                    onClick={() => {
                      setMenuOpen(false);
                      exportAs(f.id);
                    }}
                  >
                    export {f.label} (.{f.ext})
                  </button>
                ))}
                <button
                  data-shortcuts-toggle
                  style={MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    setShortcutsOpen(true);
                  }}
                >
                  🌣 shortcuts — view and rebind
                </button>
                <button
                  data-perf-toggle
                  title="show/hide performance numbers"
                  style={MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    setShowPerf((p) => !p);
                  }}
                >
                  ⏱ performance numbers {showPerf ? "✓" : ""}
                </button>
                <button
                  data-regen-ids
                  title="regenerate all xml:ids — repairs documents that accumulated duplicated ids"
                  style={MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    if (!session) return;
                    const n = session.regenerateIds();
                    setCaret(null);
                    setSelection([]);
                    setBlock(null);
                    anchor.current = null;
                    lastEntered.current = null;
                    afterCommand(session);
                    setNotice(`${n} ids regenerated (references follow; ctrl+z restores)`);
                  }}
                >
                  ⟲ regenerate ids
                </button>
              </div>
            </>
          )}
        </span>
        <span className="tabs">
          {docs.map((d) => (
            <button key={d.id} className={d.id === activeId ? "tab active" : "tab"} onClick={() => switchDoc(d.id)}>
              {d.name}
              {d.session.editMark !== (savedMarks.current.get(d.id) ?? null) ? " *" : ""}
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
          <button className="tab tab-new" title="new score" onClick={newDoc}>
            +
          </button>
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept={OPEN_EXTENSIONS.map((e) => `.${e}`).join(",")}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ""; // allow re-opening the same file
            if (!f) return;
            if (detectImport(f.name) === "mxl") {
              f.arrayBuffer()
                .then((b) => importBinary(f.name, b))
                .catch((err) => setError(String(err)));
            } else {
              f.text()
                .then((text) => importText(f.name, text))
                .catch((err) => setError(String(err)));
            }
          }}
        />
        <button onClick={() => setView(view === "tiles" ? "pages" : "tiles")}>{view === "tiles" ? "page view" : "edit view"}</button>
        <button title="on-screen keyboard — piano + every shortcut, for touch devices" data-vkeys-toggle onClick={() => toggleVk(!vkOpen)} style={{ opacity: vkOpen ? 1 : 0.45 }}>
          🎹
        </button>
        <span style={{ color: "#666", fontSize: 13 }} data-status>
          {showPerf ? status : ""}
        </span>
      </div>
      {/* Second header row: the score's own metadata (title, tempo) and,
          in page view, the player — playback speed sits next to the score
          tempo it multiplies. */}
      <div data-doc-header style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        {titleOpen === null ? (
          <button
            data-title-button
            title="edit the score title (meiHead — page view prints it)"
            onClick={() => session && setTitleOpen(session.title())}
          >
            {(() => {
              const t = session?.title() ?? "";
              return t ? (t.length > 24 ? `${t.slice(0, 22)}…` : t) : "title";
            })()}
          </button>
        ) : (
          <input
            data-title-input
            autoFocus
            value={titleOpen}
            placeholder="score title"
            style={{ fontSize: 13, width: 180 }}
            onChange={(e) => setTitleOpen(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && session) {
                session.setTitle(titleOpen.trim());
                afterCommand(session);
                setTitleOpen(null);
                setNotice(titleOpen.trim() ? `title: ${titleOpen.trim()}` : "title removed");
              } else if (e.key === "Escape") setTitleOpen(null);
            }}
            onBlur={() => setTitleOpen(null)}
          />
        )}
        {tempoOpen === null ? (
          <button
            data-tempo-button
            title="edit the score tempo (page view prints ♩ = bpm; playback follows it)"
            onClick={() => session && setTempoOpen(String(session.tempo() ?? ""))}
          >
            {(() => {
              const t = session?.tempo();
              return t ? `♩=${t}` : "tempo";
            })()}
          </button>
        ) : (
          <input
            data-tempo-input
            autoFocus
            value={tempoOpen}
            placeholder="bpm (e.g. 120)"
            inputMode="numeric"
            style={{ fontSize: 13, width: 90 }}
            onChange={(e) => setTempoOpen(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && session) {
                const raw = tempoOpen.trim();
                if (raw === "") {
                  session.setTempo(null);
                  afterCommand(session);
                  setTempoOpen(null);
                  setNotice("tempo removed (plays at the 120 bpm default)");
                  return;
                }
                const bpm = Number(raw);
                if (!Number.isFinite(bpm) || bpm < 10 || bpm > 400) {
                  setNotice("tempo must be a number between 10 and 400 bpm");
                  return;
                }
                session.setTempo(bpm);
                afterCommand(session);
                setTempoOpen(null);
                setNotice(`tempo: ♩=${bpm}`);
              } else if (e.key === "Escape") setTempoOpen(null);
            }}
            onBlur={() => setTempoOpen(null)}
          />
        )}
        {view === "pages" && (
          <>
            <button data-player-toggle title={playerState === "playing" ? "pause" : "play (repeats, voltas and one D.S./D.C. jump follow the form)"} onClick={onPlayPause} disabled={playerState === "loading"}>
              {playerState === "playing" ? "⏸" : playerState === "loading" ? "…" : "▶"}
            </button>
            <button data-player-stop title="stop" onClick={() => scorePlayer.stop()} disabled={playerState === "idle"}>
              ⏹
            </button>
            <select
              data-player-tempo
              title="playback speed (× the score tempo)"
              value={playerTempo}
              onChange={(e) => {
                const f = Number(e.target.value);
                e.target.blur();
                setPlayerTempo(f);
                saveSettings({ tempo: f });
                scorePlayer.setTempo(f);
              }}
              style={{ fontSize: 12 }}
            >
              {TEMPO_STEPS.map((f) => (
                <option key={f} value={f}>
                  {f}×
                </option>
              ))}
            </select>
            {playerState !== "idle" && playerState !== "loading" && (
              <>
                <span
                  data-player-progress
                  title="seek"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    scorePlayer.seek((e.clientX - r.left) / r.width);
                  }}
                  style={{ width: 140, height: 8, background: "#dde3ea", borderRadius: 4, display: "inline-block", cursor: "pointer", position: "relative", alignSelf: "center", overflow: "hidden" }}
                >
                  <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${playerTotal ? Math.min(100, (playerPos / playerTotal) * 100) : 0}%`, background: "#4a7dbd", pointerEvents: "none" }} />
                </span>
                <span data-player-time style={{ fontSize: 12, color: "#567", fontVariantNumeric: "tabular-nums" }}>
                  {fmtTime(playerPos)} / {fmtTime(playerTotal)}
                </span>
              </>
            )}
          </>
        )}
      </div>
      </header>
      {/* Toasts, bottom-right above the status bar. The notice element stays
          in the DOM (hidden when empty) — the e2e suites read [data-notice].
          The × dismisses before the timeout; the text itself stays
          selectable (error messages get copied around). */}
      <div style={{ position: "fixed", right: 12, bottom: 34, zIndex: 55, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", maxWidth: "46vw" }}>
        {error && (
          <div data-error style={{ display: "flex", alignItems: "baseline", gap: 8, background: "#5b1f24", color: "#fdd", border: "1px solid #a33", borderRadius: 6, padding: "6px 10px", fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,.35)", userSelect: "text" }}>
            <button data-error-dismiss title="dismiss" onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#faa", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}>
              ×
            </button>
            <span>{error}</span>
          </div>
        )}
        <div
          data-notice-toast
          style={{
            display: notice ? "flex" : "none",
            alignItems: "baseline",
            gap: 8,
            background: "#1f2733",
            border: "1px solid #3a4656",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            boxShadow: "0 4px 16px rgba(0,0,0,.35)",
            userSelect: "text",
          }}
        >
          <button data-notice-dismiss title="dismiss" onClick={() => setNotice(null)} style={{ background: "none", border: "none", color: "#89a", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}>
            ×
          </button>
          <span data-notice style={{ color: notice?.includes("refused") || notice?.includes("failed") ? "#f99" : "#9d9" }}>{notice ?? ""}</span>
        </div>
      </div>
      {shortcutsOpen && (
        <ShortcutEditor
          keymap={keymap}
          layout={layout}
          onLayout={(l) => {
            setLayout(l);
            setNotice(`keyboard layout: ${l} (own defaults and overrides)`);
          }}
          onRebind={(id, b) => {
            saveKeymapOverride(layout, id, b);
            setKeymap(loadKeymap(layout));
            setNotice(`"${keymap[id]?.label ?? id}" rebound to ${b.keys.join(" ")}`);
          }}
          onReset={() => {
            clearKeymapOverrides(layout);
            setKeymap(loadKeymap(layout));
            setNotice(`shortcuts reset to ${layout} defaults`);
          }}
          onClose={() => setShortcutsOpen(false)}
        />
      )}
      {accidPick && (
        <div data-accid-pick style={{ position: "fixed", left: accidPick.x, top: accidPick.y, background: "#233", color: "#fff", padding: "4px 8px", borderRadius: 4, fontSize: 12, zIndex: 40, pointerEvents: "none", boxShadow: "0 2px 8px rgba(0,0,0,.35)" }}>
          {accidPick.accid === "s" ? "♯" : accidPick.accid === "f" ? "♭" : accidPick.accid === "x" ? "𝄪" : "♮"} on{" "}
          {accidPick.notes.map((n, k) => `${k + 1}:${n.pname}${n.accid === "s" ? "♯" : n.accid === "f" ? "♭" : n.accid === "n" ? "♮" : ""}${n.oct}`).join("  ")}
          {"  ·  a–g / 1–9 pick, esc"}
        </div>
      )}
      <style>{`
        /* Block-selection drags must never paint the native text-selection
           overlay — WebKitGTK needs the prefixed form AND it applied to the
           SVG content itself, not just the container. */
        main, main * { -webkit-user-select: none; user-select: none; }
        .score-row { display: flex; align-items: flex-start; margin: 10px 0; }
        .tile, .rowhdr { position: relative; flex: none; }
        .tile svg, .rowhdr svg { width: 100%; height: 100%; display: block; }
        .tile g.mNum { display: none; } /* every tile is a "system start"; our .ms label already numbers it */
        .tile .ms { position: absolute; top: -4px; right: 2px; font-size: 10px; color: #bbb; z-index: 1; }
        .no-perf .tile .ms { display: none; }
        [data-statusbar] { color-scheme: dark; }
        [data-statusbar] select option { background: #1f2733; color: #cdd; }
        .sbsel { background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%23718096'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 4px center; }
        .tile .placeholder { background: #f6f6f6; border-radius: 4px;
          color: #bbb; font-size: 11px; display: flex; align-items: center; justify-content: center; }
        .pages .page { max-width: 900px; margin: 0 auto 16px; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
        .pages .page svg { width: 100%; height: auto; display: block; }
        .pages g.playing * { fill: #c40; stroke: #c40; }
        g[id]:hover { cursor: pointer; }
        /* Voice colors (zero specificity via :where — caret/selection win):
           voice 1 turns blue only where a second voice exists. */
        :where(g.staff:has(g.layer[data-n="2"]) g.layer[data-n="1"]) * { fill: #1f6feb; stroke: #1f6feb; }
        :where(g.layer[data-n="2"]) * { fill: #8250df; stroke: #8250df; }
        :where(g.layer[data-n="3"]) * { fill: #bf8700; stroke: #bf8700; }
        :where(g.layer[data-n="4"]) * { fill: #bf3989; stroke: #bf3989; }
        .caret { position: absolute; width: 2px; background: #06c; pointer-events: none; animation: blink 1.1s step-end infinite; }
        @keyframes blink { 50% { opacity: 0.15; } }
        .tabs .tab { border: 1px solid #ccc; background: #f6f6f6; padding: 2px 8px; cursor: pointer; }
        .tabs .tab.active { background: #fff; border-bottom-color: #fff; font-weight: 600; }
        .tabs .tab-close { margin-left: 7px; color: #999; padding: 0 2px; }
        .tabs .tab-close:hover { color: #c22; }
        .tabs .tab-new { font-weight: 700; color: #494; }
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
        {session && pool && view === "tiles" && <TileGrid key={activeId ?? -1} session={session} version={version} pool={pool} zoom={zoom} onRendered={onRendered} onSettled={onSettled} onLayout={onLayout} />}
        {session && pool && view === "pages" && <PageView key={`${activeId}-${version}`} session={session} pool={pool} />}
        {caretRect && view === "tiles" && <div className="caret" style={caretRect} />}
        {harmLane && caretRect && view === "tiles" && (
          <div data-harm-input data-valid={harmBuffer === "" || isHarmText(harmLane, harmBuffer) ? "1" : "0"} style={{ position: "absolute", left: caretRect.left, top: harmLane === "rna" ? caretRect.top + caretRect.height + 6 : caretRect.top - 30, background: "#233", borderRadius: 4, fontSize: 13, zIndex: 40, padding: "2px 8px", whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,.35)", color: harmBuffer === "" || isHarmText(harmLane, harmBuffer) ? "#8f8" : "#f88" }}>
            {harmLane === "rna" ? "RN " : "♩ "}
            <strong>{harmBuffer || "…"}</strong>
            <span style={{ color: "#89a", marginLeft: 8 }}>{harmSuggestions(harmLane, harmBuffer).join("  ")}</span>
          </div>
        )}
      </main>
      {vkOpen && <VirtualKeyboard keymap={keymap} layout={layout} entryMode={entryMode} onNoteOn={midiNoteOn} onNoteOff={midiNoteOff} onClose={() => toggleVk(false)} />}
      <footer data-statusbar style={{ position: "fixed", left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", gap: 12, background: "#1f2733", color: "#aab", fontSize: 12, lineHeight: "20px", padding: "2px 10px", zIndex: 30 }}>
        <button
          data-input-indicator
          title="note input mode (i)"
          onClick={() => { setEntryMode((m) => !m); setNotice(null); }}
          style={{ border: "none", cursor: "pointer", borderRadius: 3, padding: "1px 8px", fontSize: 12, fontFamily: "inherit", background: entryMode ? "#2d7d46" : "transparent", color: entryMode ? "#fff" : "#aab" }}
        >
          {entryMode ? durIndicator(entryDur, entryDots) : "INPUT (i)"}
        </button>
        <span data-caret-indicator style={{ color: caret ? "#cdd" : "#566", fontVariantNumeric: "tabular-nums" }} title="caret: measure, staff, voice, note">
          {caret ? `[ m ${caret.measureIndex + 1}, s ${caret.staffN}, v ${caret.layerN}, n ${caret.eventIndex + 1} ]` : "[ — ]"}
        </span>
        <span style={{ flex: 1 }} />
        {/* Current context at the caret; picking a value applies the change
            there. Blur on change: a focused select swallows the keyboard. */}
        <select
          value=""
          title="staves (add below / remove the caret's)"
          className="sbsel" style={STATUSBAR_SELECT}
          disabled={!session}
          onChange={(e) => {
            const op = e.target.value;
            e.target.blur();
            if (!session || !op) return;
            try {
              if (op === "add") {
                const n = session.addStaff();
                afterCommand(session);
                // land the caret at the start of the fresh staff, ready
                // to enter notes (its first event is the m1 whole rest)
                anchor.current = null;
                setSelection([]);
                setBlock(null);
                lastEntered.current = null;
                setCaret({ measureIndex: 0, staffN: n, layerN: 1, eventIndex: 0 });
                setNotice(`staff ${n} added below — caret at its start`);
              } else {
                if (!caret) {
                  setNotice("place the caret on the staff to remove");
                  return;
                }
                const n = caret.staffN;
                session.removeStaff(n);
                setCaret(null);
                setSelection([]);
                setBlock(null);
                anchor.current = null;
                lastEntered.current = null;
                afterCommand(session);
                setNotice(`staff ${n} removed (ctrl+z restores it)`);
              }
            } catch (err) {
              setNotice(`staves: ${err instanceof Error ? err.message : err}`);
            }
          }}
        >
          <option value="">{session ? `staves (${session.staffCount})` : "staves"}</option>
          <option value="add">add staff below</option>
          <option value="remove">remove caret staff</option>
        </select>
        <select
          value=""
          title="voices (caret staff: switch, add, remove)"
          className="sbsel" style={STATUSBAR_SELECT}
          disabled={!session || !caret}
          onChange={(e) => {
            const op = e.target.value;
            e.target.blur();
            if (!session || !caret || !op) return;
            try {
              if (op === "add") {
                const n = session.addVoice(caret.staffN, caret.measureIndex);
                afterCommand(session);
                const next = { measureIndex: caret.measureIndex, staffN: caret.staffN, layerN: n, eventIndex: 0 };
                caretRef.current = next;
                setCaret(next);
                setNotice(`voice ${n} added to staff ${caret.staffN} from m${caret.measureIndex + 1} — caret is in it`);
              } else if (op === "remove") {
                const gone = caret.layerN;
                session.removeVoice(caret.staffN, gone, caret.measureIndex);
                afterCommand(session);
                const layers = session.index.layersPerStaff.get(`${caret.measureIndex}/${caret.staffN}`) ?? [];
                const next = layers.length ? { measureIndex: caret.measureIndex, staffN: caret.staffN, layerN: layers[0]!, eventIndex: 0 } : null;
                caretRef.current = next;
                setCaret(next);
                setSelection([]);
                lastEntered.current = null;
                setNotice(`voice ${gone} removed from staff ${caret.staffN} from m${caret.measureIndex + 1} (ctrl+z restores it)`);
              } else if (op.startsWith("go:")) {
                const layerN = Number(op.slice(3));
                const events = session.index.eventsAt(caret.measureIndex, caret.staffN, layerN);
                if (!events.length) return;
                const next = { measureIndex: caret.measureIndex, staffN: caret.staffN, layerN, eventIndex: Math.min(caret.eventIndex, events.length - 1) };
                caretRef.current = next;
                lastEntered.current = null;
                setCaret(next);
              }
            } catch (err) {
              setNotice(`voices: ${err instanceof Error ? err.message : err}`);
            }
          }}
        >
          <option value="">{caret ? `voice ${caret.layerN}` : "voice"}</option>
          {(session && caret ? session.index.layersPerStaff.get(`${caret.measureIndex}/${caret.staffN}`) ?? [] : []).map((l) => (
            <option key={l} value={`go:${l}`}>
              {l === caret?.layerN ? `voice ${l} ✓` : `switch to voice ${l}`}
            </option>
          ))}
          <option value="add">{caret && caret.measureIndex > 0 ? `add a voice (from m${caret.measureIndex + 1})` : "add a voice"}</option>
          <option value="remove">{caret && caret.measureIndex > 0 ? `remove this voice (from m${caret.measureIndex + 1})` : "remove this voice"}</option>
        </select>
        <select
          value=""
          title="harmony lanes (chord symbols above, roman numerals below)"
          className="sbsel" style={STATUSBAR_SELECT}
          disabled={!session || !caret}
          onChange={(e) => {
            const kind = e.target.value as HarmKind | "";
            e.target.blur();
            if (!kind) return;
            setEntryMode(false);
            setHarmLane(kind);
            setNotice(`${kind === "rna" ? "roman numerals" : "chord symbols"}: type at the caret · enter commits + advances · tab completes · esc leaves`);
          }}
        >
          <option value="">{harmLane ? (harmLane === "rna" ? "♩ numerals" : "♩ chords") : "harmony"}</option>
          <option value="chord">chord symbols (above)</option>
          <option value="rna">roman numerals (below)</option>
        </select>
        <select value={shownClef} title="clef at caret (staff-local)" className="sbsel" style={STATUSBAR_SELECT} disabled={!session} onChange={(e) => { e.target.blur(); applyContext("clef", e.target.value); }}>
          {shownClef && !CLEFS[shownClef] && <option value={shownClef}>{shownClef}</option>}
          {!shownClef && <option value="">clef</option>}
          {Object.keys(CLEFS).map((k) => (
            <option key={k} value={k}>
              {CLEF_LABELS[k]}
            </option>
          ))}
        </select>
        <select value={shownKeysig} title="key signature at caret (score-wide)" className="sbsel" style={STATUSBAR_SELECT} disabled={!session} onChange={(e) => { e.target.blur(); applyContext("key", e.target.value); }}>
          {!shownKeysig && <option value="">key</option>}
          {["7f", "6f", "5f", "4f", "3f", "2f", "1f", "0", "1s", "2s", "3s", "4s", "5s", "6s", "7s"].map((k) => (
            <option key={k} value={k}>
              {k === "0" ? "♮ (0)" : k.endsWith("s") ? `${k[0]}♯` : `${k[0]}♭`}
            </option>
          ))}
        </select>
        <select value={shownMeter} title="meter at caret (score-wide; refuses if content no longer fits)" className="sbsel" style={STATUSBAR_SELECT} disabled={!session} onChange={(e) => { e.target.blur(); applyContext("meter", e.target.value); }}>
          {shownMeter && !["4/4", "3/4", "2/4", "2/2", "3/2", "6/8", "9/8", "12/8", "5/4", "7/8", "5/8", "3/8"].includes(shownMeter) && <option value={shownMeter}>{shownMeter}</option>}
          {!shownMeter && <option value="">meter</option>}
          {["4/4", "3/4", "2/4", "2/2", "3/2", "6/8", "9/8", "12/8", "5/4", "7/8", "5/8", "3/8"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <span style={{ position: "relative" }}>
          {zoomPanel && (
            <div data-zoom-panel style={{ position: "absolute", right: 0, bottom: 26, background: "#233040", color: "#dde", padding: "6px 8px", borderRadius: 4, whiteSpace: "nowrap", boxShadow: "0 2px 10px rgba(0,0,0,.4)", display: "flex", gap: 6, alignItems: "center" }}>
              <button data-zoom-out title="zoom out (ctrl −)" onClick={() => zoomStep(-1)} style={{ fontSize: 13, padding: "0 8px" }}>
                −
              </button>
              <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 38, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
              <button data-zoom-in title="zoom in (ctrl +)" onClick={() => zoomStep(1)} style={{ fontSize: 13, padding: "0 8px" }}>
                +
              </button>
              <button data-zoom-reset title="reset zoom (ctrl 0)" onClick={() => setZoom(DEFAULT_ZOOM)} style={{ fontSize: 12, padding: "0 8px" }}>
                reset
              </button>
            </div>
          )}
          <button
            data-zoom-toggle
            data-zoom={zoom}
            title={`zoom ${Math.round(zoom * 100)}% (ctrl +/− · ctrl 0 resets)`}
            onClick={() => setZoomPanel((o) => !o)}
            style={{ border: "none", cursor: "pointer", borderRadius: 3, padding: "1px 8px", fontSize: 12, fontFamily: "inherit", background: "transparent", color: "#aab" }}
          >
            zoom
          </button>
        </span>
        <span style={{ position: "relative" }}>
          {midiPanel && (
            <div data-midi-list style={{ position: "absolute", right: 0, bottom: 26, background: "#233040", color: "#dde", padding: "6px 10px", borderRadius: 4, whiteSpace: "nowrap", boxShadow: "0 2px 10px rgba(0,0,0,.4)" }}>
              {midiDevices.length ? midiDevices.map((n, i) => <div key={`${n}${i}`}>🎹 {n}</div>) : <div>no MIDI devices connected</div>}
            </div>
          )}
          <button
            data-midi-indicator
            title={midiDevices.length ? midiDevices.join(", ") : "no MIDI device connected"}
            onClick={() => setMidiPanel((o) => !o)}
            style={{ border: "none", cursor: "pointer", borderRadius: 3, padding: "1px 8px", fontSize: 12, fontFamily: "inherit", background: "transparent", color: midiDevices.length ? "#6fbf73" : "#778" }}
          >
            MIDI {midiDevices.length ? `<>${midiDevices.length > 1 ? ` ${midiDevices.length}` : ""}` : "><"}
          </button>
        </span>
      </footer>
    </div>
  );
}
