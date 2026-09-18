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
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

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

/**
 * A 16-bit mono WAV of a timemap's top voice — the recording the pitch
 * reference shots load. Sung a little human on purpose: 300 ms of silence
 * first, each note a few cents off and a few ms late, a slow vibrato, so
 * the trace reads as a take against the notes rather than a ruler line.
 */
function synthesizeTake(timemap, leadMs = 300, rate = 16000) {
  const byOnset = new Map();
  for (const e of timemap.events) {
    for (const id of e.on ?? []) {
      const n = timemap.notes[id];
      if (!n) continue;
      const cur = byOnset.get(e.tstamp);
      if (!cur || n.pitch > cur.pitch) byOnset.set(e.tstamp, { pitch: n.pitch, to: e.tstamp + n.duration });
    }
  }
  // The melody, not every onset's top pitch: where the tune rests or holds,
  // the top note is the accompaniment's, a fifth or more below — a singer
  // would not drop there, so those onsets are skipped.
  const onsets = [...byOnset.keys()].sort((a, b) => a - b);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const notes = [];
  let prev = null;
  for (let i = 0; i < onsets.length; i++) {
    const t = onsets[i];
    const n = byOnset.get(t);
    if (prev !== null && n.pitch < prev - 7) continue;
    prev = n.pitch;
    const next = onsets.slice(i + 1).find((o) => byOnset.get(o).pitch >= n.pitch - 7) ?? Infinity;
    notes.push({ from: t + 15 + rnd() * 20, to: Math.min(n.to, next) - 10, pitch: n.pitch + rnd() * 0.25 });
  }
  const totalMs = leadMs + Math.max(...notes.map((n) => n.to)) + 300;
  const samples = new Float32Array(Math.round((totalMs / 1000) * rate));
  for (const n of notes) {
    const a = Math.round(((leadMs + n.from) / 1000) * rate);
    const b = Math.round(((leadMs + n.to) / 1000) * rate);
    const ramp = Math.round(rate * 0.012);
    let phase = 0;
    for (let i = a; i < b && i < samples.length; i++) {
      const t = (i - a) / rate;
      const vibrato = 0.12 * Math.sin(2 * Math.PI * 5.5 * t); // ±12 cents at 5.5 Hz
      const hz = 440 * 2 ** ((n.pitch + vibrato - 69) / 12);
      phase += (2 * Math.PI * hz) / rate;
      const env = Math.min(1, (i - a) / ramp, (b - i) / ramp);
      samples[i] += 0.55 * env * Math.sin(phase);
    }
  }
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}

const server = await createServer({
  configFile: join(repoRoot, "apps/editor/vite.config.ts"),
  root: join(repoRoot, "apps/editor"),
  server: { port: 0 },
  logLevel: "warn",
});
await server.listen();

const systemChrome = "/usr/bin/google-chrome";
const browser = await chromium.launch({ ...(existsSync(systemChrome) ? { executablePath: systemChrome } : {}), headless: true });
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

  // Perf numbers are off by default and the header carries no dev-only
  // controls any more — the window is shot as users see it.

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
  await shot("header", "The two-row header: the battuta menu button, the tab strip (the active tab carries the unsaved-changes star), the view toggle and the on-screen keyboard toggle; below them, the score's title and tempo.", await boxOf("header", 6));
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => !document.querySelector(".tab.active").textContent.includes("*"), null, { timeout: 5000 });

  // the battuta menu: open/save, exports, tools
  await page.locator("[data-menu-toggle]").click();
  await page.waitForSelector("[data-app-menu]");
  {
    const menu = await boxOf("[data-app-menu]", 10);
    const brand = await boxOf("[data-menu-toggle]", 10);
    const x = Math.min(menu.x, brand.x);
    const y = Math.min(menu.y, brand.y);
    await shot("menu", "The battuta menu: open (any supported format), save, the exports — playback MIDI, written-score MIDI, SVG pages, Humdrum, Plaine & Easie — and the shortcut editor, performance numbers and id repair.", {
      x,
      y,
      width: Math.max(menu.x + menu.width, brand.x + brand.width) - x,
      height: Math.max(menu.y + menu.height, brand.y + brand.height) - y,
    });
  }
  await page.locator("[data-menu-backdrop]").click();
  await page.waitForFunction(() => !document.querySelector("[data-app-menu]"), null, { timeout: 5000 });

  // the on-screen keyboard: plain, then with shift latched (live relabel).
  // Since slice 4b the 🎹 has two faces — the host's, rendered from the
  // plugin's manifest before its code loads, and the plugin's own live one
  // (which dims while the panel is down) once it is active. This click is
  // what loads it, so the first selector is the one that matches here.
  await page.locator('[data-slot-command="battuta.onscreen-keyboard.toggle"], [data-vkeys-toggle]').first().click();
  await page.waitForSelector("[data-vkeys]");
  await shot("vkeys", "The on-screen keyboard: two piano octaves with the octave rail, the alt/shift latches, the digit pad, and one key per action, grouped like the shortcut editor.", await boxOf("[data-vkeys]", 4));
  await page.locator('[data-vk-mod="shift"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-vk-key="digitPad"]')].some((b) => b.textContent.includes("volta")), null, { timeout: 5000 });
  await shot("vkeys-shift", "Shift latched: the keys relabel live to what they will do — the digit pad turns into voltas, staccato reads staccatissimo, tie reads tuplet — and the remapped keys are tinted.", await boxOf("[data-vkeys]", 4));
  await page.locator('[data-vk-mod="shift"]').click();
  await page.locator("[data-vk-close]").click();
  await page.waitForFunction(() => !document.querySelector("[data-vkeys]"), null, { timeout: 5000 });

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

  // shortcut editor (lives in the battuta menu now)
  await page.locator("[data-menu-toggle]").click();
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

  // ---- back to edit view for the two plugin panels ------------------------
  await page.locator("button", { hasText: "edit view" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".tile svg").length >= 8, null, { timeout: 60000 });

  // ---- the pitch reference: a take synthesized from the score's own timemap.
  // The top voice as sines, sung a little human: a slow vibrato, each note
  // a few cents off and a few ms late, 300 ms of silence first — so the
  // trace shows what the panel is for rather than a ruler line.
  {
    const timemap = await page.evaluate(() => window.__HOST__.query.timemap());
    const wav = synthesizeTake(timemap);
    await page.locator('[data-slot-command="battuta.pitch-reference.toggle"], [data-pitch-ref-toggle]').first().click();
    await page.waitForSelector("[data-pitch-ref]");
    await page.setInputFiles("[data-pitch-ref-file]", { name: "melodie-take.wav", mimeType: "audio/wav", buffer: wav });
    await page.waitForFunction(() => document.querySelector("[data-pitch-ref]")?.getAttribute("data-pitch-ref-state") === "ready", null, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-pitch-ref-measure]").length >= 4, null, { timeout: 10000 });
    // the summary toast must not sit in the shot
    await page.locator("[data-notice-dismiss]").click().catch(() => undefined);
    await page.waitForFunction(() => document.querySelector("[data-notice]").textContent === "", null, { timeout: 5000 }).catch(() => undefined);
    await shot("pitch-reference", "The pitch reference panel: the controls — load, ▶ song and ▶ score, bar 1, the recorded tempo, the transposition, on the score — above the strip: the waveform, a tick per measure, the written notes as blue bars, the recording's pitch as the yellow trace, the dashed line where bar 1 begins and the white playhead.", await boxOf('[data-panel="pitch-reference"]', 0));
    await shot("pitch-reference-tiles", "The same recording over the measures in edit view: the trace sits on the staff nearest its pitch, fitted through that measure's noteheads, with the written notes as faint bars for their length — a note held short stops early, a sharp one runs above its head.", await boxOf(".score-row", 4));
    await page.locator("[data-pitch-ref-close]").click();
    await page.waitForFunction(() => !document.querySelector("[data-pitch-ref]"), null, { timeout: 5000 });
  }

  // ---- the folder view: the shell is required for a real folder, so the
  // browser gets a bridge-shaped fake — a folder of scores, two sub-folders
  // — through the very commands the shell answers. The list, the panel on
  // the left and the score pushed right are exactly what the desktop app
  // shows; only the folder is invented.
  {
    await page.evaluate(() => {
      const ROOT = "/Users/anna/Scores";
      const file = (dir, name) => ({ name, path: `${dir}/${name}`, kind: "file" });
      const dir = (parent, name) => ({ name, path: `${parent}/${name}`, kind: "dir" });
      const FOLDER = {
        [ROOT]: [dir(ROOT, "Bach"), dir(ROOT, "Schumann"), file(ROOT, "Melodie.mei"), file(ROOT, "Träumerei.mei"), file(ROOT, "Wilder Reiter.mei")],
        [`${ROOT}/Bach`]: [file(`${ROOT}/Bach`, "BWV 846 Prelude.mei"), file(`${ROOT}/Bach`, "BWV 1007 Prelude.mei")],
        [`${ROOT}/Schumann`]: [file(`${ROOT}/Schumann`, "Kinderszenen 1.mei"), file(`${ROOT}/Schumann`, "Kinderszenen 7.mei"), file(`${ROOT}/Schumann`, "Album für die Jugend 6.mei")],
      };
      const ws = window.__HOST__.workspace;
      ws.bridge = {
        invoke: async (cmd, args) => {
          switch (cmd) {
            case "workspace_pick_folder":
              return ROOT;
            case "workspace_open_folder":
              return true;
            case "workspace_read_dir":
              return FOLDER[args.path] ?? [];
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
    await page.locator("[data-folder-view] button", { hasText: "choose a folder" }).click();
    await page.waitForFunction(() => [...document.querySelectorAll("[data-folder-view] button")].some((b) => b.textContent.includes("Melodie")), null, { timeout: 10000 });
    await page.locator("[data-folder-view] button", { hasText: "Schumann" }).first().click();
    await page.waitForFunction(() => [...document.querySelectorAll("[data-folder-view] button")].some((b) => b.textContent.includes("Kinderszenen")), null, { timeout: 10000 });
    {
      const panel = await boxOf('[data-panels="side"]', 0);
      const list = await boxOf("[data-folder-view]", 0);
      await shot("folder-view", "The folder view on the left, the score pushed right to make room: the folder's name and the … button to pick another, sub-folders that open in place (Schumann expanded), and a row per .mei score — click one to open it.", {
        x: 0,
        y: panel.y,
        width: 640,
        height: Math.min(800 - 24 - panel.y, Math.max(list.height + 24, 300)),
      });
    }
    await page.locator("[data-folder-view] [data-folder-close], [data-folder-toggle]").first().click();
    await page.waitForFunction(() => !document.querySelector("[data-folder-view]"), null, { timeout: 5000 }).catch(() => undefined);
  }
} finally {
  await browser.close();
  await server.close();
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ scale: SCALE, shots: manifest }, null, 2) + "\n");
console.log(`\n${manifest.length} shots → public/shots/`);
