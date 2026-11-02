import CoreML
import Foundation

/// granita's Core ML export (`granitanet.mlpackage`, compiled into the app by the
/// iOS project; its sidecar beside it), fed the way granita feeds PyTorch (phase 11,
/// M2; lifted from granita's iOS test shell): `input` (1, 1, 32, 32) float32, the
/// normalised pixels, and `context` (1, 16); `logits` (1, 43) out, softmax for the
/// confidences. Loaded once, on the first symbol.
final class GranitaModel {
  struct Sidecar: Decodable {
    let model: String
    let classes: [String]
  }

  struct Prediction {
    let label: String
    let confidence: Float
  }

  let sidecar: Sidecar
  private let model: MLModel

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
    model = try MLModel(contentsOf: url, configuration: configuration)
  }

  /// The classes by confidence, best first.
  func predict(input: [Float], context: [Float], topK: Int = 5) throws -> [Prediction] {
    precondition(input.count == StrokeRaster.size * StrokeRaster.size && context.count == SymbolContext.dim)
    // Filled by subscript: the buffer-pointer fill is iOS 15.4+, the shell's floor is 15.0.
    let image = try MLMultiArray(shape: [1, 1, 32, 32], dataType: .float32)
    for (i, v) in input.enumerated() { image[i] = NSNumber(value: v) }
    let ctx = try MLMultiArray(shape: [1, NSNumber(value: SymbolContext.dim)], dataType: .float32)
    for (i, v) in context.enumerated() { ctx[i] = NSNumber(value: v) }
    let features = try MLDictionaryFeatureProvider(dictionary: ["input": image, "context": ctx])
    let output = try model.prediction(from: features)
    guard let array = output.featureValue(for: "logits")?.multiArrayValue else {
      throw GranitaError.model("returned no logits")
    }
    let logits = (0..<array.count).map { Float(truncating: array[$0]) }
    let m = logits.max() ?? 0
    let e = logits.map { exp($0 - m) }
    let s = e.reduce(0, +)
    let probabilities = e.map { $0 / s }
    return probabilities.indices.sorted { probabilities[$0] > probabilities[$1] }.prefix(topK).map {
      Prediction(label: sidecar.classes[$0], confidence: probabilities[$0])
    }
  }
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
