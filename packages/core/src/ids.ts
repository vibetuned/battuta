/**
 * xml:id management. Ids are the universal currency of the system: every
 * event the editor can address must have one. Files from the corpus mostly
 * carry ids already; anything missing gets one on import.
 */
import { CoreElement, childElements } from "./xml.js";

let counter = 0;

/** Generate a fresh editor-assigned id (unique within this process). */
export function newId(): string {
  return `bt-${(++counter).toString(36)}`;
}

/**
 * Bump the id counter past every bt-* id already in the tree. Documents
 * saved by earlier sessions carry such ids, and a fresh counter would
 * re-mint them — one duplicate id makes the caret project onto the wrong
 * measure and pulls foreign slurs/dynamics onto new empty measures. Call
 * once per loaded document; the counter only ever moves forward.
 */
export function seedIds(el: CoreElement): void {
  const id = el.attrs["xml:id"];
  const m = id ? /^bt-([0-9a-z]+)$/.exec(id) : null;
  if (m) {
    const v = parseInt(m[1]!, 36);
    if (Number.isFinite(v) && v > counter) counter = v;
  }
  for (const c of childElements(el)) seedIds(c);
}

/** Recursively assign xml:id to every element that lacks one. */
export function ensureIds(el: CoreElement): number {
  let assigned = 0;
  if (!el.attrs["xml:id"]) {
    el.attrs["xml:id"] = newId();
    assigned++;
  }
  for (const c of childElements(el)) assigned += ensureIds(c);
  return assigned;
}
