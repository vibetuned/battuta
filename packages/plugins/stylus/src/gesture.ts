/**
 * The pen's gesture as a pure function: stylus events in, the cross's state
 * and, when the pen lifts, the note to write out. No host, no React — the
 * plugin feeds it `ctx.stylus` events and draws what it returns.
 *
 *   - The pen landing on a staff puts up the cross at once (the user,
 *     2026-10-29: waiting for a hold was too slow), at the pitch under the
 *     pen and the input's length — the one digits 1–7 pick and the dot
 *     adds. Dragging right makes the note longer and left shorter, a step
 *     per `STEP_X` px, its dots kept; up and down move it by staff step —
 *     the pitch under the pen, while it stays on the staff it landed on.
 *   - Lifting writes it, as one undo step; a length the drag changed
 *     becomes the input's, as a digit would make it. A TAP is a lift where
 *     the pen landed: the input's length at the pitch under the pen.
 *   - The Pencil Pro's squeeze or the S Pen's side button ARMS the next
 *     stroke (the user, 2026-10-29: "like a shift"): its pitch joins the
 *     note or chord under the pen instead of writing over it — the cross
 *     follows the pitch only, and the length is the note's
 *     own. Pressing again before the pen lands disarms; pressing while it
 *     is down (the S Pen's button held as it touches) arms that stroke.
 *   - A stroke that lands off a staff, or is cancelled, writes nothing.
 */
import type { AddChordNoteMessage, EnterNoteMessage, Pitch, StylusEvent, StylusScorePoint } from "@battuta/api";

/** Written durations, shortest first: left is shorter, right longer. */
export const DURATIONS = ["64", "32", "16", "8", "4", "2", "1"] as const;
export type Duration = (typeof DURATIONS)[number];
export const DURATION_NAMES: Record<Duration, string> = { "1": "whole", "2": "half", "4": "quarter", "8": "eighth", "16": "16th", "32": "32nd", "64": "64th" };
/** Pixels of drag per duration step. */
export const STEP_X = 36;
/** Pixels the pen moves from where it landed before the small cross unfolds into its cells (the user, 2026-11-12). */
export const UNFOLD_PX = 12;

/** A note length: a written duration and its dots. */
export interface Length {
  dur: Duration;
  dots: number;
}

/** The input's length as the editor reports it; a quarter for one the pen cannot write. */
export function lengthOf(dur: string, dots: number): Length {
  const d = DURATIONS.find((x) => x === dur);
  return d ? { dur: d, dots: Number.isInteger(dots) && dots >= 0 && dots <= 2 ? dots : 0 } : { dur: "4", dots: 0 };
}

/** "dotted quarter", "half". */
export const lengthName = (l: Length): string => `${l.dots === 1 ? "dotted " : l.dots === 2 ? "double-dotted " : ""}${DURATION_NAMES[l.dur]}`;

/** Where a stroke landed: on an event of a staff, with a pitch there. */
export interface Landing {
  id: number;
  x: number;
  y: number;
  at: StylusScorePoint & { eventId: string; pitch: Pitch };
}

export interface Choice extends Length {
  step: number;
  pitch: Pitch;
}

export type Gesture =
  /** No pen on the score; `armed`: the next stroke joins a chord. */
  | { kind: "idle"; armed: boolean }
  /** The pen is on a staff: the cross is up, showing what lifting it writes; `from` is the input's duration's index; `chord`: it joins the note under the pen; `unfolded`: the pen has moved past `UNFOLD_PX` — the small cross opened into its cells, and stays open until the lift. */
  | { kind: "cross"; landing: Landing; choice: Choice; from: number; chord: boolean; unfolded: boolean }
  /** A stroke that writes nothing, until it ends; the arming waits for the next. */
  | { kind: "ignored"; id: number; armed: boolean };

export const IDLE: Gesture = { kind: "idle", armed: false };

export interface Step {
  gesture: Gesture;
  /** What to write, when the pen lifted from the cross: a note, or a pitch joining a chord. */
  write?: EnterNoteMessage | AddChordNoteMessage;
  /** The input's new length, when the drag changed it. */
  length?: Length;
}

const landed = (at: StylusScorePoint | null): at is Landing["at"] => at !== null && at.eventId !== null && at.pitch !== null;

/** The stroke's id, for an event that belongs to one. */
const strokeOf = (g: Gesture): number | null => (g.kind === "idle" ? null : g.kind === "ignored" ? g.id : g.landing.id);

const enter = (landing: Landing, pitch: Pitch, l: Length): EnterNoteMessage => ({ type: "core.enterNote", eventId: landing.at.eventId, pname: pitch.pname, oct: pitch.oct, dur: l.dur, ...(l.dots > 0 && { dots: l.dots }) });

/**
 * Same staff, same row of tiles: the frame of the tile under `at` sits
 * where the landing's does, so a step there is a step on the landing's
 * staff. (Another row's staff of the same number is not.)
 */
const sameStaff = (landing: Landing, at: StylusScorePoint, y: number): boolean => at.staffN === landing.at.staffN && Math.abs(y - at.tile.y - (landing.y - landing.at.tile.y)) < 2;

/** The next state for one event; `input` is the input's length now. */
export function next(g: Gesture, e: StylusEvent, input: Length): Step {
  if (e.type === "stroke") {
    const sample = e.samples[e.samples.length - 1];
    if (e.phase === "down") {
      const armed = g.kind === "idle" && g.armed;
      if (!sample || !landed(e.at)) return { gesture: { kind: "ignored", id: e.id, armed } };
      const landing = { id: e.id, x: sample[0], y: sample[1], at: e.at };
      return { gesture: { kind: "cross", landing, choice: { ...input, step: e.at.step, pitch: e.at.pitch }, from: DURATIONS.indexOf(input.dur), chord: armed, unfolded: false } };
    }
    if (strokeOf(g) !== e.id) return { gesture: g };
    if (e.phase === "cancel") return { gesture: IDLE };
    if (g.kind === "cross") {
      let choice = g.choice;
      const unfolded = g.unfolded || (sample !== undefined && Math.hypot(sample[0] - g.landing.x, sample[1] - g.landing.y) > UNFOLD_PX);
      if (sample) {
        const steps = g.chord ? 0 : Math.round((sample[0] - g.landing.x) / STEP_X);
        const dur = DURATIONS[Math.max(0, Math.min(DURATIONS.length - 1, g.from + steps))]!;
        const at = e.at;
        const onStaff = at !== null && at.pitch !== null && sameStaff(g.landing, at, sample[1]);
        choice = { dur, dots: choice.dots, step: onStaff ? at.step : choice.step, pitch: onStaff ? at.pitch! : choice.pitch };
      }
      if (e.phase === "up") {
        if (g.chord) return { gesture: IDLE, write: { type: "core.addChordNote", eventId: g.landing.at.eventId, pname: choice.pitch.pname, oct: choice.pitch.oct } };
        return { gesture: IDLE, write: enter(g.landing, choice.pitch, choice), ...(choice.dur !== DURATIONS[g.from] && { length: { dur: choice.dur, dots: choice.dots } }) };
      }
      return { gesture: choice.dur === g.choice.dur && choice.step === g.choice.step && unfolded === g.unfolded ? g : { ...g, choice, unfolded } };
    }
    return e.phase === "up" && g.kind === "ignored" ? { gesture: { kind: "idle", armed: g.armed } } : { gesture: g };
  }
  // The squeeze or the side button, pressed: arm the next stroke, or the one on the glass — or disarm.
  if (e.type === "button" && e.phase === "down" && (e.button === "squeeze" || e.button === "side")) {
    if (g.kind === "cross") return { gesture: { ...g, chord: !g.chord, choice: g.chord ? g.choice : { ...g.choice, dur: DURATIONS[g.from]!, dots: input.dots } } };
    return { gesture: { ...g, armed: !g.armed } };
  }
  return { gesture: g };
}
