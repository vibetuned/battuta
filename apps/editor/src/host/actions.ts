/**
 * The action table: the host's key dispatcher as data.
 *
 * The App installs an ORDERED list of steps — the same order its old
 * if-chain had, because that order is behaviour: a key may match several
 * rules (plain "p" is a hairpin over a run and a dynamic on one note) and
 * the first whose state condition holds wins.
 *
 *   rule   { id, key, when, run, preventDefault }
 *          `key` is an EVENT-only predicate (key, code, modifiers);
 *          `when` is a STATE-only predicate. Keeping them apart is what
 *          lets run(id) skip the key and keep the state.
 *   gate   { when }   — consumes every key while `when` holds (no caret).
 *   modal  { active, handle }   — text input owns the keyboard (a lane,
 *          the accidental picker); `handle` gets the raw event.
 *
 * `dispatchKey(e)` walks the steps for a physical press. `run(id)` walks
 * the same steps for an id: gates and active modals stop it exactly where
 * they would have stopped the key, rules with another id are skipped, and
 * the first rule with this id whose `when` holds runs. Then the plugins'
 * bindings (the registry's `dispatchKey`) are the last resort for a key,
 * as before.
 *
 * A rule's body returns an outcome: "handled" (preventDefault if the rule
 * asks), "declined" (the key is consumed but the browser default is left
 * alone — the old `if (!target) return;`), or "fallthrough" (the next step
 * gets a look — the old inner `if` without an else-return).
 */
export type Outcome = "handled" | "declined" | "fallthrough";

export interface KeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  preventDefault(): void;
}

export interface ActionRule {
  kind: "rule";
  id: string;
  /** Event-only: does this press select the rule? */
  key: (e: KeyEvent) => boolean;
  /** State-only: may it run now? Absent = always. */
  when?: () => boolean;
  run: () => Outcome;
  /** preventDefault on "handled". */
  preventDefault: boolean;
}

export interface Gate {
  kind: "gate";
  /** While true, every key (and every run) below this point is consumed. */
  when: () => boolean;
}

export interface Modal {
  kind: "modal";
  active: () => boolean;
  handle: (e: KeyEvent) => void;
}

export type ActionStep = ActionRule | Gate | Modal;

/** Sugar for App.tsx: a rule whose key part is a predicate and whose body returns an outcome. */
export const rule = (id: string, key: (e: KeyEvent) => boolean, run: () => Outcome, options: { when?: () => boolean; preventDefault?: boolean } = {}): ActionRule => ({
  kind: "rule",
  id,
  key,
  ...(options.when ? { when: options.when } : {}),
  run,
  preventDefault: options.preventDefault ?? true,
});
export const gate = (when: () => boolean): Gate => ({ kind: "gate", when });
export const modal = (active: () => boolean, handle: (e: KeyEvent) => void): Modal => ({ kind: "modal", active, handle });

export const isMod = (e: KeyEvent): boolean => e.ctrlKey || e.metaKey;

export class ActionTable {
  private steps: readonly ActionStep[] = [];
  /** Plugin bindings — the last resort for a key that no core rule took. */
  private pluginDispatch: (e: KeyEvent) => boolean = () => false;

  install(steps: readonly ActionStep[], pluginDispatch: (e: KeyEvent) => boolean): void {
    this.steps = steps;
    this.pluginDispatch = pluginDispatch;
  }

  /** Every rule id, in dispatch order, once. */
  ids(): readonly string[] {
    const seen = new Set<string>();
    for (const s of this.steps) if (s.kind === "rule") seen.add(s.id);
    return [...seen];
  }

  has(id: string): boolean {
    return this.steps.some((s) => s.kind === "rule" && s.id === id);
  }

  /** A physical press: the steps in order, then the plugins. True when something took the key. */
  dispatchKey(e: KeyEvent): boolean {
    for (const step of this.steps) {
      if (step.kind === "gate") {
        if (step.when()) return true;
        continue;
      }
      if (step.kind === "modal") {
        if (step.active()) {
          step.handle(e);
          return true;
        }
        continue;
      }
      if (!step.key(e)) continue;
      if (step.when && !step.when()) continue;
      const outcome = step.run();
      if (outcome === "fallthrough") continue;
      if (outcome === "handled" && step.preventDefault) e.preventDefault();
      return true;
    }
    if (!isMod(e) && this.pluginDispatch(e)) {
      e.preventDefault();
      return true;
    }
    return false;
  }

  /** An action by id: the same walk, without a key. True when a rule with this id ran. */
  run(id: string): boolean {
    for (const step of this.steps) {
      if (step.kind === "gate") {
        if (step.when()) return false;
        continue;
      }
      if (step.kind === "modal") {
        if (step.active()) return false;
        continue;
      }
      if (step.id !== id) continue;
      if (step.when && !step.when()) continue;
      const outcome = step.run();
      if (outcome === "fallthrough") continue;
      return outcome === "handled";
    }
    return false;
  }
}
