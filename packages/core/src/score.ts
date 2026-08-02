/**
 * Score structure: locate the performed score and flatten its flow into an
 * ordered stream of definition changes and measures. This stream is what the
 * effective-context resolver consumes.
 */
import { CoreElement, childElements, findAll, findFirst } from "./xml.js";

export interface DefItem {
  kind: "def";
  el: CoreElement; // <scoreDef> or <staffDef> appearing in the flow
}
export interface MeasureItem {
  kind: "measure";
  el: CoreElement;
  index: number; // 0-based index among measures
}
export type ScoreItem = DefItem | MeasureItem;

export interface CoreScore {
  /** The initial <scoreDef> (staff structure, initial context). */
  scoreDef: CoreElement;
  /** Defs and measures in flow order, excluding the initial scoreDef. */
  items: ScoreItem[];
  /** Convenience view of just the measures, in order. */
  measures: CoreElement[];
  /** Number of <mdiv>s found; only the first is loaded (Phase 1 limit). */
  mdivCount: number;
}

/**
 * Build a CoreScore from an MEI root (<mei>, <music>, or <score>).
 * Headers can embed <incip> scores, so the search goes through <music> when
 * present. Critical-apparatus containers contribute only their preferred
 * child (<lem> over first <rdg>; <corr>/<reg> over first child of <choice>).
 */
export function buildScore(root: CoreElement): CoreScore {
  let scope = root.tag === "music" || root.tag === "score" ? root : findFirst(root, "music") ?? root;
  const mdivs = scope.tag === "score" ? [] : findAll(scope, "mdiv");
  const mdivCount = mdivs.length;
  if (mdivs.length > 0) scope = mdivs[0]!;
  const score = scope.tag === "score" ? scope : findFirst(scope, "score");
  if (!score) throw new Error("no <score> found");

  const items: ScoreItem[] = [];
  const measures: CoreElement[] = [];
  let initialScoreDef: CoreElement | null = null;

  const walk = (el: CoreElement): void => {
    for (const child of childElements(el)) {
      switch (child.tag) {
        case "measure":
          items.push({ kind: "measure", el: child, index: measures.length });
          measures.push(child);
          break;
        case "scoreDef":
        case "staffDef":
          if (!initialScoreDef && child.tag === "scoreDef") initialScoreDef = child;
          else items.push({ kind: "def", el: child });
          break;
        case "app": {
          const pick = childElements(child).find((c) => c.tag === "lem") ?? childElements(child).find((c) => c.tag === "rdg");
          if (pick) walk(pick);
          break;
        }
        case "choice": {
          const kids = childElements(child);
          const pick = kids.find((c) => c.tag === "corr") ?? kids.find((c) => c.tag === "reg") ?? kids[0];
          if (pick) walk(pick);
          break;
        }
        default:
          // section, ending, expansion targets, editorial wrappers, …
          walk(child);
      }
    }
  };
  walk(score);

  if (!initialScoreDef) throw new Error("no <scoreDef> found in score");
  return { scoreDef: initialScoreDef, items, measures, mdivCount };
}
