/**
 * Command engine: every mutation is a command with apply/revert against the
 * document, reporting the dirty regions (measure × staff) it touched. Undo is
 * a stack of executed commands; one command = one undo step, however many
 * elements it touched (a transposed selection undoes atomically).
 *
 * Revert strategy: commands capture per-target mementos at apply time
 * (attribute snapshots, or the replaced element + its position), so
 * apply-then-revert restores the tree exactly — enforced by property tests.
 */
import { CoreElement, childElements } from "./xml.js";
import { CoreScore } from "./score.js";
import { EventIndex } from "./events.js";
import { newId } from "./ids.js";

export interface DirtyRegion {
  measureIndex: number;
  staffN: number;
}

export interface CommandContext {
  score: CoreScore;
  index: EventIndex;
}

export interface Command {
  readonly label: string;
  apply(ctx: CommandContext): DirtyRegion[];
  revert(ctx: CommandContext): DirtyRegion[];
}

/** Locate an element by id inside a measure, with its parent and position. */
function locateById(root: CoreElement, id: string): { el: CoreElement; parent: CoreElement; at: number } | null {
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i];
    if (c === undefined || typeof c === "string") continue;
    if (c.attrs["xml:id"] === id) return { el: c, parent: root, at: i };
    const hit = locateById(c, id);
    if (hit) return hit;
  }
  return null;
}

function dirtyFor(ctx: CommandContext, ids: string[]): DirtyRegion[] {
  const seen = new Set<string>();
  const out: DirtyRegion[] = [];
  for (const id of ids) {
    const ref = ctx.index.byId.get(id);
    if (!ref) continue;
    const key = `${ref.measureIndex}/${ref.staffN}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ measureIndex: ref.measureIndex, staffN: ref.staffN });
    }
  }
  return out;
}

function targetNotes(ctx: CommandContext, id: string): CoreElement[] {
  const ref = ctx.index.byId.get(id);
  if (!ref) return [];
  const measure = ctx.score.measures[ref.measureIndex];
  if (!measure) return [];
  const hit = locateById(measure, id);
  if (!hit) return [];
  if (hit.el.tag === "note") return [hit.el];
  if (hit.el.tag === "chord") return childElements(hit.el).filter((c) => c.tag === "note");
  return [];
}

/* ------------------------------------------------------------------ */

const PNAMES = ["c", "d", "e", "f", "g", "a", "b"] as const;

/** Snapshot-and-set attribute editing shared by the pitch commands. */
abstract class AttrCommand implements Command {
  abstract readonly label: string;
  protected mementos: { noteEl: CoreElement; before: Record<string, string> }[] = [];
  constructor(protected readonly ids: string[]) {}

  protected abstract mutate(note: CoreElement): void;

  apply(ctx: CommandContext): DirtyRegion[] {
    this.mementos = [];
    for (const id of this.ids) {
      for (const note of targetNotes(ctx, id)) {
        this.mementos.push({ noteEl: note, before: { ...note.attrs } });
        this.mutate(note);
      }
    }
    return dirtyFor(ctx, this.ids);
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    for (const m of this.mementos) m.noteEl.attrs = { ...m.before };
    return dirtyFor(ctx, this.ids);
  }
}

/** Diatonic step transpose (pname letter + octave carry). Pitch-only fast path. */
export class TransposeStepCommand extends AttrCommand {
  readonly label: string;
  constructor(ids: string[], private readonly steps: number) {
    super(ids);
    this.label = `transpose ${steps > 0 ? "+" : ""}${steps} step`;
  }
  protected mutate(note: CoreElement): void {
    const pname = note.attrs["pname"];
    const oct = Number(note.attrs["oct"] ?? "4");
    if (!pname) return;
    const at = PNAMES.indexOf(pname as (typeof PNAMES)[number]);
    if (at < 0) return;
    const absolute = oct * 7 + at + this.steps;
    note.attrs["pname"] = PNAMES[((absolute % 7) + 7) % 7]!;
    note.attrs["oct"] = String(Math.floor(absolute / 7));
    // A step move invalidates any explicit accidental; the key signature
    // governs the new pitch until the user sets one again.
    delete note.attrs["accid"];
    delete note.attrs["accid.ges"];
  }
}

export class TransposeOctaveCommand extends AttrCommand {
  readonly label: string;
  constructor(ids: string[], private readonly octaves: number) {
    super(ids);
    this.label = `transpose ${octaves > 0 ? "+" : ""}${octaves} octave`;
  }
  protected mutate(note: CoreElement): void {
    if (note.attrs["oct"] !== undefined) {
      note.attrs["oct"] = String(Number(note.attrs["oct"]) + this.octaves);
    }
  }
}

/** Set an accidental, or remove it when it is already the requested one. */
export class ToggleAccidentalCommand extends AttrCommand {
  readonly label: string;
  constructor(ids: string[], private readonly accid: "s" | "f" | "n") {
    super(ids);
    this.label = `toggle accidental ${accid}`;
  }
  protected mutate(note: CoreElement): void {
    if (note.attrs["accid"] === this.accid) delete note.attrs["accid"];
    else note.attrs["accid"] = this.accid;
    delete note.attrs["accid.ges"]; // an explicit accidental overrides imports' gestural one
  }
}

/** The notes of a chord, in document order — chord children are not in the
 * event index, so pickers resolve them through the chord's own id. */
export function chordNotes(score: CoreScore, index: EventIndex, chordId: string): { id: string; pname: string; oct: string; accid?: string }[] {
  const ref = index.byId.get(chordId);
  if (!ref || ref.tag !== "chord") return [];
  const measure = score.measures[ref.measureIndex];
  const chord = measure && locateById(measure, chordId)?.el;
  if (!chord) return [];
  return childElements(chord)
    .filter((c) => c.tag === "note")
    .map((n) => ({ id: n.attrs["xml:id"] ?? "", pname: n.attrs["pname"] ?? "", oct: n.attrs["oct"] ?? "", ...(n.attrs["accid"] ? { accid: n.attrs["accid"] } : {}) }));
}

/**
 * Toggle an accidental on ONE note of a chord (an all-notes accidental is
 * rarely what's meant — the chord id anchors the lookup because chord
 * children are not indexed events).
 */
export class ChordNoteAccidentalCommand implements Command {
  readonly label: string;
  private memento: { el: CoreElement; before: Record<string, string> } | null = null;
  private region: DirtyRegion[] = [];

  constructor(
    private readonly chordId: string,
    private readonly noteId: string,
    private readonly accid: "s" | "f" | "n",
  ) {
    this.label = `toggle accidental ${accid} on chord note`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const ref = ctx.index.byId.get(this.chordId);
    const measure = ref && ctx.score.measures[ref.measureIndex];
    const chord = measure ? locateById(measure, this.chordId)?.el : undefined;
    if (!ref || !chord || chord.tag !== "chord") throw new Error("chord not found");
    const note = childElements(chord).find((c) => c.tag === "note" && c.attrs["xml:id"] === this.noteId);
    if (!note) throw new Error("note not found in the chord");
    this.memento = { el: note, before: { ...note.attrs } };
    if (note.attrs["accid"] === this.accid) delete note.attrs["accid"];
    else note.attrs["accid"] = this.accid;
    delete note.attrs["accid.ges"];
    this.region = [{ measureIndex: ref.measureIndex, staffN: ref.staffN }];
    return this.region;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (this.memento) this.memento.el.attrs = { ...this.memento.before };
    return this.region;
  }
}

/* ------------------------------------------------------------------ */

interface ReplaceMemento {
  measureIndex: number;
  staffN: number;
  parentPath: number[]; // child indices from the measure to the parent
  at: number;
  original: CoreElement;
  replacement: CoreElement;
}

function pathTo(root: CoreElement, target: CoreElement): number[] | null {
  if (root === target) return [];
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i];
    if (c === undefined || typeof c === "string") continue;
    const sub = pathTo(c, target);
    if (sub) return [i, ...sub];
  }
  return null;
}

function resolvePath(root: CoreElement, path: number[]): CoreElement {
  let el = root;
  for (const i of path) el = el.children[i] as CoreElement;
  return el;
}

/** Replace notes/chords with rests of the same written duration. */
export class DeleteToRestsCommand implements Command {
  readonly label = "delete to rests";
  private mementos: ReplaceMemento[] = [];
  constructor(private readonly ids: string[]) {}

  apply(ctx: CommandContext): DirtyRegion[] {
    this.mementos = [];
    for (const id of this.ids) {
      const ref = ctx.index.byId.get(id);
      if (!ref || (ref.tag !== "note" && ref.tag !== "chord")) continue;
      const measure = ctx.score.measures[ref.measureIndex];
      if (!measure) continue;
      const hit = locateById(measure, id);
      if (!hit) continue;
      const rest: CoreElement = { tag: "rest", attrs: { "xml:id": newId() }, children: [] };
      for (const attr of ["dur", "dots", "dur.ppq", "tstamp"]) {
        const v = hit.el.attrs[attr];
        if (v !== undefined) rest.attrs[attr] = v;
      }
      const parentPath = pathTo(measure, hit.parent);
      if (!parentPath) continue;
      hit.parent.children[hit.at] = rest;
      this.mementos.push({ measureIndex: ref.measureIndex, staffN: ref.staffN, parentPath, at: hit.at, original: hit.el, replacement: rest });
    }
    return this.mementos.map((m) => ({ measureIndex: m.measureIndex, staffN: m.staffN }));
  }

  revert(ctx: CommandContext): DirtyRegion[] {
    // Revert in reverse order so nested/sibling positions stay valid.
    for (const m of [...this.mementos].reverse()) {
      const measure = ctx.score.measures[m.measureIndex];
      if (!measure) continue;
      const parent = resolvePath(measure, m.parentPath);
      parent.children[m.at] = m.original;
    }
    return this.mementos.map((m) => ({ measureIndex: m.measureIndex, staffN: m.staffN }));
  }
}

/* ------------------------------------------------------------------ */

export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  execute(ctx: CommandContext, cmd: Command): DirtyRegion[] {
    const dirty = cmd.apply(ctx);
    this.undoStack.push(cmd);
    this.redoStack = [];
    return dirty;
  }

  undo(ctx: CommandContext): DirtyRegion[] | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    const dirty = cmd.revert(ctx);
    this.redoStack.push(cmd);
    return dirty;
  }

  redo(ctx: CommandContext): DirtyRegion[] | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    const dirty = cmd.apply(ctx);
    this.undoStack.push(cmd);
    return dirty;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoDepth(): number {
    return this.undoStack.length;
  }
}
