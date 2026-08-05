/**
 * @battuta/core — MEI document core.
 *
 * Constraints (enforced by tsconfig: lib=[ES2022], types=[]):
 *  - No DOM, no I/O, no framework imports. Pure logic over a serializable API.
 *  - Every element keeps its xml:id; ids are the universal currency.
 */

export const CORE_VERSION = "0.1.0";

export { fromDom, serialize, serializeDocument, deepClone, findFirst, findAll, childElements, hashString, COMMENT_TAG, PI_TAG } from "./xml.js";
export type { CoreElement, DomLikeElement, DomLikeNode } from "./xml.js";

export { buildScore, refreshScore } from "./score.js";
export type { CoreScore, ScoreItem, DefItem, MeasureItem } from "./score.js";

export { frac, fAdd, fMul, fEq, fCmp, F0, eventDuration, layerDuration, meterCapacity, validateMeasureDurations, decomposeDuration } from "./durations.js";
export type { Fraction, LayerDuration, DurationProblem } from "./durations.js";

export { ReplaceEntryCommand, AddChordNoteCommand, ToggleTieCommand, ToggleArticCommand, ToggleDynamCommand, MergeEventsCommand, SplitEventCommand, CycleDynamCommand, ChangeDurationCommand } from "./entry.js";
export type { EntrySpec } from "./entry.js";

export { normalizeBlock, copyBlock, fragmentToText, materializeStaff, findStaffInMeasure } from "./clipboard.js";
export type { BlockSelection, ClipboardFragment, ClipboardStaff } from "./clipboard.js";

export { planPasteReplace, PasteReplaceMeasuresCommand, InsertMeasuresCommand, DeleteMeasuresCommand, DuplicateMeasuresCommand, emptyMeasureLike } from "./arrange.js";
export type { PastePlan } from "./arrange.js";

export { resolveContexts, contextHash } from "./context.js";
export type { MeasureContext, StaffContext, ClefContext, MeterContext } from "./context.js";

export { synthesizeTile, synthesizeScoreDef, synthesizeRowHeader } from "./tile.js";
export type { TileSlice, TileHeader, TileHeaderSpec } from "./tile.js";

export { newId, ensureIds } from "./ids.js";

export { EVENT_TAGS, EventIndex, buildEventIndex, caretLeft, caretRight, caretVertical, eventRange } from "./events.js";
export type { CaretPosition, EventRef } from "./events.js";

export { CommandStack, TransposeStepCommand, TransposeOctaveCommand, ToggleAccidentalCommand, DeleteToRestsCommand } from "./commands.js";
export type { Command, CommandContext, DirtyRegion } from "./commands.js";
