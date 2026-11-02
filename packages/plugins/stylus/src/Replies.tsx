/**
 * The plugin's section in the plugins page (the `pluginSettings` slot, 1.3.11,
 * the user's wish): the replies kept on this tablet, how many the replay buffer
 * would take, the layer reading now, and the four actions — train, reset, share,
 * delete. Everything it does arrives as a prop from `activate`; the numbers are a
 * store re-read after anything that changes them.
 */
import type { CSSProperties } from "react";
import type { Store, StylusReplies } from "@battuta/api";
import { useStore } from "./store";

const BUTTON: CSSProperties = { font: "inherit", fontSize: 12, background: "#28394e", color: "#fff", border: "none", borderRadius: 4, padding: "2px 8px", cursor: "pointer" };
const OFF: CSSProperties = { ...BUTTON, opacity: 0.45, cursor: "default" };

export function RepliesSection({ state, busy, onTrain, onReset, onShare, onDelete }: { state: Store<StylusReplies | null>; busy: Store<boolean>; onTrain: () => void; onReset: () => void; onShare: () => void; onDelete: () => void }) {
  const s = useStore(state);
  const working = useStore(busy);
  const t = s?.training ?? null;
  const none = s === null || s.replies === 0;
  const button = (off: boolean, attr: string, title: string, text: string, onClick: () => void) => (
    <button type="button" {...{ [attr]: "" }} title={title} disabled={off} style={off ? OFF : BUTTON} onClick={onClick}>
      {text}
    </button>
  );
  return (
    <div data-stylus-replies style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "0 0 8px 24px", fontSize: 12, color: "#9ab" }}>
      <span data-stylus-replies-count>{s === null ? "the replies: not read yet" : `${s.replies} ${s.replies === 1 ? "reply" : "replies"} on this tablet — ${s.buffer} in the buffer (the newest eight of each class)`}</span>
      <span data-stylus-replies-training>{t ? `· trained on ${t.replies}: ${Math.round(t.accuracy * 100)} % of the buffer right, drift ${t.drift.toFixed(4)}` : "· the released classifier"}</span>
      {button(working || s === null || s.buffer === 0, "data-stylus-train", "retrain the classifier's last layer on this tablet from every reply", working ? "training…" : "train", onTrain)}
      {button(working || t === null, "data-stylus-reset", "the released classifier back; the replies stay", "reset", onReset)}
      {button(working || none, "data-stylus-share", "the replies file on the share sheet", "share", onShare)}
      {button(working || none, "data-stylus-delete", "every reply on this tablet deleted — it asks first", "delete replies", onDelete)}
    </div>
  );
}
