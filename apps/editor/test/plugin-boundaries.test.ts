/**
 * HARD RULES for plugin packages — enforced here, in CI, so that a
 * violation is a red build and not a design argument. The first slice-2
 * attempt showed that a rule whose only enforcement is a README sentence
 * gets rewritten to match the code; every rule below has a failing test.
 *
 *   1. A plugin's runtime code imports only @battuta/api, react, tone and
 *      its own files. Never @battuta/core, never apps/editor, never
 *      Verovio. (Commands are messages; reads are the query facade.)
 *      Tone was forbidden until slice 7a decided the host owns the
 *      AudioContext and a plugin brings its own instrument (2026-09-15);
 *      Verovio stays forbidden because rendering is a host service.
 *   2. A plugin's package.json depends on @battuta/api and nothing else
 *      of the workspace.
 *   3. src/manifest.ts imports nothing but @battuta/api — the host loads
 *      it statically, before any plugin code.
 *   4. No DOM: window, document, navigator, localStorage, sessionStorage
 *      never appear as globals (ctx.document is fine — it is the context).
 *   5. Both documents exist: README.md, and BUILDING.md with the eight
 *      fixed headings.
 *
 * Tests under a plugin's test/ may additionally import vitest, node:*,
 * and the host (apps/editor/src/host) to run against createHost().
 *
 * The rules are pure functions checked against inline samples, so the
 * checker itself is verified even when no plugin package exists yet;
 * then every real package under packages/plugins/ is scanned.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../..");
const PLUGINS = join(REPO, "packages/plugins");
const HOST_DIR = join(REPO, "apps/editor/src/host");

const ALLOWED_RUNTIME = new Set(["@battuta/api", "react", "react/jsx-runtime", "react/jsx-dev-runtime", "tone"]);
const FORBIDDEN_DEPS = ["@battuta/core", "@battuta/editor", "verovio", "react-dom"];
const BUILDING_HEADINGS = ["1. Origin", "2. Manifest", "3. API surface", "4. State", "5. Command messages", "6. Tests", "7. Dead ends", "8. Recipe"];

/** Strip comments and string literals so rules see code, not prose. */
export function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}

/** Every module specifier a source file imports (static, re-export, dynamic). */
export function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const m of noComments.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]*?\s+from\s+)?["']([^"']+)["']/g)) out.push(m[1]!);
  for (const m of noComments.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]!);
  return out;
}

export interface SourceCheck {
  /** Absolute path of the plugin package root. */
  pluginRoot: string;
  /** Path of the file, relative to pluginRoot (e.g. "src/index.ts"). */
  file: string;
  source: string;
}

/** Rules 1, 3 and 4 over one source file. Empty = clean. */
export function checkSource({ pluginRoot, file, source }: SourceCheck): string[] {
  const problems: string[] = [];
  const isTest = /^test\//.test(file) || /\.test\.[cm]?[jt]sx?$/.test(file);
  const isManifest = /^src\/manifest\.[cm]?[jt]s$/.test(file);
  for (const spec of importSpecifiers(source)) {
    if (spec.startsWith(".")) {
      const target = resolve(pluginRoot, dirname(file), spec);
      const inside = !relative(pluginRoot, target).startsWith("..");
      const intoHost = isTest && !relative(HOST_DIR, target).startsWith("..");
      if (!inside && !intoHost) problems.push(`${file}: relative import "${spec}" leaves the plugin package`);
      if (isManifest) problems.push(`${file}: the manifest must import nothing but @battuta/api (found "${spec}")`);
      continue;
    }
    if (isManifest && spec !== "@battuta/api") problems.push(`${file}: the manifest must import nothing but @battuta/api (found "${spec}")`);
    if (ALLOWED_RUNTIME.has(spec)) continue;
    if (isTest && (spec === "vitest" || spec.startsWith("node:"))) continue;
    problems.push(`${file}: import "${spec}" is not allowed in a plugin (only @battuta/api, react and the package's own files${isTest ? ", plus vitest/node:* and the host in tests" : ""})`);
  }
  if (!isTest) {
    const code = codeOnly(source);
    const dom = /(^|[^.\w$])(window|document|navigator|localStorage|sessionStorage)\s*[.[(]/g;
    for (const m of code.matchAll(dom)) problems.push(`${file}: DOM global "${m[2]}" — plugins never touch the DOM (use ctx.document, ctx.storage, slots and panels)`);
  }
  return problems;
}

/** Rule 2 over a package.json. */
export function checkPackageJson(json: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const all = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((k) => Object.keys((json[k] as Record<string, string> | undefined) ?? {}));
  for (const dep of all) if (FORBIDDEN_DEPS.includes(dep)) problems.push(`package.json depends on ${dep} — a plugin may depend on @battuta/api only`);
  if (!all.includes("@battuta/api")) problems.push("package.json must depend on @battuta/api");
  const name = String(json["name"] ?? "");
  if (!/^@battuta\/plugin-[a-z0-9-]+$/.test(name)) problems.push(`package name "${name}" must be @battuta/plugin-<name>`);
  return problems;
}

/** Rule 5 over the two documents. */
export function checkDocs(readme: string | null, building: string | null): string[] {
  const problems: string[] = [];
  if (readme === null || !readme.trim()) problems.push("README.md (how to use it) is missing");
  if (building === null || !building.trim()) problems.push("BUILDING.md (how it was built) is missing");
  else {
    for (const h of BUILDING_HEADINGS) if (!new RegExp(`^##\\s+${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "m").test(building)) problems.push(`BUILDING.md lacks the heading "## ${h}"`);
  }
  return problems;
}

const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (entry === "node_modules" || entry === "dist") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.[cm]?[jt]sx?$/.test(entry)) out.push(p);
  }
  return out;
};

/** Every problem in one plugin package. */
export function checkPlugin(pluginRoot: string): string[] {
  const problems: string[] = [];
  const pkgPath = join(pluginRoot, "package.json");
  problems.push(...checkPackageJson(JSON.parse(readFileSync(pkgPath, "utf8"))));
  for (const file of walk(pluginRoot)) {
    problems.push(...checkSource({ pluginRoot, file: relative(pluginRoot, file).replace(/\\/g, "/"), source: readFileSync(file, "utf8") }));
  }
  const read = (name: string) => (existsSync(join(pluginRoot, name)) ? readFileSync(join(pluginRoot, name), "utf8") : null);
  problems.push(...checkDocs(read("README.md"), read("BUILDING.md")));
  return problems;
}

const ROOT = "/repo/packages/plugins/demo";
const src = (file: string, source: string) => checkSource({ pluginRoot: ROOT, file, source });

describe("the rules, on samples", () => {
  it("allows @battuta/api, react and the package's own files", () => {
    expect(src("src/index.ts", 'import { definePlugin, type PluginContext } from "@battuta/api";\nimport { forms } from "./forms";\nimport type { ReactNode } from "react";\nexport * from "./forms";\n')).toEqual([]);
  });

  it("refuses @battuta/core, the editor, Verovio — static, type-only, re-export or dynamic; Tone is a plugin's instrument since 7a", () => {
    expect(src("src/index.ts", 'import { SetPitchesCommand } from "@battuta/core";')).toEqual(['src/index.ts: import "@battuta/core" is not allowed in a plugin (only @battuta/api, react and the package\'s own files)']);
    expect(src("src/index.ts", 'import type { Command } from "@battuta/core";')).toHaveLength(1);
    expect(src("src/index.ts", 'export { x } from "@battuta/core/fuzz";')).toHaveLength(1);
    expect(src("src/index.ts", 'const m = await import("verovio");')).toHaveLength(1);
    expect(src("src/index.ts", 'import * as Tone from "tone";')).toEqual([]);
    expect(src("src/index.ts", 'const T = await import("tone");')).toEqual([]);
  });

  it("refuses relative imports that leave the package (the editor, core sources)", () => {
    expect(src("src/index.ts", 'import { host } from "../../../../apps/editor/src/host";')).toEqual(['src/index.ts: relative import "../../../../apps/editor/src/host" leaves the plugin package']);
    expect(src("src/index.ts", 'import { x } from "../../core/src/reflect";')).toHaveLength(1);
  });

  it("lets a test file reach vitest, node:* and the host, but still not core", () => {
    const hostRel = relative(join(ROOT, "test"), HOST_DIR).replace(/\\/g, "/");
    expect(src("test/plugin.test.ts", `import { describe } from "vitest";\nimport { readFileSync } from "node:fs";\nimport { createHost } from "${hostRel}";\nimport plugin from "../src/index";`)).toEqual([]);
    expect(src("test/plugin.test.ts", 'import { SetPitchesCommand } from "@battuta/core";')).toHaveLength(1);
  });

  it("keeps the manifest to @battuta/api alone", () => {
    expect(src("src/manifest.ts", 'import type { PluginManifest } from "@battuta/api";\nexport const manifest: PluginManifest = {} as never;')).toEqual([]);
    expect(src("src/manifest.ts", 'import { forms } from "./forms";')).toEqual(['src/manifest.ts: the manifest must import nothing but @battuta/api (found "./forms")']);
  });

  it("refuses DOM globals but not ctx.document, comments or strings", () => {
    expect(src("src/index.ts", "const el = document.querySelector('x');")).toEqual(['src/index.ts: DOM global "document" — plugins never touch the DOM (use ctx.document, ctx.storage, slots and panels)']);
    expect(src("src/index.ts", "window.addEventListener('resize', f); localStorage.getItem('k');")).toHaveLength(2);
    expect(src("src/index.ts", "const v = ctx.document.get()?.version; // window.x in a comment\nctx.notice(\"document.body\");")).toEqual([]);
  });

  it("package.json: @battuta/api only, named @battuta/plugin-<name>", () => {
    expect(checkPackageJson({ name: "@battuta/plugin-reflection", dependencies: { "@battuta/api": "*" } })).toEqual([]);
    expect(checkPackageJson({ name: "@battuta/plugin-reflection", dependencies: { "@battuta/api": "*", "@battuta/core": "*" } })).toEqual(["package.json depends on @battuta/core — a plugin may depend on @battuta/api only"]);
    expect(checkPackageJson({ name: "reflection", devDependencies: { verovio: "1" } })).toEqual(["package.json depends on verovio — a plugin may depend on @battuta/api only", "package.json must depend on @battuta/api", 'package name "reflection" must be @battuta/plugin-<name>']);
    expect(checkPackageJson({ name: "@battuta/plugin-playback", dependencies: { "@battuta/api": "*", tone: "^15" } })).toEqual([]); // the instrument is the plugin's
  });

  it("both documents, BUILDING.md with the eight headings", () => {
    const building = BUILDING_HEADINGS.map((h) => `## ${h}\n\ntext\n`).join("\n");
    expect(checkDocs("# Demo\n", building)).toEqual([]);
    expect(checkDocs(null, building.replace("## 7. Dead ends", "## 7. Notes"))).toEqual(["README.md (how to use it) is missing", 'BUILDING.md lacks the heading "## 7. Dead ends"']);
  });
});

describe("every plugin package under packages/plugins", () => {
  const plugins = existsSync(PLUGINS) ? readdirSync(PLUGINS).filter((d) => existsSync(join(PLUGINS, d, "package.json"))) : [];
  it(`scans ${plugins.length} package(s)`, () => {
    expect(Array.isArray(plugins)).toBe(true);
  });
  for (const name of plugins) {
    it(`${name} obeys every rule`, () => {
      expect(checkPlugin(join(PLUGINS, name))).toEqual([]);
    });
  }
});
