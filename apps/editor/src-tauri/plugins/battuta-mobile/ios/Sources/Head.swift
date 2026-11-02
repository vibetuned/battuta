import Foundation

/// The last layer, `Linear(128 -> classes)`, as the shell holds it: the sidecar's weights to
/// start with, then what training on the user's replies made of them (`Trainer`). Lifted
/// from granita's iOS test shell (phase 11, 2026-11-02), kept identical.
struct HeadWeights: Codable, Equatable {
    /// `classes` rows of `width` values.
    var weight: [[Float]]
    var bias: [Float]

    var classes: Int { bias.count }
    var width: Int { weight.first?.count ?? 0 }

    init(weight: [[Float]], bias: [Float]) {
        self.weight = weight
        self.bias = bias
    }

    init(_ head: GranitaModel.Sidecar.Head) {
        self.init(weight: head.weight, bias: head.bias)
    }

    /// The layer applied: `weight · features + bias`.
    func logits(_ features: [Float]) -> [Float] {
        precondition(features.count == width)
        return weight.indices.map { c in
            var acc = bias[c]
            let row = weight[c]
            for k in 0..<features.count { acc += row[k] * features[k] }
            return acc
        }
    }

    /// The app's trained copy on disk, if any; nil when none was saved.
    static func load(from url: URL) -> HeadWeights? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(HeadWeights.self, from: data)
    }

    func save(to url: URL) throws {
        try JSONEncoder().encode(self).write(to: url, options: .atomic)
    }
}

/// One reply, as the trainer sees it: the features the model read for the drawing and
/// the class the user named.
struct Example {
    let features: [Float]
    let label: Int
}

/// An anchor (`anchors.json`, `scripts/export_anchors.py`): features the released model
/// read, with the logits its own last layer gave them — what the trained layer is held to.
struct Anchor: Decodable {
    let label: Int
    let features: [Float]
    let logits: [Float]
}

struct Anchors: Decodable {
    let source: String
    let anchors: [Anchor]

    static func load(from bundle: Bundle = .main) -> Anchors? {
        guard let url = bundle.url(forResource: "anchors", withExtension: "json"), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Anchors.self, from: data)
    }
}

/// A tiny replay buffer: the newest `perClass` replies of every class, so one symbol
/// written fifty times does not drown the others and the old corrections stay in play.
struct ReplayBuffer {
    static let perClass = 8
    let examples: [Example]

    /// `replies` in the order they were given; the newest of each class are kept.
    init(replies: [Example], perClass: Int = ReplayBuffer.perClass) {
        var kept: [Example] = []
        var count: [Int: Int] = [:]
        for e in replies.reversed() where (count[e.label] ?? 0) < perClass {
            count[e.label, default: 0] += 1
            kept.append(e)
        }
        examples = kept.reversed()
    }
}

/// The last layer trained on the device: plain gradient steps on the replay buffer's
/// cross-entropy, the anchors' answers held (the KL from the original layer's softmax
/// to the trained one, on every anchor, each epoch) and the weights pulled back toward
/// the original ones (an L2 anchor, once per epoch). Deterministic: the buffer is
/// shuffled by a fixed generator.
enum Trainer {
    struct Config {
        /// Logit units a step moves per unit of error (the steps are normalised by the features' size).
        var learningRate: Float = 0.5
        var epochs = 30
        /// The anchors' pull, next to a reply's 1.
        var anchorWeight: Float = 1.0
        /// The pull toward the original weights, per epoch.
        var l2: Float = 0.01
    }

    struct Report {
        let examples: Int
        let anchors: Int
        let epochs: Int
        /// Mean cross-entropy over the buffer, and how many of its replies the layer now gets right.
        let loss: Float
        let accuracy: Float
        /// Mean KL from the original layer's answers over the anchors.
        let anchorDrift: Float
    }

    /// One gradient step toward `target` on `f`, normalised by the features' size so a
    /// step moves the logits by about `lr` times the error whatever the features' scale
    /// (they run to a norm of ~10 here; an unnormalised step would flip the layer on one
    /// reply and let the last example of an epoch win).
    private static func step(_ head: inout HeadWeights, features f: [Float], target: [Float], weight: Float, lr: Float) {
        let p = softmax(head.logits(f))
        let scale = lr / max(1, f.reduce(0) { $0 + $1 * $1 })
        for c in 0..<head.classes {
            let g = weight * (p[c] - target[c])
            if g == 0 { continue }
            for k in 0..<f.count { head.weight[c][k] -= scale * g * f[k] }
            head.bias[c] -= scale * g
        }
    }

    private static func oneHot(_ label: Int, _ n: Int) -> [Float] {
        var t = [Float](repeating: 0, count: n)
        t[label] = 1
        return t
    }

    static func train(_ head: inout HeadWeights, origin: HeadWeights, buffer: ReplayBuffer, anchors: [Anchor], config: Config = Config()) -> Report {
        var seed: UInt64 = 0x9E37_79B9_7F4A_7C15
        func next() -> UInt64 { seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407; return seed >> 33 }
        let targets = anchors.map { softmax($0.logits) }
        for _ in 0..<config.epochs {
            var order = Array(buffer.examples.indices)
            for i in stride(from: order.count - 1, to: 0, by: -1) { order.swapAt(i, Int(next() % UInt64(i + 1))) }
            for i in order {
                let e = buffer.examples[i]
                step(&head, features: e.features, target: oneHot(e.label, head.classes), weight: 1, lr: config.learningRate)
            }
            for (a, t) in zip(anchors, targets) {
                step(&head, features: a.features, target: t, weight: config.anchorWeight, lr: config.learningRate)
            }
            for c in 0..<head.classes {
                for k in 0..<head.width { head.weight[c][k] -= config.learningRate * config.l2 * (head.weight[c][k] - origin.weight[c][k]) }
                head.bias[c] -= config.learningRate * config.l2 * (head.bias[c] - origin.bias[c])
            }
        }
        return report(head, buffer: buffer, anchors: anchors, epochs: config.epochs)
    }

    static func report(_ head: HeadWeights, buffer: ReplayBuffer, anchors: [Anchor], epochs: Int) -> Report {
        var loss: Float = 0, right = 0
        for e in buffer.examples {
            let p = softmax(head.logits(e.features))
            loss -= log(max(p[e.label], 1e-7))
            if p.indices.max(by: { p[$0] < p[$1] }) == e.label { right += 1 }
        }
        var drift: Float = 0
        for a in anchors {
            let q0 = softmax(a.logits), q = softmax(head.logits(a.features))
            for c in q.indices where q0[c] > 0 { drift += q0[c] * log(q0[c] / max(q[c], 1e-7)) }
        }
        let n = max(buffer.examples.count, 1)
        return Report(examples: buffer.examples.count, anchors: anchors.count, epochs: epochs, loss: loss / Float(n), accuracy: Float(right) / Float(n), anchorDrift: anchors.isEmpty ? 0 : drift / Float(anchors.count))
    }
}
