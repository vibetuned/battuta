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
import android.webkit.MimeTypeMap
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
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileNotFoundException
import java.util.UUID

/** The Bluetooth LE MIDI service every BLE MIDI instrument advertises. */
private val MIDI_SERVICE: UUID = UUID.fromString("03B80E5A-EDE8-4B33-A751-6CE34EC4C700")

/** The share sheet's own provider class (the app declares a FileProvider of its own). */
class BattutaShareProvider : FileProvider()

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
