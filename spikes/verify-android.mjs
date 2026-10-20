/**
 * Device smoke for the Android tablet build (phase 10, M0): the debug APK on a
 * real device, driven over the WebView's DevTools socket (debug builds only).
 *
 *   npm run android -- build --debug --apk --target aarch64
 *   node spikes/verify-android.mjs            # installs that APK, then checks
 *   node spikes/verify-android.mjs --no-install
 *
 * Checks: the shell says it is Android/mobile before the page runs; Verovio
 * renders in the WebView; the desktop-only services stay off (folders) and
 * MIDI comes through Web MIDI; an edit made through the real UI (a tap on
 * the measure, input mode, a pitch key) reaches the document and the
 * player's timemap; and the app is still alive with no Rust panic logged.
 *
 * Leaves the device as it found it: the edit is undone (the document is the
 * one the app opened, back to its saved mark) — Android's WebView has no
 * incognito storage to isolate a run in, so the run makes no change that
 * would outlive it.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const ROOT = process.env.BATTUTA_ROOT ?? new URL("..", import.meta.url).pathname;
const SDK = process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk");
const ADB = join(SDK, "platform-tools/adb");
const PKG = "com.vibetuned.battuta";
const APK = join(ROOT, "apps/editor/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk");
const PORT = 9333;

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};
const adbAll = (...args) => execFileSync(ADB, args, { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ANDROID_SERIAL picks the device; otherwise the first physical one (an
// emulator may be running beside the tablet).
const serials = adbAll("devices").split("\n").slice(1).filter((l) => /\tdevice$/.test(l)).map((l) => l.split("\t")[0]);
const SERIAL = process.env.ANDROID_SERIAL ?? serials.find((s) => !s.startsWith("emulator-")) ?? serials[0];
if (!SERIAL) {
  console.error("no authorized Android device (adb devices)");
  process.exit(2);
}
const adb = (...args) => adbAll("-s", SERIAL, ...args);
console.log(`device ${SERIAL}`);
if (!process.argv.includes("--no-install")) {
  if (!existsSync(APK)) {
    console.error(`no debug APK at ${APK} — build it first (npm run android -- build --debug --apk --target aarch64)`);
    process.exit(2);
  }
  adb("install", "-r", APK);
}

adb("logcat", "-c");
adb("shell", "am", "force-stop", PKG);
adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`);
let pid = "";
for (let t = 0; t < 40 && !pid; t++) {
  await sleep(250);
  try {
    pid = adb("shell", "pidof", PKG);
  } catch {
    /* not up yet */
  }
}
check(`the app starts (pid ${pid || "none"})`, Boolean(pid));
if (!pid) process.exit(1);

// The WebView's DevTools socket appears once the page is created.
for (let t = 0; t < 40; t++) {
  if (adb("shell", "cat", "/proc/net/unix").includes(`webview_devtools_remote_${pid}`)) break;
  await sleep(250);
}
adb("forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);

try {
  const page = browser.contexts()[0].pages()[0];
  // every tile rendered — the first SVG alone says the worker started, not that it finished
  await page.waitForFunction(() => window.__SESSION__ && [...document.querySelectorAll(".tile")].every((t) => t.querySelector("svg")), null, { timeout: 30000 });

  const shell = await page.evaluate(() => window.__BATTUTA_SHELL__ ?? null);
  check(`the shell says what it is before the page runs (${JSON.stringify(shell)})`, shell?.platform === "android" && shell.mobile === true);
  const tiles = await page.evaluate(() => ({ tiles: document.querySelectorAll(".tile").length, svg: document.querySelectorAll(".tile svg").length }));
  check(`Verovio renders in the WebView (${tiles.svg} svg in ${tiles.tiles} tiles)`, tiles.tiles > 0 && tiles.svg >= tiles.tiles);
  check("no folder service on the tablet yet (desktop-only, M1)", await page.evaluate(() => window.__HOST__.workspace.available === false));
  const midi = await page.evaluate(() => window.__HOST__.midi.inputs.get().map((p) => p.name));
  check(`MIDI through the WebView's Web MIDI (${midi.join(", ")})`, Array.isArray(midi));

  // An edit through the real UI: tap the first measure, input mode, a pitch.
  const depth0 = await page.evaluate(() => window.__SESSION__.stack.undoDepth);
  await page.locator('.tile[data-index="0"] g[class~="mRest"] use, .tile[data-index="0"] g[class~="rest"] use, .tile[data-index="0"] g[class~="note"] use').first().click({ force: true });
  await page.waitForFunction(() => document.querySelector("main").dataset.caret, null, { timeout: 5000 });
  const wasInput = await page.evaluate(() => Boolean(document.querySelector("main").dataset.entry));
  if (!wasInput) await page.keyboard.press("i");
  await page.keyboard.press("e");
  await page.waitForFunction((d) => window.__SESSION__.stack.undoDepth === d + 1, depth0, { timeout: 5000 });
  const entered = await page.evaluate(() => {
    const id = window.__SESSION__.index.eventsAt(0, 1, 1)[0];
    const walk = (el) => (el.attrs?.["xml:id"] === id ? el : (el.children ?? []).filter((c) => typeof c !== "string").map(walk).find(Boolean));
    const n = walk(window.__SESSION__.score.measures[0]);
    return n ? { id, tag: n.tag, pitch: `${n.attrs.pname}${n.attrs.oct}` } : null;
  });
  check(`a tap, input mode and a pitch key enter a note (${JSON.stringify(entered)})`, entered?.tag === "note" && entered.pitch.startsWith("e"));
  const sounding = await page.evaluate(async (id) => (await window.__HOST__.query.timemap()).notes[id]?.pitch ?? null, entered?.id);
  check(`the player's timemap sounds it (MIDI ${sounding})`, typeof sounding === "number" && sounding % 12 === 4);

  // Leave it as found.
  await page.keyboard.press("Escape");
  while ((await page.evaluate(() => window.__SESSION__.stack.undoDepth)) > depth0) await page.keyboard.press("Control+z");
  check("the edit is undone (the document back as the app opened it)", (await page.evaluate(() => window.__SESSION__.stack.undoDepth)) === depth0);
} catch (e) {
  console.error("SCRIPT ERROR", e);
  failures++;
} finally {
  await browser.close().catch(() => undefined);
  adb("forward", "--remove", `tcp:${PORT}`);
}

let alive = "";
try {
  alive = adb("shell", "pidof", PKG);
} catch {
  /* gone */
}
check("the app is still running", alive === pid);
const panics = adb("logcat", "-d", "-s", "RustPanic:E").split("\n").filter((l) => l.includes("RustPanic"));
check(`no Rust panic logged (${panics.length})`, panics.length === 0);

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
