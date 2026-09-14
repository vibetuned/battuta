/**
 * The on-screen keyboard, as a plugin.
 *
 * A panel in the host's bottom area that projects the UNION keymap: one
 * button per action, sticky modifier latches that select a VARIANT action,
 * a digit pad, and a two-octave piano registered with the MIDI service as
 * a virtual input — so notes reach the entry path through exactly the same
 * door as a hardware controller.
 *
 * Imports `@battuta/api`, `react` and this package's own files, and
 * nothing else. It sends no command message: every button is
 * `ctx.actions.run(id)`, the host's own dispatch table entered at the same
 * point a key enters it, under the same state conditions. The panel
 * therefore cannot reach anything the host has not named — and nothing
 * here forges an input event, which
 * `apps/editor/test/host-boundaries.test.ts` fails the build over.
 */
import { useSyncExternalStore } from "react";
import { definePlugin, toDisposable, type ActivationEvent, type Disposable, type PluginContext, type Store } from "@battuta/api";
import { COMMAND_TOGGLE, PANEL_ID, SETTING_OPEN } from "./manifest";
import { KeyboardPanel } from "./Panel";

/**
 * React over a host store — six lines, so the panel subscribes IN PLACE.
 * The alternative (dispose the panel and re-open it with new props when a
 * store changes) remounts the component, and the user's octave rail would
 * reset every time entry mode toggles — which it does constantly, because
 * the piano dims outside input mode.
 */
function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(
    (onChange) => {
      const d = store.subscribe(onChange);
      return () => d.dispose();
    },
    () => store.get(),
    () => store.get(),
  );
}

/** A host-store-shaped holder for the one piece of state this plugin owns. */
interface Signal<T> extends Store<T> {
  set(value: T): void;
}

function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const listeners = new Set<(v: T) => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of [...listeners]) l(value);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return toDisposable(() => listeners.delete(listener));
    },
  };
}

/**
 * The 🎹 once the plugin is active. The manifest DECLARES this item so the
 * host can render it before any of this code exists; a runtime item with
 * the same id replaces that static face while the plugin lives, which is
 * what lets the button dim when the panel is down, as it did in 0.0.3. On
 * deactivate the declared face comes back.
 */
function ToggleButton({ open, onToggle }: { open: Store<boolean>; onToggle: () => void }) {
  const isOpen = useStore(open);
  return (
    <button data-vkeys-toggle title="on-screen keyboard — piano + every shortcut, for touch devices" onClick={onToggle} style={{ opacity: isOpen ? 1 : 0.45 }}>
      🎹
    </button>
  );
}

/**
 * Everything the panel DOES arrives as a prop from `activate` — running an
 * action, playing the piano, closing. What this component adds is the
 * subscriptions, and nothing else; which also means a test can read the
 * wiring straight off the element `render()` returns, without a DOM.
 */
interface SurfaceProps {
  ctx: PluginContext;
  onAction: (action: string) => void;
  onNoteOn: (midiNote: number) => void;
  onNoteOff: (midiNote: number) => void;
  onClose: () => void;
}

function Surface({ ctx, onAction, onNoteOn, onNoteOff, onClose }: SurfaceProps) {
  const keymap = useStore(ctx.keymap);
  const editor = useStore(ctx.editor);
  const ids = useStore(ctx.actions.ids);
  const doc = useStore(ctx.document);

  // `ids` carries the host's rules AND every enabled plugin's commands, so
  // a button can be hidden when the host positively does not know its id.
  // With no document open the App installs an EMPTY table — every action
  // would look unknown, and 0.0.3 showed its buttons anyway (they did
  // nothing, exactly as the keys did nothing). The document is the
  // question actually being asked: no document, no filtering.
  const known = new Set(ids);
  const runnable = (action: string) => action !== "" && (doc === null || known.has(action));

  return (
    <KeyboardPanel
      keymap={keymap}
      entryMode={editor.entryMode}
      runnable={runnable}
      onAction={onAction}
      onNoteOn={onNoteOn}
      onNoteOff={onNoteOff}
      onClose={onClose}
    />
  );
}

/** The one activation path that must NOT open the panel here — see below. */
const WOKEN_BY_THE_BUTTON: ActivationEvent = `onCommand:${COMMAND_TOGGLE}`;

export default definePlugin({
  activate(ctx: PluginContext) {
    // The piano is an input device as far as the host is concerned: the
    // entry path hears it exactly as it hears a controller, and nothing
    // asks whether "the keyboard plugin" is installed.
    const piano = ctx.subscriptions.add(ctx.midi.registerInput("on-screen piano"));

    const open = signal(false);
    let panel: Disposable | null = null;
    const mount = () => {
      if (panel) return;
      panel = ctx.panels.open({
        id: PANEL_ID,
        side: "bottom",
        title: "on-screen keyboard",
        render: () => (
          <Surface
            ctx={ctx}
            onAction={(action) => ctx.actions.run(action)}
            onNoteOn={(note) => piano.noteOn(note)}
            onNoteOff={(note) => piano.noteOff(note)}
            onClose={() => setOpen(false)}
          />
        ),
      });
      open.set(true);
    };
    /** The user's choice — the only one that persists. */
    const setOpen = (next: boolean) => {
      if (next) mount();
      else {
        panel?.dispose();
        panel = null;
        open.set(false);
      }
      ctx.settings.set(SETTING_OPEN, next);
    };

    // The 🎹 becomes live, so it dims while the panel is down.
    ctx.slots.add("header", { id: "toggle", render: () => <ToggleButton open={open} onToggle={() => setOpen(panel === null)} /> });

    // The wake-up table (BUILDING.md §7.2) in one line: open now unless the
    // click that woke us is about to toggle the panel itself — activation
    // runs BEFORE the handler it caused, so without `ctx.activatedBy` this
    // would open and immediately close.
    //
    //   onPointer:coarse    a touch device           → open unless closed before
    //   onSettings:open     left up when we quit     → open (the setting IS the event)
    //   onCommand:<toggle>  the 🎹                   → leave it to the handler
    //   null                the Plugins tab, a test  → open unless closed before
    if (ctx.activatedBy !== WOKEN_BY_THE_BUTTON && ctx.settings.get<boolean>(SETTING_OPEN) !== false) mount();

    ctx.registerCommand(COMMAND_TOGGLE, () => setOpen(panel === null));
  },
});
