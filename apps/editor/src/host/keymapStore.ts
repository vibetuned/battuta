/**
 * The keymap as a reactive store: the core map (defaults + the user's
 * overrides for the layout) ∪ every enabled plugin's contributed
 * bindings. The shortcut editor and the on-screen keyboard render from
 * this, so a binding a plugin contributes — or withdraws when turned off
 * — appears and disappears live. Overrides for a contributed binding
 * live in the same per-layout override blob as core ones, keyed by the
 * command id, and are NOT removed when the plugin is disabled: turning
 * it back on restores the user's rebind.
 */
import { toDisposable, type Disposable, type KeybindingContribution, type Store } from "@battuta/api";
import { loadKeymap, readKeymapOverrides, saveKeymapOverride, clearKeymapOverrides, type KeyBinding, type Keymap, type Layout } from "../keymap";

export class KeymapStore implements Store<Keymap> {
  private layout: Layout;
  private readonly contributions = new Map<string, KeybindingContribution[]>();
  private merged: Keymap;
  private readonly listeners = new Set<(k: Keymap) => void>();

  constructor(layout: Layout) {
    this.layout = layout;
    this.merged = this.build();
  }

  /** Arrow properties: safe to pass detached (React's useSyncExternalStore does). */
  readonly get = (): Keymap => this.merged;

  readonly subscribe = (listener: (k: Keymap) => void): Disposable => {
    this.listeners.add(listener);
    return toDisposable(() => this.listeners.delete(listener));
  };

  getLayout(): Layout {
    return this.layout;
  }

  setLayout(layout: Layout): void {
    if (layout === this.layout) return;
    this.layout = layout;
    this.rebuild();
  }

  /** Persist a rebind for the current layout (core or contributed action) and republish. */
  rebind(id: string, binding: Pick<KeyBinding, "keys" | "shift" | "alt">): void {
    saveKeymapOverride(this.layout, id, binding);
    this.rebuild();
  }

  /** Drop every override of the current layout (core and contributed). */
  resetOverrides(): void {
    clearKeymapOverrides(this.layout);
    this.rebuild();
  }

  /** Add a plugin's bindings; disposing withdraws them. Core action ids always win a collision. */
  contribute(pluginId: string, bindings: KeybindingContribution[]): Disposable {
    this.contributions.set(pluginId, bindings);
    this.rebuild();
    return toDisposable(() => {
      if (this.contributions.get(pluginId) !== bindings) return;
      this.contributions.delete(pluginId);
      this.rebuild();
    });
  }

  private build(): Keymap {
    const map = loadKeymap(this.layout);
    const overrides = readKeymapOverrides(this.layout);
    for (const [pluginId, list] of this.contributions) {
      for (const c of list) {
        if (c.command in map) continue; // a core id: never shadowed by a plugin
        const perLayout = c.layouts?.[this.layout];
        const b: KeyBinding = { keys: [...(perLayout?.keys ?? c.keys)], label: c.label, group: c.group, plugin: pluginId };
        const shift = perLayout?.shift ?? c.shift;
        if (shift !== undefined) b.shift = shift;
        if (c.alt !== undefined) b.alt = c.alt;
        if (c.when !== undefined) b.when = c.when;
        const o = overrides[c.command];
        if (o && Array.isArray(o.keys)) {
          b.keys = [...o.keys];
          b.shift = o.shift;
          b.alt = o.alt;
        }
        map[c.command] = b;
      }
    }
    return map;
  }

  private rebuild(): void {
    this.merged = this.build();
    for (const l of [...this.listeners]) l(this.merged);
  }
}
