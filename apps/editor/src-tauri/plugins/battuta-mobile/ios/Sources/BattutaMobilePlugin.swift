import CoreAudioKit
import SwiftRs
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

class ShareArgs: Decodable {
  let name: String
  let data: String
}

class PathArgs: Decodable {
  let path: String
}

class CaptureArgs: Decodable {
  let on: Bool
  let channel: Channel
}

class AreaArgs: Decodable {
  let rects: [[Double]]
}

/// Where a symbol sits, in staff spaces (granita's `SymbolContext`).
class ContextArgs: Decodable {
  let yStaff: Double
  let xMeasure: Double
  let barline: Double
  let noteDx: Double?
  let noteDy: Double?
  let width: Double
  let height: Double
}

class RecognizeArgs: Decodable {
  let strokes: [[[Double]]]
  let staffSpace: Double
  let context: ContextArgs?
}

/// battuta's native iPadOS services (phase 10, M1): the share sheet, and
/// folders the user picks.
///
/// A folder picked in Files or iCloud Drive is a real path behind a
/// security scope. The plugin starts the scope — and holds it for the
/// life of the app, so the shell reads and writes there by path like
/// anywhere else — and keeps a bookmark per path in the user defaults,
/// which reopens the folder (and starts its scope again) next launch.
class BattutaMobilePlugin: Plugin, UIDocumentPickerDelegate {
  private static let bookmarksKey = "battuta.folderBookmarks"
  /// Scopes started this session: held until the app ends.
  private var held: [URL] = []
  private var pickInvoke: Invoke?
  /// The page's WebView, handed over by Tauri; the stylus is captured on it.
  private weak var webview: WKWebView?

  public override func load(webview: WKWebView) {
    self.webview = webview
  }

  // MARK: the stylus (1.3.0): capture on or off, the events down the channel

  private var stylus: StylusCapture?
  /// Where the pen writes, as the page last said — kept here too, for a capture made after it.
  private var stylusArea: [CGRect] = []

  @objc public func stylusCapture(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CaptureArgs.self)
    DispatchQueue.main.async {
      guard let view = self.webview else {
        invoke.reject("no WebView to capture the stylus on")
        return
      }
      if let stylus = self.stylus {
        stylus.update(args.channel)
      } else {
        self.stylus = StylusCapture(view: view, channel: args.channel)
      }
      self.stylus?.area = self.stylusArea
      self.stylus?.set(on: args.on)
      invoke.resolve()
    }
  }

  @objc public func stylusArea(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AreaArgs.self)
    let rects = args.rects.filter { $0.count == 4 }.map { CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
    DispatchQueue.main.async {
      self.stylusArea = rects
      self.stylus?.area = rects
      invoke.resolve()
    }
  }

  // MARK: granita (1.3.5, phase 11 M2): a symbol's strokes to its classes

  /// Loaded on the first symbol; its own queue, the model call takes a few ms.
  private var granita: GranitaModel?
  private let granitaQueue = DispatchQueue(label: "com.vibetuned.battuta.granita")

  @objc public func stylusRecognize(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(RecognizeArgs.self)
    let strokes = args.strokes.map { $0.filter { $0.count == 2 }.map { CGPoint(x: $0[0], y: $0[1]) } }.filter { !$0.isEmpty }
    guard !strokes.isEmpty, args.staffSpace > 0 else {
      invoke.reject("recognize: strokes and a positive staffSpace are needed")
      return
    }
    granitaQueue.async {
      do {
        let model = try self.granita ?? GranitaModel()
        self.granita = model
        let fraction = StrokeRaster.fraction(of: strokes, staffSpace: args.staffSpace)
        let pixels = StrokeRaster.render(strokes, fraction: fraction)
        let vector =
          args.context.map {
            SymbolContext(yStaff: $0.yStaff, xMeasure: $0.xMeasure, barline: $0.barline, noteDx: $0.noteDx, noteDy: $0.noteDy, width: $0.width, height: $0.height).vector
          } ?? SymbolContext.unknown
        let top = try model.predict(input: StrokeRaster.normalize(pixels), context: vector)
        invoke.resolve(["top": top.map { ["label": $0.label, "confidence": Double($0.confidence)] }])
      } catch {
        invoke.reject("\(error)")
      }
    }
  }

  // MARK: the share sheet

  @objc public func share(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareArgs.self)
    guard let bytes = Data(base64Encoded: args.data) else {
      invoke.reject("the file to share is not readable")
      return
    }
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("share", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let file = dir.appendingPathComponent((args.name as NSString).lastPathComponent)
    try bytes.write(to: file, options: .atomic)
    DispatchQueue.main.async {
      let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
      sheet.completionWithItemsHandler = { _, completed, _, error in
        if let error = error {
          invoke.reject(error.localizedDescription)
        } else {
          invoke.resolve(["completed": completed])
        }
      }
      // An iPad presents the sheet as a popover: it must be anchored.
      if let popover = sheet.popoverPresentationController, let view = self.manager.viewController?.view {
        popover.sourceView = view
        popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 40, width: 1, height: 1)
        popover.permittedArrowDirections = [.down]
      }
      self.manager.viewController?.present(sheet, animated: true)
    }
  }

  // MARK: Bluetooth MIDI

  /// Apple's Bluetooth MIDI view: the instruments in range, to connect or
  /// disconnect. A connected one is a CoreMIDI source from then on — the
  /// shell's MIDI bridge hears it at its next hot-plug poll. Resolves when
  /// the view is up (after midi-stroke's working version).
  @objc public func bluetoothMidi(_ invoke: Invoke) {
    DispatchQueue.main.async {
      guard let presenter = self.manager.viewController else {
        invoke.reject("no view to present from")
        return
      }
      let central = CABTMIDICentralViewController()
      central.navigationItem.rightBarButtonItem = UIBarButtonItem(
        barButtonSystemItem: .done, target: self, action: #selector(self.closeBluetoothMidi))
      let navigation = UINavigationController(rootViewController: central)
      navigation.modalPresentationStyle = .formSheet
      presenter.present(navigation, animated: true)
      invoke.resolve()
    }
  }

  @objc private func closeBluetoothMidi() {
    manager.viewController?.dismiss(animated: true)
  }

  // MARK: folders the user picks

  @objc public func pickFolder(_ invoke: Invoke) throws {
    pickInvoke = invoke
    DispatchQueue.main.async {
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder])
      picker.delegate = self
      picker.allowsMultipleSelection = false
      self.manager.viewController?.present(picker, animated: true)
    }
  }

  public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let invoke = pickInvoke else { return }
    pickInvoke = nil
    guard let url = urls.first else {
      invoke.resolve([:])
      return
    }
    guard url.startAccessingSecurityScopedResource() else {
      invoke.reject("battuta was not given access to that folder")
      return
    }
    held.append(url)
    do {
      try remember(url)
      invoke.resolve(["path": url.path])
    } catch {
      invoke.reject("could not keep access to that folder: \(error.localizedDescription)")
    }
  }

  public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pickInvoke?.resolve([:])
    pickInvoke = nil
  }

  /// A folder picked in an earlier session: its current path (the bookmark
  /// follows a moved folder) with its scope started, or nothing when no
  /// bookmark is kept for it or it is gone.
  @objc public func openFolder(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PathArgs.self)
    if held.contains(where: { $0.path == args.path }) {
      invoke.resolve(["path": args.path])
      return
    }
    guard let data = bookmarks()[args.path] else {
      invoke.resolve([:])
      return
    }
    var stale = false
    guard let url = try? URL(resolvingBookmarkData: data, bookmarkDataIsStale: &stale), url.startAccessingSecurityScopedResource() else {
      invoke.resolve([:])
      return
    }
    held.append(url)
    if stale || url.path != args.path {
      var all = bookmarks()
      all.removeValue(forKey: args.path)
      UserDefaults.standard.set(all, forKey: Self.bookmarksKey)
      try? remember(url)
    }
    invoke.resolve(["path": url.path])
  }

  private func bookmarks() -> [String: Data] {
    UserDefaults.standard.dictionary(forKey: Self.bookmarksKey) as? [String: Data] ?? [:]
  }

  private func remember(_ url: URL) throws {
    var all = bookmarks()
    all[url.path] = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
    UserDefaults.standard.set(all, forKey: Self.bookmarksKey)
  }
}

@_cdecl("init_plugin_battuta_mobile")
func initPlugin() -> Plugin {
  return BattutaMobilePlugin()
}
