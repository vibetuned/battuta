/**
 * The panel must never fall behind the keymap — the coverage suite that
 * lived in `apps/editor/test/virtualKeys.test.ts` until slice 4b, moved
 * here and pointed at the UNION keymap (core ∪ every shipped plugin's
 * contributions, merged by the host's own store, in BOTH layouts). An
 * unreachable binding from ANY plugin now fails CI, not just a core one.
 *
 * What changed with the move, beyond the union: the old suite round-tripped
 * each button's synthesized KeyboardEvent through `keyMatches`, because a
 * button WAS a key press. A button is now an ACTION ID, so the questions
 * are different:
 *
 *   - coverage: every keymap row is reachable from the panel;
 *   - honesty: the panel names no row that does not exist, and captions no
 *     latch it cannot run (`runnable`);
 *   - shape: each locked row's buttons name the right action ids.
 *
 * The one question a unit test CANNOT answer is whether those ids are the
 * ids the App actually installed: the action table is built inside
 * App.tsx's effect, so `ctx.actions.ids` holds only plugin ids here. See BUILDING.md
 * §6 and §7.4 — the browser script is what closes that loop.
 */
import { describe, it, expect } from "vitest";
import type { KeymapEntry } from "@battuta/api";
import { createHost, memorySettings, type Host } from "../../../../apps/editor/src/host";
import { memoryStorage } from "../../../../apps/editor/src/host/services";
import { BUILTIN_PLUGINS } from "../../../../apps/editor/src/host/plugins";
import { actionFor, actionIds, coveredIds, digitAction, displayLabel, DIGIT_PAD_COVERS, DIGIT_PAD_ID, EXTRA_IDS, generatedKeys, MOD_VARIANTS, NO_MODS, panelKeys, physicalKeys, PIANO_COVERS, variantFor } from "../src/keys";

type Layout = "qwerty" | "azerty";
const LAYOUTS: Layout[] = ["qwerty", "azerty"];

/** The keymap exactly as a plugin sees it: the host's own union view. */
function union(layout: Layout): readonly KeymapEntry[] {
  const host: Host = createHost({ layout, plugins: BUILTIN_PLUGINS, settings: memorySettings(), storage: memoryStorage(), confirm: async () => true });
  return host.keymapView.get();
}

const S = { shift: true, alt: false };
const A = { shift: false, alt: true };
const AS = { shift: true, alt: true };

/** Stands in for the host's table: everything is runnable unless a test says otherwise. */
const ALL = () => true;

describe("coverage", () => {
  for (const layout of LAYOUTS) {
    it(`every ${layout} keymap row — core and contributed — is on the panel`, () => {
      const keymap = union(layout);
      const covered = coveredIds(keymap);
      const missing = keymap.map((e) => e.id).filter((id) => !covered.has(id));
      // A new action must get a button: rebindable rows appear on their
      // own (generatedKeys), locked ones need an entry in physicalKeys(),
      // PIANO_COVERS, DIGIT_PAD_COVERS or MOD_VARIANTS.
      expect(missing).toEqual([]);
    });
  }

  it("the union really does carry a plugin's binding (or this suite proves nothing)", () => {
    expect(union("qwerty").some((e) => e.plugin !== undefined)).toBe(true);
  });

  it("panel ids all exist in the keymap (or are EXTRA_IDS / the digit pad)", () => {
    for (const layout of LAYOUTS) {
      const keymap = union(layout);
      const known = new Set<string>([...keymap.map((e) => e.id), ...EXTRA_IDS, DIGIT_PAD_ID]);
      for (const spec of panelKeys(keymap)) {
        expect(known.has(spec.id), `button "${spec.label}" references unknown row "${spec.id}"`).toBe(true);
      }
    }
  });

  it("PIANO_COVERS and DIGIT_PAD_COVERS name real keymap rows", () => {
    const ids = union("qwerty").map((e) => e.id);
    expect(PIANO_COVERS).toContain("pitches");
    for (const id of [...PIANO_COVERS, ...DIGIT_PAD_COVERS]) expect(ids, `covers unknown row "${id}"`).toContain(id);
  });

  it("every button names a non-empty action id, and no two buttons of a row share one", () => {
    const keymap = union("qwerty");
    for (const spec of panelKeys(keymap)) {
      if (spec.id === DIGIT_PAD_ID) continue; // its action depends on the latch
      expect(spec.action, `button "${spec.label}" has no action`).toBeTruthy();
      for (const v of spec.variants ?? []) expect(v.action, `a variant of "${spec.label}" has no action`).toBeTruthy();
    }
    const system = physicalKeys().filter((s) => s.id === "system");
    expect(new Set(system.map((s) => s.action)).size).toBe(system.length);
  });
});

describe("the actions the panel can run", () => {
  const keymap = union("qwerty");
  const ids = actionIds(keymap);

  it("a rebindable row's id IS the action it runs — no table in between", () => {
    for (const spec of generatedKeys(keymap)) expect(spec.action).toBe(spec.id);
  });

  it("the locked rows name the host's ids, not their row", () => {
    const by = (label: string) => physicalKeys().find((s) => s.label === label)!;
    expect(by("save").action).toBe("file.save");
    expect(by("undo").action).toBe("undo");
    expect(by("paste").action).toBe("clipboard.paste");
    expect(by("z0").action).toBe("zoom.reset");
    expect(by("+m").action).toBe("measure.insert");
    expect(by("←").action).toBe("nav.left");
    expect(by("pg↓").action).toBe("nav.pageDown");
    expect(by("del").action).toBe("edit.delete");
    expect(by("esc").action).toBe("edit.escape");
  });

  it("every id belongs to a family packages/api/src/actions.ts documents", () => {
    // A cheap guard against a typo'd id — the real check is the browser
    // (BUILDING.md §7.4). Rebindable ids are keymap rows; the rest must
    // look like one of the host's locked families.
    const rows = new Set(keymap.map((e) => e.id));
    const LOCKED =
      /^(undo|redo|zoom\.(in|out|reset)|file\.(save|saveAs|open)|clipboard\.(copy|paste)|measure\.(insert|delete|duplicate)|entry\.toggle|volta\.[1-9]|finger\.(add\.)?[1-5]|fingerChange\.[1-5]|duration\.([1-7]|shorter|longer)|pitch\.[a-g]|chord\.[a-g]|dynamic\.[fp]|nav\.(left|right|up|down|home|end|pageUp|pageDown)|select\.(left|right)|transpose\.(up|down|octaveUp|octaveDown)|edit\.(delete|backspace|escape))$/;
    const strays = [...ids].filter((id) => !rows.has(id) && !LOCKED.test(id));
    expect(strays).toEqual([]);
  });

  it("a button whose action the host does not know is not rendered and does not run", () => {
    const tie = generatedKeys(keymap).find((s) => s.id === "tie")!;
    expect(actionFor(tie, NO_MODS, keymap, ALL)).toBe("tie");
    expect(actionFor(tie, NO_MODS, keymap, (a) => a !== "tie")).toBeNull();
  });
});

describe("the digit pad: one pad, four meanings", () => {
  it("plain 1–7 are durations; 8, 9 and 0 set none", () => {
    expect(digitAction("4", NO_MODS)).toBe("duration.4");
    expect(digitAction("7", NO_MODS)).toBe("duration.7");
    for (const d of ["8", "9", "0"]) expect(digitAction(d, NO_MODS)).toBeNull();
  });

  it("shift is volta 1–9, and there is no volta 0", () => {
    expect(digitAction("3", S)).toBe("volta.3");
    expect(digitAction("9", S)).toBe("volta.9");
    expect(digitAction("0", S)).toBeNull();
  });

  it("alt is fingering 1–5 (shift adds) and finger change on 6–0", () => {
    expect(digitAction("5", A)).toBe("finger.5");
    expect(digitAction("5", AS)).toBe("finger.add.5");
    expect(digitAction("8", A)).toBe("fingerChange.3");
    // The App's fingerChange rule ignores shift, so alt+shift+6–0 is one too.
    expect(digitAction("0", AS)).toBe("fingerChange.5");
  });

  it("ten buttons, rendering 1–5 over 6–0 in a column-flow grid", () => {
    const pad = physicalKeys().filter((s) => s.id === DIGIT_PAD_ID);
    expect(pad).toHaveLength(10);
    expect(pad.map((s) => s.key).join("")).toBe("1627384950");
  });
});

describe("modifier variants: latching on the base button reaches the variant", () => {
  for (const layout of LAYOUTS) {
    it(`${layout}: every MOD_VARIANTS row has a base button that runs it`, () => {
      const keymap = union(layout);
      const panel = panelKeys(keymap);
      for (const [row, v] of Object.entries(MOD_VARIANTS)) {
        expect(keymap.some((e) => e.id === row), `variant "${row}" is not a keymap row`).toBe(true);
        const bases = panel.filter((s) => s.id === v.of && (!v.keys || (s.key !== undefined && v.keys.includes(s.key))));
        expect(bases.length, `variant "${row}" has no base button "${v.of}"`).toBeGreaterThan(0);
        const mods = { shift: v.mods.shift ?? false, alt: v.mods.alt ?? false };
        for (const base of bases) {
          const chosen = variantFor(base, mods);
          expect(chosen?.row, `latch ${JSON.stringify(v.mods)} on "${v.of}" does not select "${row}"`).toBe(row);
          expect(actionFor(base, mods, keymap, ALL), `"${row}" runs nothing from "${base.label}"`).toBeTruthy();
        }
      }
    });
  }

  it("variants have no button of their own (the latch IS the button)", () => {
    for (const layout of LAYOUTS) {
      const panel = panelKeys(union(layout));
      for (const row of Object.keys(MOD_VARIANTS)) {
        expect(panel.some((s) => s.id === row), `"${row}" still has a dedicated button`).toBe(false);
      }
    }
  });

  it("the arrows carry the selection and transpose variants the App binds", () => {
    const keymap = union("qwerty");
    const arrow = (key: string) => physicalKeys().find((s) => s.id === "navigation" && s.key === key)!;
    expect(actionFor(arrow("ArrowLeft"), S, keymap, ALL)).toBe("select.left");
    expect(actionFor(arrow("ArrowRight"), S, keymap, ALL)).toBe("select.right");
    expect(actionFor(arrow("ArrowLeft"), A, keymap, ALL)).toBe("duration.shorter");
    expect(actionFor(arrow("ArrowRight"), A, keymap, ALL)).toBe("duration.longer");
    expect(actionFor(arrow("ArrowUp"), A, keymap, ALL)).toBe("transpose.up");
    expect(actionFor(arrow("ArrowDown"), AS, keymap, ALL)).toBe("transpose.octaveDown");
    // Plain ↑ is still voice/line navigation.
    expect(actionFor(arrow("ArrowUp"), NO_MODS, keymap, ALL)).toBe("nav.up");
  });

  it("shift on the save chord is save-as", () => {
    const keymap = union("qwerty");
    const save = physicalKeys().find((s) => s.label === "save")!;
    expect(actionFor(save, S, keymap, ALL)).toBe("file.saveAs");
  });

  it("a latch with no variant does nothing — as a shifted press did in 0.0.3", () => {
    const keymap = union("qwerty");
    const flat = generatedKeys(keymap).find((s) => s.id === "flat")!;
    expect(actionFor(flat, S, keymap, ALL)).toBeNull();
    expect(displayLabel(flat, S, keymap, ALL)).toBe(flat.label);
  });
});

describe("live relabelling under latches", () => {
  const keymap = union("qwerty");
  const panel = panelKeys(keymap);
  const spec = (id: string, key?: string) => panel.find((s) => s.id === id && (key === undefined || s.key === key))!;

  it("shift shows the shifted action on its base key", () => {
    expect(displayLabel(spec("staccato"), S, keymap, ALL)).toBe("stacc ▾");
    expect(displayLabel(spec("accent"), S, keymap, ALL)).toBe("marc ^");
    expect(displayLabel(spec("simile"), S, keymap, ALL)).toBe("%");
    expect(displayLabel(spec("tie"), S, keymap, ALL)).toBe("tuplet");
    expect(displayLabel(spec("sharp"), S, keymap, ALL)).toBe("slur 𝄪");
    expect(displayLabel(spec("dynamics"), S, keymap, ALL)).toBe("ped");
    expect(displayLabel(spec("inputMode"), S, keymap, ALL)).toBe("sfz");
  });

  it("digit pad relabels: voltas under shift, fingering under alt", () => {
    expect(displayLabel(spec(DIGIT_PAD_ID, "3"), S, keymap, ALL)).toBe("volta 3");
    expect(displayLabel(spec(DIGIT_PAD_ID, "3"), A, keymap, ALL)).toBe("f3");
    expect(displayLabel(spec(DIGIT_PAD_ID, "8"), A, keymap, ALL)).toBe("→3");
    expect(displayLabel(spec(DIGIT_PAD_ID, "0"), S, keymap, ALL)).toBe("0"); // there is no volta 0
  });

  it("arrows become duration steps under alt; unaffected keys keep their caption", () => {
    expect(displayLabel(spec("navigation", "ArrowRight"), A, keymap, ALL)).toBe("dur +");
    expect(displayLabel(spec("navigation", "ArrowLeft"), A, keymap, ALL)).toBe("dur −");
    expect(displayLabel(spec("navigation", "ArrowUp"), A, keymap, ALL)).toBe("↑");
    expect(displayLabel(spec("flat"), S, keymap, ALL)).toBe("♭");
  });

  it("a variant the live keymap does not carry keeps its base caption", () => {
    // The reflection cycle is a PLUGIN binding: with that plugin off it
    // leaves the keymap store, so the shifted rest key must stop
    // advertising "reflect" — a caption for a key that does nothing is
    // what the first attempt at slice 2 shipped.
    const core = keymap.filter((e) => e.plugin === undefined);
    expect(displayLabel(spec("rest"), S, core, ALL)).toBe(spec("rest").label);
  });
});

describe("a plugin's binding, captioned and run like any other", () => {
  // Until api 0.1.3 this was the slice's open gap: the panel could see the
  // reflection cycle in the union keymap and `ctx.actions.run` would not
  // carry it, so the caption had to be withheld. `run(id)` now means *this
  // action* — a plugin's command is reachable by id exactly when its key
  // would have been — and the two halves below are what that bought.
  const keymap = union("qwerty");
  const rest = panelKeys(keymap).find((s) => s.id === "rest")!;
  /** What the host answers with the reflection plugin enabled. */
  const enabled = () => true;
  /** …and with it off: its command leaves `ctx.actions.ids` with its binding. */
  const disabled = (action: string) => !action.startsWith("battuta.reflection.");

  it("the union keymap carries it, and the shift latch on rest selects it", () => {
    expect(keymap.some((e) => e.id === "battuta.reflection.cycle")).toBe(true);
    expect(variantFor(rest, S)?.action).toBe("battuta.reflection.cycle");
  });

  it("with the plugin on it is captioned and runnable", () => {
    expect(displayLabel(rest, S, keymap, enabled)).toBe("reflect");
    expect(actionFor(rest, S, keymap, enabled)).toBe("battuta.reflection.cycle");
  });

  it("with the plugin off both go: no caption for a key that does nothing", () => {
    // Both halves of `reachable` fire here, and either alone would do —
    // the binding leaves the keymap AND the command leaves the id list.
    const core = keymap.filter((e) => e.plugin === undefined);
    expect(displayLabel(rest, S, core, disabled)).toBe(rest.label);
    expect(actionFor(rest, S, core, disabled)).toBeNull();
    expect(actionFor(rest, S, keymap, disabled)).toBeNull();
  });
});
