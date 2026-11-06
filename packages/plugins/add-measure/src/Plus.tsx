/**
 * The tile after the last measure: the staves drawn gray at the heights the
 * last tile has them, and a + in the middle of the staff — one button, the
 * tile's whole box, that a finger, a mouse or the pen (`data-pen-tap`: the
 * stylus plugin presses it for a pen tap) can hit.
 */
import type { CSSProperties } from "react";
import type { EndOverlayProps } from "@battuta/api";

const BUTTON: CSSProperties = { display: "block", width: "100%", height: "100%", padding: 0, margin: 0, background: "transparent", border: "none", cursor: "pointer", color: "#9aa4b0" };
const INSET = 6;

/** The + sits in the middle of the staves: on the middle line of one staff, between the staves of a system. */
export function middleOf(staves: readonly { lines: readonly number[] }[], height: number): number {
  const lines = staves.flatMap((s) => s.lines);
  if (lines.length === 0) return height / 2;
  return (Math.min(...lines) + Math.max(...lines)) / 2;
}

export function Plus({ end, onAdd }: { end: EndOverlayProps; onAdd: () => void }) {
  const { width, height, staves } = end;
  const cy = middleOf(staves, height);
  const r = Math.max(10, Math.min(16, width / 8));
  return (
    <button type="button" data-add-measure data-pen-tap title="add a measure after the last" aria-label="add a measure" style={BUTTON} onClick={onAdd}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }} aria-hidden="true">
        <g stroke="currentColor" strokeWidth={1} opacity={0.55}>
          {staves.flatMap((s) => s.lines.map((y) => <line key={`${s.n}-${y}`} x1={INSET} y1={y} x2={width - INSET} y2={y} />))}
          {staves.length > 0 && <line x1={width - INSET} y1={Math.min(...staves.flatMap((s) => s.lines))} x2={width - INSET} y2={Math.max(...staves.flatMap((s) => s.lines))} />}
        </g>
        <g transform={`translate(${width / 2} ${cy})`}>
          <circle r={r} fill="#fff" stroke="currentColor" strokeWidth={1.5} />
          <path d={`M${-r * 0.55} 0 H${r * 0.55} M0 ${-r * 0.55} V${r * 0.55}`} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </g>
      </svg>
    </button>
  );
}
