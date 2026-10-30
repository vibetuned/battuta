/**
 * The feed, drawn in the host's float area (bottom-left, over the score,
 * never touched): one dark pill per entry, newest at the bottom, large
 * enough to read in a video.
 */
import type { CSSProperties } from "react";
import type { Store } from "@battuta/api";
import { opacityOf, type Feed } from "./feed";
import { useStore } from "./store";

const PILL: CSSProperties = { width: "fit-content", marginTop: 6, background: "rgba(20, 28, 38, .86)", color: "#fff", font: "600 20px/1.25 system-ui, sans-serif", padding: "6px 14px", borderRadius: 8, whiteSpace: "nowrap", boxShadow: "0 2px 10px rgba(0,0,0,.25)" };
const QUIET: CSSProperties = { fontWeight: 400, color: "#aebccc", fontSize: 16 };

export function Screencast({ feed }: { feed: Store<Feed> }) {
  const { entries, now } = useStore(feed);
  return (
    <>
      {entries.map((e) => (
        <div key={e.id} data-screencast-entry={e.kind} style={{ ...PILL, opacity: opacityOf(e, now) }}>
          {e.kind === "midi" && <span style={QUIET}>♪ </span>}
          {e.text}
          {e.count > 1 && <span style={QUIET}> ×{e.count}</span>}
          {e.action && <span style={QUIET}> · {e.action}</span>}
        </div>
      ))}
    </>
  );
}
