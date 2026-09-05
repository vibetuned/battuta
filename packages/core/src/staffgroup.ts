/**
 * Staff grouping — the <staffGrp> structure in the initial scoreDef.
 * One gesture cycles the group over a staff range:
 *
 *   none → brace (bar.thru) → bracket (bar.thru) → none
 *
 * "none → brace" wraps the range's staffDefs in a new group (they must
 * be contiguous siblings — a range crossing an existing group refuses);
 * "bracket → none" unwraps that group again, or, when the range IS an
 * existing group (the scoreDef's own root included), just clears its
 * symbol. Page view draws the symbol; bar.thru joins the barlines.
 */
import { CoreElement, childElements, findAll } from "./xml.js";
import { Command, CommandContext, DirtyRegion } from "./commands.js";
import { newId } from "./ids.js";

export type StaffGroupState = "none" | "brace" | "bracket";

const staffNs = (grp: CoreElement): number[] => findAll(grp, "staffDef").map((d) => Number(d.attrs["n"] ?? "0"));
const sameSet = (a: number[], b: number[]): boolean => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

function parentOf(root: CoreElement, el: CoreElement): CoreElement | null {
  for (const c of childElements(root)) {
    if (c === el) return root;
    const p = parentOf(c, el);
    if (p) return p;
  }
  return null;
}

export class CycleStaffGroupCommand implements Command {
  readonly label: string;
  /** The state after apply — the UI's notice text. */
  result: StaffGroupState = "none";
  private memento: { el: CoreElement; beforeAttrs: Record<string, string> } | { parent: CoreElement; before: (CoreElement | string)[] } | null = null;

  constructor(
    private readonly staffFrom: number,
    private readonly staffTo: number,
  ) {
    this.label = `staff group ${staffFrom}–${staffTo}`;
  }

  apply(ctx: CommandContext): DirtyRegion[] {
    const scoreDef = ctx.score.scoreDef;
    const want: number[] = [];
    for (let n = this.staffFrom; n <= this.staffTo; n++) want.push(n);
    // bar.thru changes barlines everywhere the group reaches: dirty the
    // whole staff range across all measures.
    const dirty: DirtyRegion[] = ctx.score.measures.flatMap((_, i) => want.map((n) => ({ measureIndex: i, staffN: n })));

    const grps = [scoreDef, ...findAll(scoreDef, "staffGrp")].filter((g) => g.tag === "staffGrp");
    const match = grps.find((g) => sameSet(staffNs(g), want));
    if (match) {
      const sym = match.attrs["symbol"];
      if (sym === "bracket") {
        // → none: unwrap a nested wrapper; the top-level group must stay
        // (scoreDef needs its staffGrp), so there just clear the symbol.
        const parent = parentOf(scoreDef, match);
        if (parent && parent.tag === "staffGrp") {
          this.memento = { parent, before: [...parent.children] };
          const at = parent.children.indexOf(match);
          parent.children.splice(at, 1, ...match.children.filter((c) => typeof c !== "string"));
        } else {
          this.memento = { el: match, beforeAttrs: { ...match.attrs } };
          delete match.attrs["symbol"];
          delete match.attrs["bar.thru"];
        }
        this.result = "none";
      } else {
        this.memento = { el: match, beforeAttrs: { ...match.attrs } };
        match.attrs["symbol"] = sym === "brace" ? "bracket" : "brace";
        match.attrs["bar.thru"] = "true";
        this.result = match.attrs["symbol"] as StaffGroupState;
      }
      return dirty;
    }

    // No group covers exactly this range: wrap. The staffDefs must be
    // contiguous siblings under one parent — anything else would cross
    // an existing group, which has no honest interpretation.
    const defs = want.map((n) => findAll(scoreDef, "staffDef").find((d) => Number(d.attrs["n"]) === n));
    if (defs.some((d) => !d)) throw new Error(`no staff ${want.find((n, i) => !defs[i])}`);
    const parent = parentOf(scoreDef, defs[0]!) ?? scoreDef;
    if (defs.some((d) => parentOf(scoreDef, d!) !== parent)) throw new Error("that range would cross an existing staff group");
    const siblings = childElements(parent).filter((c) => c.tag === "staffDef" || c.tag === "staffGrp");
    const first = siblings.indexOf(defs[0]!);
    for (let i = 1; i < defs.length; i++) {
      if (siblings[first + i] !== defs[i]) throw new Error("staves must be adjacent to group them");
    }
    this.memento = { parent, before: [...parent.children] };
    const grp: CoreElement = { tag: "staffGrp", attrs: { "xml:id": newId(), symbol: "brace", "bar.thru": "true" }, children: [...defs] as CoreElement[] };
    const from = parent.children.indexOf(defs[0]!);
    const to = parent.children.indexOf(defs[defs.length - 1]!);
    parent.children.splice(from, to - from + 1, grp);
    this.result = "brace";
    return dirty;
  }

  revert(_ctx: CommandContext): DirtyRegion[] {
    if (!this.memento) return [];
    if ("beforeAttrs" in this.memento) this.memento.el.attrs = this.memento.beforeAttrs;
    else this.memento.parent.children = this.memento.before;
    return [];
  }
}
