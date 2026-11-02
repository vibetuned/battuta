import CoreGraphics
import Foundation

/// Strokes to granita's 32 x 32 image, the way its `render_strokes` does it (phase 11,
/// M2; lifted from granita's iOS test shell, then rewritten on 2026-11-02 without Core
/// Graphics, which drew every stroke fatter than Pillow and read a quarter rest as an
/// arpeggio): the strokes' bounding box centred on a 96 px canvas, its longer side
/// `fraction` of the canvas — the symbol's natural size, 3.0 staff spaces filling the
/// canvas, as calibrated on the tablets — a 5 px pen drawn as Pillow draws it, black
/// on white; then Pillow's bilinear reduction to 32 px, re-implemented exactly. Pixel
/// 255 is paper, 0 ink.
enum StrokeRaster {
  static let canvas = 96
  static let size = 32
  /// `max(2, round(96 * 0.05))`: the pen width that scored best on held-out writers.
  static let penWidth = 5.0
  /// Staff spaces that fill the canvas (granita's `CANVAS_STAFF_SPACES`).
  static let canvasStaffSpaces = 3.0
  static let fractionRange = 0.08...0.9

  struct Bounds {
    let minX, maxX, minY, maxY: Double
    var span: Double { max(maxX - minX, maxY - minY) }
    var centre: (x: Double, y: Double) { (0.5 * (minX + maxX), 0.5 * (minY + maxY)) }
  }

  static func bounds(_ strokes: [[CGPoint]]) -> Bounds {
    let points = strokes.flatMap { $0 }
    precondition(!points.isEmpty, "StrokeRaster needs at least one point")
    return Bounds(
      minX: points.map { Double($0.x) }.min()!, maxX: points.map { Double($0.x) }.max()!,
      minY: points.map { Double($0.y) }.min()!, maxY: points.map { Double($0.y) }.max()!)
  }

  /// `fraction_from_staff_space`: the longer side in staff spaces over the spaces that fill the canvas, clamped.
  static func fraction(of strokes: [[CGPoint]], staffSpace: Double) -> Double {
    let raw = bounds(strokes).span / (canvasStaffSpaces * staffSpace)
    return min(fractionRange.upperBound, max(fractionRange.lowerBound, raw))
  }

  /// The 96 x 96 drawing, row 0 at the top, 255 = paper — drawn the way Pillow draws
  /// it, re-implemented (`Paper`): no Core Graphics setting gives the same pixels. Its
  /// wide line is a polygon offset by `(width - 1) / 2` ROUNDED TO WHOLE PIXELS along
  /// each axis (a 45° line comes out 2.8 px thick, an upright one 5), scan-converted
  /// on whole rows with the ends rounded in; its `joint="curve"` a pie slice of radius
  /// `width / 2 - 1` at every corner; its end dots ellipses in a box of whole pixels.
  /// Every coordinate is truncated to a whole pixel first, as Pillow's C side does.
  static func draw(_ strokes: [[CGPoint]], fraction: Double) -> [UInt8] {
    let b = bounds(strokes)
    let scale = b.span > 1e-9 ? Double(canvas) * fraction / b.span : 0.0
    let (cx, cy) = b.centre
    let half = Double(canvas) * 0.5
    var paper = Paper(side: canvas)
    let width = Int(penWidth)
    for stroke in strokes where !stroke.isEmpty {
      let pts = stroke.map { (x: half + (Double($0.x) - cx) * scale, y: half + (Double($0.y) - cy) * scale) }
      if pts.count >= 2 {
        // `draw.line(pts, width=5, joint="curve")`: each segment its own wide line…
        for i in 0..<(pts.count - 1) {
          paper.wideLine(Int(pts[i].x), Int(pts[i].y), Int(pts[i + 1].x), Int(pts[i + 1].y), width: width)
        }
        // …then the joint at every inner point.
        for i in 1..<(pts.count - 1) { paper.joint(pts[i - 1], pts[i], pts[i + 1], width: Double(width)) }
      }
      // Pillow dots both ends (a single point is a dot of the pen).
      let r = penWidth * 0.45
      for p in [pts.first!, pts.last!] {
        paper.ellipse(x0: Int(p.x - r), y0: Int(p.y - r), x1: Int(p.x + r), y1: Int(p.y + r))
      }
    }
    return paper.pixels
  }

  /// Pillow's rounding (`ROUND_UP`, `ROUND_DOWN` in its C drawing code): to the nearest whole number, halves away from zero and toward zero.
  private static func roundUp(_ f: Double) -> Int { Int(f >= 0 ? (f + 0.5).rounded(.down) : -(abs(f) + 0.5).rounded(.down)) }
  private static func roundDown(_ f: Double) -> Int { Int(f >= 0 ? (f - 0.5).rounded(.up) : -(abs(f) - 0.5).rounded(.up)) }

  /// A grey canvas drawn on the way Pillow's `ImageDraw` draws (its `Draw.c`): whole-pixel
  /// coordinates, polygons filled row by row between the rounded-in crossings of their edges.
  private struct Paper {
    let side: Int
    var pixels: [UInt8]

    init(side: Int) {
      self.side = side
      pixels = [UInt8](repeating: 255, count: side * side)
    }

    /// A polygon's edge as Pillow keeps it: its extent, and `x = x0 + (y - y0) * dx` in single precision.
    struct Edge {
      let xmin, xmax, ymin, ymax: Int
      let dx: Float
      let x0, y0: Int
      init(_ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int) {
        xmin = min(x0, x1); xmax = max(x0, x1); ymin = min(y0, y1); ymax = max(y0, y1)
        dx = y0 == y1 ? 0 : Float(x1 - x0) / Float(y1 - y0)
        self.x0 = x0; self.y0 = y0
      }
      func x(at y: Int) -> Float { Float(y - y0) * dx + Float(x0) }
    }

    /// Ink from `x0` to `x1` inclusive on row `y`; nothing when `x0 > x1`, as Pillow's `hline`.
    mutating func hline(_ x0: Int, _ y: Int, _ x1: Int) {
      guard y >= 0, y < side, x0 <= x1 else { return }
      let a = max(0, x0), b = min(side - 1, x1)
      guard a <= b else { return }
      for x in a...b { pixels[y * side + x] = 0 }
    }

    mutating func point(_ x: Int, _ y: Int) {
      if x >= 0 && x < side && y >= 0 && y < side { pixels[y * side + x] = 0 }
    }

    /// Pillow's `polygon_generic` (no alpha, no even-odd): every row from the lowest to the
    /// highest vertex inclusive, the edges' crossings sorted and paired, each pair inked from
    /// the crossing rounded up to the one rounded down; flat edges drawn as they are; corners
    /// that fall exactly on a whole pixel joined to the neighbouring edge as Pillow joins them.
    mutating func polygon(_ edges: [Edge]) {
      var table: [Edge] = []
      var ymin = side - 1, ymax = 0
      for e in edges {
        ymin = min(ymin, e.ymin)
        ymax = max(ymax, e.ymax)
        if e.ymin == e.ymax {
          hline(e.xmin, e.ymin, e.xmax)
          continue
        }
        table.append(e)
      }
      ymin = max(ymin, 0)
      ymax = min(ymax, side)
      guard ymin <= ymax, !table.isEmpty else { return }
      for y in ymin...ymax {
        var xs: [Float] = []
        for (i, cur) in table.enumerated() where y >= cur.ymin && y <= cur.ymax {
          xs.append(cur.x(at: y))
          if y == cur.ymax && y < ymax {
            // Needed to draw consistent polygons
            xs.append(xs[xs.count - 1])
          } else if cur.dx != 0 && xs.count % 2 == 0 && xs[xs.count - 1].rounded() == xs[xs.count - 1] {
            // Connect discontiguous corners
            for k in 0..<i {
              let other = table[k]
              if (cur.dx > 0 && other.dx <= 0) || (cur.dx < 0 && other.dx >= 0) { continue }
              // Check if the two edges join to make a corner
              if xs[xs.count - 1] == other.x(at: y) {
                // Determine points from the edges on the next row — or, on the last row, the previous one
                let offset = y == ymax ? -1 : 1
                let adjacent = cur.x(at: y + offset), adjacentOther = other.x(at: y + offset)
                let joined: Float
                if y == cur.ymax {
                  joined = cur.dx > 0 ? max(adjacent, adjacentOther) + 1 : min(adjacent, adjacentOther) - 1
                } else {
                  joined = cur.dx > 0 ? min(adjacent, adjacentOther) : max(adjacent, adjacentOther) + 1
                }
                if k < xs.count { xs[k] = joined }
                break
              }
            }
          }
        }
        xs.sort()
        var i = 1
        while i < xs.count {
          hline(StrokeRaster.roundUp(Double(xs[i - 1])), y, StrokeRaster.roundDown(Double(xs[i])))
          i += 2
        }
      }
    }

    /// Pillow's `draw_wide_line`: the segment's polygon, its half width `(width - 1) / 2`
    /// projected on each axis and rounded to whole pixels; a point for a zero-length one.
    mutating func wideLine(_ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int, width: Int) {
      let dx = x1 - x0, dy = y1 - y0
      if dx == 0 && dy == 0 {
        point(x0, y0)
        return
      }
      let big = Double(dx * dx + dy * dy).squareRoot()
      let small = Double(width - 1) / 2.0
      let ratioMax = Double(StrokeRaster.roundUp(small)) / big
      let ratioMin = Double(StrokeRaster.roundDown(small)) / big
      let dxmin = StrokeRaster.roundDown(ratioMin * Double(dy)), dxmax = StrokeRaster.roundDown(ratioMax * Double(dy))
      let dymin = StrokeRaster.roundDown(ratioMin * Double(dx)), dymax = StrokeRaster.roundDown(ratioMax * Double(dx))
      let v = [(x0 - dxmin, y0 + dymax), (x1 - dxmin, y1 + dymax), (x1 + dxmax, y1 - dymin), (x0 + dxmax, y0 - dymin)]
      polygon([Edge(v[0].0, v[0].1, v[1].0, v[1].1), Edge(v[1].0, v[1].1, v[2].0, v[2].1), Edge(v[2].0, v[2].1, v[3].0, v[3].1), Edge(v[3].0, v[3].1, v[0].0, v[0].1)])
    }

    /// Pillow's ellipse in a box of whole pixels, both bounds inclusive — near enough: the
    /// pixels whose centre lies within the ellipse that fills the box, a hair in. With
    /// `start`/`end` (degrees from 3 o'clock, clockwise) the pie slice between them.
    mutating func ellipse(x0: Int, y0: Int, x1: Int, y1: Int, from start: Double? = nil, to end: Double? = nil) {
      let cx = Double(x0 + x1 + 1) / 2, cy = Double(y0 + y1 + 1) / 2
      let rx = Double(x1 - x0 + 1) / 2 - 0.1, ry = Double(y1 - y0 + 1) / 2 - 0.1
      var sliceStart = 0.0, sliceSpan = 360.0
      if let s = start, var e = end {
        while e < s { e += 360 }
        sliceStart = s
        sliceSpan = e - s
      }
      for y in max(0, y0)...max(max(0, y0), min(side - 1, y1)) where y <= y1 {
        for x in max(0, x0)...max(max(0, x0), min(side - 1, x1)) where x <= x1 {
          let u = (Double(x) + 0.5 - cx) / rx, v = (Double(y) + 0.5 - cy) / ry
          guard u * u + v * v <= 1 else { continue }
          if sliceSpan < 360 {
            let a = atan2(Double(y) + 0.5 - cy, Double(x) + 0.5 - cx) * 180 / .pi
            let rel = ((a - sliceStart).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
            guard rel <= sliceSpan else { continue }
          }
          pixels[y * side + x] = 0
        }
      }
    }

    /// `ImageDraw.line`'s `joint="curve"`: at an inner point where the line turns, a pie
    /// slice of radius `width / 2 - 1` over the outside of the corner, between the two
    /// segments' normals — Pillow's own arithmetic, on the unrounded points.
    mutating func joint(_ a: (x: Double, y: Double), _ p: (x: Double, y: Double), _ b: (x: Double, y: Double), width: Double) {
      func angle(_ s: (x: Double, y: Double), _ e: (x: Double, y: Double)) -> Double {
        let d = atan2(e.x - s.x, s.y - e.y) * 180 / .pi
        return ((d.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360)
      }
      let a0 = angle(a, p), a1 = angle(p, b)
      if a0 == a1 { return } // a straight line: no joint
      let flipped = (a1 > a0 && a1 - 180 > a0) || (a1 < a0 && a1 + 180 > a0)
      let (start, end) = flipped ? (a1 + 90, a0 + 90) : (a0 - 90, a1 - 90)
      let h = width / 2 - 1
      ellipse(x0: Int(p.x - h), y0: Int(p.y - h), x1: Int(p.x + h), y1: Int(p.y + h), from: start - 90, to: end - 90)
    }
  }

  /// Pillow's `Image.resize((32, 32), BILINEAR)` on a 96 px image: a triangle filter
  /// `in / out` pixels wide, each row's columns first, then each column's rows, each pass
  /// rounded to 8 bits.
  static func downsample(_ src: [UInt8], from n: Int = canvas, to m: Int = size) -> [UInt8] {
    let taps = pillowTaps(inSize: n, outSize: m)
    var mid = [UInt8](repeating: 0, count: n * m)
    for y in 0..<n {
      for (j, tap) in taps.enumerated() {
        var acc = 0.0
        for (k, w) in tap.weights.enumerated() { acc += w * Double(src[y * n + tap.start + k]) }
        mid[y * m + j] = round8(acc)
      }
    }
    var out = [UInt8](repeating: 0, count: m * m)
    for x in 0..<m {
      for (i, tap) in taps.enumerated() {
        var acc = 0.0
        for (k, w) in tap.weights.enumerated() { acc += w * Double(mid[(tap.start + k) * m + x]) }
        out[i * m + x] = round8(acc)
      }
    }
    return out
  }

  static func pillowTaps(inSize: Int, outSize: Int) -> [(start: Int, weights: [Double])] {
    let scale = Double(inSize) / Double(outSize)
    let support = scale
    return (0..<outSize).map { out in
      let centre = (Double(out) + 0.5) * scale
      let lo = max(0, Int(centre - support + 0.5))
      let hi = min(inSize, Int(centre + support + 0.5))
      let raw = (lo..<hi).map { max(0.0, 1.0 - abs((Double($0) - centre + 0.5) / scale)) }
      let total = raw.reduce(0, +)
      return (lo, raw.map { $0 / total })
    }
  }

  private static func round8(_ v: Double) -> UInt8 { UInt8(max(0, min(255, (v + 0.5).rounded(.down)))) }

  /// The whole pipeline: the model's 32 x 32 pixels.
  static func render(_ strokes: [[CGPoint]], fraction: Double) -> [UInt8] {
    downsample(draw(strokes, fraction: fraction))
  }

  /// Pixels to the model's input: `(p / 255 - 0.5) / 0.5`.
  static func normalize(_ pixels: [UInt8]) -> [Float] {
    pixels.map { (Float($0) / 255 - 0.5) / 0.5 }
  }
}
