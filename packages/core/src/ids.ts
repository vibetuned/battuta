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
