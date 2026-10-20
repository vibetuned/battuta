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
