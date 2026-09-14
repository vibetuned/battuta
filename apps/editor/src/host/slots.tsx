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
import { toDisposable, type Disposable, type PanelSide, type PanelSpec, type SlotItem, type SlotItemContribution, type SlotName, type Store } from "@battuta/api";
import { createStore, useStore } from "./store";
import type { PluginInfo } from "./registry";

/** A manifest-declared item, with the plugin it came from. */
export interface DeclaredSlotItem extends SlotItemContribution {
  pluginId: string;
}

type AnyItem = (SlotItem & { declared?: undefined }) | (DeclaredSlotItem & { render?: undefined; declared: true });

const byOrder = <T extends { order?: number }>(list: readonly T[]): T[] => [...list].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

const SLOTS: readonly SlotName[] = ["header", "docHeader", "statusBar", "menu"];

/**
 * Per slot, two maps keyed by item key (`<pluginId>:<id>` for anything a
 * plugin adds or declares; a bare id for the host's own runtime items). The
 * visible list is their union with a RUNTIME item winning over a DECLARED
 * one of the same key: a plugin's declared entry point is its static face
 * until the plugin is active, then the plugin may add a live item under
 * the same id and the face follows its state; dispose it (deactivate) and
 * the declared face is back.
 */
export class SlotStore {
  private readonly declared = new Map<SlotName, Map<string, AnyItem>>(SLOTS.map((s) => [s, new Map()]));
  private readonly runtime = new Map<SlotName, Map<string, AnyItem>>(SLOTS.map((s) => [s, new Map()]));
  readonly items = createStore<Record<SlotName, readonly AnyItem[]>>({ header: [], docHeader: [], statusBar: [], menu: [] });

  /** A runtime item. With `pluginId`, keyed like a declared one so it can replace the plugin's declared face. */
  add(slot: SlotName, item: SlotItem, pluginId?: string): Disposable {
    const key = pluginId ? `${pluginId}:${item.id}` : item.id;
    const entry = { ...item, id: key } as AnyItem;
    this.runtime.get(slot)!.set(key, entry);
    this.publish(slot);
    return toDisposable(() => {
      if (this.runtime.get(slot)!.get(key) === entry) {
        this.runtime.get(slot)!.delete(key);
        this.publish(slot);
      }
    });
  }

  /** A declared item: keyed `<pluginId>:<id>` so two plugins may both call theirs "toggle". */
  declare(item: DeclaredSlotItem): Disposable {
    const key = `${item.pluginId}:${item.id}`;
    const entry = { ...item, id: key, declared: true } as AnyItem;
    this.declared.get(item.slot)!.set(key, entry);
    this.publish(item.slot);
    return toDisposable(() => {
      if (this.declared.get(item.slot)!.get(key) === entry) {
        this.declared.get(item.slot)!.delete(key);
        this.publish(item.slot);
      }
    });
  }

  private publish(slot: SlotName): void {
    const merged = new Map<string, AnyItem>(this.declared.get(slot)!);
    for (const [key, item] of this.runtime.get(slot)!) merged.set(key, item);
    this.items.update((s) => ({ ...s, [slot]: byOrder([...merged.values()]) }));
  }
}

export class PanelStore {
  readonly panels = createStore<readonly PanelSpec[]>([]);

  open(panel: PanelSpec): Disposable {
    this.panels.update((p) => [...p.filter((x) => x.id !== panel.id), panel]);
    return toDisposable(() => this.panels.update((p) => p.filter((x) => x !== panel)));
  }
}

/** No registry passed (tests, a host without plugins): nothing is active. */
const NO_PLUGINS: Store<readonly PluginInfo[]> = createStore<readonly PluginInfo[]>([]);

/** What a `dimUntilActive` face looks like while the plugin behind it is not running. */
const IDLE: React.CSSProperties = { opacity: 0.45 };

/**
 * Is this declared face drawn de-emphasised? Only when the item ASKED
 * (`dimUntilActive`) and its plugin has not started: an entry point that
 * opens something is then telling the truth about what it opens. Never for
 * declared items in general — a menu entry is not disabled while its
 * plugin waits to be loaded.
 */
export const dimsDeclared = (item: { dimUntilActive?: boolean; pluginId: string }, plugins: readonly PluginInfo[]): boolean =>
  Boolean(item.dimUntilActive) && !plugins.some((p) => p.id === item.pluginId && p.state === "active");

export function Slot({ store, name, onCommand, plugins }: { store: SlotStore; name: SlotName; onCommand?: (commandId: string) => void; plugins?: Store<readonly PluginInfo[]> }) {
  const items = useStore(store.items)[name];
  const registered = useStore(plugins ?? NO_PLUGINS);
  if (!items.length) return null;
  return (
    <>
      {items.map((i) =>
        i.declared ? (
          // Declared in a manifest: the host owns this button, and the click
          // is what loads the plugin behind it (runCommand fires onCommand:).
          // An item that ASKED to be dimmed until its plugin is active is
          // drawn de-emphasised meanwhile — an entry point that opens
          // something is telling the truth about what it opens, and the
          // plugin's own runtime item takes the face over the moment it
          // runs. Per item, never for every declared face: a declared menu
          // entry is not disabled while its plugin waits to be loaded.
          <button
            key={i.id}
            data-slot-item={i.id}
            data-slot-command={i.command}
            title={i.title ?? i.label}
            onClick={() => onCommand?.(i.command)}
            style={dimsDeclared(i, registered) ? IDLE : undefined}
          >
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
