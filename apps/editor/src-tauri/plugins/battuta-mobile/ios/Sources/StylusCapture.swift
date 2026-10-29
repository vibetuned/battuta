import QuartzCore
import Tauri
import UIKit
import UIKit.UIGestureRecognizerSubclass

/// The stylus bridge's native half on iPadOS and iOS (1.3.0, phase 11).
///
/// While capture is ON, every Apple Pencil touch that begins inside `area`
/// (the score, as the page says) is battuta's — a recognizer takes it before
/// the WebView does — while a Pencil touch elsewhere taps like a finger, and
/// fingers still scroll, zoom and tap (the user's rules, 2026-10-29: the pen
/// writes, fingers scroll; the pen writes only on the score). WebKit still
/// hands the page a taken stroke's pointer events, so the page stops them
/// itself (`shieldFromPen` in host/stylus.tsx). What it sends down the
/// channel, as measured first with the stylus probe (an iPad Air M4 and an
/// Apple Pencil Pro):
///
///   stroke  down / move / up / cancel, the samples batched once per screen
///           frame: [x, y, t, pressure, altitude, azimuth, roll] — page pixels
///           (the WebView's points are the page's CSS pixels), ms, 0–1,
///           radians, roll null on a Pencil without it — with the system's
///           predicted samples beside them
///   hold    the tip within 8 pt of where it landed for 0.5 s: a held Pencil
///           wobbles (13 pt of path in a 1.3 s hold), so a hold is judged by
///           distance from the landing, never by path
///   hover   enter / move / leave with the height (0–1), once per frame
///   button  the Pencil Pro's squeeze (down, up) and double-tap (tap), with
///           where it hovers when it does
final class StylusCapture: NSObject, UIGestureRecognizerDelegate, UIPencilInteractionDelegate {
  static let holdReach: CGFloat = 8
  static let holdTime: TimeInterval = 0.5

  /// Where the pen writes, in the view's points (the page's CSS pixels); empty: nowhere.
  var area: [CGRect] = []
  private var channel: Channel
  private var pen: PenRecognizer!
  private var hovering: UIHoverGestureRecognizer!
  private let interaction = UIPencilInteraction()
  private var link: CADisplayLink?
  private var nextStroke = 0
  private var stroke: (id: Int, start: CGPoint, reach: CGFloat, held: Bool)?
  private var samples: [[Double?]] = []
  private var predicted: [[Double?]] = []
  private var hover: Hover?
  private var hoverIn = false

  init(view: UIView, channel: Channel) {
    self.channel = channel
    super.init()
    let pencil = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
    pen = PenRecognizer(capture: self)
    pen.allowedTouchTypes = pencil
    // Taken before the WebView sees them: held back from the view until this
    // recognizer decides — and it decides at once, so the view never gets them.
    pen.delaysTouchesBegan = true
    pen.cancelsTouchesInView = true
    pen.delegate = self
    pen.isEnabled = false
    view.addGestureRecognizer(pen)
    hovering = UIHoverGestureRecognizer(target: self, action: #selector(hovered(_:)))
    hovering.isEnabled = false
    view.addGestureRecognizer(hovering)
    interaction.delegate = self
    interaction.isEnabled = false
    view.addInteraction(interaction)
  }

  /// A new page subscription: the events go to its channel from now on.
  func update(_ channel: Channel) {
    self.channel = channel
  }

  func set(on: Bool) {
    pen.isEnabled = on
    hovering.isEnabled = on
    interaction.isEnabled = on
    if on {
      if link == nil {
        let l = CADisplayLink(target: self, selector: #selector(frame))
        l.add(to: .main, forMode: .common)
        link = l
      }
    } else {
      link?.invalidate()
      link = nil
      stroke = nil
      samples = []
      predicted = []
      hover = nil
      hoverIn = false
    }
  }

  // MARK: what goes down the channel

  private struct Stroke: Encodable {
    let type = "stroke"
    let phase: String
    let id: Int
    let samples: [[Double?]]
    let predicted: [[Double?]]
  }

  private struct Hold: Encodable {
    let type = "hold"
    let id: Int
    let x: Double
    let y: Double
  }

  private struct Hover: Encodable {
    let type = "hover"
    let phase: String
    let x: Double
    let y: Double
    let height: Double
  }

  /// Debug builds: a line for the shell log, about the capture itself.
  private struct Debug: Encodable {
    let type = "debug"
    let msg: String
  }

  fileprivate func debug(_ msg: String) {
    #if DEBUG
      send(Debug(msg: msg))
    #endif
  }

  private struct Button: Encodable {
    let type = "button"
    let button: String
    let phase: String
    let x: Double?
    let y: Double?
    let height: Double?
  }

  private func send<T: Encodable>(_ event: T) {
    do {
      try channel.send(event)
    } catch {
      NSLog("battuta stylus: dropped a \(T.self): \(error)")
    }
  }

  private func flush(_ id: Int, _ phase: String) {
    send(Stroke(phase: phase, id: id, samples: samples, predicted: predicted))
    samples = []
    predicted = []
  }

  @objc private func frame() {
    if let s = stroke, !samples.isEmpty { flush(s.id, "move") }
    if let h = hover {
      send(h)
      hover = nil
    }
  }

  /// JSON has no NaN or infinity: the encoder throws on one, and the whole
  /// event would be lost — the Pencil's lift was (2026-10-29: on the iPad
  /// the cross stayed up and no note was written). A value the system does
  /// not have becomes the neutral one, roll none.
  private func finite(_ v: Double, or fallback: Double) -> Double { v.isFinite ? v : fallback }

  private func sample(_ t: UITouch, _ view: UIView?) -> [Double?] {
    let p = t.preciseLocation(in: view)
    var roll: Double?
    if #available(iOS 17.5, *) { roll = Double(t.rollAngle) }
    let pressure = t.maximumPossibleForce > 0 ? Double(t.force / t.maximumPossibleForce) : 0
    return [
      finite(Double(p.x), or: 0), finite(Double(p.y), or: 0), finite(t.timestamp * 1000, or: 0), finite(pressure, or: 0),
      finite(Double(t.altitudeAngle), or: .pi / 2), finite(Double(t.azimuthAngle(in: view)), or: 0), roll.flatMap { $0.isFinite ? $0 : nil },
    ]
  }

  // MARK: strokes

  fileprivate func began(_ t: UITouch, _ event: UIEvent, _ view: UIView?) {
    nextStroke += 1
    let id = nextStroke
    let p = t.preciseLocation(in: view)
    stroke = (id, p, 0, false)
    samples = [sample(t, view)]
    flush(id, "down")
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.holdTime) { [weak self] in
      guard let self = self, var s = self.stroke, s.id == id, !s.held, s.reach <= Self.holdReach else { return }
      s.held = true
      self.stroke = s
      self.send(Hold(id: id, x: Double(s.start.x), y: Double(s.start.y)))
    }
  }

  fileprivate func moved(_ t: UITouch, _ event: UIEvent, _ view: UIView?) {
    guard var s = stroke else { return }
    for c in event.coalescedTouches(for: t) ?? [t] {
      let p = c.preciseLocation(in: view)
      s.reach = max(s.reach, hypot(p.x - s.start.x, p.y - s.start.y))
      samples.append(sample(c, view))
    }
    predicted = (event.predictedTouches(for: t) ?? []).map { sample($0, view) }
    stroke = s
  }

  fileprivate func ended(_ t: UITouch, _ view: UIView?, cancelled: Bool) {
    guard let s = stroke else { return }
    samples.append(sample(t, view))
    predicted = []
    flush(s.id, cancelled ? "cancel" : "up")
    stroke = nil
  }

  // MARK: hover

  @objc private func hovered(_ r: UIHoverGestureRecognizer) {
    var height: CGFloat = 0
    if #available(iOS 16.1, *) { height = r.zOffset }
    // The Pencil hovers above the glass (zOffset > 0); a trackpad's pointer does not.
    guard height > 0 || hoverIn else { return }
    let p = r.location(in: r.view)
    switch r.state {
    case .began:
      hoverIn = true
      send(Hover(phase: "enter", x: Double(p.x), y: Double(p.y), height: Double(height)))
    case .changed:
      hover = Hover(phase: "move", x: Double(p.x), y: Double(p.y), height: Double(height))
    case .ended, .cancelled:
      hoverIn = false
      hover = nil
      send(Hover(phase: "leave", x: Double(p.x), y: Double(p.y), height: Double(height)))
    default:
      break
    }
  }

  // MARK: squeeze and double-tap

  func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
    send(Button(button: "doubleTap", phase: "tap", x: nil, y: nil, height: nil))
  }

  @available(iOS 17.5, *)
  func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
    let p = tap.hoverPose
    send(Button(button: "doubleTap", phase: "tap", x: p.map { Double($0.location.x) }, y: p.map { Double($0.location.y) }, height: p.map { Double($0.zOffset) }))
  }

  @available(iOS 17.5, *)
  func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
    let phase: String
    switch squeeze.phase {
    case .began: phase = "down"
    case .ended, .cancelled: phase = "up"
    default: return // the stream of `changed` adds nothing a hover does not
    }
    let p = squeeze.hoverPose
    send(Button(button: "squeeze", phase: phase, x: p.map { Double($0.location.x) }, y: p.map { Double($0.location.y) }, height: p.map { Double($0.zOffset) }))
  }

  // MARK: the WebView's own recognizers give way to the Pencil

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    g !== pen
  }

  /// The pen takes only a touch that lands on the score; any other is the page's.
  func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    guard g === pen else { return true }
    let p = touch.location(in: g.view)
    return area.contains { $0.contains(p) }
  }
}

/// Takes the Pencil's touches: it begins at the first one, so the WebView's
/// own recognizers (scrolling, its touch events) are prevented and the view
/// is never handed the touch.
private final class PenRecognizer: UIGestureRecognizer {
  private weak var capture: StylusCapture?
  private var tracked: UITouch?

  init(capture: StylusCapture) {
    self.capture = capture
    super.init(target: nil, action: nil)
  }

  override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { true }
  override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    guard tracked == nil, let t = touches.first else { return }
    tracked = t
    capture?.began(t, event, view)
    state = .began
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let t = tracked, touches.contains(t) else { return }
    capture?.moved(t, event, view)
    state = .changed
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let t = tracked, touches.contains(t) else { return }
    capture?.ended(t, view, cancelled: false)
    tracked = nil
    state = .ended
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let t = tracked, touches.contains(t) else { return }
    capture?.ended(t, view, cancelled: true)
    tracked = nil
    state = .cancelled
  }

  /// A reset with the Pencil still down means UIKit took the stroke from
  /// this recognizer (another recognizer won, or the system cancelled it):
  /// the stroke ends as a cancel, so the page is never left waiting for a
  /// lift that will not come.
  override func reset() {
    super.reset()
    if let t = tracked {
      capture?.debug("pen recognizer reset with its touch in phase \(t.phase.rawValue)")
      capture?.ended(t, view, cancelled: true)
    }
    tracked = nil
  }
}
