/**
 * UI slots: the three places a plugin may put an item (header row,
 * status bar, battuta menu) and the two panel areas (bottom, side).
 * Plugins hand over a render function; the host owns the React tree.
 * An empty slot renders nothing at all, so a host without plugins has
 * exactly the DOM it had before slots existed.
 */
import { Fragment } from "react";
import { toDisposable, type Disposable, type PanelSide, type PanelSpec, type SlotItem, type SlotName } from "@battuta/api";
import { createStore, useStore } from "./store";

const byOrder = (list: readonly SlotItem[]): SlotItem[] => [...list].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

export class SlotStore {
  readonly items = createStore<Record<SlotName, readonly SlotItem[]>>({ header: [], statusBar: [], menu: [] });

  add(slot: SlotName, item: SlotItem): Disposable {
    this.items.update((s) => ({ ...s, [slot]: byOrder([...s[slot].filter((i) => i.id !== item.id), item]) }));
    return toDisposable(() => this.items.update((s) => ({ ...s, [slot]: s[slot].filter((i) => i !== item) })));
  }
}

export class PanelStore {
  readonly panels = createStore<readonly PanelSpec[]>([]);

  open(panel: PanelSpec): Disposable {
    this.panels.update((p) => [...p.filter((x) => x.id !== panel.id), panel]);
    return toDisposable(() => this.panels.update((p) => p.filter((x) => x !== panel)));
  }
}

export function Slot({ store, name }: { store: SlotStore; name: SlotName }) {
  const items = useStore(store.items)[name];
  if (!items.length) return null;
  return (
    <>
      {items.map((i) => (
        <Fragment key={i.id}>{i.render()}</Fragment>
      ))}
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
