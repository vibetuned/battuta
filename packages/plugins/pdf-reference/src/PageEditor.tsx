/**
 * Drawing systems and measures on a page (see `drawing.ts`). The whole page,
 * in a box that scrolls, ZOOMED from a quarter of the panel's width — a whole
 * page at a glance, which a wide, short panel needs (2026-10-29, the user:
 * "we don't have negative zoom … needed specially in landscape") — up to
 * four times, a system at a size a hand can aim at; the spot in the middle
 * stays in the middle. Three tools: SYSTEMS (drag a box across one; drag a
 * corner of one to resize it), BARLINES (click in a system to add one, click
 * one to remove it) and STAVES (click at a staff boundary to split the
 * system there, click a split to remove it). Each system has a × to remove
 * it; measures are numbered in the order the score's measures are matched
 * to them, staves 1, 2… down the system's left.
 *
 * Coordinates: the pointer, through the SVG's own box, into the rendered
 * page's pixels — the drawing's units. Everything it does goes through the
 * callbacks; the drawing itself is the plugin's state. The × and the corner
 * handles are HTML laid over the page: placed in percent of it, sized in
 * screen pixels, so a finger hits them at every zoom (drawn in the page's
 * own units, the × shrank with it — about 2 px at a quarter).
 *
 * Touch: one finger draws, TWO MOVE THE PAGE (phase 10, 2026-10-29 — the
 * user: on a tablet every drag drew, so the zoomed page could not be moved
 * around). The SVG takes every touch (`touch-action: none`, or a finger
 * could not draw a box), so the pan is the editor's own: the two fingers'
 * midpoint drags the box's scroll — set from where the pan began, never
 * stepped by each move's delta, which the browser rounds (a 120 px drag
 * moved 128) — and a gesture that ever had two fingers draws nothing — not
 * the box its first finger began, not the resize its finger began on a
 * handle, not the barline or split its lifting finger would toggle, not the
 * × it lifts over. A mouse, its wheel, a trackpad and a pen are as they
 * were.
 */
import type { CSSProperties, PointerEvent } from "react";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { Box } from "./annotations";
import { measuresOf, stavesOf, type DrawnPage } from "./drawing";
import type { RenderedPage } from "./pdf";

export type Tool = "system" | "barline" | "staff";

export const EDITOR_HEIGHT = 320;
/** The editor's zoom steps: 1 is the page as wide as the panel. */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
const SCROLL: CSSProperties = { height: EDITOR_HEIGHT, overflow: "auto", background: "#161d27", borderRadius: 3 };
/** The page: as wide as the zoom says, centred when narrower than the box; the × and the handles are placed over it. */
const PAGE: CSSProperties = { position: "relative", margin: "0 auto" };
const OVER: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };
const REMOVE: CSSProperties = { position: "absolute", width: 24, height: 24, borderRadius: 12, background: "#3c78dc", color: "#fff", font: "15px/24px system-ui, sans-serif", textAlign: "center", cursor: "pointer", userSelect: "none", touchAction: "none", pointerEvents: "auto", boxShadow: "0 1px 3px rgba(0,0,0,.35)", transform: "translate(-50%, -50%) translate(16px, -16px)" };
/** A corner handle: a 30 px target around a 12 px dot. */
const HANDLE: CSSProperties = { position: "absolute", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", transform: "translate(-50%, -50%)", touchAction: "none", pointerEvents: "auto" };
const DOT: CSSProperties = { width: 12, height: 12, borderRadius: 6, background: "#fff", border: "2px solid #3c78dc", boxSizing: "border-box" };
type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
const CORNER_CURSOR: Record<Corner, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };
/** A box with its corners in order (a corner dragged past the opposite edge turns it over). */
const ordered = (b: Box): Box => ({ x0: Math.min(b.x0, b.x1), y0: Math.min(b.y0, b.y1), x1: Math.max(b.x0, b.x1), y1: Math.max(b.y0, b.y1) });
const CURSOR: Record<Tool, string> = { system: "crosshair", barline: "col-resize", staff: "row-resize" };

export interface PageEditorProps {
  image: RenderedPage;
  page: DrawnPage | undefined;
  tool: Tool;
  /** 1 = the page as wide as the panel; the box scrolls both ways beyond it. */
  zoom: number;
  /** The reading-order number of this page's first measure (measures before it, on earlier pages). */
  firstMeasure: number;
  onAddSystem(box: Box): void;
  onToggleBarline(x: number, y: number): void;
  onToggleSplit(x: number, y: number): void;
  onRemoveSystem(index: number): void;
  /** A system's corner dragged: its new box, corners in any order. */
  onResizeSystem(index: number, box: Box): void;
}

export function PageEditor({ image, page, tool, zoom, firstMeasure, onAddSystem, onToggleBarline, onToggleSplit, onRemoveSystem, onResizeSystem }: PageEditorProps) {
  const svg = useRef<SVGSVGElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** A corner being dragged: the system, the corner, and the box so far. */
  const [resize, setResize] = useState<{ index: number; corner: Corner; box: Box } | null>(null);
  /** The fingers down, by pointer id, in client pixels; and whether this gesture became a pan. */
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const panning = useRef(false);
  /** Where the pan began: the box's scroll and the fingers' midpoint — re-taken whenever a finger joins or lifts. */
  const panFrom = useRef<{ left: number; top: number; x: number; y: number } | null>(null);
  const midpoint = (): { x: number; y: number } => {
    let x = 0;
    let y = 0;
    for (const f of fingers.current.values()) {
      x += f.x;
      y += f.y;
    }
    return { x: x / fingers.current.size, y: y / fingers.current.size };
  };
  const rebase = () => {
    const el = scroll.current;
    const m = midpoint();
    panFrom.current = el && fingers.current.size >= 2 ? { left: el.scrollLeft, top: el.scrollTop, x: m.x, y: m.y } : null;
  };
  /** A pointer goes down (on the page, a handle or a ×): a finger is counted, and a second one makes the gesture a pan. True when it pans. */
  const press = (e: PointerEvent<Element>): boolean => {
    if (e.pointerType === "touch") {
      fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.current.size >= 2) {
        panning.current = true;
        setDrag(null);
        setResize(null);
        rebase();
      }
    }
    return panning.current;
  };
  /** A pointer moves: true when the move belongs to a pan (and the page has followed it). */
  const pan = (e: PointerEvent<Element>): boolean => {
    if (!fingers.current.has(e.pointerId)) return false;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!panning.current) return false;
    const el = scroll.current;
    const from = panFrom.current;
    if (el && from) {
      const m = midpoint();
      el.scrollLeft = from.left - (m.x - from.x);
      el.scrollTop = from.top - (m.y - from.y);
    }
    return true;
  };
  /** A finger (or any pointer) lifts: true when it ends a pan, so it must not draw. */
  const lift = (e: PointerEvent<Element>): boolean => {
    const was = panning.current;
    fingers.current.delete(e.pointerId);
    if (fingers.current.size === 0) panning.current = false;
    if (was) rebase();
    return was;
  };
  const letGo = (e: PointerEvent<Element>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  // A zoom keeps what was in the middle of the box in the middle: the
  // scroll offsets scale with it, around the box's centre.
  const lastZoom = useRef(zoom);
  useLayoutEffect(() => {
    const el = scroll.current;
    const was = lastZoom.current;
    lastZoom.current = zoom;
    if (!el || was === zoom) return;
    const k = zoom / was;
    el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * k - el.clientWidth / 2;
    el.scrollTop = (el.scrollTop + el.clientHeight / 2) * k - el.clientHeight / 2;
  }, [zoom]);
  /** A pointer, in the page's pixels. */
  const at = (e: PointerEvent<Element>): { x: number; y: number } => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * image.width, y: ((e.clientY - r.top) / r.height) * image.height };
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (press(e) || e.button !== 0) return;
    const p = at(e);
    if (tool === "system") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    }
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (pan(e) || !drag) return;
    const p = at(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };
  const up = (e: PointerEvent<SVGSVGElement>) => {
    if (lift(e)) {
      letGo(e);
      return;
    }
    const p = at(e);
    if (tool === "system" && drag) {
      letGo(e);
      onAddSystem({ x0: drag.x0, y0: drag.y0, x1: p.x, y1: p.y });
      setDrag(null);
    } else if (tool === "barline") onToggleBarline(p.x, p.y);
    else if (tool === "staff") onToggleSplit(p.x, p.y);
  };
  // A corner handle: the drag moves that corner's two edges.
  const grab = (index: number, corner: Corner) => (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const s = page?.systems[index];
    if (press(e) || e.button !== 0 || !s) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setResize({ index, corner, box: s.box });
  };
  const stretch = (e: PointerEvent<HTMLDivElement>) => {
    if (pan(e) || !resize) return;
    const p = at(e);
    const box = { ...resize.box };
    if (resize.corner[1] === "w") box.x0 = p.x;
    else box.x1 = p.x;
    if (resize.corner[0] === "n") box.y0 = p.y;
    else box.y1 = p.y;
    setResize({ ...resize, box });
  };
  const release = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    letGo(e);
    const r = resize;
    setResize(null);
    if (!lift(e) && r) onResizeSystem(r.index, r.box);
  };

  let n = firstMeasure;
  const hand = Math.max(16, image.width / 90); // the numbers, in page pixels
  // what is drawn: a system being resized shows its box so far
  const systems = (page?.systems ?? []).map((s, i) => (resize?.index === i ? { ...s, box: ordered(resize.box) } : s));
  const pctX = (x: number) => `${(x / image.width) * 100}%`;
  const pctY = (y: number) => `${(y / image.height) * 100}%`;
  return (
    <div ref={scroll} data-pdf-editor-scroll style={SCROLL}>
      <div data-pdf-editor-page style={{ ...PAGE, width: `${zoom * 100}%` }}>
        <svg
          ref={svg}
          data-pdf-editor
          data-pdf-tool={tool}
          data-pdf-zoom={zoom}
          viewBox={`0 0 ${image.width} ${image.height}`}
          style={{ display: "block", width: "100%", height: "auto", background: "#fff", cursor: CURSOR[tool], touchAction: "none" }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={(e) => {
            lift(e);
            setDrag(null);
          }}
        >
          <image href={image.url} x={0} y={0} width={image.width} height={image.height} preserveAspectRatio="none" />
          {systems.map((s, i) => (
            <g key={i} data-pdf-system={i}>
              <rect x={s.box.x0} y={s.box.y0} width={s.box.x1 - s.box.x0} height={s.box.y1 - s.box.y0} fill="rgba(60, 120, 220, 0.06)" stroke="#3c78dc" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              {measuresOf(s).map((m, k) => {
                n++;
                return (
                  <text key={k} data-pdf-drawn-measure={n} x={m.x0 + hand * 0.3} y={m.y0 + hand * 1.1} fontSize={hand} fill="#3c78dc" style={{ pointerEvents: "none", fontFamily: "system-ui, sans-serif" }}>
                    {n}
                  </text>
                );
              })}
              {s.barlines.map((b, k) => (
                <line key={k} data-pdf-barline={Math.round(b)} x1={b} x2={b} y1={s.box.y0} y2={s.box.y1} stroke="#e0a000" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
              ))}
              {s.splits.map((v, k) => (
                <line key={k} data-pdf-split={Math.round(v)} x1={s.box.x0} x2={s.box.x1} y1={v} y2={v} stroke="#2e9e5b" strokeWidth={2} strokeDasharray="10 6" vectorEffect="non-scaling-stroke" />
              ))}
              {s.splits.length > 0 &&
                stavesOf(s).map((st, k) => (
                  <text key={k} data-pdf-staff-label={k + 1} x={st.x0 - hand * 0.4} y={(st.y0 + st.y1) / 2 + hand * 0.35} fontSize={hand * 0.9} textAnchor="end" fill="#2e9e5b" style={{ pointerEvents: "none", fontFamily: "system-ui, sans-serif" }}>
                    {k + 1}
                  </text>
                ))}
            </g>
          ))}
          {drag && <rect data-pdf-drag x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} fill="rgba(224, 160, 0, 0.1)" stroke="#e0a000" strokeDasharray="6 4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        </svg>
        <div style={OVER}>
          {systems.map((s, i) => (
            <Fragment key={i}>
              <div
                data-pdf-remove-system={i}
                role="button"
                title="remove this system"
                style={{ ...REMOVE, left: pctX(s.box.x1), top: pctY(s.box.y0) }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  press(e);
                }}
                onPointerMove={(e) => void pan(e)}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  if (!lift(e)) onRemoveSystem(i);
                }}
                onPointerCancel={(e) => void lift(e)}
              >
                ×
              </div>
              {tool === "system" &&
                CORNERS.map((c) => (
                  <div
                    key={c}
                    data-pdf-resize={`${i}:${c}`}
                    title="drag to resize the system"
                    style={{ ...HANDLE, left: pctX(c[1] === "w" ? s.box.x0 : s.box.x1), top: pctY(c[0] === "n" ? s.box.y0 : s.box.y1), cursor: CORNER_CURSOR[c] }}
                    onPointerDown={grab(i, c)}
                    onPointerMove={stretch}
                    onPointerUp={release}
                    onPointerCancel={(e) => {
                      lift(e);
                      setResize(null);
                    }}
                  >
                    <span style={DOT} />
                  </div>
                ))}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
