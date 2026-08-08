/**
 * Property tests (PLANNING.md cross-cutting practices): every command must
 * satisfy apply-then-revert identity. Random command sequences — including
 * interleaved undo/redo — fully unwound must yield a byte-identical document.
 * Runs against real corpus data (Bach chorale), not just synthetic scores.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEventIndex, serialize, ensureIds, resolveContexts, CommandStack, copyBlock, planPasteReplace,
  TransposeStepCommand, TransposeOctaveCommand, ToggleAccidentalCommand, DeleteToRestsCommand,
  PasteReplaceMeasuresCommand, InsertMeasuresCommand, DeleteMeasuresCommand, DuplicateMeasuresCommand, AddStaffCommand, RemoveStaffCommand, AddVoiceCommand, RemoveVoiceCommand, ToggleRepeatCommand,
  ReplaceEntryCommand, AddChordNoteCommand, ToggleTieCommand, ToggleSlurCommand, ToggleArticCommand, ToggleDynamCommand,
  ChainTieCommand, ChordNoteAccidentalCommand, ToggleFingCommand, CycleHairpinCommand, ToggleMarkCommand, OrnamentCycleCommand, ToggleGraceCommand, TogglePedalCommand, ToggleVoltaCommand, BeatRepeatCommand, MeasureRepeatCycleCommand, TupletCommand, AutoBeamCommand, UnbeamMeasuresCommand, chordNotes, MergeEventsCommand, SplitEventCommand, ChangeContextCommand, planContextChange,
  validateMeasureDurations, frac,
  type Command, type CommandContext, type CoreScore,
} from "../src/index.js";
import { scoreFrom } from "./helpers.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const choraleXml = readFileSync(join(fixtures, "Bach-JS_Ein_feste_Burg.mei"), "utf8");

function freshChorale(): { score: CoreScore; snapshot: () => string } {
  const { score } = scoreFrom(choraleXml);
  ensureIds(score.scoreDef);
  for (const m of score.measures) ensureIds(m);
  return { score, snapshot: () => score.measures.map((m) => serialize(m)).join("\n") };
}

/** Descriptor -> concrete command against the CURRENT document state. */
interface CmdDescriptor {
  kind: number;
  targetSeeds: number[];
  param: number;
}

function makeCommand(ctx: CommandContext, d: CmdDescriptor): Command | null {
  const candidates = [...ctx.index.byId.values()].filter((r) => r.tag === "note" || r.tag === "chord").map((r) => r.id);
  if (candidates.length === 0) return null;
  const ids = [...new Set(d.targetSeeds.map((s) => candidates[s % candidates.length]!))];
  const nMeasures = ctx.score.measures.length;
  const m = d.param % nMeasures;
  const PNAMES = ["c", "d", "e", "f", "g", "a", "b"] as const;
  // Modulo must cover every case + default, or the tail of the pool is
  // silently never fuzzed (this was % 12 for a while: cases 12+ were dead).
  switch (d.kind % 33) {
    case 0: return new TransposeStepCommand(ids, (d.param % 5) - 2 || 1);
    case 1: return new TransposeOctaveCommand(ids, d.param % 2 === 0 ? 1 : -1);
    case 2: return new ToggleAccidentalCommand(ids, (["s", "f", "n"] as const)[d.param % 3]!);
    case 3: return new DeleteToRestsCommand(ids);
    case 4: return new InsertMeasuresCommand(m, (d.param % 2) + 1);
    case 5: return nMeasures > 2 ? new DeleteMeasuresCommand(Math.min(m, nMeasures - 2), 1) : null;
    case 6: {
      // Copy a random block, paste it at a random valid target (replace).
      const contexts = resolveContexts(ctx.score);
      const seedA = d.targetSeeds[0] ?? 0;
      const from = seedA % nMeasures;
      const count = Math.min((d.param % 2) + 1, nMeasures - from);
      const frag = copyBlock(ctx.score, contexts, { measureFrom: from, measureTo: from + count - 1, staffFrom: 1, staffTo: 1 });
      if (!frag) return null;
      const at = (d.targetSeeds[1] ?? 0) % Math.max(1, nMeasures - frag.measureCount + 1);
      const staffN = ((d.targetSeeds[2] ?? 0) % 2) + 1;
      const plan = planPasteReplace(ctx.score, contexts, frag, at, staffN);
      return plan.ok ? new PasteReplaceMeasuresCommand(frag, at, staffN) : null;
    }
    case 7: return new DuplicateMeasuresCommand(m, 1);
    case 8: {
      const allEvents = [...ctx.index.byId.values()].map((r) => r.id);
      const target = allEvents[(d.targetSeeds[0] ?? 0) % allEvents.length]!;
      const kind = d.param % 3 === 0 ? "rest" as const : "note" as const;
      return new ReplaceEntryCommand(target, { kind, pname: PNAMES[d.param % 7]!, oct: 3 + (d.param % 3), dur: ["1", "2", "4", "8", "16"][d.param % 5]!, ...(d.param % 4 === 0 ? { dots: 1 } : {}) }, frac(4, 4));
    }
    case 9: return new AddChordNoteCommand(ids[0]!, PNAMES[d.param % 7]!, 3 + (d.param % 3));
    case 10: return new ToggleTieCommand(ids[0]!);
    case 11: return new ToggleArticCommand(ids, ["stacc", "acc", "ten"][d.param % 3]!);
    case 12: return new ToggleDynamCommand(ids[0]!, ["p", "f", "mf"][d.param % 3]!);
    case 13: {
      const allEvents = [...ctx.index.byId.values()].map((r) => r.id);
      return new MergeEventsCommand(allEvents[(d.targetSeeds[0] ?? 0) % allEvents.length]!);
    }
    case 14: {
      const spec = d.param % 3 === 0
        ? { keysig: ["0", "2s", "3f", "5s"][d.param % 4]! }
        : d.param % 3 === 1
          ? { clef: { shape: ["G", "F", "C"][d.param % 3]!, line: [2, 4, 3][d.param % 3]! }, staffN: (d.param % 2) + 1 }
          : { meter: { count: String((d.param % 6) + 2), unit: ["4", "8"][d.param % 2]! } };
      const contexts = resolveContexts(ctx.score);
      const plan = planContextChange(ctx.score, contexts, m, spec);
      return plan.ok ? new ChangeContextCommand(m, spec) : null;
    }
    case 15: {
      const other = candidates[(d.targetSeeds[1] ?? 1) % candidates.length]!;
      return new ToggleSlurCommand(ids[0]!, other); // invalid pairs throw -> no-op
    }
    case 16: {
      // A run of consecutive events from a random start (mostly refused —
      // pitch/kind rules — which is exactly what the no-op fuzz wants).
      const all = [...ctx.index.byId.values()].map((r) => r.id);
      const at = (d.targetSeeds[0] ?? 0) % all.length;
      return new ChainTieCommand(all.slice(at, at + 2 + (d.param % 3)));
    }
    case 17: {
      const chords = [...ctx.index.byId.values()].filter((r) => r.tag === "chord").map((r) => r.id);
      if (chords.length === 0) return null;
      const chordId = chords[(d.targetSeeds[0] ?? 0) % chords.length]!;
      const notes = chordNotes(ctx.score, ctx.index, chordId);
      if (notes.length === 0) return null;
      const note = notes[(d.targetSeeds[1] ?? 0) % notes.length]!;
      return new ChordNoteAccidentalCommand(chordId, note.id, (["s", "f", "n"] as const)[d.param % 3]!);
    }
    case 18:
      // add/remove staff; removing staff 1 or the last staff throws -> no-op
      return d.param % 2 === 0 ? new AddStaffCommand() : new RemoveStaffCommand((d.param % 4) + 1);
    case 19: return new ToggleFingCommand(ids[0]!, String((d.param % 5) + 1), d.param % 2 === 0);
    case 20: return d.param % 3 === 0 ? new UnbeamMeasuresCommand([m]) : new AutoBeamCommand([m, (m + 1) % nMeasures]);
    case 21: {
      const other = candidates[(d.targetSeeds[1] ?? 1) % candidates.length]!;
      return new CycleHairpinCommand(ids[0]!, other); // invalid pairs throw -> no-op
    }
    case 22: return new ToggleRepeatCommand(m, Math.min(m + (d.param % 3), nMeasures - 1));
    case 24: return new ToggleMarkCommand(ids[0]!, d.param % 2 === 0 ? "fermata" : "coda");
    case 25: return new OrnamentCycleCommand(ids[0]!);
    case 26: {
      const other = candidates[(d.targetSeeds[1] ?? 1) % candidates.length]!;
      return new ToggleGraceCommand(ids[0]!, other); // non-adjacent pairs throw -> no-op
    }
    case 27: {
      const other = candidates[(d.targetSeeds[1] ?? 1) % candidates.length]!;
      return new TogglePedalCommand(ids[0]!, other);
    }
    case 28: return new ToggleVoltaCommand(m, Math.min(m + (d.param % 2), nMeasures - 1), (d.param % 3) + 1);
    case 29: {
      const allEvents = [...ctx.index.byId.values()].map((r) => r.id);
      return new BeatRepeatCommand(allEvents[(d.targetSeeds[0] ?? 0) % allEvents.length]!, frac(1, 4), "4", frac(4, 4));
    }
    case 30: return new MeasureRepeatCycleCommand(m, (d.param % 2) + 1, 1);
    case 31: {
      // a consecutive run of 3 events (wrap) or whatever sits at the seed
      // (unwrap when inside a tuplet); invalid runs throw -> no-op
      const all = [...ctx.index.byId.values()].map((r) => r.id);
      const at = (d.targetSeeds[0] ?? 0) % all.length;
      return new TupletCommand(all.slice(at, at + 3));
    }
    case 23:
      // add/remove voice from a random measure; invalid removals throw -> no-op
      return d.param % 2 === 0 ? new AddVoiceCommand((d.param % 2) + 1, m) : new RemoveVoiceCommand((d.param % 2) + 1, (d.param % 3) + 1, m);
    default: {
      const allEvents = [...ctx.index.byId.values()].map((r) => r.id);
      return new SplitEventCommand(allEvents[(d.targetSeeds[0] ?? 0) % allEvents.length]!);
    }
  }
}

const cmdArb = fc.record({
  kind: fc.integer({ min: 0, max: 32 }),
  targetSeeds: fc.array(fc.nat(), { minLength: 1, maxLength: 6 }),
  param: fc.nat(),
});

describe("command properties (fast-check)", () => {
  it("random command sequences fully unwound restore the document byte-identically", () => {
    fc.assert(
      fc.property(fc.array(cmdArb, { minLength: 1, maxLength: 12 }), (descriptors) => {
        const { score, snapshot } = freshChorale();
        const original = snapshot();
        const stack = new CommandStack();
        for (const d of descriptors) {
          const ctx: CommandContext = { score, index: buildEventIndex(score) };
          const cmd = makeCommand(ctx, d);
          try {
            if (cmd) stack.execute(ctx, cmd);
          } catch { /* refused entries (boundaries, pitch rules) are no-ops */ }
        }
        while (stack.canUndo) stack.undo({ score, index: buildEventIndex(score) });
        expect(snapshot()).toBe(original);
      }),
      { numRuns: 25 },
    );
  });

  it("every command sequence preserves the duration invariant on every measure", () => {
    fc.assert(
      fc.property(fc.array(cmdArb, { minLength: 1, maxLength: 10 }), (descriptors) => {
        const { score } = freshChorale();
        const stack = new CommandStack();
        for (const d of descriptors) {
          const ctx: CommandContext = { score, index: buildEventIndex(score) };
          const cmd = makeCommand(ctx, d);
          try {
            if (cmd) stack.execute(ctx, cmd);
          } catch { /* refused entries are no-ops */ }
          const contexts = resolveContexts(score);
          score.measures.forEach((m, i) => {
            for (const [staffN, staffCtx] of contexts[i]!) {
              const problems = validateMeasureDurations(m, staffCtx.meter, staffN);
              expect(problems).toHaveLength(0);
            }
          });
        }
      }),
      { numRuns: 15 },
    );
  });

  it("interleaved execute/undo/redo sequences unwind to the original document", () => {
    const opArb = fc.oneof(
      fc.record({ op: fc.constant("execute" as const), cmd: cmdArb }),
      fc.record({ op: fc.constant("undo" as const) }),
      fc.record({ op: fc.constant("redo" as const) }),
    );
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 2, maxLength: 20 }), (ops) => {
        const { score, snapshot } = freshChorale();
        const original = snapshot();
        const stack = new CommandStack();
        for (const op of ops) {
          const ctx: CommandContext = { score, index: buildEventIndex(score) };
          if (op.op === "execute") {
            const cmd = makeCommand(ctx, op.cmd);
            try {
              if (cmd) stack.execute(ctx, cmd);
            } catch { /* refused entries are no-ops */ }
          } else if (op.op === "undo") stack.undo(ctx);
          else stack.redo(ctx);
        }
        while (stack.canUndo) stack.undo({ score, index: buildEventIndex(score) });
        expect(snapshot()).toBe(original);
      }),
      { numRuns: 25 },
    );
  });
});
