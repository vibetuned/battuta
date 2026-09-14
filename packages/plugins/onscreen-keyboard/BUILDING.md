# Building the on-screen keyboard

The second battuta plugin, and the first with UI. Written for the next
author — a person or an agent — who has this file,
`packages/plugins/README.md`, and nothing else. Read
`packages/plugins/reflection/BUILDING.md` first if you have not: it is the
worked example for the plugin *shape*; this one is about slots, panels, and
what happens when a feature's old mechanism is not allowed any more.

> **The slice stopped here once.** Everything was built and 23 of the 24
> checks in `spikes/verify-onscreen-keyboard.mjs` passed; the 24th could
> not, because the panel could see another plugin's binding in the union
> keymap and had no way to run it. Per the brief's *Stop when* the gap was
> written up rather than resolved — and the three gaps it named (§7.1,
> §7.2, §7.3) were then decided and built in-house the same day, as
> `@battuta/api` 0.1.3. What you are reading is the plugin **after**
> consuming them: 24 of 24, and the three sections say what was missing,
> what the host grew, and what the plugin does with it. That round trip is
> the point of those sections; do not read them as a list of defects.
>
> A first attempt at this slice on 2026-09-14 was rolled back for inventing
> an api instead of reporting a gap; its post-mortem is
> `POSTMORTEM-2026-09-14.md` in this directory, and every trap in its §7.5
> is real — all of them were met again here (§7.5–§7.9).

## 1. Origin

An extraction. The panel shipped in 0.0.2 inside the editor: a component
mounted by `App.tsx`, a key model beside it, and a `vkeys` boolean in the
editor's settings.

| What | Where it was | Where it is |
| --- | --- | --- |
| the panel component (198 lines) | `apps/editor/src/VirtualKeyboard.tsx` | `src/Panel.tsx` (+ `src/index.tsx`, the subscribing wrapper) |
| the key model (268 lines) | `apps/editor/src/virtualKeys.ts` | `src/keys.ts`, rewritten around action ids |
| its coverage suite (251 lines) | `apps/editor/test/virtualKeys.test.ts` | `test/keys.test.ts`, over the UNION keymap |
| the `vkOpen` state + `toggleVk` | `App.tsx` `useState` + `saveSettings` | the plugin's `open` setting, migrated once by `settings.ts` |
| the 🎹 header button | hard-coded in `App.tsx`'s header row | `contributes.slotItems` in `src/manifest.ts`, replaced by a live `ctx.slots.add` item once active |
| the coarse-pointer default | `matchMedia("(pointer: coarse)")` in `App.tsx` | the host's `onPointer:coarse` activation event |
| the "on-screen piano" virtual MIDI input | `App.tsx` `useEffect` (put there by slice 3) | `src/index.tsx`, unchanged in substance |
| `window.dispatchEvent(new KeyboardEvent(…))` | inside the panel | **gone** — `ctx.actions.run(id)` (§3) |

**`App.tsx`: 3,248 → 3,227 lines (−21)**, and 717 lines left
`apps/editor/` altogether. As in slice 2, the line count understates the
move and overstates the win at the same time: the panel was already its own
file, so `App.tsx` lost only the mount, the state, the toggle, the button
and the piano registration. The honest measure is the bundle: the initial
chunk is **601.4 → 591.9 kB** (ceiling 605.5) and the panel is a **10.6 kB
lazy chunk** that a desktop user who never touches 🎹 does not download.

The plugin is 822 lines of source across four files, of which roughly 480
are code; 521 lines of tests. It is bigger than the code it replaced
because `keys.ts` now declares what each button *does* (an action id per
latch) where the old file declared what each button *pressed*.

## 2. Manifest

```
id                battuta.onscreen-keyboard
engines.battuta   ^0.1.3
capabilities      midi
activationEvents  onPointer:coarse, onSettings:open,
                  onCommand:battuta.onscreen-keyboard.toggle
contributes       1 command, 1 slot item, 0 keybindings
```

- **`onPointer:coarse`** — the touch-device default, moved from
  `matchMedia` in `App.tsx` to the host, which fires this at startup. It is
  the whole of the plugin's device knowledge: a plugin never asks about
  pointers, and a fine-pointer user never loads this code.
- **`onCommand:…show`** — the 🎹. The registry fires `onCommand:`
  implicitly when a declared slot item is clicked, so declaring it changes
  nothing mechanically; it is here because the click *is* a wake-up path
  and the manifest is where wake-up paths are listed.
- **`onSettings:open`** — "you were in use when I last quit". The host
  fires it at startup for a plugin whose own setting under that key is
  truthy, which is how a panel left up comes back on a desktop without
  `onStartup` costing every user the code at launch (§7.3).
- **One command**, `…toggle` — the 0.0.3 gesture. It is safe to toggle
  because `ctx.activatedBy` says whether this very click is what woke the
  plugin, so `activate` knows not to open a panel the handler is about to
  close (§7.2).
- **One slot item**, `{ slot: "header", label: "🎹", command }` — the entry
  point, decided in-house on 2026-09-14. `label` and `title` are copied
  verbatim from the hard-coded button, so the header reads as it did. Once
  the plugin is active it adds a RUNTIME item under the same id, which
  replaces the declared face — that is what lets the 🎹 dim while the panel
  is down, as it did in 0.0.3.
- **`capabilities: ["midi"]`** — the piano is a virtual input. A capability
  the host does not offer is a registration failure, so asking for it is
  also a statement that this plugin is useless without it.

Deliberately NOT declared:

- **No keybindings.** An extraction is behaviour-neutral, and a new key is
  a new behaviour; the union keymap snapshot must stay byte-identical, and
  it does. (The rolled-back attempt added `alt+k` here without hesitating,
  because it was small.)
- **No `onStartup`.** It would cost every user this code at launch to save
  one dynamic import on the first 🎹 — and it is exactly what §7.3's gap
  would tempt you into. Don't.
- **No `docHeader`, `statusBar` or `menu` items**, no storage namespace,
  no command message.

## 3. API surface

| Phase | Call | Why |
| --- | --- | --- |
| read | `ctx.keymap` (`Store<KeymapEntry[]>`) | the union keymap: every generated button, its caption, its group |
| read | `ctx.editor` | `entryMode` — the piano dims outside note input |
| read | `ctx.document` | is a document open at all? — what decides whether an empty id list means "nothing works" or "not up yet" (§7.4) |
| read | `ctx.actions.ids` (`Store`) | which actions exist right now, so a button that cannot act is not rendered; republished when a document opens and when a plugin is turned on or off |
| read | `ctx.activatedBy` | which path woke us — the one thing `activate` needs that no store can tell it (§7.2) |
| read | `ctx.settings.get("open")` | was the panel up last time? |
| write | `ctx.actions.run(id)` | **every button**. The only thing this plugin does to the editor |
| write | `ctx.settings.set("open", …)` | the user's choice, on 🎹 and × |
| lifecycle | `ctx.registerCommand(id, handler)` | the declared command behind the 🎹 |
| lifecycle | `ctx.panels.open({ side: "bottom" })` | the panel |
| lifecycle | `ctx.slots.add("header", { id: "toggle", render })` | the live 🎹, replacing the declared face while active |
| lifecycle | `ctx.midi.registerInput("on-screen piano")` | the piano, as a device |
| lifecycle | `ctx.subscriptions.add(…)` | the virtual input (the host tracks what it hands out itself) |

Types named from `@battuta/api`: `KeymapEntry`, `PluginContext`, `Store`,
`Disposable`, `MidiNoteEvent` and `PluginEntry` (tests). Values: only
`definePlugin`. Plus `react` — `useState` and `useSyncExternalStore`.

**What the API had to grow for this plugin: four things, none of them
built here.** The plugin was finished against **0.1.2** with three gaps
written up and unresolved (§7.1–§7.3); the user then decided and built all
three in-house as **0.1.3**, and this plugin consumes them:

| Addition | Consumer here | Replaces |
| --- | --- | --- |
| `run(id)` reaches an enabled plugin's command, past the same gates | the shift latch on `rest` → the reflection cycle | withholding the caption (§7.1) |
| `ctx.actions.ids` becomes a `Store` | the panel re-renders when a document opens or a plugin is switched | a `ctx.document` subscription used only as a notification (§7.4) |
| `ctx.activatedBy` | `activate` opens the panel unless the 🎹 click that woke us is about to | a `show`-only command (§7.2) |
| `onSettings:<key>` | the panel comes back at startup | nothing — the behaviour simply did not exist (§7.3) |
| a runtime slot item overriding a declared one | the 🎹 dims while the panel is down | a static face (§7.2) |

The lesson worth carrying is the sequence, not the list: **the plugin
stopped, named the gaps, and the api grew where the user decided it
should.** The first attempt at this slice invented fourteen exports and a
host service for the same feature and was rolled back.

**What it deliberately did NOT grow**, each with its consumer named:

- **A layout accessor.** The old `eventForSpec` needed the keyboard layout
  to work out what a shifted `,` produces on AZERTY. Nothing synthesizes
  characters any more, so the panel does not know or care which layout is
  active — `ctx.keymap` is already built for it. An api addition
  disappeared because the mechanism did.
- **A `ctx.slots` update call.** The live 🎹 re-renders from a four-line
  signal inside the plugin, not from a host mechanism for mutating a slot
  item: `ctx.slots.add` already replaces an item of the same id, and the
  host's `<Slot>` re-renders when a plugin's own store changes because the
  item renders a component. Nothing to add.
- **Anything for §7.1–§7.3 at the time.** Each was written up as a gap with
  the shape of the decision it needed, and none was resolved in the slice.
  The user then built all three; that order is the whole point.

## 4. State

**Transient (memory).** Inside the panel component: the latched modifiers,
the set of held notes, and the octave rail's position. Losing them costs
the user a tap; keeping them across re-renders is the reason the panel
subscribes in place rather than being re-opened (§7.6). Inside
`activate`'s closure: the panel's `Disposable`, the virtual MIDI handle,
and one four-line `signal(false)` — is the panel up? — which exists so the
live 🎹 can dim without the plugin owning any host state.

**Persisted (settings namespace).** One boolean, `open`. Written only by
the user's own 🎹 and ×, never by the automatic touch-device open — which
matches 0.0.3, where the `matchMedia` default was not persisted either.

**Persisted (storage namespace).** Nothing. A test asserts the storage key
is never created.

**Document.** None. The plugin sends no command message at all (§5), so
turning it off cannot change a byte of any score.

**Nothing mutates the document outside `ctx.execute`** — and this plugin
does not even call `ctx.execute`. How I know structurally rather than by
inspection: it imports `@battuta/api`, `react` and its own four modules,
there is no door to core, and `apps/editor/test/plugin-boundaries.test.ts`
fails the build if one appears. Its edits happen because
`ctx.actions.run(id)` runs the App's own rule, which runs the App's own
core command — the same code the physical key runs.

## 5. Command messages

**None.** This plugin sends no `ctx.execute` message. Every button is
`ctx.actions.run(id)`, and every note is a MIDI event into the host's entry
path.

That sentence was also true of the rolled-back attempt, which used it to
argue that `press()` "is an input capability, not a second mutation path".
The argument was wrong then and the difference is worth stating, because it
is the whole point of slice 4a:

- `press({key: "s", ctrlKey: true})` publishes *everything the App's
  keydown handler can do*, as an opaque blob. Nothing can audit it; a
  worker-hosted or third-party plugin saving a file is indistinguishable
  from one entering a note.
- `run("file.save")` publishes a **finite, inspectable list of named
  actions** (`ctx.actions.ids` — 110 of them today, core rules plus every
  enabled plugin's commands), each entered under the same state conditions
  as the key: a gate stops it where it stops the key, an active modal stops
  it entirely. Adding plugin commands to that list in 0.1.3 did not widen
  the door; it kept the list honest about what a key already reached.

So "it sends no message" is only reassuring because of *what it does
instead*. If your plugin's buttons cannot be expressed as ids, that is a
finding about the host, not a licence to build a lower-level door.

## 6. Tests

| Suite | Pins | Run |
| --- | --- | --- |
| `test/keys.test.ts` (27) | coverage of the **union** keymap in both layouts; panel ids exist; every button names an action; the digit pad's four meanings; every `MOD_VARIANTS` row resolves through its base and has no button of its own; the arrows' selection/transpose/duration variants; live relabelling; **another plugin's binding captioned and run when it is on, both withdrawn when it is off** | `npx vitest run --root packages/plugins/onscreen-keyboard` |
| `test/panel.test.ts` (20) | the 🎹 exists before any code loads and goes live once active; no keybinding contributed; **every row of §7.2's wake-up table**, including the click that woke us opening exactly once; toggle and ×; the piano as a virtual input, notes reaching `onNote`; off/on; a disabled plugin never loads; no command message; no storage written | same |
| `apps/editor/test/settings.test.ts` (6, new) | the one-time `vkeys` → plugin-namespace move: idempotent, pure, and the plugin's own value wins | `npm test -w @battuta/editor` |
| `apps/editor/test/keymap-snapshot.test.ts` | the union keymap is byte-identical — this extraction added no binding | same |
| `apps/editor/test/plugin-boundaries.test.ts` | this package obeys every hard rule, including "no DOM globals" in a package that renders UI | same |
| `apps/editor/test/host-boundaries.test.ts` | nothing here forges an input event, and the host gained no module | same |
| `packages/api/test/api-surface.test.ts` (17) | the api surface is unchanged at 0.1.2 | `npx vitest run --root packages/api` |

The panel is **not rendered** in any suite: a plugin package may not depend
on `react-dom`, and the host owns the React root. What a unit test can do
is call the panel spec's `render()` and read the returned element's props —
which is why `src/index.tsx` takes `onAction`, `onNoteOn`, `onNoteOff` and
`onClose` as props of `Surface` rather than closing over them inside it
(§7.7). That makes the wiring testable without a DOM; the pixels are the
browser script's job.

**e2e gates.**
`BATTUTA_ROOT=$PWD CHROME=bundled SCRATCH=/tmp/battuta-e2e node spikes/verify-onscreen-keyboard.mjs`
— 24 checks driving the panel entirely by tapping, written before the
extraction (by the rolled-back attempt, kept deliberately). Exactly **two
hooks changed**, both the ones the brief allows: `TOGGLE` names the button
in its two faces (the host's declared one before the code loads, the
plugin's live one after), and `savedOpen` reads the plugin's settings
namespace. **Every assertion is byte-identical and all 24 pass.** The five
regression scripts (`verify-app`, `phase2`…`phase5`) and the suites above
are unchanged.

`npm run build -w @battuta/editor && npm run budget -w @battuta/editor` is
the other real gate — run it *before* you believe you are finished (§7.5).

`sh spikes/verify-tauri.sh` is green here, **6/6** — worth saying because
slice 2's BUILDING.md §7.9 recorded it as unrunnable on macOS (it wanted
GNU `timeout`). It runs now; nothing in this slice touches Rust, but the
shell build does embed the plugin chunk, so it is a real check that the
lazy import resolves under `tauri://`.

**What is not covered, and how I checked it by hand.** No committed test
can compare the panel's action ids with the ids the App actually installs:
the table is built inside an `App.tsx` effect, so in a unit test
`ctx.actions.ids` carries only the plugins' commands (§7.4). I ran the
comparison in a browser with a throwaway script, before and after the api
grew:

```
before (0.1.2)  host 108 · panel 91 · unknown to the host: battuta.reflection.cycle
after  (0.1.3)  host 110 · panel 91 · unknown to the host: NONE
                host ids no button reaches: entry.toggle, pitch.a–g,
                chord.a–g, dynamic.f, dynamic.p, edit.backspace,
                battuta.onscreen-keyboard.toggle
```

Every id in the last list is deliberate and was unreachable from the 0.0.3
panel too: the pitches and chords are what the piano is for
(`PIANO_COVERS`), `Insert`, `alt+f`/`alt+p` and `Backspace` never had
buttons, and the plugin's own command is the 🎹 rather than a panel
button. So the panel's reach is unchanged by the extraction, in both
directions. **A committed home for this check is the obvious next
improvement** and I did not invent one: it wants either a browser
assertion (the script's assertions are frozen for this slice) or a
host-side test that renders the App, and both are the user's call.

## 7. Dead ends

What was tried and dropped, and what the slice stopped on. The first
attempt's post-mortem §7 is the longer list and all of it still applies;
this section records what happened on the rebuild.

**§7.1–§7.3 are the three gaps the slice stopped on.** Each is written as
it was found — the feature that could not be built, the answers available,
and the one that was chosen — and then what the api grew and what this
plugin does with it. They are kept in that shape on purpose: the next
author's problem will not be these three, it will be recognising the
*situation*, which is "the mechanism I want is not published, and inventing
it is a rollback".

### 7.1 A plugin's binding: visible in the keymap, unrunnable by the panel

The panel is a projection of the **union** keymap, which includes every
enabled plugin's bindings — that is the point of the union, and slice 2
left a worked example in it: the reflection cycle is the shift latch on the
`rest` key (`MOD_VARIANTS["battuta.reflection.cycle"]`), and
`spikes/verify-onscreen-keyboard.mjs` check 13 asserts that latching shift
relabels that button to "reflect".

`ctx.actions.run("battuta.reflection.cycle")` returned **false**. Slice 4a
had decided that deliberately and written it down in three places: the
comment at `apps/editor/src/App.tsx` where the table is installed ("never
for `run(id)`: plugin commands run through the registry"), an assertion in
`apps/editor/test/actions.test.ts`, and the 0.1.0 CHANGELOG bullet.
Confirmed in the browser: of the 91 action ids this panel names, exactly
one was missing from the host's 108.

So the panel could caption a button it could not press. Three answers, and
**only the third was available to a plugin slice**:

1. **Caption it and let the tap do nothing.** This is what the 2026-09-12
   post-mortem calls out by name — a caption for a key that does nothing —
   and `virtualKeys.ts` already carried a guard against exactly it. Every
   gate would have been green and the panel would have lied. Rejected.
2. **Make `run(id)` fall through to the registry for plugin commands.** A
   short change in `apps/editor/src/host/actions.ts` — but a host change
   that widens a published contract during a plugin slice, and the brief's
   *API may grow* said **None**. It was also not obviously right: `run`
   guarantees "the same code the key would run, under the same
   conditions", and a plugin's binding runs *after* the whole table, only
   when no core rule took the key. Someone had to decide whether `run`
   means "this action" or "this key's outcome". **Not mine to decide.**
3. **Show no caption for a variant the host cannot run** — the rule
   `keys.ts` still applies (`reachable()`: the row must be in the live
   keymap *and* the action in `ctx.actions.ids`). The panel stayed honest,
   the feature was missing, and check 13 failed. Chosen, and the slice was
   reported open on it.

**What the user decided (api 0.1.3):** `run(id)` means *this action*. An
id no core rule has goes to the plugins' commands through the registry,
**after the same gates and modals**, so a plugin's action is reachable by
id exactly when its key would have been. It also made the api's own doc
comment true — `packages/api/src/actions.ts` had claimed rebindable ids
include "every plugin command" since 4a closed, which contradicted the
host, and nothing caught it because prose is not executable. *The first
consumer of a contract is what tests it.*

**What the plugin does now:** nothing it did not already. The
`MOD_VARIANTS` entry never moved, `reachable()` never changed, and the
caption and the tap came back together — which is exactly what option 3
was chosen for. The tests pin both directions: with the reflection plugin
on, the shifted rest key says "reflect" and runs it; with it off, its
binding leaves the keymap *and* its command leaves `ctx.actions.ids`, and
both halves of `reachable()` withdraw the caption.

### 7.2 Activation cannot tell why it was woken

The post-mortem's trap: *activation runs BEFORE the command handler that
caused it*, so a plugin that opens its UI in `activate()` and toggles it in
the handler opens and then immediately closes. It cost the first attempt a
bug that only appeared after "open → disable → re-enable → tap".

The wake-up table:

| Path | `activate` runs | the command runs | what must happen |
| --- | --- | --- | --- |
| coarse pointer at startup, nothing saved | yes | no | open |
| coarse pointer at startup, saved closed | yes | no | stay closed |
| left open, any pointer, at startup | yes | no | open |
| 🎹 on a fine pointer, first time | yes | yes, after | open (once) |
| 🎹 while already active | no | yes | toggle |
| off → on → 🎹 | yes | yes, after | open |

Rows 1 and 4 are indistinguishable from inside `activate` without being
told which event fired. Two workarounds were tried and dropped:

- **A deferred default** — `activate` schedules the automatic open in a
  `setTimeout(0)`, which the command handler cancels because it runs first
  (the registry `await`s activation, so every microtask flushes before any
  timer). It works, and I wrote it, and then deleted it: it is a race
  dressed as a design, it needs `setTimeout` typing a plugin does not
  otherwise have, and the next person to read it would have to re-derive
  the microtask argument to know it is safe.
- **`activate` opening only on an explicit `open === true`** — which
  silently drops the touch-device default, the one behaviour the
  `onPointer:coarse` event exists for.

What shipped at the stop was a **`show` command instead of a toggle**:
every row of the table wants the panel open, so `activate` opened it and
the command opened it, and the two agreed whichever order they ran in. The
× hid it. That cost a real behaviour — in 0.0.3 a second tap on 🎹 hid the
panel — and it was compounded by a second limit: a manifest-declared slot
item is static, so the 🎹 could no longer dim when the panel was closed
(0.0.3 styled it `opacity: vkOpen ? 1 : 0.45`). The gap was written up as
two questions: **may a plugin be told why it was activated**, and **may it
replace its own declared slot item with a live one**.

**What the user decided (api 0.1.3):** both. `ctx.activatedBy` names the
event (`onStartup`, `onPointer:coarse`, `onCommand:<id>`,
`onSettings:<key>`, or null when started directly), and a runtime
`ctx.slots.add` item with the same id as a declared one replaces its face
while it lives, the declared face returning on deactivate.

**What the plugin does now:** the command is `…toggle` again, and the whole
table is one line — *open now unless the click that woke us is about to* —

```ts
if (ctx.activatedBy !== `onCommand:${COMMAND_TOGGLE}` && ctx.settings.get(SETTING_OPEN) !== false) mount();
```

and the 🎹 is a live item over a four-line signal, dimming while the panel
is down exactly as it did in 0.0.3. `test/panel.test.ts` walks every row.

### 7.3 A panel left open did not come back on a desktop

`onPointer:coarse` fires at startup on touch devices only. A mouse user who
opened the panel, quit and came back got no panel until they tapped 🎹 —
because nothing activates a plugin at startup to read its own setting, and
`onStartup` is precisely the thing the phase's lever is built to avoid.

In 0.0.3 the state was the App's, so it was restored for free. This was the
first place where "a plugin's code is not loaded until something it
declared happens" had a visible cost, and it was worth stating plainly
rather than hiding: **the activation-event vocabulary had no way to say
"wake me if my own setting says so".**

**What the user decided (api 0.1.3):** `onSettings:<key>` — the host fires
it at startup, after `onStartup` and `onPointer:coarse`, for each plugin
whose OWN settings namespace holds a truthy value under that key. It is the
narrowest possible answer: it wakes only a user who left the feature in
use, and it is the plugin's own data that decides.

**What the plugin does now:** declares `onSettings:open` beside the key it
already persisted. A panel left up comes back on any pointer; a closed one
still loads nothing at all, which a test counts rather than infers.

### 7.4 `ctx.actions.ids` and the "empty means unknown" trap

The panel hides a button whose action the host does not know (§7.1's rule,
and a guard against a typo'd id). Two things make that harder than it
sounds, and the second survived the api change.

**It was not reactive.** `ids()` was a snapshot with no store behind it,
while the App installs its table from a `useEffect` — which has not run
when the plugin activates at startup. The workaround was to subscribe to
`ctx.document` purely for the notification. `ctx.actions.ids` is now a
`Store`, republished when a document installs a table and when a plugin is
switched on or off, so the subscription is honest and the workaround is
gone.

**An empty list is not evidence of nothing.** With no document open the App
installs an EMPTY table, and 0.0.3's panel showed its buttons in that state
anyway — they did nothing, exactly as the keys did nothing. A panel that
blanked itself when you closed the last tab would be a behaviour change, so
the filter asks the question it actually means:

```ts
const runnable = (action) => action !== "" && (doc === null || known.has(action));
```

Note what changed with 0.1.3 and made this *more* necessary: `ids` now
carries plugin commands too, so before the App installs its table the list
is non-empty but contains only commands — "the host knows two ids, neither
of them yours" would have hidden nearly every button for a frame. **A
guard keyed on the real condition survives a change to the data; a guard
keyed on `length === 0` would not have.**


### 7.5 Rollup and React — the same trap as core in slice 2, exactly as predicted

`npm run budget` failed on the first build of the rolled-back attempt
because **React** had been placed inside `plugin-onscreen-keyboard`: react
is imported by the host *and* by the plugin, `manualChunks` had no opinion,
so Rollup settled it in the first chunk that imported it and the host then
had to import that chunk statically — which the budget check reports as
"plugin code reached from the initial chunk". The post-mortem said to
re-apply the fix when the first React-rendering plugin lands. It is applied
here: `react`, `react-dom` and `scheduler` are named into `battuta-shared`
in `vite.config.ts`, three lines below the same fix for core.

Because it was applied *first*, the build was green the first time, which
is not evidence the trap is gone — it is evidence the note was read. The
diagnostic, if you hit it: ask Rollup what is in the chunk (a
`generateBundle` hook printing `Object.keys(chunk.modules)`); do not grep
the output for React marker strings, which are development-only. What I did
here was cheaper still and worth copying: read `dist/.vite/manifest.json`
and check `imports` on the plugin chunk — it should import
`battuta-shared`, and the entry must not import the plugin chunk.

**Anything the host and a plugin share must be named.** The list is now
core, the api, every plugin manifest, and React.

### 7.6 A panel with internal state subscribes; it is never re-opened

Kept from the first attempt because it is right and because the e2e checks
it (check 19: "the octave rail kept its place across those re-renders").
The panel holds the latches, the held notes and the octave rail, so
refreshing it by disposing the panel and re-opening it with new props
**remounts** the component and resets the user's octave mid-phrase — and
entry mode toggles constantly, because the piano dims outside it. The fix
is six lines of `useSyncExternalStore` over the host's stores, inside the
panel's own wrapper. A plugin cannot import the host's `useStore`, and
should not want to: the store contract (`get` + `subscribe` → `Disposable`)
is the api's, and the binding is trivial.

### 7.7 Testing a panel with no DOM: props, not pixels

The first draft of `test/panel.test.ts` tried to drive the piano through
the element `render()` returns, and found only `ctx` and `onClose` on it —
because everything else was built *inside* `Surface`, where only a renderer
can reach it. A plugin may not depend on `react-dom`, so there is no
renderer.

The fix is a better shape rather than a shim: `activate` passes `onAction`,
`onNoteOn`, `onNoteOff` and `onClose` down as props, and `Surface` adds
only the subscriptions. Now the suite reads the wiring straight off the
element — a tapped piano key really does reach the virtual MIDI input, and
a tapped button really does reach `ctx.actions.run` and never `ctx.execute`
— and the component got simpler. **When a UI plugin is hard to test, look
for the state that leaked into the component before reaching for a
renderer.**

### 7.8 Two behaviours that were emergent, and are now declared

Rewriting the panel from "press this key" to "run this action" changed two
things nobody designed, both of which were consequences of key matching:

- **The ctrl latch is gone.** With ctrl latched, tapping *any* letter
  button used to synthesize `ctrl+<letter>`, which the App's ctrl rules
  then matched — so ctrl + the sharp button saved the file. Every ctrl
  chord the editor has already had its own button in the *system* group, so
  the latch's only remaining power was reaching chords nobody meant to
  press. Removing it is the blast-radius reduction slice 4a was for. (Its
  one legitimate use, `ctrl+shift+s`, is a declared variant of the save
  button.)
- **A latch with no variant now does nothing, visibly.** It did nothing
  before too — a shifted `v` is `V`, which misses the `flat` binding — but
  it looked like an ordinary button. Such buttons now dim while the latch
  is on. The exception is shift on ↑/↓, which used to fall through to plain
  navigation because the rule ignores shift; it is now inert.

Both are behaviour changes in a slice whose contract is behaviour
neutrality, and both are *reductions* that the id model makes unavoidable.
They are here rather than in a footnote because that is the kind of thing a
reviewer should get to reject.

**And removing the ctrl latch broke the layout, which nothing caught.**
The panel's height was never declared: the tallest child was the modifier
column — three 34px buttons and two gaps, 110px — and the piano and the
shortcut groups stretched to it. Two buttons make 72, so the row fell to
whatever the groups happen to be (98px): visibly shorter, and no longer
roomy enough for the horizontal scrollbar the groups scroll on, which ate
into their box until the panel showed a vertical scrollbar of its own.
Headless Chromium draws OVERLAY scrollbars, which take no space, so all 24
e2e checks and every screenshot in CI were clean while the real app was
wrong. `ROW_HEIGHT = 110` is now declared in `Panel.tsx` with the number's
provenance, and the groups scroller is `overflowY: "hidden"` so a
horizontal scroller can never sprout a vertical one. **A dimension that is
an accident of some other element's contents will break the day that
element changes, and a browser that does not draw scrollbars will not tell
you.**

### 7.9 Small things that cost time

- **`position: fixed` had to go.** The bar positioned itself along the
  bottom, which was right when `App.tsx` mounted it and wrong the moment
  the host's panel area — itself fixed, with its own z-index and a
  `max-height` — became its parent. Also needed: a `min-height` on the
  piano, which used to get its height from the fixed bar (and which is now
  `ROW_HEIGHT`, §7.8).
- **A declared entry point cannot show state, and looked wrong for it.**
  The 🎹 drawn from the manifest rendered at full strength while the plugin
  had never run — so on a desktop the button looked lit with no panel
  under it. The plugin cannot help: its live face only exists once it is
  active. The manifest now says so — `dimUntilActive: true` (api 0.1.4) —
  and the host draws that face de-emphasised until the plugin runs. The
  first cut made it a rule for EVERY declared face, which is wrong for an
  item that merely runs a command: a greyed menu entry reads as disabled,
  not as "not loaded yet". **A visual default that is right for the
  consumer in front of you is not the same as a rule; if you cannot state
  it for the next consumer too, it belongs on the item.**
- **`i` enters input mode; `Insert` toggles it.** Still true, still worth a
  line: `App.tsx` has `if (!entryMode && hit("inputMode"))`, so tapping the
  "input" button inside input mode does nothing, and `run("inputMode")`
  returns false for the same reason. That is correct — `run(id)` answers
  exactly what the key would have done.
- **The digit pad's finger-change rule ignores shift**, so `alt+shift+6` is
  a finger change and not "add finger 1". Reproduced rather than tidied: an
  extraction copies the wart.
- **`git rm` stages.** Trivial, but this repo is reviewed through the
  working-tree diff, so the deletions were unstaged again immediately.
- **A test written against a `show` command quietly passed for the wrong
  reason.** "Opens once, under a stable id" called the command twice, which
  was idempotent then and is a toggle now; it failed the moment the
  semantics came back, which is the test doing its job. When a command's
  meaning changes, re-read the tests that call it twice.

## 8. Recipe

The shortest path to a plugin like this one — UI in a panel, an entry point
in a slot, no document edits. Read `packages/plugins/README.md` alongside;
steps 1–8 of the reflection plugin's recipe still apply for the package
shape.

1. **Write the feature's needs as HOST CAPABILITIES before reading its
   code.** "The panel must let the user run any editing action, enter
   pitches, and be put away" — not "the panel dispatches KeyboardEvents".
   This is the one step that decides whether the slice goes well; the first
   attempt at this plugin skipped it and spent a week building a door.
2. **Copy the package** from `packages/plugins/reflection`, then add what a
   UI plugin needs: `"react": "^18.3.0"` and `"@types/react"` in
   `package.json`, `"jsx": "react-jsx"` in `tsconfig.json`. Still no vitest
   config. `react-dom` is forbidden — the host owns the root.
3. **Name React into `battuta-shared`** in `apps/editor/vite.config.ts`
   *before* your first build (§7.5), or the budget check will fail in a way
   that looks like your fault.
4. **Declare the entry point in the manifest**, not in `activate`:
   `contributes.slotItems: [{ id, slot, label, command }]`. A button that
   opens your panel cannot come from your panel's code.
5. **Write the wake-up table** (§7.2) before writing `activate`, then read
   `ctx.activatedBy` to tell the rows apart — the one case it exists for is
   "the click that woke me is about to run my toggle". If your UI should
   come back after a restart, declare `onSettings:<key>` on the setting you
   already persist rather than `onStartup`.
6. **Split the panel in two**: a wrapper that subscribes to the host's
   stores (`useSyncExternalStore`, six lines) and takes every callback as a
   prop, and a component that renders. You get live updates without
   remounts (§7.6) and a testable seam without a DOM (§7.7).
7. **Run actions by id.** `ctx.actions.run(id)`; check `ctx.actions.ids`
   before rendering a button, and key the "I do not know yet" case on the
   real condition rather than on an empty list (§7.4). If something your
   surface needs is not an id, **stop and write it down** — that is a
   missing host abstraction. The history of this package is both halves of
   that: the first attempt treated it as a plugin requirement and was
   rolled back; the second stopped with three gaps named, and the api grew
   where the user decided it should. Stopping cost a day and closed the
   slice properly.
8. **Move the old setting** with a dated line in `apps/editor/src/settings.ts`
   (a plugin cannot: it sees only its own namespace), and test it there.
9. **`npm run build && npm run budget`, then the e2e scripts one at a
   time.** Then the two documents, the CHANGELOG bullet, the DESIGN.md
   sentence, the PLANNING.md status line and the `reference/plugins.mdx`
   row. The slice is not closed without them — and if a gate cannot go
   green without a decision that is not yours, the slice is not closed at
   all: say so, precisely, and leave it.
