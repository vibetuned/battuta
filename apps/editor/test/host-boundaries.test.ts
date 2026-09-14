/**
 * HARD RULES for the host itself — the counterpart of plugin-boundaries.
 * Slice 4's first attempt taught two things the plugin test could not
 * see: a forbidden capability can be RELOCATED into the host and called
 * through a pass-through, and a new host module can be invented by a
 * slice that was never allowed one. Both get a failing test here.
 *
 *   1. No synthesized input anywhere in the host or the plugins: no
 *      dispatchEvent(), no `new KeyboardEvent` / MouseEvent / PointerEvent
 *      / InputEvent / CustomEvent. Input surfaces run actions by id or
 *      register virtual inputs; nobody forges events for the editor's
 *      handlers to interpret.
 *   2. The set of host modules is an ALLOWLIST. A new module under
 *      apps/editor/src/host/ is an architecture decision — a host service,
 *      a new mechanism — that a slice proposes and the user approves. Add
 *      it to the list in the same change as the brief that permits it;
 *      the diff to this file is the record.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "../../..");
const HOST = join(REPO, "apps/editor/src/host");
const PLUGINS = join(REPO, "packages/plugins");

/**
 * Every module the host is allowed to have. Adding one is a decision the
 * user takes in the slice brief (PLANNING.md), never one a slice takes
 * for itself — slice 4's first attempt added `keyboard.ts` on its own and
 * built a key-forging service in it.
 */
// actions.ts: slice 4a (2026-09-14), the key dispatcher as a table — approved in the PLANNING.md brief.
const HOST_MODULES = ["actions.ts", "index.ts", "keymapStore.ts", "messages.ts", "midi.ts", "midiSink.ts", "plugins.ts", "queries.ts", "registry.ts", "services.ts", "shell.ts", "slots.tsx", "store.ts"];

const codeOnly = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");

const SYNTHESIZED_INPUT = /\b(dispatchEvent\s*\(|new\s+(Keyboard|Mouse|Pointer|Input|Custom|Wheel|Touch)Event\s*\()/g;

/** Every forged-input site in one source file. */
export function synthesizedInputSites(source: string): string[] {
  return [...codeOnly(source).matchAll(SYNTHESIZED_INPUT)].map((m) => m[1]!.trim());
}

const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (entry === "node_modules" || entry === "dist" || entry === "test") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.[cm]?[jt]sx?$/.test(entry)) out.push(p);
  }
  return out;
};

describe("no synthesized input", () => {
  it("the rule on samples: forging an event is caught; reading one is not", () => {
    expect(synthesizedInputSites('window.dispatchEvent(new KeyboardEvent("keydown", key));')).toEqual(["dispatchEvent(", "new KeyboardEvent("]);
    expect(synthesizedInputSites("el.dispatchEvent(evt)")).toEqual(["dispatchEvent("]);
    expect(synthesizedInputSites("const e = new PointerEvent('pointerdown')")).toEqual(["new PointerEvent("]);
    expect(synthesizedInputSites("window.addEventListener('keydown', onKey); // dispatchEvent in a comment\nconst s = 'new KeyboardEvent(';")).toEqual([]);
    expect(synthesizedInputSites("const onKey = (e: KeyboardEvent) => keyMatches(b, e);")).toEqual([]);
  });

  for (const root of [HOST, PLUGINS]) {
    it(`${relative(REPO, root)}/** forges no events`, () => {
      const problems: string[] = [];
      for (const file of walk(root)) {
        for (const site of synthesizedInputSites(readFileSync(file, "utf8"))) problems.push(`${relative(REPO, file)}: ${site} — input surfaces run actions by id or register virtual inputs; nothing forges events for the host to interpret`);
      }
      expect(problems).toEqual([]);
    });
  }
});

describe("the host's modules are an allowlist", () => {
  it("apps/editor/src/host holds exactly the modules the plan permits", () => {
    const actual = readdirSync(HOST).filter((f) => /\.[cm]?[jt]sx?$/.test(f)).sort();
    const extra = actual.filter((f) => !HOST_MODULES.includes(f));
    const missing = HOST_MODULES.filter((f) => !actual.includes(f));
    expect(extra, "a new host module is an architecture decision: propose it in the slice brief, and add it to HOST_MODULES in the same change the user approves").toEqual([]);
    expect(missing).toEqual([]);
  });
});
