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
| `formats` | exports (`contributes.exports` + `registerExport`, since 7a) and imports (`contributes.imports` — extensions, text-or-bytes, root elements for a shared `.xml` — + `registerImport`, since 8a): the menu row and the open dialog's accept list exist before the plugin loads, `onFormat:<id>` wakes it, detection is the host's | `host/formats.ts` (the registry); the App's Verovio converters as internal registrations until 8b moves them, with `formats.ts`' table and its pinning test |
| `overlays` | a per-tile draw hook on the interaction overlay, given the tile's bbox, id → bbox map, effective context and timemap | the caret/selection overlay; **this is the point Phases 6 and 7 need** (ghost piano roll, facsimile strips, confidence tint) |
| `header` / `docHeader` / `statusBar` / `menu` | items in the four UI slots, added at runtime or **declared in the manifest** (the host renders a declared item before the plugin's code loads; the click activates it — decided 2026-09-14 for the 🎹) | the six status-bar selects, the battuta menu, the player row (`docHeader` is where slice 7's controls go) |
| `panels` | a side/bottom panel (React node behind a slot). The side area is on the LEFT, below the header, and pushes the score right while a panel is up (decided 2026-09-16 with the first side consumer) | the on-screen keyboard (bottom, 4b), the folder view (side, 9b); later reference-track solo/mute, flagged-element lists |
| `playback` | nothing to contribute: a player is a plugin that SCHEDULES — it reads the timemap and the notation facts, decides the performance (ties, gates, clones, speed — there can be several players), and plays it with its own instrument on the host's audio context, or on the host's MIDI out (below) | `player.ts`, `midiExport.ts`; the performance logic in `core/playback.ts` (which leaves core for the player: decided 2026-09-15) |
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
- **Audio context** — the one Web Audio context of the app behind
  `ctx.audio`: `unlock()` (created and resumed inside a user gesture —
  the autoplay policy binds it to the click), `context()` (the shared
  `AudioContext`, to connect a synth or sampler to) and `timeAt(ms)`
  (wall clock → audio clock, so attacks scheduled from timers land
  sample-accurately). The host owns the CONTEXT, not an instrument: a
  plugin brings its own synth or sampler (the playback plugin brings
  Tone.js and the Salamander subset, lazily, in its own chunk). Web Audio
  in browsers and the shell's WebKit alike. Consumers: the playback
  plugin; later a metronome, a note preview on entry, a reference-track
  player — each on the same context, none fighting for the autoplay
  unlock. Decided 2026-09-15: the context is a platform capability, so it
  is a service; the instrument and HOW a score is performed are not, so
  they are the plugin's.
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
imported core; see the CHANGELOG) — refined 2026-09-15: core owns the
document's data types (caret, block, pitch, syllable, harmony kind) and
`document.ts` re-exports exactly those, type-only; nothing else of core
reaches the api or a plugin, each type is declared once, the surface
report prints the shapes it re-exports, and the api's build is a project
reference to core. Read side: a document snapshot
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
service (3), core actions by id (4a), the `lanes` point (5a), the
playback services (7a), and the host halves built before 6–10 — are done
in-house, with the user.
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
it caught a hyphen-stripping bug in 0.0.3. **Slice 5b closed
2026-09-14**: `packages/plugins/lyrics` declares the lane, registers a
spec that leaves harmony's four grammar fields unset, holds no state at
all, and needed **no api addition and no host change** — the first slice
of the phase to hit no gap, because 5a's additions each named 5b as
their consumer and the list was right. The e2e's assertions and both its
design hooks are unchanged; the union keymap snapshot changes by exactly
one entry, the `l` binding moving from core to the plugin. **A point
designed against two consumers before either leaves costs a plugin slice
a day instead of a rollback.** **Slice 6's host half landed 2026-09-14**
(api 0.1.6: `core.setHarm`, `harmAt`, `harmValid`; the status bar's
anchoring rule, the lanes select as its boundary, the `.sbsel` look as a
class — the CHANGELOG bullet has the account), and the grammar split is
decided in its brief: validity stays in core and is asked through
`harmValid`, the editor affordances move into the plugin. **Slice 6 closed
2026-09-15**: `packages/plugins/harmony` declares both lanes and
registers them as one function of `kind`, and the `lanes` point took
**no change at all** for its second consumer — not a field, not a query.
Between 5b and 6 every `LaneSpec` field has a consumer and none has a
third state, so **the point is frozen for the phase**. `App.tsx` has no
lane code left (3,109 → 3,091; what remains is the adapter, the
document's own view of the caret path), the union keymap snapshot is
byte-identical (harmony is picked, never pressed), and the grammar split
landed on its second reading: the brief split the grammar by validity
(regexes in core, because `SetHarmCommand` refused on them) and that
justification was circular — the command refused because core owned
them. The whole grammar went to the plugin, core kept only the ELEMENT,
and `ctx.query.harmValid` left the api (0.1.6 → 0.1.8). **Reversed the
same day, on the third reading**: a second writer is coming (a generator
plugin that reads a measure and writes its harmony), every writer must be
refused the same text, and if the api validates it validates every time
— so validity is core's again, `SetHarmCommand` refuses on it, `harmValid`
is back on the api (0.1.10), and the plugin keeps the affordances
(charset, transform, suggestions) and asks the question instead of
copying the answer.
**Slice 7 was split on 2026-09-15 into 7a and 7b**, the pattern since 5:
7a (in-house) builds what a player needs from the host and cannot make
itself — the app's one AudioContext as a service (unlock in the gesture,
the shared context, a clock conversion; the host owns the context, not
an instrument), the timemap and the notation facts as read-only queries,
the highlight as a view service, `onView:` fired, the export half of
`formats` — and rewrites the in-App player onto them first, taking the
performance logic (ties, gates, clones) OUT of core into the player,
because how a score is performed is a player's decision and there can be
several players. 7b (a context-free agent) moves the player, its row, the
export, Tone.js and the samples into `packages/plugins/playback` with
*API may grow: none*, and the budget ceiling drops there. **Slice 7a
closed 2026-09-15** (in-house): `ctx.audio`, `ctx.query.timemap()` and
`notation()`, `ctx.view`, `onView:` fired, the export half of `formats`
— and the in-App player rewritten onto them as a wall-clock scheduler
with its own performance, the interpretation out of core; api 0.1.11;
phase 5's playback section green unchanged. **Slice 7b closed
2026-09-15**: `packages/plugins/playback` holds the player, the row, the
export, Tone.js and the samples; the api did not grow (0.1.11 unchanged),
the initial chunk fell 596.0 → 360.8 kB and its ceiling to 377,000 bytes,
and `App.tsx` is 3,133 → 2,945. Two things the slice would not resolve
itself, both written into its BUILDING.md §7 and the CHANGELOG: the
export can no longer be named `<score>-playback.mid`, because
`DocumentInfo` carries the score's TITLE and not the open file's name
(the addition to consider is `DocumentInfo.name`, with this export and
slice 9's folder view as its two consumers), and the shell's mp3-decode
probe is inert now that `window.__SAMPLE_URL__` — a DOM global a plugin
may not set — is gone. One host edit beyond the brief's list, named
rather than passed over: Vite's `__vitePreload` helper had to be named in
`manualChunks`, the third module the host and a plugin share (after core
and React) and the first that is Vite's own. Its two gaps closed in-house
the same day (api 0.1.12: `DocumentInfo.name`, so the export is
`<name>-playback.mid` again; the shell's playback probe revived through
the real UI and asserted; the DOM-global rule tightened). **Slice 8 was
split into 8a and 8b the same day, and 8a closed** (in-house, api
0.1.13): `contributes.imports` and `ctx.formats.registerImport`, detection
as the host's (`.xml` told from MEI by declared root elements), the open
dialog's accept list and the shell's filter fed by the registry,
multi-file export payloads for the SVG pages, and the App's five Verovio
imports and four exports running as internal registrations —
`verify-formats.mjs` (14 checks) written first and green unchanged after.
**8b was attempted on 2026-09-16 and stopped**, the good way: nothing
delivered half-way (the budget is the slice's point, and a half-moved
worker would have shipped as two byte-identical copies Vite deduplicates
until the first edit), the gap written up — an export producer had no
way to read the document, because 8a's rehearsal had it by closure — and
closed in-house the same day: `ctx.query.mei()` (api 0.1.14), the App's
own registrations rewritten to read through it. **8b closed on its second
attempt, 2026-09-16**: `packages/plugins/formats` holds the five imports,
the three Verovio exports, the table and the worker; the api did not grow
(0.1.14 unchanged), the 13.45 MB `convertWorker` asset is reached only
from the plugin's chunk, and `App.tsx` is 2,946 → 2,935. **Slice 9 was
split into 9a and 9b on 2026-09-16, and 9a closed** (in-house, api
0.1.15): checked before the handoff, the `panels` side area existed and
nothing else did — so `ctx.workspace` (pick, re-admit, list, open, watch;
scoped to the folders the user picked, a `notify` watcher in the shell,
unavailable in a browser), `ctx.documents` with `path` and `dirty` on
every snapshot, and the external-change guard gone live; the shell
smoke's eighth check picks a folder without a dialog, lists it, refuses
an outside read and sees a change. **9b closed 2026-09-16, and it is the
measurement the phase was built to take**: `packages/plugins/folder-view`
is a whole feature that never lived in the editor, and `App.tsx` is
**2,991 → 2,991** — the host's entire diff is the two lines in
`plugins.ts` every plugin costs. The api did not grow (0.1.15 unchanged),
because 9a built every call against this panel as its named consumer.
Four findings the e2e made and no unit test could, all in its BUILDING.md
§7: the side panel area starts under the app header (its first consumer
in five slices), a declared entry point has two DOM hooks over its life,
an error state has to carry its way out, and `openFolder` answers the
same `false` for "no shell" and "no folder". Its three host gaps closed
in-house the same day, with the user's four changes to the panel: the
side area starts below the header, sits on the left and pushes the score
right; the live guard accepts `created` as well as `modified` (macOS);
`.mei` only stays; the rows lose their dot and bold and the active tab's
score is highlighted. Slice 10a (2026-09-18) built the last point the
phase names, `overlays`, against a rehearsal plugin that holds only
`ctx`: the host measures each tile and a plugin draws in its pixels;
geometry only, time stays in the timemap (api 0.1.16; `App.tsx` 3,017).
Slice 10b (2026-09-18) closed the phase's last plugin the same day:
`packages/plugins/pitch-reference` — a recording decoded by the host's
context, plain YIN, an offset and a rate against the score's own tempo,
the trace on every tile through the overlays point and fitted onto the
noteheads — with `App.tsx` and core untouched, which is the claim the
phase was run to test. **1.0.0 was released on 2026-09-18** — one number
for everything: the application, core, the docs, `@battuta/api` (every
plugin asking for `^1.0.0`) and the eight plugins. The plan below says
0.1.0 for the application; the user chose to align it with the contract
at release. DESIGN.md's *Host and plugins* section is written, and the
phase's documents are closed.

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
declared lanes (`{ id: "battuta.harmony.chord", label: "chord symbols
(above)", name: "chords", glyph: "♩", place: "above" }` and `{ id:
"battuta.harmony.rna", label: "roman numerals (below)", name:
"numerals", glyph: "RN", place: "below" }`), activating on `onLane:` of
each; `activate` registers both specs — `attachesTo: "event"`, `advance:
"event"`, `advanceOn: ["Enter"]`, the hint text verbatim from `App.tsx`,
`read` = `ctx.query.harmAt(eventId, kind)`, `commit` = `{ type:
"core.setHarm", eventId, kind, text }` when the buffer differs from
`harmAt`, null otherwise. **Where the grammar goes (decided 2026-09-14,
in-house):** VALIDITY stays in core — `SetHarmCommand` refuses text its
regexes reject, so core must own them — and the plugin asks through
`ctx.query.harmValid(kind, text)`: that is `complete`. The editor
affordances move into the plugin: the charsets (`HARM_CHARS`, →
`accepts`), the numeral key mapping (`o` → `°`, `0` → `ø`, →
`transform`), and the suggestion lists with their prefix rule
(`CHORD_QUALITIES`, `RNA_BASES`, `harmSuggestions`, → `suggest`; its
"add a `/` continuation once the head is complete" asks `harmValid`
too). Core's `harm.ts` keeps the regexes, `isHarmText`, `harmTextAt` and
the command, and loses `HARM_CHARS` and `harmSuggestions` (with their
core tests moving into the plugin's suite). The two internal harmony
specs and the last of the lane code leave `App.tsx`, and with them the
`isHarmText` / `harmSuggestions` / `HARM_CHARS` / `HarmKind` imports.

**Proves.** The rule of three, near enough: a third consumer confirms
the point's shape. Whatever harmony needs that the internal spec did not
is the point's last change before it is frozen for the phase.

**Leaves `App.tsx`.** The two internal harmony specs — the last lane
code.

**API may grow.** **None.** Built in-house on 2026-09-14, api 0.1.5 →
0.1.6: the `core.setHarm` message (`{ eventId, kind, text }`; the command
labels itself), `HarmKind` on the api, `ctx.query.harmAt(eventId, kind)`
and `ctx.query.harmValid(kind, text)`. The internal `chord` / `rna` specs
already commit through `core.setHarm`, so the message runs end to end
before the plugin exists, and every spec field harmony uses is in the
point because 5a ran those specs on it. Also in-house, before the slice,
the status bar itself: **host controls are anchored; contributions grow
into the free space to their left.** The `statusBar` slot sits right
after the bar's spacer, so a plugin item appearing or leaving moves no
host control; the lanes select is the boundary — first of the host
group, present only while some lane is on offer (`data-lanes`,
placeholder "lanes", a title listing the lanes), hiding without shifting
anything; and the bar's control look is the `.sbsel` class alone, so a
plugin's own `<select className="sbsel">` matches and joins F6 roving
focus. No new host module.

**Stop when.** The harmony lane needs a spec field or a query the
internal spec did not — 5a's rehearsal missed it — or a grammar helper
`harmValid` cannot answer. Write the gap; do not resolve it.

**Gates.** `packages/core/test/harm.test.ts` minus the two tests that
move with the suggestions (the command and validity tests stay); the
harmony section of `verify-phase5.mjs` with exactly its two
design-dependent hooks changed — the select option VALUES (`chord` /
`rna` become the plugin's lane ids) and nothing else, since the select is
already found by `data-lanes` — every assertion identical;
`verify-lyrics.mjs` unchanged; the union keymap snapshot byte-identical
(harmony has no key); the boundary tests; the plugin's suite (the
grammar's charset / transform / suggestion tables as pure tests, and
`complete` asking `harmValid`).

**Documents.** The plugin's two documents (BUILDING.md §7 starts from
the lyrics plugin's §7); the guide's harmony page unchanged in content
plus its plugins-page row; the CHANGELOG bullet recording the point's
final shape, the grammar split, and the `App.tsx` count now that the
mechanism is gone.

**Done when.** Both lanes run on the shared point, and `App.tsx` has no
lane code left.

**Closed 2026-09-15.** Both hold; the point took no change and is frozen.
*As briefed, after a detour:* the slice first moved the whole grammar
into the plugin and dropped `harmValid` (0.1.6 → 0.1.8), arguing the
brief's reasoning was circular; the user restored the split the same day
for a reason the brief had not given — a second writer (a harmony
generator) must be refused the same text, and an api that validates
validates every time — so validity is core's, `harmValid` is on the api
(0.1.10) and the plugin owns the affordances (CHANGELOG, and the
plugin's BUILDING.md §7.2–§7.3 with the reversal noted). Its §7.4 kept `HarmKind` declared twice and pinned; superseded the
same day — core owns the data types and the api re-exports them, so
nothing is declared twice (api 0.1.9).

#### Slice 7a — The audio context, the timemap and the facts (host, in-house; ≈4 days)

**Delivers.** What a player needs from the host and cannot make itself —
and NOTHING of how a score is performed, nor the instrument it is
performed on: there can be several players, and the host has one audio
context and one MIDI door.

1. **The audio context as a host service.** `ctx.audio`: `unlock():
   Promise<void>` creates the app's one `AudioContext` on first call and
   resumes it — called inside the click, before any await, because the
   autoplay policy binds the unlock to the gesture; `context():
   AudioContext | null` hands the shared context out (null before the
   first unlock, and where the platform has no Web Audio — tests); and
   `timeAt(atMs)` converts the `performance.now()` clock to the context's
   seconds, so a scheduler that works from timers, as the MIDI sink does,
   can still land its attacks sample-accurately. Host module `audio.ts`.
   The host owns the CONTEXT, not an instrument: Tone.js and the
   Salamander subset stay the player's, and in 7b move into the plugin
   (`Tone.setContext(ctx.audio.context())`); the boundary test's ban on
   `tone` in a plugin is lifted in this slice (decided 2026-09-15;
   `verovio` stays forbidden — rendering is a host service). The api's
   capability union gains `audio` and loses the reserved, never-used
   `playback`; the api's tsconfig gains the DOM lib for the type.
2. **MIDI out** — `ctx.midi.openOutputs()` since slice 3; unchanged.
3. **The timemap, read-only.** `ctx.query.timemap(): Promise<Timemap |
   null>` — Verovio's timemap for the document as data: `events: {
   tstamp; on?; off?; measureOn? }[]`, `notes: Record<id, { pitch;
   duration }>`, `idMap` from repeat-pass clone ids to the engraved ones —
   of the EXPANDED form (repeats, voltas, one D.S./D.C. jump: the form is
   a document fact and `buildExpansion` stays in core). Null with no
   document; rejects with the render error. Declared on the api
   (`render.ts`): the render pool produces it, not core. The adapter sets
   the `__PLAYBACK__` dev hook (the timemap with `shaping: { ties }` from
   the facts below) so phase 5's form and tie checks read what they read.
4. **The notation facts a performance interprets.** `ctx.query.notation():
   NotationFacts` — `ties: Record<noteId, noteId>` (which note ties INTO
   which, resolved from `@tie` chains and `<tie>`) and `marks:
   Record<noteId, NoteMark[]>` with `NoteMark = "slur" | "tenuto" |
   "staccato" | "staccatissimo"`. Core's `playbackShaping` becomes
   `notationFacts`: reading MEI is core's and stays; MEANING leaves —
   `GATE_SLUR` … `GATE_DEFAULT` and `mergeTiedSpans` move into the App's
   `player.ts` (and in 7b into the plugin) with their tests. Types
   declared in core, re-exported by the api.
5. **The highlight as a view service.** `ctx.view.highlight({ on, off,
   measureOn? })` and `ctx.view.clearHighlight()` — the App's `onHighlight`
   body (class toggling on the page SVG, scroll when the playing measure
   leaves the window), bound by the App as a view adapter.
6. **`onView:<mode>` fired** from the host's own editor mirror on every
   change (reserved since slice 1, unfired). The player row activates on
   `onView:pages`.
7. **The export half of `formats`.** `contributes.exports: [{ id, label,
   ext, mime }]` declared in the manifest — the battuta menu lists it
   before the plugin's code loads (`data-export=<id>` hooks unchanged),
   picking it fires `onFormat:<id>` (reserved, unfired) and waits for the
   registration; `ctx.formats.registerExport(id, produce)` with `produce:
   () => Promise<ExportPayload>` (`{ bytes: Uint8Array | string;
   filename? }`, the host naming `<doc>.<ext>` by default and saving
   through its one export path — browser download or the shell dialog);
   host module `formats.ts` holding the registry, which slice 8 extends
   with imports. The hard-coded "export playback MIDI" becomes an
   INTERNAL registration — the rehearsal.

The in-App player is rewritten onto all of it FIRST. `player.ts` becomes
what the plugin's player will be: it builds its performance from
`timemap()` and `notation()` (merge the tie chains, apply the gates, map
clones to engraved ids — its own logic now), unlocks through
`host.audio` and gives Tone its context, schedules its sampler and the
MIDI sink from one wall-clock scheduler with a lookahead, fires cues to
`view.highlight`, and keeps pause / seek / speed by releasing and
rescheduling from a position. Tone's transport, `Part` and `Draw` go —
Tone remains the App's instrument until 7b moves it. `midiExport.ts`
builds the same performance. Behaviour identical, the phase-5 timings
unchanged.

**Proves.** That the audio context is a host service like the MIDI
ports — a metronome, a note preview on entry or a reference-track player
can sound on the same context without fighting for the unlock; that the
instrument and the performance are the plugin's and only the plugin's;
and the export half of `formats` on its first consumer, before slice 8
adds the import half.

**Leaves `App.tsx`.** The highlight function, the timemap and shaping
plumbing, the hard-coded export entry, the AudioContext handling.

**API may grow.** `AudioService` (`ctx.audio`: `unlock`, `context`,
`timeAt`), capability `audio` in place of `playback`; `Timemap`,
`TimemapEvent`, `TimemapNote` and `DocumentQueries.timemap()`;
`NotationFacts`, `NoteMark` and `DocumentQueries.notation()`
(core-declared, re-exported); `ctx.view` with `highlight` /
`clearHighlight`; `ExportContribution`, `contributes.exports`,
`ExportPayload`, `ctx.formats.registerExport`; `onView:` and `onFormat:`
fired. Host modules `audio.ts` and `formats.ts`; the DOM lib in the api's
tsconfig. Rule change, decided by the user: `tone` leaves
`FORBIDDEN_DEPS` in `plugin-boundaries`. Not added, each for want of a
consumer: an instrument or sampler in the host, a `form: "written"`
option on the timemap (a player that skips repeats asks for it then), any
transport or scheduler in the host (arrangement is the plugin's), a play
key (`onPlay` stays reserved and unfired; a key would be a plugin
binding).

**Stop when.** The host would need to know about an instrument, ties,
gates, tempo or form — it hands out a context, a clock conversion and
facts, nothing more; or the highlight needs more than on / off /
follow-the-measure (the overlay point, slice 10).

**Gates.** The playback section of `verify-phase5.mjs` unchanged (hooks
`data-player-*`, `g.playing`, `__PLAYBACK__`, and the timings);
`midiExport.test.ts` unchanged in its assertions, its fixture now a
timemap plus facts; `midiOut.test.ts` unchanged; a new `audio.test.ts`
over a fake AudioContext (unlock creates once and resumes synchronously;
context() is null before it and where the platform has none; timeAt
converts the clocks); core `playback.test.ts` split — tie and mark EXTRACTION stays,
gates and merging move to the editor's player tests; host tests
(`onView:` fires on change and once for the first view; the view service
reaches the adapter and is a no-op without one; `timemap()` and
`notation()` null and empty without a document, `timemap()` rejecting on
a render error; a declared export listed before its plugin loads,
`onFormat:` waking it, `registerExport` demanding a declaration, the
payload reaching the save path with the default name, two plugins on one
export id → the second fails); the union keymap snapshot and the budget
unchanged (Tone moves in 7b); every other e2e; `verify-tauri.sh` (Web
Audio in the shell's WebKit through the host's context).

**Documents.** CHANGELOG bullet with the context-not-instrument line
and the facts / performance split; DESIGN note (the audio context is a
host service; the instrument and the performance are a plugin's); the
conventions' rows (`audio.unlock` / `context` / `timeAt`, `timemap()`,
`notation()`, `view.highlight`, `contributes.exports` /
`registerExport`, `onView:`); the api docs; the boundary test's comment
on why `tone` is allowed and `verovio` is not.

**Done when.** The in-App player runs on `host.audio`, `host.midi`,
`host.query.timemap()`, `host.query.notation()`, `host.view.highlight`
and the export registry, and phase 5 is green unchanged.

**Closed 2026-09-15.** All hold; api 0.1.11; the CHANGELOG bullet has
the account. *As built, beyond the brief:* the export contribution
carries an optional `title` (the menu row's tooltip, which the internal
export had); `Timemap` types live on the api rather than in core because
the render pool, not core, produces them; the player's scheduler ticks
every 50 ms with a 250 ms lookahead and a 600 ms tail, all in
`player.ts` for 7b to move as they are. The budget did not move here —
Tone stays the App's until 7b. Phase 5 is green with its playback section
untouched; the one script change is a dev hook elsewhere following the
session method's rename (`notationFacts()`).

#### Slice 7b — Playback (plugin; ≈3 days)

**Delivers.** `packages/plugins/playback`: a manifest with
`capabilities: ["midi", "audio"]`, `activationEvents: ["onView:pages",
"onFormat:battuta.playback.midi"]` and `contributes.exports: [{ id:
"battuta.playback.midi", label: "playback MIDI", ext: "mid", mime:
"audio/midi" }]`. `activate` adds ONE `docHeader` slot item — the player
row (▶/⏸, ⏹, the speed select, the MIDI checkbox, the transpose select,
the progress bar and the readout, every `data-player-*` / `data-midi-*`
hook kept verbatim), rendered only while `ctx.editor.get().view ===
"pages"` — and registers the export. `player.ts` moves in AS IT STANDS
after 7a: the performance (tie merging, gates, clone mapping — the
plugin's interpretation, with the `GATE_*` constants, `mergeTiedSpans`
and their tests), the lookahead scheduler over its own Tone.js sampler
on `ctx.audio.context()` or over `ctx.midi.openOutputs()` (kept for the
session; released on pause, seek, speed and stop; a notice when no MIDI
output exists and the piano plays instead), `ctx.audio.unlock()` inside
the click before any await, cues to `ctx.view.highlight` and
`clearHighlight` on stop and seek, transpose on the MIDI sends and the
export only, stop when `ctx.document` publishes a new version and when
the view leaves pages. **Tone.js and the Salamander subset move into the
plugin** — Tone behind a dynamic `import()` so entering page view costs
the row and pressing play costs the engine, the samples as the plugin's
URL assets — and `tone` joins the plugin's dependencies (allowed since
7a). `midiExport.ts` moves in as a pure function over the plugin's
performance. Speed, MIDI-out and transpose live in `ctx.settings` (the
dated migration line in `settings.ts`, with its test, is the one host
edit — the 4b precedent).

**Proves.** The bundle budget for real: Tone.js and the piano leave the
initial chunk and the ceiling set in slice 1 is lowered to the measured
figure plus the usual headroom. A UI plugin with real state (transport
position, the MIDI latch) lives in a slot item that subscribes and is
never remounted (4b's §7.6, again); one scheduler drives an instrument
and a MIDI sink; and a second player could exist tomorrow, because every
performance decision — and the instrument — is in here.

**Leaves `App.tsx`.** `player.ts` and `midiExport.ts` (out of
`apps/editor/src`), the row, `playerState` / position / total polling,
`TEMPO_STEPS`, `fmtTime`, the MIDI-out ref, the three settings reads, the
`tone` dependency of the editor.

**API may grow.** **None.** Everything is in 7a. Host edits allowed: the
settings migration (dated list, with its test), `tone` removed from the
editor's `package.json`, and `budget.json` lowered to the measured
initial chunk plus the usual headroom, with the figure in the CHANGELOG.

**Stop when.** The player needs anything beyond `ctx.audio.unlock` /
`context` / `timeAt`, `ctx.midi.openOutputs`, `ctx.query.timemap` / `notation`,
`ctx.view.highlight` / `clearHighlight`, `ctx.slots.add("docHeader", …)`,
`ctx.formats.registerExport`, `ctx.settings`, `ctx.document`,
`ctx.editor` and `ctx.notice` — or a mark `notation()` does not carry (a
new fact is core's to add, in-house; not the plugin's to guess). Write
the gap; do not resolve it.

**Gates.** The playback section of `verify-phase5.mjs` with no hook
changed (the row's hooks are the plugin's to keep, `__PLAYBACK__` is the
host's); `midiExport.test.ts` and the gate / merge tests moved into the
plugin's suite unchanged in their assertions; `midiOut.test.ts` and
`sound.test.ts` stay with the host; core's tests unchanged;
`verify-tauri.sh` (the shell's MIDI outputs and virtual source, and Web
Audio on the host's context, now driven by a plugin); the boundary tests
(`tone` allowed since 7a; `verovio` still refused); the union keymap
snapshot byte-identical (playback has no key); **`npm run budget` with
the LOWERED ceiling**, and `dist/.vite/manifest.json` showing the entry
imports neither the plugin chunk nor the Tone chunk.

**Documents.** The plugin's two documents (BUILDING.md §7 starts from the
harmony plugin's §7 and the keyboard plugin's §7.6); the guide's playback
page unchanged in content plus its plugins-page row; the CHANGELOG bullet
with the `App.tsx` count and the budget figure.

**Done when.** Play, MIDI out, transpose and the export behave
byte-identically to 0.0.3; turning the plugin off removes the row and the
export entry together; the initial chunk contains neither Tone.js nor
the samples, and the budget check enforces the new ceiling.

**Closed 2026-09-15.** All hold but one clause of the first: play, MIDI
out and transpose are byte-identical, and the export's CONTENT is, but
its FILE NAME is not — `<score>.mid` where 0.0.3 wrote
`<score>-playback.mid`, which collides with the written-score MIDI
export. Reproducing it needs the open document's file name and
`DocumentInfo` has only its title; *API may grow: None*, so the gap is
written (BUILDING.md §7.2) and not resolved. *As built, beyond the
brief:* one line in `apps/editor/vite.config.ts` naming Vite's
`__vitePreload` helper into `battuta-shared` — shared by the host's
plugin loader and, newly, this plugin's own dynamic imports, and without
it Rollup puts the helper in the plugin chunk and the entry imports that
chunk statically, which is exactly what this slice's budget gate
forbids. *Inert, and recorded:* the shell's probe3 (mp3 decode in
WebKitGTK) no longer runs, because its `window.__SAMPLE_URL__` hook was
a DOM global a plugin may not set; `verify-tauri.sh` never asserted it
and is still 6 of 6. The row is one slot item that renders `null`
outside page view rather than an item added and removed with the view
(§7.5), and the plugin has no `deactivate()` — everything it owns is a
disposable the host already tracks (§7.6).

#### Slice 8a — The import half of `formats` (host, in-house; ≈2 days)

**Delivers.** The other half of the point 7a opened, built and consumed
by the App's own converters FIRST so the plugin slice finds every door
open:

1. **Declared imports.** `contributes.imports: [{ id, label, exts,
   binary?, roots? }]` — the extensions a plugin's converter claims,
   whether the file is read as text or bytes, and, for an extension MEI
   shares (`.xml`), the root elements that mark the file as this format
   rather than MEI. Validated (ids unique, a label, lowercase alnum
   extensions). Declared imports widen the open dialog's accept list —
   the browser input's and the shell's native filter — before the plugin's
   code has loaded, and picking such a file fires `onFormat:<id>` and
   waits for the converter: the same lesson as slot items, lanes and
   exports.
2. **`ctx.formats.registerImport(id, convert)`** — `convert(file: { name,
   text?, bytes? }) => Promise<string>` returns MEI; the host opens what
   comes back as a NEW unsaved document named after the file (a plain save
   must never overwrite the `.musicxml` source with MEI — 0.0.3's rule).
3. **Detection is the host's.** `host.formats.detect(name, content?)`:
   `.mei` is native; an extension one import claims is that import; `.xml`
   is MEI unless an import claiming `xml` declares `roots` and the content
   matches one (MusicXML's `score-partwise` / `score-timewise`); nothing
   claiming it → unsupported. `formats.ts`' `detectImport` and
   `OPEN_EXTENSIONS` leave the App for the store, with their tests.
4. **Multi-file exports.** `ExportPayload` may be `{ files: [{ bytes,
   filename }] }` — the SVG export writes one page per file and stays the
   host's (it is engraving, from the render pool, not a converter).
5. **The App's converters as INTERNAL registrations** — the five imports
   (MusicXML, `.mxl`, ABC, PAE, Humdrum) and the three Verovio exports
   (MIDI written score, Humdrum, PAE) through the lazy converter worker,
   SVG through the render pool — so the menu and the open path run on the
   registry alone (`EXPORT_FORMATS.map` and `exportAs` leave the menu),
   `IMPORT_FORMATS` / `EXPORT_FORMATS` stay the pinned table of what the
   bundled Verovio can do (`convert.test.ts`), and the shell's open dialog
   takes its filters from the JS side (`open_score` gains `exts` and
   `binaryExts`; the Rust constant goes).

Before any of it: `spikes/verify-formats.mjs`, written against the App as
it is — an `.mxl` through the file input opens as a new unsaved tab named
after the file, an ABC file imports as text, a `.xml` holding MusicXML
is told apart from MEI by its root, an unknown extension is refused with
a notice, the accept list covers every format, and the four exports
download real files (an SMF header, `**kern`, PAE, `<svg`) from menu rows
in order. Green first, then the extraction keeps it green.

**Proves.** `formats` whole — import and export on one registry, both
halves rehearsed by internal registrations — so 8b moves converters and
touches no host.

**Leaves `App.tsx`.** `detectImport` and `OPEN_EXTENSIONS`, the two
import functions' format knowledge, `exportAs`, the `EXPORT_FORMATS`
menu rows, the `.mxl` special case (now "whatever declares `binary`").

**API may grow.** `ImportContribution`, `contributes.imports`,
`ImportFile`, `FormatsService.registerImport`; `ExportPayload` with
`files`. Nothing else: no converter service (a worker is the plugin's to
ship), no `onDocument:` firing (nothing consumes it yet). api 0.1.12 →
0.1.13. Host module: none new — `formats.ts` grows the import half, as
the brief for 7a said it would.

**Stop when.** An import needs the host to know its FORMAT — a parser, a
sniff beyond a root-element list, a zip — that is the converter's. Or the
open path needs more than name, text-or-bytes and the MEI back.

**Gates.** `verify-formats.mjs` green before and after with its
assertions unchanged (its hooks: the file input, `[data-export=<id>]`,
`[data-notice]`, the tabs); `verify-phase3.mjs` save check unchanged;
`convert.test.ts` minus its detection block (which moves to
`host.test.ts` as `formats.detect` cases: every extension, the `.xml`
sniff both ways, no content → MEI, unknown → null); host tests for the
import registry (declared imports widen the accept list before the
plugin loads; `importFile` wakes the plugin with `onFormat:` and returns
its MEI; `registerImport` demands a declaration; two plugins on one id →
the second fails; `binary` decides text or bytes; a `files` payload
reaches the save path once per file); the api's import validation; the
union keymap snapshot and the budget unchanged (the worker moves in 8b);
every other e2e; the shell smoke (the native dialog with JS-side
filters).

**Documents.** CHANGELOG bullet with the registry's final shape and the
detection rule; DESIGN note; the conventions' rows (`contributes.imports`
/ `registerImport`, `files` payloads, detection); the plan's `formats`
row.

**Done when.** Open and export run on `host.formats` alone, every
import and export behaves as in 0.0.3, and `verify-formats.mjs` is green
unchanged.

**Closed 2026-09-15.** All hold; api 0.1.13; the CHANGELOG bullet has
the account. *As built, beyond the brief:* the e2e's export-order
assertion became relative to the four Verovio rows (the registry lists
the host's own before a plugin's, where 0.0.3 had the playback export
first — a menu order, not a behaviour); `open_score` in the shell lost
its extension constant and takes `exts` and `binaryExts` from the
frontend; the SVG export names its files from `DocumentInfo.name`.
*What the rehearsal missed (found by 8b's first attempt, 2026-09-16):*
the App's export registrations read the document by closing over the
session, which a plugin cannot do — so the export half was rehearsed
against the registry, not the contract, and `ctx.query.mei()` had to be
added in-house afterwards (api 0.1.14). The rule that follows is in the
conventions: rehearse a point from something that holds only `ctx`.

#### Slice 8b — Format converters (plugin; ≈2 days)

**Delivers.** `packages/plugins/formats`: a manifest declaring the five
imports and the three Verovio exports (MIDI written score, Humdrum,
PAE — SVG stays the host's), activating on `onFormat:` of each;
`activate` registers each converter and producer through
`ctx.formats.registerImport` / `registerExport`; the converter worker and
the Humdrum-enabled Verovio build move into the plugin (`convertWorker.ts`
becomes the plugin's worker, spawned lazily on the first conversion, kept
for the session); `IMPORT_FORMATS` / `EXPORT_FORMATS` and
`convert.test.ts` (the pinning test, with its `.mxl` fixture) move with
them — the table stays the single source of truth for what the bundled
Verovio can do. The App keeps only the open path and the save path.

**Proves.** The second budget drop, in the dist rather than the initial
chunk: the 13 MB Humdrum-enabled worker leaves the host's assets for the
plugin's; and that `formats` needs no host change for a plugin with a
worker of its own.

**Leaves `App.tsx`.** The five internal import registrations and the
three converter-backed export registrations; `converter.ts` leaves
`apps/editor/src`.

**API may grow.** **None.** Everything is in 8a — *and, amended
2026-09-16 after the first attempt stopped on one gap
(`packages/plugins/formats/POSTMORTEM-2026-09-16.md` §7.1), in `ctx.query.mei()`* (api
0.1.14): the document as MEI text, score-based, which is what an export
producer converts; the App's own export registrations now read it
through the query too, so the rehearsal proves the contract rather than
closing over the session. Host edits allowed: `verovio/wasm-hum` moved
from the editor's dependencies to the plugin's. The `vite.config.ts`
edit the first draft allowed was measured unnecessary (§7.3: a worker is
a separate Rollup sub-build, out of `manualChunks`' reach).

**Stop when.** A converter needs anything beyond `ctx.formats`'
registrations, the file it is handed and the MEI it returns, or a
format needs a detection the manifest cannot declare (an extension plus
root elements). Write the gap; do not resolve it.

**Gates.** `verify-formats.mjs` with only its design-dependent hooks
changed — the `data-export` ids, if the plugin's ids replace `midi` /
`humdrum` / `pae` — every assertion identical; `verify-phase3.mjs`
unchanged; `convert.test.ts` moved into the plugin's suite unchanged in
its assertions; the boundary tests as relaxed by the user on 2026-09-15
— `verovio/wasm-hum` and `verovio/esm` may be imported and `verovio`
depended on, the render build (`verovio/wasm`, or bare `verovio`) may
not, and no engraving or layout call (`renderToSVG`, `renderToTimemap`,
…) may appear: the converter build is this plugin's precise purpose,
rendering stays the host's; the union keymap snapshot byte-identical;
`npm run budget` unchanged (the worker was never in the initial chunk)
and the dist without `convertWorker` under the host's assets; the shell
smoke.

**Documents.** The plugin's two documents (BUILDING.md §7 starts from
this package's `POSTMORTEM-2026-09-16.md` §7 — the first attempt's
account, which also settles the ids, the table's home and the worker —
and the playback plugin's §7.1 and §7.4); the guide's files page
unchanged in content plus its plugins-page row; the CHANGELOG bullet with
the dist figure.

**Done when.** Every import and export format works as in 0.0.3 with the
plugin on; with it off the open dialog lists `.mei` only and the menu's
export rows are SVG alone.

**Closed 2026-09-16, second attempt.** All hold; api 0.1.14 unchanged;
`verify-formats.mjs` green with every assertion identical (only the
`.mxl` fixture's path and the three export ids changed). *As built,
beyond the brief:* SVG left the format table entirely rather than sitting
in it unregistered — it is engraving, and a table that is the single
source of truth for what Verovio CONVERTS must hold only conversions; the
App carries its one entry inline. The `vite.config.ts` edit the brief
allowed was not needed (measured in the first attempt). `verovio/wasm-hum`
left the editor's ambient types as well as its use, and the plugin's copy
is deliberately narrower — the engraving calls are not declared, so rule
1b is a compile error there before it is a test failure. *Found and
written up:* "off" is measured in what is RELEASED, not in what leaves
the UI (the registrations disposed while a 12 MB worker kept running;
`Converter.dispose()` now goes into `ctx.subscriptions` last, so it runs
first), and a plugin that needs a missing platform global in tests should
stand in the GLOBAL rather than open a seam in its own code (a
`FakeWorker` on `globalThis`, which also became the only check anywhere
of the id → Verovio mapping).

#### Slice 9a — The workspace service and the open documents (host, in-house; ≈3 days)

**Delivers.** What a folder view needs from the host and cannot make
itself — checked before the handoff on 2026-09-16: the `panels` side
area exists (`ctx.panels.open({ side: "side" })`, mounted since slice 1,
no consumer yet); everything else below did not.

1. **The `workspace` host service** — the platform capability the plan
   named in slice 1 and never lifted, now `ctx.workspace` (capability
   `workspace`, offered by every build): `available` (false in a browser:
   the panel says the shell is required), `pickFolder()` (the native
   folder dialog; the picked folder becomes readable), `openFolder(path)`
   (re-admit a folder a plugin persisted from an earlier session, if it
   still exists), `readDir(path)` (entries with name, path, kind; hidden
   entries skipped; folders first), `openDocument(path)` (through the
   host's one open path — imports convert, the mtime is recorded, an
   already-open tab is focused instead of opened twice), and `watch(path,
   listener)` (a recursive watcher, events coalesced per path). **Scoped
   to the folders the user picked**: the shell keeps the roots, and every
   read, list and watch outside them is refused — no fs plugin, no broad
   permission; the JS facade is the contract. Host module `workspace.ts`
   with a shell backend (Tauri commands `workspace_pick_folder`,
   `workspace_open_folder`, `workspace_read_dir`, `workspace_read_file`,
   `workspace_watch` / `workspace_unwatch`, a `notify` watcher emitting
   `workspace-change`) and a browser backend that reports unavailable.
2. **The open documents as data.** `DocumentInfo` gains `path?` (the disk
   path when the document came from or went to disk; absent for imported
   and new scores) and `dirty` (the tab's marker); `ctx.documents:
   Store<readonly DocumentInfo[]>` lists every open tab in order, while
   `ctx.document` stays the active one. A folder view marks which files
   are open and which are unsaved from this, never from the DOM.
3. **The external-change guard goes live.** Today the guard compares the
   disk mtime at SAVE time. With the watcher, an open document whose file
   changes on disk is noticed the moment it happens: the App subscribes
   to the service's change stream and shows the notice at once; the save
   guard stays as the last line. Closes live file watching, open since
   0.0.2.

**Proves.** `workspace` as a host service with the shell pattern — a
Rust capability behind a JS facade that degrades in the browser — and
that a panel plugin can be told what is open without touching the tabs.

**Leaves `App.tsx`.** Nothing of size: this slice adds. The mtime guard's
notice moves from save time to change time.

**API may grow.** `WorkspaceService`, `DirEntry`, `WatchEvent`,
`ctx.workspace`; `DocumentInfo.path` and `.dirty`; `ctx.documents`;
capability `workspace` offered. Host module `workspace.ts`; the shell
commands above; the `notify` crate. Not added, for want of a consumer:
`onDocument:` firing (the folder view activates from its slot item and
its own setting, like the keyboard), write access of any kind (the save
path is the App's), a browser backend over the File System Access API.

**Stop when.** A read or watch would have to reach outside a picked
folder, or the guard would need the plugin's watcher to exist (it must
work for any open file under a picked root, plugin or not).

**Gates.** `workspace.test.ts` over a fake bridge (unavailable in a
browser: pick → null, read → refused, watch → a no-op disposable; in the
shell: the commands called with the right arguments, events routed by
path and coalesced, dispose unwatches, openDocument through the bound
adapter and refused without one); host tests (`ctx.documents` follows
tabs, dirty and paths; the capability offered); the shell smoke gains a
probe: with `BATTUTA_WORKSPACE_TEST_DIR` set, the pick returns that
folder without a dialog, `read_dir` lists it, a watch is placed, the
script appends to a file in it and the change event arrives —
`verify-tauri.sh`'s eighth check; a read outside the roots is refused
(`cargo test` or the probe); every e2e unchanged; the union keymap
snapshot and the budget unchanged.

**Documents.** CHANGELOG bullet with the service's shape and the scoping
rule; DESIGN note; the conventions' rows (`ctx.workspace`,
`ctx.documents`, `path` / `dirty`); the api docs.

**Done when.** A plugin can pick a folder, list it, open a score from it
and see it change, all through `ctx`, in the shell — and learns in a
browser that it cannot; an external edit to an open score under a picked
folder is noticed the moment it happens.

**Closed 2026-09-16.** All hold; api 0.1.15; the CHANGELOG bullet has
the account. *As built, beyond the brief:* `openDocument` focuses an
already-open tab rather than opening it twice; the watcher coalesces per
path with a 150 ms window and reports the last kind seen; the scope is
enforced on canonical paths, so a symlinked folder is judged by where it
points.

#### Slice 9b — Folder view (plugin; ≈4 days)

**Delivers.** `packages/plugins/folder-view` — a NEW feature rather than
an extraction: a side panel listing the opened folder's scores (`.mei`
and every extension the open dialog accepts — `ctx.workspace` cannot
tell you those: use the list `ctx.formats` cannot give either… **stop:**
the accept list is the host's `openExtensions`, not on the api; see
*Stop when*), open documents marked from `ctx.documents` (a dot for
open, the tab's marker for dirty), click → `ctx.workspace.openDocument`,
live `watch` refreshing the tree. Entry point: a declared `header` slot
item (📁, `dimUntilActive`) on `battuta.folder-view.toggle`, activation on
that command and on `onSettings:folder` (the persisted folder reopens at
startup through `ctx.workspace.openFolder`), `capabilities:
["workspace"]`. In a browser the panel opens and says the shell is
required — `ctx.workspace.available`.

**Proves.** `panels` on the side, `workspace` from outside, and that a
new feature costs the host nothing.

**Leaves `App.tsx`.** Nothing — this slice adds, and measures that the
host did not grow.

**API may grow.** **None**, with one question 9a leaves open on purpose:
the folder view must know which extensions are scores. The host's
`openExtensions` store is not on the api; if the plugin needs it,
`ctx.formats.extensions: Store<readonly string[]>` is the shape to
propose (consumer: this list; a second: a drag-and-drop target). Write
the gap; do not resolve it — or list `.mei` only and say so. *Decided
2026-09-16, after the slice: `.mei` only stays; no addition.*

**Stop when.** The panel needs anything beyond `ctx.workspace`,
`ctx.documents`, `ctx.panels`, the declared slot item, `ctx.settings`,
`ctx.notice`, and the extension question above.

**Gates.** A new e2e path in the shell smoke (open folder → click a score
→ edit → external change → the guard's notice) — the browser e2e can
only assert the "shell required" state; `verify-tauri.sh` grows the
folder-view check; the boundary tests; the union keymap snapshot
unchanged (📁 is a slot item, not a key); the budget.

**Documents.** The plugin's two documents (BUILDING.md §7 starts from
the keyboard plugin's, the only other panel); a NEW guide page (folder
view, live watching) and the limits page's rows retired; the plugins-page
row; the CHANGELOG bullet.

**Done when.** The panel works end to end in the shell; the browser build
shows its notice; turning the plugin off removes the panel and the 📁
together.

**Closed 2026-09-16.** All hold; api 0.1.15 unchanged; `App.tsx`
2,991 → 2,991. The extension question was answered the way this brief
allowed — `.mei` only, with the gap written (BUILDING.md §7.7) and the
addition named (`ctx.formats.extensions`, a STORE rather than a getter,
because the answer changes when a format plugin is switched); copying the
host's list into the plugin was the third option and is the one that
would have rotted. *As built, beyond the brief:* the panel clears 92 px
at its top, because the side area is `top: 0` under a sticky 75 px app
header — the area's first consumer found it wrong after five slices
(§7.1). The clearance is pinned by both e2e scripts rather than trusted;
the gap is the host's to close, either by starting the side area below
the header or by telling a panel its inset. A new `verify-folder-view.mjs`
(15 checks) is the browser half and `probe5` the shell half. *Not green,
and not this slice's:* 9a's probe4 asserts the watcher reports `modified`
for an append, and macOS FSEvents reports `created` — it fails with this
plugin absent, and the same mismatch stops 9a's live guard firing there
(`App.tsx` filters `kind !== "modified"`). probe5 reports the guard
rather than asserting it; §7.6 has the account.

#### Slice 10a — The overlays point (host) — CLOSED 2026-09-18

**Delivers.** The `overlays` point, the last extension point the phase
names: `ctx.overlays.add({ id, render })` mounts a layer over every
measure tile in edit view while the disposable lives, and `render` is
handed the tile MEASURED — its box, the box of every engraved event
(notes, chords, rests) and each staff's five lines with the context in
force (clef, key, meter), all in the tile's own CSS pixels — so a plugin
maps a pitch or a time to a place without knowing how Verovio laid the
measure out. The layer is draw-only (no pointer events: the host's
hit-testing under it is untouched), sits above the SVG and below the
caret, is re-measured when the tile's ink moves (a render, a zoom, a row
reflow) and costs nothing while no overlay is registered: nothing is
mounted, no layout is read. Time is deliberately NOT in the props: the
timemap already names each measure by the same engraved id and carries
the pitches, and a plugin reads it once for the document rather than per
tile. Host module `overlays.tsx` (the store, the pure projection, the
per-tile component); the api grows `OverlaysService`, `OverlaySpec`,
`TileOverlayProps`, `OverlayBox`, `OverlayStaff` and re-exports core's
`StaffContext` / `ClefContext` / `MeterContext` (0.1.15 → 0.1.16). Built
against 10b as its named consumer.

**Changed from the original brief.** The first overlay plugin is no
longer the MIDI piano-roll ghost layer: the user chose (2026-09-18) a
simpler first reference — a wav file's pitch, traced over the measures —
so the point hands out geometry only, and the "effective context and
timemap" of the old brief became the staff contexts (in the props) and
`ctx.query.timemap()` (already there). The piano-roll layer and OMR
remain later consumers of the same point.

**Proves.** The point from outside the App before any plugin exists:
`spikes/verify-overlays.mjs` registers a rehearsal plugin at runtime that
holds only `ctx` and reads its props off the page — every rendered tile
has the layer, boxes for its notes, five ascending lines per staff with
the clef in force, the document's own measure id; every box inside its
tile; a click through the layer still places the caret; a zoom
re-measures; dispose removes every layer (14 checks).

**Leaves `App.tsx`.** Nothing; it gains 26 lines (2,991 → 3,017): the
mount inside each tile's aligned box and two session-stable lookups.

**Gates.** `overlays.test.ts` (the store; the projection of measured
rectangles into tile pixels — centred lines, sorted both ways, a staff the
document does not know dropped); `host.test.ts` (an overlay is withdrawn
with its plugin); `host-boundaries` (`overlays.tsx` allowed); the api
surface at 0.1.16; the browser rehearsal above; every other suite
unchanged (editor 143, api 20, the seven plugin suites).

#### Slice 10b — The pitch reference plugin (in-house, stepwise) — CLOSED 2026-09-18

**Closed.** Built the same day in the five checkpoints below, each verified
before the next; `App.tsx` and core untouched; one host refinement (a
note's box on the overlays point is its head, api 0.1.17). Tests: the
plugin's five suites (25), editor 144, `spikes/verify-pitch-reference.mjs`
(25 checks, a take synthesized from the score's own timemap). The
**Documents** of the phase exit below — DESIGN.md's *Host and plugins*
section, `@battuta/api` 1.0, the 0.1.0 release — are the remaining work of
the phase, and they are the user's call.

**Delivers.** `packages/plugins/pitch-reference`, the first reference
layer and the plugin that closes the phase: a wav file of a performance,
its pitch detected, traced over every measure in edit view and, in one
bottom panel, over the whole file, with the WRITTEN pitch drawn on the
same axis for comparison. Built in five checkpoints, each usable on its
own, stopping at any of them if the host would have to grow:

1. load and decode — a file input in the panel; `ctx.audio.context()`
   decodes (the host owns the context; decoding is a method on it); a
   mono downmix resampled to 16 kHz; the waveform envelope in a bottom
   panel; the audio kept in memory only.
2. the trace — plain YIN, hand-rolled (window 1024, hop 160, max lag 320,
   threshold 0.15, parabolic interpolation on the dip), unvoiced frames
   left as gaps, a five-frame median filter, fractional MIDI out; in a
   Worker or yielded chunks so the UI never waits.
3. alignment — two numbers: an offset (where bar 1 starts in the file,
   detected from the first voiced frame and nudgeable) and a rate (the
   take's tempo against the score's, a "recorded at ♩=" field defaulting
   to the score's tempo). The written pitch from `ctx.query.timemap()`
   drawn over the trace in the panel; offset and rate persisted per
   document in `ctx.storage`. The score's tempo is taken, never estimated
   from the audio.
4. the measures — on `ctx.overlays`: each tile's window of the trace
   mapped through offset and rate onto the tile's pitch axis (from its
   staff lines and clef, checked against the boxes of its notes when it
   has some), the written notes as a faint reference on the same axis.
5. polish — cents-deviation colouring, gap handling, the panel's
   controls (load, clear, offset, rate, show/hide).

Web and desktop alike: everything runs in both; a sidecar wav next to the
.mei through `ctx.workspace` is a later step, not this one. Dynamic time
warping of the trace against the written pitch curve is the natural next
version and needs nothing new from the host.

**Proves.** The phase's central claim on a research feature: signal
processing implemented entirely as a plugin — zero edits to `App.tsx` or
core; if the api must grow, the slice stops and the gap is closed
in-house.

**Leaves `App.tsx`.** Nothing.

**Gates.** The plugin's suite (YIN on synthetic tones — a 440 Hz sine
reads 69.0 within 0.05, an octave jump, silence unvoiced; the alignment
maths; the pitch axis from staff lines and clef); an e2e that loads a
generated wav and reads the trace off the panel and a tile;
`verify-overlays.mjs` unchanged.

**Documents.** The plugin's two documents; a NEW guide page; Phase 7 (OMR)
and the piano-roll reference re-planned as later overlay plugins, citing
API surface only; DESIGN.md's *Host and plugins* section written from the
notes accumulated slice by slice; `@battuta/api` promoted to 1.0; the
release of 0.1.0.

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
