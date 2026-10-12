/**
 * Drawing systems and measures on a page (see `drawing.ts`). The whole page,
 * as wide as the panel, in a box that scrolls — a system is drawn at a size
 * a hand can aim at, ZOOMED up to four times (the spot in the middle stays
 * in the middle). Three tools: SYSTEMS (drag a box across one), BARLINES
 * (click in a system to add one, click one to remove it) and STAVES (click
 * at a staff boundary to split the system there, click a split to remove
 * it). Each system has a × to remove it; measures are numbered in the
 * order the score's measures are matched to them, staves 1, 2… down the
 * system's left.
 *
 * Coordinates: the pointer, through the SVG's own box, into the rendered
 * page's pixels — the drawing's units. Everything it does goes through the
 * callbacks; the drawing itself is the plugin's state.
 */
import type { CSSProperties, PointerEvent } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { Box } from "./annotations";
import { measuresOf, stavesOf, type DrawnPage } from "./drawing";
import type { RenderedPage } from "./pdf";

export type Tool = "system" | "barline" | "staff";

export const EDITOR_HEIGHT = 320;
/** The editor's zoom steps: 1 is the page as wide as the panel. */
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;
const SCROLL: CSSProperties = { height: EDITOR_HEIGHT, overflow: "auto", background: "#161d27", borderRadius: 3 };
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
}

export function PageEditor({ image, page, tool, zoom, firstMeasure, onAddSystem, onToggleBarline, onToggleSplit, onRemoveSystem }: PageEditorProps) {
  const svg = useRef<SVGSVGElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
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
  /** The pointer, in the page's pixels. */
  const at = (e: PointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * image.width, y: ((e.clientY - r.top) / r.height) * image.height };
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = at(e);
    if (tool === "system") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    }
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = at(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };
  const up = (e: PointerEvent<SVGSVGElement>) => {
    const p = at(e);
    if (tool === "system" && drag) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      onAddSystem({ x0: drag.x0, y0: drag.y0, x1: p.x, y1: p.y });
      setDrag(null);
    } else if (tool === "barline") onToggleBarline(p.x, p.y);
    else if (tool === "staff") onToggleSplit(p.x, p.y);
  };

  let n = firstMeasure;
  const hand = Math.max(16, image.width / 90); // the × and the numbers, in page pixels
  return (
    <div ref={scroll} data-pdf-editor-scroll style={SCROLL}>
      <svg
        ref={svg}
        data-pdf-editor
        data-pdf-tool={tool}
        data-pdf-zoom={zoom}
        viewBox={`0 0 ${image.width} ${image.height}`}
        style={{ display: "block", width: `${zoom * 100}%`, height: "auto", background: "#fff", cursor: CURSOR[tool], touchAction: "none" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrag(null)}
      >
        <image href={image.url} x={0} y={0} width={image.width} height={image.height} preserveAspectRatio="none" />
        {(page?.systems ?? []).map((s, i) => (
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
            <g
              data-pdf-remove-system={i}
              style={{ cursor: "pointer" }}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => {
                e.stopPropagation();
                onRemoveSystem(i);
              }}
            >
              <title>remove this system</title>
              <circle cx={s.box.x1} cy={s.box.y0} r={hand * 0.7} fill="#3c78dc" />
              <text x={s.box.x1} y={s.box.y0 + hand * 0.35} fontSize={hand} textAnchor="middle" fill="#fff" style={{ pointerEvents: "none", fontFamily: "system-ui, sans-serif" }}>
                ×
              </text>
            </g>
          </g>
        ))}
        {drag && <rect data-pdf-drag x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} fill="rgba(224, 160, 0, 0.1)" stroke="#e0a000" strokeDasharray="6 4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}
