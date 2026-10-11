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
 *  7. renaming in place against a fake shell bridge: the ✎ on hover, F2,
 *     the field without the extension, Enter, Escape, blur, a refusal in
 *     a notice, and the editor taking none of the keys typed in the field
 *  8. + score and + folder against the same fake: the target marked (the
 *     header's name for the root, else the folder's row — a bar and a
 *     tint, never the active score's highlight), the field in the target
 *     folder (the root, a clicked folder, a folder just made), Enter,
 *     Escape, a refusal — and the blank score written, opened for real in
 *     the editor as four measures
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

  // --- 7. renaming in place, against a fake shell -----------------------
  // A browser cannot be given a folder, so the workspace service gets a
  // bridge-shaped fake answering the shell's own commands (a folder of
  // scores in memory, and a workspace_rename that moves the entry or
  // refuses an existing name). The field, the ✎, F2, Enter, Escape and
  // blur are driven with a real pointer and keyboard; the shell's half —
  // the file on disk, the open tab following — is verify-tauri.sh's probe6.
  await page.evaluate(() => {
    const ROOT = "/scores";
    const file = (dir, name) => ({ name, path: `${dir}/${name}`, kind: "file" });
    const FOLDER = { [ROOT]: [{ name: "Bach", path: `${ROOT}/Bach`, kind: "dir" }, file(ROOT, "Melodie.mei"), file(ROOT, "Träumerei.mei")], [`${ROOT}/Bach`]: [file(`${ROOT}/Bach`, "BWV 846.mei")] };
    window.__RENAMES__ = [];
    window.__CREATES__ = [];
    const ws = window.__HOST__.workspace;
    ws.bridge = {
      invoke: async (cmd, args) => {
        if (cmd === "workspace_pick_folder") return ROOT;
        if (cmd === "workspace_open_folder") return true;
        if (cmd === "workspace_read_dir") return FOLDER[args.path] ?? [];
        if (cmd === "workspace_watch") return 1;
        if (cmd === "workspace_create_folder" || cmd === "workspace_create_file") {
          window.__CREATES__.push({ cmd, ...args });
          const at = FOLDER[args.path];
          if (at.some((e) => e.name === args.name)) throw new Error(`"${args.name}" already exists in this folder`);
          const kind = cmd === "workspace_create_folder" ? "dir" : "file";
          const path = `${args.path}/${args.name}`;
          FOLDER[args.path] = [...at, { name: args.name, path, kind }].sort((a, b) => Number(a.kind !== "dir") - Number(b.kind !== "dir") || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
          if (kind === "dir") FOLDER[path] = [];
          return path;
        }
        if (cmd === "workspace_rename") {
          window.__RENAMES__.push(args);
          const parent = args.path.slice(0, args.path.lastIndexOf("/"));
          if (FOLDER[parent].some((e) => e.name === args.newName)) throw new Error(`"${args.newName}" already exists in this folder`);
          const to = `${parent}/${args.newName}`;
          FOLDER[parent] = FOLDER[parent].map((e) => (e.path === args.path ? { ...e, name: args.newName, path: to } : e));
          return to;
        }
        return null;
      },
      listen: async () => () => undefined,
    };
    ws.available = true;
  });
  await toggle().click();
  await page.waitForSelector("[data-folder-view] [data-folder-pick]", { timeout: 5000 });
  await page.locator("[data-folder-view] [data-folder-pick]").first().click();
  await page.waitForSelector('[data-folder-entry="Melodie.mei"]', { timeout: 5000 });
  const renames = () => page.evaluate(() => window.__RENAMES__);
  const rowNames = () => page.evaluate(() => [...document.querySelectorAll("[data-folder-entry]")].map((b) => b.dataset.folderEntry));

  check("no ✎ until the pointer is over a row", await page.evaluate(() => !document.querySelector("[data-folder-rename]")));
  await page.locator('[data-folder-entry="Melodie.mei"]').hover();
  await page.waitForSelector('[data-folder-rename="Melodie.mei"]', { timeout: 3000 }).catch(() => undefined);
  check("hovering a row shows its ✎", await page.evaluate(() => Boolean(document.querySelector('[data-folder-rename="Melodie.mei"]'))));
  await page.locator('[data-folder-rename="Melodie.mei"]').click();
  await page.waitForSelector("[data-folder-rename-input]", { timeout: 3000 });
  const field = await page.evaluate(() => {
    const i = document.querySelector("[data-folder-rename-input]");
    return { value: i.value, focused: document.activeElement === i, selected: i.selectionStart === 0 && i.selectionEnd === i.value.length };
  });
  check(`✎ opens a field with the name WITHOUT its extension, focused and selected (${JSON.stringify(field)})`, field.value === "Melodie" && field.focused && field.selected);
  const indicator = await page.evaluate(() => document.querySelector("[data-input-indicator]")?.textContent);
  await page.keyboard.type("Melodie in F");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-folder-entry="Melodie in F.mei"]', { timeout: 3000 }).catch(() => undefined);
  check(`Enter renames with the extension put back (${JSON.stringify((await renames()).at(-1))})`, JSON.stringify((await renames()).at(-1)) === JSON.stringify({ path: "/scores/Melodie.mei", newName: "Melodie in F.mei" }));
  check("…and the list shows the new name at once", (await rowNames()).includes("Melodie in F.mei") && !(await rowNames()).includes("Melodie.mei"));
  check("…while the editor took none of the keys typed in the field (no input mode from the i, no edit)", (await page.evaluate(() => document.querySelector("[data-input-indicator]")?.textContent)) === indicator && (await page.evaluate(() => window.__SESSION__.stack.undoDepth)) === 0);

  await page.locator('[data-folder-entry="Bach"]').focus();
  await page.keyboard.press("F2");
  await page.waitForSelector("[data-folder-rename-input]", { timeout: 3000 }).catch(() => undefined);
  check("F2 on a focused row opens its field (a folder: the whole name)", (await page.evaluate(() => document.querySelector("[data-folder-rename-input]")?.value)) === "Bach");
  const before = (await renames()).length;
  await page.keyboard.type("Johann");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("[data-folder-rename-input]"), null, { timeout: 3000 }).catch(() => undefined);
  check("Escape cancels: the field closes and nothing is renamed", (await renames()).length === before && (await rowNames()).includes("Bach"));

  await page.locator('[data-folder-entry="Melodie in F.mei"]').hover();
  await page.locator('[data-folder-rename="Melodie in F.mei"]').click();
  await page.keyboard.type("Träumerei");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /already exists/.test(document.querySelector("[data-notice]")?.textContent ?? ""), null, { timeout: 3000 }).catch(() => undefined);
  check(`an existing name is refused with the reason in a notice (${(await page.evaluate(() => document.querySelector("[data-notice]")?.textContent ?? "")).trim().slice(0, 60)})`, /could not rename .*already exists/.test(await page.evaluate(() => document.querySelector("[data-notice]")?.textContent ?? "")) && (await rowNames()).includes("Melodie in F.mei"));

  await page.locator('[data-folder-entry="Träumerei.mei"]').hover();
  await page.locator('[data-folder-rename="Träumerei.mei"]').click();
  await page.keyboard.type("Reverie");
  await page.locator("[data-folder-view] strong").click(); // leave the field
  await page.waitForSelector('[data-folder-entry="Reverie.mei"]', { timeout: 3000 }).catch(() => undefined);
  check("leaving the field commits, as a file manager does", (await rowNames()).includes("Reverie.mei"));

  // --- 8. creating a score or a folder, in the target folder -------------
  /** Which element carries the target mark: "header" for the top folder, else the folder row's name; and how it is drawn. */
  const targetMark = () =>
    page.evaluate(() => {
      const marked = [...document.querySelectorAll("[data-folder-view] [data-folder-target]")];
      const el = marked[0];
      if (!el) return { count: 0 };
      const cs = getComputedStyle(el);
      return { count: marked.length, where: el.tagName === "STRONG" ? "header" : el.querySelector("[data-folder-entry]")?.dataset.folderEntry, bar: cs.boxShadow.includes("inset"), background: cs.backgroundColor };
    });
  const creates = () => page.evaluate(() => window.__CREATES__);
  const lastCreate = async () => (await creates()).at(-1);
  check(`with no row clicked, the buttons name the root (${await page.locator("[data-folder-new-score]").getAttribute("title")})`, (await page.locator("[data-folder-new-score]").getAttribute("title")) === "new score in scores");
  const atRoot = await targetMark();
  check(`…and the folder's name in the header carries the target's bar (${JSON.stringify(atRoot)})`, atRoot.count === 1 && atRoot.where === "header" && atRoot.bar);
  await page.locator("[data-folder-new-score]").click();
  await page.waitForSelector('[data-folder-create-input="file"]', { timeout: 3000 }).catch(() => undefined);
  const newField = await page.evaluate(() => {
    const i = document.querySelector('[data-folder-create-input="file"]');
    const first = document.querySelector("[data-folder-list]")?.firstElementChild;
    return { exists: Boolean(i), focused: document.activeElement === i, empty: i?.value === "", placeholder: i?.placeholder, first: Boolean(first?.hasAttribute("data-folder-creating")) };
  });
  check(`+ score opens an empty, focused field at the top of the root (${JSON.stringify(newField)})`, newField.exists && newField.focused && newField.empty && newField.first);
  await page.keyboard.type("Etude");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-folder-entry="Etude.mei"]', { timeout: 3000 }).catch(() => undefined);
  const made = await lastCreate();
  check(`Enter creates Etude.mei in the root, a blank score titled after it (${made?.cmd} ${made?.path} ${made?.name})`, made?.cmd === "workspace_create_file" && made.path === "/scores" && made.name === "Etude.mei" && /<title>Etude<\/title>/.test(made.contents ?? "") && (await rowNames()).includes("Etude.mei"));
  // the browser has no shell to open it from; the editor opening the very text written is the proof that it is a score
  await page.setInputFiles('input[type="file"]', { name: "Etude.mei", mimeType: "application/xml", buffer: Buffer.from(made?.contents ?? "") });
  await page.waitForFunction(() => (document.querySelector(".tab.active")?.textContent ?? "").includes("Etude") && document.querySelectorAll(".tile .ms").length === 4, null, { timeout: 30000 }).catch(() => undefined);
  check("…and what it wrote opens in the editor as a score of four measures", await page.evaluate(() => (document.querySelector(".tab.active")?.textContent ?? "").includes("Etude") && document.querySelectorAll(".tile .ms").length === 4));

  await page.locator('[data-folder-entry="Bach"]').click(); // a click on a folder makes it the target
  await page.waitForFunction(() => document.querySelector("[data-folder-new-folder]")?.title === "new folder in Bach", null, { timeout: 3000 }).catch(() => undefined);
  check("clicking a folder makes it where things are created", (await page.locator("[data-folder-new-folder]").getAttribute("title")) === "new folder in Bach");
  const atBach = await targetMark();
  const activeBg = await page.evaluate(() => {
    const row = document.querySelector("[data-folder-active]")?.parentElement;
    return row ? getComputedStyle(row).backgroundColor : null;
  });
  check(`…and its row is marked, the header no longer (${JSON.stringify(atBach)})`, atBach.count === 1 && atBach.where === "Bach" && atBach.bar);
  check(`…with a tint that is not the active score's highlight (${atBach.background} vs ${activeBg ?? "no active row listed"})`, atBach.background !== "rgba(0, 0, 0, 0)" && atBach.background !== "rgb(207, 226, 245)");
  await page.locator("[data-folder-new-folder]").click();
  await page.waitForSelector('[data-folder-create-input="dir"]', { timeout: 3000 }).catch(() => undefined);
  check("+ folder's field appears first inside that folder", await page.evaluate(() => {
    const row = document.querySelector('[data-folder-creating="dir"]');
    return Boolean(row?.previousElementSibling?.querySelector('[data-folder-entry="Bach"]'));
  }));
  await page.keyboard.type("Fugues");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-folder-entry="Fugues"]', { timeout: 3000 }).catch(() => undefined);
  check(`Enter creates the folder there (${JSON.stringify(await lastCreate())})`, JSON.stringify(await lastCreate()) === JSON.stringify({ cmd: "workspace_create_folder", path: "/scores/Bach", name: "Fugues" }) && (await rowNames()).indexOf("Fugues") === (await rowNames()).indexOf("Bach") + 1);
  check("…and the new folder becomes the target", (await page.locator("[data-folder-new-score]").getAttribute("title")) === "new score in Fugues");
  check("…and carries the mark", (await targetMark()).where === "Fugues");
  await page.locator("[data-folder-new-score]").click();
  await page.waitForSelector('[data-folder-create-input="file"]', { timeout: 3000 }).catch(() => undefined);
  await page.keyboard.type("Fugue 1");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-folder-entry="Fugue 1.mei"]', { timeout: 3000 }).catch(() => undefined);
  check("so the next score lands in it", (await lastCreate())?.path === "/scores/Bach/Fugues" && (await rowNames()).includes("Fugue 1.mei"));

  const count = (await creates()).length;
  await page.locator("[data-folder-new-folder]").click();
  await page.waitForSelector('[data-folder-create-input="dir"]', { timeout: 3000 }).catch(() => undefined);
  await page.keyboard.type("never");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("[data-folder-create-input]"), null, { timeout: 3000 }).catch(() => undefined);
  check("Escape cancels a new name: no field, nothing created", (await creates()).length === count && !(await page.evaluate(() => Boolean(document.querySelector("[data-folder-create-input]")))));
  await page.locator("[data-folder-new-score]").click();
  await page.waitForSelector('[data-folder-create-input="file"]', { timeout: 3000 }).catch(() => undefined);
  await page.keyboard.type("Fugue 1");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /could not create Fugue 1\.mei: .*already exists/.test(document.querySelector("[data-notice]")?.textContent ?? ""), null, { timeout: 3000 }).catch(() => undefined);
  check("an existing name is refused with the reason, nothing overwritten", /could not create Fugue 1\.mei: .*already exists/.test(await page.evaluate(() => document.querySelector("[data-notice]")?.textContent ?? "")));

  await page.locator("[data-folder-close]").click();
  await page.waitForFunction(() => !document.querySelector("[data-folder-view]"), null, { timeout: 5000 });

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
