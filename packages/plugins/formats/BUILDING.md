# Building the Format converters plugin

> Slice 8b was attempted on 2026-09-16 and **stopped** — an export
> producer had no way to read the document. That attempt's account is
> `POSTMORTEM-2026-09-16.md` in this directory, and it is still the file
> to read first: it settles the ids, the table's home, the worker and why
> nothing was delivered half-way. The gap was closed in-house the same
> day (`ctx.query.mei()`, api 0.1.14) and the slice ran again. §7 below
> carries only what the *second* attempt cost.

## 1. Origin

An extraction, and the last of Phase 9's format work. PLANNING.md Phase
9, **slice 8b**, after **8a** (2026-09-15) built the import half of the
`formats` point and **8a's fixes** (2026-09-16) added the one query the
first attempt stopped on.

| Was | Is |
| --- | --- |
| `apps/editor/src/converter.ts` | `src/converter.ts` — the worker handle, plus a `dispose()` (§7.2) |
| `apps/editor/src/render/convertWorker.ts` | `src/convertWorker.ts` — unchanged but for its header |
| `apps/editor/src/formats.ts` — `IMPORT_FORMATS` / `EXPORT_FORMATS` | `src/manifest.ts`, with each entry's Verovio call named (`from` / `op`) beside its contribution; the file is gone |
| `App.tsx`: five `registerImport` calls and four `register` exports | `src/index.ts` — eight registrations; **SVG stays in `App.tsx`**, alone (§7.1) |
| `apps/editor/test/convert.test.ts` + `test/fixtures/sample.mxl` | `test/`, assertions unchanged |
| `verovio/wasm-hum` in the editor's ambient types | `src/verovio.d.ts`, narrower (§7.3) |

What did NOT move, and should not: `formats.detect` and the open
dialog's accept list (the host's since 8a — a plugin declares extensions
and roots, never a sniffer), the App's open and save paths, and the SVG
export.

`App.tsx` **2,946 → 2,935**. Initial chunk **365.0 → 364.5 kB** (the
App's registrations left; this plugin's manifest joined
`battuta-shared`). The number that matters is elsewhere: the **13.45 MB**
`convertWorker` asset is now referenced by `plugin-formats-*.js` and by
nothing else, and the entry's static closure is `battuta-shared` alone.

## 2. Manifest

| Declared | Why |
| --- | --- |
| `contributes.imports` — five entries, ids `battuta.formats.{musicxml,mxl,abc,pae,humdrum}` | The open dialog accepts `.musicxml .xml .mxl .abc .pae .krn .kern` before a byte of this code exists. `mxl` carries `binary: true` (a zip: the host hands the converter bytes); `musicxml` carries `roots: ["score-partwise", "score-timewise"]`, which is how a MusicXML `.xml` is told from an MEI one — **declared, never sniffed**. |
| `contributes.exports` — three entries, ids `battuta.formats.{midi,humdrum,pae}` | The battuta menu lists all three before the plugin loads. Labels, `ext` and `mime` verbatim from the 0.0.3 table, so the rows read as they did. |
| `activationEvents` — `onFormat:<id>` for each **distinct** id: **six, not eight** | PAE and Humdrum go both ways and share one id. See `POSTMORTEM-2026-09-16.md` §7.4: an activation event names a capability the user reached for, not a function signature. |

Deliberately **not** declared: no `capabilities` — a worker is a plugin's
to ship, not a host service to ask for, and proving that was half the
point of the slice; no `onStartup` (a session that only ever touches MEI
must never fetch the toolkit); no commands or keybindings (an extraction
adds no binding — the union keymap snapshot is byte-identical); no slot
items, lanes or panel.

The **format table lives in the manifest**, not in a module beside it:
rule 3 says `src/manifest.ts` may import nothing but `@battuta/api`, and
the manifest is what must declare the formats. `src/index.ts` imports it
back from there.

## 3. API surface

`@battuta/api` **0.1.14**; this plugin added **nothing** to it. The one
addition it needs (`ctx.query.mei()`) was made in-house first, after the
first attempt stopped on it.

**Read**
- `ctx.query.mei()` — the document as MEI text, score-based: the same
  serialisation the pages are engraved from, so an export can never
  disagree with what is on screen. Every export producer's input.

**Register**
- `ctx.formats.registerImport(id, convert)` — `convert(file: ImportFile)
  => Promise<string>`. The host has already decided the file is ours and
  read it as the manifest asked; the converter returns MEI and the host
  opens it as a new unsaved document.
- `ctx.formats.registerExport(id, produce)` — `produce() =>
  Promise<ExportPayload>`; the host saves through its one export path.

**Lifecycle**
- `ctx.subscriptions` — one entry beyond the eight registrations: the
  worker's teardown (§7.2).

**Not used, deliberately:** `ctx.execute` (§5), and all of `ctx.document`,
`ctx.editor`, `ctx.slots`, `ctx.panels`, `ctx.notice`, `ctx.settings`,
`ctx.storage`, `ctx.actions`, `ctx.keymap`, `ctx.midi`, `ctx.audio`,
`ctx.view`, `ctx.activatedBy`. This is the narrowest plugin in the
repository: two registration calls and one query.

## 4. State

**Transient (memory).** One `Worker` and its pending-request map, in a
module-level singleton (`converter`) — created on the FIRST conversion
and kept for the session, because instantiating the Humdrum toolkit costs
≈12 MB of WASM and every conversion after the first is then instant.
Safe to lose: `onerror` already drops it and the next request spawns a
fresh one.

**Persisted.** None — no `ctx.settings`, no `ctx.storage`.

**Document.** None. **Nothing mutates the document outside
`ctx.execute`** — and the stronger statement holds: this plugin never
touches the open document at all. An import returns MEI *text* and the
HOST opens it; an export reads through `ctx.query.mei()`. How I know:
`ctx.execute` appears nowhere in `src/`, and `test/formats.test.ts`
asserts the host's session adapter received zero commands after a full
import.

## 5. Command messages

**None**, in either direction, and by design rather than omission: an
import hands back text for the host's open path, and an export reads. A
converter that sent `core.*` messages would be *editing the current
document* instead of opening a new one — exactly the bug the "converted
files arrive as a new unsaved tab" rule exists to prevent (a plain ctrl+s
must never overwrite someone's `.musicxml` with MEI).

## 6. Tests

`npm run test:plugins` (or `npx vitest run --root packages/plugins/formats`) — 24 tests:

| Suite | Pins |
| --- | --- |
| `test/convert.test.ts` (7) | The table against the REAL Humdrum toolkit: every text import loads its sample and yields MEI with notes in it, every import has a sample, `.mxl` imports through the zip loader even after a leaked `inputFrom` (the worker's own sequence), and all three exports produce output with a real `MThd` header on the MIDI. Moved from the editor with its assertions unchanged; its `svg` row went with SVG (§7.1). |
| `test/formats.test.ts` (17) | The plugin against a real `createHost()` and a FAKE `Worker`: the accept list and the three menu rows before any code loads; detection across every extension and the `.xml` root both ways, all of it from the manifest with zero loads; each id handing the worker the Verovio `from` / `to` it names; bytes for `.mxl` and text for the rest; MIDI decoded from base64 to real bytes and the text formats not decoded; an export reading `ctx.query.mei()`; refusal with nothing open; one worker serving both directions and none spawned by activation alone; and the switch taking the accept list and the rows away together **and terminating the worker**. |

The fake `Worker` is the same kind of seam the playback suite uses for
the MIDI backend, and it earns its keep: the id → Verovio mapping
(`battuta.formats.abc` → `inputFrom: "abc"`) is the one thing this plugin
can get wrong that nothing else in the repository checks — `convert.test.ts`
tests the toolkit, the host's tests test the registry, and only this sees
the message on the wire.

**Gates, all green:**
- `spikes/verify-formats.mjs` — **14 checks, every assertion identical.**
  Two design-dependent changes only: the `.mxl` fixture's path (it lives
  with the pinning test, which is the plugin's now) and the three export
  ids. The downloads are still `tune.mid` (SMF header), `tune.krn`
  (`**kern`), `tune.pae`, `tune.svg`.
- `apps/editor/test/plugin-boundaries.test.ts` — including rule 1b: no
  engraving or layout call anywhere in this package.
- `verify-app` 18, `verify-phase2` 20, `verify-phase3` 21,
  `verify-phase4` 67, `verify-phase5` 221, `verify-lyrics` 25,
  `verify-onscreen-keyboard` 24; the shell smoke 7 of 7.
- Editor 130, core 224, api 20, plugins 186.
- The union keymap snapshot, byte-identical.
- `npm run budget` — 364.5 kB against the 368.2 kB ceiling, and
  `dist/.vite/manifest.json` showing the entry importing `battuta-shared`
  alone.

## 7. Dead ends

`POSTMORTEM-2026-09-16.md` §7 is the first attempt's, and all of it still
applies — §7.1 (the export half had no document, and why an in-house
rehearsal hid it), §7.2 (why the halves do not separate), §7.3 (a plugin
can own a Vite worker; the `vite.config.ts` edit the brief allowed is
unnecessary), §7.4 (one id per format), §7.5 (the table's home, SVG's
exclusion), §7.6 (narrow the ambient types). Read it first. What follows
is what the second attempt added.

### 7.1 SVG had to leave the table, not just the plugin

The brief says SVG stays the host's, and the reflex is to keep the
four-entry `EXPORT_FORMATS` intact and register three of them. That is
wrong in two places at once:

- The plugin's table would list a format it never registers — and
  `test/convert.test.ts` iterates that table against the toolkit, so it
  would have asserted `renderToSVG` from the CONVERTER build. Rule 1b
  exempts test files, so nothing would have failed; it would just have
  been a plugin's test engraving a page to prove a converter works.
- The App would keep importing `EXPORT_FORMATS` from a plugin package to
  find its one entry, which the boundary forbids in the other direction
  and which makes no sense in this one.

So SVG left the table entirely and the App carries its entry inline, as
the one literal it needs:

```tsx
host.formats.register({ id: "svg", label: "SVG (pages)", ext: "svg", mime: "image/svg+xml" }, …)
```

The general form, worth keeping: **a table that is the single source of
truth for X must contain exactly the things that are X.** This one is
"what the bundled Verovio can CONVERT". SVG is engraving, and it was only
ever in the table because the menu happened to be built from it.

### 7.2 A 12 MB worker is a disposable, and the singleton hides that

`converter` is a module-level singleton — one worker per session, shared
by both directions — which is right, and which quietly makes "off" a lie:
the registrations dispose, the menu rows and the accept list vanish, and
a 12 MB WASM worker keeps running for a plugin the user has just turned
off.

The playback plugin had the same shape and got it right (its sampler is
dropped on deactivate); here it was easy to miss because nothing the user
can see is holding on. Fixed by giving `Converter` a `dispose()` —
terminate, reject anything in flight, null the handle so `ensure()`
spawns a fresh one if the plugin comes back — and adding it to
`ctx.subscriptions` **last**, so it is disposed *first* and nothing is
still converting when the worker goes.

> **"Off" is measured in what is released, not in what disappears from
> the UI.** If a plugin owns anything the platform counts — a worker, a
> port, an audio graph — the test for "off" should assert the release,
> not the absence of the button.

`test/formats.test.ts` asserts `terminated === 1` after the switch, which
is the assertion that would have caught it.

### 7.3 The test seam this plugin needed was the platform, not the plugin

The plugin's suite has to run in node, where `Worker` does not exist —
so every path through `converter` is unreachable, which at first looks
like "this plugin is only testable in a browser".

The first instinct was to make `converter` injectable (a `setConverter()`
seam, or passing it into `activate`). Both put a hole in the production
code purely for the test, and the second changes the plugin's shape for
no reason a user would recognise.

The answer was to fake the **platform** instead: a `FakeWorker` class on
`globalThis`, which is exactly what the playback suite does with the MIDI
backend and what the host's tests do with `AudioContext`. Production code
untouched, and the test now sees something no other suite can — the
actual message on the wire, `{ type: "import", from: "abc", text }`,
which is the one place the id → Verovio mapping can be silently wrong.

> **When a plugin is hard to test because a platform global is missing,
> stand in the global, not a seam in your own code.** A seam you added
> for a test is a seam a reader has to explain.

One consequence to know: the singleton outlives `createHost()`, so the
suite disposes it in `beforeEach`. That is the test isolating itself from
a deliberate design, not a smell.

### 7.4 What did not happen

- **No api addition** — 0.1.14 unchanged. The one this slice needed was
  made in-house first, which is the whole shape of the 7a/7b and 8a/8b
  pattern.
- **No `vite.config.ts` edit.** The brief allowed one for the worker's
  chunk; the first attempt measured it unnecessary (POSTMORTEM §7.3) and
  the second confirmed it: the worker is emitted correctly and referenced
  only from the plugin chunk.
- **No new host module, no keymap change, no command message.**
- **The initial chunk barely moved** (365.0 → 364.5 kB), and that is
  expected: the worker was never in it. The slice's number is the 13.45 MB
  asset changing owner, which the dist shows and the budget check does
  not. Worth saying out loud, because "the budget barely moved" reads
  like a failed extraction if you only look at one number.

## 8. Recipe

The shortest path to a plugin like this one — a converter with a heavy
worker, no UI and no document writes.

1. **Check the contract before moving anything.** List what the feature
   needs the editor to DO, in the host's vocabulary, and find each one on
   the api. This slice's first attempt skipped that and discovered
   mid-extraction that an export producer cannot read the document —
   three hours to find one missing query. Five minutes with
   `packages/plugins/README.md`'s table would have found it.
2. **`git mv` the code before changing a line**, and keep the moved tests
   passing before touching anything else.
3. **Scaffold** from this package: no react; `lib: ["ES2022", "DOM",
   "WebWorker"]` if you own a worker; a **narrow** ambient `.d.ts` for
   any untyped dependency (§7.3 of the postmortem — declare only what you
   are allowed to call, and the boundary becomes a compile error).
4. **The table goes in `src/manifest.ts`** if the host must know it
   before loading you. Rule 3 leaves no alternative, and it is the right
   place anyway.
5. **`src/index.ts` should be short.** Here: two loops and a base64
   decode. If a converter plugin's entry point is long, the host is doing
   too little or the plugin is doing something that is not converting.
6. **Own a worker? Dispose it** (§7.2), and add the teardown to
   `ctx.subscriptions` last so it runs first.
7. **Check in this order** — each catches a different class of mistake:
   ```sh
   npm run typecheck -w @battuta/plugin-<name>
   npm run typecheck -w @battuta/editor
   npx vitest run --root packages/plugins/<name>
   npm test -w @battuta/editor          # boundaries, keymap snapshot, host registry
   npm run build -w @battuta/editor && npm run budget -w @battuta/editor
   node spikes/verify-formats.mjs       # then the others, one at a time
   ```
8. **Then confirm the claim the slice actually makes.** For this one it
   was not the budget line but `dist/.vite/manifest.json`: the worker
   referenced by the plugin chunk and nothing else, and the entry's
   static closure unchanged. Check the thing you said you moved, not the
   number that happens to be printed.
