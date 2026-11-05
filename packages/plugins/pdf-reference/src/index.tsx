/**
 * The PDF reference, as a plugin — the start of the facsimile (DESIGN.md,
 * "OMR support"), and the first consumer of the overlays point's BAND.
 *
 * Load a score's PDF with its OMR annotation files: every page is
 * rasterized once (pdf.js, lazily), the annotations place each measure on
 * its page, and each measure of the score is matched to one — by id when
 * the score carries the annotated ids, in reading order otherwise. Then
 * the scan of each measure stands in a band ABOVE its tile in edit view —
 * scan on top, rendering below — and a bottom panel shows the system the
 * caret is in, the caret's measure highlighted, following it as it moves.
 *
 * Everything it can do is `ctx`: the overlays point (a band), a panel, a
 * header button, the editor's caret, the measures' ids. It writes nothing
 * — not to the document, not to disk — and keeps the PDF for the session
 * only. Imports `@battuta/api`, `react`, `pdfjs-dist` (in `pdf.ts` and its
 * worker) and this package's own files.
 */
import { definePlugin, toDisposable, type ActivationEvent, type CaretPosition, type Disposable, type DocumentInfo, type OverlayBand, type PluginContext, type Store } from "@battuta/api";
import { COMMAND_TOGGLE, EXPORT_ANNOTATIONS, OVERLAY_ID, PANEL_ID } from "./manifest";
import { readAnnotations, type AnnotatedMeasure } from "./annotations";
import { addSystem, annotationsFromDrawing, drawingKey, emptyDrawing, readDrawing, removeSystem, resizeSystem, toPageFiles, toggleBarline, toggleSplit, type Drawing } from "./drawing";
import { isImageName, loadImages, orderImages } from "./images";
import { ZOOM_STEPS } from "./PageEditor";
import { bandHeightFor, cropOf, scaleFor } from "./geometry";
import { matchMeasures, measureFor, type Matching } from "./match";
import { PdfPanel, type PdfActions, type PdfState, type PickedFile } from "./Panel";
import { PDF_NEEDS, pdfMissing, releasePages, renderPdf, type RenderedPage } from "./pdf";
import { addTurns, frameOf, rotateAnnotations, rotateDrawing, rotatePage, turnAnnotations, turnsOf } from "./rotate";
import { ScanCell } from "./ScanCell";
import { signal, useStore } from "./store";

const EMPTY: PdfState = { status: "empty", rotations: {}, turning: false, fileName: null, progress: null, error: null, notes: [], pages: [], annotations: null, matching: null, docMeasures: 0, current: null, currentStaff: null, view: null, showBands: true, source: null, drawing: null, editing: false, tool: "system", editPage: 1, editZoom: 1 };

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** One comparable value for a caret, so the panel follows a MOVE and not every editor republish. */
const caretKey = (c: CaretPosition | null): string | null => (c ? `${c.measureIndex}/${c.staffN}/${c.layerN}/${c.eventIndex}` : null);
/** Document identity and revision. */
const stamp = (d: DocumentInfo | null): string | null => (d ? `${d.id}:${d.version}` : null);
/** What a matching places where — the bands are re-measured only when this changes. */
const signature = (m: Matching | null): string => (m ? `${m.mode}:${m.byIndex.map((x) => x?.order ?? "-").join(",")}` : "");

/** The 📄 once the plugin is active: dims while the panel is down. The declared face comes back on deactivate. */
function ToggleButton({ open, onToggle }: { open: Store<boolean>; onToggle: () => void }) {
  const isOpen = useStore(open);
  return (
    <button data-pdf-toggle title="PDF reference — the score's scan above each measure" onClick={onToggle} style={{ opacity: isOpen ? 1 : 0.45 }}>
      📄
    </button>
  );
}

const WOKEN_BY_THE_BUTTON: ActivationEvent = `onCommand:${COMMAND_TOGGLE}`;

export default definePlugin({
  activate(ctx: PluginContext) {
    const state = signal<PdfState>(EMPTY);
    const open = signal(false);
    const patch = (fields: Partial<PdfState>) => state.set({ ...state.get(), ...fields });
    let panel: Disposable | null = null;
    let overlay: Disposable | null = null;
    /** The load generation: a load or a clear that starts while one runs makes the older one's pages fall on the floor. */
    let run = 0;
    /** Where the open PDF's (or images') drawing is kept — by name and size — or null without one. */
    let pdfKey: string | null = null;
    /** What exported page files are named after: the PDF's name, or the images' without their `_pageN`. */
    let exportBase = "score";

    const imageOf = (page: number): RenderedPage | undefined => state.get().pages.find((p) => p.page === page);
    /** A measure's crop in its page image, and the image — or null before the page is rendered. */
    const scanOf = (m: AnnotatedMeasure) => {
      const image = imageOf(m.page);
      if (!image) return null;
      const page = state.get().annotations?.pages.find((p) => p.page === m.page);
      return { image, crop: cropOf(m, scaleFor(page, image.width)) };
    };
    /** The annotated measure a tile (or the caret) is on, under the current matching. */
    const measureAt = (measureIndex: number, measureId: string | null): AnnotatedMeasure | null => {
      const s = state.get();
      return s.annotations && s.matching ? measureFor(s.annotations, s.matching, measureIndex, measureId) : null;
    };

    // The band: as tall as the scan is when fitted to the tile's width (the
    // host keeps the row's tallest), drawn bottom-aligned on the tile.
    const band: OverlayBand = {
      height: (cell) => {
        if (!state.get().showBands) return 0;
        const m = measureAt(cell.measureIndex, cell.measureId);
        const scan = m && scanOf(m);
        return scan ? bandHeightFor(scan.crop, cell.width) : 0;
      },
      render: (cell) => {
        const m = measureAt(cell.measureIndex, cell.measureId);
        const scan = m && state.get().showBands ? scanOf(m) : null;
        return m && scan ? <ScanCell cell={cell} crop={scan.crop} image={scan.image} measure={m} /> : null;
      },
    };
    /** (Re)add the band: the host re-measures the rows when a spec is added again. */
    const placeBands = (): void => {
      if (panel) overlay = ctx.overlays.add({ id: OVERLAY_ID, band });
    };

    /** Match the annotations to the score's measures as they are now. */
    const rematch = (): boolean => {
      const s = state.get();
      const ids = ctx.query.measureIds();
      const matching = s.annotations ? matchMeasures(s.annotations, ids) : null;
      const changed = signature(matching) !== signature(s.matching);
      patch({ matching, docMeasures: ids.length });
      return changed;
    };

    /** The panel follows the caret: its measure's system, its measure highlighted. */
    const follow = (caret: CaretPosition | null): void => {
      if (!caret) return;
      const m = measureAt(caret.measureIndex, ctx.query.measureIds()[caret.measureIndex] ?? null);
      if (m) patch({ current: m, currentStaff: caret.staffN, view: { page: m.page, system: m.system } });
    };

    const load = async (files: PickedFile[]): Promise<void> => {
      const gen = ++run;
      const pdf = files.find((f) => /\.pdf$/i.test(f.name));
      const jsons = files.filter((f) => /\.json$/i.test(f.name));
      // pages as images, when there is no PDF: a PDF and images together is a PDF
      const images = files.filter((f) => f !== pdf && (isImageName(f.name) || (f.type ?? "").startsWith("image/")));
      const notes = files.filter((f) => f !== pdf && !jsons.includes(f) && !images.includes(f)).map((f) => `${f.name} is neither a PDF, an image nor an annotation file`);
      if (pdf && images.length) notes.push(`${images.length === 1 ? images[0]!.name : `${images.length} images`} not used: a PDF was chosen too`);
      const pageImages = pdf ? [] : orderImages(images);
      const before = state.get();
      patch({ status: "loading", error: null, progress: null, editing: false });
      try {
        let annotations = before.annotations;
        let source = before.source;
        let drawing = before.drawing;
        if (jsons.length) {
          const read = readAnnotations(await Promise.all(jsons.map(async (f) => ({ name: f.name, text: await f.text() }))));
          annotations = read.annotations;
          source = annotations ? "files" : null;
          drawing = null;
          notes.push(...read.notes);
        }
        let pages = before.pages;
        let fileName = before.fileName;
        let rotations = before.rotations;
        /** A PDF (or images) came in this pick: its kept turns are given to its pages. */
        let fresh = false;
        /** Annotations from files that are still in the files' own frame: this pick's, or ones that waited for this PDF. */
        let unturned = jsons.length > 0;
        if (pdf) {
          if (pdfMissing().length) throw new Error(PDF_NEEDS);
          const bytes = await pdf.arrayBuffer();
          // the key BEFORE rendering: the library may take the buffer over
          const key = drawingKey(pdf.name, bytes.byteLength);
          const rendered = await renderPdf(bytes, {
            progress: (done, total) => {
              if (gen === run) patch({ progress: { done, total } });
            },
            cancelled: () => gen !== run,
          });
          if (gen !== run) {
            releasePages(rendered);
            return;
          }
          releasePages(pages);
          pages = rendered;
          fileName = pdf.name;
          pdfKey = key;
          fresh = true;
          exportBase = pdf.name.replace(/\.pdf$/i, "");
          // Without files in this pick: annotations read BEFORE any PDF were
          // waiting for this one and stay; otherwise the PDF brings its own
          // drawing, if one was made for it.
          const waiting = before.pages.length === 0 && before.source === "files" && annotations !== null;
          if (waiting) unturned = true;
          if (!jsons.length && !waiting) {
            drawing = readDrawing(ctx.storage.get(key));
            annotations = drawing ? annotationsFromDrawing(drawing) : null;
            source = annotations ? "drawn" : null;
          }
        } else if (pageImages.length) {
          // The same, for pages that came as images: one image a page, at its
          // own resolution — which is the OMR files' own coordinate space.
          const buffers = await Promise.all(pageImages.map((f) => f.arrayBuffer()));
          const key = drawingKey(`images:${pageImages.map((f) => f.name).join("+")}`, buffers.reduce((n, b) => n + b.byteLength, 0));
          const rendered = await loadImages(pageImages.map((f, i) => ({ name: f.name, ...(f.type ? { type: f.type } : {}), arrayBuffer: async () => buffers[i]! })));
          if (gen !== run) {
            releasePages(rendered);
            return;
          }
          releasePages(pages);
          pages = rendered;
          fileName = pageImages.length === 1 ? pageImages[0]!.name : `${pageImages[0]!.name} + ${pageImages.length - 1} more`;
          pdfKey = key;
          fresh = true;
          exportBase = pageImages[0]!.name.replace(/\.[a-z0-9]+$/i, "").replace(/_page\d+$/i, "");
          const waiting = before.pages.length === 0 && before.source === "files" && annotations !== null;
          if (waiting) unturned = true;
          if (!jsons.length && !waiting) {
            drawing = readDrawing(ctx.storage.get(key));
            annotations = drawing ? annotationsFromDrawing(drawing) : null;
            source = annotations ? "drawn" : null;
          }
        }
        if (gen !== run) return;
        // The turns kept for this PDF (⟳), given to its fresh pages — and to
        // annotation files still in their own frame, by each page's size before its turn.
        if (fresh && pdfKey) {
          rotations = readDrawing(ctx.storage.get(pdfKey))?.rotations ?? {};
          const sizes = new Map(pages.map((p) => [p.page, { width: p.width, height: p.height }]));
          const kept = rotations;
          const turned = await Promise.all(pages.map((p) => rotatePage(p, turnsOf(kept[String(p.page)]))));
          if (gen !== run) {
            releasePages(turned);
            return;
          }
          pages = turned;
          if (annotations && unturned && source === "files") annotations = turnAnnotations(annotations, rotations, (page) => sizes.get(page));
        } else if (annotations && unturned && source === "files") {
          annotations = turnAnnotations(annotations, rotations, (page) => {
            const p = pages.find((x) => x.page === page);
            return p ? { width: p.width, height: p.height } : undefined;
          });
        }
        if (pages.length === 0) {
          // keep what was read: the PDF can come in a second pick
          patch({ annotations, source, drawing, notes });
          throw new Error("choose the PDF (or its pages as images) too: the annotations place measures on its pages");
        }
        if (annotations) {
          const missing = annotations.pages.filter((p) => !pages.some((r) => r.page === p.page)).map((p) => p.page);
          if (missing.length) notes.push(`annotations for page ${missing.join(", ")}, which the PDF does not have`);
        }
        const first = annotations?.measures[0];
        patch({ status: "ready", fileName, pages, annotations, source, drawing, rotations, notes, progress: null, current: null, view: first ? { page: first.page, system: first.system } : { page: 1, system: -1 } });
        rematch();
        follow(ctx.editor.get().caret);
        placeBands();
      } catch (e) {
        if (gen === run) patch({ status: state.get().pages.length ? "ready" : "error", error: message(e), progress: null });
      }
    };

    /** A changed drawing: kept for this PDF, made the annotations, matched, and the bands re-measured — the scans follow the pen. */
    const applyDrawing = (d: Drawing): void => {
      if (pdfKey) ctx.storage.set(pdfKey, { ...d, rotations: state.get().rotations });
      const annotations = annotationsFromDrawing(d);
      patch({ drawing: d, annotations, source: annotations ? "drawn" : null });
      rematch();
      follow(ctx.editor.get().caret);
      placeBands();
    };
    const editImage = () => state.get().pages.find((p) => p.page === state.get().editPage);

    /** Turns run one after the other: a second tap while a page is still being re-encoded would start from the state before the first (two taps netted one quarter on the Galaxy Tab). */
    let turning: Promise<void> = Promise.resolve();
    /** Turns asked for and not done yet: the buttons wait while any is. */
    let queued = 0;
    const turn = (pageNumbers: readonly number[]): Promise<void> => {
      if (state.get().status !== "ready") return Promise.resolve();
      queued++;
      patch({ turning: true });
      const next = turning.then(() => doTurn(pageNumbers)).finally(() => {
        queued--;
        if (queued === 0 && state.get().turning) patch({ turning: false });
      });
      turning = next.catch(() => undefined);
      return next;
    };
    /** Pages turned a quarter clockwise, one after the other: the images, the files' boxes with them, a drawing's systems gone (with a word), the turns kept, the scans re-placed. */
    const doTurn = async (pageNumbers: readonly number[]): Promise<void> => {
      const gen = run;
      if (state.get().status !== "ready") return;
      await turnNow(pageNumbers, gen);
    };
    const turnNow = async (pageNumbers: readonly number[], gen: number): Promise<void> => {
      const s0 = state.get();
      let { pages, annotations, drawing, rotations, source } = s0;
      const notes: string[] = [];
      for (const n of pageNumbers) {
        const image = pages.find((p) => p.page === n);
        if (!image) continue;
        let turned: RenderedPage;
        try {
          turned = await rotatePage(image, 1);
        } catch (e) {
          // The pages turned so far stay turned; the one that failed says why.
          if (gen === run) patch({ pages, annotations, drawing, rotations, source, notes: [...notes, `page ${n} could not be turned: ${message(e)}`] });
          return;
        }
        if (gen !== run) {
          releasePages([turned]);
          return;
        }
        pages = pages.map((p) => (p.page === n ? turned : p));
        rotations = { ...rotations, [String(n)]: addTurns(turnsOf(rotations[String(n)]), 1) };
        if (annotations && source === "files") annotations = rotateAnnotations(annotations, n, frameOf(annotations.pages.find((p) => p.page === n), image), 1);
        if (drawing?.pages[String(n)]) {
          const r = rotateDrawing(drawing, n, 1);
          drawing = r.drawing;
          if (r.dropped) notes.push(`page ${n} turned: ${r.dropped === 1 ? "the system drawn on it went" : `the ${r.dropped} systems drawn on it went`} — draw it again upright`);
        }
      }
      if (drawing && source !== "files") {
        annotations = annotationsFromDrawing(drawing);
        source = annotations ? "drawn" : null;
      }
      patch({ pages, annotations, drawing, rotations, source, ...(notes.length ? { notes } : {}) });
      if (pdfKey) ctx.storage.set(pdfKey, { ...(drawing ?? emptyDrawing()), rotations });
      rematch();
      follow(ctx.editor.get().caret);
      placeBands();
    };

    /** Every system in reading order, as (page, system) — or every page, without annotations. */
    const views = (): { page: number; system: number }[] => {
      const s = state.get();
      if (s.annotations) return s.annotations.pages.flatMap((p) => p.systems.map((_, system) => ({ page: p.page, system })));
      return s.pages.map((p) => ({ page: p.page, system: -1 }));
    };

    const actions: PdfActions = {
      load: (files) => void load(files),
      clear: () => {
        run++;
        pdfKey = null; // the drawing stays kept: the same PDF finds it again
        exportBase = "score";
        releasePages(state.get().pages);
        state.set({ ...EMPTY, showBands: state.get().showBands, docMeasures: state.get().docMeasures, tool: state.get().tool });
        placeBands();
      },
      startDrawing: () => {
        const s = state.get();
        if (s.status !== "ready" || s.source === "files") return;
        patch({ editing: true, editPage: s.view?.page ?? 1, drawing: s.drawing ?? emptyDrawing() });
      },
      stopDrawing: () => {
        const s = state.get();
        const first = s.current ?? s.annotations?.measures[0];
        patch({ editing: false, ...(first ? { view: { page: first.page, system: first.system } } : {}) });
      },
      setTool: (tool) => patch({ tool }),
      stepEditPage: (delta) => {
        const s = state.get();
        patch({ editPage: Math.max(1, Math.min(s.pages.length, s.editPage + delta)) });
      },
      addSystem: (box) => {
        const image = editImage();
        if (image) applyDrawing(addSystem(state.get().drawing ?? emptyDrawing(), state.get().editPage, image, box));
      },
      toggleBarline: (x, y) => applyDrawing(toggleBarline(state.get().drawing ?? emptyDrawing(), state.get().editPage, x, y)),
      removeSystem: (index) => applyDrawing(removeSystem(state.get().drawing ?? emptyDrawing(), state.get().editPage, index)),
      resizeSystem: (index, box) => {
        const image = editImage();
        if (image) applyDrawing(resizeSystem(state.get().drawing ?? emptyDrawing(), state.get().editPage, index, image, box));
      },
      toggleSplit: (x, y) => applyDrawing(toggleSplit(state.get().drawing ?? emptyDrawing(), state.get().editPage, x, y)),
      rotate: (page) => void turn([page]),
      rotateAll: () => void turn(state.get().pages.map((p) => p.page)),
      zoomEditor: (delta) => {
        const at = ZOOM_STEPS.indexOf(state.get().editZoom as (typeof ZOOM_STEPS)[number]);
        patch({ editZoom: ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (at < 0 ? ZOOM_STEPS.indexOf(1) : at) + delta))]! });
      },
      step: (delta) => {
        const all = views();
        const v = state.get().view;
        if (!all.length) return;
        const at = v ? all.findIndex((x) => x.page === v.page && x.system === v.system) : -1;
        const next = all[Math.max(0, Math.min(all.length - 1, (at < 0 ? 0 : at) + delta))]!;
        patch({ view: next });
      },
      setShowBands: (on) => {
        patch({ showBands: on });
        placeBands();
      },
      close: () => setOpen(false),
    };

    const mount = (): void => {
      if (panel) return;
      panel = ctx.panels.open({ id: PANEL_ID, side: "bottom", title: "PDF reference", render: () => <PdfPanel state={state} actions={actions} /> });
      open.set(true);
      rematch();
      placeBands();
    };
    const setOpen = (next: boolean): void => {
      if (next) return mount();
      panel?.dispose();
      panel = null;
      overlay?.dispose();
      overlay = null;
      open.set(false);
    };

    // The score behind the scans: an edit (a measure inserted or removed,
    // ids changed) or another document re-matches, and the bands are
    // re-measured only when what goes where changed.
    let seen = stamp(ctx.document.get());
    ctx.subscriptions.add(
      ctx.document.subscribe((doc) => {
        const next = stamp(doc);
        if (next === seen) return;
        seen = next;
        // A tick later: the host publishes the new document before it has
        // bound the new score's queries (the e2e found measureIds() empty on
        // a tab switch), so the ids are read once the switch has finished.
        setTimeout(() => {
          if (rematch()) placeBands();
          follow(ctx.editor.get().caret);
        }, 0);
      }),
    );
    // A MOVE of the caret (not every editor republish) moves the strip.
    let lastCaret = caretKey(ctx.editor.get().caret);
    ctx.subscriptions.add(
      ctx.editor.subscribe((e) => {
        const key = caretKey(e.caret);
        if (key === lastCaret) return;
        lastCaret = key;
        follow(e.caret);
      }),
    );

    ctx.slots.add("header", { id: "toggle", render: () => <ToggleButton open={open} onToggle={() => setOpen(panel === null)} /> });
    // Open now unless the click that woke us is about to toggle the panel
    // itself (activation runs BEFORE the handler it caused).
    // …and not when the export woke us: the menu asked for a file, not a panel.
    if (ctx.activatedBy !== WOKEN_BY_THE_BUTTON && ctx.activatedBy !== `onFormat:${EXPORT_ANNOTATIONS}`) mount();
    ctx.registerCommand(COMMAND_TOGGLE, () => setOpen(panel === null));

    // The systems and measures — drawn or read — as the OMR pipeline's page
    // files, one per page, named after the PDF.
    ctx.formats.registerExport(EXPORT_ANNOTATIONS, async () => {
      const s = state.get();
      if (!s.annotations || s.pages.length === 0) throw new Error("open a PDF in the PDF reference, and draw or load its systems and measures, first");
      const files = toPageFiles(s.annotations, exportBase, (page) => {
        const image = imageOf(page);
        return image ? { width: image.width, height: image.height } : null;
      });
      return { files: files.map((f) => ({ bytes: f.text, filename: f.filename })) };
    });

    // The page images and a running render are the things not handed out by
    // the host, so they are the things to give back.
    ctx.subscriptions.add(
      toDisposable(() => {
        run++;
        releasePages(state.get().pages);
      }),
    );
  },
});
