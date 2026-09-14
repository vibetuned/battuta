/**
 * The union keymap — every action's keys and modifiers, core and every
 * shipped plugin's, in both layouts — is pinned to a committed snapshot.
 * An EXTRACTION slice is behaviour-neutral by definition, and a new or
 * changed binding is a new behaviour: slice 4's first attempt added
 * `alt+k` to a plugin manifest without a moment's hesitation because it
 * was small. Now it fails here.
 *
 * Changing a binding on purpose is a separate, visible act:
 *
 *   npm run keymap:snapshot -w @battuta/editor      # rewrites test/keymap.snapshot.json
 *
 * and the diff to that file is what the reviewer reads.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KeymapStore } from "../src/host/keymapStore";
import { BUILTIN_PLUGINS } from "../src/host/plugins";
import type { Layout } from "../src/keymap";

const SNAPSHOT = join(dirname(fileURLToPath(import.meta.url)), "keymap.snapshot.json");
const LAYOUTS: Layout[] = ["qwerty", "azerty"];

type Row = { keys: string[]; shift?: boolean; alt?: boolean; locked?: boolean; plugin?: string };

/** The union keymap as the running app has it, reduced to what a key press matches on. */
export function unionKeymapSnapshot(): Record<Layout, Record<string, Row>> {
  const out = {} as Record<Layout, Record<string, Row>>;
  for (const layout of LAYOUTS) {
    const store = new KeymapStore(layout);
    for (const entry of BUILTIN_PLUGINS) {
      const bindings = entry.manifest.contributes?.keybindings ?? [];
      if (bindings.length) store.contribute(entry.manifest.id, bindings);
    }
    const rows: Record<string, Row> = {};
    for (const [id, b] of Object.entries(store.get()).sort(([a], [c]) => a.localeCompare(c))) {
      rows[id] = {
        keys: [...b.keys],
        ...(b.shift !== undefined ? { shift: b.shift } : {}),
        ...(b.alt !== undefined ? { alt: b.alt } : {}),
        ...(b.locked ? { locked: true } : {}),
        ...(b.plugin ? { plugin: b.plugin } : {}),
      };
    }
    out[layout] = rows;
  }
  return out;
}

describe("the union keymap snapshot", () => {
  const current = JSON.stringify(unionKeymapSnapshot(), null, 2) + "\n";

  if (process.env["UPDATE_KEYMAP_SNAPSHOT"]) {
    it("rewrites test/keymap.snapshot.json (UPDATE_KEYMAP_SNAPSHOT is set)", () => {
      writeFileSync(SNAPSHOT, current);
      expect(existsSync(SNAPSHOT)).toBe(true);
    });
    return;
  }

  it("every binding, core and plugin, in both layouts, is exactly what is committed — a change is a deliberate act, never a side effect of an extraction", () => {
    expect(existsSync(SNAPSHOT), "no snapshot yet: npm run keymap:snapshot -w @battuta/editor").toBe(true);
    const committed = readFileSync(SNAPSHOT, "utf8");
    expect(current).toBe(committed);
  });

  it("covers both layouts and the shipped plugins' contributions", () => {
    const snap = unionKeymapSnapshot();
    expect(Object.keys(snap.qwerty).length).toBeGreaterThan(30);
    expect(Object.values(snap.qwerty).some((r) => r.plugin)).toBe(true);
  });
});
