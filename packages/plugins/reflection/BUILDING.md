# Building the reflection cycle

The first battuta plugin, and the worked example every later one copies.
Written for the next author — a person or an agent — who has this file,
`packages/plugins/README.md`, and nothing else.

A first attempt at this slice on 2026-09-12 was **rolled back**; its
post-mortem is `POSTMORTEM-2026-09-12.md` in this directory and its §7 is
still worth reading, because several of its traps are permanent features
of the host. What follows is the rebuild, on the hardened contract
(standalone `@battuta/api`, commands as data, a query facade, and a
boundary test that fails the build). Where a section repeats the
post-mortem, it says so.

## 1. Origin

An extraction, not a new feature: the reflection cycle shipped in 0.0.3
as a branch of `App.tsx`'s single keydown handler.

| What | Where it was | Where it is |
| --- | --- | --- |
| the `shift+R` branch (~40 lines) | `apps/editor/src/App.tsx`, after the repeats branch | `src/index.ts` |
| the `reflectCycle` ref (base capture, step, version) | `App.tsx` `useRef` | a closure variable in `activate()` |
| the `reflect` binding | `apps/editor/src/keymap.ts` `defaultKeymap()` | `src/manifest.ts` |
| the serial-form maths | `@battuta/core/src/reflect.ts` | `src/forms.ts` |
| the form tests | `packages/core/test/reflect.test.ts` | `test/forms.test.ts` |
| the panel caption + shift latch | `virtualKeys.ts`, keyed `reflect` | same file, keyed `battuta.reflection.cycle` |

`@battuta/core/src/reflect.ts` was split along the line between
**document** and **feature**, and renamed to what is left of it:

| Stays in core (`src/pitches.ts`) | Moved here (`src/forms.ts`) |
| --- | --- |
| `Pitch`, `PitchEvent` | `ReflectionForm` |
| `collectPitchEvents` — an index query any pitch feature needs | `REFLECTION_CYCLE`, `REFLECTION_LABELS` |
| `SetPitchesCommand` — an undoable write, in core's fuzz pool | `reflectionForm`, `arityPalindromic`, the diatonic mirror |

**The line: core knows what a pitch is and how to write one; the plugin
knows what a retrograde is.** If a function has no MEI knowledge and
exists only because this feature does, it is the plugin's — even if it
sat in core before. Core ships inside the host's initial chunk, so
anything left there costs every user its weight at launch and "turn the
plugin off" would not unload a byte of it. ("It was already in core" is a
statement about history, not about where something belongs.)

`SetPitchesCommand`'s default label was `"reflect"`; it is now
`"set pitches"`, since the command has no opinion about what a caller
means. Every caller passes its own label, so nothing observable changed.

**`App.tsx`: 3,364 → 3,321 lines (−43).** The plugin is 238 lines of
source across three files, of which roughly 90 are code and the rest
comments and the manifest.

## 2. Manifest

```
id                battuta.reflection
engines.battuta   ^0.1.0
activationEvents  onCommand:battuta.reflection.cycle
contributes       1 command, 1 keybinding
capabilities      none
```

- **`onCommand:` and nothing else.** The key press is the only thing that
  can ever need this plugin: no view, no format, no document predicate,
  no startup work. The registry fires `onCommand:` implicitly when a
  contributed binding matches, so a user who never presses `shift+R`
  never loads a byte of it — verified by a counted assertion, not
  inferred (`test/reflection.test.ts`, "with no code loaded").
- **One command**, `battuta.reflection.cycle`, exported from
  `src/manifest.ts` as `COMMAND_CYCLE` and imported by `src/index.ts`, so
  the id is written exactly once. The manifest still imports nothing but
  a type.
- **One keybinding**, `"R"` (i.e. shift+r). The label, group (`rhythm`)
  and context (`block selection`) are copied **verbatim** from 0.0.3's
  core keymap entry — that is what keeps the shortcut editor, the
  on-screen keyboard and the generated keyboard reference reading exactly
  as before, and there is a test pinning the label string. No `layouts`
  override: `R` exists on QWERTY and AZERTY alike.

Deliberately NOT declared:

- **No `capabilities`.** It needs no MIDI, no workspace, no playback. A
  capability it does not use would be a registration failure waiting for
  a build that does not offer it.
- **No `onStartup`.** It would cost every user this code at launch to
  save one dynamic import on first press.
- **No slots, panels, menu or status-bar items.** The feature is a key.
- **No settings or storage keys** (§4).

## 3. API surface

Everything used, grouped:

| Phase | Call | Why |
| --- | --- | --- |
| read | `ctx.document.get()` | the document id and version (identity + re-base test) |
| read | `ctx.document.subscribe(fn)` | to learn the version of our OWN edit (§7.1) |
| read | `ctx.editor.get()` | `block` and `selection` |
| read | `ctx.query.blockOf(ids)` | the rectangle an event selection covers |
| read | `ctx.query.pitchEventsIn(block)` | the base capture: pitched events per voice |
| write | `ctx.execute(message)` | the one mutation path; one undo step |
| lifecycle | `ctx.registerCommand(id, handler)` | the declared command's handler |
| lifecycle | `ctx.subscriptions.add(d)` | the document subscription |
| lifecycle | `ctx.notice(text)` | the five notices |

Types named from `@battuta/api`: `BlockSelection`, `Pitch`, `PitchEvent`,
`PluginContext`, `PluginEntry` (tests). **No values are imported from
anywhere but `@battuta/api` and this package.**

**What the API had to grow for this plugin: nothing.** `@battuta/api`
stays at **0.1.0** and `api-report.d.ts` is unchanged. That is the
headline result of the slice: the surface the 2026-09-14 hardening
designed — a `DocumentInfo` snapshot with an `id`, `pitchEventsIn`,
`blockOf`, and `core.setPitches` as a message — was exactly enough to
rebuild the feature with zero additions. The first attempt needed two
API changes and a core import; this one needed none.

**What the API deliberately did NOT grow:**

- **An "effective block" on `EditorState`.** The editor acts on the drag
  `block` when there is one and otherwise on the rectangle the event
  `selection` covers; the API reports the two separately and the plugin
  combines them in one line
  (`state.block ?? ctx.query.blockOf(state.selection)`). One consumer
  does not justify a third field — the extraction rule is *no speculative
  points*. If a second and a third plugin want it, that is the moment.
- **A way to read back your own edit synchronously.** It was never
  attempted: the asynchrony is the host's honest shape (§7.1), and a
  synchronous back-door would be a second mutation path in disguise.

## 4. State

**Transient (memory).** One `Cycle | null` in the `activate()` closure:
the base pitch capture, the step counter, a signature (document id +
block rectangle) and the document version the base still describes. Safe
to lose — losing it costs the user one press, because the next press
re-bases from the score as it stands. It is about the editing *session*,
not about the music: nothing in it could be written to a file without
being wrong the moment the score changed.

Plus one boolean, `ownEditPending`, living only between `execute` and the
host's next document publication (§7.1).

**Persisted (storage namespace).** None. No settings key, no storage key.
A test asserts both are untouched after a full four-press cycle, so
"disable all plugins" leaves nothing behind but the enabled flag the host
itself keeps.

**Document (MEI).** Pitch attributes only — `@pname`, `@oct`, `@accid`,
`@accid.ges` on existing `<note>` elements, written by core's
`SetPitchesCommand` through the `core.setPitches` message. No new
elements, no `<annot>`, no sidecar, no ids minted. A score edited by this
plugin is indistinguishable from one edited by hand, which is why turning
the plugin off can never change a document.

**Nothing mutates the document outside `ctx.execute`.** How I know,
structurally rather than by inspection: the plugin imports
`@battuta/api` and its own two modules and nothing else — there is no
door to core, and `apps/editor/test/plugin-boundaries.test.ts` fails the
build if one appears (static, type-only, re-export and dynamic imports
alike). `src/forms.ts` is pure and returns new arrays. The off test pins
that the document version does not move while the plugin is disabled, and
the host's own `--no-plugins` property pins that registering, activating
and disabling never call the executor.

## 5. Command messages

One message, and the command behind it is core's, not the plugin's:

**`{ type: "core.setPitches", targets, label }`** → `SetPitchesCommand`,
built by the host's `toCommand` (`apps/editor/src/host/messages.ts`),
which copies the plugin's data before it reaches the command.

- **Sent** once per accepted press, with `targets` = the chosen form of
  every voice in the block, flattened, and `label` = the form name
  (`"inversion"`, `"retrograde"`, `"retrogradeInversion"`, `"prime"`), so
  the undo stack reads as the cycle the user pressed.
- **Revert strategy: memento.** `apply` snapshots every touched element's
  full attribute map before writing; `revert` restores those maps
  wholesale, so attributes the command never touched survive and a revert
  is byte-identical rather than merely equivalent.
- **Dirty regions:** the distinct `(measureIndex, staffN)` cells of the
  target events — the same set the editor re-renders for a hand edit.

**The plugin defines no commands**, so no fuzz harness leaves core:
`packages/core/test/property.test.ts` case 33 covers `SetPitchesCommand`
inside the core pool. It used to build its targets with `reflectionForm`,
which is no longer in core, so it now applies a diatonic shift instead —
same command, same apply-then-revert property, no reflection concept left
in core's test tree.

One sharp edge, inherited and documented in `pitches.ts`:
`SetPitchesCommand.apply` throws if a target's pitch count does not match
the event's note count, and it throws *after* mutating earlier targets in
the same command. Neither the plugin nor the fuzzer can trigger it,
because both build targets from the document they are about to write to,
so arity matches by construction. Do not hand it targets from a stale
capture.

## 6. Tests

| Suite | Pins | Run |
| --- | --- | --- |
| `test/forms.test.ts` (12) | the transforms themselves — the four assertions of core's old `reflect.test.ts` carried over verbatim, plus ids, accidentals, chords, refusals and the cycle's shape | `npx vitest run --root packages/plugins/reflection` |
| `test/reflection.test.ts` (20) | registration, counted lazy loading, the four-form cycle, base-capture-once, re-basing (external edit, block change, document change), every refusal, off/on, no settings or storage written | same |
| `packages/core/test/pitches.test.ts` (8) | the half that stayed: `collectPitchEvents` (voices, chords, spans) and `SetPitchesCommand` (write, byte-identical revert, accidentals, arity refusal, dirty regions, default label) | `npx vitest run --root packages/core` |
| `packages/core/test/property.test.ts` | `SetPitchesCommand` in the core fuzz pool; case 33 rebuilt without the forms | same |
| `apps/editor/test/virtualKeys.test.ts` (23) | the modifier-variant rules against the **union** keymap, plus the plugin-off case (§7.6) | `npm test -w @battuta/editor` |
| `apps/editor/test/plugin-boundaries.test.ts` | this package obeys every hard rule | same |
| `apps/editor/test/host.test.ts` (20) | the host's guarantees, unchanged | same |
| `packages/api/test/api-surface.test.ts` | the api surface is unchanged at 0.1.0 | `npx vitest run --root packages/api` |

The plugin's suite runs against a **real host** (`createHost` with
memory-backed settings and storage) and a ~70-line `fakeEditor` standing
in for `App.tsx`: a version counter, a recorded command log, and a
document snapshot published to the host *after* the executor returns —
which is the one property of the app the plugin actually depends on
(§7.1). Use it as the template.

**e2e gates.** `spikes/verify-phase5.mjs` drives the whole cycle in a
browser — four presses, byte-identical return, and the four-step undo
unwind — and is what proves the extraction behaviour-neutral. It reaches
the feature only through the keyboard and the notice text, so it needed
no change. See §7.8 for what was and was not run here, honestly.

`npm run build -w @battuta/editor && npm run budget -w @battuta/editor`
is the other real gate; run it *before* you believe you are finished.

## 7. Dead ends

What was tried and dropped, and what was nearly got wrong. The
post-mortem's §7 is the longer list and still applies; this section
records what happened on the rebuild.

**1. Reading the document version straight after `execute` — not fallen
into, but verified.** This is the post-mortem's big one and it is a
permanent property of the host, so it is worth restating: the host
mirrors the document into `ctx.document` from a React effect in
`App.tsx`, which has not run when `execute` returns, so the version read
back is the one from *before* your own edit — indistinguishable from
somebody else's edit. Under the naive line the cycle re-bases on every
press and `shift+R` four times gives inversion, inversion, inversion,
inversion. I did not write it, but I did **verify the suite catches it**
by re-introducing it: five tests fail, including "four presses are the
four forms". A test that would not have caught this would have been
worthless. The fix is `ownEditPending` + adopting the next published
version in the document subscription.

**2. `vitest.config.ts` in the plugin package — deleted, not exempted.**
Copied from `packages/api`, it failed the boundary test at once:
`import { defineConfig } from "vitest/config"` is not one of the imports
a plugin package may have. The tempting fix is to widen the rule (exempt
config files); the right one turned out to be simpler — **the file was
unnecessary**. Vitest's defaults already find `test/**/*.test.ts` and
already use the node environment, so deleting it lost nothing and kept
the rule intact. If a later plugin genuinely needs a config file (slice 4
may, for JSX), that is when the rule grows, with a real consumer to shape
it. Do not widen a rule for a file you did not need.

**3. `.js` extensions on relative imports.** Written as
`import { COMMAND_CYCLE } from "./manifest.js"`, copying core's habit.
Core and the api are compiled by `tsc` to `dist/`, where those
specifiers are correct; a **plugin is consumed as raw TypeScript** by
Vite and vitest, which do not remap `.js` → `.ts`. Use extensionless
relative imports in a plugin. `tsc --noEmit` with `moduleResolution:
"bundler"` accepts both, so this would not have failed a typecheck — it
would have failed the production build.

**4. Duplicating a host guarantee in the plugin's suite.** I wrote a test
that a rebind of `shift+R` survives turning the plugin off and on. It
failed — not because the behaviour is broken, but because
`KeymapStore.rebind` persists through `localStorage`, which node does not
provide, so the override silently did not stick. The fix looked like
"shim `localStorage` in this suite". The better answer was to **delete
the test**: it is keyed by command id with nothing plugin-specific about
it, it is the host's guarantee, and `apps/editor/test/host.test.ts:227`
already pins it (with the shim it needs). The plugin suite stays free of
DOM shims. Ask whose guarantee a test is before making it run.

**5. Asserting the pitch content the plugin sent.** I wanted the
lifecycle suite to prove the *targets*, not just the labels. The adapter
receives a core `Command`, whose `targets` are private; reading them
means reaching into an implementation detail, and applying the command
means constructing a real `CommandContext`, which means core — the thing
a plugin package may not have. Dropped in favour of a deliberate split:
`test/forms.test.ts` proves the maths, `packages/core/test/pitches.test.ts`
proves the write, `host.test.ts` proves the message→command mapping, and
the lifecycle suite proves the *cycle* through the command labels — plus
one negative assertion (an empty `pitchEventsIn` produces "no notes in
the selection") that pins the query as the base's source. Do not test the
same property twice through a worse interface.

**6. The on-screen keyboard's caption, keyed by an id that moved.**
`virtualKeys.ts` had `MOD_VARIANTS.reflect` (the shift latch on the
`rest` key) and `SHORT.reflect`. Re-keying both to
`battuta.reflection.cycle` is necessary but **not sufficient**, exactly
as the post-mortem warned: `displayLabel` fell back to `SHORT[variantId]`
without checking the live keymap, so with the plugin **off** the shifted
rest key went on advertising "reflect" for a key that does nothing. It
now skips a variant the live keymap does not carry, and there is a test
for the off case. Expect this class of bug whenever a *generated* surface
is keyed by an id that moves.

Its test needed the same treatment: `virtualKeys.test.ts` asserted every
`MOD_VARIANTS` entry against `defaultKeymap(layout)`, which no longer
contains the reflection binding, so the move broke it. It now builds a
**union keymap** (core ∪ every shipped plugin's contributions, merged by
the host's own `KeymapStore`) — which is what the running app renders
from. Slice 4 moves the *coverage* test onto the same union.

**7. The generated keyboard reference silently losing the binding.**
`docs/scripts/build-keymap.mjs` transpiles `apps/editor/src/keymap.ts`
and dumps both layouts to `keymap.json`. Nothing failed when the
reflection binding left that file — the reference page simply stopped
listing `shift+r`, and the docs drift check does not notice a *missing*
row (it warns about actions with no prose, not about prose with no
action). This would have shipped a plugin whose README points at a
reference that does not mention it. The generator now also reads every
`packages/plugins/<name>/src/manifest.ts` — each is a standalone module
importing only a type, so the same transpile-and-import trick works — and
marks contributed rows so a reader knows the key disappears if the plugin
is off. **Whenever you move a binding, check every surface generated from
the keymap, not just the ones with tests.**

(Two of those surfaces already followed the binding for free, because
they render from `useStore(host.keymap)` — the union — at runtime: the
shortcut editor and the on-screen keyboard. It was the build-time
generator that drifted.)

**8. The bundle budget, and a result that runs the wrong way.** This
passed on the first build, which is worth recording as a success of slice
1: the post-mortem's two chunking failures (§7.4) were fixed there, in
`vite.config.ts`'s `manualChunks`, and neither recurred. The plugin is a
**1.99 kB lazy chunk**.

But the *initial* chunk went **up**: 592.8 kB at slice 1 → 595.1 kB now
(ceiling 605.5 kB). I measured where it went by registering no plugins
and rebuilding: the host without this plugin is 593.2 kB, so
**registering the first plugin costs the host ~1.9 kB** — its manifest
lives in the initial `battuta-shared` chunk by design, plus the
dynamic-import glue — while the feature code it removed was only about a
kilobyte. For a feature this small the ledger is roughly a wash, and
saying so plainly matters more than the number: **the per-plugin cost to
the host is fixed, and the saving scales with the feature.** It is slices
7 and 8 — Tone.js, the sampled piano, the 4.6 MB Humdrum build — where
this pays, which is exactly where PLANNING.md schedules the ceiling to
drop. Do not expect an extraction this size to move the budget.

**9. What I could not run, and did not pretend to.**
`spikes/verify-tauri.sh` needs GNU `timeout`, which macOS does not ship;
its first check fails on any tree, so it did not gate this slice — the
same environment gap the post-mortem recorded, still unfixed. Nothing in
this slice touches Rust. The browser e2e scripts need the corpus from
`sh spikes/fetch-fixtures.sh`; see the slice's CHANGELOG bullet for
exactly which ran here.

**10. Not attempted, on purpose: content comparison instead of a version
counter.** The post-mortem's §7.2 is still right. Comparing the block's
live pitches against what the plugin last wrote needs no version, no
flag, and re-bases on undo for free — but under 0.0.3 an edit *anywhere*
in the score re-bases the cycle, and under content comparison an edit in
another measure would not. An extraction reproduces the old rule, wart
and all. Worth revisiting as a deliberate improvement, in its own change,
with its own note.

## 8. Recipe

The shortest path to a plugin like this one — a command with a key, no
UI. Read `packages/plugins/README.md` alongside.

1. **Copy the package.** `packages/plugins/reflection/{package.json,
   tsconfig.json}` → `packages/plugins/<name>/`. Change the name to
   `@battuta/plugin-<name>` and the description. Keep `exports` pointing
   at `src/`, keep `@battuta/api` as the only workspace dependency, and
   do **not** add a vitest config (§7.2).
2. **Write `src/manifest.ts` first.** Export your command id as a const,
   then the manifest. Import nothing but `type { PluginManifest }` — the
   host loads this module eagerly and your code must not ride along.
   Declare the narrowest activation event that can possibly need you.
3. **Write the feature's own logic in its own module** (`src/forms.ts`
   here), pure over api data types. If it needs core, stop: that is the
   API telling you it is missing something, and the answer is to grow the
   API, not to reach past it.
4. **Write `src/index.ts`.** `export default definePlugin({ activate })`.
   Register the declared command, put every subscription into
   `ctx.subscriptions`, mutate only through `ctx.execute`, and never read
   back what you just executed (§7.1). Extensionless relative imports
   (§7.3).
5. **Register it** — three edits outside the package:
   `apps/editor/src/host/plugins.ts`, the editor's `package.json`
   dependencies, then `npm install` at the repo root.
6. **`npm run typecheck -w @battuta/editor`**, then
   **`npm test -w @battuta/editor`** — the boundary test tells you at
   once about a forbidden import, a missing document or a heading you
   have not written.
7. **Write the suite** against `createHost` + a fake editor, copying
   `test/reflection.test.ts`. Start with registration (it needs no
   document), then behaviour. Then **break your own implementation on
   purpose** and check the suite fails — for a plugin that edits, the
   version-after-execute line (§7.1) is the one to try.
8. **`npm run build -w @battuta/editor && npm run budget -w @battuta/editor`.**
   Before you believe you are finished, not after.
9. **Move every binding's surfaces**, if you took one from core: the
   `MOD_VARIANTS`/`SHORT` keys in `virtualKeys.ts`, the tests that
   resolve against `defaultKeymap`, and the generated keyboard reference
   (§7.6, §7.7).
10. **Run the e2e scripts**, one at a time, after
    `sh spikes/fetch-fixtures.sh`. If none drives your feature, write one
    **first**, against the old code, and watch it pass there.
11. **Write `README.md` and `BUILDING.md`**, then the CHANGELOG bullet
    with the `App.tsx` count, the DESIGN.md sentence, the PLANNING.md
    status line and the `reference/plugins.mdx` row. The slice is not
    closed without them.

For a plugin with UI, read slice 4's (`onscreen-keyboard`) instead —
slots and panels are where it differs.
