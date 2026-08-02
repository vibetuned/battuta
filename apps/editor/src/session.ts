/**
 * DocumentSession: one open MEI document plus its derived state (contexts,
 * event index, undo stack). All mutations go through execute()/undo()/redo(),
 * which rebuild the index and bump the version — React re-renders off the
 * version, and tiles re-render off cache-key changes alone.
 */
import {
  buildScore, resolveContexts, buildEventIndex, ensureIds, fromDom, serialize, childElements,
  CommandStack, TransposeStepCommand, TransposeOctaveCommand, ToggleAccidentalCommand, DeleteToRestsCommand,
  copyBlock, planPasteReplace, PasteReplaceMeasuresCommand, InsertMeasuresCommand, DeleteMeasuresCommand, DuplicateMeasuresCommand,
  type CoreScore, type MeasureContext, type EventIndex, type Command, type DirtyRegion, type DomLikeElement,
  type BlockSelection, type ClipboardFragment, type PastePlan,
} from "@battuta/core";

export class DocumentSession {
  readonly score: CoreScore;
  contexts: MeasureContext[];
  index: EventIndex;
  readonly stack = new CommandStack();
  version = 0;
  /** performance.now() at the start of the latest edit (for the latency HUD). */
  lastEditStart = 0;
  lastDirty: DirtyRegion[] = [];

  /** staff element id -> model position (drag hit-testing). */
  readonly staffRefById = new Map<string, { measureIndex: number; staffN: number }>();
  /** `${measureIndex}/${staffN}` -> staff element id (block highlighting). */
  readonly staffIdByPos = new Map<string, string>();

  constructor(xml: string) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const err = doc.querySelector("parsererror");
    if (err) throw new Error("MEI parse error: " + err.textContent);
    this.score = buildScore(fromDom(doc.documentElement as unknown as DomLikeElement));
    ensureIds(this.score.scoreDef);
    for (const m of this.score.measures) ensureIds(m);
    this.contexts = resolveContexts(this.score);
    this.index = buildEventIndex(this.score);
    this.reindexStaves();
  }

  private reindexStaves(): void {
    this.staffRefById.clear();
    this.staffIdByPos.clear();
    this.score.measures.forEach((measure, m) => {
      for (const staff of childElements(measure).filter((c) => c.tag === "staff")) {
        const id = staff.attrs["xml:id"];
        const n = Number(staff.attrs["n"] ?? "1");
        if (id) {
          this.staffRefById.set(id, { measureIndex: m, staffN: n });
          this.staffIdByPos.set(`${m}/${n}`, id);
        }
      }
    });
  }

  private afterMutation(dirty: DirtyRegion[] | null): DirtyRegion[] {
    if (!dirty) return [];
    // Pasted/edited content can carry inline clefs and structure changes
    // shift measures, so contexts are re-resolved after every command.
    this.contexts = resolveContexts(this.score);
    this.index = buildEventIndex(this.score);
    for (const m of this.score.measures) ensureIds(m); // pasted/inserted content
    this.reindexStaves();
    this.lastDirty = dirty;
    this.version++;
    return dirty;
  }

  execute(cmd: Command): DirtyRegion[] {
    this.lastEditStart = performance.now();
    return this.afterMutation(this.stack.execute({ score: this.score, index: this.index }, cmd));
  }

  undo(): DirtyRegion[] {
    this.lastEditStart = performance.now();
    return this.afterMutation(this.stack.undo({ score: this.score, index: this.index }));
  }

  redo(): DirtyRegion[] {
    this.lastEditStart = performance.now();
    return this.afterMutation(this.stack.redo({ score: this.score, index: this.index }));
  }

  transposeStep(ids: string[], steps: number): DirtyRegion[] {
    return this.execute(new TransposeStepCommand(ids, steps));
  }
  transposeOctave(ids: string[], octaves: number): DirtyRegion[] {
    return this.execute(new TransposeOctaveCommand(ids, octaves));
  }
  toggleAccidental(ids: string[], accid: "s" | "f" | "n"): DirtyRegion[] {
    return this.execute(new ToggleAccidentalCommand(ids, accid));
  }
  deleteToRests(ids: string[]): DirtyRegion[] {
    return this.execute(new DeleteToRestsCommand(ids));
  }

  copyBlock(block: BlockSelection): ClipboardFragment | null {
    return copyBlock(this.score, this.contexts, block);
  }
  planPaste(frag: ClipboardFragment, measureIndex: number, staffN: number): PastePlan {
    return planPasteReplace(this.score, this.contexts, frag, measureIndex, staffN);
  }
  pasteReplace(frag: ClipboardFragment, measureIndex: number, staffN: number): DirtyRegion[] {
    return this.execute(new PasteReplaceMeasuresCommand(frag, measureIndex, staffN));
  }
  insertMeasures(at: number, count = 1): DirtyRegion[] {
    return this.execute(new InsertMeasuresCommand(at, count));
  }
  deleteMeasures(at: number, count = 1): DirtyRegion[] {
    return this.execute(new DeleteMeasuresCommand(at, count));
  }
  duplicateMeasures(at: number, count = 1): DirtyRegion[] {
    return this.execute(new DuplicateMeasuresCommand(at, count));
  }

  /**
   * Serialize the CURRENT document (edits included) as a standalone MEI file
   * for the page view: initial scoreDef plus the flow (interleaved defs and
   * measures) in order. Header metadata is not carried over (Phase 4).
   */
  serializeForPageView(): string {
    const flow = this.score.items.map((item) => serialize(item.el)).join("\n");
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">`,
      `<music><body><mdiv><score>`,
      serialize(this.score.scoreDef),
      `<section>`,
      flow,
      `</section>`,
      `</score></mdiv></body></music>`,
      `</mei>`,
    ].join("\n");
  }
}
