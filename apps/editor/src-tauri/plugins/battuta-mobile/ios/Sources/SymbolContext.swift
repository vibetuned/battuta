import Foundation

/// Where a mark sits in the score, in staff spaces — granita's `SymbolContext` and
/// `context_vector` (granita/context.py, v8), kept identical. The facts come from the
/// page (`ctx.stylus.recognize`'s context); the vector is built here (phase 11, M2).
/// The note is measured by its body — notehead, stem and flag; a chord's — without
/// accidentals, dots or articulations: the offsets are from the body's centre.
struct SymbolContext {
  /// Centre from the staff's middle line, positive downwards.
  var yStaff: Double
  /// 0 at the left barline, 1 at the right.
  var xMeasure: Double
  /// Distance to the nearest barline.
  var barline: Double
  /// Centre minus the centre of the nearest note's body; nil without one.
  var noteDx: Double?
  var noteDy: Double?
  var width: Double
  var height: Double
  /// Width and height of that body; nil without one.
  var noteW: Double? = nil
  var noteH: Double? = nil

  /// Staff spaces within which a note's body counts as the symbol's neighbour.
  static let noteRange = 8.0
  /// Half the staff's height: a centre within this of the middle line is inside the lines.
  static let staffHalfHeight = 2.0
  /// Staff spaces the symbol may stick out past the body's sides and still count as above
  /// or below it (or past its top and bottom and still count as left or right of it).
  static let noteMargin = 0.5
  static let dim = 16
  /// What to send when nothing is known: all zeros, the valid flag included.
  static let unknown = [Float](repeating: 0, count: dim)

  /// The model's `context` input: sixteen floats roughly in [-1, 1] (granita's
  /// `CONTEXT_FEATURES` order): valid, in / above / below the staff, height, measure
  /// position, barline distance, note near, symbol above / below / left / right of its body,
  /// its offset, width, height.
  var vector: [Float] {
    let hasNote = noteDx != nil && noteDy != nil
    let dx = noteDx ?? 0
    let dy = noteDy ?? 0
    let hw = 0.5 * (noteW ?? 0)
    let hh = 0.5 * (noteH ?? 0)
    let over = hasNote && abs(dx) <= hw + Self.noteMargin
    let beside = hasNote && abs(dy) <= hh + Self.noteMargin
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
      flag(over && dy < -hh),
      flag(over && dy > hh),
      flag(beside && dx < -hw),
      flag(beside && dx > hw),
      clamp(dx / Self.noteRange, -1, 1),
      clamp(dy / Self.noteRange, -1, 1),
      clamp(width / 8, 0, 1.5),
      clamp(height / 8, 0, 1.5),
    ]
  }
}
