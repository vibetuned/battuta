/**
 * The public surface of @battuta/api as text: every declaration file the
 * build would emit, concatenated in a stable order. Shared by the surface
 * test (compares against api-report.d.ts) and api-report.mjs (writes it).
 * Emits to memory through the TypeScript compiler API, so a stale dist/
 * cannot fool either.
 */
import ts from "typescript";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const reportPath = join(root, "api-report.d.ts");

export function publicSurface() {
  const cfgFile = join(root, "tsconfig.build.json");
  const read = ts.readConfigFile(cfgFile, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
  const outDir = join(root, "__surface__");
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, declaration: true, emitDeclarationOnly: true, noEmit: false, outDir });
  const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  const files = {};
  program.emit(
    undefined,
    (fileName, text) => {
      files[relative(outDir, fileName).replace(/\\/g, "/")] = text;
    },
    undefined,
    true,
  );
  return Object.keys(files)
    .sort()
    .map((f) => `// ---- ${f}\n${files[f].trimEnd()}\n`)
    .join("\n");
}

export const packageVersion = () => JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

const header = (version) => `// @battuta/api ${version} — public surface snapshot. Bump the version, then \`npm run api:update -w @battuta/api\`.\n\n`;

export const renderReport = (version, surface) => header(version) + surface;

/** Splits a report into its header version and body (the surface). */
export function parseReport(text) {
  const version = /^\/\/ @battuta\/api (\S+)/.exec(text)?.[1] ?? null;
  const cut = text.indexOf("\n\n");
  return { version, body: cut >= 0 ? text.slice(cut + 2) : text };
}
