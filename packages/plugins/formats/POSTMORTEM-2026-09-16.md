# Slice 8b, first attempt — post-mortem

> **This plugin does not exist yet.** Slice 8b was attempted on
> 2026-09-16 and **stopped**: the export half could not be built inside
> the brief's *API may grow: **None***, and the import half cannot ship
> without it (§7.2). Nothing was left in the tree — the repository is
> exactly as `037fc40 slice 8a` left it. This file is the post-mortem
> (the attempt's BUILDING.md, renamed the way the reflection and
> on-screen keyboard attempts were), written into the place the plugin
> will occupy so that whoever retries the slice finds §7 and §8 already
> waiting; the retry's own BUILDING.md starts from §7 here. The gap it
> stopped on was closed in-house the same day — §7.1's resolved note. Sections 2–6 describe what
> was **designed and typechecked**, not what shipped; they are here
> because the next attempt should not re-derive them.
>
> **The one thing blocking it:** an export producer needs the document's
> MEI, and a plugin has no way to obtain it. §3 has the precise shape.

## 1. Origin

An extraction. PLANNING.md Phase 9, **slice 8b**, after **slice 8a**
(2026-09-15, in-house) built the import half of the `formats` point and
rehearsed both halves with the App's own converters as INTERNAL
registrations.

What the slice was to move out of `apps/editor/src`:

| Was | Would be |
| --- | --- |
| `converter.ts` — the main-thread handle, worker spawned lazily and kept for the session | `src/converter.ts`, unchanged but for the worker's path and its header |
| `render/convertWorker.ts` — Verovio's Humdrum-enabled build, ≈12 MB of WASM | `src/convertWorker.ts`, unchanged |
| `formats.ts` — `IMPORT_FORMATS` / `EXPORT_FORMATS`, the pinned table | `src/manifest.ts` (§7.5: it cannot be its own module) |
| `App.tsx`: five `host.formats.registerImport` calls and three converter-backed `host.formats.register` calls | `src/index.ts` |
| `test/convert.test.ts` + `test/fixtures/sample.mxl` | `test/`, assertions unchanged |
| `verovio` in the editor's dependencies (the converter subpaths) | the plugin's dependencies; the editor keeps `verovio` for the render pool |

What was **not** to move, and still should not: the SVG export
(engraving, from the render pool — the host's), `formats.detect` and the
open dialog's accept list (the host's since 8a), and the App's open and
save paths.

The tree is unchanged: `App.tsx` 2,942 lines, initial chunk **365.0 kB**
against the 368.2 kB ceiling, api **0.1.13**.

## 2. Manifest

Designed and typechecked; not shipped. Worth keeping verbatim — every
line of it survived the attempt.

```ts
const ID = "battuta.formats";
export interface ImportFormat extends ImportContribution { from: "musicxml" | "mxl" | "abc" | "pae" | "humdrum" }
export interface ExportFormat extends ExportContribution { op: "midi" | "humdrum" | "pae"; binary?: boolean }
```

| Declared | Why |
| --- | --- |
| `contributes.imports` — five entries, ids `battuta.formats.{musicxml,mxl,abc,pae,humdrum}` | Labels verbatim from the 0.0.3 table (`verify-formats.mjs` reads them in the notice: "imported tune.abc (ABC → MEI)"). `mxl` carries `binary: true`; `musicxml` carries `roots: ["score-partwise", "score-timewise"]`, which is what tells a MusicXML `.xml` from an MEI one — declared, never sniffed (detection is the host's). |
| `contributes.exports` — three entries, ids `battuta.formats.{midi,humdrum,pae}` | The battuta menu lists them before the code loads. SVG is **not** among them (§7.5). |
| `activationEvents` — `onFormat:<id>` for each **distinct** id: **six, not eight** | PAE and Humdrum go both ways and share one id (§7.4). Opening a `.krn` and exporting Humdrum are the same wake-up. |

Deliberately **not** declared: no `capabilities` (a worker is a plugin's
to ship, not a host service to ask for — this is the slice's second
claim after the budget one); no commands, no keybindings (an extraction
adds no binding — the union keymap snapshot must stay byte-identical);
no `onStartup` (a session that only ever touches MEI must never fetch
the Humdrum build); no slot items, lanes or panel.

## 3. API surface

`@battuta/api` **0.1.13**. The import half is complete. The export half
is not, and that is the whole of the stop.

**What an import needs, and has** — verified by building it:

- `ctx.formats.registerImport(id, convert)` where
  `convert(file: ImportFile) => Promise<string>`.
- `ImportFile` — `{ name, text?, bytes? }`. The host has already decided
  the file is ours (`formats.detect` from the declared extensions and
  roots) and read it the way the manifest asked (`binary` → bytes).
- The MEI string back. The host opens it as a **new unsaved** document.

Nothing else. An import is a pure function of the file it is handed, and
that is exactly what the brief's stop condition permits.

**What an export needs, and does not have:**

```ts
// packages/api/src/formats.ts, as 8a shipped it
registerExport(id: string, produce: () => Promise<ExportPayload>): Disposable;
//                                   ^^ takes nothing
```

`converter.fromMEI(op, mei)` needs the score as text. No member of
`PluginContext` yields it: `DocumentQueries` answers `pitchEventsIn`,
`blockOf`, `lyricAt`, `harmAt`, `harmValid`, `timemap()` and
`notation()`, and `DocumentInfo` carries `id`, `version`,
`measureCount`, `staffCount`, `title`, `name`, `tempo`. There is no
serialization anywhere on the surface — by design, since api-first means
plugins see data and not the model.

**The addition to propose**, with two shapes and a recommendation:

| | Shape | Argument |
| --- | --- | --- |
| a | `DocumentQueries.documentMEI(): Promise<string \| null>` | Simple, and serves any future whole-score reader (a validator, an analysis export). But it puts the entire document on the general query surface for every plugin. |
| **b** | `registerExport(id, (doc: { mei: string; name: string }) => Promise<ExportPayload>)` | **Recommended.** Mirrors the import half exactly — *file in / MEI out*, *MEI in / file out*. No new query, and a plugin that is not an exporter still cannot read the whole score. The producer stays a pure function of what it is given, which is the property that made the import half easy. |

Either way the host must decide **which** serialization, and the
existing answer is `session.serializeForPageView()` — it injects the
synthesized `♩=` marking copy-on-write, so an export cannot disagree
with what page view engraves. `saveDocument()` would be a silent
behaviour change to all three exports.

Named consumers, as the conventions require: this plugin's three
exports today; nothing else yet — which is an argument for shape (b),
whose surface is exactly one parameter rather than a query every plugin
can call.

## 4. State

**Transient (memory).** One `Worker` and its pending-request map, created
on the FIRST conversion and kept for the session — the Humdrum toolkit
costs ≈12 MB of WASM to instantiate and every conversion after the first
is then instant. Safe to lose: `converter.ts` already drops the worker
on `onerror` and a fresh attempt gets a fresh one.

**Persisted.** None — no `ctx.settings`, no `ctx.storage`. There is
nothing a converter needs to remember between sessions.

**Document.** None. **Nothing mutates the document outside
`ctx.execute`** — and the stronger statement holds: this plugin never
touches the open document at all. An import returns MEI *text* and the
HOST opens it, which is what keeps a converted `.musicxml` a new unsaved
tab rather than an edit to whatever was on screen, and what stops a
plain ctrl+s overwriting the source with MEI (0.0.3's rule, preserved by
the host's open path since 8a).

## 5. Command messages

**None**, in either direction, and the reason is the design rather than
an omission: an import hands back text for the host's open path, and an
export reads. A converter that sent `core.*` messages would be editing
the current document instead of opening a new one — the exact bug the
"new unsaved document" rule exists to prevent.

No message type, no `toCommand` case and no core change is needed by
this slice.

## 6. Tests

None of the plugin's own exist. What does, and what the next attempt
inherits:

| Suite | State |
| --- | --- |
| `spikes/verify-formats.mjs` | **The gate, and it is green.** Written before 8a for exactly this purpose. 14 checks through what a user touches: an `.mxl` through the file input opens as a new tab named after the file; an ABC imports as text; a `.xml` holding MusicXML is told apart from MEI by its root; an unknown extension is refused with a notice; the accept list covers every format; the four exports download real files (SMF header, `**kern`, PAE, `<svg`) in menu order. Run at 8a before the attempt: **14 PASS**. |
| `apps/editor/test/convert.test.ts` | The pinning test — the real Humdrum toolkit over a sample of every format, so the table can never promise what the bundled Verovio cannot do. Moves into the plugin's suite with its `.mxl` fixture, assertions unchanged, minus its `svg` row (§7.5). |
| `apps/editor/test/host.test.ts` | 8a's registry cases — declared imports widen the accept list before the plugin loads, `importFile` wakes it with `onFormat:`, `registerImport` demands a declaration, two plugins on one id fail. All host-side and all staying. |

The plugin's own suite, when it exists, has one job the host's cannot
do: prove that each declared id's converter reaches the right Verovio
call, against a real `createHost()` with a fake `SessionAdapter`. The
conversions themselves are `convert.test.ts`'s.

Two adjustments the next attempt will have to make, neither an
assertion:

- `verify-formats.mjs`'s fixture path — the `.mxl` moves with the test
  into `packages/plugins/formats/test/fixtures/`.
- Its menu-order check becomes `svg,midi,humdrum,pae`. SVG will be the
  only INTERNAL export left and the registry lists internal before
  declared. 8a already moved this same assertion once, for the same
  reason, and recorded it as a menu order rather than a behaviour.

## 7. Dead ends

The whole slice is one, so this section is the document. §7.1 is why it
stopped; §7.2 is why it could not be half-delivered; §7.3–§7.6 are what
the attempt established and the next one should not rediscover.

### 7.1 The export half has no document, and the rehearsal could not show it

The brief says *API may grow: **None**. Everything is in 8a.* It is not.
8a's `registerExport` producer takes no arguments, and the App's three
export registrations get the score by closure:

```ts
// App.tsx, the internal registration 8a rehearsed the point with
const out = await converter.fromMEI(f.id, sessionRef.current.serializeForPageView());
```

A plugin has no `sessionRef`. There is no query, no store field and no
producer parameter that yields MEI, so the three exports cannot be
written at all — not awkwardly, not with a workaround: the input does
not exist.

**Why 8a could not see it, and this is the transferable part.** The
point was rehearsed with INTERNAL registrations, and an internal
registration is App code. The import half was rehearsed honestly,
because the host hands a converter its file and the App has no advantage
there. The export half was rehearsed by the one caller that already held
the document — so the rehearsal proved the registry, the menu row, the
`onFormat:` wake-up and the save path, and silently assumed the single
thing a plugin lacks.

> **A point rehearsed only from inside the App can hide exactly what a
> plugin lacks.** The App's own registration closes over the session, the
> pool, the tab — a plugin closes over nothing. When you rehearse a new
> contribution point in-house, write the rehearsal against something with
> no access to App state (a module with only `ctx` in scope), or accept
> that the rehearsal tests the registry and not the contract.

This is the second sighting. The playback export's file name (7b §7.2)
was the first: `DocumentInfo` carried `title` and not the open file's
`name`, and again the App's internal version had it by closure. That one
was caught because a file name is visible in the UI; this one is
invisible until someone writes the plugin. Both are the same bug in the
method, not in the code.

**What was NOT done, deliberately:** the addition was not taken. It is
one parameter, it is obviously right, and it would have taken five
minutes — which is precisely the shape of the slice-4 rollback
(2026-09-14), where a slice added fourteen api exports its brief never
named and widened the rules to admit them. *API may grow: **None*** means
none. The gap is written here and in the report; the addition is the
user's to approve and the in-house half's to build, as 7a and 8a were.

*Resolved the same day (2026-09-16, in-house).* `ctx.query.mei()` is on
the api at 0.1.14 — the document as MEI text, score-based, null without
a document — and the App's three export registrations now read through
it instead of the session, so the rehearsal holds only what a plugin
holds. The convention proposed above is written into
`packages/plugins/README.md`. The next attempt's producers are
`async () => convert(ctx.query.mei())`, and nothing else stood in the way.

### 7.2 The halves do not separate — why nothing was delivered

The obvious salvage is to ship the import half now and the exports when
the api grows. It does not work, for two reasons and one measurement:

- **The slice's point is the budget**, and imports alone do not move it.
  The three exports would keep the App's `converter.ts` and its
  Humdrum-enabled worker, so the 13.45 MB build stays in the host's
  assets — which is the one thing 8b exists to change.
- **Two copies of the worker.** The plugin needs its own `converter.ts`
  and `convertWorker.ts`; the App keeps its pair for the exports. That is
  the same 12 MB of WASM source twice in the repo, with two copies free
  to drift.

And the measurement that makes it a trap rather than an obvious
mistake: **Vite deduplicated them.** Both `convertWorker.ts` files were
byte-identical, so the content hash matched and exactly one
`convertWorker-BcFZXyls.js` (13,450,189 bytes) was emitted, referenced by
both. The dist looked correct. The half-moved state would have shipped
green and doubled the moment anyone edited either copy.

> **A duplicated asset that dedupes by content hash is not deduplicated —
> it is one edit away from not being.** If you catch yourself checking the
> dist to justify two copies of a file, the dist is answering a different
> question than the one you asked.

### 7.3 A plugin CAN own a Vite worker — the brief's host edit is not needed

The brief allowed one host edit: *"the worker's chunk naming in
`vite.config.ts` if Rollup needs telling (the 5a / 7b lesson: anything
the host and a plugin share must be named)"*. Measured: **it does not.**

```ts
// packages/plugins/formats/src/converter.ts — worked as-is
this.worker = new Worker(new URL("./convertWorker.ts", import.meta.url), { type: "module" });
```

Built, emitted and referenced correctly from the plugin chunk as
`new Worker(new URL("/assets/convertWorker-<hash>.js", import.meta.url), { type: "module" })`.
`npm run budget` passed with the plugin chunk at 1.3 kB and lazy.

The reason is worth knowing, because it is the opposite of 7b's preload
helper: **Vite builds workers in a separate Rollup sub-build**, so the
host's `build.rollupOptions.output.manualChunks` never sees the worker's
modules and cannot pull them into a plugin chunk. 7b's `__vitePreload`
trap was about a module shared *within* the main build. A worker is not
in that build at all.

### 7.4 One id per FORMAT, not one per direction

PAE and Humdrum are both an import and an export. The first draft gave
each direction its own id (`battuta.formats.pae.import` /
`.export`) — eight ids, eight activation events, and two wake-ups for
one converter.

Wrong shape. The store keeps imports and exports in separate maps, so
one id can safely name both, and it should: `battuta.formats.pae` is
*the Plaine & Easie converter*, which happens to go both ways. Six ids,
six events, and opening a `.krn` or exporting Humdrum is the same
wake-up — after which `activate` registers all eight registrations and
the host asks again for whichever one woke it.

The general form: **an activation event names a capability the user
reached for, not a function signature.**

### 7.5 The table cannot be its own module, and SVG must not be in it

Two constraints that decide where the format table lives, neither
obvious until you try:

- **Rule 3: `src/manifest.ts` imports nothing but `@battuta/api`.** The
  manifest must declare the imports and exports, so it needs the table,
  so the table lives *in* the manifest — as harmony's `LANES` does.
  `src/index.ts` imports it back from there. A `src/table.ts` is
  impossible, not merely unidiomatic.
- **SVG leaves the table entirely.** `EXPORT_FORMATS` has four entries
  today and the SVG one is not a converter export: it comes from the
  render pool, one file per page, and engraving is the host's service.
  Keeping it in the plugin's table would list a format the plugin never
  registers. The App keeps that one entry inline, and `convert.test.ts`
  loses its `svg` branch — which also removes the only `renderToSVG` call
  the moved test contained, so the moved file does not read as a rule
  violation even though tests are exempt from rule 1b.

### 7.6 Narrow the plugin's `verovio.d.ts` and rule 1b becomes a type error

The npm package ships no types for its subpath exports, and a plugin
cannot reach the editor's `src/types/verovio.d.ts`. The duplication is
forced (the same situation as harmony's §7.4) — but it is an
opportunity, because the copies need not be equal.

The plugin's declaration should cover only what a CONVERTER calls:
`setOptions`, `loadData`, `loadZipDataBuffer`, `getMEI`, `renderToMIDI`,
`renderToPAE`, `getHumdrum`. Leave `renderToSVG`, `renderToTimemap`,
`getPageCount` and the layout calls undeclared, and rule 1b —
`plugin-boundaries`' ban on engraving in a plugin — stops being a test
that catches you and starts being a compile error that prevents you.

> **When a boundary forces you to duplicate a declaration, duplicate
> LESS than the original.** The narrower copy is the boundary, expressed
> in the type system.

### 7.7 What did not happen

- **No api addition** (§7.1), and no host module.
- **Nothing left in the tree.** The package was built far enough to
  answer §7.3 and then removed; `git status` is clean at `037fc40`, with
  typecheck, the editor's 135 tests, the build and the budget green. An
  open slice with a precise gap is the deliverable.
- **No rule file edited.** `packages/plugins/README.md`, the api's README
  and PLANNING.md are the user's during a slice. The convention §7.1
  proposes — rehearse a producer against something with no App state —
  is proposed here, not written into the conventions.
- **One thing to watch when it resumes:** the budget ceiling is tight.
  365.0 kB against 368.2 kB at 8a, and adding this plugin's manifest to
  `battuta-shared` measured 366.0 kB. The App's departing registrations
  and `formats.ts` should bring it back down, but the margin is ~3 kB,
  not a comfortable one.

## 8. Recipe

The order for the next attempt. Step 1 is not optional and is not this
slice's to take.

1. **The in-house half first**, as 7a and 8a were done: pick shape (a)
   or (b) from §3 with the user, wire it through
   `apps/editor/src/host/formats.ts` and the `SessionAdapter`, bump the
   api, add the host test ("a producer is handed the document's MEI",
   "and nothing when none is open"), and **rewrite the App's three
   internal export registrations onto it** — so the plugin slice finds
   the door open, and so the rehearsal is done by a caller with no
   privileged access this time (§7.1).
2. **Baseline.** `BATTUTA_ROOT=$PWD CHROME=bundled SCRATCH=/tmp/battuta-e2e node spikes/verify-formats.mjs`
   — 14 checks, green, before touching anything.
3. **`git mv` the code before changing a line**: `converter.ts`,
   `render/convertWorker.ts`, `test/convert.test.ts` and its `.mxl`
   fixture. Then `src/formats.ts`'s table into `src/manifest.ts` (§7.5).
4. **Scaffold** from `packages/plugins/playback` (the closest sibling:
   no react, a heavy lazy dependency, an export). `lib: ["ES2022", "DOM",
   "WebWorker"]`; `verovio` in dependencies; a narrowed `verovio.d.ts`
   (§7.6). No vitest config.
5. **Manifest** (§2 has it), then the three registrations outside the
   package: `host/plugins.ts`, the editor's `package.json`, `npm install`
   at the root. Append to `BUILTIN_PLUGINS` — the list is in slice order.
6. **`src/index.ts`**: loop the two tables, `registerImport` /
   `registerExport`. It should be about thirty lines; if it is more, the
   host is doing too little.
7. **Check in this order** — each catches a different class of mistake:
   ```sh
   npm run typecheck -w @battuta/plugin-formats
   npm run typecheck -w @battuta/editor
   npx vitest run --root packages/plugins/formats     # the pinning test, on the real toolkit
   npm test -w @battuta/editor                        # boundaries, keymap snapshot, host registry
   npm run build -w @battuta/editor && npm run budget -w @battuta/editor
   node spikes/verify-formats.mjs                     # then the other e2e, one at a time
   ```
8. **Confirm the dist claim**, which is this slice's whole point: no
   `convertWorker` asset reachable from the host's own source, the
   plugin chunk lazy, and the initial chunk down from 365.0 kB. Then the
   two documents, the plugins-page row, and the CHANGELOG bullet with the
   dist figure.
