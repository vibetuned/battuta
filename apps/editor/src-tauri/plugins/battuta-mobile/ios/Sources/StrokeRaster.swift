import CoreGraphics
import Foundation

/// Strokes to granita's 32 x 32 image, the way its `render_strokes` does it (phase 11,
/// M2; lifted from granita's iOS test shell): the strokes' bounding box centred on a
/// 96 px canvas, its longer side `fraction` of the canvas — the symbol's natural size,
/// 3.0 staff spaces filling the canvas, as calibrated on the tablets — a 5 px pen on
/// whole pixels with no anti-aliasing, black on white; then Pillow's bilinear
/// reduction to 32 px, re-implemented exactly. Pixel 255 is paper, 0 ink.
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

  /// The 96 x 96 drawing, row 0 at the top, 255 = paper.
  static func draw(_ strokes: [[CGPoint]], fraction: Double) -> [UInt8] {
    let b = bounds(strokes)
    let scale = b.span > 1e-9 ? Double(canvas) * fraction / b.span : 0.0
    let (cx, cy) = b.centre
    let half = Double(canvas) * 0.5
    var pixels = [UInt8](repeating: 255, count: canvas * canvas)
    pixels.withUnsafeMutableBytes { buffer in
      guard
        let ctx = CGContext(
          data: buffer.baseAddress, width: canvas, height: canvas, bitsPerComponent: 8,
          bytesPerRow: canvas, space: CGColorSpaceCreateDeviceGray(),
          bitmapInfo: CGImageAlphaInfo.none.rawValue)
      else { preconditionFailure("no grey CGContext") }
      // Core Graphics puts y = 0 at the bottom row; the model reads row 0 as the top.
      ctx.translateBy(x: 0, y: CGFloat(canvas))
      ctx.scaleBy(x: 1, y: -1)
      ctx.setShouldAntialias(false)
      ctx.setAllowsAntialiasing(false)
      ctx.setStrokeColor(gray: 0, alpha: 1)
      ctx.setFillColor(gray: 0, alpha: 1)
      ctx.setLineWidth(penWidth)
      // Pillow's wide polyline has flat ends (the dots below round them) and a small
      // pie slice at a corner, which a bevel comes nearest to; it truncates every
      // coordinate to a whole pixel first, while Core Graphics addresses a pixel by
      // its centre.
      ctx.setLineCap(.butt)
      ctx.setLineJoin(.bevel)
      for stroke in strokes where !stroke.isEmpty {
        let raw = stroke.map {
          CGPoint(x: half + (Double($0.x) - cx) * scale, y: half + (Double($0.y) - cy) * scale)
        }
        let pts = raw.map { CGPoint(x: Double(Int($0.x)) + 0.5, y: Double(Int($0.y)) + 0.5) }
        if pts.count >= 2 {
          ctx.beginPath()
          ctx.addLines(between: pts)
          ctx.strokePath()
        }
        // Pillow dots both ends (a single point is a dot of the pen): an ellipse in a
        // box truncated to pixels, both bounds inclusive.
        let r = penWidth * 0.45
        for p in [raw.first!, raw.last!] {
          let x0 = Int(p.x - r), y0 = Int(p.y - r), x1 = Int(p.x + r), y1 = Int(p.y + r)
          ctx.fillEllipse(in: CGRect(x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1))
        }
      }
    }
    return pixels
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
