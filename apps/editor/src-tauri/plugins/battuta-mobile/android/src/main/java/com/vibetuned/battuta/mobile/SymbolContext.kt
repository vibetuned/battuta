package com.vibetuned.battuta.mobile

import kotlin.math.abs

/**
 * Where a mark sits in the score, in staff spaces: granita's `SymbolContext` and
 * `context_vector` (granita/context.py), kept identical. The facts come from the page
 * (`ctx.stylus.recognize`'s context); the vector is built here (phase 11, M2).
 */
data class SymbolContext(
    /** Centre from the staff's middle line, positive downwards. */
    val yStaff: Double,
    /** 0 at the left barline, 1 at the right. */
    val xMeasure: Double,
    /** Distance to the nearest barline. */
    val barline: Double,
    /** Centre minus the nearest notehead's centre; null without one. */
    val noteDx: Double?,
    val noteDy: Double?,
    val width: Double,
    val height: Double,
) {
    /**
     * The model's `context` input: sixteen floats roughly in [-1, 1] (granita's
     * `CONTEXT_FEATURES` order): valid, in / above / below the staff, height, measure
     * position, barline distance, notehead near, symbol above / below / left / right of it,
     * its offset, width, height.
     */
    fun vector(): FloatArray {
        val hasNote = noteDx != null && noteDy != null
        val dx = noteDx ?: 0.0
        val dy = noteDy ?: 0.0
        val inColumn = hasNote && abs(dx) < NOTE_COLUMN
        fun clamp(v: Double, lo: Double, hi: Double) = v.coerceIn(lo, hi).toFloat()
        fun flag(on: Boolean) = if (on) 1f else 0f
        return floatArrayOf(
            1f,
            flag(abs(yStaff) <= STAFF_HALF_HEIGHT),
            flag(yStaff < -STAFF_HALF_HEIGHT),
            flag(yStaff > STAFF_HALF_HEIGHT),
            clamp(yStaff / 6, -2.0, 2.0),
            clamp(xMeasure * 2 - 1, -1.0, 1.0),
            clamp(barline / 8, 0.0, 1.0),
            flag(hasNote),
            flag(inColumn && dy <= -NOTE_SIDE),
            flag(inColumn && dy >= NOTE_SIDE),
            flag(hasNote && dx <= -NOTE_SIDE),
            flag(hasNote && dx >= NOTE_SIDE),
            clamp(dx / NOTE_RANGE, -1.0, 1.0),
            clamp(dy / NOTE_RANGE, -1.0, 1.0),
            clamp(width / 8, 0.0, 1.5),
            clamp(height / 8, 0.0, 1.5),
        )
    }

    companion object {
        /** Staff spaces within which a notehead counts as the symbol's neighbour. */
        const val NOTE_RANGE = 8.0
        /** Half the staff's height: a centre within this of the middle line is inside the lines. */
        const val STAFF_HALF_HEIGHT = 2.0
        /** Offset from the notehead's centre from which the symbol counts as beside, above or below it. */
        const val NOTE_SIDE = 0.5
        /** |noteDx| below this: the symbol is in the note's column. */
        const val NOTE_COLUMN = 1.0
        const val DIM = 16
        /** What to send when nothing is known: all zeros, the valid flag included. */
        val UNKNOWN = FloatArray(DIM)
    }
}
