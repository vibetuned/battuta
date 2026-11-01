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
  /** The notehead nearest the point within 8 staff spaces (1.3.5): the note's own id — a chord's note names itself, not the chord — and its head's centre in page px. Null when none is that near. */
  nearestNote: { eventId: string; x: number; y: number } | null;
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
 * `StylusScorePoint`: the staff, the measure and the nearest notehead.
 */
export interface StylusSymbolContext {
  /** The symbol's centre from the staff's middle line; down is positive. */
  yStaff: number;
  /** 0 at the left barline, 1 at the right. */
  xMeasure: number;
  /** Distance to the nearest barline. */
  barline: number;
  /** The centre minus the nearest notehead's centre; null with no notehead within 8 spaces. */
  noteDx: number | null;
  noteDy: number | null;
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
}
