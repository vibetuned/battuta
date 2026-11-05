/**
 * The stylus plugin (phase 11): notes written with the Apple Pencil or the
 * S Pen, two ways. The pen is the host's — `ctx.stylus` captures it on the
 * score and reads every event against it — and the plugin is what the pen
 * means, in one of two modes the status-bar item switches:
 *
 *   - **the cross** (part 1): a touch puts a cross at the tip, a drag sets
 *     the note's length and pitch, a lift writes it (`gesture.ts`,
 *     `Cross.tsx`);
 *   - **handwriting** (part 3): the strokes of a symbol are drawn as they
 *     come and gathered (`handwriting.ts`), read by granita in the shell
 *     (`ctx.stylus.recognize`), placed by the rules the model cannot learn
 *     (`rules.ts`) and written as a mark or a note, with a ✓ ✗ to confirm
 *     — or, when the model is unsure, offered as a choice beside the
 *     symbol, with a row to discard it (`Feedback.tsx`);
 *   - **slurs and ties** (2026-11-02): a bow drawn from a note to another
 *     (`bow.ts`) is a tie when they are the same note, a slur otherwise,
 *     written as `core.mark` with the ✓ ✗ of handwriting — ✗ offering the
 *     other kind.
 */
import { definePlugin, type PluginContext, type StylusEvent, type StylusRecognition, type StylusReplies, type StylusScorePoint } from "@battuta/api";
import { Cross } from "./Cross";
import { bowKind, bowStep, boxOf, type Bow, type BowDone } from "./bow";
import { chooserHeight, confirmRect, FeedbackLayer, InkLayer, ModeItem, OPTION_W, optionRect, type Feedback, type Ink, type Mode, type Option } from "./Feedback";
import { IDLE, lengthOf, next, type Gesture } from "./gesture";
import { group, tick, type Point, type Symbol, type Writing } from "./handwriting";
import { DELETE_REPLIES_COMMAND, FEEDBACK_ID, INK_ID, MODE_COMMAND, OVERLAY_ID, RESET_TRAINING_COMMAND, SHARE_REPLIES_COMMAND, TRAIN_COMMAND } from "./manifest";
import { RepliesSection } from "./Replies";
import { choose, contextOf, headOf, nameOf, NOTE_MARGIN, writeAs, type Outcome, type Targets } from "./rules";
import { signal } from "./store";

/** How long the label of what was written stays, with its ✓ ✗. */
const LABEL_MS = 3000;
/** Staff spaces within which a mark's centre is under the symbol — what the eraser touches. */
const TOUCH_SPACES = 2;

/** What is beside a symbol once read: where it sits, the choices the chooser offers, and how a choice is written. */
interface Reading {
  symbol: Symbol;
  at: StylusScorePoint;
  options: readonly Option[];
  /** A chosen option as a message: granita's rules for a handwritten symbol, the bow's own two kinds for a bow. */
  write: (o: Option) => Outcome;
  /** The class that was written, when one was — what ✓ confirms. */
  written?: string;
  /** A confirmed class to the shell's replies (1.3.10): handwriting only, never a bow. */
  reply?: (label: string) => void;
}

/** What a tap on the mode item goes to. */
const NEXT_MODE: Record<Mode, Mode> = { cross: "handwriting", handwriting: "slur", slur: "cross" };

/** What is on screen beside the symbol: its page corner and what a tap means. */
type Shown = { kind: "chooser"; corner: Point; reading: Reading } | { kind: "confirm"; corner: Point; reading: Reading };

const toOptions = (top: readonly StylusRecognition[]): Option[] => top.map((o) => ({ label: o.label, name: nameOf(o.label), confidence: o.confidence }));

const within = (p: Point, r: { x: number; y: number; w: number; h: number }): boolean => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;

export default definePlugin({
  activate(ctx: PluginContext) {
    // Anything but the iOS and Android shells: no stylus to capture.
    if (!ctx.stylus.available) return;
    const mode = signal<Mode>("cross");
    const gesture = signal<Gesture>(IDLE);
    const ink = signal<Ink | null>(null);
    const feedback = signal<Feedback>({ kind: "none" });
    let writing: Writing | null = null;
    let bow: Bow | null = null;
    let clock: ReturnType<typeof setTimeout> | null = null;
    let fading: ReturnType<typeof setTimeout> | null = null;
    let shown: Shown | null = null;
    /** A pen tap on a button: what it landed on, acted on when it lifts. */
    let pressing: (() => void) | null = null;

    const say = (what: string, err: unknown): void => ctx.notice(`${what}: ${err instanceof Error ? err.message : String(err)}`);
    // The plugins-page section (1.3.11): the replies on the device, re-read after anything that changes them.
    const replies = signal<StylusReplies | null>(null);
    const busy = signal(false);
    const refresh = (): Promise<void> =>
      ctx.stylus.replies().then(
        (r) => replies.set(r),
        () => replies.set(null),
      );

    // --- the cross ---------------------------------------------------------------

    const crossEvent = (e: StylusEvent): void => {
      const { entryDur, entryDots } = ctx.editor.get();
      const step = next(gesture.get(), e, lengthOf(entryDur, entryDots));
      gesture.set(step.gesture);
      if (!step.write) return;
      try {
        ctx.execute(step.write);
        // The cross's length becomes the input's, as a digit would make it.
        if (step.length) ctx.setEntryLength(step.length.dur, step.length.dots);
      } catch (err) {
        say(step.write.type === "core.addChordNote" ? "chord refused" : "entry refused", err);
      }
    };

    // --- handwriting -------------------------------------------------------------

    const clearShown = (): void => {
      if (fading) clearTimeout(fading);
      fading = null;
      shown = null;
      pressing = null;
      feedback.set({ kind: "none" });
    };

    /** The symbol's tile frame, from where it landed: the page point less its tile point. */
    const tileOrigin = (s: Symbol): Point => [s.landing.point[0] - s.landing.at.tile.x, s.landing.point[1] - s.landing.at.tile.y];

    /** A corner beside the symbol for something `w` wide and `h` tall, kept inside its measure: to its right, else to its left. */
    const corner = (r: Reading, w: number, h: number): Point => {
      const b = r.symbol.box;
      const right = b.maxX + 8;
      const x = right + w <= r.at.measure.right ? right : Math.max(r.at.measure.left, b.minX - 8 - w);
      const bottom = r.at.staff.middleY + 6 * r.at.staff.space;
      const y = Math.min(b.minY, bottom - h);
      return [x, y];
    };

    const execute = (name: string, outcome: Extract<Outcome, { kind: "write" }>): boolean => {
      try {
        ctx.execute(outcome.message);
        return true;
      } catch (err) {
        say(`${name} refused`, err);
        return false;
      }
    };

    const showChooser = (r: Reading): void => {
      clearShown();
      const c = corner(r, OPTION_W, chooserHeight(r.options.length));
      const origin = tileOrigin(r.symbol);
      shown = { kind: "chooser", corner: c, reading: r };
      feedback.set({ kind: "chooser", measureIndex: r.symbol.landing.at.measureIndex, x: c[0] - origin[0], y: c[1] - origin[1], options: r.options });
    };

    /** What was written — the class as engraved — with ✓ ✗ for a while — ✓ if left alone; the confidence when a classifier gave one. */
    const showWritten = (r: Reading, label: string, name: string, confidence: number | null): void => {
      clearShown();
      const c = corner(r, 2 * 34, 26);
      const origin = tileOrigin(r.symbol);
      shown = { kind: "confirm", corner: c, reading: r };
      feedback.set({ kind: "label", measureIndex: r.symbol.landing.at.measureIndex, x: c[0] - origin[0], y: c[1] - origin[1], label, name, confidence, confirm: true });
      fading = setTimeout(clearShown, LABEL_MS);
    };

    const show = (r: Reading, outcome: Outcome): void => {
      ink.set(null);
      if (outcome.kind === "choose") return showChooser(r);
      if (outcome.kind === "nothing") {
        clearShown();
        ctx.notice(outcome.reason);
        return;
      }
      if (execute(outcome.name, outcome)) showWritten({ ...r, written: outcome.label }, outcome.label, outcome.name, outcome.confidence);
      else clearShown();
    };

    /** A finished symbol: its place and its neighbours read off the score, the model's answers, the rules, the outcome. */
    const read = (s: Symbol): void => {
      const b = s.box;
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const at = ctx.stylus.at(cx, cy) ?? s.landing.at;
      const space = at.staff.space;
      const context = contextOf(b, at);
      const head = headOf(s, space);
      const headPitch = ctx.stylus.at(head[0], head[1])?.pitch ?? at.pitch;
      // The notehead before the symbol and the one after it, read beside its box; the one in its column.
      const probe = (x: number): StylusScorePoint["nearestNote"] => ctx.stylus.at(x, cy)?.nearestNote ?? null;
      const leftNote = probe(b.minX - space);
      const rightNote = probe(b.maxX + space);
      const nearest = at.nearestNote;
      // The mark under the symbol, for the eraser: within reach, and nearer than the note's head when both are.
      const m = at.nearestMark;
      const markDistance = m ? Math.hypot(cx - m.x, cy - m.y) : Infinity;
      const noteDistance = nearest ? Math.hypot(cx - nearest.x, cy - nearest.y) : Infinity;
      const targets: Targets = {
        event: at.eventId,
        note: nearest?.eventId ?? null,
        left: leftNote && leftNote.x < b.minX ? leftNote.eventId : null,
        right: rightNote && rightNote.x > b.maxX ? rightNote.eventId : null,
        // In the note's column: over its body, half a space to spare (granita's reading of "above" and "below").
        column: nearest && cx >= nearest.box.left - NOTE_MARGIN * space && cx <= nearest.box.right + NOTE_MARGIN * space ? nearest.eventId : null,
        mark: m && markDistance <= TOUCH_SPACES * space && markDistance <= noteDistance ? { id: m.id, kind: m.kind } : null,
      };
      ctx.stylus
        .recognize({ strokes: s.strokes, staffSpace: space, context })
        .then((top) => {
          const outcome = choose(top, context, targets, headPitch);
          const options = toOptions(outcome.kind === "nothing" ? [...top].sort((a, b) => b.confidence - a.confidence).slice(0, 3) : outcome.options);
          // A reply (1.3.10): the class the user confirms, with the symbol as the pen gave it, to the shell's dataset.
          const read = [...top].sort((a, b) => b.confidence - a.confidence)[0] ?? null;
          const reply = (label: string): void => {
            ctx.stylus.reply({ label, strokes: s.samples, staffSpace: space, context, read }).then(
              () => refresh(),
              (err) => say("reply", err),
            );
          };
          show({ symbol: s, at, options, write: (o) => writeAs(o.label, o.confidence, targets, headPitch, []), reply }, outcome);
        })
        .catch((err) => {
          ink.set(null);
          say("handwriting", err);
        });
    };

    const paint = (): void => {
      if (!writing) return ink.set(null);
      const strokes = writing.live ? [...writing.strokes, writing.live.points] : writing.strokes;
      ink.set({ origins: writing.origins, strokes });
    };

    const settle = (g: { writing: Writing | null; done?: Symbol }): void => {
      writing = g.writing;
      if (clock) clearTimeout(clock);
      clock = null;
      if (g.done) read(g.done);
      if (writing) {
        paint();
        if (writing.deadline !== null) {
          const w = writing;
          clock = setTimeout(() => settle(tick(w, Date.now())), Math.max(0, w.deadline! - Date.now()));
        }
      }
    };

    /** The chooser's pick: written regardless of where the symbol sat; the row past the options discards. */
    const pick = (i: number): void => {
      if (shown?.kind !== "chooser") return;
      const r = shown.reading;
      const o = r.options[i];
      clearShown();
      if (!o) return;
      const outcome = r.write(o);
      if (outcome.kind === "nothing") ctx.notice(outcome.reason);
      else if (outcome.kind === "write" && execute(outcome.name, outcome)) r.reply?.(o.label);
    };

    /** ✓ keeps what was written — and says so to the shell, a reply; ✗ undoes it and offers the other answers. */
    const confirm = (yes: boolean): void => {
      if (shown?.kind !== "confirm") return;
      const r = shown.reading;
      clearShown();
      if (yes) {
        if (r.written) r.reply?.(r.written);
        return;
      }
      if (!ctx.actions.run("undo")) ctx.notice("could not undo");
      showChooser(r);
    };

    /** What a pen tap at a page point does, if it lands on a button. */
    const buttonAt = (p: Point): (() => void) | null => {
      if (!shown) return null;
      if (shown.kind === "chooser") {
        // The options, and the discard row after them.
        for (let k = 0; k <= shown.reading.options.length; k++) if (within(p, optionRect(shown.corner[0], shown.corner[1], k))) return () => pick(k);
        return null;
      }
      if (within(p, confirmRect(shown.corner[0], shown.corner[1], 0))) return () => confirm(true);
      if (within(p, confirmRect(shown.corner[0], shown.corner[1], 1))) return () => confirm(false);
      return null;
    };

    // --- slurs and ties ----------------------------------------------------------

    /** A bow lifted: a tie when the two notes are the same note, a slur otherwise (the user, 2026-11-02); ✗ offers the other. */
    const bowDone = (d: BowDone): void => {
      ink.set(null);
      if (!d.to) return ctx.notice("a slur or a tie ends on a note");
      if (d.to.eventId === d.from.eventId) return ctx.notice("a slur or a tie goes from one note to another");
      const to = d.to;
      const kind = bowKind(d.from, to);
      const write = (o: Option): Extract<Outcome, { kind: "write" }> => ({ kind: "write", label: o.label, name: o.name, confidence: 1, message: { type: "core.mark", eventId: d.from.eventId, mark: { kind: o.label === "tie" ? "tie" : "slur", endId: to.eventId } }, options: [] });
      const other = kind === "tie" ? "slur" : "tie";
      const r: Reading = { symbol: { strokes: [d.points], samples: [], box: boxOf(d.points), landing: d.landing }, at: d.landing.at, options: [{ label: other, name: other, confidence: 1 }], write };
      if (execute(kind, write({ label: kind, name: kind, confidence: 1 }))) showWritten(r, kind, kind, null);
      else clearShown();
    };

    const bowEvent = (e: StylusEvent): void => {
      const had = bow !== null;
      const step = bowStep(bow, e);
      bow = step.bow;
      if (bow) ink.set({ origins: bow.origins, strokes: [bow.points] });
      else if (had) ink.set(null);
      if (step.done) bowDone(step.done);
    };

    /** Handwriting's and the bow's events: a tap on a button first, then the mode's own reading of the stroke. */
    const penEvent = (e: StylusEvent): void => {
      if (e.type !== "stroke") return;
      const last = e.samples[e.samples.length - 1];
      if (e.phase === "down" && last) {
        pressing = buttonAt([last[0], last[1]]);
        if (pressing) return;
        if (shown?.kind === "chooser") clearShown();
      }
      if (pressing) {
        if (e.phase === "up") pressing();
        else if (e.phase === "cancel") pressing = null;
        return;
      }
      if (mode.get() === "handwriting") settle(group(writing, e, Date.now()));
      else bowEvent(e);
    };

    // --- the mode ----------------------------------------------------------------

    const toggle = (): void => {
      mode.set(NEXT_MODE[mode.get()]);
      gesture.set(IDLE);
      if (clock) clearTimeout(clock);
      clock = null;
      writing = null;
      bow = null;
      ink.set(null);
      clearShown();
    };

    ctx.overlays.add({ id: OVERLAY_ID, render: (tile) => <Cross tile={tile} state={gesture} /> });
    ctx.overlays.add({ id: INK_ID, render: (tile) => <InkLayer tile={tile} state={ink} /> });
    ctx.overlays.add({ id: FEEDBACK_ID, render: (tile) => <FeedbackLayer tile={tile} state={feedback} onPick={pick} onConfirm={confirm} /> });
    ctx.registerCommand(MODE_COMMAND, toggle);
    // The replies and the training (1.3.10): the commands — and the buttons of the
    // plugins-page section (1.3.11) — each ending in a notice and a re-read of the numbers.
    const train = (): Promise<void> => {
      busy.set(true);
      ctx.notice("training on the replies…");
      return ctx.stylus
        .train()
        .then((t) => ctx.notice(`trained on ${t.replies} replies — ${t.buffer} in the buffer, ${t.anchors} anchors: ${Math.round(t.accuracy * 100)} % of the buffer right, anchor drift ${t.drift.toFixed(4)}`))
        .catch((err) => say("training", err))
        .then(() => {
          busy.set(false);
          return refresh();
        });
    };
    const resetTraining = (): Promise<void> =>
      ctx.stylus
        .resetTraining()
        .then(() => ctx.notice("the original classifier is back"))
        .catch((err) => say("reset", err))
        .then(() => refresh());
    const shareReplies = (): Promise<void> =>
      ctx.stylus
        .shareReplies()
        .then((sent) => ctx.notice(sent ? "the replies were shared" : "the replies were not shared"))
        .catch((err) => say("share", err));
    /** Asks first: the replies are the user's dataset. The layer keeps what it learnt until a reset. */
    const deleteReplies = (): Promise<void> => {
      const n = replies.get()?.replies ?? 0;
      return ctx.confirm(`delete the ${n} ${n === 1 ? "reply" : "replies"} kept on this tablet? The classifier keeps what it learnt until you reset it.`, "Stylus").then((yes) => {
        if (!yes) return;
        return ctx.stylus
          .deleteReplies()
          .then(() => ctx.notice("the replies were deleted"))
          .catch((err) => say("delete", err))
          .then(() => refresh());
      });
    };
    ctx.registerCommand(TRAIN_COMMAND, train);
    ctx.registerCommand(RESET_TRAINING_COMMAND, resetTraining);
    ctx.registerCommand(SHARE_REPLIES_COMMAND, shareReplies);
    ctx.registerCommand(DELETE_REPLIES_COMMAND, deleteReplies);
    // The ✎ item with the other plugins' buttons (the user, 2026-11-02; the status bar before), and the section in the plugins page.
    ctx.slots.add("header", { id: "mode", render: () => <ModeItem mode={mode} onToggle={toggle} /> });
    ctx.slots.add("pluginSettings", { id: "replies", render: () => <RepliesSection state={replies} busy={busy} onTrain={() => void train()} onReset={() => void resetTraining()} onShare={() => void shareReplies()} onDelete={() => void deleteReplies()} /> });
    void refresh();
    ctx.stylus.on((e) => (mode.get() === "cross" ? crossEvent(e) : penEvent(e)));
    ctx.subscriptions.add({
      dispose: () => {
        if (clock) clearTimeout(clock);
        if (fading) clearTimeout(fading);
      },
    });
    // On for as long as the plugin is: the host gives the pen back to the
    // page wherever there is no score (another view, a menu over it).
    void ctx.stylus.capture(true);
  },
});
