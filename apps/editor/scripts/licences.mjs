/**
 * The notices battuta ships (phase 10, M4): every npm package the build
 * bundles, every crate the shell links on the platforms battuta is built
 * for, and the assets that are not packages (Verovio's licence, the piano
 * samples, the music font) — each with the licence texts it carries.
 * Writes src/licences.json, which the about box loads only when it opens.
 *
 * What ships, not what is installed: the npm side is read from a real
 * `vite build` (its module graph, workers included); the crate side from
 * `cargo metadata`, normal dependencies only (build-time crates and
 * procedural macros put none of their code in the binary). The output is
 * deterministic, so an unchanged tree regenerates byte for byte.
 *
 * Run after a dependency changes:  npm run licences -w @battuta/editor
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "vite";

const editor = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(editor, "src/licences.json");
const TARGETS = ["aarch64-apple-ios", "aarch64-linux-android", "aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-unknown-linux-gnu", "x86_64-pc-windows-msvc"];
const LICENCE_FILE = /^(licen[cs]e|copying|notice|copyright)([-._].*)?$/i;

const texts = new Map(); // id -> text
// One entry per text, whatever its line breaks and indentation: hundreds of
// crates carry the same Apache-2.0, laid out a few different ways.
const textId = (text) => {
  const t = text.replace(/\r\n/g, "\n").replace(/^(\s*\n)+/, "").trimEnd(); // keeps a centred title's indent
  const id = createHash("sha256").update(t.replace(/\s+/g, " ")).digest("hex").slice(0, 12);
  if (!texts.has(id)) texts.set(id, t);
  return id;
};
const licenceTexts = (dir) =>
  readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f))
    .sort()
    .map((f) => textId(readFileSync(join(dir, f), "utf8")));
const url = (repo) => (typeof repo === "string" ? repo : repo?.url ?? "").replace(/^git\+/, "").replace(/\.git$/, "") || undefined;

// --- npm: what the build bundles ---------------------------------------------

const modules = new Set();
const collect = () => ({
  name: "battuta-licences",
  generateBundle(_, bundle) {
    for (const chunk of Object.values(bundle)) if (chunk.type === "chunk") for (const id of Object.keys(chunk.modules)) modules.add(id);
  },
});
const outDir = mkdtempSync(join(tmpdir(), "battuta-licences-"));
try {
  await build({ configFile: join(editor, "vite.config.ts"), root: editor, logLevel: "warn", plugins: [collect()], worker: { plugins: () => [collect()] }, build: { outDir, emptyOutDir: true } });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
const npmDirs = new Set();
for (const id of modules) {
  const f = id.replace(/\\/g, "/").replace(/^\0/, "").split("?")[0];
  const at = f.lastIndexOf("/node_modules/");
  if (at < 0) continue;
  const rest = f.slice(at + "/node_modules/".length).split("/");
  npmDirs.add(f.slice(0, at) + "/node_modules/" + (rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0]));
}
const components = [];
for (const dir of npmDirs) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (pkg.name.startsWith("@battuta/")) continue; // battuta itself
  components.push({ name: pkg.name, version: pkg.version, licence: pkg.license ?? "see text", source: url(pkg.repository) ?? pkg.homepage, kind: "npm", texts: licenceTexts(dir) });
}

// --- crates: what the shell links --------------------------------------------

const crates = new Map();
for (const target of TARGETS) {
  const meta = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--offline", "--filter-platform", target], { cwd: join(editor, "src-tauri"), maxBuffer: 1 << 28 }).toString());
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const stack = [meta.resolve.root];
  const seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id).deps) {
      if (!dep.dep_kinds.some((k) => k.kind === null)) continue;
      const p = byId.get(dep.pkg);
      if (p.targets.some((t) => t.kind.includes("proc-macro"))) continue;
      stack.push(dep.pkg);
    }
  }
  for (const id of seen) {
    const p = byId.get(id);
    if (id === meta.resolve.root || p.source === null) continue; // the shell and battuta's own plugin crate
    crates.set(`${p.name}@${p.version}`, p);
  }
}
for (const p of crates.values()) {
  const dir = dirname(p.manifest_path);
  const own = licenceTexts(dir);
  if (p.license_file && !own.length) own.push(textId(readFileSync(join(dir, p.license_file), "utf8")));
  components.push({ name: p.name, version: p.version, licence: p.license ?? "see text", source: p.repository ?? p.homepage ?? undefined, kind: "crate", texts: own });
}

// --- what is not a package -----------------------------------------------------

const verovio = components.find((c) => c.name === "verovio");
if (!verovio) throw new Error("verovio is not in the bundle — the notice would miss its credit");
// The npm package carries no licence file: LGPL-3.0 §4 asks for the LGPL and the GPL it builds on.
verovio.texts = [textId(readFileSync(join(editor, "licences/LGPL-3.0.txt"), "utf8")), textId(readFileSync(join(editor, "licences/GPL-3.0.txt"), "utf8"))];
verovio.source = "https://github.com/rism-digital/verovio";
components.push({
  name: "Salamander Grand Piano",
  version: "V3 (30 samples)",
  licence: "CC-BY-3.0",
  source: "https://archive.org/details/SalamanderGrandPianoV3",
  kind: "asset",
  texts: [textId("Salamander Grand Piano V3 by Alexander Holm, licensed under the Creative Commons Attribution 3.0 Unported licence:\nhttps://creativecommons.org/licenses/by/3.0/\n\nbattuta plays thirty of its samples (every third semitone), as MP3.")],
});
components.push({
  name: "Noto Music",
  version: "font",
  licence: "OFL-1.1",
  source: "https://github.com/notofonts/music",
  kind: "asset",
  texts: [textId(readFileSync(join(editor, "src/assets/fonts/LICENSE-NotoMusic.txt"), "utf8"))],
});

components.sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"));
const used = new Set(components.flatMap((c) => c.texts));
const out = {
  battuta: { licence: "AGPL-3.0-only", text: textId(readFileSync(join(editor, "../../LICENSE"), "utf8")) },
  components,
  texts: Object.fromEntries([...texts].filter(([id]) => used.has(id) || id === textId(readFileSync(join(editor, "../../LICENSE"), "utf8"))).sort(([a], [b]) => a.localeCompare(b))),
};
writeFileSync(OUT, JSON.stringify(out) + "\n");
const missing = components.filter((c) => !c.texts.length);
console.log(`${components.length} components (${components.filter((c) => c.kind === "npm").length} npm, ${crates.size} crates), ${used.size} distinct texts, ${(JSON.stringify(out).length / 1024).toFixed(0)} kB → ${OUT}`);
if (missing.length) console.log(`no licence file of their own (named by SPDX id only): ${missing.map((c) => `${c.name} ${c.licence}`).join(", ")}`);
if (!existsSync(OUT)) process.exit(1);
