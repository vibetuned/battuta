/**
 * The PDF reference end to end, in the browser, with the REAL pdf.js: the
 * 📄 before any code loads, the bottom panel, the Chopin example's PDF and
 * annotation files loaded through the panel's file input, and what comes
 * out — two pages rasterized, 38 measures annotated, a score whose measures
 * carry the annotated ids matched BY ID, each tile's band showing the scan
 * of ITS measure, rows level, the strip showing the caret's system and
 * following the caret, ◀ ▶, the checkbox, matching IN ORDER on another
 * score (with the counts said), then the same PDF WITHOUT its files: a
 * system drawn with the mouse and its barlines clicked, the scans
 * following the pen, a barline and a system taken away, the export in the
 * OMR format, and the drawing back when the PDF is loaded again; the
 * editor zoomed to 200% and the system split into its staves exactly
 * between the example's two, the caret's staff highlighted in the strip;
 * the pages as PNG images with their annotation files — close, and
 * nothing written.
 *
 * The example (fixtures/pdf-reference) comes without its source MEI, so the id-matched score is
 * built here: one staff, a measure rest per annotated measure, each
 * measure carrying its annotated id.
 *
 * Run: BATTUTA_ROOT=$PWD CHROME=bundled node spikes/verify-pdf-reference.mjs
 */
import { createServer } from "vite";
import { chromium } from "playwright";
import { readFileSync, readdirSync } from "node:fs";

const ROOT = process.env.BATTUTA_ROOT ?? "/home/flux/projects/battuta";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const EXAMPLE = "Qmcts7FEQamQMHpYWF51x1VnhQ8r4Hoy8sR1uTFU3UVYAh"; // Chopin, Polonaise in G minor: 2 pages, 38 measures
const DIR = `${ROOT}/fixtures/pdf-reference`;

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

// the annotated measure ids, page by page, in the files' order
const pageFiles = readdirSync(DIR).filter((f) => /_page\d+\.json$/.test(f)).sort();
const annotatedIds = pageFiles.flatMap((f) => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")).annotations.filter((a) => a.class === "measure").map((a) => a.id));
const idScore = `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
  <meiHead><fileDesc><titleStmt><title>Polonaise (ids)</title></titleStmt><pubStmt/></fileDesc></meiHead>
  <music><body><mdiv><score>
    <scoreDef meter.count="3" meter.unit="4" keysig="2f"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef>
    <section>
${annotatedIds.map((id, i) => `      <measure n="${i + 1}" xml:id="${id}"><staff n="1"><layer n="1"><mRest/></layer></staff></measure>`).join("\n")}
    </section>
  </score></mdiv></body></music></mei>
`;

const server = await createServer({ configFile: `${ROOT}/apps/editor/vite.config.ts`, root: `${ROOT}/apps/editor`, server: { port: 0 }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ ...(CHROME === "bundled" ? {} : { executablePath: CHROME }), headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(server.resolvedUrls.local[0] + "?pool=2");
try {
  await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 10, null, { timeout: 60000 });
  const attr = (n) => page.evaluate((name) => document.querySelector("[data-pdf-ref]")?.getAttribute(name) ?? null, n);
  const toggle = () => page.locator('[data-slot-command="battuta.pdf-reference.toggle"], [data-pdf-toggle]').first();

  // --- 1. the entry point before any code loads -----------------------------
  check("the 📄 is in the header before the plugin loads", await page.evaluate(() => Boolean(document.querySelector('[data-slot-command="battuta.pdf-reference.toggle"]'))));
  check("…and no band is reserved yet", await page.evaluate(() => document.querySelectorAll("[data-band]").length === 0));

  // --- 2. the id-matched score, then the panel --------------------------------
  await page.setInputFiles('input[type="file"]', { name: "polonaise-ids.mei", mimeType: "application/xml", buffer: Buffer.from(idScore) });
  await page.waitForFunction((n) => (document.querySelector(".tab.active")?.textContent ?? "").includes("polonaise-ids") && document.querySelectorAll(".tile").length === n, annotatedIds.length, { timeout: 60000 });
  await toggle().click();
  await page.waitForSelector('[data-panels="bottom"] [data-panel="pdf-reference"] [data-pdf-ref]', { timeout: 10000 });
  check("the click opens the panel in the bottom area", (await attr("data-pdf-state")) === "empty");

  // --- 3. the PDF and its annotations ---------------------------------------
  // with a graph file too — the fixture keeps only the page files, so the graph is a stand-in of the same shape
  const graph = { name: `${EXAMPLE}.graph.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ nodes: [] })) };
  const files = [`${EXAMPLE}.pdf`, ...pageFiles].map((f) => ({ name: f, mimeType: f.endsWith(".pdf") ? "application/pdf" : "application/json", buffer: readFileSync(`${DIR}/${f}`) })).concat(graph);
  const t0 = Date.now();
  await page.setInputFiles("[data-pdf-file]", files);
  await page.waitForFunction(() => ["ready", "error"].includes(document.querySelector("[data-pdf-ref]")?.getAttribute("data-pdf-state")), null, { timeout: 90000 });
  const loaded = { state: await attr("data-pdf-state"), status: await page.evaluate(() => document.querySelector("[data-pdf-status]")?.textContent ?? "") };
  check(`the PDF is rendered by pdf.js and the annotations read (${loaded.state} in ${Date.now() - t0} ms: ${loaded.status.slice(0, 80)})`, loaded.state === "ready");
  check(`two pages, 38 measures annotated (${await attr("data-pdf-pages")} pages, ${await attr("data-pdf-annotated")} measures)`, (await attr("data-pdf-pages")) === "2" && (await attr("data-pdf-annotated")) === String(annotatedIds.length));
  check(`all of the score's measures matched BY ID (${await attr("data-pdf-matched")} by ${await attr("data-pdf-mode")})`, (await attr("data-pdf-matched")) === String(annotatedIds.length) && (await attr("data-pdf-mode")) === "id");
  check("the graph file is said to be unneeded, not silently dropped", /graph\.json not needed/.test(await page.evaluate(() => document.querySelector("[data-pdf-notes]")?.textContent ?? "")));
  const image = await page.evaluate(async () => {
    const href = document.querySelector("[data-pdf-strip] image")?.getAttribute("href");
    if (!href) return null;
    const blob = await (await fetch(href)).blob();
    const bitmap = await createImageBitmap(blob);
    return { blob: href.startsWith("blob:"), bytes: blob.size, w: bitmap.width, h: bitmap.height };
  });
  check(`a page is a real 254-dpi raster (${JSON.stringify(image)})`, image && image.blob && image.w === 2100 && image.h === 2970 && image.bytes > 50000);

  // --- 4. the bands: each tile's scan is its own measure ----------------------
  await page.waitForFunction(() => document.querySelectorAll('[data-band="scan"] [data-pdf-scan]').length >= 8, null, { timeout: 10000 }).catch(() => undefined);
  const bands = await page.evaluate(() =>
    [...document.querySelectorAll('[data-band="scan"]')].map((cell) => {
      const tile = cell.closest(".tile");
      const index = Number(tile.dataset.index);
      const scan = cell.querySelector("[data-pdf-scan]");
      const box = [...tile.children].find((c) => c.tagName === "DIV" && !c.hasAttribute("data-band"));
      return { index, scanId: scan?.getAttribute("data-pdf-scan") ?? null, measureId: window.__SESSION__.score.measures[index].attrs["xml:id"], h: cell.getBoundingClientRect().height, boxTop: Math.round(box.getBoundingClientRect().top), row: tile.closest(".score-row") };
    }),
  );
  check(`every rendered tile has its scan above it (${bands.length} bands)`, bands.length >= 8 && bands.every((b) => b.scanId !== null && b.h > 20));
  // the two pages as PNGs, kept for §11 (pages as images): read now, while scans of both pages are on screen
  const pagePngs = await page.evaluate(async () => {
    const out = {};
    for (const el of document.querySelectorAll("[data-pdf-scan][data-pdf-page]")) {
      const p = el.getAttribute("data-pdf-page");
      if (out[p]) continue;
      const blob = await (await fetch(el.querySelector("image").getAttribute("href"))).blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out[p] = btoa(s);
    }
    return out;
  });
  check("each tile's scan is the measure with ITS id", bands.every((b) => b.scanId === b.measureId));
  const level = await page.evaluate(() => [...document.querySelectorAll(".score-row")].every((row) => new Set([...row.querySelectorAll(".tile")].map((t) => Math.round([...t.children].find((c) => c.tagName === "DIV" && !c.hasAttribute("data-band")).getBoundingClientRect().top))).size === 1));
  check("each row's staves stay level under their scans", level);

  // --- 5. the strip follows the caret ----------------------------------------
  const target = 25;
  // centred first: scrolled merely into view, the tile can sit under the fixed bottom panel, which then takes the click
  await page.evaluate((i) => document.querySelector(`.tile[data-index="${i}"]`).scrollIntoView({ block: "center" }), target);
  await page.locator(`.tile[data-index="${target}"] g[class~="mRest"]`).first().click({ force: true });
  await page.waitForFunction(() => (document.querySelector("main").dataset.caret ?? "") !== "", null, { timeout: 5000 }).catch(() => undefined);
  await page.waitForFunction((id) => document.querySelector("[data-pdf-current]")?.getAttribute("data-pdf-measure-id") === id, annotatedIds[target], { timeout: 5000 }).catch(() => undefined);
  const strip = await page.evaluate(() => ({ view: document.querySelector("[data-pdf-ref]").getAttribute("data-pdf-view"), current: document.querySelector("rect[data-pdf-current]")?.getAttribute("data-pdf-measure-id"), rects: document.querySelectorAll("[data-pdf-strip] rect").length }));
  check(`clicking measure ${target + 1} shows its system with it highlighted (${JSON.stringify(strip)})`, strip.current === annotatedIds[target] && strip.rects >= 2);
  const before = await attr("data-pdf-view");
  await page.locator("[data-pdf-next]").click();
  const after = await attr("data-pdf-view");
  await page.locator("[data-pdf-prev]").click();
  check(`▶ and ◀ step through the systems (${before} → ${after} → ${await attr("data-pdf-view")})`, before !== after && (await attr("data-pdf-view")) === before);

  // --- 6. the checkbox ----------------------------------------------------------
  const rowH = () => page.evaluate(() => Math.round(document.querySelector(".score-row").getBoundingClientRect().height));
  const withBands = await rowH();
  await page.locator("[data-pdf-bands]").uncheck();
  await page.waitForFunction(() => document.querySelectorAll("[data-band]").length === 0, null, { timeout: 5000 }).catch(() => undefined);
  const without = await rowH();
  check(`unchecking 'on the score' takes the scans and their room away (row ${withBands} → ${without} px)`, (await page.evaluate(() => document.querySelectorAll("[data-band]").length)) === 0 && without < withBands);
  await page.locator("[data-pdf-bands]").check();
  await page.waitForFunction(() => document.querySelectorAll('[data-band="scan"]').length >= 8, null, { timeout: 5000 }).catch(() => undefined);
  check("…and checking it brings them back", (await rowH()) === withBands);

  // --- 7. another score: matched in order, and the counts said -------------------
  await page.locator(".tabs .tab", { hasText: "synthetic-context-changes" }).first().click();
  await page.waitForFunction(() => document.querySelector("[data-pdf-ref]")?.getAttribute("data-pdf-mode") === "order", null, { timeout: 10000 }).catch(() => undefined);
  const order = { mode: await attr("data-pdf-mode"), matched: await attr("data-pdf-matched"), status: await page.evaluate(() => document.querySelector("[data-pdf-status]")?.textContent ?? "") };
  check(`a score without the ids is matched in order, and the counts are said (${order.status})`, order.mode === "order" && order.matched === "10" && /the PDF has 38, the score 10/.test(order.status));
  check("…and its tiles carry the scans of the first measures", await page.evaluate(() => document.querySelector('.tile[data-index="0"] [data-pdf-scan]')?.getAttribute("data-pdf-order") === "0"));

  // --- 9. a PDF without its annotation files: draw the systems and measures ---------
  // The targets are the example's own boxes (page 1, first system, its first four measures).
  const p1 = JSON.parse(readFileSync(`${DIR}/${EXAMPLE}_page1.json`, "utf8"));
  const sys0 = p1.annotations.filter((a) => a.class === "system").sort((a, b) => a.bbox[1] - b.bbox[1])[0].bbox;
  const firstFour = p1.annotations.filter((a) => a.class === "measure" && (a.bbox[1] + a.bbox[3]) / 2 > sys0[1] && (a.bbox[1] + a.bbox[3]) / 2 < sys0[3]).sort((a, b) => a.bbox[0] - b.bbox[0]).slice(0, 4).map((a) => a.bbox);
  await page.locator("[data-pdf-clear]").click();
  await page.setInputFiles("[data-pdf-file]", [{ name: `${EXAMPLE}.pdf`, mimeType: "application/pdf", buffer: readFileSync(`${DIR}/${EXAMPLE}.pdf`) }]);
  await page.waitForFunction(() => document.querySelector("[data-pdf-ref]")?.getAttribute("data-pdf-state") === "ready", null, { timeout: 60000 });
  check("a PDF alone loads with nothing placed, and offers to draw", (await attr("data-pdf-annotated")) === "0" && (await page.locator("[data-pdf-draw]").count()) === 1);
  await page.locator("[data-pdf-draw]").click();
  await page.waitForSelector("[data-pdf-editor]", { timeout: 5000 });
  /** A point of page 1 (its pixels) on screen, the editor scrolled so the first system is in view. */
  // `center`: scroll the point itself to the middle of the box (a single click); without it the scroll is the system's
  // top, the same for both corners of a drag, so a drag's two points are read under one scroll
  const onScreen = async (x, y, center = false) =>
    page.evaluate(
      ({ x, y, top, center }) => {
        const scroll = document.querySelector("[data-pdf-editor-scroll]");
        const svg = document.querySelector("[data-pdf-editor]");
        let r = svg.getBoundingClientRect();
        const k = r.width / 2100;
        scroll.scrollTop = Math.max(0, center ? y * k - scroll.clientHeight / 2 : top * k - 12);
        if (k * 2100 > scroll.clientWidth + 1) scroll.scrollLeft = Math.max(0, x * k - scroll.clientWidth / 2); // zoomed: bring x in
        r = svg.getBoundingClientRect();
        return { x: r.left + x * k, y: r.top + y * k };
      },
      { x, y, top: sys0[1], center },
    );
  const drawSystem = async () => {
    const a = await onScreen(sys0[0], sys0[1]);
    const b = await onScreen(sys0[2], sys0[3]);
    await page.locator('[data-pdf-tool-button="system"]').click();
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
  };
  const clickBarlines = async (xs) => {
    await page.locator('[data-pdf-tool-button="barline"]').click();
    for (const x of xs) {
      const p = await onScreen(x, (sys0[1] + sys0[3]) / 2, true);
      await page.mouse.click(p.x, p.y);
    }
  };
  await drawSystem();
  check(`a drag across the first system draws it (${await attr("data-pdf-annotated")} measure, source ${await attr("data-pdf-source")})`, (await attr("data-pdf-annotated")) === "1" && (await attr("data-pdf-source")) === "drawn");
  await clickBarlines(firstFour.slice(0, 3).map((b) => b[2]));
  check(`three barline clicks make four measures, placed in order (${await attr("data-pdf-annotated")} drawn, ${await attr("data-pdf-matched")} ${await attr("data-pdf-mode")})`, (await attr("data-pdf-annotated")) === "4" && (await attr("data-pdf-matched")) === "4" && (await attr("data-pdf-mode")) === "order");
  const drawnScans = await page.evaluate(() => [...document.querySelectorAll(".tile")].map((t) => t.querySelector("[data-pdf-scan]")?.getAttribute("data-pdf-order") ?? null));
  check(`the scans follow the pen: the score's first four tiles carry the four drawn measures, the rest none (${drawnScans.slice(0, 6).join(",")})`, drawnScans.slice(0, 4).join(",") === "0,1,2,3" && drawnScans.slice(4).every((x) => x === null));
  await clickBarlines([firstFour[1][2]]);
  check("a click on a barline takes it away", (await attr("data-pdf-annotated")) === "3");
  await clickBarlines([firstFour[1][2]]);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await onScreen(0, 0); // the editor scrolled so the first system, and its ×, are in view
  await page.locator('[data-pdf-remove-system="0"]').click({ force: true });
  await page.waitForFunction(() => document.querySelector("[data-pdf-ref]")?.getAttribute("data-pdf-annotated") === "0", null, { timeout: 3000 }).catch(() => undefined);
  check("the system's × removes it, and its scans go", (await attr("data-pdf-annotated")) === "0" && (await page.evaluate(() => document.querySelectorAll("[data-pdf-scan]").length)) === 0);
  await drawSystem();
  await clickBarlines(firstFour.slice(0, 3).map((b) => b[2]));
  await page.locator("[data-pdf-draw-done]").click();
  check(`done: the strip shows the drawn system, its four measures outlined (${await page.evaluate(() => document.querySelectorAll("[data-pdf-strip] rect[data-pdf-measure]").length)})`, (await attr("data-pdf-editing")) === "false" && (await page.evaluate(() => document.querySelectorAll("[data-pdf-strip] rect[data-pdf-measure]").length)) === 4);
  const exported = await page.evaluate(async (id) => {
    const out = await window.__HOST__.formats.produce(id);
    return out.files.map((f) => ({ filename: f.filename, json: JSON.parse(f.bytes) }));
  }, "battuta.pdf-reference.annotations");
  const measures = exported[0]?.json.annotations.filter((a) => a.class === "measure") ?? [];
  const within = measures.every((m, i) => Math.abs(m.bbox[2] - (i < 3 ? firstFour[i][2] : sys0[2])) < 4);
  check(`the drawing exports as the OMR page format, its barlines where the example's measures end (${exported.map((f) => f.filename).join(", ")}: ${measures.length} measures)`, exported.length === 1 && exported[0].filename === `${EXAMPLE}_page1.json` && measures.length === 4 && within);
  await page.locator("[data-pdf-clear]").click();
  await page.setInputFiles("[data-pdf-file]", [{ name: `${EXAMPLE}.pdf`, mimeType: "application/pdf", buffer: readFileSync(`${DIR}/${EXAMPLE}.pdf`) }]);
  await page.waitForFunction(() => document.querySelector("[data-pdf-ref]")?.getAttribute("data-pdf-state") === "ready", null, { timeout: 60000 });
  check(`the same PDF loaded again brings its drawing back (${await attr("data-pdf-annotated")} measures, ${await attr("data-pdf-source")})`, (await attr("data-pdf-annotated")) === "4" && (await attr("data-pdf-source")) === "drawn");

  // --- 10. zoom, and the system split into its staves --------------------------------
  const staves0 = p1.annotations.filter((a) => a.class === "system-staff" && (a.bbox[1] + a.bbox[3]) / 2 > sys0[1] && (a.bbox[1] + a.bbox[3]) / 2 < sys0[3]).map((a) => a.bbox).sort((a, b) => a[1] - b[1]);
  const splitY = (staves0[0][3] + staves0[1][1]) / 2;
  await page.locator("[data-pdf-draw]").click();
  await page.waitForSelector("[data-pdf-editor]", { timeout: 5000 });
  const width = () => page.evaluate(() => {
    const scroll = document.querySelector("[data-pdf-editor-scroll]");
    return Math.round((document.querySelector("[data-pdf-editor]").getBoundingClientRect().width / scroll.clientWidth) * 100);
  });
  const fit = await width();
  await page.locator("[data-pdf-zoom-in]").click();
  await page.locator("[data-pdf-zoom-in]").click();
  const zoomed = await width();
  check(`+ zooms the page in (${fit}% of the box → ${zoomed}%, reading ${await page.evaluate(() => document.querySelector("[data-pdf-zoom-level]").textContent)})`, Math.abs(fit - 100) <= 2 && Math.abs(zoomed - 200) <= 3);
  await page.locator('[data-pdf-tool-button="staff"]').click();
  const at = await onScreen(sys0[0] + 400, splitY, true);
  await page.mouse.click(at.x, at.y);
  const split = await page.evaluate(() => [...document.querySelectorAll("[data-pdf-split]")].map((l) => Number(l.getAttribute("data-pdf-split"))));
  check(`at 200%, a click between the staves splits the system exactly there (${split} for ${Math.round(splitY)}), staves numbered`, split.length === 1 && Math.abs(split[0] - splitY) <= 2 && (await page.evaluate(() => document.querySelectorAll("[data-pdf-staff-label]").length)) === 2);
  await page.locator("[data-pdf-zoom-out]").click();
  await page.locator("[data-pdf-zoom-out]").click();
  check("− zooms back to the box's width", Math.abs((await width()) - 100) <= 2);
  await page.locator("[data-pdf-draw-done]").click();
  await page.evaluate(() => document.querySelector('.tile[data-index="0"]').scrollIntoView({ block: "center" }));
  const bass = await page.evaluate(() => {
    const s = window.__SESSION__;
    return s.index.eventsAt(0, 2, 1)[0];
  });
  await page.locator(`.tile[data-index="0"] g[id="${bass}"] use, .tile[data-index="0"] g[id="${bass}"]`).first().click({ force: true });
  await page.waitForFunction(() => document.querySelector("[data-pdf-current-staff]"), null, { timeout: 5000 }).catch(() => undefined);
  check("a note on the second staff highlights the second staff of its measure in the strip", (await page.evaluate(() => document.querySelector("[data-pdf-current-staff]")?.getAttribute("data-pdf-current-staff"))) === "2");
  if (process.env.SHOT2) await page.screenshot({ path: process.env.SHOT2 });

  // --- 10b. touch: one finger draws, two move the page (2026-10-29) ------------------
  // User-reported on a tablet: every drag drew, so the zoomed page could not be
  // moved. Real touches through the DevTools protocol (Playwright's touchscreen
  // taps with one finger only); each start/move/end carries every finger down.
  {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, id) => ({ x: Math.round(p.x), y: Math.round(p.y), id })) });
    const gesture = async (from, by, steps = 8) => {
      await touch("touchStart", from);
      for (let i = 1; i <= steps; i++) await touch("touchMove", from.map((p) => ({ x: p.x + (by.x * i) / steps, y: p.y + (by.y * i) / steps })));
      await touch("touchEnd", []);
      await page.waitForTimeout(150);
    };
    const state = () => page.evaluate(() => {
      const s = document.querySelector("[data-pdf-editor-scroll]");
      return { left: Math.round(s.scrollLeft), top: Math.round(s.scrollTop), systems: document.querySelectorAll("[data-pdf-system]").length, barlines: document.querySelectorAll("[data-pdf-barline]").length, dragging: Boolean(document.querySelector("[data-pdf-drag]")) };
    });
    await page.locator("[data-pdf-draw]").click();
    await page.waitForSelector("[data-pdf-editor]", { timeout: 5000 });
    await page.locator("[data-pdf-zoom-in]").click();
    await page.locator("[data-pdf-zoom-in]").click(); // 200%: the box scrolls both ways
    const mid = await page.evaluate(() => {
      const s = document.querySelector("[data-pdf-editor-scroll]");
      s.scrollLeft = 300;
      s.scrollTop = 600;
      const r = s.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    check(`the move hint is in the drawing bar ("${await page.evaluate(() => document.querySelector("[data-pdf-move-hint]")?.textContent ?? "")}")`, (await page.locator("[data-pdf-move-hint]").count()) === 1);
    await page.locator('[data-pdf-tool-button="system"]').click();
    const s0 = await state();
    await gesture([{ x: mid.x - 40, y: mid.y }, { x: mid.x + 40, y: mid.y }], { x: -120, y: -90 });
    const s1 = await state();
    check(`two fingers move the page (scroll ${s0.left},${s0.top} → ${s1.left},${s1.top}) and draw no system (${s0.systems} → ${s1.systems})`, Math.abs(s1.left - s0.left - 120) <= 3 && Math.abs(s1.top - s0.top - 90) <= 3 && s1.systems === s0.systems && !s1.dragging);
    await page.locator('[data-pdf-tool-button="barline"]').click();
    await gesture([{ x: mid.x - 40, y: mid.y }, { x: mid.x + 40, y: mid.y }], { x: 60, y: 40 });
    const s2 = await state();
    check(`…with the barline tool too: the page moves back (${s2.left},${s2.top}) and no barline toggles where a finger lifts (${s1.barlines} → ${s2.barlines})`, Math.abs(s1.left - s2.left - 60) <= 3 && Math.abs(s1.top - s2.top - 40) <= 3 && s2.barlines === s1.barlines);
    await page.locator('[data-pdf-tool-button="system"]').click();
    await gesture([{ x: mid.x - 150, y: mid.y - 50 }], { x: 300, y: 100 });
    const s3 = await state();
    check(`one finger still draws a system (${s2.systems} → ${s3.systems}) and leaves the page where it was`, s3.systems === s2.systems + 1 && s3.left === s2.left && s3.top === s2.top);
    // its × by a one-finger tap: the drawing as it was
    const x = await page.evaluate((i) => {
      const r = document.querySelector(`[data-pdf-remove-system="${i}"]`).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, s3.systems - 1);
    await gesture([x], { x: 0, y: 0 }, 1);
    check(`…and a tap on its × takes it away (${s3.systems} → ${(await state()).systems})`, (await state()).systems === s2.systems);
    await page.locator("[data-pdf-zoom-out]").click();
    await page.locator("[data-pdf-zoom-out]").click();
    await page.locator("[data-pdf-draw-done]").click();

    // --- 10c. zoom below the panel's width; a system resized by its corners (2026-10-29) ---
    // The user: "we don't have negative zoom … needed specially in landscape" and
    // "we cannot resize the systems".
    await page.locator("[data-pdf-draw]").click();
    await page.waitForSelector("[data-pdf-editor]", { timeout: 5000 });
    for (let i = 0; i < 3; i++) await page.locator("[data-pdf-zoom-out]").click();
    const quarter = await page.evaluate(() => {
      const box = document.querySelector("[data-pdf-editor-scroll]").getBoundingClientRect();
      const pg = document.querySelector("[data-pdf-editor-page]").getBoundingClientRect();
      return { share: Math.round((pg.width / box.width) * 100), left: Math.round(pg.left - box.left), right: Math.round(box.right - pg.right), label: document.querySelector("[data-pdf-zoom-level]").textContent, outOff: document.querySelector("[data-pdf-zoom-out]").disabled };
    });
    check(`− goes below the panel's width, to a quarter, the page centred (${JSON.stringify(quarter)})`, Math.abs(quarter.share - 25) <= 1 && Math.abs(quarter.left - quarter.right) <= 2 && quarter.label === "25%" && quarter.outOff);
    const xSize = await page.evaluate(() => Math.round(document.querySelector('[data-pdf-remove-system="0"]').getBoundingClientRect().width));
    check(`…and a system's × keeps a finger's size there (${xSize} px)`, xSize >= 22);
    for (let i = 0; i < 3; i++) await page.locator("[data-pdf-zoom-in]").click();
    await page.locator('[data-pdf-tool-button="system"]').click();
    const sys = () => page.evaluate(() => {
      const r = document.querySelector('[data-pdf-system="0"] rect');
      return { x0: Math.round(Number(r.getAttribute("x"))), x1: Math.round(Number(r.getAttribute("x")) + Number(r.getAttribute("width"))), barlines: [...document.querySelectorAll('[data-pdf-system="0"] [data-pdf-barline]')].map((l) => Number(l.getAttribute("data-pdf-barline"))) };
    });
    /** A page x (its pixels) on screen, at the handle's own height. */
    const screenX = (x) => page.evaluate((x) => { const r = document.querySelector("[data-pdf-editor]").getBoundingClientRect(); return r.left + (x / 2100) * r.width; }, x);
    const handle = async (name) => {
      await page.locator(`[data-pdf-resize="${name}"]`).scrollIntoViewIfNeeded();
      return page.evaluate((n) => { const r = document.querySelector(`[data-pdf-resize="${n}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, name);
    };
    const before = await sys();
    const annotated0 = await attr("data-pdf-annotated");
    check(`the systems tool shows each system's four corners (${await page.locator('[data-pdf-resize^="0:"]').count()})`, (await page.locator('[data-pdf-resize^="0:"]').count()) === 4);
    // the right edge in, between the second and the third barline: the last measure goes
    const inX = Math.round((before.barlines[1] + before.barlines[2]) / 2);
    const se = await handle("0:se");
    await page.mouse.move(se.x, se.y);
    await page.mouse.down();
    await page.mouse.move((se.x + (await screenX(inX))) / 2, se.y, { steps: 4 });
    await page.mouse.move(await screenX(inX), se.y, { steps: 4 });
    await page.mouse.up();
    const after = await sys();
    check(`dragging a corner resizes the system (right edge ${before.x1} → ${after.x1} for ${inX}), the barline it leaves out goes (${before.barlines.length} → ${after.barlines.length}), the measures follow (${annotated0} → ${await attr("data-pdf-annotated")})`, Math.abs(after.x1 - inX) <= 6 && after.x0 === before.x0 && after.barlines.length === before.barlines.length - 1 && Number(await attr("data-pdf-annotated")) === Number(annotated0) - 1);
    await page.locator('[data-pdf-tool-button="barline"]').click();
    check("with the barline tool the corners are gone (a tap in a system is a barline)", (await page.locator("[data-pdf-resize]").count()) === 0);
    await page.locator('[data-pdf-tool-button="system"]').click();
    // by a finger: the right edge back out
    const se2 = await handle("0:se");
    await gesture([se2], { x: (await screenX(before.x1)) - se2.x, y: 0 });
    const back = await sys();
    check(`one finger on a corner resizes too (right edge ${after.x1} → ${back.x1}), the dropped barline staying dropped (${back.barlines.length})`, Math.abs(back.x1 - before.x1) <= 6 && back.barlines.length === after.barlines.length);
    // two fingers, one of them on a corner: a pan, never a resize
    const se3 = await handle("0:se");
    const scroll0 = await state();
    // (upwards: at 100% the page is the box's width, so only the vertical scroll can move)
    await gesture([se3, { x: se3.x - 200, y: se3.y }], { x: 0, y: -60 });
    const panned = await sys();
    check(`two fingers with one on a corner move the page (scroll top ${scroll0.top} → ${(await state()).top}) and leave the system as it was (${back.x1} → ${panned.x1})`, panned.x1 === back.x1 && Math.abs((await state()).top - scroll0.top - 60) <= 3);
    await page.locator("[data-pdf-draw-done]").click();
    await cdp.detach();
  }

  // --- 11. the pages as images, with their annotation files --------------------------
  check(`both pages were kept as PNGs to try (${Object.keys(pagePngs).join(", ")})`, Object.keys(pagePngs).length === 2);
  await page.locator("[data-pdf-clear]").click();
  await page.setInputFiles("[data-pdf-file]", [
    { name: `${EXAMPLE}_page2.png`, mimeType: "image/png", buffer: Buffer.from(pagePngs["2"], "base64") },
    { name: `${EXAMPLE}_page1.png`, mimeType: "image/png", buffer: Buffer.from(pagePngs["1"], "base64") },
    ...pageFiles.map((f) => ({ name: f, mimeType: "application/json", buffer: readFileSync(`${DIR}/${f}`) })),
  ]);
  await page.waitForFunction(() => ["ready", "error"].includes(document.querySelector("[data-pdf-ref]")?.getAttribute("data-pdf-state")), null, { timeout: 30000 });
  const imgs = { state: await attr("data-pdf-state"), pages: await attr("data-pdf-pages"), annotated: await attr("data-pdf-annotated"), source: await attr("data-pdf-source"), name: await page.evaluate(() => document.querySelector("[data-pdf-ref] span[title]")?.textContent ?? "") };
  check(`two PNG pages with their annotation files load in place of the PDF (${JSON.stringify(imgs)})`, imgs.state === "ready" && imgs.pages === "2" && imgs.annotated === "38" && imgs.source === "files" && /_page1\.png \+ 1 more/.test(imgs.name));
  await page.waitForFunction(() => document.querySelectorAll("[data-pdf-scan]").length >= 8, null, { timeout: 10000 }).catch(() => undefined);
  check("…and the scans stand above the tiles, the page images at their own size", (await page.evaluate(() => document.querySelectorAll("[data-pdf-scan]").length)) >= 8 && (await page.evaluate(() => document.querySelector('[data-pdf-scan][data-pdf-page="1"] image')?.getAttribute("width"))) === "2100");

  // --- 7b. the panel beside a side panel, and under the status bar's popovers ----------
  // User-reported 2026-10-19: the folder view hid the strip's left side (the
  // bottom area ran under it from the window's edge), and the zoom popover
  // opened behind the bottom panel.
  const rects = () => page.evaluate(() => {
    const r = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    return { bottom: r('[data-panels="bottom"]'), side: r('[data-panels="side"]'), width: document.documentElement.clientWidth };
  });
  // the header face until the plugin runs, then the plugin's own button
  const folderToggle = () => page.locator('[data-slot-command="battuta.folder-view.toggle"], [data-folder-toggle]').first();
  await folderToggle().click();
  await page.waitForFunction(() => document.querySelector('[data-panels="side"]'), null, { timeout: 10000 });
  const beside = await rects();
  check(`with the folder view up, the bottom panel starts where it ends (${beside.side.right} → ${beside.bottom.left}…${beside.bottom.right} of ${beside.width})`, Math.abs(beside.bottom.left - beside.side.right) <= 1 && Math.abs(beside.bottom.right - beside.width) <= 1);
  await folderToggle().click();
  await page.waitForFunction(() => !document.querySelector('[data-panels="side"]'), null, { timeout: 10000 });
  check("…and takes the full width back when it closes", (await rects()).bottom.left === 0);
  await page.locator("[data-zoom-toggle]").click();
  const zoomOnTop = await page.evaluate(() => {
    const b = document.querySelector("[data-zoom-in]");
    const r = b.getBoundingClientRect();
    const panel = document.querySelector('[data-panels="bottom"]').getBoundingClientRect();
    return { over: r.top < panel.bottom && r.bottom > panel.top, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b };
  });
  check(`the zoom popover opens over the bottom panel, its buttons reachable (${JSON.stringify(zoomOnTop)})`, zoomOnTop.over && zoomOnTop.hit);
  const zoom0 = await page.locator("[data-zoom-toggle]").getAttribute("data-zoom");
  await page.locator("[data-zoom-in]").click();
  check("…and + zooms the score", (await page.locator("[data-zoom-toggle]").getAttribute("data-zoom")) !== zoom0);
  await page.locator("[data-zoom-reset]").click();
  await page.locator("[data-zoom-toggle]").click();

  // --- 8. close, and nothing else ----------------------------------------------------
  await page.locator("[data-pdf-close]").click();
  await page.waitForFunction(() => !document.querySelector("[data-pdf-ref]"), null, { timeout: 5000 });
  check("× closes the panel and takes the scans and their room with it", await page.evaluate(() => document.querySelectorAll("[data-band]").length === 0 && document.querySelectorAll("[data-band-spacer]").length === 0));
  check("…and the 📄 dims", await page.evaluate(() => Number(getComputedStyle(document.querySelector("[data-pdf-toggle]")).opacity) < 0.9));
  check("it contributes no keybinding", await page.evaluate(() => !window.__HOST__.keymapView.get().some((e) => e.plugin === "battuta.pdf-reference")));
  check("…and nothing was written to the document", await page.evaluate(() => window.__SESSION__.stack.undoDepth === 0));
} catch (e) {
  console.error("SCRIPT ERROR", e);
  failures++;
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
