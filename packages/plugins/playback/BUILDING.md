# Building the Playback plugin

## 1. Origin

An extraction, and the last of Phase 9's "move a whole feature out"
slices: PLANNING.md Phase 9, **slice 7b** (the brief), after **slice 7a**
built the host side in-house and rewrote the in-App player onto it first.
What moved, on 2026-09-15:

| Was | Is |
| --- | --- |
| `apps/editor/src/player.ts` | `src/player.ts` — the scheduler, verbatim but for `host.*` → `ctx.*`, Tone behind a dynamic `import()`, and the dropped `__SAMPLE_URL__` hook (§7.3) |
| `apps/editor/src/performance.ts` | `src/performance.ts` — unchanged but for its header comment |
| `apps/editor/src/midiExport.ts` | `src/midiExport.ts` — unchanged |
| `apps/editor/src/assets/salamander/*.mp3` (30 files, ~2 MB) | `assets/*.mp3`, reached through `src/samples.ts` |
| `App.tsx`: the player row inside `view === "pages" && (…)`, `playerState` / `playerPos` / `playerTotal` / `midiOutOn` / `midiTranspose` / `playerTempo` state, `midiSinkRef`, `TEMPO_STEPS`, `fmtTime`, `onPlayPause`, the 4 Hz polling effect, the `view !== "pages"` stop effect, the `scorePlayer.stop()` in `afterCommand` and `resetDocUiState`, and the internal `playback-midi` export registration | `src/index.tsx` and `src/TransportRow.tsx` |
| `apps/editor/test/performance.test.ts`, `apps/editor/test/midiExport.test.ts` | `test/`, assertions unchanged |
| `tone` in `apps/editor/package.json` | `tone` in this package's dependencies |

What did NOT move: the view adapter (`host.bindView`, the class toggling
on the page SVG and the scroll — the App owns the DOM), the `__PLAYBACK__`
dev hook (the host's, set by the session adapter's `timemap()`),
`midiOut.test.ts` and `sound.test.ts`-style host MIDI tests, and the
export SAVE path (the App's one door for every export).

`App.tsx` **3,133 → 2,945** (−188). Initial chunk **596.0 kB → 360.8 kB**;
`budget.json` lowered 620,000 → 377,000 bytes.

## 2. Manifest

| Declared | Why |
| --- | --- |
| `activationEvents: ["onView:pages"]` | Page view is where the player lives, and entering it is the gesture that means "I want to listen". A user who never opens page view never fetches this code, Tone.js or a sample. |
| `activationEvents: [ … "onFormat:battuta.playback.midi"]` | The export must work from a cold plugin: the host fires this when the menu row is picked with no producer registered, then asks again. |
| `capabilities: ["midi", "audio"]` | Both sinks are host services — the outputs (`ctx.midi.openOutputs`) and the app's one AudioContext (`ctx.audio`). The host refuses to register the plugin on a platform offering neither, which is the point of declaring them. |
| `contributes.exports: [{ id, label, ext, mime, title }]` | The battuta menu lists "export playback MIDI (.mid)" before a byte of this code exists. Label, ext, mime and title are verbatim from the internal registration slice 7a rehearsed the point with. |

Deliberately **not** declared:

- **No `commands`, no `keybindings`.** An extraction adds no binding: the
  union keymap snapshot has to stay byte-identical, and playback never
  had a key. `onPlay` stays reserved and unfired.
- **No `slotItems`.** The declared-item mechanism exists so a button can
  OPEN something before its plugin loads (the 🎹). The transport row is
  not an entry point — it *is* the feature, and the view that would show
  it is the same view that wakes the plugin. A declared face here would
  be a dead button between the two.
- **No `onStartup`, no `onSettings:`.** Nothing here should come back by
  itself at launch; the speed and MIDI choices are read when the row
  first renders.
- **No `lanes`, no panel.** The row belongs beside the score tempo it
  multiplies, which is the `docHeader` slot.

## 3. API surface

Everything through `@battuta/api` at **0.1.11**; this plugin added
**nothing** to it (the brief's *API may grow: None* held — but see §7.2
for the one place it shows).

**Read**
- `ctx.document` — `get()` (is anything open?) and `subscribe` (an edit
  stops the player).
- `ctx.editor` — `get().view` at activation, `subscribe` for the change.
- `ctx.query.timemap()` — Verovio's timemap of the expanded form; the raw
  material of a performance.
- `ctx.query.notation()` — which note ties into which, which marks each
  carries. Facts; `performance.ts` decides what they mean.
- `ctx.settings.get` — `tempo`, `midiOut`, `midiTranspose`.

**Write** (nothing to the document — see §5)
- `ctx.settings.set` — the same three, as the user changes them.

**Sound and sight**
- `ctx.audio.unlock()` (first thing in the click, before any await),
  `ctx.audio.context()` (handed to `Tone.setContext`), `ctx.audio.timeAt(atMs)`
  (the wall clock in the context's seconds).
- `ctx.midi.openOutputs()` → `schedule`, `panic`, `close`.
- `ctx.view.highlight(cue)` / `ctx.view.clearHighlight()`.

**Lifecycle**
- `ctx.slots.add("docHeader", …)`, `ctx.formats.registerExport(id, produce)`,
  `ctx.notice`, `ctx.subscriptions`.

**Not used, deliberately:** `ctx.execute` (there is no message to send),
`ctx.actions`, `ctx.keymap`, `ctx.lanes`, `ctx.panels`, `ctx.storage`,
`ctx.confirm`, `ctx.activatedBy` (the row's visibility comes from the
view store, not from which path woke us — see §7.5).

## 4. State

**Transient (memory).** One `signal<Transport>` — player state, position,
total, speed, the MIDI box, the transpose — plus the scheduler's own run
(wall-clock anchor, the two cursors, its timers), the opened
`MidiOutputs` handle, the Tone module and the loaded sampler, and a
`signal<ViewMode>`. All of it is safe to lose: it is a transport
position and an audio graph. Turning the plugin off or reloading starts
from silence, which is what "stopped" means anyway.

**Persisted (`ctx.settings`, this plugin's namespace).** `tempo`,
`midiOut`, `midiTranspose` — three scalars, under a hundred bytes. They
were root editor settings until this slice; the HOST carries them over
(a plugin sees only its own namespace, and the whole point is that the
old value is elsewhere): the dated list in `apps/editor/src/settings.ts`,
entry *2026-09-15 (slice 7b)*, with `apps/editor/test/settings.test.ts`
pinning it — the 4b precedent, second use.

**Storage.** None.

**Document.** None. **Nothing mutates the document outside
`ctx.execute`** — and here the stronger statement holds: nothing mutates
it at all. How I know: `ctx.execute` appears nowhere in `src/`, the
plugin's test asserts the host's session adapter received zero commands
after a full play/pause/stop/export round, and the only door to the
document is a message `toCommand` would have to build.

## 5. Command messages

**None.** Playback reads the document and writes nothing to it: the
performance is derived from the timemap and the notation facts on every
play, and nothing about a performance belongs in the score. That is what
makes "all plugins off leaves every document byte-identical" free here
rather than careful, and it is also why this plugin needed no message
type, no `toCommand` case and no core change.

## 6. Tests

`npm run test:plugins` (or `npx vitest run --root packages/plugins/playback`) — 30 tests:

| Suite | Pins |
| --- | --- |
| `test/performance.test.ts` (8) | The interpretation: tie chains merged into one attack over the summed span, clone ids resolved through `idMap`, the gate table (staccato ½, staccatissimo 0.3, tenuto/slur 1.0, everything else 0.9), and a whole performance built from a timemap plus facts. Moved from the editor with its assertions unchanged; the merge cases came from core in 7a. |
| `test/midiExport.test.ts` (6) | The SMF: 1 tick = 1 ms at 500 ppq, balanced on/off pairs, one attack per tie chain, gates in the release times, marks looked up by the notated id for cloned passes, transposition clamped to MIDI range, offs before ons at the same tick. Moved unchanged. |
| `test/playback.test.ts` (16) | The plugin against a real `createHost`: the export listed and the row absent before any code loads; page view loading it exactly once; the export produced from a cold plugin; the row's settings read and written in the plugin's namespace (and a hand-edited speed or transpose refused); a whole performance sent to a fake MIDI backend, with the port named in a notice, the notation lit, and the transpose applied to the sends; the no-output fallback notice; **stop on leaving page view** and **stop on an edit**; pause/resume; the export honouring the same transpose; and the switch taking the row and the export away together with zero commands executed. |

The MIDI sink is what makes this testable without a browser: the
performance drives both sinks identically, so choosing MIDI runs the
entire transport in node — no `AudioContext`, no Tone.js, no samples.
The piano half is the browser script's.

Host-side: `apps/editor/test/settings.test.ts` gains 7 cases for the new
migration entry; `apps/editor/test/plugin-boundaries.test.ts` scans this
package like any other (no `@battuta/core`, no DOM global, both
documents, `@battuta/api` + `react` + `tone` only).

**Gates, all green and unchanged:**
- `spikes/verify-phase5.mjs` — the playback section (7n), **not one hook
  touched**: `data-player-toggle`, `data-player-stop`, `data-player-tempo`,
  `data-player-progress`, `data-player-time`, `.pages g.playing` and the
  `__PLAYBACK__` dev hook (the host's) all read what they read in 0.0.3.
- `verify-app`, `verify-phase2/3/4`, `verify-lyrics`, `verify-onscreen-keyboard`.
- `apps/editor/test/keymap-snapshot.test.ts` — byte-identical; playback
  contributes no binding.
- `npm run budget -w @battuta/editor` with the **lowered** ceiling, and
  `dist/.vite/manifest.json` showing the entry importing neither the
  plugin chunk nor the Tone chunk.
- `sh spikes/verify-tauri.sh` — with one probe now inert, §7.3.

## 7. Dead ends

Start from `harmony/BUILDING.md` §7 and `onscreen-keyboard/BUILDING.md`
§7.6 — the UI traps there (activation before the handler, a panel that
subscribes instead of being re-opened, a shared module Rollup settles
inside a plugin chunk) all still apply, and §7.1 below is the third
sighting of the last one. What follows is what this slice cost.

### 7.1 The 700-byte module that put the whole plugin in the initial chunk

The build was green, the tests were green, and `npm run budget` failed:

```
FAIL  plugin code reached from the initial chunk: assets/plugin-playback-*.js
```

Nothing imports this plugin statically. The cause was **Vite's
`__vitePreload` helper**: it is emitted once for the whole build and
shared by every module with a dynamic import. Until this slice only the
host had one (the plugin loader), so Rollup kept the helper in the
entry's own closure. This plugin is the first with dynamic imports of its
own (Tone.js and the samples, which the brief requires), the helper
became *shared*, `manualChunks` had no opinion about it — and Rollup
resolved the tie by putting it inside `plugin-playback`, so the entry had
to import that chunk statically to get it. 13 kB of plugin in the initial
chunk for a helper the size of a tweet.

Finding it took the method this repo's own `packages/plugins/README.md`
prescribes and which is worth repeating because the instinct is to grep
the output: **ask Rollup what is in the chunk.** A throwaway config
adding a `generateBundle` hook that prints `Object.keys(chunk.modules)`
named the intruder in one run:

```
=== assets/plugin-playback-*.js (plugin-playback) ===
   vite/preload-helper.js        ← there it is
  …/src/index.tsx, player.ts, performance.ts, midiExport.ts, TransportRow.tsx
```

The fix is one line in `apps/editor/vite.config.ts`, next to the two that
were already there for the same reason: `if (f.includes("vite/preload-helper")) return "battuta-shared";`.
**This is a host edit the brief did not list** (it allows the settings
migration, `tone` leaving the editor's `package.json`, and `budget.json`);
it is recorded here and in the CHANGELOG rather than passed over,
because the rule it follows was already written in that file — *anything
the host and a plugin share must be named* — and because the slice's own
gate ("the entry imports neither the plugin chunk nor the Tone chunk")
cannot pass without it. Core in slice 2, React in slice 4, the preload
helper in 7b: the third instance of one rule, and the first where the
shared module was Vite's own rather than a dependency anyone chose.

### 7.2 The export's file name — an unresolved gap, on purpose

0.0.3 saved this export as `<score>-playback.mid`. The suffix is not
decoration: the Verovio-backed **MIDI (written score)** export writes
`<score>.mid`, and the two are different files — one is what the page
says, the other is what this player does with repeats, ties and gates.

The plugin cannot reproduce that name. `ExportPayload.filename` exists
precisely so a producer can override the host's default `<document>.<ext>`,
but building `<score>-playback.mid` needs the open document's **file
name**, and `DocumentInfo` carries `title` (the MEI title — often empty,
and not the tab's name) and nothing else. The App could do it because it
held the `OpenDoc`.

Three ways out, and why none was taken:

- **Add `DocumentInfo.name`.** One field, obviously right, five minutes.
  It is also exactly what *API may grow: **None*** forbids, and what the
  brief means by "Write the gap; do not resolve it". Not done.
- **Use `title` when it is non-empty.** Inventing a naming rule nobody
  asked for, which would be wrong for every untitled score and different
  from 0.0.3 for every titled one.
- **Put the suffix in `ext` (`ext: "playback.mid"`).** The menu row would
  then read "export playback MIDI (.playback.mid)". A fudge that lies in
  the UI to fix a file name.

**What ships:** the producer returns no `filename`, so the host's default
applies and the file is saved as `<score>.mid` — which **collides with
the written-score MIDI export's name**. That collision is the gap made
visible rather than papered over, and it is the one place this slice is
not behaviour-identical to 0.0.3.

**What the API would need:** the open document's file name on
`DocumentInfo` (`name`, alongside `title`) — one field, with this export
as its named consumer, and a second one waiting in slice 9's folder view,
which lists scores by file name. That is the addition to propose; it is
the user's to approve, not this slice's to take.

*Resolved the same day (2026-09-15, in-house).* `DocumentInfo.name` is on
the api at 0.1.12 — the tab's name, the file's base name without its
extension, as distinct from the MEI `title` — with this export as its
first consumer and slice 9's folder view as the second. The producer
returns `filename: <name>-playback.mid` and the collision with the
written-score MIDI export is gone; the plugin's test asserts the name.
The three ways out above were the right list, and the first one was
right — it was simply not the slice's to take, and handing over a precise
gap cost a day less than arguing a guess.

### 7.3 `window.__SAMPLE_URL__`, and a shell probe that is now inert

`player.ts` used to publish the URL of one mp3 on `window` so the Tauri
shell's self-test could fetch it and run it through `decodeAudioData` —
WebKitGTK's mp3 support rides gstreamer plugins and varies per system, so
it is verified rather than assumed (`src-tauri/src/main.rs`, probe3).

A plugin may not do this: rule 4 is "no DOM — `window`, `document`,
`navigator`, `localStorage`, `sessionStorage` never appear as globals".
And even if it could, the hook would no longer exist at startup: the
samples are behind two levels of lazy loading now, so nothing of them
exists until someone presses play in page view.

So the hook is gone and **probe3 self-disables** — it begins
`if (!inv || !window.__SAMPLE_URL__) return;`, and `verify-tauri.sh` never
asserted its output, so the shell smoke stays 6 of 6. That is an honest
description of a check that has quietly stopped checking, which is worth
more than a green line. Reviving it needs one of: a host-side way to name
a plugin's asset (an API addition, with this as its only consumer — thin);
or the probe driving the real UI (page view → ▶) instead of fetching a
URL, which is a `main.rs` change and outside this brief. Written here,
not resolved.

*Worth knowing for whoever tightens the rules:* the old line was
`(window as unknown as Record<string, unknown>)["__SAMPLE_URL__"] = …`, and
`plugin-boundaries`' DOM check would **not** have caught it — its regex
wants `window` followed by `.`, `[` or `(`, and a cast puts ` as` in
between. The rule was followed here because it is the rule, not because a
test forced it. The regex is the user's to tighten; a slice does not edit
the rule files.

*Both resolved the same day (2026-09-15, in-house).* The probe now drives
the real UI from `main.rs`: it clicks *page view* (which wakes this plugin
— its chunk, then Tone's, must resolve over `tauri://`), presses ▶ once
the pages have rendered, and waits for a lit note; since the player loads
the Salamander mp3s through `decodeAudioData` before it starts, a lit
note proves WebKitGTK's mp3 support the way the old hook did, and proves
the lazy chunks besides. `verify-tauri.sh` asserts it (a seventh check),
where the old probe was never asserted. And the DOM-global rule was
tightened to catch a bare reference — `(window as …)`, `typeof window`,
`window,` — while still ignoring `ctx.document` and object keys or type
members named `document`; the cast that slipped past is now a test case.

### 7.4 A dynamic import inside a plugin cannot split the plugin's chunk

`src/samples.ts` is imported dynamically so the 30 sample URLs are not in
the chunk that page view loads. They are anyway: `manualChunks` maps
**every** file under `packages/plugins/<name>/` to `plugin-<name>`, and a
manual assignment beats a dynamic import boundary, so `samples.ts` and
its 30 asset modules were folded straight back in.

Measured before deciding it did not matter: the plugin chunk is 13.0 kB
(5.5 kB gzipped) with them and would be ~11 kB without. The mp3 **files**
are separate assets either way and are fetched only when the sampler
loads, which is the 2 MB that actually mattered. Left alone: an exception
in the host's `manualChunks` to carve a sub-chunk out of one plugin would
cost more than the 2 kB it saves. The dynamic import stays, because it is
still what keeps the URLs out of the *eager* evaluation path and because
it is the shape that would pay off the moment the glob grows.

The general form, for the next plugin with a big asset: **inside a
plugin, `import()` buys you lazy execution, not a lazy chunk** — the
chunking is the host's `manualChunks` and it is coarser than your
imports. Anything in `node_modules` (Tone.js here, 332.5 kB) *does* get
its own chunk, because `manualChunks` says nothing about it.

### 7.5 The row is one item that renders null, not an item added and removed

The obvious reading of "rendered only while the view is pages" is to add
the slot item on `onView:pages` and dispose it on the way out. That is
wrong twice over, and the second reason is 4b's §7.6 with a new face:

- The host fires `onView:pages` to **activate** the plugin; after that
  the plugin is simply active, and disposing its only slot item when the
  user glances at tile view leaves nothing to come back — `onView:pages`
  does not fire again for an already-active plugin's benefit, it fires
  into `registry.fire`, which is a no-op once activated.
- Every flip would **remount** the row's component. Mid-play that means a
  progress readout restarting from the store's last published value, and
  a `<select>` losing focus under the user's hand.

So: one item, registered once in `activate`, whose component subscribes
to a `ViewMode` signal and returns `null` outside page view. In tile view
the second header row has exactly the DOM it had before this plugin
existed, and the item is still there, still subscribed, still not
remounted. The plugin's test asserts both halves (the item stays
registered, the component's view store says `tiles`).

The same subscription is where **leaving page view stops the player** —
the row would otherwise vanish with a note still sounding.

### 7.6 No `deactivate()`

Written first as `activate` + `deactivate`, with a module-level
`let running: Disposable | null` to carry the timer, the ports and the
sampler from one to the other. It works and it is worse:

- Everything this plugin owns is already a disposable the host tracks,
  and the host disposes them **in reverse registration order** — so a
  teardown added last is released first, before the row that drove it.
  The second copy of the teardown is a chance to disagree with the first.
- Module-level state is per *realm*, not per host. Two `createHost()`s in
  one test file — which is exactly how this plugin's suite is written —
  would share that `let` and the second would clobber the first.

`deactivate` is for work that must happen *before* the disposables fire.
This plugin has none, so it has no `deactivate`, and "off" is complete by
construction. (The on-screen keyboard reached the same place from the
other direction.)

### 7.7 `"//"` is a package.json convention, not a tsconfig one

The `"//"` key every plugin's `package.json` carries for a prose note is
a plain JSON key npm ignores. tsc is not so relaxed:
`tsconfig.json(6,5): error TS5023: Unknown compiler option '//'`. Use a
`//` comment — tsconfig is JSONC — or nothing. Ten seconds to fix, and
avoidable.

### 7.8 What did not happen

- **No api addition** — the brief said *None* and it held, with §7.2 as
  the one honest exception written up rather than taken.
- **No new host module**, no change to the host's allowlist.
- **No keymap change**: playback has no key, so the union snapshot is
  byte-identical.
- **No `ctx.activatedBy`**: the keyboard plugin needs it because its
  command *toggles* what `activate` would open. Here the two wake-up
  paths (`onView:pages`, `onFormat:`) both want exactly the same thing —
  register everything, show nothing that the view store does not already
  say to show — so the table has one row and no conflict.
- **One behavioural difference, small and deliberate**: an edit used to
  stop playback synchronously inside `afterCommand`; it now stops when
  the host republishes `ctx.document`, which is after the App's render
  commit. A few milliseconds of already-scheduled sound. Making it
  synchronous again would mean a host hook for "an edit is about to
  happen", which is a mechanism nobody has asked for.

## 8. Recipe

The shortest path to a plugin like this one — a feature with real
transient state, a host slot, a lazy heavy dependency and an export.

1. **Read the brief, then `packages/plugins/README.md`'s "Reading and
   writing the document" table.** Ask what the feature needs the editor
   to DO (hand out an audio context, light a note, list an export), not
   what its current code CALLS. Everything this plugin needed existed,
   because 7a built it against this plugin as its named consumer.
2. **`git mv` the code before changing a line of it.** `src/*.ts` and
   `test/*.test.ts` move first and must still pass; only then swap
   `host.*` for `ctx.*`. A moved test that fails on arrival is usually
   the move, not the thing moved (harmony's §7.1).
3. **Scaffold**: copy `onscreen-keyboard/package.json` (it has react) and
   its `tsconfig.json`; add `"lib": ["ES2022", "DOM"]` if you name a
   platform type, and `tone` to dependencies if you make sound. No
   vitest config — vitest's defaults find `test/**`.
4. **Write `src/manifest.ts` first**, with every shared string as an
   exported const. Then the three registrations outside the package:
   `apps/editor/src/host/plugins.ts`, the editor's `package.json`
   dependency, `npm install` at the root.
5. **`activate` owns the wiring, the component owns the subscriptions.**
   Copy the six-line `useStore` from `TransportRow.tsx`, hold your state
   in one `signal`, pass the store and a flat `actions` object into the
   component. Never re-open a panel or re-add an item to refresh it.
6. **Move settings with the host.** A root setting that becomes a
   plugin's needs a dated entry in `apps/editor/src/settings.ts` and its
   cases in `apps/editor/test/settings.test.ts`. A plugin cannot do it
   itself.
7. **Check at each step**, in this order — each one catches a different
   class of mistake:
   ```sh
   npm run typecheck -w @battuta/plugin-<name>
   npm run typecheck -w @battuta/editor
   npx vitest run --root packages/plugins/<name>
   npm test -w @battuta/editor          # boundaries, keymap snapshot, settings
   npm run build -w @battuta/editor && npm run budget -w @battuta/editor
   ```
   The budget step is the one that finds what nothing else can (§7.1). If
   it reports plugin code in the initial chunk, do not grep the bundle —
   add a `generateBundle` hook that prints `Object.keys(chunk.modules)`
   and read the answer.
8. **Then the browser scripts**, one at a time, and the two documents.
   `§7` is the one section the next author will actually need: write the
   experiments that failed, not the summary of the one that worked.
