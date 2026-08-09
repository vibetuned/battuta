/**
 * DocumentSession: one open MEI document plus its derived state (contexts,
 * event index, undo stack). All mutations go through execute()/undo()/redo(),
 * which rebuild the index and bump the version — React re-renders off the
 * version, and tiles re-render off cache-key changes alone.
 */
import {
  buildScore, resolveContexts, buildEventIndex, ensureIds, fromDom, serialize, serializeDocument, childElements, findAll, meterCapacity, frac,
  CommandStack, TransposeStepCommand, TransposeOctaveCommand, ToggleAccidentalCommand, ChordNoteAccidentalCommand, chordNotes, DeleteToRestsCommand, RegenerateIdsCommand,
  copyBlock, planPasteReplace, PasteReplaceMeasuresCommand, InsertMeasuresCommand, DeleteMeasuresCommand, DuplicateMeasuresCommand, AddStaffCommand, RemoveStaffCommand, AddVoiceCommand, RemoveVoiceCommand, ToggleRepeatCommand, ToggleVoltaCommand,
  SetHarmCommand, harmTextAt, SetTitleCommand, fingTextsAt, buildExpansion, ReplaceEntryCommand, AddChordNoteCommand, ToggleTieCommand, ChainTieCommand, ToggleSlurCommand, ToggleArticCommand, ToggleDynamCommand, MergeEventsCommand, SplitEventCommand, CycleDynamCommand, CycleHairpinCommand, ChangeDurationCommand, ToggleFingCommand, ToggleMarkCommand, OrnamentCycleCommand, ToggleGraceCommand, TogglePedalCommand, BeatRepeatCommand, MeasureRepeatCycleCommand, TupletCommand, AutoBeamCommand, UnbeamThen, measuresOf, ChangeContextCommand, planContextChange,
  type CoreScore, type MeasureContext, type EventIndex, type Command, type DirtyRegion, type DomLikeElement, type DomLikeNode,
  type BlockSelection, type ClipboardFragment, type PastePlan, type EntrySpec, type MarkKind, type HarmKind, type CoreElement, type CaretPosition, type ContextChangeSpec,
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

  /** Full document tree (meiHead and all) — the save target. */
  readonly root: CoreElement;
  /** Document prologue: xml-model PIs, license comments (preserved). */
  readonly prologue: CoreElement[] = [];

  constructor(xml: string) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const err = doc.querySelector("parsererror");
    if (err) throw new Error("MEI parse error: " + err.textContent);
    const prologueComments: CoreElement[] = [];
    for (let i = 0; i < doc.childNodes.length; i++) {
      const node = doc.childNodes.item(i) as unknown as DomLikeNode & { nodeName: string };
      if (!node || node === (doc.documentElement as unknown as DomLikeNode)) continue;
      // Skip the source's own <?xml?> declaration; saves write a fresh one.
      if (node.nodeType === 7 && node.nodeName !== "xml") this.prologue.push({ tag: "#pi", attrs: { target: node.nodeName }, children: [node.nodeValue ?? ""] });
      else if (node.nodeType === 8) prologueComments.push({ tag: "#comment", attrs: {}, children: [node.nodeValue ?? ""] });
    }
    this.root = fromDom(doc.documentElement as unknown as DomLikeElement);
    // Verovio rejects comments BEFORE the root element (PIs are fine), so
    // prologue comments are preserved by moving them just inside <mei> —
    // content kept verbatim, placement adjusted for compatibility.
    this.root.children.unshift(...prologueComments);
    this.score = buildScore(this.root);
    ensureIds(this.score.scoreDef);
    for (const m of this.score.measures) ensureIds(m);
    this.contexts = resolveContexts(this.score);
    this.index = buildEventIndex(this.score);
    this.reindexStaves();
  }

  /** Serialize the FULL document (edits, meiHead, unknown content, ids). */
  saveDocument(): string {
    return serializeDocument(this.root, this.prologue);
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
  toggleAccidental(ids: string[], accid: "s" | "f" | "n" | "x"): DirtyRegion[] {
    return this.execute(new ToggleAccidentalCommand(ids, accid));
  }
  chordNotes(chordId: string): { id: string; pname: string; oct: string; accid?: string }[] {
    return chordNotes(this.score, this.index, chordId);
  }
  chordNoteAccidental(chordId: string, noteId: string, accid: "s" | "f" | "n" | "x"): DirtyRegion[] {
    return this.execute(new ChordNoteAccidentalCommand(chordId, noteId, accid));
  }
  /** Repair tool: fresh random ids everywhere, references rewritten. */
  regenerateIds(): number {
    const cmd = new RegenerateIdsCommand();
    this.execute(cmd);
    return cmd.count;
  }
  deleteToRests(ids: string[]): DirtyRegion[] {
    return this.execute(new UnbeamThen(new DeleteToRestsCommand(ids), measuresOf(this.score, this.index, ids)));
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
  toggleRepeat(from: number, to: number): DirtyRegion[] {
    return this.execute(new ToggleRepeatCommand(from, to));
  }
  /** Adds a voice (layer) to the staff from a measure onward; returns n. */
  addVoice(staffN: number, from = 0): number {
    const cmd = new AddVoiceCommand(staffN, from);
    this.execute(cmd);
    return cmd.layerN;
  }
  removeVoice(staffN: number, layerN: number, from = 0): DirtyRegion[] {
    return this.execute(new RemoveVoiceCommand(staffN, layerN, from));
  }
  /** Adds a staff below the existing ones; returns its number. */
  addStaff(): number {
    const cmd = new AddStaffCommand();
    this.execute(cmd);
    return cmd.staffN;
  }
  removeStaff(staffN: number): DirtyRegion[] {
    return this.execute(new RemoveStaffCommand(staffN));
  }
  get staffCount(): number {
    return this.index.stavesPerMeasure.get(0)?.length ?? 0;
  }

  /** Overwrite-mode entry at the event; returns the entered event's id. */
  enterEvent(targetId: string, spec: EntrySpec): string | null {
    const ref = this.index.byId.get(targetId);
    const capacity = (ref && meterCapacity(this.contexts[ref.measureIndex]?.get(ref.staffN)?.meter ?? {})) || frac(4, 4);
    const cmd = new ReplaceEntryCommand(targetId, spec, capacity);
    // Rhythm edits unbeam their measure first (UnbeamThen): entry never
    // fights beam boundaries, no broken beams survive — alt+b re-beams.
    this.execute(new UnbeamThen(cmd, measuresOf(this.score, this.index, [targetId])));
    return cmd.enteredId;
  }
  /** Returns the resulting chord's id (promotion assigns a new one). */
  addChordNote(targetId: string, pname: string, oct: number, accid?: string): string | null {
    const cmd = new AddChordNoteCommand(targetId, pname, oct, accid);
    this.execute(cmd);
    return cmd.resultId;
  }
  toggleTie(targetId: string): DirtyRegion[] {
    return this.execute(new ToggleTieCommand(targetId));
  }
  toggleSlur(startId: string, endId: string): DirtyRegion[] {
    return this.execute(new ToggleSlurCommand(startId, endId));
  }
  tieChain(ids: string[]): DirtyRegion[] {
    return this.execute(new ChainTieCommand(ids));
  }
  toggleArtic(ids: string[], artic: string): DirtyRegion[] {
    return this.execute(new ToggleArticCommand(ids, artic));
  }
  toggleDynam(targetId: string, value: string): DirtyRegion[] {
    return this.execute(new ToggleDynamCommand(targetId, value));
  }
  /**
   * Toggle the dot on an already-entered note/rest by re-entering it in
   * place with the dot flipped (the overwrite machinery consumes/releases
   * the duration difference). Returns the new event id, or throws.
   */
  toggleDot(targetId: string): { id: string | null; dots: number } {
    const ref = this.index.byId.get(targetId);
    if (!ref || (ref.tag !== "note" && ref.tag !== "rest" && ref.tag !== "chord")) {
      throw new Error("dot applies to a note, rest, or chord");
    }
    const measure = this.score.measures[ref.measureIndex];
    const el = measure && findAll(measure, ref.tag).find((e) => e.attrs["xml:id"] === targetId);
    if (!el || !el.attrs["dur"]) throw new Error("dot target has no written duration");
    const dots = el.attrs["dots"] ? 0 : 1;
    // In-place duration change: the element (and chord children) keep their
    // ids, so the caret and lastEntered stay valid without re-pointing.
    this.execute(new UnbeamThen(new ChangeDurationCommand(targetId, el.attrs["dur"], dots, this.capacityAt(targetId)), measuresOf(this.score, this.index, [targetId])));
    return { id: targetId, dots };
  }

  /**
   * Halve or double the written duration in place (direction +1 = longer,
   * -1 = shorter), dots preserved — same consume/release mechanics as the
   * dot toggle. Returns the resulting duration for entry-state sync.
   */
  changeDurationStep(targetId: string, direction: 1 | -1): { dur: string; dots: number } {
    const ref = this.index.byId.get(targetId);
    if (!ref || (ref.tag !== "note" && ref.tag !== "rest" && ref.tag !== "chord")) {
      throw new Error("duration applies to a note, rest, or chord");
    }
    const measure = this.score.measures[ref.measureIndex];
    const el = measure && findAll(measure, ref.tag).find((e) => e.attrs["xml:id"] === targetId);
    if (!el || !el.attrs["dur"]) throw new Error("target has no written duration");
    const order = ["breve", "1", "2", "4", "8", "16", "32", "64", "128"];
    const at = order.indexOf(el.attrs["dur"]);
    if (at < 0) throw new Error(`unknown duration ${el.attrs["dur"]}`);
    const next = order[at - direction];
    if (!next) throw new Error(direction > 0 ? "already the longest duration" : "already the shortest duration");
    const dots = Number(el.attrs["dots"] ?? 0);
    this.execute(new UnbeamThen(new ChangeDurationCommand(targetId, next, dots, this.capacityAt(targetId)), measuresOf(this.score, this.index, [targetId])));
    return { dur: next, dots };
  }

  /** Change/add clef, key signature, or meter at a measure (validated). */
  changeContext(measureIndex: number, spec: ContextChangeSpec): void {
    const plan = planContextChange(this.score, this.contexts, measureIndex, spec);
    if (!plan.ok) throw new Error(plan.reason);
    this.execute(new ChangeContextCommand(measureIndex, spec));
  }

  private capacityAt(targetId: string) {
    const ref = this.index.byId.get(targetId);
    return (ref && meterCapacity(this.contexts[ref.measureIndex]?.get(ref.staffN)?.meter ?? {})) || frac(4, 4);
  }
  cycleDynam(targetId: string): DirtyRegion[] {
    return this.execute(new CycleDynamCommand(targetId));
  }
  cycleHairpin(startId: string, endId: string): DirtyRegion[] {
    return this.execute(new CycleHairpinCommand(startId, endId));
  }
  toggleMark(targetId: string, kind: MarkKind): DirtyRegion[] {
    return this.execute(new ToggleMarkCommand(targetId, kind));
  }
  cycleOrnament(targetId: string): DirtyRegion[] {
    return this.execute(new OrnamentCycleCommand(targetId));
  }
  toggleGrace(firstId: string, secondId: string): DirtyRegion[] {
    return this.execute(new ToggleGraceCommand(firstId, secondId));
  }
  togglePedal(startId: string, endId: string): DirtyRegion[] {
    return this.execute(new TogglePedalCommand(startId, endId));
  }
  /** Simile slash: one beat (the meter's unit) becomes a <beatRpt/>. */
  simile(targetId: string): DirtyRegion[] {
    const ref = this.index.byId.get(targetId);
    const meter = (ref && this.contexts[ref.measureIndex]?.get(ref.staffN)?.meter) ?? {};
    const unit = meter.unit ?? "4";
    const capacity = meterCapacity(meter) || frac(4, 4);
    return this.execute(new BeatRepeatCommand(targetId, frac(1, Number(unit)), unit, capacity));
  }
  measureRepeat(caret: CaretPosition): DirtyRegion[] {
    return this.execute(new MeasureRepeatCycleCommand(caret.measureIndex, caret.staffN, caret.layerN));
  }
  setHarm(targetId: string, text: string, kind: HarmKind): DirtyRegion[] {
    return this.execute(new SetHarmCommand(targetId, text, kind));
  }
  harmAt(targetId: string, kind: HarmKind): string {
    const ref = this.index.byId.get(targetId);
    const measure = ref && this.score.measures[ref.measureIndex];
    return measure ? harmTextAt(measure, targetId, kind) : "";
  }

  /** Rhythm edit: unbeams its measure first, like entry. */
  toggleTuplet(ids: string[]): DirtyRegion[] {
    return this.execute(new UnbeamThen(new TupletCommand(ids), measuresOf(this.score, this.index, ids)));
  }
  toggleVolta(from: number, to: number, n: number): DirtyRegion[] {
    return this.execute(new ToggleVoltaCommand(from, to, n));
  }
  autoBeam(measureIndexes: number[]): DirtyRegion[] {
    return this.execute(new AutoBeamCommand(measureIndexes));
  }
  toggleFing(targetId: string, finger: string, additive: boolean): DirtyRegion[] {
    return this.execute(new ToggleFingCommand(targetId, finger, additive));
  }
  /** The fing texts at an event ("3", "3-1", …) — for the finger-change keys. */
  fingAt(targetId: string): string[] {
    const ref = this.index.byId.get(targetId);
    const measure = ref ? this.score.measures[ref.measureIndex] : undefined;
    return measure ? fingTextsAt(measure, targetId) : [];
  }
  /** meiHead > fileDesc > titleStmt > title text ("" when absent). */
  title(): string {
    let el: CoreElement | undefined = this.root;
    for (const tag of ["meiHead", "fileDesc", "titleStmt", "title"]) {
      el = el ? childElements(el).find((c) => c.tag === tag) : undefined;
    }
    return el ? el.children.filter((c): c is string => typeof c === "string").join("") : "";
  }
  setTitle(text: string): DirtyRegion[] {
    return this.execute(new SetTitleCommand(this.root, text));
  }
  /** Identity of the top undo command — compare against a saved mark to
   * know whether the document changed since the last save. */
  get editMark(): unknown {
    return this.stack.top;
  }
  mergeWithNext(targetId: string): DirtyRegion[] {
    return this.execute(new UnbeamThen(new MergeEventsCommand(targetId, this.capacityAt(targetId)), measuresOf(this.score, this.index, [targetId])));
  }
  splitInHalf(targetId: string): DirtyRegion[] {
    return this.execute(new UnbeamThen(new SplitEventCommand(targetId, this.capacityAt(targetId)), measuresOf(this.score, this.index, [targetId])));
  }

  /** Pitch of the nearest note at or before the position (octave guessing). */
  pitchNear(pos: CaretPosition): { pname: string; oct: number } | null {
    for (let m = pos.measureIndex; m >= 0; m--) {
      const events = this.index.eventsAt(m, pos.staffN, pos.layerN);
      const start = m === pos.measureIndex ? Math.min(pos.eventIndex, events.length - 1) : events.length - 1;
      for (let i = start; i >= 0; i--) {
        const id = events[i];
        const ref = id ? this.index.byId.get(id) : undefined;
        if (!ref || (ref.tag !== "note" && ref.tag !== "chord")) continue;
        const measure = this.score.measures[m];
        const el = measure && findAll(measure, ref.tag).find((e) => e.attrs["xml:id"] === id);
        const note = el && (el.tag === "note" ? el : findAll(el, "note")[0]);
        if (note?.attrs["pname"] && note.attrs["oct"]) return { pname: note.attrs["pname"], oct: Number(note.attrs["oct"]) };
      }
    }
    return null;
  }

  /**
   * Serialize the CURRENT document (edits included) as a standalone MEI file
   * for the page view: initial scoreDef plus the flow (interleaved defs and
   * measures) in order. Header metadata is not carried over (Phase 4).
   */
  serializeForPageView(): string {
    // Serialize the REAL score element — flattening score.items into a bare
    // section dropped structural containers like <ending> (volta brackets
    // never reached the page view). meiHead rides along: Verovio's page
    // header (title, composer) is generated from it.
    const head = childElements(this.root).find((c) => c.tag === "meiHead");
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">`,
      ...(head ? [serialize(head)] : []),
      `<music><body><mdiv>`,
      serialize(this.score.scoreEl),
      `</mdiv></body></music>`,
      `</mei>`,
    ].join("\n");
  }

  /**
   * Playback serialization: when the score carries repeat structure
   * (voltas, plain repeats, one D.S./D.C. jump), the measures are wrapped
   * in segment sections under a synthesized <expansion> so Verovio's
   * timemap follows the true form (`expand` option). Pure — the document
   * tree is only read.
   */
  serializeForPlayback(): { xml: string; expand: string | null } {
    const plan = buildExpansion(this.score);
    if (!plan) return { xml: this.serializeForPageView(), expand: null };
    const scoreEl: CoreElement = { tag: "score", attrs: {}, children: [this.score.scoreDef, plan.section] };
    const xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">`,
      `<music><body><mdiv>`,
      serialize(scoreEl),
      `</mdiv></body></music>`,
      `</mei>`,
    ].join("\n");
    return { xml, expand: plan.expandId };
  }
}
