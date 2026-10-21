/**
 * The App Store and Google Play screenshots, at the sizes each store asks
 * for, and Google Play's feature graphic and icon (phase 10, M4) — made from
 * the app itself, the editor's dev server driven by Playwright as
 * docs/scripts/build-shots.mjs drives it, so they follow the app as it
 * changes:
 *
 *   ios-iphone-6.9     1320 × 2868   iPhone 6.9″, upright
 *   ios-ipad-13        2752 × 2064   iPad 13″, sideways
 *   android-phone      1080 × 1920   9:16, upright
 *   android-tablet     2560 × 1440   16:9, sideways
 *   google-play/feature-graphic.png   1024 × 500
 *   google-play/icon.png               512 × 512
 *
 * Each set sees the app as that device does: the shell's marker (iOS or
 * Android), a touch screen — so the on-screen keyboard comes up by itself —
 * and the device's width. The scenes: writing at the caret; page view
 * playing; a block selected; a PDF's scans over the measures to transcribe;
 * the folder view. Schumann's Melodie from docs/excerpts, the Chopin PDF the
 * e2e uses (fixtures/pdf-reference). One thing is staged: a browser has no
 * folder to list, so the folder view's list comes through the very commands
 * the shell answers, as in the docs' shot — the panel is the app's.
 *
 *   npm run store:screenshots   → apps/editor/store/screenshots/<set>/NN-<scene>.png
 *
 * The output is not kept in git. Takes a minute or two; CHROME=/path for
 * another browser than Playwright's own.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const editor = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(editor, "../..");
const OUT = join(editor, "store/screenshots");

const SETS = [
  { id: "ios-iphone-6.9", width: 440, height: 956, scale: 3, platform: "ios" },
  { id: "ios-ipad-13", width: 1376, height: 1032, scale: 2, platform: "ios" },
  { id: "android-phone", width: 360, height: 640, scale: 3, platform: "android" },
  { id: "android-tablet", width: 1280, height: 720, scale: 2, platform: "android" },
];

const MELODIE = join(repo, "docs/excerpts/schumann-melodie.mei");
const PDF_DIR = join(repo, "fixtures/pdf-reference");
const PDF_NAME = "Qmcts7FEQamQMHpYWF51x1VnhQ8r4Hoy8sR1uTFU3UVYAh"; // Chopin, Polonaise in G minor: 2 pages, 38 measures
const PDF_PAGES = readdirSync(PDF_DIR).filter((f) => /_page\d+\.json$/.test(f)).sort();
// The score being transcribed: the PDF's measures, still empty, under the
// ids its annotation files carry — so every scan finds its tile.
const POLONAISE_IDS = PDF_PAGES.flatMap((f) => JSON.parse(readFileSync(join(PDF_DIR, f), "utf8")).annotations.filter((a) => a.class === "measure").map((a) => a.id));
const POLONAISE = `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
  <meiHead><fileDesc><titleStmt><title>Polonaise in G minor</title></titleStmt><pubStmt/></fileDesc></meiHead>
  <music><body><mdiv><score>
    <scoreDef meter.count="3" meter.unit="4" keysig="2f"><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef>
    <section>
${POLONAISE_IDS.map((id, i) => `      <measure n="${i + 1}" xml:id="${id}"><staff n="1"><layer n="1"><mRest/></layer></staff></measure>`).join("\n")}
    </section>
  </score></mdiv></body></music></mei>
`;

const server = await createServer({ configFile: join(editor, "vite.config.ts"), root: editor, server: { port: 0 }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), headless: true });
rmSync(OUT, { recursive: true, force: true });
let musicStrip = null; // a page-view system, for the feature graphic

try {
  for (const set of SETS) {
    const dir = join(OUT, set.id);
    mkdirSync(dir, { recursive: true });
    const context = await browser.newContext({ viewport: { width: set.width, height: set.height }, deviceScaleFactor: set.scale, isMobile: true, hasTouch: true });
    await context.addInitScript((platform) => {
      window.__BATTUTA_SHELL__ = { platform, mobile: true };
    }, set.platform);
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error(`[${set.id}] pageerror:`, e.message));
    const shot = async (name) => {
      await page.waitForTimeout(400); // the last layout pass and paint
      await page.screenshot({ path: join(dir, `${name}.png`) });
      console.log(`  ${set.id}/${name}.png`);
    };
    const until = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout });
    const caretOn = async (id) => {
      const target = page.locator(`g[id="${id}"] use, g[id="${id}"]`).first();
      await target.scrollIntoViewIfNeeded().catch(() => undefined);
      for (let t = 0; t < 5; t++) {
        await target.click({ force: true }).catch(() => undefined);
        if (await until((x) => document.querySelector("main").dataset.caret === x, id, 2000).then(() => true, () => false)) return;
      }
      throw new Error(`the caret never reached ${id}`);
    };
    const keyboard = async (open) => {
      if (Boolean(await page.$("[data-vkeys]")) === open) return;
      if (open) await page.locator('[data-slot-command="battuta.onscreen-keyboard.toggle"], [data-vkeys-toggle]').first().click();
      else await page.locator("[data-vk-close]").click();
      await until((o) => Boolean(document.querySelector("[data-vkeys]")) === o, open);
    };

    await page.goto(server.resolvedUrls.local[0] + "?pool=2");
    await until(() => document.querySelectorAll(".tile svg").length > 0, null, 60000);

    // ---- the Melodie, alone: the dev fixture's tab closes ------------------
    await page.setInputFiles('input[type="file"]', MELODIE);
    await until(() => [...document.querySelectorAll(".tabs .tab")].some((t) => t.textContent.includes("melodie")));
    await page.locator(".tabs .tab").first().locator(".tab-close").click();
    await until(() => document.querySelectorAll(".tabs .tab:not(.tab-new)").length === 1 && document.querySelectorAll(".tile svg").length >= 4, null, 60000);
    const firstNote = await page.evaluate(() => window.__SESSION__.index.eventsAt(1, 1, 1).find((id) => window.__SESSION__.index.byId.get(id)?.tag === "note"));

    // ---- 1. writing at the caret: input mode, the on-screen keyboard -------
    // The caret first: on a small phone the keyboard (up by itself on a
    // touch screen) covers the note; opened after, it follows the caret.
    await keyboard(false);
    await caretOn(firstNote);
    await keyboard(true);
    await page.locator("[data-input-indicator]").click();
    await until(() => document.querySelector("[data-input-indicator]").textContent !== "INPUT (i)");
    await shot("01-write");
    await page.locator("[data-input-indicator]").click();
    await keyboard(false);

    // ---- 2. page view, playing: the sounding notes lit -----------------------
    await page.locator("header button", { hasText: "page view" }).click();
    await until(() => document.querySelector(".pages .page svg"), null, 60000);
    await page.locator("[data-player-toggle]").click();
    await until(() => document.querySelector(".pages g.playing"), null, 60000);
    await until(() => !(document.querySelector("[data-player-time]")?.textContent ?? "0:00").trim().startsWith("0:00"), null, 15000);
    await shot("02-page-view");
    if (set.id === "ios-ipad-13") {
      const box = await page.locator(".pages .page svg").first().boundingBox();
      musicStrip = await page.screenshot({ clip: { x: box.x, y: box.y + box.height * 0.08, width: box.width, height: box.width * 0.36 } });
    }
    await page.locator("[data-player-stop]").click();
    await page.locator("header button", { hasText: "edit view" }).click();
    await until(() => document.querySelectorAll(".tile svg").length >= 4, null, 60000);

    // ---- 3. a block: two measures × every staff, dragged ---------------------
    {
      const at = (index, last) =>
        page.evaluate(
          ([i, l]) => {
            const staves = document.querySelector(`.tile[data-index="${i}"]`).querySelectorAll("g.staff[id]");
            const r = staves[l ? staves.length - 1 : 0].getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          },
          [index, last],
        );
      await page.locator('.tile[data-index="1"]').scrollIntoViewIfNeeded();
      const a = await at(1, false);
      const b = await at(2, true);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 6 });
      await page.mouse.up();
      await until(() => document.querySelector("main").dataset.block !== "");
      await shot("03-arrange");
      await page.keyboard.press("Escape");
    }

    // ---- 4. transcribing: the PDF's scans over the empty measures -------------
    await page.setInputFiles('input[type="file"]', { name: "Polonaise.mei", mimeType: "application/xml", buffer: Buffer.from(POLONAISE) });
    await until((n) => (document.querySelector(".tab.active")?.textContent ?? "").includes("Polonaise") && document.querySelectorAll(".tile").length === n, POLONAISE_IDS.length, 60000);
    await page.locator('[data-slot-command="battuta.pdf-reference.toggle"], [data-pdf-toggle]').first().click();
    await page.waitForSelector("[data-pdf-ref]");
    // under a name a reader can read: the fixture's is the page set's content hash
    const shown = (f) => f.replace(PDF_NAME, "Chopin - Polonaise in G minor");
    await page.setInputFiles("[data-pdf-file]", [`${PDF_NAME}.pdf`, ...PDF_PAGES].map((f) => ({ name: shown(f), mimeType: f.endsWith(".pdf") ? "application/pdf" : "application/json", buffer: readFileSync(join(PDF_DIR, f)) })));
    await until(() => document.querySelector("[data-pdf-ref]")?.getAttribute("data-pdf-state") === "ready", null, 90000);
    await until(() => document.querySelectorAll('[data-band="scan"] [data-pdf-scan]').length >= 2, null, 15000);
    await caretOn(await page.evaluate(() => document.querySelector('.tile[data-index="0"] g.mRest[id]')?.id));
    await shot("04-transcribe");
    await page.locator("[data-pdf-close]").click();
    await until(() => !document.querySelector("[data-pdf-ref]"));
    await page.locator(".tabs .tab", { hasText: "melodie" }).click();
    await until(() => (document.querySelector(".tab.active")?.textContent ?? "").includes("melodie") && document.querySelectorAll(".tile svg").length >= 4, null, 60000);

    // ---- 5. the folder view on battuta's own folder ------------------------------
    // Staged: the list arrives through the shell's own commands (see the header).
    await page.evaluate(() => {
      const HOME = "/battuta/Documents";
      const file = (dir, name) => ({ name, path: `${dir}/${name}`, kind: "file" });
      const folder = (dir, name) => ({ name, path: `${dir}/${name}`, kind: "dir" });
      const LIST = {
        [HOME]: [folder(HOME, "Exercises"), folder(HOME, "Schumann"), file(HOME, "Melodie.mei"), file(HOME, "Polonaise.mei"), file(HOME, "Soldatenmarsch.mei"), file(HOME, "untitled-1.mei")],
        [`${HOME}/Schumann`]: [file(`${HOME}/Schumann`, "Album für die Jugend 1.mei"), file(`${HOME}/Schumann`, "Album für die Jugend 2.mei"), file(`${HOME}/Schumann`, "Kinderszenen 7.mei")],
        [`${HOME}/Exercises`]: [],
      };
      const ws = window.__HOST__.workspace;
      ws.bridge = {
        invoke: async (cmd, args) => {
          switch (cmd) {
            case "workspace_home":
              return HOME;
            case "workspace_pick_folder":
              return HOME;
            case "workspace_open_folder":
              return true;
            case "workspace_read_dir":
              return LIST[args.path] ?? [];
            case "workspace_watch":
              return 1;
            default:
              return null;
          }
        },
        listen: async () => () => undefined,
      };
      ws.available = true;
    });
    await page.locator('[data-slot-command="battuta.folder-view.toggle"], [data-folder-toggle]').first().click();
    await page.waitForSelector("[data-folder-view]");
    await until(() => [...document.querySelectorAll("[data-folder-view] button")].some((b) => b.textContent.includes("Melodie")), null, 10000);
    await page.locator("[data-folder-view] button", { hasText: "Schumann" }).first().click();
    await until(() => [...document.querySelectorAll("[data-folder-view] button")].some((b) => b.textContent.includes("Kinderszenen")), null, 10000);
    await shot("05-folders");

    await context.close();
  }

  // ---- Google Play: the feature graphic and the icon --------------------------
  {
    const dir = join(OUT, "google-play");
    mkdirSync(dir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
    const logo = readFileSync(join(repo, "icons/battuta-white.svg"), "utf8").replace(/<\?xml[^>]*>/, "");
    const strip = musicStrip ? `<img class="music" src="data:image/png;base64,${musicStrip.toString("base64")}">` : "";
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      html, body { margin: 0; width: 1024px; height: 500px; overflow: hidden; background: #fff; }
      body { position: relative; font-family: -apple-system, "SF Pro Display", "Inter", "Segoe UI", system-ui, sans-serif; color: #1f2733; }
      .mark { position: absolute; left: 64px; top: 92px; width: 156px; height: 156px; }
      .mark svg { width: 100%; height: 100%; }
      h1 { position: absolute; left: 252px; top: 96px; margin: 0; font-size: 104px; font-weight: 700; letter-spacing: -3px; }
      p { position: absolute; left: 66px; top: 282px; margin: 0; font-size: 34px; line-height: 1.25; }
      small { position: absolute; left: 66px; top: 384px; font-size: 21px; line-height: 1.45; color: #5b6878; }
      .music { position: absolute; right: 28px; top: 268px; width: 440px; opacity: .3; }
    </style></head><body>${strip}<div class="mark">${logo}</div><h1>battuta</h1>
      <p>Edit notation the way<br>you edit text.</p>
      <small>Free and open source · MEI<br>Notation engraved by Verovio</small></body></html>`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(dir, "feature-graphic.png") });
    console.log("  google-play/feature-graphic.png");
    await page.setViewportSize({ width: 512, height: 512 });
    await page.setContent(`<!doctype html><html><head><style>html, body { margin: 0; background: #fff; } svg { display: block; width: 512px; height: 512px; }</style></head><body>${logo}</body></html>`);
    await page.screenshot({ path: join(dir, "icon.png") });
    console.log("  google-play/icon.png");
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`✓ the store screenshots are in ${OUT}`);
