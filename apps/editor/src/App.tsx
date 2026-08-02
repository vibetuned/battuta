import { useEffect, useRef, useState } from "react";
import { fromDom, buildScore, resolveContexts, synthesizeTile, contextHash } from "@battuta/core";
import type { CoreScore, MeasureContext, DomLikeElement } from "@battuta/core";
import { RenderPool, type TileResult } from "./render/renderPool";

const FIXTURES = [
  "synthetic-context-changes.mei",
  "Bach-JS_Ein_feste_Burg.mei",
  "Beethoven_Hymn_to_joy.mei",
  "Bach-JS_BrandenburgConcert_No2_I_BWV1047.mei",
  "Beethoven_StringQuartet_Op18_No1.mei",
];

interface LoadedScore {
  score: CoreScore;
  contexts: MeasureContext[];
  xml: string;
  contextChanges: number;
}

function loadScore(xml: string): LoadedScore {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("MEI parse error: " + err.textContent);
  const score = buildScore(fromDom(doc.documentElement as unknown as DomLikeElement));
  const contexts = resolveContexts(score);
  let contextChanges = 0;
  for (let i = 1; i < contexts.length; i++) {
    if (contextHash(contexts[i]!) !== contextHash(contexts[i - 1]!)) contextChanges++;
  }
  return { score, contexts, xml, contextChanges };
}

interface TileState {
  svg: string;
  ms: number;
  cached: boolean;
}

/**
 * Virtualized tile grid: every measure gets a placeholder div immediately;
 * ONE shared IntersectionObserver requests renders as tiles approach the
 * viewport. Tile state lives here and is monotonic — a rendered tile never
 * regresses to a placeholder. Mount with key={fixture} so a document switch
 * remounts fresh and late resolves from the old document are dropped by React.
 */
function TileGrid({ loaded, pool, onRendered }: { loaded: LoadedScore; pool: RenderPool; onRendered: (r: TileResult) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tiles, setTiles] = useState<ReadonlyMap<number, TileState>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const requested = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          const index = Number((entry.target as HTMLElement).dataset["index"]);
          if (requested.has(index)) continue;
          requested.add(index);
          const slice = synthesizeTile(loaded.score, loaded.contexts, index);
          pool.render(slice.key, slice.xml).then((r) => {
            setTiles((prev) => new Map(prev).set(index, { svg: r.svg, ms: r.renderMs, cached: r.cached }));
            onRendered(r);
          });
        }
      },
      { rootMargin: "600px" },
    );
    for (const el of container.querySelectorAll("[data-index]")) io.observe(el);
    return () => io.disconnect();
    // onRendered is a stable stats sink.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, pool]);

  return (
    <div ref={containerRef}>
      {loaded.score.measures.map((_, index) => {
        const tile = tiles.get(index);
        return (
          <div className="tile" data-index={index} key={index}>
            {tile ? (
              <>
                <span className="ms">
                  m{index + 1}
                  {tile.cached ? " · cache" : ` · ${tile.ms.toFixed(1)} ms`}
                </span>
                <div dangerouslySetInnerHTML={{ __html: tile.svg }} />
              </>
            ) : (
              <div className="placeholder">m{index + 1}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Full Verovio paged layout for proofreading; pages stream in as rendered. */
function PageView({ loaded, pool }: { loaded: LoadedScore; pool: RenderPool }) {
  const [pages, setPages] = useState<ReadonlyMap<number, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setPages(new Map());
    pool.renderDocumentPages(loaded.xml, (index, svg) => {
      if (!cancelled) setPages((prev) => new Map(prev).set(index, svg));
    });
    return () => {
      cancelled = true;
    };
  }, [loaded, pool]);

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

export default function App() {
  const [pool, setPool] = useState<RenderPool | null>(null);
  const [fixture, setFixture] = useState(FIXTURES[0]!);
  const [view, setView] = useState<"tiles" | "pages">("tiles");
  const [loaded, setLoaded] = useState<LoadedScore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stats, setStats] = useState({ rendered: 0, freshMs: 0, fresh: 0 });

  useEffect(() => {
    const p = new RenderPool();
    setPool(p);
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__POOL__ = p;
    return () => p.dispose();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    setStats({ rendered: 0, freshMs: 0, fresh: 0 });
    setSelectedId(null);
    fetch("/" + fixture)
      .then((r) => r.text())
      .then((xml) => {
        if (!cancelled) setLoaded(loadScore(xml));
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [fixture]);

  const onRendered = (r: TileResult) =>
    setStats((s) => ({
      rendered: s.rendered + 1,
      freshMs: s.freshMs + (r.cached ? 0 : r.renderMs),
      fresh: s.fresh + (r.cached ? 0 : 1),
    }));

  const onClick = (e: React.MouseEvent) => {
    const g = (e.target as globalThis.Element).closest("g[id]");
    setSelectedId(g ? g.id : null);
  };

  const status = error
    ? `error: ${error}`
    : !loaded || !pool
      ? "loading…"
      : `${loaded.score.measures.length} measures · ${loaded.contextChanges} context changes · ` +
        `${stats.rendered} tiles shown (${stats.fresh} fresh, avg ${stats.fresh ? (stats.freshMs / stats.fresh).toFixed(1) : "–"} ms) · ` +
        `pool ${pool.size} workers`;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 12 }}>
      <header style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: 8, flexWrap: "wrap" }}>
        <strong>battuta</strong>
        <select value={fixture} onChange={(e) => setFixture(e.target.value)}>
          {FIXTURES.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <button onClick={() => setView(view === "tiles" ? "pages" : "tiles")}>{view === "tiles" ? "page view" : "edit view"}</button>
        <span style={{ color: "#666", fontSize: 13 }}>{status}</span>
        <span style={{ color: "#06c", fontSize: 13 }}>{selectedId ? `selected: ${selectedId}` : ""}</span>
      </header>
      <style>{`
        .tile { display: inline-block; vertical-align: top; margin: 2px; position: relative; }
        .tile svg { height: 170px; width: auto; }
        .tile .ms { position: absolute; top: 0; right: 2px; font-size: 10px; color: #999; }
        .tile .placeholder { width: 180px; height: 170px; background: #f4f4f4; border-radius: 4px;
          color: #bbb; font-size: 11px; display: flex; align-items: center; justify-content: center; }
        .pages .page { max-width: 900px; margin: 0 auto 16px; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
        .pages .page svg { width: 100%; height: auto; display: block; }
        g[id]:hover { cursor: pointer; }
        ${selectedId ? `g[id="${CSS.escape(selectedId)}"] * { fill: #d22; stroke: #d22; }` : ""}
      `}</style>
      <main onClick={onClick}>
        {loaded && pool && view === "tiles" && <TileGrid key={fixture} loaded={loaded} pool={pool} onRendered={onRendered} />}
        {loaded && pool && view === "pages" && <PageView key={fixture} loaded={loaded} pool={pool} />}
      </main>
    </div>
  );
}
