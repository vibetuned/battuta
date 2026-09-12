/**
 * validateManifest: every rule the registry relies on, one case each, so
 * a plugin author gets a sentence instead of a silent no-op.
 */
import { describe, it, expect } from "vitest";
import { validateManifest, type PluginManifest } from "../src/index";

const valid: PluginManifest = {
  id: "battuta.reflection",
  name: "Reflection cycle",
  version: "0.1.0",
  engines: { battuta: "^0.1.0" },
  activationEvents: ["onCommand:battuta.reflection.cycle"],
  contributes: {
    commands: [{ id: "battuta.reflection.cycle", title: "Reflection cycle" }],
    keybindings: [{ command: "battuta.reflection.cycle", keys: ["R"], label: "reflection cycle", group: "rhythm", when: "block selection" }],
  },
};

const withPatch = (patch: Record<string, unknown>) => validateManifest({ ...valid, ...patch });

describe("validateManifest", () => {
  it("accepts a complete manifest", () => {
    expect(validateManifest(valid)).toEqual([]);
  });

  it("accepts the minimal manifest (no contributions, no capabilities)", () => {
    expect(validateManifest({ id: "a.b", name: "x", version: "1.0.0", engines: { battuta: "*" }, activationEvents: ["onStartup"] })).toEqual([]);
  });

  it("rejects non-objects", () => {
    expect(validateManifest(null)).toEqual(["manifest must be an object"]);
    expect(validateManifest("x")).toEqual(["manifest must be an object"]);
  });

  it("requires a dotted lowercase id", () => {
    for (const id of ["reflection", "Battuta.Reflection", "battuta..x", "9.x", ""]) {
      expect(withPatch({ id }).some((p) => p.startsWith("id must be"))).toBe(true);
    }
    expect(withPatch({ id: "vibetuned.omr-strips.v2" })).toEqual([]);
  });

  it("requires name, semver version and an engines.battuta range", () => {
    expect(withPatch({ name: " " })).toContain("name is required");
    expect(withPatch({ version: "1.0" })).toContain("version must be semver (x.y.z)");
    expect(withPatch({ engines: {} })).toContain("engines.battuta (an @battuta/api range) is required");
    expect(withPatch({ engines: undefined })).toContain("engines.battuta (an @battuta/api range) is required");
  });

  it("knows the activation events and rejects the rest", () => {
    expect(withPatch({ activationEvents: ["onStartup", "onPlay", "onLane:lyrics", "onFormat:musicxml", "onDocument:hasFacsimile", "onView:page", "onPointer:coarse"] })).toEqual([]);
    expect(withPatch({ activationEvents: ["onCommand:"] })).toEqual(['unknown activation event "onCommand:"']);
    expect(withPatch({ activationEvents: ["onClick"] })).toEqual(['unknown activation event "onClick"']);
    expect(withPatch({ activationEvents: "onStartup" })).toEqual(["activationEvents must be an array"]);
  });

  it("only accepts capabilities the host can offer", () => {
    expect(withPatch({ capabilities: ["midi", "workspace", "playback"] })).toEqual([]);
    expect(withPatch({ capabilities: ["network"] })).toEqual(['unknown capability "network"']);
  });

  it("ties keybindings to the plugin's own commands", () => {
    const problems = withPatch({ contributes: { keybindings: [{ command: "core.rest", keys: ["r"], label: "x", group: "entry" }] } });
    expect(problems).toEqual(['keybinding "core.rest" must name one of the plugin\'s own commands']);
  });

  it("requires keys, label and group on a keybinding, and id + title on a command", () => {
    const problems = withPatch({
      contributes: {
        commands: [{ id: "battuta.reflection.cycle", title: "" }, { id: "battuta.reflection.cycle", title: "dup" }],
        keybindings: [{ command: "battuta.reflection.cycle", keys: [], label: "", group: "" }],
      },
    });
    expect(problems).toEqual([
      "command battuta.reflection.cycle needs a title",
      "duplicate command id battuta.reflection.cycle",
      "keybinding battuta.reflection.cycle needs a non-empty keys array",
      "keybinding battuta.reflection.cycle needs a label",
      "keybinding battuta.reflection.cycle needs a group",
    ]);
  });
});
