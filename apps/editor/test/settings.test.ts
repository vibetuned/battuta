/**
 * The settings blob's one-time moves. A setting whose owner changed — a
 * feature that became a plugin — has to be carried into the plugin's
 * namespace by the HOST: a plugin sees only its own namespace, and the
 * whole point is that the old value is somewhere else.
 *
 * `migrate` is pure, so reading settings never writes; the migrated shape
 * is persisted by the next `saveSettings`.
 */
import { describe, it, expect } from "vitest";
import { migrate, type Settings } from "../src/settings";

const KEYBOARD = "battuta.onscreen-keyboard";
const open = (s: Settings) => s.plugins?.[KEYBOARD]?.values?.["open"];

describe("2026-09-14 (slice 4b): vkeys → the on-screen keyboard plugin", () => {
  it("moves the legacy flag into the plugin's namespace and drops it", () => {
    const out = migrate({ zoom: 1.2, vkeys: true });
    expect(open(out)).toBe(true);
    expect(out.vkeys).toBeUndefined();
    expect(out.zoom).toBe(1.2); // everything else is untouched
  });

  it("carries a closed panel across too — the choice is what matters, not the value", () => {
    expect(open(migrate({ vkeys: false }))).toBe(false);
  });

  it("leaves a blob without the legacy key exactly as it was", () => {
    const s: Settings = { layout: "azerty", plugins: { [KEYBOARD]: { enabled: false } } };
    expect(migrate(s)).toBe(s);
  });

  it("keeps the plugin's own value when both exist: the user has used it since", () => {
    const out = migrate({ vkeys: true, plugins: { [KEYBOARD]: { values: { open: false } } } });
    expect(open(out)).toBe(false);
    expect(out.vkeys).toBeUndefined();
  });

  it("does not disturb the plugin's enabled switch", () => {
    const out = migrate({ vkeys: true, plugins: { [KEYBOARD]: { enabled: false } } });
    expect(out.plugins?.[KEYBOARD]?.enabled).toBe(false);
    expect(open(out)).toBe(true);
  });

  it("is idempotent", () => {
    const once = migrate({ vkeys: true });
    expect(migrate(once)).toBe(once);
  });
});
