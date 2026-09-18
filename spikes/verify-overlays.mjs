/**
 * The overlays point (slice 10a) end to end — rehearsed the way the
 * convention demands: from a plugin that holds only `ctx`. The script
 * registers a rehearsal plugin at runtime and activates it; its
 * `activate(ctx)` adds one overlay whose render prints what it was handed,
 * so the checks read the props off the page:
 *
 *  1. nothing is mounted while no overlay is registered
 *  2. every rendered tile gets the layer; a tile with notes has boxes,
 *     every tile has its staves with five lines and the clef in force
 *  3. the measure id the layer names is the document's own
 *  4. every box lies inside the tile
 *  5. the layer takes no pointer events: a click through it still places
 *     the caret
 *  6. a zoom re-measures: the boxes grow with the tile
 *  7. disposing removes every layer
 *
 * Run: BATTUTA_ROOT=$PWD CHROME=bundled node spikes/verify-overlays.mjs
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
  await page.waitForFunction(() => document.querySelectorAll(".tile .ms").length >= 10, null, { timeout: 60000 });

  // --- 1. nothing mounted while nothing is registered ---------------------
  check("no layer is mounted while no overlay is registered", await page.evaluate(() => document.querySelectorAll("[data-overlays]").length === 0));

  // --- the rehearsal plugin: holds only ctx ---------------------------------
  const activated = await page.evaluate(async () => {
    const host = window.__HOST__;
    const entry = {
      manifest: { id: "test.overlay-rehearsal", name: "Overlay rehearsal", version: "0.0.1", engines: { battuta: `^${host.apiVersion}` }, activationEvents: ["onView:tiles"], contributes: {} },
      load: async () => ({
        default: {
          activate(ctx) {
            const seen = [];
            window.__REHEARSAL__ = {
              seen,
              disposable: ctx.overlays.add({
                id: "trace",
                render: (tile) => {
                  const boxes = Object.values(tile.boxes);
                  const inside = boxes.every((b) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= tile.width + 0.5 && b.y + b.height <= tile.height + 0.5);
                  const s = JSON.stringify({ m: tile.measureIndex, id: tile.measureId, w: tile.width, h: tile.height, boxes: boxes.length, inside, staves: tile.staves.map((st) => ({ n: st.n, lines: st.lines.length, clef: st.context.clef.shape, ascending: st.lines.every((y, i, a) => i === 0 || y > a[i - 1]) })) });
                  seen.push(s);
                  return s;
                },
              }),
            };
          },
        },
      }),
    };
    host.registry.register(entry);
    return host.registry.activate("test.overlay-rehearsal");
  });
  check("the rehearsal plugin activated through the registry", activated === true);

  // --- 2. every tile gets the layer, with boxes and staves ------------------
  await page.waitForFunction(() => document.querySelectorAll('[data-overlay="trace"]').length >= 10 && [...document.querySelectorAll('[data-overlay="trace"]')].every((el) => el.textContent.length > 0), null, { timeout: 10000 });
  const read = () => page.evaluate(() => [...document.querySelectorAll('[data-overlay="trace"]')].map((el) => JSON.parse(el.textContent)).sort((a, b) => a.m - b.m));
  let tiles = await read();
  check(`every rendered tile carries the layer (${tiles.length} tiles)`, tiles.length >= 10 && tiles.every((t, i) => t.m === i));
  check("the layer's plugin is named on it", await page.evaluate(() => [...document.querySelectorAll('[data-overlay="trace"]')].every((el) => el.dataset.plugin === "test.overlay-rehearsal")));
  check(`m1 has boxes for its notes (${tiles[0].boxes})`, tiles[0].boxes > 0);
  check("every tile has its staves, five lines each, ascending, with the clef in force", tiles.every((t) => t.staves.length >= 1 && t.staves.every((s) => s.lines === 5 && s.ascending && /^[GFC]$/.test(s.clef))));
  check("the layer covers the tile", tiles.every((t) => t.w > 50 && t.h > 50));

  // --- 3. the measure id is the document's ----------------------------------
  const ids = await page.evaluate(() => window.__SESSION__.score.measures.map((m) => m.attrs["xml:id"] ?? null));
  check("the measure id the layer names is the document's own", tiles.every((t) => t.id !== null && t.id === ids[t.m]));

  // --- 4. every box lies inside the tile ------------------------------------
  check("every box lies inside its tile", tiles.every((t) => t.inside));

  // --- 5. no pointer events: a click through the layer places the caret -----
  await page.locator('.tile[data-index="0"] g[class~="note"] use').first().click({ force: true });
  await page.waitForFunction(() => (document.querySelector("main").dataset.caret ?? "") !== "", null, { timeout: 5000 }).catch(() => undefined);
  check("a click through the layer still places the caret", await page.evaluate(() => (document.querySelector("main").dataset.caret ?? "") !== ""));

  // --- 6. a zoom re-measures ------------------------------------------------
  const before = tiles[0].w;
  await page.locator("[data-zoom-toggle]").click();
  await page.locator("[data-zoom-in]").click();
  await page.waitForFunction((w) => {
    const el = [...document.querySelectorAll('[data-overlay="trace"]')].find((e) => JSON.parse(e.textContent).m === 0);
    return el && JSON.parse(el.textContent).w > w * 1.1;
  }, before, { timeout: 10000 }).catch(() => undefined);
  tiles = await read();
  check(`a zoom re-measures the layer (m1 width ${before} → ${tiles[0]?.w})`, tiles[0]?.w > before * 1.1 && tiles[0].inside);

  // --- 7. dispose removes every layer ---------------------------------------
  await page.evaluate(() => window.__REHEARSAL__.disposable.dispose());
  await page.waitForFunction(() => document.querySelectorAll("[data-overlays]").length === 0, null, { timeout: 5000 }).catch(() => undefined);
  check("disposing removes every layer", await page.evaluate(() => document.querySelectorAll("[data-overlays]").length === 0 && document.querySelectorAll("[data-overlay]").length === 0));
  check("it contributes no keybinding", await page.evaluate(() => !window.__HOST__.keymapView.get().some((e) => e.plugin === "test.overlay-rehearsal")));
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
