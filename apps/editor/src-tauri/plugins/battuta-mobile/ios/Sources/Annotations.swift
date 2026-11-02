import Foundation

/// A reply saved for the dataset (`ctx.stylus.reply`, 1.3.10): musicset's contribution
/// record (`musicset.strokes`: `label`, `writer`, `staff_space`, `strokes` with time and
/// pressure, `context`, `device`, `app`, `time`), the fraction the symbol was drawn at and
/// the classifier's answer before the reply. Keys are snake_case in the file. Lifted from
/// granita's iOS test shell, without the shell's staff and notes: the context carries what
/// granita needs of the score.
struct Reply: Codable {
  struct Context: Codable {
    var yStaff, xMeasure, barline: Double
    var noteDx, noteDy, noteW, noteH: Double?
    var width, height: Double
  }

  struct Predicted: Codable {
    var label: String
    var confidence: Float
  }

  var label: String
  var writer: String
  var staffSpace: Double
  /// One list per pen-down: `[x, y, t_ms, pressure]`.
  var strokes: [[[Double]]]
  var context: Context?
  var fraction: Double
  var predicted: Predicted?
  var device: String
  var app: String
  var time: String
}

extension Reply.Context {
  init(_ c: SymbolContext) {
    self.init(yStaff: c.yStaff, xMeasure: c.xMeasure, barline: c.barline, noteDx: c.noteDx, noteDy: c.noteDy, noteW: c.noteW, noteH: c.noteH, width: c.width, height: c.height)
  }
}

extension SymbolContext {
  /// The context a reply recorded, for its vector again.
  init(_ r: Reply.Context) {
    self.init(yStaff: r.yStaff, xMeasure: r.xMeasure, barline: r.barline, noteDx: r.noteDx, noteDy: r.noteDy, width: r.width, height: r.height, noteW: r.noteW, noteH: r.noteH)
  }
}

/// The replies on this device: `replies.jsonl` in the shell's stylus folder (the app's
/// data, beside `shell.log`; the share sheet sends it), one record a line, appended as
/// they come. The writer id is this install's, a UUID kept in the defaults.
final class Annotations {
  static let fileName = "replies.jsonl"
  let url: URL
  let writer: String
  private(set) var count: Int

  init(directory: URL, defaults: UserDefaults = .standard) {
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    url = directory.appendingPathComponent(Self.fileName)
    if let id = defaults.string(forKey: "battuta.stylus.writer") {
      writer = id
    } else {
      writer = UUID().uuidString.lowercased()
      defaults.set(writer, forKey: "battuta.stylus.writer")
    }
    count = ((try? String(contentsOf: url, encoding: .utf8)) ?? "").split(separator: "\n", omittingEmptySubsequences: true).count
  }

  private static let encoder: JSONEncoder = {
    let e = JSONEncoder()
    e.keyEncodingStrategy = .convertToSnakeCase
    e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return e
  }()

  private static let decoder: JSONDecoder = {
    let d = JSONDecoder()
    d.keyDecodingStrategy = .convertFromSnakeCase
    return d
  }()

  static func now() -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f.string(from: Date())
  }

  func append(_ reply: Reply) throws {
    var line = try Self.encoder.encode(reply)
    line.append(contentsOf: [0x0A])
    if FileManager.default.fileExists(atPath: url.path) {
      let handle = try FileHandle(forWritingTo: url)
      defer { try? handle.close() }
      try handle.seekToEnd()
      try handle.write(contentsOf: line)
    } else {
      try line.write(to: url, options: .atomic)
    }
    count += 1
  }

  /// Every reply in the file, in order; a line that does not parse is skipped.
  func all() -> [Reply] {
    guard let text = try? String(contentsOf: url, encoding: .utf8) else { return [] }
    return text.split(separator: "\n", omittingEmptySubsequences: true).compactMap { try? Self.decoder.decode(Reply.self, from: Data($0.utf8)) }
  }

  /// The file gone, the count with it (`ctx.stylus.deleteReplies`, 1.3.11).
  func deleteAll() {
    try? FileManager.default.removeItem(at: url)
    count = 0
  }
}

/// What the last training did, kept beside the trained layer (`training.json`) so the
/// plugins page can show it after a restart (`ctx.stylus.replies`, 1.3.11).
struct TrainingRecord: Codable {
  var replies: Int
  var buffer: Int
  var anchors: Int
  var loss: Double
  var accuracy: Double
  var drift: Double

  var json: [String: Any] { ["replies": replies, "buffer": buffer, "anchors": anchors, "loss": loss, "accuracy": accuracy, "drift": drift] }

  static func load(from url: URL) -> TrainingRecord? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(TrainingRecord.self, from: data)
  }

  func save(to url: URL) throws {
    try JSONEncoder().encode(self).write(to: url, options: .atomic)
  }
}
