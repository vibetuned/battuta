/**
 * The notices the about box shows (src/licences.json) are generated —
 * `npm run licences -w @battuta/editor` reads what the build bundles and
 * what the shell links — and committed. This test catches the one way they
 * go stale silently: a dependency added to the editor or a plugin without
 * regenerating them. It also holds the credits the stores and the licences
 * ask for: Verovio with the LGPL and the GPL it builds on, the piano
 * samples, the music font.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../..");
const notices = JSON.parse(readFileSync(join(here, "../src/licences.json"), "utf8")) as {
  components: { name: string; version: string; licence: string; texts: string[] }[];
  texts: Record<string, string>;
};
const named = (name: string) => notices.components.find((c) => c.name === name);

const shipped = (dir: string): string[] => Object.keys((JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string> }).dependencies ?? {}).filter((d) => !d.startsWith("@battuta/"));

describe("licence notices", () => {
  it("name every dependency the editor and its plugins ship", () => {
    const plugins = join(REPO, "packages/plugins");
    const dirs = [join(REPO, "apps/editor"), ...readdirSync(plugins, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(plugins, e.name))];
    const missing = dirs.flatMap(shipped).filter((d) => !named(d));
    expect(missing, "run `npm run licences -w @battuta/editor`").toEqual([]);
  });

  it("carry Verovio's credit with the LGPL and the GPL", () => {
    const verovio = named("verovio")!;
    expect(verovio.licence).toMatch(/^LGPL-3\.0/);
    const texts = verovio.texts.map((id) => notices.texts[id] ?? "");
    expect(texts.some((t) => t.includes("GNU LESSER GENERAL PUBLIC LICENSE"))).toBe(true);
    expect(texts.some((t) => /^\s*GNU GENERAL PUBLIC LICENSE/.test(t))).toBe(true);
  });

  it("credit the assets that are not packages", () => {
    expect(named("Salamander Grand Piano")?.licence).toBe("CC-BY-3.0");
    expect(named("Noto Music")?.licence).toBe("OFL-1.1");
  });

  it("resolve every text they point to", () => {
    const dangling = notices.components.flatMap((c) => c.texts.filter((id) => !notices.texts[id]).map((id) => `${c.name}: ${id}`));
    expect(dangling).toEqual([]);
  });
});
