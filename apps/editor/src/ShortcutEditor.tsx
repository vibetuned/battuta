/**
 * The shortcut editor (🌣): every binding listed by group; click a
 * rebindable one and press the new key (alt carries; shift carries via
 * the character for letters, explicitly otherwise). Locked rows are the
 * physical/system bindings. Doubles as the keyboard help.
 *
 * Second tab — Plugins: every installed plugin with its on/off switch.
 * Off runs the plugin's deactivate and withdraws everything it
 * contributed (its bindings leave this very list); the switch persists.
 */
import { useEffect, useState } from "react";
import { bindingText, type KeyBinding, type Keymap, type Layout } from "./keymap";
import type { PluginInfo } from "./host";

const GROUPS = ["entry", "accidentals", "marks", "rhythm", "repeats", "system"];

type Tab = "shortcuts" | "plugins";

const STATE_LABEL: Record<PluginInfo["state"], string> = { active: "active", registered: "ready", disabled: "off", failed: "failed" };

export function ShortcutEditor({
  keymap,
  layout,
  onLayout,
  onRebind,
  onReset,
  onClose,
  plugins,
  noPlugins,
  onTogglePlugin,
}: {
  keymap: Keymap;
  layout: Layout;
  onLayout: (l: Layout) => void;
  onRebind: (id: string, binding: Pick<KeyBinding, "keys" | "shift" | "alt">) => void;
  onReset: () => void;
  onClose: () => void;
  plugins: readonly PluginInfo[];
  /** The session started with ?plugins=off: nothing is registered. */
  noPlugins: boolean;
  onTogglePlugin: (id: string, on: boolean) => void;
}) {
  const [capturing, setCapturing] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("shortcuts");
  // Known groups first, in their order; any group a plugin invented after.
  const groups = [...GROUPS, ...Object.values(keymap).map((b) => b.group).filter((g, i, all) => !GROUPS.includes(g) && all.indexOf(g) === i)];

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
          <strong style={{ fontSize: 15 }}>🌣</strong>
          <span data-editor-tabs style={{ display: "inline-flex", border: "1px solid #3a4656", borderRadius: 4, overflow: "hidden" }}>
            {(["shortcuts", "plugins"] as const).map((t) => (
              <button key={t} data-editor-tab={t} onClick={() => setTab(t)} style={{ fontSize: 13, padding: "2px 10px", border: "none", cursor: "pointer", background: tab === t ? "#3a4656" : "#28394e", color: "#fff", fontWeight: tab === t ? 600 : 400 }}>
                {t}
              </button>
            ))}
          </span>
          <span style={{ flex: 1 }} />
          {tab === "shortcuts" && (
            <>
              <span data-layout-toggle style={{ display: "inline-flex", border: "1px solid #3a4656", borderRadius: 4, overflow: "hidden" }} title="keyboard layout: separate defaults and overrides per layout">
                {(["qwerty", "azerty"] as const).map((l) => (
                  <button
                    key={l}
                    data-layout={l}
                    onClick={() => onLayout(l)}
                    style={{ fontSize: 12, padding: "2px 8px", border: "none", cursor: "pointer", background: layout === l ? "#2d7d46" : "#28394e", color: "#fff" }}
                  >
                    {l}
                  </button>
                ))}
              </span>
              <button data-shortcuts-reset onClick={onReset} style={{ fontSize: 12 }}>
                reset all
              </button>
            </>
          )}
          <button onClick={onClose} style={{ fontSize: 12 }}>
            close
          </button>
        </div>
        {/* The hint gets its own row: in the title row it squeezed the tabs, the layout toggle and the buttons. */}
        <div data-editor-hint style={{ color: "#89a", fontSize: 12, margin: "0 0 8px" }}>
          {tab === "shortcuts" ? "click a binding, press the new key · esc closes" : "off = deactivated now, remembered · esc closes"}
        </div>
        {tab === "plugins" && (
          <div data-plugins-tab>
            {noPlugins ? (
              <div data-plugins-empty style={{ color: "#89a", padding: "12px 0" }}>plugins are off for this session (the URL carries ?plugins=off) — nothing is registered</div>
            ) : plugins.length === 0 ? (
              <div data-plugins-empty style={{ color: "#89a", padding: "12px 0" }}>no plugins installed</div>
            ) : (
              plugins.map((p) => (
                <div key={p.id} data-plugin-row={p.id} data-plugin-state={p.state} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #2a3542" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: p.state === "failed" ? "not-allowed" : "pointer" }} title={p.state === "failed" ? p.error ?? "failed" : p.enabled ? "turn off: deactivates now and forgets nothing" : "turn on"}>
                    <input data-plugin-toggle={p.id} type="checkbox" checked={p.enabled} disabled={p.state === "failed"} onChange={(e) => onTogglePlugin(p.id, e.target.checked)} />
                    <strong>{p.manifest.name}</strong>
                  </label>
                  <span style={{ color: "#678", fontFamily: "monospace", fontSize: 11 }}>
                    {p.id} {p.manifest.version}
                  </span>
                  <span style={{ flex: 1, color: "#9ab", fontSize: 12 }}>{p.manifest.description ?? ""}</span>
                  <span data-plugin-badge style={{ fontSize: 11, padding: "1px 7px", borderRadius: 10, background: p.state === "active" ? "#2d7d46" : p.state === "failed" ? "#7a2e2e" : "#28394e", color: "#fff" }} title={p.error ?? undefined}>
                    {STATE_LABEL[p.state]}
                  </span>
                  {p.error && <span style={{ color: "#f99", fontSize: 12 }}>{p.error}</span>}
                </div>
              ))
            )}
          </div>
        )}
        {tab === "shortcuts" && groups.map((group) => (
          <div key={group}>
            <div style={{ color: "#7d93ad", margin: "10px 0 2px", textTransform: "uppercase", fontSize: 11, letterSpacing: 1 }}>{group}</div>
            {Object.entries(keymap)
              .filter(([, b]) => b.group === group)
              .map(([id, b]) => (
                <div key={id} data-shortcut-row={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                  <span style={{ flex: 1 }}>
                    {b.label}
                    {b.when && <span style={{ color: "#678", marginLeft: 6, fontSize: 12 }}>({b.when})</span>}
                    {b.plugin && <span data-shortcut-plugin={b.plugin} style={{ color: "#7d93ad", marginLeft: 6, fontSize: 11 }} title="contributed by a plugin">⚡ {b.plugin}</span>}
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
