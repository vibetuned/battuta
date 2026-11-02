/**
 * The stylus host service (capability "stylus", 1.3.0, 2026-10-29): the
 * Apple Pencil and the S Pen, captured natively by the iOS and Android
 * shells and handed to a plugin already read against the score.
 *
 * While capture is on, the pen writes ON THE SCORE and nowhere else (the
 * user's rule): a stroke that begins over the measures in edit view is the
 * plugin's, and the page never sees it; a stroke that begins anywhere else
 * — the toolbar, a panel, the on-screen keyboard, a menu open over the
 * score — taps like a finger. Fingers always scroll, zoom and tap.
 *
 * Every event carries `at`: where it falls on the score — the measure, the
 * nearest staff, the event (note, chord or rest) nearest the pen on that
 * staff, the height as steps above the staff's bottom line and the pitch
 * there under the clef in force, and the point in the tile's own pixels,
 * the frame the overlays point draws in. Null off the measures.
 */
import type { Disposable } from "./disposable.js";
import type { Pitch } from "./document.js";

/** One sample: page pixels, ms, pressure 0–1, altitude and azimuth in radians, roll (radians) where the pen reports it. */
export type StylusSample = readonly [x: number, y: number, t: number, pressure: number, altitude: number, azimuth: number, roll: number | null];

/** A page point read against the score in edit view. */
export interface StylusScorePoint {
  /** 0-based index of the measure under the point. */
  measureIndex: number;
  /** The staff nearest the point in that measure. */
  staffN: number;
  /** The event on that staff nearest the point across — what `core.enterNote` writes over; null on an empty staff. */
  eventId: string | null;
  /** Steps above the staff's bottom line: 0 the line, 1 the space above it, negative below. */
  step: number;
  /** The written pitch at that step under the clef in force — letter and octave; the key signature supplies its accidental. Null under a clef that names none. */
  pitch: Pitch | null;
  /** The point in the tile's own pixels — `TileOverlayProps`' frame, for drawing there. */
  tile: { x: number; y: number };
  /** The staff's geometry in page px (1.3.5): the distance between two of its lines, and its middle line's y. */
  staff: { space: number; middleY: number };
  /** The measure's barlines in page px (1.3.5): where the staff's lines begin and end. */
  measure: { left: number; right: number };
  /** The note nearest the point within 8 staff spaces (1.3.5), by its body — its notehead, stem and flag; every head and the stem of its chord, for a chord's note; without accidentals, dots or articulations (1.3.8, as granita measures a note) — so a mark under a stem-down note finds it: the note's own id (a chord's note names itself, not the chord), its HEAD's centre in page px, where the pitch is, that body's `box` in page px (1.3.8), and its written `pitch` — a chord's note its own, with its accidental when written (1.3.9; null when the note has none). Null when none is that near. */
  nearestNote: { eventId: string; x: number; y: number; box: { left: number; top: number; right: number; bottom: number }; pitch: Pitch | null } | null;
  /** The mark nearest the point within 8 staff spaces, by its engraving (1.3.7): one that stands on its own beside its event — a dynamic, a fingering, a fermata, an ornament (trill, mordent, turn, arpeggio) or a repeat mark — with its id, which `core.erase` takes, and its centre in page px. Not a pedal, nor an articulation, accidental or dot, which are part of their note. Null when none is that near. */
  nearestMark: { id: string; kind: "dynamic" | "fingering" | "fermata" | "ornament" | "repeatMark"; x: number; y: number } | null;
}

export type StylusEvent =
  /** A stroke: samples batched once per screen frame, `down` first; `at` is its last sample's place. `predicted` are the system's guesses ahead (iPadOS). */
  | { type: "stroke"; phase: "down" | "move" | "up" | "cancel"; id: number; samples: readonly StylusSample[]; predicted: readonly StylusSample[]; at: StylusScorePoint | null }
  /** The pen held still where stroke `id` landed — within 8 px for half a second. Sent once; the stroke's `up` ends it. */
  | { type: "hold"; id: number; x: number; y: number; at: StylusScorePoint | null }
  /** The pen above the glass, height 0–1. */
  | { type: "hover"; phase: "enter" | "move" | "leave"; x: number; y: number; height: number; at: StylusScorePoint | null }
  /** The Pencil Pro's squeeze (down, up) and double-tap (tap); the S Pen's side button (down, up). Where the pen was, when the system says. */
  | { type: "button"; button: "squeeze" | "doubleTap" | "side"; phase: "down" | "up" | "tap"; x: number | null; y: number | null; height: number | null; at: StylusScorePoint | null };

/**
 * Where a symbol sits, in staff spaces — granita's `SymbolContext`, which the
 * shell turns into the model's vector (1.3.5). Everything in it comes from a
 * `StylusScorePoint`: the staff, the measure and the nearest note's body.
 */
export interface StylusSymbolContext {
  /** The symbol's centre from the staff's middle line; down is positive. */
  yStaff: number;
  /** 0 at the left barline, 1 at the right. */
  xMeasure: number;
  /** Distance to the nearest barline. */
  barline: number;
  /** The centre minus the centre of the nearest note's body (`nearestNote.box`, 1.3.8; its head before); null with no note within 8 spaces. */
  noteDx: number | null;
  noteDy: number | null;
  /** That body's width and height (1.3.8); null with no note. */
  noteW: number | null;
  noteH: number | null;
  /** The symbol's box. */
  width: number;
  height: number;
}

/** A symbol to read (1.3.5): its strokes in page px, the staff space in page px, and where it sits — null when unknown, which the model was trained for too. */
export interface StylusRecognizeRequest {
  strokes: readonly (readonly (readonly [x: number, y: number])[])[];
  staffSpace: number;
  context: StylusSymbolContext | null;
}

/** One of the classifier's answers (1.3.5): a class of granita's sidecar and its confidence, 0–1. */
export interface StylusRecognition {
  label: string;
  confidence: number;
}

/**
 * A handwritten symbol with the class the user confirmed (1.3.10): what
 * `ctx.stylus.reply` saves for the dataset — the shell writes musicset's
 * contribution record (label, writer, staff space, the strokes with their
 * times and pressures, the context, what the classifier read) to its replies
 * file. A label a person chose: ✓ tapped, a choice picked — never a silence.
 */
export interface StylusReply {
  /** granita's class the user confirmed. */
  label: string;
  /** The symbol's strokes as the pen gave them: every sample, time and pressure included. */
  strokes: readonly (readonly StylusSample[])[];
  staffSpace: number;
  context: StylusSymbolContext | null;
  /** What the classifier read first, before the user replied; null when it read nothing. */
  read: StylusRecognition | null;
}

/** What `ctx.stylus.train` did (1.3.10). */
export interface StylusTraining {
  /** Replies on the device, and how many the replay buffer took (the newest few of each class). */
  replies: number;
  buffer: number;
  /** The anchors the layer was held to. */
  anchors: number;
  /** Mean cross-entropy over the buffer, the share of it the trained layer gets right, and the mean drift from the original layer's answers on the anchors. */
  loss: number;
  accuracy: number;
  drift: number;
}

/** The replies on the device and the layer in use (`ctx.stylus.replies`, 1.3.11). */
export interface StylusReplies {
  /** Replies kept on the device, and how many the replay buffer would take of them (the newest few of each class the classifier knows). */
  replies: number;
  buffer: number;
  /** The last training, while its layer is in use; null with the released classifier. */
  training: StylusTraining | null;
}

export interface StylusService {
  /** True in the iOS and Android shells, which capture the stylus; false on the desktop and in a browser — do nothing there. */
  readonly available: boolean;
  /** Take the pen's strokes on the score (on) or give them back (off). Off again when the plugin deactivates. */
  capture(on: boolean): Promise<void>;
  /** Every event while capture is on; the disposable unsubscribes. */
  on(listener: (event: StylusEvent) => void): Disposable;
  /** Where a page point falls on the score, read as the events' `at` are (1.3.5). Null off the measures, with no document open, and before the service has loaded — it loads with the first `capture` or `on`. */
  at(x: number, y: number): StylusScorePoint | null;
  /** The shell's classifier, granita, on a symbol (1.3.5): its classes by confidence, best first. Rejects on the desktop and in a shell without the model. */
  recognize(request: StylusRecognizeRequest): Promise<readonly StylusRecognition[]>;
  /** Save a confirmed symbol for the dataset (1.3.10): the shell appends musicset's record to its replies file; resolves to the replies it holds. */
  reply(reply: StylusReply): Promise<number>;
  /** Retrain the classifier's last layer on the device from every reply (1.3.10): a small replay buffer of them, held to the model's anchors and its original weights. The trained layer is kept and `recognize` uses it from then on, until `resetTraining`. */
  train(): Promise<StylusTraining>;
  /** The original layer back, the trained one forgotten (1.3.10). */
  resetTraining(): Promise<void>;
  /** The replies file handed to the system share sheet (1.3.10); true when the user sent it somewhere. */
  shareReplies(): Promise<boolean>;
  /** The replies on the device, how many the buffer would take, and the training in use (1.3.11). Rejects where there is no stylus shell. */
  replies(): Promise<StylusReplies>;
  /** Every reply on the device deleted; the layer in use is left alone — `resetTraining` for that (1.3.11). */
  deleteReplies(): Promise<void>;
}
