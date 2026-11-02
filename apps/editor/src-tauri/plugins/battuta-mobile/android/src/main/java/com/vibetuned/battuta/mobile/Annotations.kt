package com.vibetuned.battuta.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * A reply saved for the dataset (`ctx.stylus.reply`, 1.3.10): musicset's contribution
 * record (`musicset.strokes`: `label`, `writer`, `staff_space`, `strokes` with time and
 * pressure, `context`, `device`, `app`, `time`), the fraction the symbol was drawn at and
 * the classifier's answer before the reply. Lifted from granita's Android test shell,
 * without the shell's staff and notes: the context carries what granita needs of the score.
 */
class Reply(
    val label: String,
    val writer: String,
    val staffSpace: Double,
    /** One list per pen-down: `[x, y, t_ms, pressure]`. */
    val strokes: List<List<DoubleArray>>,
    val context: SymbolContext?,
    val fraction: Double,
    val predicted: GranitaModel.Top?,
    val device: String,
    val app: String,
    val time: String,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("label", label)
        put("writer", writer)
        put("staff_space", staffSpace)
        put("strokes", JSONArray().apply { for (s in strokes) put(JSONArray().apply { for (p in s) put(JSONArray().apply { for (v in p) put(v) }) }) })
        put("context", context?.let { c ->
            JSONObject().apply {
                put("y_staff", c.yStaff)
                put("x_measure", c.xMeasure)
                put("barline", c.barline)
                put("note_dx", c.noteDx ?: JSONObject.NULL)
                put("note_dy", c.noteDy ?: JSONObject.NULL)
                put("note_w", c.noteW ?: JSONObject.NULL)
                put("note_h", c.noteH ?: JSONObject.NULL)
                put("width", c.width)
                put("height", c.height)
            }
        } ?: JSONObject.NULL)
        put("fraction", fraction)
        put("predicted", predicted?.let { JSONObject().apply { put("label", it.label); put("confidence", it.confidence.toDouble()) } } ?: JSONObject.NULL)
        put("device", device)
        put("app", app)
        put("time", time)
    }

    companion object {
        private fun JSONObject.optDoubleOrNull(key: String): Double? = if (isNull(key)) null else getDouble(key)

        fun fromJson(j: JSONObject): Reply {
            val c = j.optJSONObject("context")
            val strokes = j.getJSONArray("strokes").let { ss ->
                List(ss.length()) { i -> ss.getJSONArray(i).let { st -> List(st.length()) { k -> st.getJSONArray(k).let { p -> DoubleArray(p.length()) { p.getDouble(it) } } } } }
            }
            return Reply(
                j.getString("label"),
                j.getString("writer"),
                j.getDouble("staff_space"),
                strokes,
                c?.let { SymbolContext(it.getDouble("y_staff"), it.getDouble("x_measure"), it.getDouble("barline"), it.optDoubleOrNull("note_dx"), it.optDoubleOrNull("note_dy"), it.getDouble("width"), it.getDouble("height"), it.optDoubleOrNull("note_w"), it.optDoubleOrNull("note_h")) },
                j.getDouble("fraction"),
                j.optJSONObject("predicted")?.let { GranitaModel.Top(it.getString("label"), "", it.getDouble("confidence").toFloat()) },
                j.optString("device", ""),
                j.optString("app", ""),
                j.optString("time", ""),
            )
        }
    }
}

/**
 * The replies on this device: `stylus/replies.jsonl` in the app's files (the share sheet
 * sends it), one record a line, appended as they come. The writer id is this install's,
 * a UUID kept in the preferences.
 */
class Annotations(context: Context) {
    val directory: File = File(context.filesDir, "stylus").apply { mkdirs() }
    val file: File = File(directory, FILE_NAME)
    val writer: String
    var count: Int = if (file.isFile) file.readLines().count { it.isNotBlank() } else 0
        private set

    init {
        val prefs = context.getSharedPreferences("battuta.stylus", Context.MODE_PRIVATE)
        writer = prefs.getString("writer", null) ?: UUID.randomUUID().toString().lowercase(Locale.ROOT).also { prefs.edit().putString("writer", it).apply() }
    }

    fun append(reply: Reply) {
        file.appendText(reply.toJson().toString() + "\n")
        count++
    }

    /** Every reply in the file, in order; a line that does not parse is skipped. */
    fun all(): List<Reply> = if (file.isFile) file.readLines().filter { it.isNotBlank() }.mapNotNull { try { Reply.fromJson(JSONObject(it)) } catch (e: Exception) { null } } else emptyList()

    /** The file gone, the count with it (`ctx.stylus.deleteReplies`, 1.3.11). */
    fun deleteAll() {
        file.delete()
        count = 0
    }

    companion object {
        const val FILE_NAME = "replies.jsonl"

        fun now(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
    }
}

/**
 * What the last training did, kept beside the trained layer (`training.json`) so the
 * plugins page can show it after a restart (`ctx.stylus.replies`, 1.3.11).
 */
class TrainingRecord(val replies: Int, val buffer: Int, val anchors: Int, val loss: Double, val accuracy: Double, val drift: Double) {
    /** The fields into any JSON object — the invoke's answer, the file. */
    fun <T : JSONObject> into(o: T): T = o.apply {
        put("replies", replies); put("buffer", buffer); put("anchors", anchors)
        put("loss", loss); put("accuracy", accuracy); put("drift", drift)
    }

    fun save(file: File) = file.writeText(into(JSONObject()).toString())

    companion object {
        fun load(file: File): TrainingRecord? = try {
            if (!file.isFile) null else JSONObject(file.readText()).let { TrainingRecord(it.getInt("replies"), it.getInt("buffer"), it.getInt("anchors"), it.getDouble("loss"), it.getDouble("accuracy"), it.getDouble("drift")) }
        } catch (e: Exception) {
            null
        }
    }
}
