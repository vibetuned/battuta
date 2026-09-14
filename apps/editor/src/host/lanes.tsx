/**
 * Lanes — the host's half of the `lanes` point (slice 5a, 2026-09-14).
 *
 * A lane is a typed text buffer at the caret that owns the keyboard while
 * it is open. This module is the MECHANISM the editor's two lanes (harmony
 * and lyrics) used to carry in App.tsx as two near-identical modals: one
 * buffer, one key protocol, one floating editor, one status-bar entry, one
 * advance rule over the caret path. What differs between lanes is a
 * `LaneSpec` (packages/api/src/lanes.ts); the host knows nothing about the
 * text — no grammar, no MEI shape, no `HarmKind` — and asks the spec.
 *
 * Two kinds of lane live here. An INTERNAL one is registered by the App
 * itself (the lanes still being extracted) and needs no manifest. A
 * DECLARED one comes from a plugin's manifest (`contributes.lanes`): the
 * status bar lists it before the plugin's code loads, and picking it
 * fires `onLane:<id>` — the plugin activates, registers the spec, and the
 * lane opens. The slot-item lesson, applied: an entry point cannot come
 * from the code it loads.
 *
 * The buffer lives in a store, not a React closure, so the key handler
 * never reads a stale value (App.tsx needed a ref for that: Tab then Enter
 * committed the pre-completion buffer). The buffer reloads from the
 * document whenever the caret or the version moves — the host subscribes
 * to its own editor and document mirrors, so the App has no effect left
 * to write.
 */
import { toDisposable, type CaretPosition, type CommandMessage, type Disposable, type DocumentInfo, type EditorState, type LaneContribution, type LaneSpec, type Store } from "@battuta/api";
import { createStore, useStore, type WritableStore } from "./store";
import { isMod, type KeyEvent, type Modal } from "./actions";

/** A manifest-declared lane, with the plugin it came from. */
export interface DeclaredLane extends LaneContribution {
  pluginId: string;
}

/**
 * What the App binds for the active document: the caret, what sits at a
 * caret position, one step along the caret path, and the two things a
 * lane does to the editor (move the caret, leave entry mode). Null while
 * no document is open — which also closes any open lane.
 */
export interface LaneAdapter {
  caret(): CaretPosition | null;
  /** The event at a position: its id and whether a note-attached lane may hang on it. */
  eventAt(pos: CaretPosition): { id: string; kind: "note" | "rest" | "other" } | null;
  step(pos: CaretPosition, dir: 1 | -1): CaretPosition | null;
  setCaret(pos: CaretPosition): void;
  leaveEntryMode(): void;
}

export interface LaneState {
  id: string;
  spec: LaneSpec;
  buffer: string;
}

/** One row of the status-bar select: internal lanes first, then declared ones. */
export interface LaneOption {
  id: string;
  label: string;
}

export interface LaneDeps {
  /** Commands as data: a spec's commit message runs here (the host's `execute`). */
  execute(message: CommandMessage): void;
  /** A notice for the user; null clears the last one (a successful commit does). */
  notice(text: string | null): void;
  /** Wake the plugin that declared a lane, with `onLane:<id>` as the reason. */
  activate(laneId: string, pluginId: string): Promise<boolean>;
}

export class LaneStore {
  private readonly declared = new Map<string, DeclaredLane>();
  private readonly specs = new Map<string, LaneSpec>();
  /** Ids the host registered itself (no manifest), in order — listed first. */
  private readonly internal: string[] = [];
  private adapter: LaneAdapter | null = null;
  /** The open lane and its buffer; null while none is open. */
  readonly state: WritableStore<LaneState | null> = createStore<LaneState | null>(null);
  /** What the status bar offers: every registered or declared lane, once each. */
  readonly options: WritableStore<readonly LaneOption[]> = createStore<readonly LaneOption[]>([]);

  constructor(private readonly deps: LaneDeps) {}

  /** Reload the buffer whenever the caret or the document version moves. */
  watch(editor: Store<EditorState>, document: Store<DocumentInfo | null>): Disposable {
    const a = editor.subscribe(() => this.reload());
    const b = document.subscribe(() => this.reload());
    return toDisposable(() => {
      a.dispose();
      b.dispose();
    });
  }

  bind(adapter: LaneAdapter | null): void {
    this.adapter = adapter;
    if (!adapter) this.close();
  }

  /** A lane declared in a manifest. Refused when another plugin (or the host) already has the id. */
  declare(lane: DeclaredLane): Disposable {
    const owner = this.declared.get(lane.id)?.pluginId;
    if ((owner !== undefined && owner !== lane.pluginId) || this.internal.includes(lane.id)) throw new Error(`lane ${lane.id} is already declared by ${owner ?? "the host"}`);
    this.declared.set(lane.id, lane);
    this.publishOptions();
    return toDisposable(() => {
      if (this.declared.get(lane.id) !== lane) return;
      this.declared.delete(lane.id);
      if (this.state.get()?.id === lane.id) this.close();
      this.publishOptions();
    });
  }

  /**
   * Register a spec. With `pluginId`, the lane must be one that plugin
   * declared (the registry checks the manifest first; this is the second
   * lock). Without, it is the host's own. Re-registering an id replaces
   * the spec in place — an open lane stays open on the new one.
   */
  register(spec: LaneSpec, pluginId?: string): Disposable {
    if (pluginId !== undefined) {
      if (this.declared.get(spec.id)?.pluginId !== pluginId) throw new Error(`plugin ${pluginId} did not declare lane ${spec.id} in its manifest`);
    } else {
      const owner = this.declared.get(spec.id)?.pluginId;
      if (owner !== undefined) throw new Error(`lane ${spec.id} is already declared by ${owner}`);
      if (!this.internal.includes(spec.id)) this.internal.push(spec.id);
    }
    this.specs.set(spec.id, spec);
    const open = this.state.get();
    if (open?.id === spec.id) this.state.set({ ...open, spec });
    this.publishOptions();
    return toDisposable(() => {
      if (this.specs.get(spec.id) !== spec) return;
      this.specs.delete(spec.id);
      if (pluginId === undefined) {
        const i = this.internal.indexOf(spec.id);
        if (i >= 0) this.internal.splice(i, 1);
      }
      if (this.state.get()?.id === spec.id) this.close();
      this.publishOptions();
    });
  }

  /**
   * Open a lane at the caret. A declared lane whose spec is not registered
   * yet wakes its plugin first (`onLane:<id>`) and opens once the spec is
   * there. True when the lane is known and a document with a caret is
   * open; opening leaves entry mode, as the status-bar select always did.
   */
  open(id: string): boolean {
    const spec = this.specs.get(id);
    if (!spec) {
      const lane = this.declared.get(id);
      if (!lane) return false;
      void this.deps.activate(id, lane.pluginId).then(() => {
        if (this.specs.has(id)) this.open(id);
        else this.deps.notice(`${lane.name}: its plugin registered no lane`);
      });
      return true;
    }
    if (!this.adapter || !this.adapter.caret()) return false;
    this.adapter.leaveEntryMode();
    this.state.set({ id, spec, buffer: "" });
    this.reload();
    if (spec.hint) this.deps.notice(spec.hint);
    return true;
  }

  close(): void {
    this.state.set(null);
  }

  /** Every registered spec, internal first (a test hook and the Plugins tab's). */
  specOf(id: string): LaneSpec | undefined {
    return this.specs.get(id);
  }

  /** The action-table step: owns the keyboard while a lane is open. */
  modalStep(): Modal {
    return { kind: "modal", active: () => this.state.get() !== null, handle: (e) => this.handleKey(e) };
  }

  /** The buffer follows the document: what the spec reads at the caret's event, "" off any event. */
  reload(): void {
    const st = this.state.get();
    if (!st || !this.adapter) return;
    const caret = this.adapter.caret();
    const ev = caret ? this.adapter.eventAt(caret) : null;
    const text = ev ? st.spec.read(ev.id) : "";
    if (text !== st.buffer) this.state.set({ ...st, buffer: text });
  }

  /**
   * Move the caret and reload at once. The App's caret is React state, so
   * its adapter still answers the OLD position until the next render —
   * then the editor mirror publishes and `watch` reloads again; a test's
   * adapter answers synchronously and is right immediately. Either way
   * the buffer ends up as the spec reads it at the new caret.
   */
  private moveTo(pos: CaretPosition): void {
    this.adapter?.setCaret(pos);
    this.reload();
  }

  private setBuffer(buffer: string): void {
    const st = this.state.get();
    if (st) this.state.set({ ...st, buffer });
  }

  /** The next / previous position and event of the lane's kind along the caret path. */
  private neighbour(spec: LaneSpec, from: CaretPosition, dir: 1 | -1): { pos: CaretPosition; id: string | null } | null {
    const a = this.adapter!;
    if (spec.advance === "event") {
      const pos = a.step(from, dir);
      return pos ? { pos, id: a.eventAt(pos)?.id ?? null } : null;
    }
    for (let pos = a.step(from, dir); pos; pos = a.step(pos, dir)) {
      const ev = a.eventAt(pos);
      if (ev?.kind === "note") return { pos, id: ev.id };
    }
    return null;
  }

  /**
   * The protocol. Every key is consumed while a lane is open (the lane
   * owns the keyboard). A commit that fails stops the key where it is.
   */
  handleKey(e: KeyEvent): void {
    e.preventDefault();
    const st = this.state.get();
    const a = this.adapter;
    if (!st || !a) return;
    const { spec, buffer } = st;
    const caret = a.caret();
    if (!caret) {
      if (e.key === "Escape") this.close();
      return;
    }
    const ev = a.eventAt(caret);
    const commit = (key: string): boolean => {
      if (!ev) return false;
      if (spec.attachesTo === "note" && ev.kind !== "note") {
        this.deps.notice(`${spec.name} attach to notes — move the caret to one`);
        return buffer === ""; // an empty buffer may pass a rest by
      }
      if (buffer !== "" && spec.complete && !spec.complete(buffer)) {
        this.deps.notice(`incomplete ${spec.name}: "${buffer}"`);
        return false;
      }
      let result;
      try {
        result = spec.commit({ eventId: ev.id, buffer, key, prevEventId: this.neighbour(spec, caret, -1)?.id ?? null });
      } catch (err) {
        this.deps.notice(`${spec.name} refused: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
      if (result === null) return true; // nothing to write
      if ("refuse" in result) {
        this.deps.notice(result.refuse);
        return false;
      }
      try {
        this.deps.execute(result);
        this.deps.notice(null);
        return true;
      } catch (err) {
        this.deps.notice(`${spec.name} refused: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    };
    if (e.key === "Escape") {
      if (commit(e.key)) this.close();
      return;
    }
    if (spec.advanceOn.includes(e.key)) {
      if (!commit(e.key)) return;
      const next = this.neighbour(spec, caret, 1);
      if (next) this.moveTo(next.pos);
      else this.deps.notice(`last ${spec.advance === "note" ? "note" : "event"} — esc leaves the ${spec.name} lane`);
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      if (!commit(e.key)) return;
      const next = a.step(caret, e.key === "ArrowRight" ? 1 : -1);
      if (next) this.moveTo(next);
      return;
    }
    if (e.key === "Backspace") {
      this.setBuffer(buffer.slice(0, -1));
      return;
    }
    if (e.key === "Tab") {
      const s = spec.suggest?.(buffer)[0];
      if (s) this.setBuffer(s);
      return;
    }
    if (e.key.length === 1 && !isMod(e) && !e.altKey) {
      const ch = spec.transform ? spec.transform(e.key) : e.key;
      if (!spec.accepts || spec.accepts(ch)) this.setBuffer(buffer + ch);
    }
  }

  private publishOptions(): void {
    const seen = new Set<string>();
    const out: LaneOption[] = [];
    for (const id of this.internal) {
      const s = this.specs.get(id);
      if (s && !seen.has(id)) {
        seen.add(id);
        out.push({ id, label: s.label });
      }
    }
    for (const d of this.declared.values()) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push({ id: d.id, label: this.specs.get(d.id)?.label ?? d.label });
    }
    this.options.set(out);
  }
}

/** The lane's face while it is open — for the status-bar select's placeholder. */
export const laneFace = (spec: LaneSpec): string => (spec.glyph ? `${spec.glyph} ${spec.name}` : spec.name);

/**
 * The floating editor: the buffer at the caret, above or below the staff
 * as the lane says, coloured by completeness, with the lane's suggestions
 * beside it. Keeps the `data-harm-input` / `data-valid` hooks the e2e
 * scripts read (the two lanes always shared this one box).
 */
export function LaneInput({ store, caretRect }: { store: LaneStore; caretRect: { left: number; top: number; height: number } | null }) {
  const st = useStore(store.state);
  if (!st || !caretRect) return null;
  const { spec, buffer } = st;
  const valid = buffer === "" || !spec.complete || spec.complete(buffer);
  const suggestions = spec.suggest?.(buffer) ?? [];
  return (
    <div
      data-harm-input
      data-lane={spec.id}
      data-valid={valid ? "1" : "0"}
      style={{
        position: "absolute",
        left: caretRect.left,
        top: spec.place === "below" ? caretRect.top + caretRect.height + 6 : caretRect.top - 30,
        background: "#233",
        borderRadius: 4,
        fontSize: 13,
        zIndex: 40,
        padding: "2px 8px",
        whiteSpace: "nowrap",
        boxShadow: "0 2px 8px rgba(0,0,0,.35)",
        color: valid ? "#8f8" : "#f88",
      }}
    >
      {spec.glyph ? `${spec.glyph} ` : ""}
      <strong>{buffer || "…"}</strong>
      {suggestions.length > 0 && <span style={{ color: "#89a", marginLeft: 8 }}>{suggestions.join("  ")}</span>}
    </div>
  );
}
