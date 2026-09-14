/**
 * UI slots: the four places a plugin may put an item (the first header
 * row, the second — title, tempo, the player —, the status bar, the
 * battuta menu) and the two panel areas (bottom, side). Plugins hand over
 * a render function; the host owns the React tree. An empty slot renders
 * nothing at all, so a host without plugins has exactly the DOM it had
 * before slots existed.
 *
 * A slot holds two kinds of item. A RUNTIME one (`SlotItem`) carries a
 * render function and exists while its plugin is active. A DECLARED one
 * comes from the manifest, so the host can render it before the plugin's
 * code has loaded — and clicking it runs the plugin's command, which is
 * what activates the plugin. That is how a UI gets its entry point (the
 * 🎹 that opens the on-screen keyboard cannot come from the keyboard's
 * own code). Decided 2026-09-14.
 */
import { Fragment } from "react";
import { toDisposable, type Disposable, type PanelSide, type PanelSpec, type SlotItem, type SlotItemContribution, type SlotName } from "@battuta/api";
import { createStore, useStore } from "./store";

/** A manifest-declared item, with the plugin it came from. */
export interface DeclaredSlotItem extends SlotItemContribution {
  pluginId: string;
}

type AnyItem = (SlotItem & { declared?: undefined }) | (DeclaredSlotItem & { render?: undefined; declared: true });

const byOrder = <T extends { order?: number }>(list: readonly T[]): T[] => [...list].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

const EMPTY: Record<SlotName, readonly AnyItem[]> = { header: [], docHeader: [], statusBar: [], menu: [] };

export class SlotStore {
  readonly items = createStore<Record<SlotName, readonly AnyItem[]>>(EMPTY);

  add(slot: SlotName, item: SlotItem): Disposable {
    const entry = item as AnyItem;
    this.items.update((s) => ({ ...s, [slot]: byOrder([...s[slot].filter((i) => i.id !== item.id), entry]) }));
    return toDisposable(() => this.items.update((s) => ({ ...s, [slot]: s[slot].filter((i) => i !== entry) })));
  }

  /** A declared item: keyed `<pluginId>:<id>` so two plugins may both call theirs "toggle". */
  declare(item: DeclaredSlotItem): Disposable {
    const entry = { ...item, id: `${item.pluginId}:${item.id}`, declared: true } as AnyItem;
    this.items.update((s) => ({ ...s, [item.slot]: byOrder([...s[item.slot].filter((i) => i.id !== entry.id), entry]) }));
    return toDisposable(() => this.items.update((s) => ({ ...s, [item.slot]: s[item.slot].filter((i) => i !== entry) })));
  }
}

export class PanelStore {
  readonly panels = createStore<readonly PanelSpec[]>([]);

  open(panel: PanelSpec): Disposable {
    this.panels.update((p) => [...p.filter((x) => x.id !== panel.id), panel]);
    return toDisposable(() => this.panels.update((p) => p.filter((x) => x !== panel)));
  }
}

export function Slot({ store, name, onCommand }: { store: SlotStore; name: SlotName; onCommand?: (commandId: string) => void }) {
  const items = useStore(store.items)[name];
  if (!items.length) return null;
  return (
    <>
      {items.map((i) =>
        i.declared ? (
          // Declared in a manifest: the host owns this button, and the click
          // is what loads the plugin behind it (runCommand fires onCommand:).
          <button key={i.id} data-slot-item={i.id} data-slot-command={i.command} title={i.title ?? i.label} onClick={() => onCommand?.(i.command)}>
            {i.label}
          </button>
        ) : (
          <Fragment key={i.id}>{i.render()}</Fragment>
        ),
      )}
    </>
  );
}

const BOTTOM: React.CSSProperties = { position: "fixed", left: 0, right: 0, bottom: 24, zIndex: 32, background: "#1f2733", color: "#dde", borderTop: "1px solid #3a4656", maxHeight: "40vh", overflow: "auto" };
const SIDE: React.CSSProperties = { position: "fixed", top: 0, right: 0, bottom: 24, width: 280, zIndex: 32, background: "#fff", borderLeft: "1px solid #e3e7ec", overflow: "auto" };

export function Panels({ store, side }: { store: PanelStore; side: PanelSide }) {
  const panels = useStore(store.panels).filter((p) => p.side === side);
  if (!panels.length) return null;
  return (
    <aside data-panels={side} style={side === "bottom" ? BOTTOM : SIDE}>
      {panels.map((p) => (
        <section key={p.id} data-panel={p.id} aria-label={p.title}>
          {p.render()}
        </section>
      ))}
    </aside>
  );
}
