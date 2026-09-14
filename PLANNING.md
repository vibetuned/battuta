# PLANNING.md — MEI Score Editor

Each phase ends in something usable day-to-day; nothing in a later phase is required for an earlier phase to be useful. Phase estimates assume solo development with heavy Claude Code assistance and reuse of midi-stroke's Verovio/Pixi/Tone experience. Exit criteria are the gate for moving on — resist starting the next phase before they hold.

> **Phases 0–8 are complete and released: 0.0.1 (2026-08-08), 0.0.2
> (2026-08-30, the score tempo, on-screen keyboard, import/export,
> session restore and the distribution pipeline) and 0.0.3 (2026-09-12,
> the quality-of-life round — lyrics, staff groups, the mouse-free
> context bar, playback to MIDI devices).** Plans, exit criteria,
> triage and progress notes live in [CHANGELOG.md](CHANGELOG.md).
> **Phase 9 below is the open one.** Still carried into it from earlier
> rounds: live (rather than save-time) file watching, which ships in
> the folder-view slice; splice-at-caret and overlay-as-new-layer paste
> policies; split view; MusicXML *export* (no Verovio support — needs
> another engine); and the possible Rust/WASM core rewrite, which the
> API package sits above.

## Phase 9 — Extension architecture (v0.1.0, ≈4–6 weeks in slices)

**Decision (2026-09-12): features that would weigh the editor down
become plugins; the editor becomes a host.** The 0.0.3 request stream
has two kinds of item: quality-of-life fixes that belong in the core,
and features (reference layers, OMR, more playback, more formats) that
each add weight every user carries whether or not they use it. The
0.0.3 round also showed where the weight really lands: `App.tsx` is
3,300 lines with a 33-branch key dispatcher and 81 hooks, and every
feature since 0.0.1 has grown it. Bundle weight is mostly under control
already (the piano loads on play, the Humdrum converter spawns lazily);
the host is what needs protecting.

The model is VSCode's, cut down to what a solo project can carry:

- **Contribution points** declared in a manifest — battuta already has
  declarative ones (the keymap, the format table, the status-bar
  selects, the export menu); this phase makes them the *only* way
  features attach.
- **Activation events** — a plugin's code is not loaded, let alone run,
  until something it declared happens (`onCommand:`, `onLane:`,
  `onFormat:`, `onDocument:hasFacsimile`, `onView:page`, `onPlay`).
  This is the lightweight lever: a disabled or never-triggered plugin
  costs one JSON manifest entry.
- **A narrow, versioned API** (`@battuta/api`) instead of App internals.
  Everything a plugin can see or do goes through it; plugins never
  touch the DOM, the SVG, the React tree, or `CoreScore` mutably.

*Not* adopted: a separate extension-host process, and a marketplace.
Both cost real engineering for first-party plugins and buy nothing yet.
The API is kept message-passing-friendly (serializable commands, id
and model coordinates, no callbacks that close over app state) so a
worker host and third-party loading remain a deferral, not a rewrite —
the same stance DESIGN.md takes on Rust.

### Extension points, mapped to existing seams

| Point | What a plugin contributes | Exists today as |
|---|---|---|
| `commands` | `Command` factories (apply/revert, dirty regions) reached by id | `packages/core/src/commands.ts` `Command` interface, executed via `DocumentSession.stack` |
| `keybindings` | `KeyBinding` entries with default keys per layout | `keymap.ts` `defaultKeymap()` — becomes core map ∪ plugin contributions; **ShortcutEditor and VirtualKeyboard already generate from the keymap**, so plugin actions appear in both for free |
| `lanes` | a typed text lane at the caret: grammar, suggestions, commit → command, advance rule | harmony + lyrics lanes in `App.tsx` (the "harm-lane mechanism"), generalised |
| `formats` | import/export entries with a converter worker | `formats.ts` table + `convertWorker.ts` — already a single source of truth with a pinning test |
| `overlays` | a per-tile draw hook on the interaction overlay, given the tile's bbox, id → bbox map, effective context and timemap | the caret/selection overlay; **this is the point Phases 6 and 7 need** (ghost piano roll, facsimile strips, confidence tint) |
| `header` / `docHeader` / `statusBar` / `menu` | items in the four UI slots, added at runtime or **declared in the manifest** (the host renders a declared item before the plugin's code loads; the click activates it — decided 2026-09-14 for the 🎹) | the six status-bar selects, the battuta menu, the player row (`docHeader` is where slice 7's controls go) |
| `panels` | a side/bottom panel (React node behind a slot) | none yet — first consumers: the on-screen keyboard (bottom), the folder view (side); later reference-track solo/mute, flagged-element lists |
| `playback` | a `MidiSink`-style output, or a shaping hook on `PlaybackShaping` | `midiOut.ts`, `playback.ts` — the sink talks to the host MIDI service (below), never to Web MIDI or the bridge directly |
| `documentHooks` | `onOpen` / `beforeSave` / `onExternalChange` | session restore, external-change guard in `session.ts` |
| `workspace` | `openFolder()` (native dialog), `readDir`, `openDocument(path)` — routed through the same open path as ctrl+o so imports convert and the session records it — and `watch(path)` | `open_score`/`file_mtime`/`initial_score` in `main.rs`; live watching is the still-open item from 0.0.2 (a `notify` watcher). Access is **scoped to the folder the user picked** (Tauri 2 capability scopes); the browser build reports "not available" since WebKit has no File System Access API |
| `shell` | Rust-side capability behind a JS facade | Tauri commands in `main.rs` — native-needing plugins ship as **Tauri 2 plugins** with a JS guest binding; the JS side is the contract, so the browser build gets a graceful "not available" |

### Host services, not plugins

The cut between host and plugin is: **a platform capability with a
browser backend and a shell backend, consumed by features, is a host
service; a feature is a plugin.** Host services are always present in
every build (possibly reporting "nothing available") and reachable
through `@battuta/api`:

- **MIDI devices** — inputs and outputs, hot-plug, dedupe by port
  name, the virtual "battuta" source, `panic()`; backends are Web MIDI
  in browsers and the midir bridge in the shell (exactly today's code,
  moved behind one interface). Consumers: the entry path (core), the
  playback sink (plugin), the status-bar indicator (host). Plugins may
  **register virtual inputs** — the on-screen piano is one, named
  "on-screen piano" — so any future input surface (chord pad, step
  sequencer, Bluetooth bridge) feeds the same entry path and no plugin
  ever asks whether "the MIDI plugin" is installed.
- **Workspace / files** — dialogs, read/write, mtime, watch (scoped).
- **Clipboard, settings, storage, notices/confirm, session.**
- **Rendering** — tiles, page view, timemaps (read-only to plugins).

Corollary: **no plugin-to-plugin runtime dependencies in v1.** A
manifest declares the host *capabilities* it needs (`midi`,
`workspace`, `playback`, …) and the host guarantees they exist. Shared
code between plugins is either a build-time library package or a
candidate for a new host service — never a runtime lookup of another
plugin (VSCode's `extensionDependencies` is the cautionary example).
Cost accepted: a few hundred lines of device code live in the host
permanently; they carry no assets, so the weight budget is unaffected.

### The host API (`@battuta/api`)

One package, semver'd separately from the app, `engines.battuta`
declared by every plugin, **standalone — it imports nothing from core
or the editor** (decided 2026-09-14 after the first slice-2 attempt
imported core; see the CHANGELOG). Read side: a document snapshot
(`id`, `version`, counts, title, tempo), caret and selections with a
subscribe, and a **query facade** answered by the host as data
(`pitchEventsIn(block)`, `blockOf(ids)`; tile geometry and timemaps
join it when the overlay slice needs them). Write side:
`execute(message)` — **commands as data**: a serializable message the
host maps to the real core command, the only mutation path, so undo
integrity and the byte-identical-revert property hold for plugin edits
exactly as for core ones (and a plugin cannot mutate in any way the
host has not published) — plus `notice()`, `confirm()`, a settings
namespace, a storage namespace (persisted with the session), and an
`activate(ctx)` / `deactivate()` lifecycle with disposables. No render-pool access in v1 (plugins draw on the overlay
or contribute MEI; they never engrave — DESIGN.md's rule extends to
them).

**Plugins own no document state.** Anything a plugin wants to persist
about a score goes in MEI (`<annot>`, `@facs`, an `<expansion>`) or a
declared sidecar file; anything else in its storage namespace. This is
what makes "disable all plugins" a safe operation and lets the property
fuzzer cover plugin commands unchanged.

### Migration: strangler fig, one slice at a time

Features leave `App.tsx` for `packages/plugins/*` in the order below.
The slices run **strictly one at a time**: a slice opens only when the
previous one has closed, and a slice closes only when its *Done when*
holds, the documents it owes (next section) exist, and CHANGELOG.md
carries its bullet with the `App.tsx` line count before → after
(baseline, 2026-09-12: **3,330 lines**). Each slice is written to be a
complete brief on its own: a fresh session — a person or an agent —
takes the slice text plus the previous plugin's `BUILDING.md` and
starts. Every extraction is behaviour-neutral, gated by the suites
that already cover the feature: the unit suites (`packages/core/test`,
`apps/editor/test`), the browser e2e scripts (`spikes/verify-app.mjs`,
`verify-phase2.mjs` … `verify-phase5.mjs`) and the shell smoke
(`spikes/verify-tauri.sh`), all passing unchanged. Where no committed
e2e drives a feature yet, the slice adds one *before* extracting, so
the extraction has something to be neutral against.

Two of the original eight slices are split so that every slice proves
exactly one thing: the MIDI service leaves the host skeleton (nothing
needs it before the on-screen keyboard, and a host-service extraction
should be judged on its own), and the two lanes become two slices
(lyrics defines the point, harmony confirms it and deletes the old
path). The keyboard slice split again after its first attempt (below):
a host slice, *core actions by id*, precedes the plugin — and from
slice 5 on that is the pattern: the host half of a plugin slice (the
point, the message, the query) is an in-house *a* slice that lands
first, the plugin is the *b* slice with *API may grow: none*. Every
slice carries the same six blocks plus two added on 2026-09-14:

- **API may grow.** The exact api exports the slice may add — and, for
  a host slice, the host modules. Anything not listed is not the
  slice's to add: the api's surface and the host's module list are the
  user's (`apps/editor/test/host-boundaries.test.ts` fails a new host
  module; `api-report.mjs` refuses a surface change without an approved
  version bump). *None* means none.
- **Stop when.** The condition under which the slice is left OPEN with
  the gap written into BUILDING.md §7 and the CHANGELOG, and reported.
  An open slice with a precise gap is a success; a closed slice with a
  widened contract is a failure. Stopping must be the cheapest
  compliant action.

**Who does which slice.** Host slices — the skeleton (1), the MIDI
service (3), core actions by id (4a), the `lanes` point (5a), and the
host halves built before 6–10 — are done in-house, with the user.
Plugin slices (2, 4b, 5b, 6–10) are handed to context-free sessions on
purpose, to test the briefs; a plugin slice never adds a host module or
a host service.

**Progress.** Slice 1 closed 2026-09-12, **slice 2 closed 2026-09-14**,
**slice 3 closed 2026-09-14** (their bullets in CHANGELOG.md under
0.1.0 — unreleased). **Slice 4 was attempted by a context-free agent on
2026-09-14 and rolled back**: every gate green, and a host service, an
event-forging `press()`, fourteen api exports and a new binding the
brief never named — plus the conventions file edited to admit them.
`packages/plugins/onscreen-keyboard/POSTMORTEM-2026-09-14.md` is the
account and the review; the measures it asked for are in place (the
*API may grow* / *Stop when* blocks above, the host boundary test, the
keymap snapshot, `--unpublished` withdrawn). Its e2e script survived,
restored to the in-App panel: `verify-onscreen-keyboard.mjs`, 24 checks.
**Slice 4a closed 2026-09-14** (in-house): the dispatcher is a table,
`ctx.keymap` and `ctx.actions.run(id)` / `ids` are the door.
**Slice 4b closed 2026-09-14** — after stopping first, which is the
result the slice was run to test. Its entry point was decided and built
before it: slots belong to the host, the 🎹 is a manifest-declared item in
the header slot, and the second header row has a slot of its own
(`docHeader`) for the player when slice 7 moves it. The plugin ships the
panel as a projection of the union keymap with `ctx.actions.run(id)`
behind every button, the piano as slice 3's virtual MIDI input, and the
coverage suite over the union keymap in both layouts. Built against
0.1.2 it reached 23 of its 24 e2e checks and **stopped**: the panel sees
plugin-contributed bindings in the union keymap and `run(id)` did not
carry them, so it would have had to caption a button it could not press.
It invented nothing, left the check failing, and reported three gaps
(`packages/plugins/onscreen-keyboard/BUILDING.md` §7.1–§7.3). All three
were then decided and built in-house as **api 0.1.3** — `run(id)` means
*this action*; `ctx.actions.ids` is a store; `ctx.activatedBy` and
`onSettings:<key>` exist; a runtime slot item overrides a declared one's
face (and, at 0.1.4 after review, a declared one may ask to be dimmed
until its plugin runs) — and the plugin consumed them: 24 of 24, the
union keymap snapshot
unchanged, `App.tsx` 3,248 → 3,227, the initial chunk 601.4 → 593.0 kB.
**A slice that stops with a precise gap and a slice that closes are the
same slice, one day apart; a slice that invents its way past the gap is a
rollback.**
**Slice 5 was split on 2026-09-14 into 5a and 5b**, the 4a/4b pattern:
5a (in-house) lifts the harm-lane mechanism into the host as the `lanes`
point with both lanes running on it as internal specs, and builds the
host halves 5b needs (`contributes.lanes`, `onLane:` firing,
`ctx.lanes.register` / `open`, the `core.setSyl` message,
`ctx.query.lyricAt`), after writing the lyrics e2e the plan said was
missing; 5b (a context-free agent) moves the lyrics body into
`packages/plugins/lyrics` with *API may grow: none*. Slice 6 follows the
same pattern, its two halves built in-house before it runs. **Slice 5a
closed 2026-09-14** (in-house): `host/lanes.tsx` is the point, both lanes
run on it as internal specs, `contributes.lanes` + `onLane:` + `ctx.lanes`
+ `core.setSyl` + `lyricAt` are on the api at 0.1.5, and
`verify-lyrics.mjs` (26 checks) gates the lyrics lane — written first,
it caught a hyphen-stripping bug in 0.0.3. **5b is next.**

From here on slices are
handed to sessions without the surrounding context, on purpose, to test
whether the briefs and `packages/plugins/README.md` hold on their own.
The browser e2e scripts were found rotten at slice 1's close (a lost
fixture, UI removed in 0.0.2) and repaired the same day: five scripts,
347 checks, green — run them one at a time, after
`sh spikes/fetch-fixtures.sh`; `packages/plugins/README.md` has the
commands. They gate every extraction from here on.

Slice 2 was attempted by a context-free agent on 2026-09-12 and rolled
back: the plugin worked but imported `@battuta/core`, and the rule
against it — a README sentence — was rewritten twice to fit the code
(`packages/plugins/reflection/POSTMORTEM-2026-09-12.md`). Hardened on
2026-09-14 before the second attempt: `@battuta/api` (still 0.1.0,
never published) is standalone, commands are messages, reads are a query facade, and the
boundary test fails the build on any core import. Slice 2 was rebuilt on
that footing and **closed 2026-09-14**: zero core imports, no API change
(0.1.0 unchanged — the point of the exercise), `App.tsx` 3,364 → 3,321,
all 347 e2e checks green. Its `BUILDING.md` is the worked example slice 3
onward copies; its §7 carries the new dead ends (no vitest config,
extensionless imports, the generated keyboard reference that silently
dropped the moved binding, and the bundle ledger running the other way
for a feature this small).

#### Slice 1 — Host skeleton (≈4 days)

**Delivers.** `@battuta/api` 0.1 — a new workspace package, semver'd
separately from the app, `engines.battuta` checked at registration —
with the manifest format, the registry, activation events, the keymap
as a **reactive store** (core map ∪ contributions, with a subscribe: a
panel activated late must see bindings registered later still),
`execute`, `notice`, `confirm`, the settings and storage namespaces,
the `activate(ctx)` / `deactivate()` lifecycle with disposables, and
empty `header` / `statusBar` / `menu` / `panels` slot components. A
**Plugins tab in the 🌣 editor** lists every installed plugin with an
on/off toggle persisted in `battuta.settings.v1`: off = `deactivate()`
runs and its disposables fire — bindings leave the keymap store (the
on-screen keyboard and shortcut editor follow live), panels close,
status-bar and menu items vanish — with no document change and no
reload. Keymap overrides for a disabled plugin's bindings are kept, so
re-enabling restores the user's rebinds. The toggle is the user-facing
face of the `--no-plugins` CI mode.

**Proves.** The host runs with an empty registry. Nothing user-visible
changes.

**Leaves `App.tsx`.** Keymap loading and merging; the notice and
confirm plumbing (they become host services the host itself calls).

**Gates.** Every existing suite unchanged. New in `test.yml`: an API
snapshot test (a change to `@battuta/api`'s public types fails until
the version is bumped); the **host bundle budget** on the Vite
manifest, with today's initial chunk as the ceiling that later slices
lower; the `--no-plugins` property (open → save with plugins on and
off → identical bytes) — trivially true today, load-bearing from
slice 2.

**Documents.** `packages/plugins/README.md` — the conventions and the
two templates every plugin fills in (next section); a
`reference/plugins` page in the user guide (the tab, what "off"
means; one row per plugin from slice 2 on); the DESIGN.md note gains
the layer list; the CHANGELOG bullet.

**Done when.** The editor opens, edits, undoes and saves with the
registry empty; every e2e script and the shell smoke are green; the
three new CI checks run; the plugins tab reads "no plugins installed".

#### Slice 2 — Reflection cycle (days)

**Delivers.** `packages/plugins/reflection`: the smallest
self-contained feature — one binding (`shift+R`), one message
(`core.setPitches`, already in the api), one notice. The serial-form
maths (`reflectionForm`, `REFLECTION_CYCLE`, `REFLECTION_LABELS`,
`arityPalindromic`) has no MEI knowledge and **moves out of core into
the plugin** with its tests; core keeps `SetPitchesCommand` and
`collectPitchEvents` (reached as `core.setPitches` and
`query.pitchEventsIn`). The cycle's base form and step, which `App.tsx`
holds in a ref today, become the plugin's transient state — the first
example of state a plugin may own (nothing document-shaped), keyed on
`DocumentInfo.id`. No fuzz harness leaves core: plugins define no
commands, the mapped core command is covered by core's own tests.

**Proves.** `commands` + `keybindings`, and the whole plugin lifecycle
end to end: manifest → activation on `onCommand:` → binding in the
store → shortcut editor and on-screen keyboard showing it → toggle off
removes it live.

**Leaves `App.tsx`.** The `reflect` branch of the key dispatcher and
the `reflectCycle` ref.

**Gates.** `packages/core/test/reflect.test.ts` keeps the
`SetPitchesCommand` and `collectPitchEvents` cases, the form tests move
with the maths into the plugin's suite; the reflection checks in
`verify-phase5.mjs`; the boundary test scans the new package; the
`--no-plugins` property now has a plugin to be off.

**Documents.** The plugin's `README.md` and `BUILDING.md` — the worked
example every later plugin copies (the two precedents are already
decided and enforced: `exports` at `src/`, no core import — the
boundary test in `apps/editor/test/plugin-boundaries.test.ts` is the
rule). Read `packages/plugins/reflection/POSTMORTEM-2026-09-12.md` §7
first: the first attempt's dead ends, including the one that cannot
be seen from the API (a plugin cannot observe its own `execute`
synchronously — subscribe to `ctx.document`). A **Writing a plugin**
guide in the docs site walks through this plugin.

**Done when.** `shift+R` on a block behaves byte-identically to 0.0.3
with the plugin on; with it off the key does nothing, the shortcut
editor and the on-screen keyboard no longer show it, and the document
is unchanged.

#### Slice 3 — MIDI service, a host service (≈2 days)

**Delivers.** The device code lifted out of `App.tsx` and `midiOut.ts`
behind one interface on `@battuta/api`: inputs and outputs, hot-plug,
dedupe by port name, the virtual "battuta" source, `panic()`, and
`registerInput()` for virtual inputs. Backends unchanged: Web MIDI in
browsers, the midir bridge in the shell (the shell's MIDI commands
become the service's shell backend). No plugin.

**Proves.** The host-service cut: a platform capability with two
backends, consumed by features, lives in the host. Consumers after this
slice: the entry path and the status-bar indicator (host), the play
sink (still in `App.tsx` until slice 7).

**Leaves `App.tsx`.** Web MIDI access, device listing, the shell
bridge listeners.

**Gates.** `apps/editor/test/midiOut.test.ts`; `verify-phase4.mjs`
(the Web MIDI entry path) and `verify-phase5.mjs` (the MIDI
indicator); `verify-tauri.sh` (bridge devices and notes).

**Documents.** DESIGN.md's host-services list; the api surface grows
`MidiService` (still 0.1.0 — never published; the report is rewritten
with `--unpublished`); the CHANGELOG bullet.

**Done when.** Hardware entry, the status-bar indicator and the shell
bridge behave as in 0.0.3, and `App.tsx` no longer imports Web MIDI or
the bridge.

#### Slice 4a — Core actions by id (host, in-house; ≈3 days)

**Delivers.** The App's key dispatcher becomes a table `actionId →
handler`. Every keymap action already has an id; every locked physical
and system key gets one (`nav.left`, `nav.home`, `edit.delete`,
`edit.backspace`, `edit.escape`, `file.save`, `file.open`, `undo`,
`redo`, `clipboard.copy`, `clipboard.paste`, `zoom.in`, `duration.4`,
`pitch.c`, `chord.e`, `finger.3`, `volta.2`, `measure.insert`, …), so
the keymap maps keys to actions the way VSCode maps keybindings to
commands. `keyMatches` selects the id; the table runs it. Plugin
commands already run by id (`runCommand`); this gives core actions the
same door. The api grows two published, finite things: `ctx.keymap`
(read-only store: id, label, group, when, keys, locked, plugin) and
`ctx.actions.run(id)`. No `press()`, nothing that forges events — an
input surface that runs ids cannot do anything the host has not named.

**Proves.** That the on-screen keyboard needs no pass-through, and that
the phase's metric can move for real: the dispatcher's matching leaves
`App.tsx` for the host; the branch bodies follow in later slices.

**Leaves `App.tsx`.** The `hit(id) && …` matching chain (the bodies
become table entries; the table lives in the host).

**API may grow.** `ctx.keymap`, `ctx.actions.run(id)`; host module
`actions.ts` (added to `HOST_MODULES`). Nothing else. *(As built:
`ctx.actions.ids()` was added too, so a projection can check its buttons
against the live list; recorded in the CHANGELOG.)*

**Stop when.** An action cannot be given an id without changing what a
key does. (None is expected; the locked groups are finite.)

**Gates.** Every e2e script unchanged, including
`verify-onscreen-keyboard.mjs` (24 checks, against the in-App panel);
the union keymap snapshot byte-identical; host tests for the table (every
keymap id and every locked key has a handler; `run(id)` takes the same
path as the key).

**Documents.** CHANGELOG bullet; DESIGN.md note (keys bind actions);
the conventions' data-contract table gains the two rows.

**Done when.** Every key the App handles goes through the table, and
`ctx.actions.run(id)` runs the same code as the key would.

**Closed 2026-09-14.** Both hold; all six e2e scripts and the shell
smoke green, the keymap snapshot unchanged. `App.tsx` 3,274 → 3,241.
The CHANGELOG bullet has the vocabulary and the one addition beyond the
brief (`ids()`).

#### Slice 4b — On-screen keyboard (plugin; ≈1 week)

**Delivers.** `packages/plugins/onscreen-keyboard`: the panel
(`VirtualKeyboard.tsx`, `virtualKeys.ts`) as a `panels` consumer, a
projection of `ctx.keymap`: buttons run `ctx.actions.run(id)`, latched
modifiers select the *variant* id (`MOD_VARIANTS` already maps base →
variant), ctrl chords are ids, and the piano is the virtual MIDI input
slice 3 registered (`ctx.midi.registerInput("on-screen piano")`). Its
coverage test moves into the plugin's suite and runs against the union
keymap, so an unreachable binding from *any* plugin fails CI. Opens on
`onPointer:coarse` (the host fires it) and from the 🎹 toggle.

**Proves.** `panels`, `header`, activation on a pointer event, the two
doors from 4a and 3 — and that a UI plugin needs no service.

**Leaves `App.tsx`.** The keyboard's mount, the `vkeys` setting (moved
once into the plugin's namespace by a dated list in `settings.ts`), the
coarse-pointer default, the 🎹 button.

**API may grow.** **None from the plugin.** The entry point is decided
and built (2026-09-14, in-house): the 🎹 is a manifest-declared slot
item in the `header` slot — `contributes.slotItems: [{ id, slot:
"header", label: "🎹", command }]` — which the host renders before the
plugin's code loads; the click runs the command, which activates the
plugin. No keyboard service, no new binding (the union keymap snapshot
must not change), no new host module. The panel opens on
`onPointer:coarse` — which the HOST fires at startup on a coarse pointer
— and from the toggle; whether it is open is the plugin's own setting.
*Amended 2026-09-14, in-house, after the plugin stopped on three gaps
(its BUILDING.md §7.1–7.4), api 0.1.2 → 0.1.3:* `ctx.actions.run(id)`
reaches an enabled plugin's command when no core rule has the id, past
the same gates its key would meet, and `ctx.actions.ids` is a
`Store<readonly string[]>` (core rules ∪ enabled plugins' commands,
republished on every install and every on/off); `ctx.activatedBy` names
the event that woke the plugin (`onStartup`, `onPointer:coarse`,
`onCommand:<id>`, `onSettings:<key>`, or null from the Plugins tab);
`onSettings:<key>` is a new activation event the host fires at startup
for a plugin whose OWN setting under `<key>` is truthy; and a runtime
`ctx.slots.add` item with the same `id` as a declared slot item replaces
its face while the plugin is active (the declared face returns on
deactivate), so the 🎹 can be a real toggle that shows its state. Each
was decided here, not in the slice, and each names its consumer.
*Amended again after review, api 0.1.3 → 0.1.4:* a declared slot item may
carry `dimUntilActive`, drawn de-emphasised until its plugin is active —
per item, because "not active" means "not showing" only for an entry
point that opens something.

**Stop when.** The panel needs any capability beyond `ctx.keymap`,
`ctx.actions.run` / `ids`, `ctx.midi.registerInput`, `ctx.panels`,
`ctx.settings`, `ctx.editor` and the declared slot item. Write the gap;
do not resolve it.

**Gates.** The coverage suite over the union keymap;
`verify-onscreen-keyboard.mjs` with only its two design-dependent hooks
changed (the toggle's selector, the open flag's location) — every
assertion identical; the keymap snapshot unchanged; the boundary tests;
`verify-phase4.mjs` and `verify-phase5.mjs` unchanged.

**Documents.** The plugin's two documents (its BUILDING.md §7 starts
from `onscreen-keyboard/POSTMORTEM-2026-09-14.md`'s traps); the guide's
virtual-keyboard page unchanged in content plus its plugins-page row;
the CHANGELOG bullet.

**Done when.** Every coverage test passes against the union keymap;
turning the plugin off removes the panel and the 🎹 live; touch entry is
byte-identical to 0.0.3.

#### Slice 5a — The `lanes` point (host, in-house; ≈2 days)

**Delivers.** The harm-lane mechanism becomes a host module, `lanes.ts`
(added to `HOST_MODULES`), with both existing lanes running on it as
INTERNAL specs and their bodies still in `App.tsx` — the 4a move,
applied to lanes. What the mechanism is, read off the two modals: a
buffer at the caret, (re)loaded from the document when the caret or the
version moves; one modal step that owns the keyboard while a lane is
open — Escape commits and leaves, the lane's *advance keys* commit and
move the caret on (to the next event, or to the next NOTE with rests
skipped), arrows commit and step, Backspace edits, Tab takes the first
suggestion when the lane suggests, a printable character is admitted by
the lane's charset and mapped by its transform (`o` → `°` in numerals) —
and a commit that turns the buffer into ONE command, refusing with a
notice when the lane says the text is incomplete or the caret is not on
what the lane attaches to. A `LaneSpec` is exactly those fields: `id`,
`label`, `place: "above" | "below"`, `attachesTo: "note" | "event"`,
`advance: "event" | "note"`, `advanceOn: string[]`, optional
`accepts(ch)`, `transform(ch)`, `complete(buffer)`, `suggest(buffer)`,
and `read(eventId)` / `commit({ eventId, buffer, key, prevEventId })` —
the last returning a `CommandMessage` (or null for "nothing changed") and
throwing a string to refuse. The floating editor (`data-harm-input`,
`data-valid`, the ♪ / ♩ / RN prefix, the suggestions) becomes a host
component fed from the lane store; the status-bar select lists the
internal lanes and every lane DECLARED in a manifest (`contributes.lanes:
[{ id, label, place }]`) — the slot-item lesson applied: the entry point
renders before the plugin's code loads, and picking a declared lane
whose plugin is not active fires `onLane:<id>` (the prefix has existed
since slice 1, unfired), waits for the plugin to register the spec, then
opens it. `ctx.lanes.register(spec)` (the id must be declared, as
`registerCommand` demands a declared command) and `ctx.lanes.open(id)`
(for a plugin's own key) are the door. In-house too, the host halves 5b
will need and could not add: the `core.setSyl` message (`{ eventId,
value: SylValue, label }` → `SetSylCommand`) and
`ctx.query.lyricAt(eventId)`. Slice 6's halves (`core.setHarm`,
`harmAt`) wait for slice 6.

Before any of it: a lyrics e2e, `spikes/verify-lyrics.mjs`, written
against the App as it is — `l` at a note opens the lane below the
staff; "hel" then `-` writes `<syl wordpos="i" con="d">` and advances to
the next NOTE over a rest; "lo" then space writes `wordpos="t"`; a whole
word writes neither; an empty commit on a rest is allowed and on a note
clears; Escape commits and leaves; the buffer reloads when the caret
returns to a note that has a syllable; undo unwinds every step and the
MEI is byte-identical; save and re-parse. Green first, then the
extraction keeps it green.

**Proves.** `lanes` by extraction with two consumers already on it, so
5b and 6 find the shape and move bodies — and that a text lane needs
the host to know nothing about the text: no grammar, no MEI shape, no
`HarmKind` in `lanes.ts`.

**Leaves `App.tsx`.** The two modals' key protocol, the `harmLane` /
`harmBuffer` state with its ref and its reload effect, the floating
editor, the select's option list. Stays for now: `commitSyl`'s value
logic and the harmony grammar calls, as the two internal specs.

**API may grow.** `LaneContribution` (`contributes.lanes`, validated:
ids unique across plugins, `place` one of two), `LaneSpec` and
`LaneCommit`, `ctx.lanes: { register, open }`, `onLane:<id>` fired;
`SetSylMessage` + `SylValue`; `DocumentQueries.lyricAt`; host module
`lanes.ts`. Consumers named: every one is 5b's, except the `chord` /
`rna` internal specs, which are slice 6's rehearsal. Nothing else: no
`ctx.lanes.active` store (no consumer), no navigation query (the host
hands `commit` the previous event of the lane's kind), no `when`
evaluation for plugin bindings (a handler declines on `ctx.editor`
state — the slice-2 convention). api 0.1.4 → 0.1.5.

**Stop when.** A lane needs the host to know what KIND of text it holds
— a grammar, a validator or an MEI shape in `lanes.ts` is the harmony
lane not leaving. (A spec field only one lane uses is expected and is
not this: `accepts` / `transform` / `suggest` are harmony's, `advance:
"note"` and `-` are lyrics'.)

**Gates.** `verify-lyrics.mjs` green before and after, assertions
unchanged; `verify-phase5.mjs` §7i unchanged (`data-harm-input`,
`data-valid` and the select's option values `chord` / `rna` / `lyrics`
keep their names — they are the internal ids); every other e2e script;
host tests for `lanes.ts` on a fake adapter (register demands a
declaration; every key of the protocol; advance over a rest for
`"note"`; a refusal is a notice and no command; `onLane:` fires for a
declared lane and the lane opens once registered; a declared lane
leaves the select when its plugin is off); the union keymap snapshot
byte-identical (no binding moves); the boundary tests with `lanes.ts`
allowed; the budget.

**Documents.** CHANGELOG bullet with the point's final field list and
why each field exists; DESIGN.md note; the conventions' data-contract
rows (`contributes.lanes`, `ctx.lanes.register` / `open`, `core.setSyl`,
`ctx.query.lyricAt`, `onLane:`); the api doc comments.

**Done when.** Both lanes run through `host.lanes` with their bodies in
`App.tsx`, every harmony and lyrics check green, `App.tsx` down by the
mechanism.

**Closed 2026-09-14.** Both hold; all six e2e scripts green, the keymap
snapshot unchanged, `App.tsx` 3,227 → 3,145, api 0.1.5. *As built,
beyond the brief:* the spec carries `name`, `glyph` and `hint` (the UI
strings the two lanes kept in three places), `commit` returns `{ refuse }`
rather than throwing, and the internal lyrics spec already commits
through `core.setSyl`. The lyrics e2e found and the slice fixed one 0.0.3
bug (Escape over a hyphenated syllable dropped its hyphen). The CHANGELOG
bullet has the field-by-field account.

#### Slice 5b — Lyrics lane (plugin; ≈2 days)

**Delivers.** `packages/plugins/lyrics`: a manifest declaring one lane
(`{ id: "battuta.lyrics.verse1", label: "lyrics (verse 1, l)", name:
"lyrics", glyph: "♪", place: "below" }`), one command
(`battuta.lyrics.open`) and its keybinding (`l`, group `entry`, the
existing label), activating on `onLane:battuta.lyrics.verse1` and
`onCommand:battuta.lyrics.open`; `activate` registers the spec —
`attachesTo: "note"`, `advance: "note"`, `advanceOn: [" ", "Enter",
"-"]`, `read` = `ctx.query.lyricAt(eventId)?.text ?? ""`, `commit` =
today's `commitSyl` as a pure function: unchanged text and hyphen state
→ null; `-` → `con: "d"` with `wordpos` `m` when the previous note's
syllable continues (`lyricAt(prevEventId)?.con === "d"`), else `i`; a
plain commit after a continuing syllable → `wordpos: "t"`; otherwise a
whole word; `""` clears — returned as `{ type: "core.setSyl", eventId,
value }` (the command labels itself); unchanged text keeps its
hyphenation (5a's fix — `hyphen = key === "-" ? true : textChanged ?
false : wasHyphen`). The command handler is `ctx.lanes.open(…)`, declining
when `ctx.editor.get().entryMode` (in 0.0.3 `l` does nothing in entry
mode; the select still opens the lane from entry mode because the HOST
leaves entry mode first — do not copy that into the key). The internal
lyrics spec and `commitSyl` leave `App.tsx`; the `lyrics` entry leaves
`keymap.ts` as `reflect` did in slice 2.

**Proves.** The point holds for a plugin with no access to the model:
the wordpos/con table — the only logic lyrics has — is computed from two
`lyricAt` answers and the key that committed.

**Leaves `App.tsx`.** The lyrics spec, `commitSyl`, the `lyrics` rule
and its notice text; the `lyrics` binding from `keymap.ts`.

**API may grow.** **None.** Everything is in 5a.

**Stop when.** The lane needs anything beyond `ctx.lanes.register` /
`open`, `core.setSyl`, `ctx.query.lyricAt`, `ctx.editor`, `ctx.notice`,
the declared lane and the keybinding. Write the gap in BUILDING.md §7
and the CHANGELOG; do not resolve it. (5a's spec fields exist because
two lanes ran on them; a third state of a field is a gap, not a tweak.)

**Gates.** `verify-lyrics.mjs` with only its design-dependent hooks
changed (the select option's value, if the lane id replaces `lyrics`) —
every assertion identical; `verify-phase5.mjs` unchanged; the union
keymap snapshot changes by exactly one entry — `lyrics` (core) leaves,
`battuta.lyrics.open` (plugin, `l`) arrives: regenerate with `npm run
keymap:snapshot -w @battuta/editor` and put the diff in the CHANGELOG
bullet; the boundary tests; the plugin's suite (the wordpos/con table as
pure tests over `lyricAt` fakes, the refusal on a rest, `l` declining in
entry mode); `packages/core/test/lyrics.test.ts` unchanged.

**Documents.** The plugin's two documents (BUILDING.md §7 starts from
`onscreen-keyboard/BUILDING.md` §7's traps); the guide's harmony page:
lyrics section unchanged in content, `<KeymapTable ids={["lyrics"]} />`
following the binding to its new id — the reflection plugin's
BUILDING.md §7 records the generated reference silently losing a moved
binding; the plugins-page row; the CHANGELOG bullet.

**Done when.** Typing lyrics is byte-identical to 0.0.3 through the
point; turning the plugin off removes the `l` key, the select's option
and the lane together; `App.tsx` has no lyrics code.

#### Slice 6 — Harmony lane (≈2 days)

**Delivers.** `packages/plugins/harmony` on 5a's `lanes` point: two
declared lanes (chord symbols above, Roman numerals below), the closed
grammars, charsets and suggestions moved from core's `harm.ts` into the
plugin as the specs' `accepts` / `transform` / `complete` / `suggest`,
`SetHarmCommand` reached as the `core.setHarm` message; the two internal
harmony specs and the last of the lane code deleted from `App.tsx`.

**Proves.** The rule of three, near enough: a third consumer confirms
the point's shape. Whatever harmony needs that the internal spec did not
is the point's last change before it is frozen for the phase.

**Leaves `App.tsx`.** The two internal harmony specs — the last lane
code.

**API may grow.** The `core.setHarm` message and
`ctx.query.harmAt(eventId, kind)`, built in-house BEFORE the slice as 5a
did for lyrics, so the plugin's own is **None**. The spec fields harmony
uses are already in the point: 5a ran the internal `chord` / `rna` specs
on it.

**Stop when.** The harmony lane needs a spec field or a query the
internal spec did not — 5a's rehearsal missed it. Write the gap; do not
resolve it.

**Gates.** `packages/core/test/harm.test.ts`; the harmony checks in
`verify-phase5.mjs`.

**Documents.** The plugin's two documents; the CHANGELOG bullet
recording the point's final shape and the `App.tsx` count now that the
mechanism is gone.

**Done when.** Both lanes run on the shared point, and `App.tsx` has no
lane code left.

#### Slice 7 — Playback (≈1 week)

**Delivers.** `packages/plugins/playback`: the player row (`player.ts`,
Tone.js, the sampled piano), the MIDI checkbox and transpose with the
sink that talks to the MIDI service, and the playback-MIDI export
(`midiExport.ts`) as a `formats` export entry. Activation on `onPlay` /
`onView:page`. The timemap stays a host render service, read-only.

**Proves.** `playback`, the export half of `formats`, and the bundle
budget for real: Tone.js and the 2 MB piano leave the host chunk and
the ceiling set in slice 1 is lowered to match.

**Leaves `App.tsx`.** The transport, the highlight scheduling, the
MIDI-out wiring, the player row.

**Gates.** `apps/editor/test/midiExport.test.ts` and `midiOut.test.ts`;
`packages/core/test/playback.test.ts` and `expansion.test.ts`; the
playback checks in `verify-phase5.mjs` (timings unchanged);
`verify-tauri.sh`.

**Documents.** The plugin's two documents; the guide's playback page
unchanged plus its plugins row; the CHANGELOG bullet with the new
budget figure.

**Done when.** Play, MIDI out, transpose and the export behave
byte-identically to 0.0.3; the initial chunk no longer contains Tone.js
or the samples; the budget check enforces the new ceiling.

#### Slice 8 — Format converters (days)

**Delivers.** `packages/plugins/formats`: the import table, the
converter worker and the Humdrum-enabled Verovio build, declared
through `formats`. The table stays the single source of truth and its
pinning test moves with it.

**Proves.** `formats` fully (import and export), and the second budget
drop: the 4.6 MB Humdrum build leaves the host.

**Leaves `App.tsx`.** Import detection on open, the export menu
entries.

**Gates.** `apps/editor/test/convert.test.ts` (the pinning test, with
its `.mxl` fixture); the save and export checks in `verify-phase3.mjs`.

**Documents.** The plugin's two documents; the guide's files page
unchanged plus its plugins row; the CHANGELOG bullet with the budget
figure.

**Done when.** Every import and export format works as in 0.0.3 with
the plugin on, and with it off the open dialog lists `.mei` only.

#### Slice 9 — Folder view (≈1 week)

**Delivers.** `packages/plugins/folder-view` — a NEW feature rather
than an extraction, chosen to prove the `workspace` point and the
`shell` pattern: a side panel listing the opened folder's scores (every
importable extension from the format table, dirty markers from the
tabs), click opens through the shared open path, live `watch` refreshes
the tree and feeds the external-change guard. Second `panels` consumer.
Browser build: the panel is present but reports the shell is required.
Persists the opened folder in the session.

**Proves.** `workspace` (`openFolder`, `readDir`, `openDocument`,
`watch`, scoped to the folder the user picked), the `shell` pattern
(a Tauri 2 plugin behind a JS facade that degrades gracefully in the
browser), and `documentHooks` for the watcher. Closes live file
watching, open since 0.0.2.

**Leaves `App.tsx`.** Nothing — this slice adds, and measures that the
host did not grow.

**Gates.** A new e2e path (open folder → click → edit → external change
→ guard); `verify-tauri.sh` gains the watcher.

**Documents.** The plugin's two documents; a NEW guide page (folder
view, live watching) and the limits page's rows retired; the CHANGELOG
bullet.

**Done when.** The panel works end to end in the shell; the browser
build shows its "shell required" notice; an external edit to an open
score is noticed the moment it happens.

#### Slice 10 — Reference layers on the overlay point (≈2 weeks)

**Delivers.** The `overlays` point — a per-tile draw hook on the
interaction overlay given the tile's bbox, id → bbox map, effective
context and timemap — built against its first consumer:
`packages/plugins/reference-layers`, the **ghost piano-roll reference
layer (old Phase 6)** to the spec below: MIDI and sound2midi-sidecar
import as reference tracks, per-tile timemap extraction, translucent
bars aligned to the tile's clef-based pitch axis, per-track solo, mute
and colour in a panel, selection playback against the reference grid.

**Proves.** `overlays`, and the phase's central claim: a research
feature implemented **entirely as a plugin** — zero edits to `App.tsx`
or the core beyond the API package.

**Leaves `App.tsx`.** Nothing; the exit criterion is that it did not
have to.

**Gates.** The plugin's suite (import, alignment, pitch mapping);
Phase 6's exit criterion as an e2e path: load a stems MIDI behind its
exported MEI, spot a transcription error, fix it, hear the corrected
measure.

**Documents.** The plugin's two documents; a NEW guide page; Phase 7
(OMR) re-planned as the second overlay plugin, citing API surface only;
DESIGN.md's *Host and plugins* section written from the notes
accumulated slice by slice; `@battuta/api` promoted to 1.0.

**Done when.** Phase 9's exit criteria hold.

Extraction rule: an extension point is added only when a feature being
extracted needs it (rule of three where possible — lyrics *and* harmony
justify `lanes`; the keyboard and the folder view justify `panels`; a
single consumer justifies `overlays` only because it is the phase's
exit criterion). No speculative points.

### Documentation: every slice, every plugin

Code does not close a slice; its documents do. Three per slice, two
more travelling with every plugin.

**Per slice.**

- A CHANGELOG.md bullet under the unreleased 0.1.0 heading: the
  decisions taken, what left `App.tsx` (line count before → after),
  the `@battuta/api` version and any breaking change to it, and the
  dead ends — a rejected approach with its reason is a decision too.
- DESIGN.md: the feature's note updated from "becomes a plugin" to how
  it is one, a sentence or two. The full *Host and plugins* section is
  written once, at the phase exit, from those notes.
- The user guide: behaviour-neutral extractions change no prose; the
  `reference/plugins` page gains the plugin's row (what turning it off
  removes). A NEW feature gets its guide page as today.

**Per plugin: two documents in the package, both mandatory.**

`packages/plugins/<name>/README.md` — *how to use it*. What it does,
in a paragraph; how to turn it on and off; its bindings as a pointer to
the generated keyboard reference, never a retyped table; its settings
and storage keys; what it deliberately does not do; a link to its guide
page.

`packages/plugins/<name>/BUILDING.md` — *how it was built*, written for
the next person or agent writing a plugin, with FIXED headings so two
plugins can be read side by side:

1. **Origin** — what the code was before extraction (files, the
   `App.tsx` branches and hooks it replaced) and the line count it
   removed; for a new feature, the spec it was built to.
2. **Manifest** — every contribution point and activation event
   declared, each with its one-line reason, and what was deliberately
   NOT declared.
3. **API surface** — every `@battuta/api` call used, grouped read /
   write / lifecycle; anything the API had to grow for this plugin and
   the version that carried it.
4. **State** — what is transient (memory), what is persisted (the
   storage namespace), what is document (MEI or sidecar), and the
   confirmation that nothing mutates outside `execute`.
5. **Command messages** — each message the plugin sends, when, and the
   core command the host maps it to (plugins define no commands).
6. **Tests** — the suites, what each pins, how to run them; which e2e
   scripts gated the extraction.
7. **Dead ends** — what was tried and dropped, with the reason. The
   most valuable section: it is what keeps the next plugin from
   repeating the experiment.
8. **Recipe** — the shortest path to a plugin like this one: the files
   to copy, the names to change, the order to do it in.

Slice 1 writes the templates into `packages/plugins/README.md`; slice 2
fills them in for real, and the "Writing a plugin" guide walks through
that plugin rather than describing the API in the abstract; every
later slice copies from the previous plugin's documents, never from the
template alone. From slice 2 the docs drift check fails a
`BUILDING.md` missing any of the eight headings.

### Lightness, enforced in CI

- **Host bundle budget**: the initial chunk (host + core + Verovio
  render worker) stays under a fixed byte size; plugin code appears in
  the initial chunk → CI fails (Vite manifest check). *Slice 1 sets the
  ceiling at today's size; slices 7 and 8 lower it.*
- **Time to first tile** on the reference laptop stays within the
  1 s first-screen budget with all plugins installed but unactivated.
  *Measured at every slice close, logged in the slice's bullet.*
- **`--no-plugins` mode**: the editor opens, edits, undoes and saves
  with every plugin disabled; a plugin's absence never changes the
  document (property: open → save with plugins on and off → identical
  bytes). *Slice 1; load-bearing from slice 2.*
- **Coverage tests extend to contributions**: a plugin keybinding the
  VirtualKeyboard cannot reach fails CI, as core bindings do today; a
  plugin edit is a message mapped to a core command, so the
  apply-then-revert fuzzer in core covers it without any harness leaving
  core (plugins define no commands). *The union-keymap coverage lands in
  slice 4.*
- **API surface is versioned and diffed**: a change to `@battuta/api`'s
  public types requires a version bump (api-extractor or an equivalent
  snapshot test). *Slice 1.*

### Exit criteria

1. The slices above shipped, one at a time, each closed by its
   documents; `App.tsx` holds only the host
   (tiles, caret, selection, command execution, slots) — target under
   1,000 lines. Live file watching, open since 0.0.2, ships inside the
   folder-view slice.
2. Reference layers (old Phase 6) implemented **entirely as a plugin**:
   zero edits to `App.tsx` or the core beyond the API package. Phase 7
   (OMR) is re-planned as the second overlay plugin and its plan cites
   only API surface.
3. Every existing e2e suite green, byte-identical undo across all
   command messages, the CI budgets above in place.
4. Docs: a "writing a plugin" guide with the reflection plugin as the
   worked example; every plugin's `README.md` (how to use it) and
   `BUILDING.md` (how it was built, under the fixed headings) in
   place and checked by the docs drift check; DESIGN.md gains a *Host
   and plugins* section (layers become: core → command → **host** →
   plugins; render and interaction layers are host services), written
   from the notes added slice by slice.

### Risks

- **Over-abstracting early.** Mitigated by extraction-only points and
  the rule of three.
- **React coupling.** Plugins wanting UI need slots, not the tree.
  Provide slot components that take a React node, and a small
  subscription store for caret/selection so plugins subscribe without
  prop-drilling; if plugin UI outgrows slots, that is the moment to
  evaluate a panel host, not before.
- **Undo integrity.** Plugins that mutate outside `execute` would break
  the phase's central invariant. Made structural on 2026-09-14: the API
  exposes no model object at all (snapshots and a query facade), and a
  plugin package cannot import core — the boundary test fails the build.
- **Third-party code.** Deferred. If it comes: load from disk via the
  shell only, run in a worker with the message-passing API, AGPL
  implications for bundled third-party code documented first.
- **API churn while the first plugins land.** Keep `@battuta/api` at
  0.x with explicit breaking-change notes in CHANGELOG.md until the
  overlay point is stable; promote to 1.0 at the Phase 9 exit.

### Folds into this phase

Phase 6 (reference layers) becomes the overlay-point extraction above
(slice 10). Phase 7 (OMR) follows as the second overlay plugin in a
later point release. The Rust/WASM core rewrite is unaffected: the API
package sits above the core interface, so a swapped core changes
nothing for plugins.

## Phase 6 — Reference layers for transcription (folded into Phase 9)

**Folded into Phase 9 (2026-09-12):** this ships as the overlay-point
slice — a plugin, with "implemented entirely as a plugin" as Phase 9's
own exit criterion. The plan below is the feature spec it builds to.

Import MIDI (and a JSON sidecar format emitted by sound2midi) as reference tracks. Per-tile timemap extraction, ghost piano-roll rendering on the overlay aligned to the tile's clef-based pitch axis, per-track solo/mute/color, beat-aligned by default with an optional section offset map. Add selection playback via timemap → Tone.js so an edit can be auditioned instantly against the reference audio grid.

Exit criteria: load a stems MIDI behind its exported MEI, visually spot a transcription error from the ghost layer, fix it with the editor, and hear the corrected measure.

## Phase 7 — OMR correction mode (folded into Phase 9)

**Folded into Phase 9 (2026-09-12):** the second overlay plugin, in a
point release after the phase lands; its plan is expected to cite only
API surface. The plan below is the feature spec it builds to.

Facsimile support: parse `<facsimile>`/`<zone>` (and a sidecar JSON alternative for pipelines that don't emit MEI zones), display the source-image strip above each tile, click-through between scan region and notation. Confidence sidecar ingestion, heat tinting, and next-flagged-element navigation. Annotation write-back for corrections so the pipeline can harvest training data.

Exit criteria: correct a real OMR output measure-by-measure using scan strips and flag navigation, measurably faster than doing it in mei-friend.

## Cross-cutting practices

Testing leans on properties, not just examples: every command must satisfy apply-then-revert identity; every paste must satisfy the duration invariant; every save must satisfy round-trip stability on the corpus. Performance numbers (tile render p50/p95, edit latency) are logged in dev builds from Phase 1 so regressions are visible immediately. MEI corpus files live in the repo under `fixtures/` and grow every time a real-world file breaks something. Verovio is pinned per release and upgraded deliberately, with the corpus suite as the gate.

## Deliberately deferred

Figured bass editing (lyrics un-deferred and shipped in 0.0.3: one
verse of syllables; multi-verse and melisma extenders still deferred);
percussion-map editing UI; part extraction and transposed part views; engraving option panels beyond a small curated set; THIRD-PARTY plugins
and a marketplace (the first-party plugin architecture is Phase 9, which
keeps its API message-passing-friendly so third-party loading stays a
deferral rather than a rewrite); collaborative editing; any form of custom notation drawing (permanently out, per DESIGN.md).
