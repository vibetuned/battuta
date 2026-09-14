/**
 * The host's answers to `DocumentQueries`, as pure functions over the
 * session's model — shared with the App so the editor's own rules and the
 * ones plugins see are the same code.
 */
import type { BlockSelection } from "@battuta/api";
import type { EventIndex } from "@battuta/core";

/** The measure × staff rectangle a set of event ids covers, or null when none is known. */
export function blockOfEvents(index: EventIndex, ids: readonly string[]): BlockSelection | null {
  let mFrom = Infinity;
  let mTo = -1;
  let sFrom = Infinity;
  let sTo = -1;
  for (const id of ids) {
    const r = index.byId.get(id);
    if (!r) continue;
    mFrom = Math.min(mFrom, r.measureIndex);
    mTo = Math.max(mTo, r.measureIndex);
    sFrom = Math.min(sFrom, r.staffN);
    sTo = Math.max(sTo, r.staffN);
  }
  return mTo < 0 ? null : { measureFrom: mFrom, measureTo: mTo, staffFrom: sFrom, staffTo: sTo };
}
