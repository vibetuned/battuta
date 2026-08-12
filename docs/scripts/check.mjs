/**
 * Guard the guide against drift. Run after a build: `npm run check`.
 *
 *  1. Internal links resolve to a page that exists in dist/.
 *  2. Every figure a page asks for was built, and every built figure is used.
 *  3. Every keymap action is explained somewhere other than the generated
 *     reference table — a new binding in the app should get prose, not just
 *     a row.
 *
 * Exit code 1 on 1 or 2; 3 is reported as a warning, because a handful of
 * actions legitimately live only in the reference (system chords).
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(here, "..");
const dist = join(docsRoot, "dist");
const contentDir = join(docsRoot, "src/content/docs");

if (!existsSync(dist)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const problems = [];
const warnings = [];

// --- 1. internal links -----------------------------------------------------

const htmlFiles = walk(dist).filter((f) => f.endsWith(".html"));
const base = (process.env.DOCS_BASE ?? "/").replace(/\/$/, "");

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  const pageDir = dirname(file);
  for (const m of html.matchAll(/href="([^"#?]+)(?:[#?][^"]*)?"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|data:|\/\/)/.test(href)) continue;
    let target;
    if (href.startsWith("/")) {
      const stripped = base && href.startsWith(`${base}/`) ? href.slice(base.length) : href;
      target = join(dist, stripped);
    } else {
      target = resolve(pageDir, href);
    }
    const candidates = [target, join(target, "index.html"), `${target}.html`];
    if (!candidates.some((c) => existsSync(c) && statSync(c).isFile())) {
      problems.push(`dead link ${href} in ${relative(dist, file)}`);
    }
  }
}

// --- 2. figures ------------------------------------------------------------

const manifest = JSON.parse(readFileSync(join(docsRoot, "public/figures/manifest.json"), "utf8"));
const built = new Set(manifest.figures.map((f) => f.name));
const pages = walk(contentDir).filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));
const used = new Set();

for (const page of pages) {
  const src = readFileSync(page, "utf8");
  for (const m of src.matchAll(/<Figure\s+name="([^"]+)"/g)) {
    used.add(m[1]);
    if (!built.has(m[1])) problems.push(`missing figure "${m[1]}" used in ${relative(docsRoot, page)}`);
  }
}
for (const name of built) {
  if (!used.has(name)) warnings.push(`figure "${name}" is built but never used`);
}

// --- 3. keymap coverage ----------------------------------------------------

const keymap = JSON.parse(readFileSync(join(docsRoot, "src/data/keymap.json"), "utf8"));
const actions = keymap.layouts.qwerty.flatMap((g) => g.actions.map((a) => ({ ...a, group: g.group })));
const topicPages = pages.filter((p) => !p.endsWith(join("reference", "keyboard.mdx")));
const topicSrc = topicPages.map((p) => readFileSync(p, "utf8")).join("\n");

for (const action of actions) {
  const byId = new RegExp(`ids=\\{\\[[^\\]]*"${action.id}"`).test(topicSrc);
  const byGroup = new RegExp(`group="${action.group}"`).test(topicSrc);
  if (!byId && !byGroup) warnings.push(`keymap action "${action.id}" (${action.label}) appears only in the reference table`);
}

// --- report ----------------------------------------------------------------

console.log(`checked ${htmlFiles.length} pages, ${built.size} figures, ${actions.length} keymap actions`);
for (const w of warnings) console.warn(`  warning: ${w}`);
for (const p of problems) console.error(`  error:   ${p}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(warnings.length ? `ok, with ${warnings.length} warning(s).` : "ok.");
