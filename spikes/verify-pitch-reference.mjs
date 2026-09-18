/**
 * The pitch reference plugin end to end, in the browser: the 🎙 before
 * any code loads, the bottom panel, a recording SYNTHESIZED from the
 * score's own timemap (the top voice as sines, 300 ms of silence first)
 * loaded through the panel's file input, and what comes out: the trace,
 * the offset found at the silence's end, the deviation near zero, the
 * per-measure overlays on the tiles with the trace sitting on the written
 * notehead, the checkbox, an offset typed in, close and reopen with the
 * trace kept, and nothing written to the document.
 *
 * Run: BATTUTA_ROOT=$PWD CHROME=bundled node spikes/verify-pitch-reference.mjs
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

/** A 16-bit mono WAV of the timemap's top voice: a sine per note with 10 ms ramps, `leadMs` of silence first. */
function synthesize(timemap, leadMs = 300, rate = 16000) {
  const byOnset = new Map();
  for (const e of timemap.events) {
    for (const id of e.on ?? []) {
      const n = timemap.notes[id];
      if (!n) continue;
      const cur = byOnset.get(e.tstamp);
      if (!cur || n.pitch > cur.pitch) byOnset.set(e.tstamp, { pitch: n.pitch, to: e.tstamp + n.duration });
    }
  }
  const onsets = [...byOnset.keys()].sort((a, b) => a - b);
  const notes = onsets.map((t, i) => {
    const n = byOnset.get(t);
    return { from: t, to: Math.min(n.to, onsets[i + 1] ?? Infinity), pitch: n.pitch };
  });
  const totalMs = leadMs + Math.max(...notes.map((n) => n.to)) + 300;
  const samples = new Float32Array(Math.round((totalMs / 1000) * rate));
  for (const n of notes) {
    const hz = 440 * 2 ** ((n.pitch - 69) / 12);
    const a = Math.round(((leadMs + n.from) / 1000) * rate);
    const b = Math.round(((leadMs + n.to) / 1000) * rate);
    const ramp = Math.round(rate * 0.01);
    for (let i = a; i < b && i < samples.length; i++) {
      const env = Math.min(1, (i - a) / ramp, (b - i) / ramp);
      samples[i] += 0.6 * env * Math.sin((2 * Math.PI * hz * (i - a)) / rate);
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
  return { buffer: buf, notes, totalMs };
}

const server = await createServer({
  configFile: `${ROOT}/apps/editor/vite.config.ts`,
  root: `${ROOT}/apps/editor`,
  server: { port: 0 },
  logLevel: "warn",
});
await server.listen();
const browser = await chromium.launch({ ...(CHROME === "bundled" ? {} : { executablePath: CHROME }), headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(server.resolvedUrls.local[0] + "?pool=2");
try {
  await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 10, null, { timeout: 60000 });
  const toggle = () => page.locator('[data-slot-command="battuta.pitch-reference.toggle"], [data-pitch-ref-toggle]').first();
  const attr = (name) => page.evaluate((n) => document.querySelector("[data-pitch-ref]")?.getAttribute(n) ?? null, name);

  // --- 1. the entry point, before any of the plugin's code exists --------
  check("the 🎙 is in the header before the plugin loads", await page.evaluate(() => Boolean(document.querySelector('[data-slot-command="battuta.pitch-reference.toggle"]'))));
  check("…drawn de-emphasised", await page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-slot-command="battuta.pitch-reference.toggle"]')).opacity) < 0.9));
  check("no overlay layer is mounted yet", await page.evaluate(() => document.querySelectorAll("[data-overlays]").length === 0));

  // --- 2. the panel ----------------------------------------------------------
  await toggle().click();
  await page.waitForFunction(() => document.querySelector('[data-panels="bottom"] [data-panel="pitch-reference"] [data-pitch-ref]'), null, { timeout: 10000 });
  check("the click opens the panel in the BOTTOM area", true);
  check("it starts empty", (await attr("data-pitch-ref-state")) === "empty");
  check("the 🎙 lights while the panel is up", await page.evaluate(() => Number(getComputedStyle(document.querySelector("[data-pitch-ref-toggle]")).opacity) > 0.9));
  // the panel must not cover the score: the host pads the score by the area's height, so the last row scrolls clear
  const pad = await page.evaluate(() => ({
    published: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--battuta-bottom-h")) || 0,
    area: document.querySelector('[data-panels="bottom"]').getBoundingClientRect().height,
    main: parseFloat(getComputedStyle(document.querySelector("main")).paddingBottom) || 0,
  }));
  check(`the score is padded by the panel's height (${pad.published} px)`, pad.published > 60 && Math.abs(pad.published - pad.area) < 1 && Math.abs(pad.main - pad.published) < 1);
  const clear = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const tiles = document.querySelectorAll(".tile");
    const last = tiles[tiles.length - 1].getBoundingClientRect();
    const panel = document.querySelector('[data-panels="bottom"]').getBoundingClientRect();
    window.scrollTo(0, 0);
    return { lastBottom: Math.round(last.bottom), panelTop: Math.round(panel.top) };
  });
  check(`the last measure scrolls clear of the panel (${clear.lastBottom} ≤ ${clear.panelTop})`, clear.lastBottom <= clear.panelTop + 1);

  // --- 3. a recording synthesized from the score ------------------------------
  const timemap = await page.evaluate(() => window.__HOST__.query.timemap());
  const { buffer, notes, totalMs } = synthesize(timemap, 300);
  await page.setInputFiles("[data-pitch-ref-file]", { name: "take.wav", mimeType: "audio/wav", buffer });
  await page.waitForFunction(() => ["ready", "error"].includes(document.querySelector("[data-pitch-ref]")?.getAttribute("data-pitch-ref-state")), null, { timeout: 60000 });
  const state = await attr("data-pitch-ref-state");
  check(`the recording decodes and is analysed (${state}${state === "error" ? ": " + (await page.evaluate(() => document.querySelector("[data-pitch-ref-status]")?.textContent)) : ""})`, state === "ready");
  const frames = Number(await attr("data-pitch-ref-frames"));
  const voiced = Number(await attr("data-pitch-ref-voiced"));
  check(`the trace has frames (${frames}, ${voiced} voiced, ${(totalMs / 1000).toFixed(1)} s of audio, ${notes.length} notes)`, frames > 100 && voiced > frames * 0.5);
  const offset = Number(await attr("data-pitch-ref-offset"));
  check(`bar 1 is found at the end of the lead-in silence (${offset} ms, expected ≈300)`, Math.abs(offset - 300) < 80);
  const dev = Number(await attr("data-pitch-ref-deviation"));
  check(`the trace sits on the written pitch (median ${Math.round(dev * 100)} cents)`, dev >= 0 && dev < 0.3);
  check("the strip draws the trace", await page.evaluate(() => (document.querySelector("[data-pitch-ref-trace]")?.getAttribute("d") ?? "").length > 100));
  const notice = await page.evaluate(() => document.querySelector("[data-notice]")?.textContent ?? "");
  check(`the summary arrives as a notice, not as panel text (${notice.trim().slice(0, 60)}…)`, /take\.wav: .* voiced of .* frames/.test(notice) && (await page.evaluate(() => !/voiced of/.test(document.querySelector("[data-pitch-ref-status]")?.textContent ?? ""))));

  // --- 4. the overlays on the tiles -------------------------------------------
  await page.waitForFunction(() => document.querySelectorAll("[data-pitch-ref-measure]").length >= 5, null, { timeout: 10000 }).catch(() => undefined);
  const layers = await page.evaluate(() => [...document.querySelectorAll("[data-pitch-ref-measure]")].map((el) => ({ frames: Number(el.dataset.frames), fit: el.dataset.fit, staff: el.dataset.staff, firstY: Number(el.dataset.firstY), tile: Number(el.closest(".tile")?.dataset.index) })));
  check(`every measure tile carries the trace layer (${layers.length})`, layers.length >= 10);
  const m1 = layers.find((l) => l.tile === 0);
  check(`m1's layer has frames, on the top staff, fitted through the heads (${JSON.stringify(m1)})`, m1 && m1.frames > 5 && m1.staff === "1" && m1.fit === "heads");
  // the first voiced point of m1 sits on the first written note's head
  const headDy = await page.evaluate((firstY) => {
    const tile = document.querySelector('.tile[data-index="0"]');
    const layer = tile.querySelector("[data-overlays]");
    const head = tile.querySelector('g.note[id="cc-m1n1"] g.notehead') ?? tile.querySelector('g.note[id="cc-m1n1"]');
    if (!layer || !head) return null;
    const hr = head.getBoundingClientRect();
    const lr = layer.getBoundingClientRect();
    return firstY - (hr.top + hr.height / 2 - lr.top);
  }, m1?.firstY ?? 0);
  check(`…and the trace starts on the first note's head (${headDy === null ? "no head" : headDy.toFixed(1) + " px off"})`, headDy !== null && Math.abs(headDy) < 4);

  // --- 5. the checkbox, an offset typed in -------------------------------------
  await page.locator("[data-pitch-ref-overlays]").uncheck();
  await page.waitForFunction(() => document.querySelectorAll("[data-pitch-ref-measure]").length === 0, null, { timeout: 5000 }).catch(() => undefined);
  check("unchecking 'on the score' takes the traces off the tiles", await page.evaluate(() => document.querySelectorAll("[data-pitch-ref-measure]").length === 0));
  await page.locator("[data-pitch-ref-overlays]").check();
  await page.waitForFunction(() => document.querySelectorAll("[data-pitch-ref-measure]").length >= 10, null, { timeout: 5000 }).catch(() => undefined);
  check("…and checking it brings them back", await page.evaluate(() => document.querySelectorAll("[data-pitch-ref-measure]").length >= 10));
  await page.locator("[data-pitch-ref-offset-input]").fill("900");
  await page.waitForFunction(() => document.querySelector("[data-pitch-ref]")?.getAttribute("data-pitch-ref-offset") === "900", null, { timeout: 5000 }).catch(() => undefined);
  const devMoved = Number(await attr("data-pitch-ref-deviation"));
  check(`a wrong offset moves the trace off the notes (median ${Math.round(devMoved * 100)} cents)`, (await attr("data-pitch-ref-offset")) === "900" && devMoved > dev);
  await page.locator("[data-pitch-ref-offset-input]").fill(String(offset));
  await page.waitForFunction((o) => document.querySelector("[data-pitch-ref]")?.getAttribute("data-pitch-ref-offset") === String(o), offset, { timeout: 5000 }).catch(() => undefined);
  check("the score's tempo stands in for the recorded one", (await page.evaluate(() => document.querySelector("[data-pitch-ref-tempo-input]").placeholder)) === "120");
  await page.locator("[data-pitch-ref-tempo-input]").fill("60");
  await page.waitForFunction(() => document.querySelector("[data-pitch-ref]")?.getAttribute("data-pitch-ref-rate") === "0.5000", null, { timeout: 5000 }).catch(() => undefined);
  check("a recorded tempo of 60 halves the rate", (await attr("data-pitch-ref-rate")) === "0.5000");
  await page.locator("[data-pitch-ref-tempo-input]").fill("");
  await page.waitForFunction(() => document.querySelector("[data-pitch-ref]")?.getAttribute("data-pitch-ref-rate") === "1.0000", null, { timeout: 5000 }).catch(() => undefined);
  await page.locator("[data-pitch-ref-transpose-input]").fill("-12");
  await page.waitForFunction(() => document.querySelector("[data-pitch-ref]")?.getAttribute("data-pitch-ref-transpose") === "-12", null, { timeout: 5000 }).catch(() => undefined);
  const devDown = Number(await attr("data-pitch-ref-deviation"));
  check(`−12 st transposes the trace an octave down (median ${Math.round(devDown * 100)} cents off)`, (await attr("data-pitch-ref-transpose")) === "-12" && devDown > 6);
  await page.locator("[data-pitch-ref-transpose-input]").fill("0");
  await page.waitForFunction(() => document.querySelector("[data-pitch-ref]")?.getAttribute("data-pitch-ref-transpose") === "0", null, { timeout: 5000 }).catch(() => undefined);
  check("…and 0 puts it back on the notes", Number(await attr("data-pitch-ref-deviation")) < 0.3);

  // --- 5b. play, pause, drag the playhead, follow the caret -------------------
  const playheadBefore = Number(await attr("data-pitch-ref-playhead"));
  check(`the playhead starts where bar 1 begins (${playheadBefore} ms)`, playheadBefore === offset);
  await page.locator("[data-pitch-ref-play]").click();
  await page.waitForFunction(() => document.querySelector("[data-pitch-ref]")?.getAttribute("data-pitch-ref-playing") === "true", null, { timeout: 5000 }).catch(() => undefined);
  await page.waitForFunction((p) => Number(document.querySelector("[data-pitch-ref]")?.getAttribute("data-pitch-ref-playhead")) > p + 200, playheadBefore, { timeout: 5000 }).catch(() => undefined);
  const playheadPlaying = Number(await attr("data-pitch-ref-playhead"));
  check(`▶ plays the recording and the playhead moves (${playheadBefore} → ${playheadPlaying} ms)`, (await attr("data-pitch-ref-playing")) === "true" && playheadPlaying > playheadBefore + 200);
  await page.locator("[data-pitch-ref-play]").click();
  await page.waitForFunction(() => document.querySelector("[data-pitch-ref]")?.getAttribute("data-pitch-ref-playing") === "false", null, { timeout: 5000 }).catch(() => undefined);
  const paused = Number(await attr("data-pitch-ref-playhead"));
  await page.waitForTimeout(300);
  check(`⏸ pauses and the playhead stays (${paused} ms)`, (await attr("data-pitch-ref-playing")) === "false" && Number(await attr("data-pitch-ref-playhead")) === paused);
  await page.locator("[data-pitch-ref-play-score]").click();
  await page.waitForFunction(() => document.querySelector("[data-pitch-ref]")?.getAttribute("data-pitch-ref-playing-score") === "true" || /MIDI|written notes/.test(document.querySelector("[data-notice]")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => undefined);
  const scoreState = { playing: (await attr("data-pitch-ref-playing-score")) === "true", notice: await page.evaluate(() => document.querySelector("[data-notice]")?.textContent?.trim() ?? "") };
  check(`▶ score plays the written notes through MIDI, or says there is no output (${scoreState.playing ? "playing" : scoreState.notice.slice(0, 60)})`, scoreState.playing || /no MIDI outputs found/.test(scoreState.notice));
  if (scoreState.playing) await page.locator("[data-pitch-ref-play-score]").click();
  const strip = await page.locator("[data-pitch-ref-strip]").boundingBox();
  await page.mouse.move(strip.x + strip.width * 0.2, strip.y + strip.height / 2);
  await page.mouse.down();
  await page.mouse.move(strip.x + strip.width * 0.6, strip.y + strip.height / 2, { steps: 5 });
  await page.mouse.up();
  const dragged = Number(await attr("data-pitch-ref-playhead"));
  check(`dragging on the strip moves the playhead (${dragged} ms ≈ 60 % of ${(totalMs).toFixed(0)})`, Math.abs(dragged - totalMs * 0.6) < totalMs * 0.03);
  await page.locator('.tile[data-index="1"] g[class~="note"] use').first().click({ force: true });
  await page.waitForFunction(() => (document.querySelector("main").dataset.caret ?? "") !== "", null, { timeout: 5000 }).catch(() => undefined);
  const caretId = await page.evaluate(() => document.querySelector("main").dataset.caret);
  const onset = timemap.events.find((e) => (e.on ?? []).includes(caretId))?.tstamp;
  const followed = Number(await attr("data-pitch-ref-playhead"));
  check(`clicking a note moves the playhead to that note's moment in the recording (${caretId} at ${onset} ms → ${followed} ms)`, onset !== undefined && Math.abs(followed - (offset + onset)) <= 1);

  // --- 6. close, reopen: the trace is kept ------------------------------------
  await page.locator("[data-pitch-ref-close]").click();
  await page.waitForFunction(() => !document.querySelector("[data-pitch-ref]"), null, { timeout: 5000 });
  check("× closes the panel and takes the tile traces with it", await page.evaluate(() => document.querySelectorAll("[data-pitch-ref-measure]").length === 0 && document.querySelectorAll("[data-overlays]").length === 0));
  check("…and the 🎙 dims", await page.evaluate(() => Number(getComputedStyle(document.querySelector("[data-pitch-ref-toggle]")).opacity) < 0.9));
  check("…and the score's bottom padding goes back to nothing", await page.evaluate(() => (parseFloat(getComputedStyle(document.querySelector("main")).paddingBottom) || 0) === 0));
  await toggle().click();
  await page.waitForFunction(() => document.querySelector("[data-pitch-ref]"), null, { timeout: 5000 });
  check("reopening keeps the analysed recording", (await attr("data-pitch-ref-state")) === "ready" && Number(await attr("data-pitch-ref-frames")) === frames);

  // --- 7. nothing else ---------------------------------------------------------
  check("it contributes no keybinding", await page.evaluate(() => !window.__HOST__.keymapView.get().some((e) => e.plugin === "battuta.pitch-reference")));
  check("…and nothing was written to the document", await page.evaluate(() => window.__SESSION__.stack.undoDepth === 0));
  check("a click through the trace still places the caret", await (async () => {
    await page.locator('.tile[data-index="1"] g[class~="note"] use').first().click({ force: true });
    await page.waitForFunction(() => (document.querySelector("main").dataset.caret ?? "") !== "", null, { timeout: 5000 }).catch(() => undefined);
    return page.evaluate(() => (document.querySelector("main").dataset.caret ?? "") !== "");
  })());
} catch (e) {
  console.error("SCRIPT ERROR", e);
  failures++;
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
