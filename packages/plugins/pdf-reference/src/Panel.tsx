/**
 * The bottom panel: the controls, and a STRIP — the system the caret's
 * measure sits in, cropped from its page by an SVG view box, every
 * annotated measure outlined and the caret's highlighted. Everything it
 * shows arrives from the state store it subscribes to; everything it does
 * goes through `actions`, so a test reads the wiring off the element
 * `render()` returns and this file holds no PDF call and no matching.
 */
import type { CSSProperties, ChangeEvent, ReactNode } from "react";
import { useRef } from "react";
import type { Store } from "@battuta/api";
import type { AnnotatedMeasure, Annotations, Box } from "./annotations";
import type { Drawing } from "./drawing";
import { scaleFor, scaled, systemView } from "./geometry";
import { PageEditor, ZOOM_STEPS, type Tool } from "./PageEditor";
import type { Matching } from "./match";
import type { RenderedPage } from "./pdf";
import { useStore } from "./store";

export type PdfStatus = "empty" | "loading" | "ready" | "error";

export interface PdfState {
  status: PdfStatus;
  /** The PDF's file name. */
  fileName: string | null;
  /** Pages rendered so far while loading. */
  progress: { done: number; total: number } | null;
  error: string | null;
  /** What could not be used, and why — a file that is not an annotation, a page the PDF does not have. */
  notes: readonly string[];
  pages: readonly RenderedPage[];
  annotations: Annotations | null;
  matching: Matching | null;
  /** How many measures the score has. */
  docMeasures: number;
  /** The measure the strip highlights: the caret's. */
  current: AnnotatedMeasure | null;
  /** The caret's staff (1-based), highlighted inside its measure when the system's staves are known. */
  currentStaff: number | null;
  /** The system the strip shows; `system` -1 is the whole page (a PDF without annotations). */
  view: { page: number; system: number } | null;
  /** Draw the scans above the tiles. */
  showBands: boolean;
  /** Where the annotations come from: the page files, or a drawing (this PDF's, kept by the plugin). */
  source: "files" | "drawn" | null;
  /** The PDF's drawing, when there is one. */
  drawing: Drawing | null;
  /** Drawing systems and measures: the page editor replaces the strip. */
  editing: boolean;
  tool: Tool;
  /** The page being drawn on. */
  editPage: number;
  /** The drawing editor's zoom, one of `ZOOM_STEPS`. */
  editZoom: number;
}

/** A file as the panel hands it over: a name, its bytes and its text, nothing of the DOM's File. */
export interface PickedFile {
  name: string;
  /** The MIME type the platform gave, when it gave one. */
  type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface PdfActions {
  load(files: PickedFile[]): void;
  clear(): void;
  /** The previous or next system (a page, without annotations). */
  step(delta: -1 | 1): void;
  setShowBands(on: boolean): void;
  close(): void;
  /** Draw systems and measures on the PDF's pages; `stopDrawing` is "done". */
  startDrawing(): void;
  stopDrawing(): void;
  setTool(tool: Tool): void;
  /** The previous or next page while drawing. */
  stepEditPage(delta: -1 | 1): void;
  addSystem(box: Box): void;
  toggleBarline(x: number, y: number): void;
  toggleSplit(x: number, y: number): void;
  removeSystem(index: number): void;
  /** One zoom step in or out of the drawing editor. */
  zoomEditor(delta: -1 | 1): void;
}

const ROOT: CSSProperties = { padding: "6px 10px 8px", fontSize: 12, color: "#dde" };
const ROW: CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 };
const BTN: CSSProperties = { font: "inherit", fontSize: 12, padding: "2px 8px", background: "#2c3745", color: "#dde", border: "1px solid #4a5768", borderRadius: 3, cursor: "pointer" };
const DIM: CSSProperties = { color: "#9ab" };
const STRIP_HEIGHT = 220;
const STRIP: CSSProperties = { display: "block", width: "100%", height: STRIP_HEIGHT, background: "#fff", borderRadius: 3 };
const HINT: CSSProperties = { height: STRIP_HEIGHT, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ab", background: "#161d27", borderRadius: 3, textAlign: "center", padding: "0 20px" };

/** The match readout: how many of the score's measures have a scan, and how they were matched. */
export function matchLine(s: Pick<PdfState, "annotations" | "matching" | "docMeasures" | "source">): string | null {
  if (!s.annotations) return null;
  const annotated = s.annotations.measures.length;
  if (!s.matching) return `${annotated} measures annotated`;
  const how = s.matching.mode === "id" ? "by id" : "in order";
  const counts = s.matching.mode === "order" && annotated !== s.docMeasures ? ` — ${s.source === "drawn" ? "the drawing" : "the PDF"} has ${annotated}, the score ${s.docMeasures}` : "";
  return `${s.matching.matched} of ${s.docMeasures} measures placed ${how}${counts}`;
}

export function PdfPanel({ state, actions }: { state: Store<PdfState>; actions: PdfActions }) {
  const s = useStore(state);
  const input = useRef<HTMLInputElement>(null);
  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).map((f) => ({ name: f.name, type: f.type, arrayBuffer: () => f.arrayBuffer(), text: () => f.text() }));
    if (files.length) actions.load(files);
    e.target.value = "";
  };

  const status = (): ReactNode => {
    if (s.status === "loading") return <span style={DIM}>{s.progress ? `rendering page ${Math.min(s.progress.done + 1, s.progress.total)} of ${s.progress.total}…` : "reading…"}</span>;
    if (s.error) return <span style={{ color: "#f88" }}>{s.error}</span>;
    if (s.status !== "ready") return <span style={DIM}>no PDF loaded</span>;
    const line = matchLine(s);
    return <span>{line ?? "no annotations — draw the systems and measures, or add the …_page<N>.json files"}</span>;
  };

  const editor = (): ReactNode => {
    const image = s.pages.find((p) => p.page === s.editPage);
    if (!image) return null;
    const firstMeasure = s.annotations ? s.annotations.measures.filter((m) => m.page < s.editPage).length : 0;
    return <PageEditor image={image} page={s.drawing?.pages[String(s.editPage)]} tool={s.tool} zoom={s.editZoom} firstMeasure={firstMeasure} onAddSystem={actions.addSystem} onToggleBarline={actions.toggleBarline} onToggleSplit={actions.toggleSplit} onRemoveSystem={actions.removeSystem} />;
  };
  const drawn = s.annotations && s.source === "drawn" ? s.annotations : null;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const drawnLine = `${plural(drawn ? drawn.pages.reduce((n, p) => n + p.systems.length, 0) : 0, "system")} · ${plural(drawn?.measures.length ?? 0, "measure")} drawn — the score has ${s.docMeasures}`;
  const zoomAt = ZOOM_STEPS.indexOf(s.editZoom as (typeof ZOOM_STEPS)[number]);
  const toolButton = (tool: Tool, label: string, title: string) => (
    <button data-pdf-tool-button={tool} aria-pressed={s.tool === tool} title={title} style={{ ...BTN, ...(s.tool === tool ? { background: "#3c78dc", borderColor: "#3c78dc", color: "#fff" } : {}) }} onClick={() => actions.setTool(tool)}>
      {label}
    </button>
  );

  const strip = (): ReactNode => {
    const view = s.view;
    const image = view ? s.pages.find((p) => p.page === view.page) : undefined;
    if (s.status !== "ready" || !view || !image) {
      return <div style={HINT}>{s.status === "loading" ? status() : "Load a score's PDF together with its annotation files (…_page1.json, …_page2.json…) to see each measure's scan above its tile."}</div>;
    }
    const page = s.annotations?.pages.find((p) => p.page === view.page);
    const k = scaleFor(page, image.width);
    const system = view.system >= 0 ? page?.systems[view.system] : undefined;
    const box = system ? systemView(system, k, image) : { x0: 0, y0: 0, x1: image.width, y1: image.height };
    const measures = page && system ? page.measures.filter((m) => m.system === view.system) : [];
    // the caret's staff inside its measure, when the system's staves are known
    const staff = s.current && s.currentStaff !== null && s.current.page === view.page && s.current.system === view.system ? page?.staves[view.system]?.[s.currentStaff - 1] : undefined;
    const staffBox = staff && s.current ? scaled({ x0: s.current.box.x0, x1: s.current.box.x1, y0: staff.y0, y1: staff.y1 }, k) : null;
    return (
      <svg data-pdf-strip viewBox={`${box.x0} ${box.y0} ${box.x1 - box.x0} ${box.y1 - box.y0}`} preserveAspectRatio="xMidYMid meet" style={STRIP}>
        {/* a view box does not clip: without this the page around the system shows in the strip's spare width */}
        <clipPath id="pdf-strip-clip">
          <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} />
        </clipPath>
        <image href={image.url} x={0} y={0} width={image.width} height={image.height} preserveAspectRatio="none" clipPath="url(#pdf-strip-clip)" />
        {measures.map((m) => {
          const b = scaled(m.box, k);
          const cur = s.current?.order === m.order;
          return (
            <rect
              key={m.order}
              data-pdf-measure={m.order}
              data-pdf-measure-id={m.id ?? ""}
              {...(cur ? { "data-pdf-current": "" } : {})}
              x={b.x0}
              y={b.y0}
              width={b.x1 - b.x0}
              height={b.y1 - b.y0}
              fill={cur ? "rgba(255, 200, 60, 0.18)" : "none"}
              stroke={cur ? "#e0a000" : "rgba(60, 120, 220, 0.55)"}
              strokeWidth={cur ? 2.5 : 1.2}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {staffBox && <rect data-pdf-current-staff={s.currentStaff ?? ""} x={staffBox.x0} y={staffBox.y0} width={staffBox.x1 - staffBox.x0} height={staffBox.y1 - staffBox.y0} fill="rgba(46, 158, 91, 0.16)" stroke="#2e9e5b" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      </svg>
    );
  };

  const where = s.view ? (s.view.system >= 0 ? `page ${s.view.page} · system ${s.view.system + 1}` : `page ${s.view.page} of ${s.pages.length}`) : "";
  return (
    <div
      data-pdf-ref
      data-pdf-state={s.status}
      data-pdf-pages={s.pages.length}
      data-pdf-annotated={s.annotations?.measures.length ?? 0}
      data-pdf-matched={s.matching?.matched ?? 0}
      data-pdf-mode={s.matching?.mode ?? ""}
      data-pdf-view={s.view ? `${s.view.page}:${s.view.system}` : ""}
      data-pdf-current={s.current ? String(s.current.order) : ""}
      data-pdf-source={s.source ?? ""}
      data-pdf-editing={s.editing ? "true" : "false"}
      style={ROOT}
    >
      <div style={ROW}>
        <strong>📄 PDF reference</strong>
        <button data-pdf-load style={BTN} title="a PDF — or its pages as images — and, if you have them, its annotation files (…_page1.json…)" onClick={() => input.current?.click()}>
          load a PDF or images…
        </button>
        <input ref={input} data-pdf-file type="file" accept=".pdf,.json,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,application/pdf,application/json,image/*" multiple hidden onChange={onFiles} />
        {s.fileName ? <span title={s.fileName}>{s.fileName}</span> : null}
        <span data-pdf-status>{status()}</span>
        <span style={{ flex: 1 }} />
        {s.status === "ready" && s.source !== "files" && !s.editing && (
          <button data-pdf-draw style={BTN} title="draw the systems and the measures on the PDF's pages yourself" onClick={actions.startDrawing}>
            {s.source === "drawn" ? "edit the drawing" : "draw systems and measures"}
          </button>
        )}
        {s.status === "ready" && !s.editing && (
          <>
            <button data-pdf-prev style={BTN} title="the previous system" onClick={() => actions.step(-1)}>
              ◀
            </button>
            <span data-pdf-where style={DIM}>
              {where}
            </span>
            <button data-pdf-next style={BTN} title="the next system" onClick={() => actions.step(1)}>
              ▶
            </button>
          </>
        )}
        <label title="draw each measure's scan above its tile in edit view">
          <input data-pdf-bands type="checkbox" checked={s.showBands} onChange={(e) => actions.setShowBands(e.target.checked)} /> <span style={DIM}>on the score</span>
        </label>
        {s.status !== "empty" ? (
          <button data-pdf-clear style={BTN} onClick={actions.clear}>
            clear
          </button>
        ) : null}
        <button data-pdf-close style={BTN} title="close" onClick={actions.close}>
          ×
        </button>
      </div>
      {s.notes.length > 0 && (
        <div data-pdf-notes style={{ ...DIM, marginBottom: 6 }}>
          {s.notes.join(" · ")}
        </div>
      )}
      {s.editing && (
        <div data-pdf-drawing-bar style={ROW}>
          {toolButton("system", "▭ systems", "drag a box across a system")}
          {toolButton("barline", "| barlines", "click in a system to put a barline there; click a barline to take it away")}
          {toolButton("staff", "≡ staves", "click in a system between two staves to split it there; click a split to take it away")}
          <button data-pdf-zoom-out style={BTN} title="zoom out" disabled={zoomAt <= 0} onClick={() => actions.zoomEditor(-1)}>
            −
          </button>
          <span data-pdf-zoom-level style={DIM}>
            {Math.round(s.editZoom * 100)}%
          </span>
          <button data-pdf-zoom-in style={BTN} title="zoom in" disabled={zoomAt >= ZOOM_STEPS.length - 1} onClick={() => actions.zoomEditor(1)}>
            +
          </button>
          <button data-pdf-edit-prev style={BTN} title="the previous page" onClick={() => actions.stepEditPage(-1)}>
            ◀
          </button>
          <span data-pdf-edit-page style={DIM}>
            page {s.editPage} of {s.pages.length}
          </span>
          <button data-pdf-edit-next style={BTN} title="the next page" onClick={() => actions.stepEditPage(1)}>
            ▶
          </button>
          <span data-pdf-drawn>{drawnLine}</span>
          <span style={{ flex: 1 }} />
          <button data-pdf-draw-done style={BTN} onClick={actions.stopDrawing}>
            done
          </button>
        </div>
      )}
      {s.editing ? editor() : strip()}
    </div>
  );
}
