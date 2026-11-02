package com.vibetuned.battuta.mobile

import kotlin.math.abs

/**
 * Where a mark sits in the score, in staff spaces: granita's `SymbolContext` and
 * `context_vector` (granita/context.py, v8), kept identical. The facts come from the page
 * (`ctx.stylus.recognize`'s context); the vector is built here (phase 11, M2). The note is
 * measured by its body (notehead, stem and flag; a chord's) without accidentals, dots or
 * articulations: the offsets are from the body's centre.
 */
data class SymbolContext(
    /** Centre from the staff's middle line, positive downwards. */
    val yStaff: Double,
    /** 0 at the left barline, 1 at the right. */
    val xMeasure: Double,
    /** Distance to the nearest barline. */
    val barline: Double,
    /** Centre minus the centre of the nearest note's body; null without one. */
    val noteDx: Double?,
    val noteDy: Double?,
    val width: Double,
    val height: Double,
    /** Width and height of that body; null without one. */
    val noteW: Double? = null,
    val noteH: Double? = null,
) {
    /**
     * The model's `context` input: sixteen floats roughly in [-1, 1] (granita's
     * `CONTEXT_FEATURES` order): valid, in / above / below the staff, height, measure
     * position, barline distance, note near, symbol above / below / left / right of its body,
     * its offset, width, height.
     */
    fun vector(): FloatArray {
        val hasNote = noteDx != null && noteDy != null
        val dx = noteDx ?: 0.0
        val dy = noteDy ?: 0.0
        val hw = 0.5 * (noteW ?: 0.0)
        val hh = 0.5 * (noteH ?: 0.0)
        val over = hasNote && abs(dx) <= hw + NOTE_MARGIN
        val beside = hasNote && abs(dy) <= hh + NOTE_MARGIN
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
            flag(over && dy < -hh),
            flag(over && dy > hh),
            flag(beside && dx < -hw),
            flag(beside && dx > hw),
            clamp(dx / NOTE_RANGE, -1.0, 1.0),
            clamp(dy / NOTE_RANGE, -1.0, 1.0),
            clamp(width / 8, 0.0, 1.5),
            clamp(height / 8, 0.0, 1.5),
        )
    }

    companion object {
        /** Staff spaces within which a note's body counts as the symbol's neighbour. */
        const val NOTE_RANGE = 8.0
        /** Half the staff's height: a centre within this of the middle line is inside the lines. */
        const val STAFF_HALF_HEIGHT = 2.0
        /**
         * Staff spaces the symbol may stick out past the body's sides and still count as above
         * or below it (or past its top and bottom and still count as left or right of it).
         */
        const val NOTE_MARGIN = 0.5
        const val DIM = 16
        /** What to send when nothing is known: all zeros, the valid flag included. */
        val UNKNOWN = FloatArray(DIM)
    }
}
