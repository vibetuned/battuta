package com.vibetuned.battuta.mobile

import android.graphics.PointF
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Strokes to granita's 32 x 32 image, the way its `render_strokes` does it (phase 11,
 * M2; lifted from granita's Android test shell, then rewritten on 2026-11-02 without the
 * Canvas, which drew strokes fatter than Pillow): the strokes' bounding box centred on a
 * 96 px canvas, its longer side `fraction` of the canvas — the symbol's natural size, 3.0
 * staff spaces filling the canvas, as calibrated on the tablets — a 5 px pen drawn as
 * Pillow draws it, black on white; then Pillow's bilinear reduction to 32 px,
 * re-implemented exactly. Pixel 255 is paper, 0 ink.
 */
object StrokeRaster {
    const val CANVAS = 96
    const val SIZE = 32
    /** `max(2, round(96 * 0.05))`: the pen width that scored best on held-out writers. */
    const val PEN_WIDTH = 5f
    /** Staff spaces that fill the canvas (granita's `CANVAS_STAFF_SPACES`). */
    const val CANVAS_STAFF_SPACES = 3.0
    val FRACTION_RANGE = 0.08..0.9

    class Bounds(val minX: Double, val maxX: Double, val minY: Double, val maxY: Double) {
        val span get() = max(maxX - minX, maxY - minY)
        val centreX get() = 0.5 * (minX + maxX)
        val centreY get() = 0.5 * (minY + maxY)
    }

    fun bounds(strokes: List<List<PointF>>): Bounds {
        val points = strokes.flatten()
        require(points.isNotEmpty()) { "StrokeRaster needs at least one point" }
        return Bounds(
            points.minOf { it.x.toDouble() }, points.maxOf { it.x.toDouble() },
            points.minOf { it.y.toDouble() }, points.maxOf { it.y.toDouble() },
        )
    }

    /** `fraction_from_staff_space`: the longer side in staff spaces over the spaces that fill the canvas, clamped. */
    fun fraction(strokes: List<List<PointF>>, staffSpace: Double): Double =
        (bounds(strokes).span / (CANVAS_STAFF_SPACES * staffSpace)).coerceIn(FRACTION_RANGE)

    /**
     * The 96 x 96 drawing, row 0 at the top, 255 = paper — drawn the way Pillow draws it,
     * re-implemented (`Paper`): no Canvas setting gives the same pixels. Its wide line is a
     * polygon offset by `(width - 1) / 2` ROUNDED TO WHOLE PIXELS along each axis (a 45°
     * line comes out 2.8 px thick, an upright one 5), scan-converted on whole rows with the
     * ends rounded in; its `joint="curve"` a pie slice of radius `width / 2 - 1` at every
     * corner; its end dots ellipses in a box of whole pixels. Every coordinate is truncated
     * to a whole pixel first, as Pillow's C side does.
     */
    fun draw(strokes: List<List<PointF>>, fraction: Double): IntArray {
        val b = bounds(strokes)
        val scale = if (b.span > 1e-9) CANVAS * fraction / b.span else 0.0
        val half = CANVAS * 0.5
        val paper = Paper(CANVAS)
        val width = PEN_WIDTH.toInt()
        for (stroke in strokes) {
            if (stroke.isEmpty()) continue
            val pts = stroke.map { Pt(half + (it.x - b.centreX) * scale, half + (it.y - b.centreY) * scale) }
            if (pts.size >= 2) {
                // `draw.line(pts, width=5, joint="curve")`: each segment its own wide line…
                for (i in 0 until pts.size - 1) {
                    paper.wideLine(pts[i].x.toInt(), pts[i].y.toInt(), pts[i + 1].x.toInt(), pts[i + 1].y.toInt(), width)
                }
                // …then the joint at every inner point.
                for (i in 1 until pts.size - 1) paper.joint(pts[i - 1], pts[i], pts[i + 1], width.toDouble())
            }
            // Pillow dots both ends (a single point is a dot of the pen).
            val r = PEN_WIDTH * 0.45
            for (p in listOf(pts.first(), pts.last())) {
                paper.ellipse((p.x - r).toInt(), (p.y - r).toInt(), (p.x + r).toInt(), (p.y + r).toInt())
            }
        }
        return paper.pixels
    }

    /** A point on the canvas, unrounded. */
    class Pt(val x: Double, val y: Double)

    /** Pillow's rounding (`ROUND_UP`, `ROUND_DOWN` in its C drawing code): to the nearest whole number, halves away from zero and toward zero. */
    private fun roundUp(f: Double): Int = (if (f >= 0) floor(f + 0.5) else -floor(abs(f) + 0.5)).toInt()
    private fun roundDown(f: Double): Int = (if (f >= 0) ceil(f - 0.5) else -ceil(abs(f) - 0.5)).toInt()

    /**
     * A grey canvas drawn on the way Pillow's `ImageDraw` draws (its `Draw.c`): whole-pixel
     * coordinates, polygons filled row by row between the rounded-in crossings of their edges.
     */
    private class Paper(val side: Int) {
        val pixels = IntArray(side * side) { 255 }

        /** A polygon's edge as Pillow keeps it: its extent, and `x = x0 + (y - y0) * dx` in single precision. */
        class Edge(val x0: Int, val y0: Int, x1: Int, y1: Int) {
            val xmin = min(x0, x1)
            val xmax = max(x0, x1)
            val ymin = min(y0, y1)
            val ymax = max(y0, y1)
            val dx: Float = if (y0 == y1) 0f else (x1 - x0).toFloat() / (y1 - y0).toFloat()
            fun xAt(y: Int): Float = (y - y0).toFloat() * dx + x0.toFloat()
        }

        /** Ink from `x0` to `x1` inclusive on row `y`; nothing when `x0 > x1`, as Pillow's `hline`. */
        fun hline(x0: Int, y: Int, x1: Int) {
            if (y < 0 || y >= side || x0 > x1) return
            val a = max(0, x0)
            val b = min(side - 1, x1)
            for (x in a..b) pixels[y * side + x] = 0
        }

        fun point(x: Int, y: Int) {
            if (x in 0 until side && y in 0 until side) pixels[y * side + x] = 0
        }

        /**
         * Pillow's `polygon_generic` (no alpha, no even-odd): every row from the lowest to the
         * highest vertex inclusive, the edges' crossings sorted and paired, each pair inked from
         * the crossing rounded up to the one rounded down; flat edges drawn as they are; corners
         * that fall exactly on a whole pixel joined to the neighbouring edge as Pillow joins them.
         */
        fun polygon(edges: List<Edge>) {
            val table = ArrayList<Edge>()
            var ymin = side - 1
            var ymax = 0
            for (e in edges) {
                ymin = min(ymin, e.ymin)
                ymax = max(ymax, e.ymax)
                if (e.ymin == e.ymax) {
                    hline(e.xmin, e.ymin, e.xmax)
                    continue
                }
                table.add(e)
            }
            ymin = max(ymin, 0)
            ymax = min(ymax, side)
            if (ymin > ymax || table.isEmpty()) return
            for (y in ymin..ymax) {
                val xs = ArrayList<Float>()
                for ((i, cur) in table.withIndex()) {
                    if (y < cur.ymin || y > cur.ymax) continue
                    xs.add(cur.xAt(y))
                    if (y == cur.ymax && y < ymax) {
                        // Needed to draw consistent polygons
                        xs.add(xs[xs.size - 1])
                    } else if (cur.dx != 0f && xs.size % 2 == 0 && Math.round(xs[xs.size - 1]).toFloat() == xs[xs.size - 1]) {
                        // Connect discontiguous corners
                        for (k in 0 until i) {
                            val other = table[k]
                            if ((cur.dx > 0 && other.dx <= 0) || (cur.dx < 0 && other.dx >= 0)) continue
                            // Check if the two edges join to make a corner
                            if (xs[xs.size - 1] == other.xAt(y)) {
                                // Determine points from the edges on the next row — or, on the last row, the previous one
                                val offset = if (y == ymax) -1 else 1
                                val adjacent = cur.xAt(y + offset)
                                val adjacentOther = other.xAt(y + offset)
                                val joined = if (y == cur.ymax) {
                                    if (cur.dx > 0) max(adjacent, adjacentOther) + 1 else min(adjacent, adjacentOther) - 1
                                } else {
                                    if (cur.dx > 0) min(adjacent, adjacentOther) else max(adjacent, adjacentOther) + 1
                                }
                                if (k < xs.size) xs[k] = joined
                                break
                            }
                        }
                    }
                }
                xs.sort()
                var i = 1
                while (i < xs.size) {
                    hline(roundUp(xs[i - 1].toDouble()), y, roundDown(xs[i].toDouble()))
                    i += 2
                }
            }
        }

        /**
         * Pillow's `draw_wide_line`: the segment's polygon, its half width `(width - 1) / 2`
         * projected on each axis and rounded to whole pixels; a point for a zero-length one.
         */
        fun wideLine(x0: Int, y0: Int, x1: Int, y1: Int, width: Int) {
            val dx = x1 - x0
            val dy = y1 - y0
            if (dx == 0 && dy == 0) {
                point(x0, y0)
                return
            }
            val big = sqrt((dx * dx + dy * dy).toDouble())
            val small = (width - 1) / 2.0
            val ratioMax = roundUp(small) / big
            val ratioMin = roundDown(small) / big
            val dxmin = roundDown(ratioMin * dy)
            val dxmax = roundDown(ratioMax * dy)
            val dymin = roundDown(ratioMin * dx)
            val dymax = roundDown(ratioMax * dx)
            val v = listOf(
                intArrayOf(x0 - dxmin, y0 + dymax), intArrayOf(x1 - dxmin, y1 + dymax),
                intArrayOf(x1 + dxmax, y1 - dymin), intArrayOf(x0 + dxmax, y0 - dymin),
            )
            polygon((0 until 4).map { Edge(v[it][0], v[it][1], v[(it + 1) % 4][0], v[(it + 1) % 4][1]) })
        }

        /**
         * Pillow's ellipse in a box of whole pixels, both bounds inclusive — near enough: the
         * pixels whose centre lies within the ellipse that fills the box, a hair in. With
         * `start`/`end` (degrees from 3 o'clock, clockwise) the pie slice between them.
         */
        fun ellipse(x0: Int, y0: Int, x1: Int, y1: Int, start: Double? = null, end: Double? = null) {
            val cx = (x0 + x1 + 1) / 2.0
            val cy = (y0 + y1 + 1) / 2.0
            val rx = (x1 - x0 + 1) / 2.0 - 0.1
            val ry = (y1 - y0 + 1) / 2.0 - 0.1
            var sliceStart = 0.0
            var sliceSpan = 360.0
            if (start != null && end != null) {
                var e = end
                while (e < start) e += 360
                sliceStart = start
                sliceSpan = e - start
            }
            for (y in max(0, y0)..min(side - 1, y1)) {
                for (x in max(0, x0)..min(side - 1, x1)) {
                    val u = (x + 0.5 - cx) / rx
                    val v = (y + 0.5 - cy) / ry
                    if (u * u + v * v > 1) continue
                    if (sliceSpan < 360) {
                        val a = Math.toDegrees(atan2(y + 0.5 - cy, x + 0.5 - cx))
                        val rel = ((a - sliceStart) % 360 + 360) % 360
                        if (rel > sliceSpan) continue
                    }
                    pixels[y * side + x] = 0
                }
            }
        }

        /**
         * `ImageDraw.line`'s `joint="curve"`: at an inner point where the line turns, a pie
         * slice of radius `width / 2 - 1` over the outside of the corner, between the two
         * segments' normals — Pillow's own arithmetic, on the unrounded points.
         */
        fun joint(a: Pt, p: Pt, b: Pt, width: Double) {
            fun angle(s: Pt, e: Pt): Double = ((Math.toDegrees(atan2(e.x - s.x, s.y - e.y)) % 360) + 360) % 360
            val a0 = angle(a, p)
            val a1 = angle(p, b)
            if (a0 == a1) return // a straight line: no joint
            val flipped = (a1 > a0 && a1 - 180 > a0) || (a1 < a0 && a1 + 180 > a0)
            val start = if (flipped) a1 + 90 else a0 - 90
            val end = if (flipped) a0 + 90 else a1 - 90
            val h = width / 2 - 1
            ellipse((p.x - h).toInt(), (p.y - h).toInt(), (p.x + h).toInt(), (p.y + h).toInt(), start - 90, end - 90)
        }
    }

    /**
     * Pillow's `Image.resize((32, 32), BILINEAR)` on a 96 px image: a triangle filter
     * `in / out` pixels wide, each row's columns first, then each column's rows, each
     * pass rounded to 8 bits.
     */
    fun downsample(src: IntArray, n: Int = CANVAS, m: Int = SIZE): IntArray {
        val taps = pillowTaps(n, m)
        val mid = IntArray(n * m)
        for (y in 0 until n) for ((j, tap) in taps.withIndex()) {
            var acc = 0.0
            for ((k, w) in tap.weights.withIndex()) acc += w * src[y * n + tap.start + k]
            mid[y * m + j] = round8(acc)
        }
        val out = IntArray(m * m)
        for (x in 0 until m) for ((i, tap) in taps.withIndex()) {
            var acc = 0.0
            for ((k, w) in tap.weights.withIndex()) acc += w * mid[(tap.start + k) * m + x]
            out[i * m + x] = round8(acc)
        }
        return out
    }

    class Tap(val start: Int, val weights: DoubleArray)

    fun pillowTaps(inSize: Int, outSize: Int): List<Tap> {
        val scale = inSize.toDouble() / outSize
        val support = scale
        return (0 until outSize).map { out ->
            val centre = (out + 0.5) * scale
            val lo = max(0, (centre - support + 0.5).toInt())
            val hi = min(inSize, (centre + support + 0.5).toInt())
            val raw = DoubleArray(hi - lo) { k -> max(0.0, 1.0 - abs((lo + k - centre + 0.5) / scale)) }
            val total = raw.sum()
            Tap(lo, DoubleArray(raw.size) { raw[it] / total })
        }
    }

    private fun round8(v: Double): Int = floor(v + 0.5).toInt().coerceIn(0, 255)

    /** The whole pipeline: the model's 32 x 32 pixels. */
    fun render(strokes: List<List<PointF>>, fraction: Double): IntArray = downsample(draw(strokes, fraction))

    /** Pixels to the model's input: `(p / 255 - 0.5) / 0.5`. */
    fun normalize(pixels: IntArray): FloatArray = FloatArray(pixels.size) { (pixels[it] / 255f - 0.5f) / 0.5f }
}
