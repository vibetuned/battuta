# Building the screencast keys plugin

A plugin that only shows: the keys pressed and the notes played, for
video demos. Written for the next author, a person or an agent, who has
this file, `packages/plugins/README.md` and nothing else.

## 1. Origin

Asked for by the user on 2026-10-29: "a plugin mainly for the desktop,
disabled by default, a screencast keys like the Blender add-on — this will
allow us to make some video demos and screenshots; include MIDI keys". The
user's answers, each taken as asked:

| Question | Decision |
| --- | --- |
| What may the API gain? | `ctx.keys`, a `float` panel side, and the manifest's `enabledByDefault` — and nothing else (`@battuta/api` 1.3.4). |
| The main bundle was at its ceiling | **Raise it** to 392 kB, recorded in CHANGELOG.md. |
| What does a key show? | **The keys and the action they ran**, like Blender's add-on. |
| The on-screen keyboard's buttons too? | **No**: physical keys and MIDI notes. |

## 2. Manifest

```
id                battuta.screencast-keys
engines.battuta   ^1.3.4
capabilities      midi
activation        onStartup
enabledByDefault  false
contributes       nothing
```

Off until the user turns it on in the Plugins tab; turning it on runs
`onStartup` at once, so it shows without a restart. No command, key or
slot item: it is switched in the Plugins tab and only shows.

## 3. API surface

Added for this plugin in 1.3.4:

- **`ctx.keys.on(listener)`** — every key the editor's own key handler
  takes, as data: `key`, `code`, the four modifiers and the `action` it
  ran (a rule's id or a plugin's command; null when it ran none). Keys
  typed into a field never reach that handler, so never reach a plugin.
- **`PanelSide` `"float"`** — the host draws the panel over the window's
  bottom-left corner, above the bottom area and beside a side panel, with
  no frame and no pointer events.
- **`enabledByDefault: false`** in the manifest — the host starts the
  plugin off until the user turns it on.

Used as they were: `ctx.midi.onNote` (capability `midi`: every input,
virtual ones such as the on-screen piano included), `ctx.keymap` (the
action's label), `ctx.panels`.

## 4. State

One signal, the feed (`feed.ts`): the last six entries, each a key press
or a chord of notes, with a repeat count and when it last changed; and a
timer that expires and fades them while any shows, cleared when none is
left and when the plugin deactivates. Nothing persisted.

## 5. Command messages

None: it never writes to the document.

## 6. Tests

- `test/feed.test.ts` — the keys of a press (modifiers first, Shift named
  for letters and named keys, a modifier alone skipped), note names, a
  repeat counted, a chord folded, the last six kept, the fade and the
  expiry.
- `test/screencast-keys.test.ts` — the plugin against a fake context: off
  by default, the feed in the float area, an action named from the keymap,
  notes on (not off) shown and faded, the timer cleared on deactivate.
- The host's half is the editor's: `ctx.keys`, the float area and
  `enabledByDefault` in `apps/editor/test/host.test.ts`, the action a
  press ran in `apps/editor/test/actions.test.ts`.

## 7. Dead ends

- **Listening to the page's keys from the plugin** — a plugin may not
  touch `window`, and the page's key events would not say which action a
  press ran. The host's key handler knows both, so `ctx.keys` comes from
  there.
- **The platform's own modifier names** (⌘ ⌥ on a Mac) — a plugin cannot
  ask which platform it is on without `navigator`; the names are spelled
  out (`Ctrl`, `Alt`, `Shift`, `Cmd`).

## 8. Recipe

To show something more — mouse buttons, the on-screen keyboard's buttons —
the plugin needs an event stream the host does not hand out yet: an API
change for the user to approve first, then an entry kind in `feed.ts` and
its look in `Screencast.tsx`.
