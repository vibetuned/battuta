package com.vibetuned.battuta.mobile

import android.content.res.AssetManager
import com.google.ai.edge.litert.Accelerator
import com.google.ai.edge.litert.CompiledModel
import kotlin.math.exp

/**
 * granita's LiteRT export (granitanet.tflite, an asset of this plugin; its sidecar beside
 * it), fed the way granita feeds PyTorch (phase 11, M2; lifted from granita's Android test
 * shell and kept identical):
 * the normalised pixels (1 x 1 x 32 x 32) and the context (1 x 16) in, the logits
 * (1 x 43) out, softmax for the confidences. The tflite keeps litert-torch's names, not
 * the sidecar's — the sidecar's `litert` block says which is which. LiteRT's
 * CompiledModel API, on the CPU.
 *
 * A tflite with a `personal` signature (the sidecar has a `head` and lists the
 * signature) is run through it: the last layer's weights go in as `head_w` / `head_b`
 * and the `features` that layer reads come out, so the app can train that layer on the
 * device (`Head.kt`) and still run the whole network as compiled. The layer fed is
 * `head`, the app's copy: the sidecar's at first.
 */
class GranitaModel(assets: AssetManager) : AutoCloseable {
    class Top(val label: String, val group: String, val confidence: Float)

    class Prediction(
        val logits: FloatArray,
        val probabilities: FloatArray,
        val top: List<Top>,
        /** What the last layer read, 128 values — empty without the `personal` signature. */
        val features: FloatArray,
        /** The model call alone. */
        val nanos: Long,
    )

    val sidecar = Sidecar.load(assets)
    private val names = sidecar.litert
    private val model = CompiledModel.create(assets, "granitanet.tflite", CompiledModel.Options(Accelerator.CPU))
    private val image = model.createInputBuffer(names.image, names.signature)
    private val context = model.createInputBuffer(names.context, names.signature)
    private val headW = names.headW?.let { model.createInputBuffer(it, names.signature) }
    private val headB = names.headB?.let { model.createInputBuffer(it, names.signature) }
    private val logits = model.createOutputBuffer(names.logits, names.signature)
    private val features = names.features?.let { model.createOutputBuffer(it, names.signature) }

    /** The last layer as fed to the `personal` signature; set to a trained copy to use it. */
    var head: HeadWeights? = if (headW != null) sidecar.head?.let { HeadWeights(it.weight, it.bias) } else null
        set(value) {
            field = value
            headDirty = true
        }
    private var headDirty = true

    /** Whether the tflite is run through its `personal` signature, the last layer in hand. */
    val personal: Boolean get() = headW != null && headB != null && head != null

    fun predict(input: FloatArray, ctx: FloatArray, topK: Int = 5): Prediction {
        require(input.size == StrokeRaster.SIZE * StrokeRaster.SIZE && ctx.size == SymbolContext.DIM)
        val start = System.nanoTime()
        image.writeFloat(input)
        context.writeFloat(ctx)
        val inputs = mutableMapOf(names.image to image, names.context to context)
        val outputs = mutableMapOf(names.logits to logits)
        val h = head
        if (headW != null && headB != null && h != null) {
            if (headDirty) {
                headW.writeFloat(h.flatWeight())
                headB.writeFloat(h.bias)
                headDirty = false
            }
            inputs[names.headW!!] = headW
            inputs[names.headB!!] = headB
            if (features != null) outputs[names.features!!] = features
        }
        model.run(inputs, outputs, names.signature)
        val out = logits.readFloat()
        val feats = if (features != null && h != null) features.readFloat() else FloatArray(0)
        val nanos = System.nanoTime() - start
        val probabilities = softmax(out)
        val order = probabilities.indices.sortedByDescending { probabilities[it] }.take(topK)
        val top = order.map { i ->
            val label = sidecar.classes[i]
            Top(label, sidecar.groups[label] ?: "other", probabilities[i])
        }
        return Prediction(out, probabilities, top, feats, nanos)
    }

    override fun close() {
        image.close()
        context.close()
        headW?.close()
        headB?.close()
        logits.close()
        features?.close()
        model.close()
    }

    companion object {
        const val RUNTIME = "2.3.2"

        fun softmax(x: FloatArray): FloatArray {
            val m = x.max()
            val e = FloatArray(x.size) { exp(x[it] - m) }
            val s = e.sum()
            return FloatArray(x.size) { e[it] / s }
        }
    }
}
