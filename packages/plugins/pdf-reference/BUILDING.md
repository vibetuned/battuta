# Building the PDF reference

## 1. Origin

A NEW feature, and the first step of DESIGN.md's *OMR support
(facsimile)*: "the edit view shows the source image strip for each
measure directly above its tile — scan on top, rendering below". The
user asked for it on 2026-10-11 as "a pdf-reference, the start of the
facsimile, working like the pitch reference for the moment", with three
examples (`examples/`: a PDF, one annotation JSON per page and a
`graph.json` each — a Handel aria, a violin nocturne, a Chopin polonaise;
the PDFs are Verovio engravings and the annotations box every element by
its MEI id, in the pixels of the page at 254 dpi). Their source MEIs were
not included. `App.tsx` gained the band mount (below); core is untouched.

**Drawing (2026-10-11, the same day):** the user's next request, before
the source MEIs: "create the system and the measures in any random PDF".
`drawing.ts` and `PageEditor.tsx`. Then, the same day: the editor's zoom,
staff splits, and pages as images when there is no PDF (`images.ts`).

## 2. Manifest

- `contributes.commands`: `battuta.pdf-reference.toggle` — the panel and
  the scans, together.
- `contributes.slotItems`: the 📄 in the `header` slot, `dimUntilActive`;
  the live item with the same id takes the face over while the plugin
  runs, so it dims with the panel.
- `activationEvents: ["onCommand:battuta.pdf-reference.toggle"]` — the one
  wake-up path; the PDF library is fetched later still, on the first PDF.
- `contributes.exports`: `battuta.pdf-reference.annotations` — "export PDF
  annotations", the systems and measures (drawn or read) as the OMR page
  files; with `onFormat:` among the activation events, it wakes the plugin
  WITHOUT opening its panel.
- `engines: ^1.2.0` — the band and `ctx.query.measureIds()`.

Deliberately NOT declared: no capabilities (the PDF arrives through a file
input; no shell service is used), no keybindings, no `onStartup`, no
`imports` (a PDF is a reference, never a document to open as a tab).

## 3. API surface

Read: `ctx.document` (subscribe — re-match after an edit or a tab
switch), `ctx.editor` (subscribe — the caret, for the strip),
`ctx.query.measureIds()` (the score's measures by id — **added for this
plugin**), `ctx.activatedBy`. Draw: `ctx.overlays.add({ id, band })` — a
BAND, room above every tile (**added for this plugin**): `band.height(cell)`
says how tall this tile's scan is at the tile's width, the host reserves
the row's tallest (and an empty band over the row's header cell), and
`band.render(cell)` draws the scan; the spec is re-added whenever what
decides the heights changes (a load, a clear, the checkbox, a re-match),
which is how the host knows to re-measure. Lifecycle: `ctx.panels.open`
(bottom), `ctx.slots.add`, `ctx.registerCommand`, `ctx.subscriptions`,
`ctx.formats.registerExport` (the annotations export), `ctx.storage` (a
drawing per PDF). No `ctx.execute`, no `ctx.notice`, no settings. The
drawing needed no api.

`@battuta/api` 1.1.0 → **1.2.0** for the two additions: `OverlaySpec.band`
(`BandCell`, `OverlayBand`; `OverlaySpec.render` became optional so a spec
may be a band only) and `DocumentQueries.measureIds()`.

## 4. State

Transient: the page images (blob URLs of PNGs rendered once at 254 dpi,
2100 × 2970 for A4, released on clear, on a new PDF and on deactivate),
the annotations read, the matching, the caret's measure and the system
the strip shows, the checkbox, the drawing tools' state. Persisted
(`ctx.storage`): `drawing:<pdf name>:<bytes>` → the systems and barlines
drawn on that PDF, in its rendered pixels — kept on every edit, read when
the same file is loaded without annotation files. Document: nothing.
Nothing mutates the document outside `ctx.execute` — and this plugin never
calls it; the lifecycle test asserts the adapter received no command, the
e2e that the undo depth stays 0.

## 5. Command messages

None.

## 6. Tests

`test/annotations.test.ts` — boxes, the page by name or image, systems
top to bottom, each measure in the system it overlaps most, reading order
across pages, rows when no system is annotated, a graph only without page
files, every unusable file said. `test/match.test.ts` — by id (whatever
the order), in order, the half-of-what-could-match threshold.
`test/geometry.test.ts` — the page scale, a crop (measure width × system
height, and the measure's own where it reaches past), a band's height
(fitted, capped, degenerate), the strip's view, a scan's fit in its cell.
`test/pdf-reference.test.ts` — the lifecycle against a real host, the PDF
renderer mocked: the 📄 before any code, a load matched by id and in
order and re-matched after an edit, the band's heights and cells, the
caret moving the strip, ◀ ▶ across pages, the checkbox, clear, annotations
without their PDF, off. The host: `overlays.test.ts` (`rowBandHeights`),
and `spikes/verify-overlays.mjs` §8 rehearses the band from a plugin
holding only `ctx`. The e2e, with the REAL pdf.js:
`spikes/verify-pdf-reference.mjs` (21 checks) builds a score whose
measures carry the Chopin example's ids, loads the PDF and its files
through the panel, and reads off the page: two pages rasterized at
2100 × 2970, 38 matched by id, each tile's scan its own measure, rows
level, the strip following a click on measure 26, ◀ ▶, the checkbox, the
dev fixture matched in order with the counts said, close.

`test/drawing.test.ts` — a drag is a system (any corner order, clamped,
too small ignored, top to bottom), a click adds or removes a barline and
never near an edge, measures between barlines, the drawing as annotations
across pages, the OMR format written and read back, a stored drawing
checked. The lifecycle suite: drawing with the scans following, kept per
PDF and back on reload (another PDF does not find it), files winning, the
export (read and drawn) and the export waking the plugin without its
panel. The e2e §9 draws the Chopin example's first system with a real
mouse — the example's own boxes as the targets — clicks three barlines,
takes one away, removes the system by its ×, exports, and loads the PDF
again to find the drawing (30 checks in all).

## 7. Dead ends

- **An SVG view box as the crop.** It does not clip: a band taller than
  its scan showed the page above the measure — the title, in the first
  screenshot. A scan is now a box of exactly its fitted size that hides
  the rest; the strip clips to its system with a `clipPath`.
- **Rounding the raster up.** `Math.ceil` made A4 at 254 dpi 2101 px wide —
  595.2756 pt × 254/72 is 2100.0000x in floating point — and every crop a
  hair off the annotations. `Math.round`.
- **Reading the measure ids on the document's own event.** On a tab switch
  the host publishes the new document before it rebinds the new score's
  queries, so `measureIds()` answered `[]` and the match was "0 of 0". The
  plugin re-matches a tick later.
- **pdf.js found by Vite on first use.** pdf.js is reached only through a
  dynamic import, so the dev server discovered it — and the worker module
  — on the first PDF and reloaded the page to bundle it, losing the panel.
  Both entries are in `optimizeDeps.include`; `tauri dev` would have hit it
  too.
- **Matching by id only.** The examples came without their MEI, and a
  transcription made in battuta carries battuta's ids: order is the honest
  fallback, and the panel says when the counts differ.
- **A pointer read under a scroll that moves.** The e2e first scrolled the
  editor to bring each point into view; a drag's second corner then moved
  the scroll under its first. Points of one gesture are read under one
  scroll; a single click may centre its own.
- **Images through the DOM.** An `<img>` would tell an image's size; a
  plugin has no DOM, and `createImageBitmap` tells it as well — then a blob
  URL shows it, as for a PDF's pages.
- **One box per measure.** A drawn measure would be a box each; a system
  and its barlines are two gestures for the whole line, and the measures
  come out exactly as wide as the barlines say and as tall as the system —
  what an OMR measure box is.
- **A drawing keyed by the document.** A drawing belongs to the PDF, not
  to the score: it is kept by the PDF's name and size, so the same PDF
  beside another score (or a new transcription) finds it again.
- **A fixed band height.** Every scan fitted to its tile's width keeps the
  barlines over each other; a fixed height would fit narrow and wide
  measures differently. The host takes the row's tallest instead.
- **"iPadOS 17.4", for pdf.js.** Phase 10 first had the app's floor
  against pdf.js as `Promise.withResolvers` alone — Safari 17.4. Read
  through (2026-10-21), pdf.js 6.4 also calls, with no fallback,
  `Promise.try` (every worker message), `URL.parse`,
  `Uint8Array.fromBase64` and `Math.sumPrecise` (rebuilding embedded
  fonts): all in Safari from 26.2. The user's choice was a message rather
  than a fix, so `pdfMissing()` checks those five before pdf.js loads and
  the panel names iOS / iPadOS 26.2; the legacy build of pdf.js, which
  polyfills them, is what a fix would take.

## 8. Recipe

A layer that needs room ABOVE the measures (a scan, a lyric sheet, a
recording's waveform per measure):

1. Copy `package.json`, `tsconfig.json`, `src/manifest.ts`, `src/store.ts`.
2. Pure modules first (`annotations.ts`, `match.ts`, `geometry.ts` here),
   tested without a browser.
3. `ctx.overlays.add({ id, band: { height, render } })`: `height(cell)` is
   arithmetic on `cell.width` (it is called for every tile of every row);
   `render` sits its content bottom-aligned and clips it. Re-add the spec
   when what decides the heights changes.
4. Match to the score with `ctx.query.measureIds()`; follow the caret
   with `ctx.editor`.
5. A heavy library: import it dynamically, give it its own worker file
   (`new URL("./worker.ts", import.meta.url)`), allowlist it in
   `plugin-boundaries`, and add it to Vite's `optimizeDeps.include`.
6. Checks: the plugin's vitest; `npm test -w @battuta/editor`; an e2e with
   the real library; `npm run budget -w @battuta/editor`.
