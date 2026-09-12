/**
 * Host bundle budget (Phase 9, "lightness enforced in CI").
 *
 * Reads dist/.vite/manifest.json after `npm run build` and sums the
 * INITIAL chunk: the HTML entry's JS plus everything it imports
 * statically, plus its CSS. Lazy chunks (dynamic imports: the piano
 * samples, Tone.js, the Humdrum converter, every plugin) do not count —
 * that is the point. Fails when:
 *
 *   1. the initial bytes exceed budget.json's ceiling, or
 *   2. any `plugin-*` chunk (named by vite.config.ts's manualChunks) is
 *      reachable from the entry statically — plugin code in the host.
 *
 * Run: npm run budget -w @battuta/editor   (after a build)
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(app, "dist");
const manifestPath = join(dist, ".vite", "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("dist/.vite/manifest.json not found — run `npm run build -w @battuta/editor` first");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const budget = JSON.parse(readFileSync(join(app, "budget.json"), "utf8"));

const size = (file) => statSync(join(dist, file)).size;
const initial = new Map(); // file -> bytes
const pluginChunks = [];
const visit = (key) => {
  const chunk = manifest[key];
  if (!chunk || initial.has(chunk.file)) return;
  initial.set(chunk.file, size(chunk.file));
  if (/(^|\/)plugin-[^/]*\.js$/.test(chunk.file) || (chunk.name ?? "").startsWith("plugin-")) pluginChunks.push(chunk.file);
  for (const css of chunk.css ?? []) if (!initial.has(css)) initial.set(css, size(css));
  for (const imp of chunk.imports ?? []) visit(imp);
};
for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) visit(key);

const total = [...initial.values()].reduce((a, b) => a + b, 0);
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(`initial chunk: ${kb(total)} in ${initial.size} file(s) (ceiling ${kb(budget.initialBytes)})`);
for (const [file, bytes] of [...initial.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${kb(bytes).padStart(10)}  ${file}`);
const lazy = Object.values(manifest).filter((c) => !initial.has(c.file) && c.file.endsWith(".js"));
if (lazy.length) console.log(`lazy chunks (not counted): ${lazy.map((c) => `${c.file} ${kb(size(c.file))}`).join(", ")}`);

let failed = false;
if (total > budget.initialBytes) {
  console.error(`FAIL  initial chunk ${kb(total)} exceeds the ceiling ${kb(budget.initialBytes)} — move the new code behind a dynamic import or a plugin, or raise budget.json deliberately (and say why in CHANGELOG.md)`);
  failed = true;
}
if (pluginChunks.length) {
  console.error(`FAIL  plugin code reached from the initial chunk: ${pluginChunks.join(", ")} — a plugin must be imported only through its host/plugins.ts load()`);
  failed = true;
}
if (!failed) console.log("ok.");
process.exit(failed ? 1 : 0);
