package com.vibetuned.battuta.mobile

import android.content.res.AssetManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.ln
import kotlin.math.max

/**
 * The last layer, `Linear(128 -> classes)`, as the shell holds it: the sidecar's weights to
 * start with, then what training on the user's replies made of them (`Trainer`). Lifted
 * from granita's Android test shell (phase 11, 2026-11-02), kept identical.
 */
class HeadWeights(weight: Array<FloatArray>, bias: FloatArray) {
    /** `classes` rows of `width` values. */
    val weight: Array<FloatArray> = Array(weight.size) { weight[it].copyOf() }
    val bias: FloatArray = bias.copyOf()
    val classes: Int get() = bias.size
    val width: Int get() = weight.firstOrNull()?.size ?: 0

    fun copy(): HeadWeights = HeadWeights(weight, bias)

    /** The rows laid end to end, the shape the tflite's `head_w` takes. */
    fun flatWeight(): FloatArray {
        val out = FloatArray(classes * width)
        for (c in 0 until classes) weight[c].copyInto(out, c * width)
        return out
    }

    /** The layer applied: `weight · features + bias`. */
    fun logits(features: FloatArray): FloatArray {
        require(features.size == width)
        return FloatArray(classes) { c ->
            var acc = bias[c]
            val row = weight[c]
            for (k in features.indices) acc += row[k] * features[k]
            acc
        }
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("weight", JSONArray().apply { for (row in weight) put(JSONArray().apply { for (v in row) put(v.toDouble()) }) })
        put("bias", JSONArray().apply { for (v in bias) put(v.toDouble()) })
    }

    fun save(file: File) {
        val tmp = File(file.path + ".tmp")
        tmp.writeText(toJson().toString())
        tmp.renameTo(file)
    }

    companion object {
        fun fromJson(json: JSONObject): HeadWeights {
            val rows = json.getJSONArray("weight")
            val bias = json.getJSONArray("bias")
            return HeadWeights(
                Array(rows.length()) { r -> rows.getJSONArray(r).let { row -> FloatArray(row.length()) { row.getDouble(it).toFloat() } } },
                FloatArray(bias.length()) { bias.getDouble(it).toFloat() },
            )
        }

        /** The app's trained copy on disk, if any; null when none was saved or it does not read. */
        fun load(file: File): HeadWeights? = try {
            if (file.isFile) fromJson(JSONObject(file.readText())) else null
        } catch (e: Exception) {
            null
        }
    }
}

/** One reply, as the trainer sees it: the features the model read for the drawing and the class the user named. */
class Example(val features: FloatArray, val label: Int)

/**
 * An anchor (anchors.json, scripts/export_anchors.py): features the released model read,
 * with the logits its own last layer gave them — what the trained layer is held to.
 */
class Anchor(val label: Int, val features: FloatArray, val logits: FloatArray)

class Anchors(val source: String, val anchors: List<Anchor>) {
    companion object {
        fun load(assets: AssetManager): Anchors? = try {
            val json = JSONObject(assets.open("anchors.json").bufferedReader().use { it.readText() })
            val list = json.getJSONArray("anchors")
            Anchors(
                json.optString("source", ""),
                List(list.length()) { i ->
                    val a = list.getJSONObject(i)
                    val f = a.getJSONArray("features")
                    val l = a.getJSONArray("logits")
                    Anchor(a.getInt("label"), FloatArray(f.length()) { f.getDouble(it).toFloat() }, FloatArray(l.length()) { l.getDouble(it).toFloat() })
                },
            )
        } catch (e: Exception) {
            null
        }
    }
}

/**
 * A tiny replay buffer: the newest `perClass` replies of every class, so one symbol
 * written fifty times does not drown the others and the old corrections stay in play.
 */
class ReplayBuffer(replies: List<Example>, perClass: Int = PER_CLASS) {
    val examples: List<Example>

    init {
        val kept = ArrayList<Example>()
        val count = HashMap<Int, Int>()
        for (e in replies.asReversed()) {
            if ((count[e.label] ?: 0) < perClass) {
                count[e.label] = (count[e.label] ?: 0) + 1
                kept.add(e)
            }
        }
        examples = kept.asReversed()
    }

    companion object {
        const val PER_CLASS = 8
    }
}

/**
 * The last layer trained on the device: gradient steps on the replay buffer's
 * cross-entropy, the anchors' answers held (the KL from the original layer's softmax to
 * the trained one, on every anchor, each epoch) and the weights pulled back toward the
 * original ones (an L2 anchor, once per epoch). Every step is normalised by the features'
 * size, so it moves the logits by about `learningRate` times the error whatever the
 * features' scale. Deterministic: the buffer is shuffled by a fixed generator.
 */
object Trainer {
    class Config(
        /** Logit units a step moves per unit of error. */
        val learningRate: Float = 0.5f,
        val epochs: Int = 30,
        /** The anchors' pull, next to a reply's 1. */
        val anchorWeight: Float = 1f,
        /** The pull toward the original weights, per epoch. */
        val l2: Float = 0.01f,
    )

    class Report(
        val examples: Int,
        val anchors: Int,
        val epochs: Int,
        /** Mean cross-entropy over the buffer, and how many of its replies the layer now gets right. */
        val loss: Float,
        val accuracy: Float,
        /** Mean KL from the original layer's answers over the anchors. */
        val anchorDrift: Float,
    )

    private fun step(head: HeadWeights, f: FloatArray, target: FloatArray, weight: Float, lr: Float) {
        val p = GranitaModel.softmax(head.logits(f))
        var norm = 0f
        for (v in f) norm += v * v
        val scale = lr / max(1f, norm)
        for (c in 0 until head.classes) {
            val g = weight * (p[c] - target[c])
            if (g == 0f) continue
            val row = head.weight[c]
            for (k in f.indices) row[k] -= scale * g * f[k]
            head.bias[c] -= scale * g
        }
    }

    private fun oneHot(label: Int, n: Int) = FloatArray(n).also { it[label] = 1f }

    /** `head` trained in place from `origin`'s copy; the report after the last epoch. */
    fun train(head: HeadWeights, origin: HeadWeights, buffer: ReplayBuffer, anchors: List<Anchor>, config: Config = Config()): Report {
        var seed = 0x9E3779B97F4A7C15uL
        fun next(): ULong { seed = seed * 6364136223846793005uL + 1442695040888963407uL; return seed shr 33 }
        val targets = anchors.map { GranitaModel.softmax(it.logits) }
        repeat(config.epochs) {
            val order = buffer.examples.indices.toMutableList()
            for (i in order.size - 1 downTo 1) {
                val j = (next() % (i + 1).toULong()).toInt()
                val t = order[i]; order[i] = order[j]; order[j] = t
            }
            for (i in order) {
                val e = buffer.examples[i]
                step(head, e.features, oneHot(e.label, head.classes), 1f, config.learningRate)
            }
            for ((a, t) in anchors.zip(targets)) step(head, a.features, t, config.anchorWeight, config.learningRate)
            for (c in 0 until head.classes) {
                val row = head.weight[c]
                val o = origin.weight[c]
                for (k in 0 until head.width) row[k] -= config.learningRate * config.l2 * (row[k] - o[k])
                head.bias[c] -= config.learningRate * config.l2 * (head.bias[c] - origin.bias[c])
            }
        }
        return report(head, buffer, anchors, config.epochs)
    }

    fun report(head: HeadWeights, buffer: ReplayBuffer, anchors: List<Anchor>, epochs: Int): Report {
        var loss = 0f
        var right = 0
        for (e in buffer.examples) {
            val p = GranitaModel.softmax(head.logits(e.features))
            loss -= ln(max(p[e.label], 1e-7f))
            if (p.indices.maxByOrNull { p[it] } == e.label) right++
        }
        var drift = 0f
        for (a in anchors) {
            val q0 = GranitaModel.softmax(a.logits)
            val q = GranitaModel.softmax(head.logits(a.features))
            for (c in q.indices) if (q0[c] > 0) drift += q0[c] * ln(q0[c] / max(q[c], 1e-7f))
        }
        val n = max(buffer.examples.size, 1)
        return Report(buffer.examples.size, anchors.size, epochs, loss / n, right.toFloat() / n, if (anchors.isEmpty()) 0f else drift / anchors.size)
    }
}
