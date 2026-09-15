/**
 * Formats end-to-end check — importing and exporting through the UI.
 *
 * Written before slice 8a moved import detection and the export rows onto
 * the host's `formats` registry, and before 8b moved the Verovio
 * converters into @battuta/plugin-formats, so both had something to be
 * behaviour-neutral against (PLANNING.md: "if none drives the feature you
 * are extracting, add one FIRST"). Green unchanged through both; 8b moved
 * only what its own design decides — the `.mxl` fixture's path (it lives
 * with the pinning test, which is the plugin's now) and the three export
 * ids (a plugin's are `<pluginId>.<format>`), never an assertion. Everything goes through what a user touches — the file
 * input (what "open file…" and drag-and-drop feed) and the battuta menu:
 *
 *  1. a compressed MusicXML (.mxl, binary) opens as a new unsaved tab
 *  2. an ABC file (text) opens; a .xml MusicXML is told apart from MEI
 *  3. an unknown extension is refused with a notice
 *  4. the four Verovio exports download real files (SMF header, **kern,
 *     PAE, SVG), and the menu lists them in order
 *  5. the open dialog's accept list covers MEI and every import format
 *
 * Run: BATTUTA_ROOT=$PWD CHROME=bundled SCRATCH=/tmp/battuta-e2e node spikes/verify-formats.mjs
 */
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ROOT = process.env.BATTUTA_ROOT ?? "/home/flux/projects/battuta";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const SCRATCH = process.env.SCRATCH ?? "/tmp/battuta-e2e";
mkdirSync(SCRATCH, { recursive: true });

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};

const server = await createServer({
  configFile: `${ROOT}/apps/editor/vite.config.ts`,
  root: `${ROOT}/apps/editor`,
  server: { port: 0 },
  logLevel: "warn",
});
await server.listen();
const browser = await chromium.launch({ ...(CHROME === "bundled" ? {} : { executablePath: CHROME }), headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(server.resolvedUrls.local[0] + "?pool=2");
try {
  await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 3, null, { timeout: 60000 });

  const notice = () => page.evaluate(() => document.querySelector("[data-notice]")?.textContent ?? "");
  const tabNames = () => page.evaluate(() => [...document.querySelectorAll(".tab")].filter((t) => !t.classList.contains("tab-new")).map((t) => t.textContent.replace(/×/g, "").replace(/\*/g, "").trim()));
  const activeTab = () => page.evaluate(() => document.querySelector(".tab.active")?.textContent.replace(/×/g, "").replace(/\*/g, "").trim() ?? null);
  const measureCount = () => page.evaluate(() => window.__SESSION__.score.measures.length);
  const waitNotice = (s) => page.waitForFunction((x) => (document.querySelector("[data-notice]")?.textContent ?? "").includes(x), s, { timeout: 60000 });
  /** Feed a file to the hidden input — what "open file…" and a drop both do. */
  const openFile = (path) => page.setInputFiles('input[type="file"]', path);

  // --- 1. compressed MusicXML (binary) -------------------------------------
  let tabs0 = await tabNames();
  await openFile(`${ROOT}/packages/plugins/formats/test/fixtures/sample.mxl`);
  const first = await waitNotice("imported sample.mxl").then(() => true).catch(() => false);
  if (!first) {
    // The converter worker's dependency (the Humdrum Verovio build) is
    // optimised by the Vite dev server on its FIRST use, which reloads the
    // page and wipes the notice. That is the dev server, not the app: wait
    // for the reload to settle and import once more.
    await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 3, null, { timeout: 60000 });
    tabs0 = await tabNames();
    await openFile(`${ROOT}/packages/plugins/formats/test/fixtures/sample.mxl`);
    await waitNotice("imported sample.mxl");
  }
  check(`an .mxl imports through the file input (${(await notice()).trim()})`, (await notice()).includes("compressed MusicXML → MEI"));
  await page.waitForFunction((n) => document.querySelectorAll(".tab").length > n + 1, tabs0.length, { timeout: 60000 });
  check("…and opens as a NEW tab named after the file", (await activeTab()) === "sample" && (await tabNames()).length === tabs0.length + 1);
  check("…with notes in it", (await measureCount()) >= 1 && (await page.evaluate(() => window.__SESSION__.score.measures[0].children.length > 0)));

  // --- 2. text imports: ABC, and a .xml that is MusicXML, not MEI ------------
  const abcPath = `${SCRATCH}/tune.abc`;
  writeFileSync(abcPath, "X:1\nT:tune\nM:4/4\nL:1/4\nK:C\nCDEF|GABc|\n");
  await openFile(abcPath);
  await waitNotice("imported tune.abc");
  check(`an ABC file imports as text (${(await notice()).trim()})`, (await notice()).includes("(ABC → MEI)") && (await activeTab()) === "tune");
  check("…two measures of four quarters", (await measureCount()) === 2);

  const xmlPath = `${SCRATCH}/partwise.xml`;
  writeFileSync(
    xmlPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure></part>
</score-partwise>`,
  );
  await openFile(xmlPath);
  await waitNotice("imported partwise.xml");
  check(`a .xml holding MusicXML is told apart from MEI by its root (${(await notice()).trim()})`, (await notice()).includes("(MusicXML → MEI)"));

  // --- 3. an unknown extension -------------------------------------------
  const pdfPath = `${SCRATCH}/score.pdf`;
  writeFileSync(pdfPath, "%PDF-1.4 not a score");
  // The accept list would stop a user; Playwright bypasses it, so the App's own guard must answer.
  await openFile(pdfPath);
  await waitNotice("unsupported file type");
  check(`an unknown extension is refused with a notice (${(await notice()).trim()})`, (await notice()).includes("score.pdf"));

  // --- 5. the open dialog's accept list ------------------------------------
  const accept = await page.evaluate(() => document.querySelector('input[type="file"]').getAttribute("accept"));
  check(`the file input accepts MEI and every import format (${accept})`, [".mei", ".musicxml", ".xml", ".mxl", ".abc", ".pae", ".krn", ".kern"].every((e) => accept.split(",").includes(e)));

  // --- 4. exports, from the battuta menu -------------------------------------
  await page.locator(".tab", { hasText: "tune" }).click();
  await page.waitForFunction(() => document.querySelector(".tab.active")?.textContent.includes("tune"), null, { timeout: 5000 });
  const exportIds = await page.evaluate(async () => {
    document.querySelector("[data-menu-toggle]").click();
    await new Promise((r) => setTimeout(r, 50));
    const ids = [...document.querySelectorAll("[data-app-menu] [data-export]")].map((b) => b.dataset.export);
    document.querySelector("[data-menu-toggle]").click();
    return ids;
  });
  // Relative order of the four rows the Verovio formats produce. Where the
  // registry puts the playback plugin's own export around them is the
  // registry's business, and SVG leads because it is the host's last
  // INTERNAL export while the other three are the formats plugin's
  // declared ones (8a moved this same assertion once, for the same
  // reason).
  const VEROVIO_ROWS = ["svg", "battuta.formats.midi", "battuta.formats.humdrum", "battuta.formats.pae"];
  check(`the menu lists the exports in order (${exportIds.join(", ")})`, exportIds.filter((id) => VEROVIO_ROWS.includes(id)).join(",") === VEROVIO_ROWS.join(","));

  const exportOne = async (id) => {
    await page.locator("[data-menu-toggle]").click();
    await page.waitForFunction(() => document.querySelector("[data-app-menu]"), null, { timeout: 5000 });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.locator(`[data-app-menu] [data-export="${id}"]`).click()]);
    const path = `${SCRATCH}/${download.suggestedFilename()}`;
    await download.saveAs(path);
    return { name: download.suggestedFilename(), bytes: readFileSync(path) };
  };
  const midi = await exportOne("battuta.formats.midi");
  check(`MIDI (written score) downloads an SMF named ${midi.name}`, midi.name === "tune.mid" && midi.bytes.subarray(0, 4).toString("latin1") === "MThd");
  const krn = await exportOne("battuta.formats.humdrum");
  check(`Humdrum downloads **kern named ${krn.name}`, krn.name === "tune.krn" && krn.bytes.toString("utf8").startsWith("**kern"));
  const pae = await exportOne("battuta.formats.pae");
  check(`Plaine & Easie downloads PAE named ${pae.name}`, pae.name === "tune.pae" && /@data:/.test(pae.bytes.toString("utf8")));
  const svg = await exportOne("svg");
  check(`SVG downloads the engraved page named ${svg.name}`, svg.name === "tune.svg" && svg.bytes.toString("utf8").includes("<svg"));
  await waitNotice("exported");
  check(`…and says so (${(await notice()).trim()})`, (await notice()).includes("exported"));
} catch (e) {
  console.error("SCRIPT ERROR", e);
  failures++;
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
