/**
 * Folder view end-to-end check — the BROWSER half.
 *
 * The folder view needs a folder the user granted, which is a shell
 * capability: a browser tab has none. So what a browser script can prove
 * is exactly the half that must work anyway, and it is the half a new
 * feature is most likely to get wrong — the entry point, the panel area,
 * and telling the user the truth instead of failing:
 *
 *  1. the 📁 is in the header BEFORE the plugin's code loads, drawn
 *     de-emphasised (the host renders it from the manifest)
 *  2. clicking it loads the plugin and opens a panel in the SIDE area
 *  3. the panel says the desktop app is required, and offers no folder
 *     controls it could not honour
 *  4. the 📁 lights while the panel is up and dims when it is down
 *  5. a second click closes it; a third reopens it
 *  6. nothing of it is in the keymap — it is a slot item, not a key
 *
 * The other half — picking a folder, listing it, opening a score from it,
 * and the live external-change guard — is `spikes/verify-tauri.sh`'s
 * probe5, which drives this same UI in the shell.
 *
 * Run: BATTUTA_ROOT=$PWD CHROME=bundled node spikes/verify-folder-view.mjs
 */
import { createServer } from "vite";
import { chromium } from "playwright";

const ROOT = process.env.BATTUTA_ROOT ?? "/home/flux/projects/battuta";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";

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
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(server.resolvedUrls.local[0] + "?pool=2");
try {
  await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 3, null, { timeout: 60000 });

  const toggle = () => page.locator('[data-slot-command="battuta.folder-view.toggle"], [data-folder-toggle]').first();
  const panelUp = () => page.evaluate(() => Boolean(document.querySelector("[data-folder-view]")));
  const dimmed = () => page.evaluate(() => {
    const b = document.querySelector('[data-slot-command="battuta.folder-view.toggle"], [data-folder-toggle]');
    return b ? Number(getComputedStyle(b).opacity) < 0.9 : null;
  });

  // --- 1. the entry point, before any of the plugin's code exists --------
  check("the 📁 is in the header before the plugin loads", await page.evaluate(() => Boolean(document.querySelector('[data-slot-command="battuta.folder-view.toggle"]'))));
  check("…drawn de-emphasised, because the panel it opens is not showing", (await dimmed()) === true);
  check("…and no panel is mounted yet", (await panelUp()) === false);

  // --- 2, 3. the click loads the plugin and opens the side panel ---------
  await toggle().click();
  await page.waitForFunction(() => document.querySelector("[data-folder-view]"), null, { timeout: 20000 });
  check("clicking it loads the plugin and opens the panel", await panelUp());
  check("…in the SIDE panel area, not the bottom one", await page.evaluate(() => Boolean(document.querySelector('[data-panels="side"] [data-folder-view]'))));
  check("…and the host labelled the section from the panel spec", await page.evaluate(() => document.querySelector('[data-panel="folder-view"]')?.getAttribute("aria-label") === "folder view"));

  const note = await page.evaluate(() => document.querySelector("[data-folder-unavailable]")?.textContent ?? "");
  check(`the panel says the desktop app is required (${note.trim().slice(0, 48)}…)`, /desktop app/i.test(note));
  check("…and offers no folder controls a browser could not honour", await page.evaluate(() => !document.querySelector("[data-folder-pick]") && !document.querySelector("[data-folder-list]")));

  // --- 4. the 📁 follows the panel's state ------------------------------
  check("the 📁 lights while the panel is up", (await dimmed()) === false);

  // --- 5. toggling ------------------------------------------------------
  await toggle().click();
  await page.waitForFunction(() => !document.querySelector("[data-folder-view]"), null, { timeout: 5000 });
  check("a second click closes the panel", (await panelUp()) === false);
  check("…and dims the 📁 again", (await dimmed()) === true);
  await toggle().click();
  await page.waitForFunction(() => document.querySelector("[data-folder-view]"), null, { timeout: 5000 });
  check("a third click reopens it", await panelUp());

  // the panel's own × is the same gesture from inside
  await page.locator("[data-folder-close]").click();
  await page.waitForFunction(() => !document.querySelector("[data-folder-view]"), null, { timeout: 5000 });
  check("the panel's × closes it too", (await panelUp()) === false);

  // --- 6. no key was added ----------------------------------------------
  check("it contributes no keybinding", await page.evaluate(() => !window.__HOST__.keymapView.get().some((e) => e.plugin === "battuta.folder-view")));
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
