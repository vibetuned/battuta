/**
 * About battuta: what it is, whose work it stands on, and every notice the
 * application ships with (phase 10, M4). Verovio's licence asks for its
 * credit in the stores' listings and in the app — this is the app's. The
 * notices are generated (scripts/licences.mjs → licences.json) from what
 * the build bundles and what the shell links, and are loaded only when
 * this box opens.
 *
 * Addresses are text, never links: in the shell a link would navigate the
 * application's own window away.
 */
import { useEffect, useMemo, useState } from "react";
import pkg from "../package.json?raw";

interface Component {
  name: string;
  version: string;
  licence: string;
  source?: string;
  kind: "npm" | "crate" | "asset";
  texts: string[];
}
interface Notices {
  battuta: { licence: string; text: string };
  components: Component[];
  texts: Record<string, string>;
}

const VERSION = (JSON.parse(pkg) as { version: string }).version;
const SOURCE = "https://github.com/vibetuned/battuta";

const pre: React.CSSProperties = { whiteSpace: "pre-wrap", fontSize: 11, lineHeight: 1.45, background: "#141c26", color: "#bcc6d2", padding: 10, borderRadius: 4, maxHeight: 320, overflow: "auto", margin: "6px 0 10px" };
const address: React.CSSProperties = { color: "#9cc4f0", userSelect: "text", WebkitUserSelect: "text", wordBreak: "break-all" };

function Texts({ ids, notices }: { ids: string[]; notices: Notices }) {
  return (
    <>
      {ids.map((id) => (
        <pre key={id} style={pre}>
          {notices.texts[id]}
        </pre>
      ))}
    </>
  );
}

export function About({ onClose }: { onClose: () => void }) {
  const [notices, setNotices] = useState<Notices | null>(null);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    let live = true;
    void import("./licences.json?raw").then((m) => live && setNotices(JSON.parse(m.default) as Notices));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const verovio = notices?.components.find((c) => c.name === "verovio");
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (notices?.components ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || c.licence.toLowerCase().includes(q));
  }, [notices, filter]);

  return (
    <div data-about style={{ position: "fixed", inset: 0, background: "rgba(10,16,24,.55)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div
        style={{ background: "#1d2733", color: "#dde", borderRadius: 8, padding: "14px 18px", width: 640, maxWidth: "calc(100vw - 24px)", boxSizing: "border-box", maxHeight: "82vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,.5)", fontSize: 13, lineHeight: 1.5 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <strong style={{ fontSize: 16 }}>battuta {VERSION}</strong>
          <span style={{ flex: 1 }} />
          <button data-about-close onClick={onClose} style={{ fontSize: 12 }}>
            close
          </button>
        </div>
        <p style={{ margin: "8px 0" }}>
          A music notation editor made in the open by Vibetuned, a non-profit for music and arts education. Free software under the GNU Affero General Public License v3; the
          source is at <span style={address}>{SOURCE}</span>.
        </p>

        <h3 style={{ fontSize: 13, margin: "14px 0 4px", color: "#fff" }}>Music notation is engraved by Verovio</h3>
        <p data-about-verovio style={{ margin: "4px 0" }}>
          Verovio{verovio ? ` ${verovio.version}` : ""} (verovio.org), © RISM Digital Center, used under the GNU Lesser General Public License v3, unmodified — it runs as
          WebAssembly inside battuta. Its source is at <span style={address}>https://github.com/rism-digital/verovio</span>.
        </p>
        {verovio && (
          <details>
            <summary style={{ cursor: "pointer", color: "#9ab" }}>the GNU LGPL v3 and the GNU GPL v3 it builds on</summary>
            <Texts ids={verovio.texts} notices={notices!} />
          </details>
        )}
        <p style={{ margin: "10px 0 4px" }}>
          Piano samples from the Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0). PDF display by pdf.js (Mozilla, Apache License 2.0). Music symbols in the
          interface from Noto Music (SIL Open Font License 1.1). Playback by Tone.js; the interface by React; the application shell by Tauri.
        </p>

        <h3 style={{ fontSize: 13, margin: "16px 0 4px", color: "#fff" }}>Every component and its licence</h3>
        {!notices ? (
          <p style={{ color: "#89a" }}>loading the notices…</p>
        ) : (
          <>
            <p style={{ margin: "4px 0 8px", color: "#9ab", fontSize: 12 }}>
              {notices.components.length} components: the libraries in the interface, the crates in the application shell, and the assets above. Tap one for its licence text.
            </p>
            <input
              data-about-filter
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter by name or licence"
              style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "4px 8px", marginBottom: 6, background: "#141c26", color: "#dde", border: "1px solid #3a4656", borderRadius: 4 }}
            />
            {shown.map((c) => (
              <details key={`${c.name}@${c.version}`} data-about-component={c.name}>
                <summary style={{ cursor: "pointer", padding: "2px 0" }}>
                  {c.name} <span style={{ color: "#89a" }}>{c.version}</span> — {c.licence}
                </summary>
                {c.source && (
                  <div style={{ fontSize: 12, margin: "2px 0 0 14px" }}>
                    source: <span style={address}>{c.source}</span>
                  </div>
                )}
                {c.texts.length ? <Texts ids={c.texts} notices={notices} /> : <p style={{ fontSize: 12, color: "#89a", margin: "2px 0 8px 14px" }}>The package names its licence ({c.licence}) without a copy of the text; the text is at its source.</p>}
              </details>
            ))}
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", color: "#9ab" }}>battuta's own licence, the GNU Affero General Public License v3</summary>
              <Texts ids={[notices.battuta.text]} notices={notices} />
            </details>
          </>
        )}
      </div>
    </div>
  );
}
