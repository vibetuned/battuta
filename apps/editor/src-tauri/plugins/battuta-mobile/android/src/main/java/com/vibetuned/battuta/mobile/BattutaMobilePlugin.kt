package com.vibetuned.battuta.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.media.midi.MidiDevice
import android.media.midi.MidiManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.util.Base64
import android.graphics.PointF
import android.graphics.RectF
import android.webkit.MimeTypeMap
import android.webkit.WebView
import android.widget.ArrayAdapter
import app.tauri.PermissionState
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors
import java.io.File
import java.io.FileNotFoundException
import java.util.UUID

/** The Bluetooth LE MIDI service every BLE MIDI instrument advertises. */
private val MIDI_SERVICE: UUID = UUID.fromString("03B80E5A-EDE8-4B33-A751-6CE34EC4C700")

/** The share sheet's own provider class (the app declares a FileProvider of its own). */
class BattutaShareProvider : FileProvider()

@InvokeArg
class CaptureArgs {
    var on: Boolean = false
    lateinit var channel: Channel
}

@InvokeArg
class AreaArgs {
    var rects: Array<DoubleArray> = arrayOf()
}

/** Where a symbol sits, in staff spaces (granita's `SymbolContext`). */
@InvokeArg
class ContextArgs {
    var yStaff: Double = 0.0
    var xMeasure: Double = 0.5
    var barline: Double = 8.0
    var noteDx: Double? = null
    var noteDy: Double? = null
    var noteW: Double? = null
    var noteH: Double? = null
    var width: Double = 0.0
    var height: Double = 0.0
}

@InvokeArg
class RecognizeArgs {
    var strokes: Array<Array<DoubleArray>> = arrayOf()
    var staffSpace: Double = 0.0
    var context: ContextArgs? = null
}

@InvokeArg
class ReadingArgs {
    var label: String = ""
    var confidence: Double = 0.0
}

/** A confirmed symbol (`ctx.stylus.reply`, 1.3.10): its samples `[x, y, t_ms, pressure]`. */
@InvokeArg
class ReplyArgs {
    var label: String = ""
    var strokes: Array<Array<DoubleArray>> = arrayOf()
    var staffSpace: Double = 0.0
    var context: ContextArgs? = null
    var read: ReadingArgs? = null
}

@InvokeArg
class ShareArgs {
    var name: String = ""
    var data: String = ""
}

@InvokeArg
class PathArgs {
    var path: String = ""
}

@InvokeArg
class ReadArgs {
    var path: String = ""
    var base64: Boolean = false
}

@InvokeArg
class WriteArgs {
    var path: String = ""
    var text: String = ""
}

@InvokeArg
class CreateFileArgs {
    var dir: String = ""
    var name: String = ""
    var text: String = ""
}

@InvokeArg
class CreateFolderArgs {
    var dir: String = ""
    var name: String = ""
}

@InvokeArg
class RenameArgs {
    var path: String = ""
    var name: String = ""
}

/**
 * battuta's native Android services (phase 10, M1): the share sheet, and
 * folders the user picks.
 *
 * A picked folder is a document tree — `content://` URIs, no path. The shell
 * gives it one: the tree's URI, then the names down to a document,
 * `/`-separated (`content://<authority>/tree/<tree id>/scores/aria.mei`), so
 * the page's path logic works on it unchanged. Every call here takes such a
 * path and walks the tree name by name to the document — which works with
 * any storage provider, not only the device's own storage, whose document
 * ids happen to look like paths.
 */
@TauriPlugin(
    permissions = [
        // Android 12+: "nearby devices" (scan + connect), never the location.
        Permission(strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetooth"),
        // Android 8 to 11: a Bluetooth scan needs the location.
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = "location"),
    ]
)
class BattutaMobilePlugin(private val activity: Activity) : Plugin(activity) {
    private val main = Handler(Looper.getMainLooper())

    /** The page's WebView, handed over by Tauri; the stylus is captured on it. */
    private var webView: WebView? = null
    private var stylus: StylusCapture? = null
    /** Where the pen writes, as the page last said — kept here too, for a capture made after it. */
    private var stylusArea: List<RectF> = emptyList()

    override fun load(webView: WebView) {
        this.webView = webView
    }

    // --- the stylus (1.3.0): capture on or off, the events down the channel ---

    @Command
    fun stylusCapture(invoke: Invoke) {
        val args = invoke.parseArgs(CaptureArgs::class.java)
        main.post {
            val view = webView
            if (view == null) {
                invoke.reject("no WebView to capture the stylus on")
                return@post
            }
            val capture = stylus ?: StylusCapture(view, args.channel).also { stylus = it }
            capture.update(args.channel)
            capture.area = stylusArea
            capture.set(args.on)
            invoke.resolve()
        }
    }

    @Command
    fun stylusArea(invoke: Invoke) {
        val args = invoke.parseArgs(AreaArgs::class.java)
        val rects = args.rects.filter { it.size == 4 }.map { RectF(it[0].toFloat(), it[1].toFloat(), (it[0] + it[2]).toFloat(), (it[1] + it[3]).toFloat()) }
        main.post {
            stylusArea = rects
            stylus?.area = rects
            invoke.resolve()
        }
    }

    // --- granita (1.3.5, phase 11 M2): a symbol's strokes to its classes ---

    /** Loaded on the first symbol; its own thread, the model call takes a few ms. */
    private val granitaThread = Executors.newSingleThreadExecutor()
    private var granita: GranitaModel? = null
    /** The replies file (1.3.10) and the trained layer, in the app's files under `stylus/`. */
    private val replies by lazy { Annotations(activity) }
    private val headFile: File get() = File(replies.directory, "head.json")
    private val trainingFile: File get() = File(replies.directory, "training.json")

    /** The model, loaded once — with the trained layer, when the user trained one. */
    /**
     * Which model the saved layer was trained for (`head.model`): a layer belongs to the features
     * of one release, and the sidecar names every release alike, so this is a fingerprint of the
     * release's own last layer — FNV-1a over its weights' bits (granita v10, 2026-11-12).
     */
    private val headModelFile: File get() = File(replies.directory, "head.model")

    private fun fingerprint(h: Sidecar.Head): String {
        var hash = 0xcbf29ce484222325uL
        fun mix(v: Float) {
            var b = java.lang.Float.floatToRawIntBits(v).toUInt()
            repeat(4) {
                hash = (hash xor (b and 0xffu).toULong()) * 0x100000001b3uL
                b = b shr 8
            }
        }
        for (row in h.weight) for (v in row) mix(v)
        for (v in h.bias) mix(v)
        return hash.toString(16)
    }

    /** The trained layer gone: reset, or trained for another release of the model. */
    private fun forgetTraining() {
        headFile.delete()
        trainingFile.delete()
        headModelFile.delete()
    }

    /** The model, loaded once — with the trained layer when the user trained one for this release; one trained for another release is forgotten (its features are not this model's). */
    private fun loadGranita(): GranitaModel = granita ?: GranitaModel(activity.assets).also { m ->
        val origin = m.sidecar.head
        if (m.personal && origin != null) {
            val mark = if (headModelFile.isFile) headModelFile.readText().trim() else null
            if (mark == fingerprint(origin)) HeadWeights.load(headFile)?.let { m.head = it }
            else if (headFile.isFile) forgetTraining()
        }
        granita = m
    }

    private fun vector(context: ContextArgs?): FloatArray =
        context?.let { SymbolContext(it.yStaff, it.xMeasure, it.barline, it.noteDx, it.noteDy, it.width, it.height, it.noteW, it.noteH).vector() } ?: SymbolContext.UNKNOWN

    @Command
    fun stylusRecognize(invoke: Invoke) {
        val args = invoke.parseArgs(RecognizeArgs::class.java)
        val strokes = args.strokes.map { s -> s.filter { it.size == 2 }.map { PointF(it[0].toFloat(), it[1].toFloat()) } }.filter { it.isNotEmpty() }
        if (strokes.isEmpty() || args.staffSpace <= 0.0) {
            invoke.reject("recognize: strokes and a positive staffSpace are needed")
            return
        }
        granitaThread.execute {
            try {
                val model = loadGranita()
                val fraction = StrokeRaster.fraction(strokes, args.staffSpace)
                val pixels = StrokeRaster.render(strokes, fraction)
                val answer = model.predict(StrokeRaster.normalize(pixels), vector(args.context))
                val list = JSArray()
                for (t in answer.top) list.put(JSObject().apply { put("label", t.label); put("confidence", t.confidence.toDouble()) })
                invoke.resolve(JSObject().apply { put("top", list) })
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString())
            }
        }
    }

    // --- the replies and the training (1.3.10): the dataset, and the last layer on the device ---

    /** A confirmed symbol to the replies file, musicset's record; the count after it. */
    @Command
    fun stylusReply(invoke: Invoke) {
        val args = invoke.parseArgs(ReplyArgs::class.java)
        val samples = args.strokes.map { s -> s.filter { it.size >= 2 } }.filter { it.isNotEmpty() }
        if (args.label.isEmpty() || samples.isEmpty() || args.staffSpace <= 0.0) {
            invoke.reject("reply: a label, strokes and a positive staffSpace are needed")
            return
        }
        val points = samples.map { s -> s.map { PointF(it[0].toFloat(), it[1].toFloat()) } }
        val fraction = StrokeRaster.fraction(points, args.staffSpace)
        val version = try { activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "?" } catch (e: Exception) { "?" }
        val record = Reply(
            label = args.label,
            writer = replies.writer,
            staffSpace = args.staffSpace,
            strokes = samples.map { s -> s.map { p -> DoubleArray(minOf(p.size, 4)) { i -> when (i) { 2 -> Math.round(p[2] * 10) / 10.0; 3 -> Math.round(p[3] * 1000) / 1000.0; else -> p[i] } } } },
            context = args.context?.let { SymbolContext(it.yStaff, it.xMeasure, it.barline, it.noteDx, it.noteDy, it.width, it.height, it.noteW, it.noteH) },
            fraction = fraction,
            predicted = args.read?.let { GranitaModel.Top(it.label, "", it.confidence.toFloat()) },
            device = "s-pen",
            app = "battuta/$version",
            time = Annotations.now(),
        )
        granitaThread.execute {
            try {
                replies.append(record)
                invoke.resolve(JSObject().apply { put("count", replies.count) })
            } catch (e: Exception) {
                invoke.reject("reply: ${e.message ?: e}")
            }
        }
    }

    /** The last layer retrained from every reply (`Trainer`), kept in the stylus folder and used from then on. */
    @Command
    fun stylusTrain(invoke: Invoke) {
        granitaThread.execute {
            try {
                val model = loadGranita()
                val original = model.sidecar.head?.let { HeadWeights(it.weight, it.bias) }
                if (!model.personal || original == null) {
                    invoke.reject("train: the model has no personal signature")
                    return@execute
                }
                val records = replies.all()
                val anchors = Anchors.load(activity.assets)?.anchors ?: emptyList()
                val classes = model.sidecar.classes
                val examples = ArrayList<Example>()
                for (r in records) {
                    val label = classes.indexOf(r.label)
                    if (label < 0) continue
                    val strokes = r.strokes.map { s -> s.map { PointF(it[0].toFloat(), it[1].toFloat()) } }.filter { it.isNotEmpty() }
                    if (strokes.isEmpty()) continue
                    val px = StrokeRaster.render(strokes, r.fraction)
                    val p = model.predict(StrokeRaster.normalize(px), r.context?.vector() ?: SymbolContext.UNKNOWN)
                    if (p.features.isNotEmpty()) examples.add(Example(p.features, label))
                }
                val head = original.copy()
                val report = Trainer.train(head, original, ReplayBuffer(examples), anchors)
                model.head = head
                head.save(headFile)
                model.sidecar.head?.let { headModelFile.writeText(fingerprint(it)) }
                val record = TrainingRecord(records.size, report.examples, report.anchors, report.loss.toDouble(), report.accuracy.toDouble(), report.anchorDrift.toDouble())
                record.save(trainingFile)
                invoke.resolve(record.into(JSObject()))
            } catch (e: Exception) {
                invoke.reject("train: ${e.message ?: e}")
            }
        }
    }

    /** The original layer back, the trained one forgotten. */
    @Command
    fun stylusResetTraining(invoke: Invoke) {
        granitaThread.execute {
            try {
                val model = loadGranita()
                model.sidecar.head?.let { model.head = HeadWeights(it.weight, it.bias) }
                forgetTraining()
                invoke.resolve(JSObject())
            } catch (e: Exception) {
                invoke.reject("resetTraining: ${e.message ?: e}")
            }
        }
    }

    /** The replies on the device, how many the replay buffer would take of them, and the last training while its layer is the one reading (1.3.11). */
    @Command
    fun stylusReplies(invoke: Invoke) {
        granitaThread.execute {
            try {
                val classes = loadGranita().sidecar.classes
                val examples = replies.all().mapNotNull { r -> classes.indexOf(r.label).takeIf { it >= 0 }?.let { Example(FloatArray(0), it) } }
                val buffer = ReplayBuffer(examples).examples.size
                val training = if (headFile.isFile) TrainingRecord.load(trainingFile) else null
                invoke.resolve(JSObject().apply {
                    put("replies", replies.count)
                    put("buffer", buffer)
                    put("training", training?.into(JSObject()) ?: org.json.JSONObject.NULL)
                })
            } catch (e: Exception) {
                invoke.reject("replies: ${e.message ?: e}")
            }
        }
    }

    /** Every reply deleted; the layer in use is left alone (1.3.11). */
    @Command
    fun stylusDeleteReplies(invoke: Invoke) {
        granitaThread.execute {
            replies.deleteAll()
            invoke.resolve(JSObject())
        }
    }

    /** The replies file on the share sheet, through the share folder the FileProvider serves. */
    @Command
    fun stylusShareReplies(invoke: Invoke) {
        if (!replies.file.isFile || replies.count == 0) {
            invoke.reject("no replies yet")
            return
        }
        try {
            val dir = File(activity.cacheDir, "share").apply { mkdirs() }
            val file = File(dir, Annotations.FILE_NAME)
            replies.file.copyTo(file, overwrite = true)
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.battuta.share", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "application/json"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivityForResult(invoke, Intent.createChooser(send, null), "shareResult")
        } catch (e: Exception) {
            invoke.reject(e.message ?: "could not share the replies")
        }
    }

    /** Bluetooth MIDI connections: held open while the app is — closing one unpairs it. */
    private val bluetooth = ArrayList<MidiDevice>()

    // --- Bluetooth MIDI pairing (M3; after midi-stroke's working version) ---
    //
    // A scan for the MIDI service, a list of what answers, and the tapped
    // instrument opened through MidiManager. From then on it is a MIDI device
    // of the system like a USB one, so the WebView's Web MIDI lists it and
    // battuta plays and listens through it with no more native code.

    private fun bluetoothAlias() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "bluetooth" else "location"

    @Command
    fun bluetoothMidi(invoke: Invoke) {
        if (getPermissionState(bluetoothAlias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(bluetoothAlias(), invoke, "bluetoothMidiPermission")
            return
        }
        main.post { scan(invoke) }
    }

    @PermissionCallback
    private fun bluetoothMidiPermission(invoke: Invoke) {
        if (getPermissionState(bluetoothAlias()) == PermissionState.GRANTED) main.post { scan(invoke) }
        else invoke.reject("Bluetooth permission denied")
    }

    /** The Bluetooth MIDI instruments in range, listed as they answer; one tapped is connected. */
    @SuppressLint("MissingPermission")
    private fun scan(invoke: Invoke) {
        val adapter = (activity.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        val scanner = adapter?.bluetoothLeScanner
        if (adapter == null || !adapter.isEnabled || scanner == null) {
            invoke.reject("Bluetooth is off")
            return
        }
        val found = ArrayList<BluetoothDevice>()
        val names = ArrayAdapter<String>(activity, android.R.layout.simple_list_item_1, ArrayList())
        val results = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                main.post {
                    val device = result.device
                    if (found.none { it.address == device.address }) {
                        found.add(device)
                        names.add(device.name ?: result.scanRecord?.deviceName ?: device.address)
                    }
                }
            }
        }
        val stop = { runCatching { scanner.stopScan(results) } }
        AlertDialog.Builder(activity)
            .setTitle("Bluetooth MIDI — looking for instruments…")
            .setAdapter(names) { _, which ->
                stop()
                connect(found[which])
            }
            .setNegativeButton(android.R.string.cancel, null)
            .setOnDismissListener { stop() }
            .show()
        scanner.startScan(
            listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(MIDI_SERVICE)).build()),
            ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
            results,
        )
        invoke.resolve()
    }

    private fun connect(device: BluetoothDevice) {
        val midi = activity.getSystemService(Context.MIDI_SERVICE) as? MidiManager ?: return
        midi.openBluetoothDevice(device, { opened -> if (opened != null) bluetooth.add(opened) }, main)
    }

    // --- the share sheet ------------------------------------------------------

    @Command
    fun share(invoke: Invoke) {
        val args = invoke.parseArgs(ShareArgs::class.java)
        try {
            val dir = File(activity.cacheDir, "share").apply { mkdirs() }
            val file = File(dir, args.name.substringAfterLast('/'))
            file.writeBytes(Base64.decode(args.data, Base64.DEFAULT))
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.battuta.share", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mimeOf(file.name)
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivityForResult(invoke, Intent.createChooser(send, null), "shareResult")
        } catch (e: Exception) {
            invoke.reject(e.message ?: "could not share ${args.name}")
        }
    }

    /** The chooser reports no reliable outcome on Android: closed is all it says. */
    @ActivityCallback
    fun shareResult(invoke: Invoke, result: ActivityResult) {
        invoke.resolve(JSObject().apply { put("completed", true) })
    }

    private fun mimeOf(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        if (ext == "mei") return "application/xml"
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }

    // --- folders the user picks -----------------------------------------------

    @Command
    fun pickFolder(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(invoke, intent, "pickFolderResult")
    }

    @ActivityCallback
    fun pickFolderResult(invoke: Invoke, result: ActivityResult) {
        val picked = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || picked == null) {
            invoke.resolve(JSObject())
            return
        }
        try {
            // Kept across launches: the folder view reopens it next time.
            activity.contentResolver.takePersistableUriPermission(picked, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            val tree = DocumentsContract.buildTreeDocumentUri(picked.authority, DocumentsContract.getTreeDocumentId(picked))
            invoke.resolve(JSObject().apply { put("path", tree.toString()) })
        } catch (e: Exception) {
            invoke.reject(e.message ?: "could not open that folder")
        }
    }

    /** A folder picked in an earlier session, while its permission is still held. */
    @Command
    fun openFolder(invoke: Invoke) {
        val args = invoke.parseArgs(PathArgs::class.java)
        val held = try {
            val tree = parse(args.path).tree
            val id = DocumentsContract.getTreeDocumentId(tree)
            activity.contentResolver.persistedUriPermissions.any {
                it.isWritePermission && it.uri.authority == tree.authority && DocumentsContract.getTreeDocumentId(it.uri) == id
            }
        } catch (e: Exception) {
            false
        }
        invoke.resolve(JSObject().apply { if (held) put("path", args.path) })
    }

    // --- inside a picked folder, by tree path ---------------------------------

    @Command
    fun listDir(invoke: Invoke) = io(invoke) {
        val args = invoke.parseArgs(PathArgs::class.java)
        val at = parse(args.path)
        val entries = JSArray()
        for (child in children(at.tree, docIdOf(at))) {
            if (child.name.startsWith(".")) continue
            entries.put(JSObject().apply {
                put("name", child.name)
                put("path", join(args.path, child.name))
                put("isDir", child.mime == Document.MIME_TYPE_DIR)
                if (child.mtime != null) put("mtime", child.mtime)
            })
        }
        JSObject().apply { put("entries", entries) }
    }

    @Command
    fun readFile(invoke: Invoke) = io(invoke) {
        val args = invoke.parseArgs(ReadArgs::class.java)
        val bytes = activity.contentResolver.openInputStream(uriOf(parse(args.path)))?.use { it.readBytes() }
            ?: throw FileNotFoundException("${args.path}: cannot be read")
        JSObject().apply { put("data", if (args.base64) Base64.encodeToString(bytes, Base64.NO_WRAP) else String(bytes, Charsets.UTF_8)) }
    }

    @Command
    fun writeFile(invoke: Invoke) = io(invoke) {
        val args = invoke.parseArgs(WriteArgs::class.java)
        write(uriOf(parse(args.path)), args.text)
        JSObject()
    }

    @Command
    fun createFile(invoke: Invoke) = io(invoke) {
        val args = invoke.parseArgs(CreateFileArgs::class.java)
        val dir = parse(args.dir)
        val parentId = docIdOf(dir)
        refuseTaken(dir.tree, parentId, args.name)
        // A neutral MIME type, so the provider keeps the name as given
        // (a typed one may get its own extension appended: aria.mei.xml).
        val created = DocumentsContract.createDocument(activity.contentResolver, DocumentsContract.buildDocumentUriUsingTree(dir.tree, parentId), "application/octet-stream", args.name)
            ?: throw IllegalStateException("could not create the file")
        write(created, args.text)
        JSObject().apply { put("path", join(args.dir, nameOf(created) ?: args.name)) }
    }

    @Command
    fun createFolder(invoke: Invoke) = io(invoke) {
        val args = invoke.parseArgs(CreateFolderArgs::class.java)
        val dir = parse(args.dir)
        val parentId = docIdOf(dir)
        refuseTaken(dir.tree, parentId, args.name)
        val created = DocumentsContract.createDocument(activity.contentResolver, DocumentsContract.buildDocumentUriUsingTree(dir.tree, parentId), Document.MIME_TYPE_DIR, args.name)
            ?: throw IllegalStateException("could not create the folder")
        JSObject().apply { put("path", join(args.dir, nameOf(created) ?: args.name)) }
    }

    @Command
    fun rename(invoke: Invoke) = io(invoke) {
        val args = invoke.parseArgs(RenameArgs::class.java)
        val at = parse(args.path)
        if (at.names.isEmpty()) throw IllegalArgumentException("the folder itself cannot be renamed here")
        val parent = TreePath(at.tree, at.names.dropLast(1))
        refuseTaken(at.tree, docIdOf(parent), args.name)
        val renamed = DocumentsContract.renameDocument(activity.contentResolver, uriOf(at), args.name) ?: uriOf(at)
        JSObject().apply { put("path", join(args.path.substringBeforeLast('/'), nameOf(renamed) ?: args.name)) }
    }

    @Command
    fun mtime(invoke: Invoke) = io(invoke) {
        val args = invoke.parseArgs(PathArgs::class.java)
        val uri = uriOf(parse(args.path))
        var mtime: Long? = null
        activity.contentResolver.query(uri, arrayOf(Document.COLUMN_LAST_MODIFIED), null, null, null)?.use { c ->
            if (c.moveToFirst() && !c.isNull(0)) mtime = c.getLong(0)
        }
        JSObject().apply { if (mtime != null) put("mtime", mtime) }
    }

    // --- tree paths -----------------------------------------------------------

    private class TreePath(val tree: Uri, val names: List<String>)

    private class Child(val id: String, val name: String, val mime: String, val mtime: Long?)

    /** `content://<authority>/tree/<tree id>/<name>/<name>…` → the tree and the names down. */
    private fun parse(path: String): TreePath {
        if (!path.startsWith("content://")) throw IllegalArgumentException("$path is not in a picked folder")
        val parts = path.removePrefix("content://").split('/')
        if (parts.size < 3 || parts[1] != "tree") throw IllegalArgumentException("$path is not in a picked folder")
        return TreePath(Uri.parse("content://${parts[0]}/tree/${parts[2]}"), parts.drop(3).filter { it.isNotEmpty() })
    }

    private fun join(dir: String, name: String): String = "${dir.trimEnd('/')}/$name"

    private fun docIdOf(at: TreePath): String {
        var id = DocumentsContract.getTreeDocumentId(at.tree)
        for ((depth, name) in at.names.withIndex()) {
            id = children(at.tree, id).firstOrNull { it.name == name }?.id
                ?: throw FileNotFoundException("${at.names.take(depth + 1).joinToString("/")}: no such file or folder")
        }
        return id
    }

    private fun uriOf(at: TreePath): Uri = DocumentsContract.buildDocumentUriUsingTree(at.tree, docIdOf(at))

    private fun children(tree: Uri, parentId: String): List<Child> {
        val out = mutableListOf<Child>()
        val columns = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_LAST_MODIFIED)
        activity.contentResolver.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId), columns, null, null, null)?.use { c ->
            while (c.moveToNext()) out.add(Child(c.getString(0), c.getString(1) ?: "", c.getString(2) ?: "", if (c.isNull(3)) null else c.getLong(3)))
        }
        return out
    }

    /** The shell's own wording (lib.rs create_within), which the page recognises. */
    private fun refuseTaken(tree: Uri, parentId: String, name: String) {
        if (children(tree, parentId).any { it.name == name }) throw IllegalStateException("\"$name\" already exists in this folder")
    }

    private fun nameOf(uri: Uri): String? =
        activity.contentResolver.query(uri, arrayOf(Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }

    private fun write(uri: Uri, text: String) {
        val out = try {
            activity.contentResolver.openOutputStream(uri, "wt")
        } catch (e: Exception) {
            activity.contentResolver.openOutputStream(uri, "w") // providers without truncate mode
        } ?: throw FileNotFoundException("$uri: cannot be written")
        out.use { it.write(text.toByteArray(Charsets.UTF_8)) }
    }

    /** Off the UI thread: a tree walk is a query per level, a provider may be remote. */
    private fun io(invoke: Invoke, body: () -> JSObject) {
        Thread {
            try {
                invoke.resolve(body())
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString())
            }
        }.start()
    }
}
