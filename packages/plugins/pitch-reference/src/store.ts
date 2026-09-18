/**
 * The two store helpers every panel plugin in this repository carries: a
 * host-store-shaped holder for the state the plugin owns, and React over a
 * host store, so a panel and an overlay subscribe IN PLACE rather than
 * being re-opened with new props (a panel spec's `render()` runs on every
 * re-render of the host's area; remounting would lose the strip's state).
 */
import { useSyncExternalStore } from "react";
import { toDisposable, type Store } from "@battuta/api";

export interface Signal<T> extends Store<T> {
  set(value: T): void;
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const listeners = new Set<(v: T) => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of [...listeners]) l(value);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return toDisposable(() => listeners.delete(listener));
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(
    (onChange) => {
      const d = store.subscribe(onChange);
      return () => d.dispose();
    },
    () => store.get(),
    () => store.get(),
  );
}
