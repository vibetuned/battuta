import CoreML
import Foundation

/// granita's Core ML export (`granitanet.mlpackage`, compiled into the app by the
/// iOS project; its sidecar beside it), fed the way granita feeds PyTorch (phase 11,
/// M2; lifted from granita's iOS test shell): `input` (1, 1, 32, 32) float32, the
/// normalised pixels, and `context` (1, 16); `logits` (1, 43) out, softmax for the
/// confidences. Loaded once, on the first symbol.
///
/// A package with a `personal` function (the sidecar has a `head`) is run through it
/// (iOS 18, `MLModelConfiguration.functionName`): the last layer's weights go in as
/// `head_w` / `head_b` and the `features` that layer reads come out, so the shell can
/// train that layer on the device from the user's replies (`Head.swift`) and still run
/// the whole network on the accelerator. The layer fed is `head`: the sidecar's, or the
/// trained copy the plugin keeps.
final class GranitaModel {
  struct Sidecar: Decodable {
    /// The last layer as trained, what a copy starts from.
    struct Head: Decodable {
      let function: String
      let shape: [Int]
      let weight: [[Float]]
      let bias: [Float]
    }

    let model: String
    let classes: [String]
    let head: Head?
  }

  struct Prediction {
    let label: String
    let confidence: Float
  }

  /// What a symbol got: the classes by confidence, and what the last layer read (empty without the `personal` function).
  struct Answer {
    let top: [Prediction]
    let features: [Float]
  }

  let sidecar: Sidecar
  /// The last layer as fed to the `personal` function; set to a trained copy to use it.
  var head: HeadWeights? {
    didSet { headArrays = nil }
  }
  private let model: MLModel
  private var headArrays: (w: MLMultiArray, b: MLMultiArray)?

  init(bundle: Bundle = .main) throws {
    guard let sidecarUrl = bundle.url(forResource: "granitanet", withExtension: "json") else {
      throw GranitaError.missing("granitanet.json")
    }
    sidecar = try JSONDecoder().decode(Sidecar.self, from: Data(contentsOf: sidecarUrl))
    guard let url = bundle.url(forResource: "granitanet", withExtension: "mlmodelc") else {
      throw GranitaError.missing("granitanet.mlmodelc")
    }
    let configuration = MLModelConfiguration()
    configuration.computeUnits = .cpuOnly
    if let h = sidecar.head {
      configuration.functionName = h.function
      head = HeadWeights(h)
    }
    model = try MLModel(contentsOf: url, configuration: configuration)
  }

  /// Whether the package is run through its `personal` function, the last layer in hand.
  var personal: Bool { head != nil }

  private static func array(_ shape: [Int], _ values: [Float]) throws -> MLMultiArray {
    let array = try MLMultiArray(shape: shape.map { NSNumber(value: $0) }, dataType: .float32)
    // Filled by subscript: the buffer-pointer fill is iOS 15.4+, which was the shell's floor.
    for (i, v) in values.enumerated() { array[i] = NSNumber(value: v) }
    return array
  }

  /// The classes by confidence, best first, and the features.
  func predict(input: [Float], context: [Float], topK: Int = 5) throws -> Answer {
    precondition(input.count == StrokeRaster.size * StrokeRaster.size && context.count == SymbolContext.dim)
    var inputs: [String: Any] = [
      "input": try Self.array([1, 1, 32, 32], input),
      "context": try Self.array([1, SymbolContext.dim], context),
    ]
    if let head {
      if headArrays == nil {
        headArrays = (try Self.array([head.classes, head.width], head.weight.flatMap { $0 }), try Self.array([head.classes], head.bias))
      }
      inputs["head_w"] = headArrays!.w
      inputs["head_b"] = headArrays!.b
    }
    let features = try MLDictionaryFeatureProvider(dictionary: inputs)
    let output = try model.prediction(from: features)
    guard let array = output.featureValue(for: "logits")?.multiArrayValue else {
      throw GranitaError.model("returned no logits")
    }
    let logits = (0..<array.count).map { Float(truncating: array[$0]) }
    let read = output.featureValue(for: "features")?.multiArrayValue
    let feats = read.map { a in (0..<a.count).map { Float(truncating: a[$0]) } } ?? []
    let probabilities = softmax(logits)
    let top = probabilities.indices.sorted { probabilities[$0] > probabilities[$1] }.prefix(topK).map {
      Prediction(label: sidecar.classes[$0], confidence: probabilities[$0])
    }
    return Answer(top: Array(top), features: feats)
  }
}

func softmax(_ x: [Float]) -> [Float] {
  let m = x.max() ?? 0
  let e = x.map { exp($0 - m) }
  let s = e.reduce(0, +)
  return e.map { $0 / s }
}

enum GranitaError: Error, CustomStringConvertible {
  case missing(String)
  case model(String)

  var description: String {
    switch self {
    case .missing(let what): return "granita: \(what) is not in the app bundle"
    case .model(let what): return "granita: the model \(what)"
    }
  }
}
