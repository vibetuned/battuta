import { describe, it, expect } from "vitest";
import {
  buildEventIndex, serialize, CommandStack,
  TransposeStepCommand, TransposeOctaveCommand, ToggleAccidentalCommand, DeleteToRestsCommand,
  type CommandContext,
} from "../src/index.js";
import { scoreFrom, mei } from "./helpers.js";

const BODY = `
  <measure n="1" xml:id="m1">
    <staff n="1"><layer n="1"><note pname="b" oct="4" dur="2" xml:id="n1" accid="f"/><note pname="c" oct="4" dur="2" xml:id="n2"/></layer></staff>
    <staff n="2"><layer n="1"><chord dur="1" xml:id="ch1"><note pname="c" oct="3" xml:id="ch1a"/><note pname="e" oct="3" xml:id="ch1b"/></chord></layer></staff>
  </measure>`;

function setup() {
  const { score } = scoreFrom(mei(BODY));
  const ctx: CommandContext = { score, index: buildEventIndex(score) };
  const snapshot = () => score.measures.map((m) => serialize(m)).join("\n");
  return { score, ctx, snapshot };
}

const noteAttrs = (ctx: CommandContext, id: string) => {
  const measure = ctx.score.measures[0]!;
  const find = (el: typeof measure): typeof measure | null => {
    for (const c of el.children) {
      if (typeof c === "string") continue;
      if (c.attrs["xml:id"] === id) return c;
      const hit = find(c);
      if (hit) return hit;
    }
    return null;
  };
  return find(measure)?.attrs;
};

describe("TransposeStepCommand", () => {
  it("carries the octave across the b/c boundary in both directions", () => {
    const { ctx } = setup();
    new TransposeStepCommand(["n1"], 1).apply(ctx); // b4 -> c5
    expect(noteAttrs(ctx, "n1")).toMatchObject({ pname: "c", oct: "5" });
    new TransposeStepCommand(["n2"], -1).apply(ctx); // c4 -> b3
    expect(noteAttrs(ctx, "n2")).toMatchObject({ pname: "b", oct: "3" });
  });

  it("drops explicit accidentals on step moves and restores them on revert", () => {
    const { ctx, snapshot } = setup();
    const before = snapshot();
    const cmd = new TransposeStepCommand(["n1"], 2);
    cmd.apply(ctx);
    expect(noteAttrs(ctx, "n1")!["accid"]).toBeUndefined();
    cmd.revert(ctx);
    expect(snapshot()).toBe(before);
  });

  it("transposes every note of a chord addressed by the chord id", () => {
    const { ctx } = setup();
    new TransposeStepCommand(["ch1"], 1).apply(ctx);
    expect(noteAttrs(ctx, "ch1a")).toMatchObject({ pname: "d", oct: "3" });
    expect(noteAttrs(ctx, "ch1b")).toMatchObject({ pname: "f", oct: "3" });
  });

  it("reports the touched measure×staff as dirty", () => {
    const { ctx } = setup();
    const dirty = new TransposeStepCommand(["n1", "ch1"], 1).apply(ctx);
    expect(dirty).toEqual([
      { measureIndex: 0, staffN: 1 },
      { measureIndex: 0, staffN: 2 },
    ]);
  });
});

describe("TransposeOctaveCommand / ToggleAccidentalCommand", () => {
  it("octave moves only touch @oct", () => {
    const { ctx } = setup();
    new TransposeOctaveCommand(["n1"], -1).apply(ctx);
    expect(noteAttrs(ctx, "n1")).toMatchObject({ pname: "b", oct: "3", accid: "f" });
  });

  it("toggling the same accidental twice removes it; a different one replaces it", () => {
    const { ctx } = setup();
    new ToggleAccidentalCommand(["n2"], "s").apply(ctx);
    expect(noteAttrs(ctx, "n2")!["accid"]).toBe("s");
    new ToggleAccidentalCommand(["n2"], "f").apply(ctx);
    expect(noteAttrs(ctx, "n2")!["accid"]).toBe("f");
    new ToggleAccidentalCommand(["n2"], "f").apply(ctx);
    expect(noteAttrs(ctx, "n2")!["accid"]).toBeUndefined();
  });
});

describe("DeleteToRestsCommand", () => {
  it("replaces a note with a rest of the same written duration", () => {
    const { ctx, snapshot } = setup();
    const before = snapshot();
    const cmd = new DeleteToRestsCommand(["n1"]);
    cmd.apply(ctx);
    const xml = snapshot();
    expect(xml).not.toContain(`xml:id="n1"`);
    expect(xml).toMatch(/<rest[^>]*dur="2"/);
    cmd.revert(ctx);
    expect(snapshot()).toBe(before);
  });

  it("replaces a whole chord with one rest", () => {
    const { ctx } = setup();
    new DeleteToRestsCommand(["ch1"]).apply(ctx);
    const xml = ctx.score.measures.map((m) => serialize(m)).join("");
    expect(xml).not.toContain("chord");
    expect(xml).toMatch(/<rest[^>]*dur="1"/);
  });
});

describe("CommandStack", () => {
  it("execute/undo/redo round-trips the document and clears redo on execute", () => {
    const { ctx, snapshot } = setup();
    const stack = new CommandStack();
    const s0 = snapshot();
    stack.execute(ctx, new TransposeStepCommand(["n1"], 1));
    const s1 = snapshot();
    stack.execute(ctx, new DeleteToRestsCommand(["n2"]));
    expect(stack.undoDepth).toBe(2);

    stack.undo(ctx);
    expect(snapshot()).toBe(s1);
    stack.undo(ctx);
    expect(snapshot()).toBe(s0);
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(true);

    stack.redo(ctx);
    expect(snapshot()).toBe(s1);
    stack.execute(ctx, new TransposeOctaveCommand(["n1"], 1));
    expect(stack.canRedo).toBe(false); // redo history cleared
  });
});
