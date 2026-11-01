package com.vibetuned.battuta.mobile

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Strokes to granita's 32 x 32 image, the way its `render_strokes` does it (phase 11,
 * M2; lifted from granita's Android test shell): the strokes' bounding box centred on a
 * 96 px canvas, its longer side `fraction` of the canvas — the symbol's natural size, 3.0
 * staff spaces filling the canvas, as calibrated on the tablets — a 5 px pen with round
 * caps and joins and no anti-aliasing, black on white; then Pillow's bilinear reduction
 * to 32 px, re-implemented exactly. Pixel 255 is paper, 0 ink.
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

    /** The 96 x 96 drawing, row 0 at the top, 255 = paper. */
    fun draw(strokes: List<List<PointF>>, fraction: Double): IntArray {
        val b = bounds(strokes)
        val scale = if (b.span > 1e-9) CANVAS * fraction / b.span else 0.0
        val half = CANVAS * 0.5
        val bitmap = Bitmap.createBitmap(CANVAS, CANVAS, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.WHITE)
        val canvas = Canvas(bitmap)
        val pen = Paint().apply {
            color = Color.BLACK
            isAntiAlias = false
            style = Paint.Style.STROKE
            strokeWidth = PEN_WIDTH
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        val dot = Paint().apply {
            color = Color.BLACK
            isAntiAlias = false
            style = Paint.Style.FILL
        }
        for (stroke in strokes) {
            if (stroke.isEmpty()) continue
            val pts = stroke.map { PointF((half + (it.x - b.centreX) * scale).toFloat(), (half + (it.y - b.centreY) * scale).toFloat()) }
            if (pts.size >= 2) {
                val path = Path()
                path.moveTo(pts[0].x, pts[0].y)
                for (p in pts.drop(1)) path.lineTo(p.x, p.y)
                canvas.drawPath(path, pen)
            }
            // Pillow dots both ends (a single point is a dot of the pen).
            val r = PEN_WIDTH * 0.45f
            for (p in listOf(pts.first(), pts.last())) canvas.drawCircle(p.x, p.y, r, dot)
        }
        val argb = IntArray(CANVAS * CANVAS)
        bitmap.getPixels(argb, 0, CANVAS, 0, 0, CANVAS, CANVAS)
        bitmap.recycle()
        return IntArray(argb.size) { argb[it] and 0xFF } // grey: black or white, any channel
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
