/**
 * The shortcut editor (🌣): every binding listed by group; click a
 * rebindable one and press the new key (alt carries; shift carries via
 * the character for letters, explicitly otherwise). Locked rows are the
 * physical/system bindings. Doubles as the keyboard help.
 */
import { useEffect, useState } from "react";
import { bindingText, type KeyBinding, type Keymap } from "./keymap";

const GROUPS = ["entry", "accidentals", "marks", "rhythm", "repeats", "system"];

export function ShortcutEditor({
  keymap,
  onRebind,
  onReset,
  onClose,
}: {
  keymap: Keymap;
  onRebind: (id: string, binding: Pick<KeyBinding, "keys" | "shift" | "alt">) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [capturing, setCapturing] = useState<string | null>(null);

  // Duplicate detection (soft warning — some overlaps are context-split).
  const dupes = new Set<string>();
  const seen = new Map<string, string>();
  for (const [id, b] of Object.entries(keymap)) {
    if (b.locked) continue;
    for (const k of b.keys) {
      const sig = `${b.alt ? "A" : ""}${b.shift ? "S" : ""}${k}`;
      const other = seen.get(sig);
      if (other && other !== id) {
        dupes.add(id);
        dupes.add(other);
      } else seen.set(sig, id);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!capturing) {
        if (e.key === "Escape") onClose();
        return;
      }
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      const isLetter = e.key.length === 1 && e.key.toLowerCase() !== e.key.toUpperCase();
      onRebind(capturing, {
        keys: [e.key],
        ...(e.altKey ? { alt: true } : {}),
        ...(isLetter ? {} : { shift: e.shiftKey }),
      });
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, onRebind, onClose]);

  return (
    <div data-shortcuts style={{ position: "fixed", inset: 0, background: "rgba(10,16,24,.55)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div
        style={{ background: "#1d2733", color: "#dde", borderRadius: 8, padding: "14px 18px", width: 640, maxHeight: "82vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,.5)", fontSize: 13 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
          <strong style={{ fontSize: 15 }}>🌣 shortcuts</strong>
          <span style={{ color: "#89a" }}>click a binding, press the new key · esc closes</span>
          <span style={{ flex: 1 }} />
          <button data-shortcuts-reset onClick={onReset} style={{ fontSize: 12 }}>
            reset all
          </button>
          <button onClick={onClose} style={{ fontSize: 12 }}>
            close
          </button>
        </div>
        {GROUPS.map((group) => (
          <div key={group}>
            <div style={{ color: "#7d93ad", margin: "10px 0 2px", textTransform: "uppercase", fontSize: 11, letterSpacing: 1 }}>{group}</div>
            {Object.entries(keymap)
              .filter(([, b]) => b.group === group)
              .map(([id, b]) => (
                <div key={id} data-shortcut-row={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                  <span style={{ flex: 1 }}>
                    {b.label}
                    {b.when && <span style={{ color: "#678", marginLeft: 6, fontSize: 12 }}>({b.when})</span>}
                  </span>
                  {b.locked ? (
                    <span style={{ color: "#678", fontFamily: "monospace" }}>{b.keys.join(" ")}</span>
                  ) : (
                    <button
                      data-shortcut-bind={id}
                      onClick={() => setCapturing(id)}
                      style={{
                        fontFamily: "monospace",
                        fontSize: 12,
                        minWidth: 90,
                        background: capturing === id ? "#2d7d46" : dupes.has(id) ? "#7a5b1e" : "#28394e",
                        color: "#fff",
                        border: "none",
                        borderRadius: 4,
                        padding: "2px 8px",
                        cursor: "pointer",
                      }}
                      title={dupes.has(id) ? "shares a key with another action (context may still separate them)" : "click, then press the new key"}
                    >
                      {capturing === id ? "press a key…" : bindingText(b)}
                    </button>
                  )}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
