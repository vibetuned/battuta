package com.vibetuned.battuta.mobile

import android.annotation.SuppressLint
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.view.MotionEvent
import android.webkit.WebView
import app.tauri.plugin.Channel
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.hypot

/**
 * The stylus bridge's native half on Android (1.3.0, phase 11).
 *
 * While capture is ON, every S Pen stroke that begins inside `area` (the
 * score, as the page says) is battuta's and the WebView never sees it: the
 * touch listener consumes the whole gesture from the pen's first touch to its
 * last, fingers that land meanwhile included (a palm). A pen stroke that
 * begins elsewhere taps like a finger, and fingers on their own still
 * scroll, zoom and tap (the user's rules, 2026-10-29: the pen writes,
 * fingers scroll; the pen writes only on the score). The stylus probe showed why it
 * must: left to the page, a drawn line became a scroll after 57 ms and a long
 * press a context menu, at a fifth of the samples. A pen joining a gesture
 * fingers began is left to the WebView: taking it would cut that gesture in
 * half. What goes down the channel — the same events as iOS:
 *
 *   stroke  down / move / up / cancel, the samples batched once per screen
 *           frame: [x, y, t, pressure, altitude, azimuth, roll] — page pixels
 *           (dp: the WebView's CSS pixels), ms, 0–1, radians, roll null
 *           (Android reports none) — and no predicted samples
 *   hold    the tip within 8 dp of where it landed for 0.5 s
 *   hover   enter / move / leave with the height (0–1, the distance over the
 *           pen's range), once per frame
 *   button  the S Pen's side button (down, up), with where the pen is
 */
internal class StylusCapture(private val view: WebView, private var channel: Channel) {
    private val density = view.resources.displayMetrics.density
    /** Where the pen writes, in dp (the page's CSS pixels); empty: nowhere. */
    var area: List<RectF> = emptyList()
    private val main = Handler(Looper.getMainLooper())
    private var on = false
    private var nextStroke = 0
    private var stroke: Stroke? = null
    private var samples = JSArray()
    private var hover: JSObject? = null
    private var hoverIn = false
    private var buttons = 0
    private var frameAsked = false

    private class Stroke(val id: Int, val pointer: Int, val x0: Float, val y0: Float) {
        var reach = 0f
        var held = false
    }

    companion object {
        const val HOLD_REACH = 8f
        const val HOLD_MS = 500L
    }

    init {
        install()
    }

    fun update(channel: Channel) {
        this.channel = channel
    }

    fun set(on: Boolean) {
        this.on = on
        if (!on) {
            stroke = null
            samples = JSArray()
            hover = null
            hoverIn = false
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun install() {
        view.setOnTouchListener { _, e -> on && touch(e) }
        view.setOnHoverListener { _, e ->
            if (on) hovered(e)
            false // the page may see the pen hover: it acts on nothing
        }
    }

    private fun isPen(e: MotionEvent, i: Int) =
        e.getToolType(i) == MotionEvent.TOOL_TYPE_STYLUS || e.getToolType(i) == MotionEvent.TOOL_TYPE_ERASER

    // --- what goes down the channel ---

    private fun send(o: JSObject) {
        channel.send(o)
    }

    private fun sample(x: Float, y: Float, t: Long, pressure: Float, tilt: Float, orientation: Float): JSONArray {
        val azimuth = ((orientation + PI / 2) % (2 * PI) + 2 * PI) % (2 * PI)
        return JSONArray().apply {
            put((x / density).toDouble())
            put((y / density).toDouble())
            put(t.toDouble())
            put(pressure.coerceIn(0f, 1f).toDouble())
            put(PI / 2 - tilt)
            put(azimuth)
            put(JSONObject.NULL)
        }
    }

    private fun flush(s: Stroke, phase: String) {
        send(JSObject().apply {
            put("type", "stroke")
            put("phase", phase)
            put("id", s.id)
            put("samples", samples)
            put("predicted", JSArray())
        })
        samples = JSArray()
    }

    private fun askFrame() {
        if (frameAsked) return
        frameAsked = true
        Choreographer.getInstance().postFrameCallback {
            frameAsked = false
            val s = stroke
            if (s != null && samples.length() > 0) flush(s, "move")
            hover?.let {
                send(it)
                hover = null
            }
        }
    }

    // --- strokes ---

    /** True when the event is the pen's: consumed, so the WebView never sees it. */
    private fun touch(e: MotionEvent): Boolean {
        val s = stroke
        if (s == null) {
            // Only a gesture the pen begins (ACTION_DOWN: the first pointer) on the score is taken.
            if (e.actionMasked != MotionEvent.ACTION_DOWN || !isPen(e, 0)) return false
            if (area.none { it.contains(e.getX(0) / density, e.getY(0) / density) }) return false
            nextStroke += 1
            val taken = Stroke(nextStroke, e.getPointerId(0), e.getX(0) / density, e.getY(0) / density)
            stroke = taken
            samples = JSArray().apply { put(sample(e.getX(0), e.getY(0), e.eventTime, e.getPressure(0), e.getAxisValue(MotionEvent.AXIS_TILT, 0), e.getAxisValue(MotionEvent.AXIS_ORIENTATION, 0))) }
            flush(taken, "down")
            watchButtons(e, 0, null)
            main.postDelayed({
                if (stroke === taken && !taken.held && taken.reach <= HOLD_REACH) {
                    taken.held = true
                    send(JSObject().apply {
                        put("type", "hold")
                        put("id", taken.id)
                        put("x", taken.x0.toDouble())
                        put("y", taken.y0.toDouble())
                    })
                }
            }, HOLD_MS)
            return true
        }
        val i = e.findPointerIndex(s.pointer)
        when (e.actionMasked) {
            MotionEvent.ACTION_MOVE -> if (i >= 0) {
                for (h in 0 until e.historySize) {
                    add(s, e.getHistoricalX(i, h), e.getHistoricalY(i, h), e.getHistoricalEventTime(h), e.getHistoricalPressure(i, h),
                        e.getHistoricalAxisValue(MotionEvent.AXIS_TILT, i, h), e.getHistoricalAxisValue(MotionEvent.AXIS_ORIENTATION, i, h))
                }
                add(s, e.getX(i), e.getY(i), e.eventTime, e.getPressure(i), e.getAxisValue(MotionEvent.AXIS_TILT, i), e.getAxisValue(MotionEvent.AXIS_ORIENTATION, i))
                watchButtons(e, i, null)
                askFrame()
            }
            MotionEvent.ACTION_POINTER_UP -> if (e.getPointerId(e.actionIndex) == s.pointer) end(e, e.actionIndex, "up")
            MotionEvent.ACTION_UP -> end(e, e.actionIndex, "up")
            MotionEvent.ACTION_CANCEL -> end(e, if (i >= 0) i else 0, "cancel")
        }
        return true // the whole gesture is the pen's, fingers that joined it included
    }

    private fun add(s: Stroke, x: Float, y: Float, t: Long, pressure: Float, tilt: Float, orientation: Float) {
        s.reach = maxOf(s.reach, hypot(x / density - s.x0, y / density - s.y0))
        samples.put(sample(x, y, t, pressure, tilt, orientation))
    }

    private fun end(e: MotionEvent, i: Int, phase: String) {
        val s = stroke ?: return
        samples.put(sample(e.getX(i), e.getY(i), e.eventTime, e.getPressure(i), e.getAxisValue(MotionEvent.AXIS_TILT, i), e.getAxisValue(MotionEvent.AXIS_ORIENTATION, i)))
        flush(s, phase)
        stroke = null
    }

    // --- hover and the side button ---

    private fun hovered(e: MotionEvent) {
        val i = (0 until e.pointerCount).firstOrNull { isPen(e, it) } ?: return
        val range = e.device?.getMotionRange(MotionEvent.AXIS_DISTANCE)?.max ?: 0f
        val height = if (range > 0) (e.getAxisValue(MotionEvent.AXIS_DISTANCE, i) / range).coerceIn(0f, 1f) else 0f
        watchButtons(e, i, height)
        val phase = when (e.actionMasked) {
            MotionEvent.ACTION_HOVER_ENTER -> "enter"
            MotionEvent.ACTION_HOVER_MOVE -> "move"
            MotionEvent.ACTION_HOVER_EXIT -> "leave"
            else -> return
        }
        val o = JSObject().apply {
            put("type", "hover")
            put("phase", phase)
            put("x", (e.getX(i) / density).toDouble())
            put("y", (e.getY(i) / density).toDouble())
            put("height", height.toDouble())
        }
        when (phase) {
            "move" -> if (hoverIn) {
                hover = o
                askFrame()
            }
            "enter" -> {
                hoverIn = true
                send(o)
            }
            else -> {
                hoverIn = false
                hover = null
                send(o)
            }
        }
    }

    private fun watchButtons(e: MotionEvent, i: Int, height: Float?) {
        val side = e.buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY
        if (side == buttons) return
        buttons = side
        send(JSObject().apply {
            put("type", "button")
            put("button", "side")
            put("phase", if (side != 0) "down" else "up")
            put("x", (e.getX(i) / density).toDouble())
            put("y", (e.getY(i) / density).toDouble())
            put("height", height?.toDouble() ?: JSONObject.NULL)
        })
    }
}
