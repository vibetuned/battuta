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
| `statusBar` / `menu` / `header` | items in the three UI slots | the six status-bar selects, the battuta menu, the player row |
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
declared by every plugin. Read side: the active document (read-only
`CoreScore`, `EventIndex`, resolved contexts, effective context at a
position), caret and selections with a subscribe, tile geometry by id,
timemap per tile. Write side: `execute(command)` — the only mutation
path, so undo integrity and the byte-identical-revert property hold
for plugin commands exactly as for core ones — plus `notice()`,
`confirm()`, a settings namespace, a storage namespace (persisted with
the session), and an `activate(ctx)` / `deactivate()` lifecycle with
disposables. No render-pool access in v1 (plugins draw on the overlay
or contribute MEI; they never engrave — DESIGN.md's rule extends to
them).

**Plugins own no document state.** Anything a plugin wants to persist
about a score goes in MEI (`<annot>`, `@facs`, an `<expansion>`) or a
declared sidecar file; anything else in its storage namespace. This is
what makes "disable all plugins" a safe operation and lets the property
fuzzer cover plugin commands unchanged.

### Migration: strangler fig, one feature at a time

Extract features from `App.tsx` into `packages/plugins/*` in this
order — each extraction behaviour-neutral, gated by the e2e suites that
already cover the feature, `App.tsx` line count logged as the metric:

1. **Host skeleton** — manifest format, registry, activation, the
   keymap as a **reactive store** (core map ∪ contributions, with a
   subscribe: a panel activated late must see bindings registered
   later still), `execute`, notices, and the **MIDI service** lifted
   out of `App.tsx`/`midiOut.ts` behind one interface (Web MIDI and
   midir backends unchanged; the shell's MIDI commands become the
   service's shell backend). A **plugins tab in the 🌣 editor** lists
   every installed plugin with an on/off toggle, persisted in settings
   (`battuta.settings.v1`): off = `deactivate()` runs and its
   disposables fire — bindings leave the keymap store (the on-screen
   keyboard and shortcut editor follow live), panels close, status-bar
   and menu items vanish — with no document change and no reload.
   Keymap overrides for a disabled plugin's bindings are kept, so
   re-enabling restores the user's rebinds. This toggle is the
   user-facing face of the `--no-plugins` CI mode. No plugin yet; the
   e2e suites and the shell smoke must pass unchanged. *(≈1 week)*
2. **Reflection cycle** (`shift+R`) — the smallest self-contained
   feature: one command, one binding, one notice. Proves `commands` +
   `keybindings`. *(days)*
3. **On-screen keyboard** — proves the `panels` slot, the `header`
   slot (🎹), activation on `onPointer:coarse`, and the MIDI service's
   `registerInput`: the piano half is a **virtual MIDI input**, so it
   reaches the entry path through the same door as a hardware
   controller and the host has exactly one input kind. Its coverage
   test moves into the plugin's suite but runs against the union
   keymap, so an unreachable binding from *any* plugin still fails CI.
   *(≈1 week)*
4. **Lyrics, then harmony** — proves `lanes`; the shared mechanism
   leaves `App.tsx` with them. *(≈1 week)*
5. **Playback + MIDI out + playback-MIDI export** — proves `playback`,
   `formats`, activation on `onPlay`/`onView:page`, and moves Tone.js
   and the 2 MB piano out of the host chunk for real. *(≈1 week)*
6. **Format converters** — proves `formats` fully and takes the 4.6 MB
   Humdrum build with it. *(days)*
7. **Folder view** — a NEW feature rather than an extraction, chosen
   to prove the `workspace` point and the `shell` pattern: a side
   panel listing the opened folder's scores (every importable
   extension from the format table, dirty markers from the tabs),
   click opens through the shared open path, live `watch` refreshes
   the tree and feeds the external-change guard. Second `panels`
   consumer. Browser build: the panel is present but reports the
   shell is required. Persists the opened folder in the session.
   *(≈1 week)*
8. **Overlay point** — built against the first consumer: the **ghost
   piano-roll reference layer (old Phase 6)** as a plugin. Defines the
   per-tile draw hook by extraction, not speculation. *(≈2 weeks, and
   it delivers Phase 6)*

Extraction rule: an extension point is added only when a feature being
extracted needs it (rule of three where possible — lyrics *and* harmony
justify `lanes`; the keyboard and the folder view justify `panels`; a
single consumer justifies `overlays` only because it is the phase's
exit criterion). No speculative points.

### Lightness, enforced in CI

- **Host bundle budget**: the initial chunk (host + core + Verovio
  render worker) stays under a fixed byte size; plugin code appears in
  the initial chunk → CI fails (Vite manifest check).
- **Time to first tile** on the reference laptop stays within the
  1 s first-screen budget with all plugins installed but unactivated.
- **`--no-plugins` mode**: the editor opens, edits, undoes and saves
  with every plugin disabled; a plugin's absence never changes the
  document (property: open → save with plugins on and off → identical
  bytes).
- **Coverage tests extend to contributions**: a plugin keybinding the
  VirtualKeyboard cannot reach fails CI, as core bindings do today; a
  plugin `Command` runs under the apply-then-revert fuzzer (the harness
  is exported from core so plugins can run it in their own suites).
- **API surface is versioned and diffed**: a change to `@battuta/api`'s
  public types requires a version bump (api-extractor or an equivalent
  snapshot test).

### Exit criteria

1. The eight slices above shipped; `App.tsx` holds only the host
   (tiles, caret, selection, command execution, slots) — target under
   1,000 lines. Live file watching, open since 0.0.2, ships inside the
   folder-view slice.
2. Reference layers (old Phase 6) implemented **entirely as a plugin**:
   zero edits to `App.tsx` or the core beyond the API package. Phase 7
   (OMR) is re-planned as the second overlay plugin and its plan cites
   only API surface.
3. Every existing e2e suite green, byte-identical undo across all
   plugin commands, the CI budgets above in place.
4. Docs: a "writing a plugin" guide with the reflection plugin as the
   worked example; DESIGN.md gains a *Host and plugins* section
   (layers become: core → command → **host** → plugins; render and
   interaction layers are host services).

### Risks

- **Over-abstracting early.** Mitigated by extraction-only points and
  the rule of three.
- **React coupling.** Plugins wanting UI need slots, not the tree.
  Provide slot components that take a React node, and a small
  subscription store for caret/selection so plugins subscribe without
  prop-drilling; if plugin UI outgrows slots, that is the moment to
  evaluate a panel host, not before.
- **Undo integrity.** Plugins that mutate outside `execute` would break
  the phase's central invariant. The API exposes `CoreScore` read-only
  (frozen view or type-level readonly + a dev-mode proxy that throws on
  write).
- **Third-party code.** Deferred. If it comes: load from disk via the
  shell only, run in a worker with the message-passing API, AGPL
  implications for bundled third-party code documented first.
- **API churn while the first plugins land.** Keep `@battuta/api` at
  0.x with explicit breaking-change notes in CHANGELOG.md until the
  overlay point is stable; promote to 1.0 at the Phase 9 exit.

### Folds into this phase

Phase 6 (reference layers) becomes the overlay-point extraction above
(slice 8). Phase 7 (OMR) follows as the second overlay plugin in a
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
