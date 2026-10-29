/**
 * The cross at the tip, on the host's overlays point: drawn over the tile
 * the pen landed on while it is down. Four arms — left shorter, right
 * longer, up and down the pitch; only the last two for a chord, whose
 * length is the note's — a ghost notehead where the note will go, and what
 * lifting the pen writes, in words. Draw-only, like every
 * overlay: the pen is captured, so nothing here needs pointer events.
 */
import type { CSSProperties } from "react";
import type { Store, TileOverlayProps } from "@battuta/api";
import { lengthName, type Gesture } from "./gesture";
import { useStore } from "./store";

const ARM = 26;
const INK = "#1d6fd6";
const LAYER: CSSProperties = { position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" };
const LABEL: CSSProperties = { position: "absolute", background: "rgba(20, 28, 38, .9)", color: "#fff", font: "12px/1.3 system-ui, sans-serif", padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap" };

/** The y of a step on a staff (0 its bottom line), from the staff's lines in the tile. */
export function stepY(lines: readonly number[], step: number): number | null {
  if (lines.length < 2) return null;
  const bottom = lines[lines.length - 1]!;
  return bottom - (step * (bottom - lines[0]!)) / (lines.length - 1) / 2;
}

export function Cross({ tile, state }: { tile: TileOverlayProps; state: Store<Gesture> }) {
  const g = useStore(state);
  if (g.kind !== "cross" || g.landing.at.measureIndex !== tile.measureIndex) return null;
  const { x, y } = g.landing.at.tile;
  const staff = tile.staves.find((s) => s.n === g.landing.at.staffN);
  const headY = staff ? stepY(staff.lines, g.choice.step) : null;
  const pitch = `${g.choice.pitch.pname.toUpperCase()}${g.choice.pitch.oct}`;
  const text = g.chord ? `chord + ${pitch}` : `${lengthName(g.choice)} · ${pitch}`;
  const labelLeft = x + ARM + 150 > tile.width ? x - ARM - 4 : x + ARM + 4;
  return (
    <div data-stylus-cross style={LAYER}>
      <svg width={tile.width} height={tile.height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <g stroke={INK} strokeWidth={2} strokeLinecap="round" fill="none" opacity={0.85}>
          <line x1={x} y1={y - ARM} x2={x} y2={y + ARM} />
          {/* A chord's pitch joins the note's own length: no arms across. */}
          {!g.chord && (
            <>
              <line x1={x - ARM} y1={y} x2={x + ARM} y2={y} />
              <path d={`M${x - ARM + 6},${y - 5} L${x - ARM},${y} L${x - ARM + 6},${y + 5}`} />
              <path d={`M${x + ARM - 6},${y - 5} L${x + ARM},${y} L${x + ARM - 6},${y + 5}`} />
            </>
          )}
          <path d={`M${x - 5},${y - ARM + 6} L${x},${y - ARM} L${x + 5},${y - ARM + 6}`} />
          <path d={`M${x - 5},${y + ARM - 6} L${x},${y + ARM} L${x + 5},${y + ARM - 6}`} />
        </g>
        {headY !== null && <ellipse data-stylus-head cx={x} cy={headY} rx={6} ry={4.5} transform={`rotate(-20 ${x} ${headY})`} fill={INK} opacity={0.55} />}
      </svg>
      <div data-stylus-choice style={{ ...LABEL, left: labelLeft, top: y - ARM - 2, transform: labelLeft < x ? "translateX(-100%)" : undefined }}>
        {text}
      </div>
    </div>
  );
}
