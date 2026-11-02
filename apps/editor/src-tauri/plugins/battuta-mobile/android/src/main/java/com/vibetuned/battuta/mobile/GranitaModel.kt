package com.vibetuned.battuta.mobile

import android.content.res.AssetManager
import com.google.ai.edge.litert.Accelerator
import com.google.ai.edge.litert.CompiledModel
import org.json.JSONObject
import kotlin.math.exp

/**
 * granita's LiteRT export (granitanet.tflite, an asset of this plugin; its sidecar
 * beside it), fed the way granita feeds PyTorch (phase 11, M2; lifted from granita's
 * Android test shell): the normalised pixels (1 x 1 x 32 x 32) and the context (1 x 16)
 * in, the logits (1 x 43) out, softmax for the confidences. The tflite keeps
 * litert-torch's names, not the sidecar's: signature `serving_default`, inputs `args_0`
 * (the image) and `args_1` (the context), output `output_0`. LiteRT's CompiledModel
 * API, on the CPU. Loaded once, on the first symbol.
 */
class GranitaModel(assets: AssetManager) : AutoCloseable {
    class Prediction(val label: String, val confidence: Float)

    val classes: List<String> = JSONObject(assets.open("granitanet.json").bufferedReader().use { it.readText() })
        .getJSONArray("classes").let { a -> List(a.length()) { a.getString(it) } }
    private val model = CompiledModel.create(assets, "granitanet.tflite", CompiledModel.Options(Accelerator.CPU))
    private val image = model.createInputBuffer(IMAGE, SIGNATURE)
    private val context = model.createInputBuffer(CONTEXT, SIGNATURE)
    private val logits = model.createOutputBuffer(LOGITS, SIGNATURE)

    /** The classes by confidence, best first. */
    fun predict(input: FloatArray, ctx: FloatArray, topK: Int = 5): List<Prediction> {
        require(input.size == StrokeRaster.SIZE * StrokeRaster.SIZE && ctx.size == SymbolContext.DIM)
        image.writeFloat(input)
        context.writeFloat(ctx)
        model.run(mapOf(IMAGE to image, CONTEXT to context), mapOf(LOGITS to logits), SIGNATURE)
        val out = logits.readFloat()
        val m = out.max()
        val e = FloatArray(out.size) { exp(out[it] - m) }
        val s = e.sum()
        val probabilities = FloatArray(out.size) { e[it] / s }
        return probabilities.indices.sortedByDescending { probabilities[it] }.take(topK).map { Prediction(classes[it], probabilities[it]) }
    }

    override fun close() {
        image.close()
        context.close()
        logits.close()
        model.close()
    }

    companion object {
        const val SIGNATURE = "serving_default"
        const val IMAGE = "args_0"
        const val CONTEXT = "args_1"
        const val LOGITS = "output_0"
    }
}
