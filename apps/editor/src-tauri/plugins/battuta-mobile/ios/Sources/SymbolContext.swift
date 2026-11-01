import Foundation

/// Where a mark sits in the score, in staff spaces — granita's `SymbolContext` and
/// `context_vector` (granita/context.py), kept identical. The facts come from the page
/// (`ctx.stylus.recognize`'s context); the vector is built here (phase 11, M2).
struct SymbolContext {
  /// Centre from the staff's middle line, positive downwards.
  var yStaff: Double
  /// 0 at the left barline, 1 at the right.
  var xMeasure: Double
  /// Distance to the nearest barline.
  var barline: Double
  /// Centre minus the nearest notehead's centre; nil without one.
  var noteDx: Double?
  var noteDy: Double?
  var width: Double
  var height: Double

  /// Staff spaces within which a notehead counts as the symbol's neighbour.
  static let noteRange = 8.0
  /// Half the staff's height: a centre within this of the middle line is inside the lines.
  static let staffHalfHeight = 2.0
  /// Offset from the notehead's centre from which the symbol counts as beside, above or below it.
  static let noteSide = 0.5
  /// |noteDx| below this: the symbol is in the note's column.
  static let noteColumn = 1.0
  static let dim = 16
  /// What to send when nothing is known: all zeros, the valid flag included.
  static let unknown = [Float](repeating: 0, count: dim)

  /// The model's `context` input: sixteen floats roughly in [-1, 1] (granita's
  /// `CONTEXT_FEATURES` order): valid, in / above / below the staff, height, measure
  /// position, barline distance, notehead near, symbol above / below / left / right of it,
  /// its offset, width, height.
  var vector: [Float] {
    let hasNote = noteDx != nil && noteDy != nil
    let dx = noteDx ?? 0
    let dy = noteDy ?? 0
    let inColumn = hasNote && abs(dx) < Self.noteColumn
    func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Float { Float(max(lo, min(hi, v))) }
    func flag(_ on: Bool) -> Float { on ? 1 : 0 }
    return [
      1,
      flag(abs(yStaff) <= Self.staffHalfHeight),
      flag(yStaff < -Self.staffHalfHeight),
      flag(yStaff > Self.staffHalfHeight),
      clamp(yStaff / 6, -2, 2),
      clamp(xMeasure * 2 - 1, -1, 1),
      clamp(barline / 8, 0, 1),
      flag(hasNote),
      flag(inColumn && dy <= -Self.noteSide),
      flag(inColumn && dy >= Self.noteSide),
      flag(hasNote && dx <= -Self.noteSide),
      flag(hasNote && dx >= Self.noteSide),
      clamp(dx / Self.noteRange, -1, 1),
      clamp(dy / Self.noteRange, -1, 1),
      clamp(width / 8, 0, 1.5),
      clamp(height / 8, 0, 1.5),
    ]
  }
}
