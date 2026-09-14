/**
 * The one reactive primitive the host uses: a value with subscribe. The
 * keymap, the slots, the registry and the document/editor mirrors are
 * all stores, so a panel activated late sees bindings registered later
 * still, and plugins subscribe without prop-drilling.
 */
import { useSyncExternalStore } from "react";
import { toDisposable, type Disposable, type Store } from "@battuta/api";

export interface WritableStore<T> extends Store<T> {
  set(value: T): void;
  update(fn: (value: T) => T): void;
}

export function createStore<T>(initial: T): WritableStore<T> {
  let value = initial;
  const listeners = new Set<(v: T) => void>();
  const set = (next: T) => {
    if (Object.is(next, value)) return;
    value = next;
    for (const l of [...listeners]) l(value);
  };
  return {
    get: () => value,
    set,
    update: (fn) => set(fn(value)),
    subscribe: (listener) => {
      listeners.add(listener);
      return toDisposable(() => listeners.delete(listener));
    },
  };
}

/** A read-only store computed from another; recomputes on each publication of the source. */
export function mapStore<A, B>(source: Store<A>, fn: (a: A) => B): Store<B> {
  let cachedFor: A | undefined;
  let cached: B | undefined;
  const get = (): B => {
    const a = source.get();
    if (cached === undefined || !Object.is(a, cachedFor)) {
      cachedFor = a;
      cached = fn(a);
    }
    return cached;
  };
  return {
    get,
    subscribe: (listener) => source.subscribe(() => listener(get())),
  };
}

/** React binding: re-renders on change; the store's get() is the snapshot. */
export function useStore<T>(store: Store<T>): T {
  // Class-based stores (KeymapStore, PluginRegistry) need their methods
  // called AS methods: never hand React a bare `store.get` reference.
  return useSyncExternalStore(
    (onChange) => {
      const d = store.subscribe(onChange);
      return () => d.dispose();
    },
    () => store.get(),
    () => store.get(),
  );
}
