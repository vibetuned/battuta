package com.vibetuned.battuta.mobile

import android.content.res.AssetManager
import org.json.JSONObject

/**
 * The model's sidecar (granitanet.json, written by `granita export --sidecar`): the class
 * list, each class's group, the tflite's tensor names, and — since the `personal`
 * signature — the last layer's weights the app starts its own copy from. The input spec
 * and the stroke rules it also states are mirrored in code, in StrokeRaster and
 * SymbolContext.
 */
class Sidecar(
    val model: String,
    val classes: List<String>,
    val groups: Map<String, String>,
    val head: Head?,
    val litert: LitertNames,
) {
    /** The last layer, `Linear(128 -> classes)`, as trained. */
    class Head(val function: String, val shape: IntArray, val weight: Array<FloatArray>, val bias: FloatArray)

    /**
     * What the tflite calls its tensors in one signature (litert-torch's `args_0`…,
     * `output_0`…, told apart by shape at export): the `personal` signature when the
     * sidecar lists it, else `serving_default` with the image and the context alone.
     */
    class LitertNames(
        val signature: String,
        val image: String,
        val context: String,
        val headW: String?,
        val headB: String?,
        val logits: String,
        val features: String?,
    )

    companion object {
        fun load(assets: AssetManager): Sidecar {
            val json = JSONObject(assets.open("granitanet.json").bufferedReader().use { it.readText() })
            val classes = json.getJSONArray("classes").let { array -> List(array.length()) { array.getString(it) } }
            val groups = json.getJSONObject("groups")
            val head = json.optJSONObject("head")?.let { h ->
                val rows = h.getJSONArray("weight")
                val bias = h.getJSONArray("bias")
                Head(
                    h.optString("function", "personal"),
                    h.getJSONArray("shape").let { s -> IntArray(s.length()) { s.getInt(it) } },
                    Array(rows.length()) { r -> rows.getJSONArray(r).let { row -> FloatArray(row.length()) { row.getDouble(it).toFloat() } } },
                    FloatArray(bias.length()) { bias.getDouble(it).toFloat() },
                )
            }
            return Sidecar(
                json.getString("model"),
                classes,
                groups.keys().asSequence().associateWith { groups.getString(it) },
                head,
                names(json.optJSONObject("litert"), head?.function),
            )
        }

        /** The names to run by: the personal signature's when the sidecar has it and a head, else the default's. */
        private fun names(litert: JSONObject?, personal: String?): LitertNames {
            val signatures = litert?.optJSONObject("signatures")
            val p = if (personal != null) signatures?.optJSONObject(personal) else null
            if (p != null) {
                val i = p.getJSONObject("inputs")
                val o = p.getJSONObject("outputs")
                return LitertNames(personal!!, i.getString("input"), i.getString("context"), i.optString("head_w", null), i.optString("head_b", null), o.getString("logits"), o.optString("features", null))
            }
            val i = litert?.optJSONObject("inputs")
            return LitertNames(
                litert?.optString("signature", "serving_default") ?: "serving_default",
                i?.optString("input", "args_0") ?: "args_0",
                i?.optString("context", "args_1") ?: "args_1",
                null, null,
                litert?.optString("output", "output_0") ?: "output_0",
                null,
            )
        }
    }
}
