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
    expect(withPatch({ capabilities: ["midi", "workspace", "audio"] })).toEqual([]);
    expect(withPatch({ capabilities: ["playback"] })).toEqual(['unknown capability "playback"']); // reserved once, replaced by "audio" in slice 7a
    expect(withPatch({ capabilities: ["network"] })).toEqual(['unknown capability "network"']);
  });

  it("validates declared lanes: id, label, name, place; unique ids", () => {
    const ok = withPatch({ contributes: { lanes: [{ id: "battuta.lyrics.verse1", label: "lyrics (verse 1, l)", name: "lyrics", glyph: "♪", place: "below" }] } });
    expect(ok).toEqual([]);
    const problems = withPatch({
      contributes: {
        lanes: [
          { id: "battuta.lyrics.verse1", label: "", name: "lyrics", place: "sideways" },
          { id: "battuta.lyrics.verse1", label: "again", name: "", place: "above" },
          { id: "", label: "x", name: "x", place: "below" },
        ],
      },
    } as never);
    expect(problems).toEqual([
      "lane battuta.lyrics.verse1 needs a label",
      'lane battuta.lyrics.verse1 needs a place of above or below (got "sideways")',
      "duplicate lane id battuta.lyrics.verse1",
      "lane battuta.lyrics.verse1 needs a name",
      "every lane needs an id",
    ]);
  });

  it("validates declared exports: id, label, a dotless ext, a mime type, no duplicates", () => {
    expect(withPatch({ contributes: { exports: [{ id: "battuta.x.midi", label: "playback MIDI", ext: "mid", mime: "audio/midi" }] } })).toEqual([]);
    expect(
      withPatch({
        contributes: {
          exports: [
            { id: "", label: "a", ext: "mid", mime: "audio/midi" },
            { id: "battuta.x.a", label: "", ext: ".mid", mime: "midi" },
            { id: "battuta.x.a", label: "dup", ext: "mid", mime: "audio/midi" },
          ],
        },
      }),
    ).toEqual(["every export needs an id", "export battuta.x.a needs a label", "export battuta.x.a needs an ext (letters and digits, no dot)", "export battuta.x.a needs a mime type", "duplicate export id battuta.x.a"]);
  });

  it("validates declared imports: id, label, lowercase alnum exts, optional roots, no duplicates", () => {
    expect(withPatch({ contributes: { imports: [{ id: "battuta.x.musicxml", label: "MusicXML", exts: ["musicxml", "xml"], roots: ["score-partwise", "score-timewise"] }, { id: "battuta.x.mxl", label: "compressed MusicXML", exts: ["mxl"], binary: true }] } })).toEqual([]);
    expect(
      withPatch({
        contributes: {
          imports: [
            { id: "", label: "a", exts: ["abc"] },
            { id: "battuta.x.a", label: "", exts: [] },
            { id: "battuta.x.a", label: "dup", exts: [".ABC"], roots: [1] },
          ],
        },
      }),
    ).toEqual(["every import needs an id", "import battuta.x.a needs a label", "import battuta.x.a needs a non-empty exts array", "duplicate import id battuta.x.a", "import battuta.x.a: exts must be lowercase letters and digits, no dot (got \".ABC\")", "import battuta.x.a: roots must be element names"]);
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
