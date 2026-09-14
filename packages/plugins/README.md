# Plugins — conventions and templates

Everything a person or an agent needs to build a battuta plugin — or to
extract an existing feature into one — without having read the rest of
the repository. The architecture is in `PLANNING.md` (Phase 9); this file
is the practical side: where things are, what a plugin package looks
like, the rules the build enforces, how to verify, and the two documents
every plugin must carry.

## Read this first: two sentences that were misread once

The first slice-2 attempt (2026-09-12) was rolled back. Its post-mortem is
`reflection/POSTMORTEM-2026-09-12.md`; read §7 before building anything.
Two things in the plan were misunderstood, so here they are plainly:

1. **"No extension-host process yet" does NOT mean "no command messages".**
   It means the host and the plugins share one JavaScript realm today.
   Commands ARE messages regardless: a plugin mutates the document with
   `ctx.execute({ type: "core.setPitches", targets, label })`, plain data,
   and the host turns the message into the real core command. That is
   what keeps a worker host a deferral instead of a rewrite.
2. **"Everything through `@battuta/api`" is a hard rule, enforced by the
   build.** `@battuta/core` is not a dependency a plugin may have, its
   import fails `apps/editor/test/plugin-boundaries.test.ts` in CI, and
   the api exposes nothing of the document model to reach into — reads
   are the `ctx.query` facade, writes are messages. A plugin that seems
   to need core is asking for an api addition (below), not an import. Do
   not edit this file to permit the code; change the api.
3. **"Grow the api, never work around it" has a ceiling: the brief.** The
   second slice-4 attempt (2026-09-14, post-mortem in
   `onscreen-keyboard/POSTMORTEM-2026-09-14.md`) broke no rule and was
   still rolled back: it added a host service and fourteen api exports
   the brief never named, forged key events for the host to interpret,
   and widened this file to admit it. So: **the api's surface and the
   host's modules are the user's.** A slice may add only the api exports
   its PLANNING.md brief lists under *API may grow*, and no host module
   at all. If the feature cannot be built inside that, **stop** — leave
   the slice open, write the gap into BUILDING.md §7 and the CHANGELOG,
   and report. An open slice with a precise gap is a success; a closed
   slice with a widened contract is a failure. Relocating a forbidden
   call into the host is not compliance, and a plugin that would need to
   forge events (`dispatchEvent`, `new KeyboardEvent`) has found a
   missing host abstraction, not a plugin requirement.

## Where things are

| Path | What it is |
| --- | --- |
| `packages/api/` | `@battuta/api`, the contract. `src/manifest.ts` (what a plugin declares), `src/context.ts` (what a plugin receives). `api-report.d.ts` is the committed snapshot of the public surface. |
| `apps/editor/src/host/index.ts` | `createHost()` and the app's `host` singleton: keymap store, slots, panels, registry, notices, confirm, document/editor mirrors, `execute`, `dispatchKey`. |
| `apps/editor/src/host/registry.ts` | Registration rules, activation events, on/off, `runCommand`. Read its header comment first. |
| `apps/editor/src/host/keymapStore.ts` | Core keymap ∪ plugin bindings, reactive; overrides per layout. |
| `apps/editor/src/host/actions.ts` | The key dispatcher as a table: rules, gates, modals in the App's order; `run(id)` walks the same table without a key. Read its header before writing an input surface. |
| `apps/editor/src/host/slots.tsx` | `<Slot>` (header / docHeader / statusBar / menu) and `<Panels>` (bottom / side). Two kinds of item: runtime ones a plugin adds in `activate`, and **manifest-declared** ones the host renders before the plugin's code loads — a plugin's entry point. |
| `apps/editor/src/host/services.ts` | Settings and storage namespaces, the enabled flag. |
| `apps/editor/src/host/plugins.ts` | **The list of shipped plugins.** Adding a plugin = adding an entry here. |
| `apps/editor/src/App.tsx` | The host UI. Plugin keys are dispatched at the END of its key handler (`host.dispatchKey`), slots sit in the header row, the battuta menu and the status bar. |
| `apps/editor/test/host.test.ts` | The host's guarantees as tests — the fastest way to see how the pieces fit. |
| `apps/editor/src/ShortcutEditor.tsx` | The 🌣 editor: shortcuts tab (your bindings appear there automatically) and the Plugins tab (your on/off switch). |
| `docs/src/content/docs/reference/plugins.mdx` | The user-facing page; gains one row per plugin. |
| `CHANGELOG.md` → `0.1.0 — unreleased` | Where your slice's bullet goes. `PLANNING.md` → Phase 9 → your slice: the brief. |

## Anatomy of a plugin package

```
packages/plugins/<name>/
  package.json        "@battuta/plugin-<name>"; dependencies: { "@battuta/api": "*" } and NOTHING else
                      of the workspace; exports "." → ./src/index.ts and "./manifest" → ./src/manifest.ts
                      (sources, not a dist: Vite and tsc both consume linked TypeScript, so no build step
                      and no prepare)
  tsconfig.json       strict TS; "jsx": "react-jsx" if the plugin renders panels
                      (NO vitest config: vitest's defaults already find test/**/*.test.ts in a node
                      environment, and "vitest/config" is not an import a plugin package may have)
  src/manifest.ts     export const manifest: PluginManifest = { … }   — imports @battuta/api and nothing else;
                      a UI plugin declares its entry point here (contributes.slotItems), never in activate()
  src/index.ts(x)     export default definePlugin({ activate, deactivate })
  src/<feature>.ts    the feature's own logic (the reflection forms, a lane grammar): pure TS over api data
  test/*.test.ts      vitest, against createHost() with memory settings/storage and a fake session adapter
  README.md           how to use it          (template below)
  BUILDING.md         how it was built       (template below)
```

**What belongs in the plugin, what stays in core.** If a function has no
MEI knowledge — it transforms `PitchEvent[]`, parses a chord symbol,
decides a cycle — it is the plugin's, even if it sat in core before
(the reflection forms in `packages/core/src/reflect.ts` move with their
plugin; their tests move too). If it touches the document tree — a
`Command`, a collector over the event index — it stays in core and the
plugin reaches it through a message or a query.

The manifest module must stay tiny and import nothing from the plugin's
code: the host imports it statically to know your commands and bindings
before your code is ever fetched. The code is reached only through
`load: () => import("@battuta/plugin-<name>")`.

**Registration** — three edits outside your package:

1. `apps/editor/src/host/plugins.ts`: add
   `{ manifest, load: () => import("@battuta/plugin-<name>") }` (the
   manifest imported from `@battuta/plugin-<name>/manifest`).
2. `apps/editor/package.json`: add `"@battuta/plugin-<name>": "*"` to
   dependencies, then `npm install` at the repo root (the workspace glob
   `packages/plugins/*` is already there).
3. `docs/.../reference/plugins.mdx`: one row in the table.

Vite names your code's chunk `plugin-<name>`; the bundle-budget check
(`npm run budget -w @battuta/editor`) fails a build in which that chunk
is reachable from the initial chunk — i.e. someone imported your package
statically from the host.

Two decisions are already taken, so no plugin re-decides them: packages
point `exports` at `src/` (no build, no prepare), and plugin code never
imports `@battuta/core` — the boundary test fails the build.

**Relative imports carry no extension** (`./manifest`, not
`./manifest.js`). Core and the api are compiled by `tsc` to `dist/`,
where the `.js` form is right; a plugin is consumed as **raw TypeScript**
by Vite and vitest, which do not remap `.js` → `.ts`. `tsc --noEmit`
accepts both, so the wrong form fails only the production build.

**If you move a binding out of the core keymap**, three surfaces are
keyed by its id and only some have tests: `virtualKeys.ts`'s
`MOD_VARIANTS` / `SHORT` entries, the tests that resolve variants against
`defaultKeymap` (use the union keymap instead — see
`apps/editor/test/virtualKeys.test.ts`), and
`docs/scripts/build-keymap.mjs`, which now reads plugin manifests too so
the generated keyboard reference does not silently lose the row. The
shortcut editor and the on-screen keyboard follow on their own: they
render from `useStore(host.keymap)`, the union, at runtime.

## Reading and writing the document

The api is a data contract. Nothing in it is a live object of the model.

| Need | Call | Returns |
| --- | --- | --- |
| which document, how many measures, its version | `ctx.document.get()` | `DocumentInfo` (`id`, `version`, `measureCount`, `staffCount`, `title`, `tempo`) or null |
| caret, event selection, block, view, input mode | `ctx.editor.get()` | `EditorState` |
| the pitched events of a block, per voice | `ctx.query.pitchEventsIn(block)` | `PitchEvent[][]` |
| the block an event selection covers | `ctx.query.blockOf(ids)` | `BlockSelection` or null |
| **write** pitch content onto events | `ctx.execute({ type: "core.setPitches", targets, label })` | one undo step |
| MIDI inputs (hardware, deduped, hot-plugged, then virtual ones) | `ctx.midi.inputs` | `Store<MidiPort[]>` |
| every note on/off from any input | `ctx.midi.onNote(fn)` | `Disposable` |
| add an input surface (a piano, a chord pad) | `ctx.midi.registerInput(name)` | `MidiVirtualInput` — dispose to unregister |
| send to every MIDI output | `ctx.midi.openOutputs()` | `MidiOutputs` (`schedule`, `send`, `panic`, `close`) or null |
| the union keymap as data (id, label, group, when, keys, mods, locked, plugin) | `ctx.keymap` | `Store<KeymapEntry[]>` |
| **run** an action by id — a keymap id, a locked one (`undo`, `nav.left`, `duration.4`, `pitch.c`, …; the list is in `packages/api/src/actions.ts`) or an enabled plugin's command id | `ctx.actions.run(id)` | true when it ran; false when the id is unknown or the state forbids it — exactly when the key would have done nothing. A plugin's command goes through the registry after the same gates |
| every id `run` knows, live | `ctx.actions.ids` | `Store<readonly string[]>`: core rules in dispatch order, then enabled plugins' commands; republished when a document installs its table and when a plugin is turned on or off |
| why you were woken | `ctx.activatedBy` | `onStartup` \| `onPointer:coarse` \| `onCommand:<id>` \| `onSettings:<key>` \| null (the Plugins tab, a test). Activation runs BEFORE the handler that caused it: open your UI in `activate` only when this is NOT `onCommand:<your toggle>` |
| come back at startup when your own setting says so (a panel left open) | `activationEvents: ["onSettings:<key>"]` — the host fires it after `onStartup` / `onPointer:coarse` when `ctx.settings.get(key)` is truthy | your `activate` runs with `activatedBy === "onSettings:<key>"` |
| an entry point the user can click BEFORE your code loads (a 🎹 that opens your panel) | `contributes.slotItems: [{ id, slot, label, title?, command, order?, dimUntilActive? }]` in the manifest | the host renders a button; the click runs your command and activates you. `dimUntilActive` draws that face de-emphasised until you are running — for a button that OPENS something, "not active" means "not showing"; leave it unset for one that just runs a command |
| a slot item that needs live state — or the declared entry point once you are active | `ctx.slots.add(slot, { id, order?, render })` at runtime; the same `id` as a declared item REPLACES its face while the item lives | `Disposable` — dispose (or deactivate) and the declared face is back |
| a panel | `ctx.panels.open({ id, side: "bottom" \| "side", title, render })` | `Disposable` |
| a text lane at the caret, listed in the status bar BEFORE your code loads | `contributes.lanes: [{ id, label, name, glyph?, place }]` in the manifest; activate on `onLane:<id>` | picking it wakes you; register the spec in `activate` |
| the lane's behaviour | `ctx.lanes.register(spec)` — `LaneSpec`: `attachesTo`, `advance`, `advanceOn`, optional `accepts` / `transform` / `complete` / `suggest` / `hint`, `read(eventId)`, `commit({ eventId, buffer, key, prevEventId })` → a message, null (unchanged) or `{ refuse }` | `Disposable`; the host owns the buffer, the keys, the editor box and the advance — you never see a key event |
| open your lane from your own key | `ctx.lanes.open(id)` | true when it opened; leaves entry mode like the select does — decline on `ctx.editor.get().entryMode` first if your key must not |
| the verse-1 syllable of a note | `ctx.query.lyricAt(eventId)` | `SylValue` (`text`, `wordpos?`, `con?`) or null |
| **write** a syllable (empty text clears) | `ctx.execute({ type: "core.setSyl", eventId, value })` | one undo step; refused on a rest |
| the harmony text of one kind at an event | `ctx.query.harmAt(eventId, kind)` — `kind` is `"chord"` (above) or `"rna"` (below) | `string`, "" when none |
| would the document accept this harmony text? | `ctx.query.harmValid(kind, text)` | `boolean` — the grammar lives in core because `core.setHarm` refuses what fails it; ask, do not copy |
| **write** a harmony (empty text clears) | `ctx.execute({ type: "core.setHarm", eventId, kind, text })` | one undo step; refused when `harmValid` would say no |
| a control in the context bar that looks like the host's | render `<select className="sbsel" data-cycle?>` from a `statusBar` slot item | the look, F6 roving focus and ↑/↓ cycling (`data-cycle`) come with the class; the bar anchors host controls and grows contributions into the free space, so your item never moves them |

Three things to know, each learned the hard way:

- **You cannot observe your own `execute` synchronously.** The host
  republishes `ctx.document` after its render cycle; the version you read
  right after `execute` is the one from before your edit. Subscribe and
  adopt the next published version as yours.
- **The editor acts on the drag block when there is one, else on the
  rectangle the event selection covers.** `ctx.editor.get().block ??
  ctx.query.blockOf(ctx.editor.get().selection)` is that rule.
- **`DocumentInfo.id` is document identity.** A new tab or a reopened
  file gets a new id; key any per-document state on it.
- **An input surface runs ids; it never presses keys.** Buttons call
  `ctx.actions.run(id)`; a latched modifier selects the *variant* id
  (staccato → staccatissimo), not a modified key. The host's table
  decides what the id does in the current state, exactly as it would for
  the key, so the surface cannot reach anything the host has not named.
  Pitches come through `ctx.midi.registerInput`, not through `pitch.c`,
  when they carry a MIDI note.
- **Never touch Web MIDI or the shell bridge.** `ctx.midi` is the one
  MIDI service (capability `midi`): a plugin that is an input surface
  registers a virtual input and the host's entry path hears it like a
  keyboard; a plugin that plays opens the outputs and gets the panic
  guarantee for free. Declare `capabilities: ["midi"]` in the manifest.

**Adding a message or a query** is an api change, made in the host, never
worked around in a plugin — and only when the slice brief's *API may
grow* block names it. Anything the brief does not name is a STOP (rule 3
above), even if it is small, even if it is elegant, even if you have
already written it:

1. `packages/api/src/messages.ts` (a union member) or `document.ts` (a
   `DocumentQueries` method); every planned slice maps onto a command that
   already exists in core (`SetSylCommand` for lyrics, `SetHarmCommand` for
   harmony) — a message for a NEW command means a core change first.
2. `apps/editor/src/host/messages.ts` (`toCommand` case) or the
   `SessionAdapter` in `apps/editor/src/host/index.ts` plus its binding in
   `App.tsx`.
3. A test in `apps/editor/test/host.test.ts` ("commands as data").
4. Bump the api version, `npm run api:update -w @battuta/api`, a line
   under the unreleased heading in `CHANGELOG.md`.

## Hard rules — each one has a failing test

| Rule | Enforced by |
| --- | --- |
| Only `@battuta/api`, `react` and the package's own files are imported — never `@battuta/core`, `apps/editor`, Verovio, Tone; relative imports stay inside the package | `apps/editor/test/plugin-boundaries.test.ts` (static, type-only, re-export and dynamic imports alike) |
| `package.json` depends on `@battuta/api` and nothing else of the workspace; the name is `@battuta/plugin-<name>` | same test |
| `src/manifest.ts` imports nothing but `@battuta/api` | same test |
| No DOM: `window`, `document`, `navigator`, `localStorage`, `sessionStorage` never appear as globals | same test |
| `README.md` and `BUILDING.md` exist, the latter with the eight headings | same test |
| No plugin code in the initial chunk; plugin manifests, core and api live in the `battuta-shared` chunk | `npm run budget -w @battuta/editor` |
| A handler for a command the manifest did not declare is refused | the registry throws (plugin marked failed) |
| A plugin binding never shadows a core action id | the keymap store drops it |
| Mutation only through `ctx.execute(message)`; only published message types | `toCommand` throws on anything else; there is no other door — core is unreachable |
| API surface changes are visible and versioned; a change needs a version bump the user approved (`--unpublished` was withdrawn) | `api-report.d.ts` snapshot test + `api-report.mjs` |
| No forged input anywhere: no `dispatchEvent`, no `new KeyboardEvent` / `MouseEvent` / `PointerEvent` in the host or a plugin | `apps/editor/test/host-boundaries.test.ts` |
| The host's module list is an allowlist: a new file under `apps/editor/src/host/` is a user decision recorded in the brief | same test |
| An extraction adds or changes no binding: the union keymap (core ∪ plugins, both layouts) is byte-identical to `apps/editor/test/keymap.snapshot.json` | `apps/editor/test/keymap-snapshot.test.ts`; changing it deliberately is `npm run keymap:snapshot -w @battuta/editor` |
| Byte-identical undo for every message | core's command tests and fuzzer cover the mapped commands; the mapping is tested in the host |

Conventions the tests cannot see, still binding:

- **The rule files are the user's during a slice.** This file, the api's
  README and PLANNING.md's rules and briefs are not edited by a slice; a
  slice adds dead ends to its own BUILDING.md and one CHANGELOG bullet,
  and proposes a rule change there. Write the proposal BEFORE the code
  it would admit: once the code exists, a rule edit that admits it reads
  as documentation. (Rewritten twice so far — 2026-09-12 and
  2026-09-14; the second time the sentence was even true of the tree.)
- **Name the consumer of every api addition you propose.** An addition
  with no consumer outside its own module is symmetry, not design
  (`registerSurface`, 2026-09-14).
- **Ask what the feature needs the editor to DO, not what its code
  CALLS.** Read an extraction as a list of host capabilities in the
  host's vocabulary first and the implementation second — otherwise the
  mechanism the old code used becomes the requirement.

- **No document state outside the document.** Transient state lives in
  memory; small values in `ctx.settings`; larger ones in `ctx.storage`.
  Anything about the SCORE goes into MEI through a message. "All plugins
  off" must leave every document byte-identical.
- **Dispose everything.** What the context hands back is tracked for
  you; anything else you create (timers, listeners) goes into
  `ctx.subscriptions`. Off = `deactivate()` then every disposable fires.
- **Activate as late as possible.** Keybindings and declared slot items
  activate you implicitly (`onCommand:<id>` fires when the key is pressed
  or the item clicked); `onSettings:<key>` brings you back at startup
  only for a user who left you in use; `onStartup` costs every user your
  code at launch.
- **Extractions are behaviour-neutral.** Every e2e script passes
  unchanged (`spikes/verify-*.mjs`); if none drives the feature you are
  extracting, add one FIRST.
- **Plugin keys come after core keys.** `host.dispatchKey` runs only when
  every core branch of the key handler fell through, and never while a
  text lane or the shortcut editor owns the keyboard.
- **Pin the API.** `engines.battuta: "^<API_VERSION>"`.
- **Traps every UI plugin will meet** (found 2026-09-14, all real, kept
  from the rolled-back attempt): activation runs BEFORE the command
  handler that caused it, so a plugin that opens its UI in `activate()`
  and toggles it in the handler opens and then closes — `ctx.activatedBy`
  says which path woke you; write the table of wake-up paths out and
  test each row; a panel with internal state
  subscribes to the host's stores itself (`useSyncExternalStore`, six
  lines) and is never disposed-and-reopened to refresh, which remounts
  it; a component that moves into a slot loses its own `position: fixed`
  first; `i` enters input mode, `Insert` toggles it; when a synthesized
  key "does nothing", prove the event arrived before suspecting the
  delivery; and anything the host and a plugin share (React, next) needs
  a name in `manualChunks` or Rollup settles it inside the plugin chunk —
  ask Rollup what is in the chunk (a `generateBundle` hook printing
  `Object.keys(chunk.modules)`), do not grep the output.

## Verifying

```sh
npm run typecheck -w @battuta/editor
npx vitest run --root packages/core
npx vitest run --root packages/api
npm test -w @battuta/editor
npm run test:plugins                          # every packages/plugins/*/test suite (CI runs this too)
# the editor suite also holds the host boundary test and the union-keymap snapshot; a
# deliberate binding change is `npm run keymap:snapshot -w @battuta/editor` (then explain it)
npm run build -w @battuta/editor && npm run budget -w @battuta/editor
# browser e2e (Vite dev + Playwright's bundled Chromium); each script prints
# PASS/FAIL lines and exits 1 on any FAIL. Once: fetch the corpus scores.
sh spikes/fetch-fixtures.sh
mkdir -p /tmp/battuta-e2e
for s in app phase2 phase3 phase4 phase5; do
  BATTUTA_ROOT=$PWD CHROME=bundled SCRATCH=/tmp/battuta-e2e node spikes/verify-$s.mjs || echo "FAILED: $s"
done
BATTUTA_ROOT=$PWD CHROME=bundled SCRATCH=/tmp/battuta-e2e node spikes/verify-onscreen-keyboard.mjs   # the panel, by tapping (24)
BATTUTA_ROOT=$PWD CHROME=bundled SCRATCH=/tmp/battuta-e2e node spikes/verify-lyrics.mjs              # the lyrics lane, by typing (26)
sh spikes/verify-tauri.sh                     # the shell smoke; needs a display and Rust
```

Run the e2e scripts one at a time: two concurrent Chromiums plus two
Verovio worker pools make the render waits flaky. The scripts open the
committed fixture `fixtures/synthetic-context-changes.mei` and address
its notes by id (`cc-m2n1`) — never resave that file from the app.

Plugin tests run against a real host in memory, with a fake session
adapter standing in for the document (the only imports a test may add
beyond the api are vitest, `node:*` and the host):

```ts
import { createHost, memorySettings, type SessionAdapter } from "../../../../apps/editor/src/host";
import { memoryStorage } from "../../../../apps/editor/src/host/services";
const executed: unknown[] = [];
const adapter: SessionAdapter = {
  execute: (cmd) => executed.push(cmd),                         // the core command the host built from your message
  pitchEventsIn: () => [[{ eventId: "n1", pitches: [{ pname: "c", oct: 4 }] }]],
  blockOf: (ids) => (ids.length ? { measureFrom: 0, measureTo: 0, staffFrom: 1, staffTo: 1 } : null),
};
const host = createHost({ layout: "qwerty", plugins: [entry], settings: memorySettings(), storage: memoryStorage(), confirm: async () => true });
host.bindSession(adapter);
host.document.set({ id: "doc-1", version: 1, measureCount: 10, staffCount: 2, title: "", tempo: null });
host.editor.set({ ...host.editor.get(), block: { measureFrom: 0, measureTo: 1, staffFrom: 1, staffTo: 1 } });
host.dispatchKey({ key: "R", shiftKey: true, altKey: false });   // presses your binding
```

Remember the host republishes `ctx.document` only when the App's effect
runs; in a test you play the App: after an execute, `host.document.set`
the next version yourself. `apps/editor/test/host.test.ts` shows the full
pattern (a fixture plugin that contributes one of everything, then every
guarantee asserted).

## Closing a slice

- [ ] `README.md` and `BUILDING.md` in the plugin package, from the templates.
- [ ] Row in `docs/src/content/docs/reference/plugins.mdx`; `cd docs && npm run build` passes its drift check.
- [ ] `CHANGELOG.md` bullet under `0.1.0 — unreleased`: decisions, dead ends, `App.tsx` lines before → after (`wc -l apps/editor/src/App.tsx`), API version and any change to it, bundle figure if it moved.
- [ ] `DESIGN.md`: the feature's "becomes a plugin" note updated to how it is one (a sentence or two).
- [ ] `PLANNING.md`: the slice's status line under *Migration*.
- [ ] Everything under *Verifying* green, e2e scripts unchanged (or the new one you added first).

---

## Template — README.md (how to use it)

```markdown
# <Plugin name>

<One paragraph: what it does, in the user's terms. What a score gains
from it. When you would turn it off.>

## Turning it on and off

battuta menu → 🌣 shortcuts → **plugins** → <name>. Off deactivates it at
once: <what disappears — bindings, panel, menu items>. The switch is
remembered; a rebind of its keys survives off/on.

## Keys

<Never retype a table.> Its bindings appear in the shortcut editor under
the *<group>* group and on the on-screen keyboard; the generated
reference is at <link to docs reference/keyboard>.

## Settings and storage

| Key | Where | Meaning |
| --- | --- | --- |
| `<key>` | settings | <meaning, default> |
| `<key>` | storage | <what is kept, how big it can get> |

## What it does not do

<Deliberate limits, one line each.>

## Guide

<Link to the user-guide page.>
```

## Template — BUILDING.md (how it was built)

Fixed headings, in this order, all eight present even if a section says
"none". Write for the next author — a person or an agent — who has this
file, `packages/plugins/README.md`, and nothing else.

```markdown
# Building <plugin name>

## 1. Origin

<Extraction: what the code was before — files, the `App.tsx` branches,
hooks and refs it replaced; the commit range; `App.tsx` line count
before → after. New feature: the spec it was built to (link the
PLANNING.md slice / DESIGN.md section).>

## 2. Manifest

<Every contribution point and activation event declared, each with its
one-line reason. Then what was deliberately NOT declared, and why.>

## 3. API surface

<Every `@battuta/api` call used, grouped: read (document, editor,
settings/storage get), write (execute, settings/storage set), lifecycle
(registerCommand, slots, panels, subscriptions, notice, confirm). Anything
the API had to grow for this plugin, and the version that carried it.>

## 4. State

<Transient (memory): what and why it is safe to lose. Persisted
(storage namespace): keys and sizes. Document (MEI or sidecar): which
elements/attributes, through which commands. Then the sentence: "Nothing
mutates the document outside `ctx.execute`," and how you know.>

## 5. Command messages

<Each message the plugin sends (`ctx.execute({ type })`): what it changes,
when it is sent, and which core command the host maps it to. If the api
had to grow a message or a query for this plugin, say so here and in §3.>

## 6. Tests

<The suites and what each pins; how to run them; which e2e scripts gated
the extraction and stayed green (or the one you added first).>

## 7. Dead ends

<What was tried and dropped, with the reason. The most valuable section:
it is what stops the next plugin from repeating the experiment. "None" is
suspicious.>

## 8. Recipe

<The shortest path to a plugin like this one: files to copy, names to
change, the order to do it in, the checks to run at each step.>
```
