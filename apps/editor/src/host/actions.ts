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
 * the first rule with this id whose `when` holds runs. The plugins are the
 * last resort on both paths: a key that no core rule took goes to the
 * plugins' bindings (the registry's `dispatchKey`), and an id no core rule
 * has goes to the plugins' commands (the registry's `runCommand`) — after
 * the same gates and modals, so a plugin's action is reachable exactly
 * when its key would have been.
 *
 * A rule's body returns an outcome: "handled" (preventDefault if the rule
 * asks), "declined" (the key is consumed but the browser default is left
 * alone — the old `if (!target) return;`), or "fallthrough" (the next step
 * gets a look — the old inner `if` without an else-return).
 */
import { createStore, type WritableStore } from "./store";

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

export interface PluginFallback {
  /** A key no core rule took: the plugins' bindings. */
  key(e: KeyEvent): boolean;
  /** An id no core rule has: the plugins' commands. True when a plugin owns it. */
  run(id: string): boolean;
}

export class ActionTable {
  private steps: readonly ActionStep[] = [];
  /** The rule ids of the installed steps, in dispatch order, once — republished on every install. */
  readonly ruleIds: WritableStore<readonly string[]> = createStore<readonly string[]>([]);

  constructor(private readonly plugins: PluginFallback = { key: () => false, run: () => false }) {}

  install(steps: readonly ActionStep[]): void {
    this.steps = steps;
    const seen = new Set<string>();
    for (const s of steps) if (s.kind === "rule") seen.add(s.id);
    this.ruleIds.set([...seen]);
  }

  /** Every core rule id, in dispatch order, once (the plugins' commands are the registry's). */
  ids(): readonly string[] {
    return this.ruleIds.get();
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
    if (!isMod(e) && this.plugins.key(e)) {
      e.preventDefault();
      return true;
    }
    return false;
  }

  /**
   * An action by id: the same walk, without a key. True when a rule with
   * this id ran — or, for an id no core rule has, when a plugin owns the
   * command (it runs through the registry, past the same gates).
   */
  run(id: string): boolean {
    let known = false;
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
      known = true;
      if (step.when && !step.when()) continue;
      const outcome = step.run();
      if (outcome === "fallthrough") continue;
      return outcome === "handled";
    }
    return known ? false : this.plugins.run(id);
  }
}
