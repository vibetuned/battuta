/**
 * Shared helpers for the browser e2e scripts (verify-*.mjs). They exist
 * because 0.0.2 removed UI the scripts used to drive: the demo-file
 * <select> (files now open through the hidden file input or the menu),
 * the header measure buttons (numpad +/−/* remain), the header save
 * button (in the battuta menu) and the always-on perf HUD (off by
 * default, toggled in the menu).
 */

/** Open a fixture through the hidden file input, exactly as "open file…" does. Returns once the new tab renders `minTiles` tiles. */
export async function openFixture(page, path, minTiles = 1) {
  await page.setInputFiles('input[type="file"]', path);
  await page.waitForFunction((n) => document.querySelectorAll(".tile .ms").length >= n, minTiles, { timeout: 60000 });
}

/** Click an entry of the battuta menu by its visible text. */
export async function menuClick(page, text) {
  await page.locator("[data-menu-toggle]").click();
  await page.waitForFunction(() => document.querySelector("[data-app-menu]"), null, { timeout: 5000 });
  await page.locator("[data-app-menu] button", { hasText: text }).first().click();
}

/** The ⏱ performance numbers (measure counts, fresh renders, latency) are off by default; scripts that read [data-status] turn them on. */
export async function setPerf(page, on) {
  const isOn = await page.evaluate(() => document.querySelector("[data-status]").textContent !== "");
  if (isOn === on) return;
  await page.locator("[data-menu-toggle]").click();
  await page.locator("[data-perf-toggle]").click();
  await page.waitForFunction((want) => (document.querySelector("[data-status]").textContent !== "") === want, on, { timeout: 5000 });
}

/** Switch the keyboard layout through the 🌣 editor (persists in settings) and close it again. */
export async function setLayout(page, layout) {
  await page.locator("[data-menu-toggle]").click();
  await page.locator("[data-shortcuts-toggle]").click();
  await page.waitForFunction(() => document.querySelector("[data-shortcuts]"), null, { timeout: 5000 });
  await page.locator(`[data-layout="${layout}"]`).click();
  await page.waitForFunction((l) => document.querySelector(`[data-layout="${l}"]`)?.style.background.includes("45, 125, 70"), layout, { timeout: 5000 }).catch(() => undefined);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("[data-shortcuts]"), null, { timeout: 5000 });
}

/**
 * Click the first note of a tile and wait until the caret lands in that
 * measure. A force-click right after an edit can hit a <use> that the
 * tile swap just detached ("Element is not visible"), so retry with fresh
 * coordinates, like the scripts already do for clicks by id.
 */
export async function clickFirstNote(page, tileIndex, tries = 6) {
  for (let t = 0; t < tries; t++) {
    const ok = await page
      .locator(`.tile[data-index="${tileIndex}"] g[class~="note"] use`)
      .first()
      .click({ force: true, timeout: 3000 })
      .then(() =>
        page.waitForFunction(
          (i) => {
            const id = document.querySelector("main").dataset.caret;
            return id && window.__SESSION__.index.byId.get(id)?.measureIndex === i;
          },
          tileIndex,
          { timeout: 1500 },
        ),
      )
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  throw new Error(`caret never landed in measure ${tileIndex + 1}`);
}
