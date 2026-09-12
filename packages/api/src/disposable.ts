/**
 * Lifecycle plumbing. Everything a plugin registers returns a Disposable;
 * the host collects them per plugin and disposes the lot on deactivate,
 * so "off" is complete by construction rather than by discipline.
 */
export interface Disposable {
  dispose(): void;
}

export const toDisposable = (fn: () => void): Disposable => {
  let done = false;
  return {
    dispose() {
      if (done) return;
      done = true;
      fn();
    },
  };
};

export class DisposableStore implements Disposable {
  private readonly items = new Set<Disposable>();
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Adds and returns the same disposable (so `const d = store.add(x)` reads well). */
  add<T extends Disposable>(d: T): T {
    if (this.disposed) d.dispose();
    else this.items.add(d);
    return d;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Reverse registration order: later registrations may depend on earlier ones.
    for (const d of [...this.items].reverse()) d.dispose();
    this.items.clear();
  }
}
