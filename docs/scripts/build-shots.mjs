/**
 * Real screenshots of the running editor — the UI counterpart of
 * build-figures.mjs. Playwright drives the actual app (the repo root's dev
 * server) through a fixed script against the Schumann excerpts in
 * excerpts/, and captures each shot at 2× for crisp rendering. Like the
 * figures, every image is generated: a shot can never show a UI battuta
 * does not have.
 *
 * Needs the repo root's node_modules (vite, playwright) and a Chrome at
 * /usr/bin/google-chrome — heavier than the other generators, so it is NOT
 * part of `npm run assets`. Regenerate after UI changes with:
 *
 *   npm run shots
 *
 * Output: public/shots/*.png + public/shots/manifest.json (alt text and
 * CSS display size). Unlike figures, the shots ARE meant to be committed:
 * building the site should not require a browser and a display stack.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(here, "..");
const repoRoot = resolve(docsRoot, "..");
const outDir = join(docsRoot, "public/shots");
mkdirSync(outDir, { recursive: true });

const rootRequire = createRequire(join(repoRoot, "package.json"));
const interop = (m) => m.default ?? m; // CJS entries put their exports on default
const viteEntry = join(dirname(rootRequire.resolve("vite/package.json")), "dist/node/index.js");
const { createServer } = interop(await import(pathToFileURL(viteEntry)));
const { chromium } = interop(await import(pathToFileURL(rootRequire.resolve("playwright"))));

const SCALE = 2; // devicePixelRatio of the captures
const manifest = [];

const server = await createServer({
  configFile: join(repoRoot, "apps/editor/vite.config.ts"),
  root: join(repoRoot, "apps/editor"),
  server: { port: 0 },
  logLevel: "warn",
});
await server.listen();

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: SCALE });
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  await page.goto(server.resolvedUrls.local[0] + "?pool=2");
  await page.waitForSelector(".tile svg", { timeout: 60000 });

  /** Save a full-viewport or clipped shot and record it in the manifest. */
  const shot = async (name, alt, clip) => {
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path, ...(clip ? { clip } : {}) });
    const w = clip ? Math.round(clip.width) : 1280;
    const h = clip ? Math.round(clip.height) : 800;
    manifest.push({ name, alt, width: w, height: h });
    console.log(`  ${name}.png  ${w}×${h}`);
  };

  /** Clip box of an element, padded, clamped to the viewport. */
  const boxOf = async (selector, pad = 8) => {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`no box for ${selector}`);
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    return {
      x,
      y,
      width: Math.min(1280 - x, box.width + 2 * pad),
      height: Math.min(800 - y, box.height + 2 * pad),
    };
  };

  const clickEvent = async (id) => {
    for (let t = 0; t < 5; t++) {
      await page.locator(`g[id="${id}"] use, g[id="${id}"]`).first().click({ force: true }).catch(() => undefined);
      const ok = await page
        .waitForFunction((x) => document.querySelector("main").dataset.caret === x, id, { timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      if (ok) return;
    }
    throw new Error(`clickEvent(${id}) never landed`);
  };

  // Clean shots: hide the dev-only perf numbers and the fixtures select
  // (users of the packaged app see neither), and drop tab animations.
  await page.locator("[data-perf-toggle]").click();
  await page.addStyleTag({ content: "header > select { display: none !important; }" });

  // ---- open the Melodie excerpt ----------------------------------------
  await page.setInputFiles('input[type="file"]', join(docsRoot, "excerpts/schumann-melodie.mei"));
  await page.waitForFunction(() => [...document.querySelectorAll(".tabs .tab")].some((t) => t.textContent.includes("melodie")), null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll(".tile svg").length >= 8, null, { timeout: 60000 });
  // close the dev fixture tab: a user's window has only their own scores
  await page.locator(".tabs .tab").first().locator(".tab-close").click();
  await page.waitForFunction(() => document.querySelectorAll(".tabs .tab:not(.tab-new)").length === 1, null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll(".tile svg").length >= 8, null, { timeout: 60000 });
  // a caret makes the status bar informative
  const firstNote = await page.evaluate(() => window.__SESSION__.index.eventsAt(0, 1, 1).find((id) => window.__SESSION__.index.byId.get(id)?.tag === "note"));
  await clickEvent(firstNote);

  await shot("window", "The battuta window: header with tabs, the score as measure tiles flowed into rows, and the status bar. Schumann's Melodie is open with the caret on its first note.");

  // header, with a dirty star: make a real edit (fermata), undone after
  await page.keyboard.press("h");
  await page.waitForFunction(() => document.querySelector(".tab.active").textContent.includes("*"), null, { timeout: 5000 });
  await shot("header", "The header: the tab strip (the active tab carries the unsaved-changes star), new-tab button, open, view toggle, measure buttons, save, title, and the id-repair and shortcut-editor buttons.", await boxOf("header", 6));
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => !document.querySelector(".tab.active").textContent.includes("*"), null, { timeout: 5000 });

  await shot("statusbar", "The status bar: the INPUT indicator and caret readout on the left; staves, voices, harmony, clef, key, meter, zoom and MIDI on the right.", await boxOf("[data-statusbar]", 0));

  // input mode: the indicator goes green and reads the pending duration
  await page.keyboard.press("i");
  await page.waitForFunction(() => document.querySelector("[data-input-indicator]").textContent !== "INPUT (i)", null, { timeout: 5000 });
  await shot("statusbar-input", "Input mode on: the indicator turns green and reads the duration about to be written — here a quarter note on the 5 key — beside the caret readout.", await boxOf("[data-statusbar]", 0));
  await page.keyboard.press("Escape");

  // zoom panel
  await page.locator("[data-zoom-toggle]").click();
  await page.waitForSelector("[data-zoom-panel]");
  {
    const panel = await boxOf("[data-zoom-panel]", 8);
    const toggle = await boxOf("[data-zoom-toggle]", 8);
    const x = Math.min(panel.x, toggle.x);
    const y = Math.min(panel.y, toggle.y);
    await shot("zoom-panel", "The zoom panel over its status-bar button: minus, plus and reset, from 50% to 250% in 25% steps.", {
      x,
      y,
      width: Math.max(panel.x + panel.width, toggle.x + toggle.width) - x,
      height: Math.max(panel.y + panel.height, toggle.y + toggle.height) - y,
    });
  }
  await page.locator("[data-zoom-toggle]").click();

  // selections: a red run, then a green block
  const runEnd = await page.evaluate(() => {
    const s = window.__SESSION__;
    const ids = s.index.eventsAt(0, 1, 1).filter((id) => s.index.byId.get(id)?.tag === "note");
    return ids[ids.length - 1];
  });
  await page.locator(`g[id="${runEnd}"] use, g[id="${runEnd}"]`).first().click({ modifiers: ["Shift"], force: true });
  await page.waitForFunction(() => [...document.querySelectorAll("style")].some((s) => s.textContent.includes("#d22")), null, { timeout: 5000 });
  await shot("selection-run", "An event run selected in red: shift-click from the caret, or shift+arrows, along one voice.", await boxOf('.score-row', 4));
  await page.keyboard.press("Escape");

  {
    const a = await page.evaluate(() => {
      const t = document.querySelector('.tile[data-index="0"] g[class~="staff"]');
      const r = t.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const b = await page.evaluate(() => {
      const staves = document.querySelector('.tile[data-index="1"]').querySelectorAll("g.staff[id]");
      const r = staves[staves.length - 1].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector("main").dataset.block !== "", null, { timeout: 5000 });
  }
  await shot("selection-block", "A block selection in green: a rectangle of measures × staves, painted by dragging.", await boxOf('.score-row', 4));
  await page.keyboard.press("Escape");

  // toast: copy something (block still cleared — reselect caret measure via ctrl+c fallback)
  await clickEvent(firstNote);
  await page.keyboard.press("Control+c");
  await page.waitForFunction(() => document.querySelector("[data-notice]").textContent.includes("copied"), null, { timeout: 5000 });
  {
    const toast = await boxOf("[data-notice-toast]", 10);
    await shot("toast", "A toast in the bottom-right corner confirming a copy; the × dismisses it early and the text can be selected.", toast);
  }

  // the copy toast must not linger into later shots
  await page.locator("[data-notice-dismiss]").click();
  await page.waitForFunction(() => document.querySelector("[data-notice]").textContent === "", null, { timeout: 5000 });

  // shortcut editor
  await page.locator("[data-shortcuts-toggle]").click();
  await page.waitForSelector("[data-shortcuts]");
  await shot("shortcut-editor", "The shortcut editor: every action grouped with its current keys, the QWERTY/AZERTY layout toggle, and rebinding by clicking a key and pressing a new one.", await boxOf("[data-shortcuts] > div", 0));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("[data-shortcuts]"), null, { timeout: 5000 });

  // page view: title, real layout, the player in the header
  await page.locator("button", { hasText: "page view" }).click();
  await page.waitForFunction(() => document.querySelector(".pages .page svg"), null, { timeout: 60000 });
  await shot("page-view", "Page view: the whole document through Verovio's page layout, with the printed title — and the player controls in the header.");

  // the player, mid-playback: highlight + progress
  await page.locator("[data-player-toggle]").click();
  await page.waitForFunction(() => document.querySelector(".pages g.playing"), null, { timeout: 60000 });
  await page.waitForFunction(() => {
    const t = document.querySelector("[data-player-time]");
    return t && !t.textContent.trim().startsWith("0:00");
  }, null, { timeout: 15000 });
  await shot("player", "The player while playing: pause and stop, the live tempo select, the clickable progress bar and the elapsed/total readout.", await boxOf("header", 6));
  {
    const sys = await boxOf('.pages .page svg', 0);
    await shot("player-highlight", "The note being sounded lights up as the score plays — audio and highlight come from the same timeline.", {
      x: sys.x,
      y: sys.y,
      width: sys.width,
      height: Math.min(sys.height, 380),
    });
  }
  await page.locator("[data-player-stop]").click();
} finally {
  await browser.close();
  await server.close();
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ scale: SCALE, shots: manifest }, null, 2) + "\n");
console.log(`\n${manifest.length} shots → public/shots/`);
