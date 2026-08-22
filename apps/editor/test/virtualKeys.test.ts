/**
 * The virtual keyboard must never fall behind the keymap. These tests
 * hold virtualKeys.ts against defaultKeymap() in BOTH layouts:
 *
 *  - coverage: every keymap action is reachable from the panel
 *    (generated button, hand-listed physical button, or the piano);
 *  - honesty: the panel references only actions that exist;
 *  - round-trip: the event a button synthesizes actually triggers its
 *    binding through keyMatches;
 *  - event shapes: physical-code and ctrl-chord buttons synthesize the
 *    exact fields the App's keydown handler matches on.
 */
import { describe, it, expect } from "vitest";
import { defaultKeymap, keyMatches, type Layout } from "../src/keymap";
import { generatedKeys, physicalKeys, coveredIds, eventForSpec, displayLabel, PIANO_COVERS, EXTRA_IDS, DIGIT_PAD_ID, DIGIT_PAD_COVERS, MOD_VARIANTS } from "../src/virtualKeys";

const LAYOUTS: Layout[] = ["qwerty", "azerty"];

describe("coverage", () => {
  for (const layout of LAYOUTS) {
    it(`every ${layout} keymap action is on the virtual keyboard`, () => {
      const keymap = defaultKeymap(layout);
      const covered = coveredIds(keymap);
      const missing = Object.keys(keymap).filter((id) => !covered.has(id));
      // A new keymap action must get a button: rebindable ones appear on
      // their own (generatedKeys); locked/physical ones need an entry in
      // physicalKeys() or PIANO_COVERS in virtualKeys.ts.
      expect(missing).toEqual([]);
    });
  }

  it("panel ids all exist in the keymap (or EXTRA_IDS / the digit pad)", () => {
    for (const layout of LAYOUTS) {
      const known = new Set([...Object.keys(defaultKeymap(layout)), ...EXTRA_IDS, DIGIT_PAD_ID]);
      for (const spec of [...generatedKeys(defaultKeymap(layout)), ...physicalKeys()]) {
        expect(known.has(spec.id), `spec "${spec.label}" references unknown action "${spec.id}"`).toBe(true);
      }
    }
  });

  it("PIANO_COVERS and DIGIT_PAD_COVERS name real keymap actions", () => {
    const ids = Object.keys(defaultKeymap("qwerty"));
    expect(PIANO_COVERS).toContain("pitches");
    for (const id of [...PIANO_COVERS, ...DIGIT_PAD_COVERS]) expect(ids, `covers unknown action "${id}"`).toContain(id);
  });
});

describe("round-trip: synthesized events trigger their bindings", () => {
  for (const layout of LAYOUTS) {
    it(`${layout}: every generated button keyMatches its own binding`, () => {
      const keymap = defaultKeymap(layout);
      for (const spec of generatedKeys(keymap)) {
        const ev = eventForSpec(spec, undefined, layout);
        expect(keyMatches(keymap[spec.id], ev), `"${spec.id}" button (key ${JSON.stringify(ev)}) misses its binding`).toBe(true);
      }
    });
  }
});

describe("modifier variants: latching on the base button reaches the variant", () => {
  for (const layout of LAYOUTS) {
    it(`${layout}: every MOD_VARIANTS entry round-trips through its base`, () => {
      const keymap = defaultKeymap(layout);
      const panel = [...generatedKeys(keymap), ...physicalKeys()];
      for (const [variantId, v] of Object.entries(MOD_VARIANTS)) {
        const target = keymap[variantId];
        expect(target, `variant "${variantId}" is not a keymap action`).toBeDefined();
        const bases = panel.filter((s) => s.id === v.of && (!v.keys || v.keys.includes(s.key)));
        expect(bases.length, `variant "${variantId}" has no base button "${v.of}"`).toBeGreaterThan(0);
        const mods = { shift: v.mods.shift ?? false, alt: v.mods.alt ?? false, ctrl: false };
        for (const base of bases) {
          const ev = eventForSpec(base, mods, layout);
          if (target!.locked) {
            // locked bindings never keyMatch — pin the raw event shape
            expect(ev.shiftKey).toBe(mods.shift);
            expect(ev.altKey).toBe(mods.alt);
          } else {
            expect(keyMatches(target, ev), `latch ${JSON.stringify(v.mods)} on "${v.of}" ("${base.key}" → "${ev.key}") misses "${variantId}" on ${layout}`).toBe(true);
          }
        }
      }
    });
  }

  it("variants have no button of their own (the latch IS the button)", () => {
    for (const layout of LAYOUTS) {
      const panel = [...generatedKeys(defaultKeymap(layout)), ...physicalKeys()];
      for (const variantId of Object.keys(MOD_VARIANTS)) {
        expect(panel.some((s) => s.id === variantId), `"${variantId}" still has a dedicated button`).toBe(false);
      }
    }
  });
});

describe("live relabelling under latches", () => {
  const keymap = defaultKeymap("qwerty");
  const panel = [...generatedKeys(keymap), ...physicalKeys()];
  const spec = (id: string, key?: string) => panel.find((s) => s.id === id && (key === undefined || s.key === key))!;
  const S = { shift: true, alt: false, ctrl: false };
  const A = { shift: false, alt: true, ctrl: false };
  const C = { shift: false, alt: false, ctrl: true };

  it("shift shows the shifted action on its base key", () => {
    expect(displayLabel(spec("staccato"), S, keymap)).toBe("stacc ▾");
    expect(displayLabel(spec("accent"), S, keymap)).toBe("marc ^");
    expect(displayLabel(spec("simile"), S, keymap)).toBe("%");
    expect(displayLabel(spec("tie"), S, keymap)).toBe("tuplet");
    expect(displayLabel(spec("sharp"), S, keymap)).toBe("slur 𝄪");
    expect(displayLabel(spec("dynamics"), S, keymap)).toBe("ped");
  });

  it("digit pad relabels: voltas under shift, fingering under alt", () => {
    expect(displayLabel(spec(DIGIT_PAD_ID, "3"), S, keymap)).toBe("volta 3");
    expect(displayLabel(spec(DIGIT_PAD_ID, "3"), A, keymap)).toBe("f3");
    expect(displayLabel(spec(DIGIT_PAD_ID, "8"), A, keymap)).toBe("→3");
    expect(displayLabel(spec(DIGIT_PAD_ID, "0"), S, keymap)).toBe("0"); // there is no volta 0
  });

  it("arrows become duration steps under alt; unaffected keys keep their caption", () => {
    expect(displayLabel(spec("navigation", "ArrowRight"), A, keymap)).toBe("dur +");
    expect(displayLabel(spec("navigation", "ArrowLeft"), A, keymap)).toBe("dur −");
    expect(displayLabel(spec("navigation", "ArrowUp"), A, keymap)).toBe("↑");
    expect(displayLabel(spec("flat"), S, keymap)).toBe("♭");
    expect(displayLabel(spec("tie"), C, keymap)).toBe("tie");
  });
});

describe("physical event shapes (what App.tsx matches on)", () => {
  const byId = (id: string) => physicalKeys().filter((s) => s.id === id);

  it("digit pad: ten buttons rendering 1–5 over 6–0, e.key + physical code, no baked modifiers", () => {
    const pad = byId(DIGIT_PAD_ID);
    expect(pad).toHaveLength(10);
    // Column-flow grid over two rows: this spec order IS the row layout.
    expect(pad.map((s) => s.key).join("")).toBe("1627384950");
    for (const s of pad) {
      const ev = eventForSpec(s);
      expect(ev.code).toBe(`Digit${s.key}`);
      expect([ev.shiftKey, ev.altKey, ev.ctrlKey]).toEqual([false, false, false]);
    }
  });

  it("digit pad latches: plain 1–7 = duration, shift = volta, alt = fingering / finger change", () => {
    const pad = byId(DIGIT_PAD_ID);
    // Plain press: e.key 1–7 is what the duration path matches.
    expect(pad.filter((s) => /^[1-7]$/.test(eventForSpec(s).key))).toHaveLength(7);
    // Shift latch: the volta path wants shiftKey + physical Digit1–9.
    const volta = eventForSpec(pad.find((s) => s.key === "2")!, { shift: true, alt: false, ctrl: false });
    expect(volta.shiftKey).toBe(true);
    expect(volta.code).toMatch(/^Digit[1-9]$/);
    // Alt latch: fingering rides Digit1–5, finger change Digit6–0.
    const fing = eventForSpec(pad.find((s) => s.key === "5")!, { shift: false, alt: true, ctrl: false });
    expect([fing.altKey, fing.code]).toEqual([true, "Digit5"]);
    const change = eventForSpec(pad.find((s) => s.key === "0")!, { shift: false, alt: true, ctrl: false });
    expect([change.altKey, change.code]).toEqual([true, "Digit0"]);
    // Alt+shift latch: additive fingering keeps both flags.
    const add = eventForSpec(pad.find((s) => s.key === "3")!, { shift: true, alt: true, ctrl: false });
    expect([add.altKey, add.shiftKey]).toEqual([true, true]);
  });

  it("structural: numpad codes the handler requires", () => {
    expect(byId("structural").map((s) => s.code).sort()).toEqual(["NumpadAdd", "NumpadMultiply", "NumpadSubtract"]);
  });

  it("system chords set ctrlKey", () => {
    const sys = byId("system");
    expect(sys.length).toBeGreaterThanOrEqual(7); // save open undo redo copy paste zoom…
    for (const s of sys) expect(eventForSpec(s).ctrlKey).toBe(true);
  });

  it("navigation and paging use the exact e.key names", () => {
    expect(byId("navigation").map((s) => s.key).sort()).toEqual(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"]);
    expect(byId("rowNavigation").map((s) => s.key).sort()).toEqual(["End", "Home", "PageDown", "PageUp"]);
  });
});

describe("modifier latches", () => {
  const nav = physicalKeys().find((s) => s.id === "navigation" && s.key === "ArrowRight")!;

  it("latched shift rides on arrows (selection extension)", () => {
    expect(eventForSpec(nav, { shift: true, alt: false, ctrl: false }).shiftKey).toBe(true);
    expect(eventForSpec(nav).shiftKey).toBe(false);
  });

  it("latched shift uppercases a plain letter, like a real keyboard", () => {
    const keymap = defaultKeymap("qwerty");
    const tie = generatedKeys(keymap).find((s) => s.id === "tie")!;
    const ev = eventForSpec(tie, { shift: true, alt: false, ctrl: false });
    expect(ev.key).toBe("T");
    expect(ev.shiftKey).toBe(true);
    // …which lands on the TUPLET binding, exactly as shift+t would.
    expect(keyMatches(keymap["tuplet"], ev)).toBe(true);
  });

  it("latched shift does NOT re-case ctrl chords (save-as stays ctrl+shift+s)", () => {
    const save = physicalKeys().find((s) => s.id === "system" && s.label === "save")!;
    const ev = eventForSpec(save, { shift: true, alt: false, ctrl: false });
    expect(ev.key).toBe("s");
    expect(ev.shiftKey).toBe(true);
    expect(ev.ctrlKey).toBe(true);
  });

  it("an uppercase-letter binding synthesizes a real shifted press", () => {
    // No default binding needs this any more (they all became latch
    // variants), but a REBOUND action can land on an uppercase key.
    const ev = eventForSpec({ id: "x", label: "x", key: "Q", group: "entry", title: "" });
    expect(ev.key).toBe("Q");
    expect(ev.shiftKey).toBe(true);
  });

  it("latched shift follows the layout's punctuation (staccato → staccatissimo)", () => {
    const S = { shift: true, alt: false, ctrl: false };
    const qw = generatedKeys(defaultKeymap("qwerty")).find((s) => s.id === "staccato")!;
    expect(eventForSpec(qw, S, "qwerty").key).toBe("<");
    const az = generatedKeys(defaultKeymap("azerty")).find((s) => s.id === "staccato")!;
    expect(eventForSpec(az, S, "azerty").key).toBe("?");
  });
});
