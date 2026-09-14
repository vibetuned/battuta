/**
 * The action table's guarantees: order, fall-through, gates and modals
 * behave for run(id) exactly as for a key; run(id) never bypasses a state
 * condition; preventDefault only on "handled"; the plugins are the last
 * resort for a key and never for run(id).
 */
import { describe, it, expect, vi } from "vitest";
import { ActionTable, rule, gate, modal, type KeyEvent } from "../src/host/actions";

const press = (key: string, mods: Partial<KeyEvent> = {}): KeyEvent & { prevented: boolean } => {
  const e = { key, code: mods.code ?? "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, prevented: false, ...mods, preventDefault() { e.prevented = true; } } as KeyEvent & { prevented: boolean };
  return e;
};

describe("ActionTable", () => {
  it("runs the first rule whose key AND state match; a later rule with the same key waits its turn", () => {
    const log: string[] = [];
    let selected = 2;
    const t = new ActionTable();
    t.install(
      [
        rule("dynamics", (e) => e.key === "p", () => (log.push("hairpin"), "handled"), { when: () => selected >= 2 }),
        rule("dynamics", (e) => e.key === "p", () => (log.push("cycle"), "handled")),
      ],
      () => false,
    );
    expect(t.dispatchKey(press("p"))).toBe(true);
    selected = 1;
    t.dispatchKey(press("p"));
    expect(log).toEqual(["hairpin", "cycle"]);
    // run(id) takes the same fork
    selected = 2;
    expect(t.run("dynamics")).toBe(true);
    expect(log.at(-1)).toBe("hairpin");
  });

  it("fallthrough continues to the next step; declined consumes without preventDefault; handled prevents", () => {
    const log: string[] = [];
    const t = new ActionTable();
    t.install(
      [
        rule("merge", (e) => e.key === "m", () => (log.push("grace?"), "fallthrough")),
        rule("merge", (e) => e.key === "m", () => (log.push("merge"), "handled")),
        rule("dot", (e) => e.key === ".", () => "declined"),
        rule("esc", (e) => e.key === "Escape", () => "handled", { preventDefault: false }),
      ],
      () => false,
    );
    const m = press("m");
    expect(t.dispatchKey(m)).toBe(true);
    expect(log).toEqual(["grace?", "merge"]);
    expect(m.prevented).toBe(true);
    const dot = press(".");
    expect(t.dispatchKey(dot)).toBe(true);
    expect(dot.prevented).toBe(false);
    const esc = press("Escape");
    expect(t.dispatchKey(esc)).toBe(true);
    expect(esc.prevented).toBe(false);
    expect(t.run("merge")).toBe(true);
    expect(t.run("dot")).toBe(false); // declined = did not run
  });

  it("a gate consumes every key and every run below it while it holds", () => {
    let caret = false;
    const ran = vi.fn(() => "handled" as const);
    const t = new ActionTable();
    t.install([rule("undo", (e) => e.key === "z", ran), gate(() => !caret), rule("tie", (e) => e.key === "t", ran)], () => false);
    expect(t.dispatchKey(press("t"))).toBe(true); // consumed by the gate
    expect(t.run("tie")).toBe(false);
    expect(ran).not.toHaveBeenCalled();
    expect(t.run("undo")).toBe(true); // above the gate
    caret = true;
    expect(t.run("tie")).toBe(true);
    expect(t.dispatchKey(press("t"))).toBe(true);
    expect(ran).toHaveBeenCalledTimes(3);
  });

  it("an active modal gets the raw key and blocks run(id); an inactive one is transparent", () => {
    let lane = true;
    const typed: string[] = [];
    const t = new ActionTable();
    t.install([modal(() => lane, (e) => typed.push(e.key)), rule("tie", (e) => e.key === "t", () => "handled")], () => false);
    expect(t.dispatchKey(press("t"))).toBe(true);
    expect(typed).toEqual(["t"]);
    expect(t.run("tie")).toBe(false);
    lane = false;
    expect(t.run("tie")).toBe(true);
    expect(typed).toEqual(["t"]);
  });

  it("the plugins are the last resort for a KEY (never with ctrl), and never for run(id)", () => {
    const plugins = vi.fn((e: KeyEvent) => e.key === "R");
    const t = new ActionTable();
    t.install([rule("tie", (e) => e.key === "t", () => "handled")], plugins);
    const r = press("R", { shiftKey: true });
    expect(t.dispatchKey(r)).toBe(true);
    expect(r.prevented).toBe(true);
    expect(t.dispatchKey(press("R", { shiftKey: true, ctrlKey: true }))).toBe(false);
    expect(plugins).toHaveBeenCalledTimes(1);
    expect(t.dispatchKey(press("q"))).toBe(false);
    expect(t.run("battuta.reflection.cycle")).toBe(false); // plugin commands run through the registry, not here
  });

  it("ids() lists every rule id once, in order; has() answers for one; unknown ids do nothing", () => {
    const t = new ActionTable();
    t.install(
      [
        rule("undo", () => false, () => "handled"),
        gate(() => false),
        rule("tie", () => false, () => "handled"),
        rule("tie", () => false, () => "handled"),
        modal(() => false, () => undefined),
        rule("nav.left", () => false, () => "handled"),
      ],
      () => false,
    );
    expect(t.ids()).toEqual(["undo", "tie", "nav.left"]);
    expect(t.has("tie")).toBe(true);
    expect(t.has("press")).toBe(false);
    expect(t.run("press")).toBe(false);
  });
});
