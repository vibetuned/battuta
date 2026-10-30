/**
 * The feed as pure functions: a press as its keys, a note as its name, a
 * repeat folded with a count, a chord folded into one entry, the last few
 * kept, each fading and then gone.
 */
import { describe, it, expect } from "vitest";
import type { KeyPress } from "@battuta/api";
import { CHORD, EMPTY, FADE, LINGER, MAX, REPEAT, addKey, addNote, comboOf, expire, noteName, opacityOf } from "../src/feed";

const press = (key: string, mods: Partial<Pick<KeyPress, "code" | "ctrl" | "alt" | "shift" | "meta">> = {}): KeyPress => ({ key, code: "", ctrl: false, alt: false, shift: false, meta: false, action: null, ...mods });

describe("comboOf", () => {
  it("names the keys, modifiers first, and nothing for a modifier alone", () => {
    expect(comboOf(press("z", { ctrl: true }))).toBe("Ctrl Z");
    expect(comboOf(press("Z", { ctrl: true, shift: true }))).toBe("Ctrl Shift Z");
    expect(comboOf(press("z", { meta: true }))).toBe("Cmd Z");
    expect(comboOf(press("ArrowLeft", { alt: true }))).toBe("Alt ←");
    expect(comboOf(press("4"))).toBe("4");
    expect(comboOf(press(" "))).toBe("Space");
    expect(comboOf(press("Escape"))).toBe("Esc");
    expect(comboOf(press("Shift", { shift: true }))).toBeNull();
    expect(comboOf(press("Control", { ctrl: true }))).toBeNull();
  });

  it("names Shift for a letter and a named key, not for a symbol that already shows it", () => {
    expect(comboOf(press("A", { shift: true }))).toBe("Shift A");
    expect(comboOf(press("Tab", { shift: true }))).toBe("Shift Tab");
    expect(comboOf(press("!", { shift: true }))).toBe("!");
  });

  it("names a key Option composed (macOS) by its physical key, and upper-cases only a–z", () => {
    expect(comboOf(press("ß", { alt: true, code: "KeyB" }))).toBe("Alt B");
    expect(comboOf(press("€", { alt: true, code: "KeyE" }))).toBe("Alt E");
    expect(comboOf(press("Dead", { alt: true, code: "KeyU" }))).toBe("Alt U");
    expect(comboOf(press("¡", { alt: true, code: "Digit1" }))).toBe("Alt 1");
    expect(comboOf(press("⁄", { alt: true, shift: true, code: "Digit1" }))).toBe("Alt Shift 1");
    // Alt that composes nothing (Windows, Linux) keeps the character, layout and all.
    expect(comboOf(press("a", { alt: true, code: "KeyQ" }))).toBe("Alt A");
    expect(comboOf(press("ß", { code: "Minus" }))).toBe("ß");
    expect(comboOf(press("é", { code: "Digit2" }))).toBe("é");
  });
});

describe("noteName", () => {
  it("names a MIDI note with middle C as C4", () => {
    expect([60, 61, 69, 21, 108].map(noteName)).toEqual(["C4", "C♯4", "A4", "A0", "C8"]);
  });
});

describe("the feed", () => {
  it("adds a press with its action, and folds the same press again into a count — not after a while, nor another action", () => {
    let f = addKey(EMPTY, "Ctrl Z", "undo", 1000);
    f = addKey(f, "Ctrl Z", "undo", 1200);
    f = addKey(f, "Ctrl Z", "undo", 1300);
    expect(f.entries.map((e) => [e.text, e.action, e.count])).toEqual([["Ctrl Z", "undo", 3]]);
    f = addKey(f, "Ctrl Z", "undo", 1300 + REPEAT);
    f = addKey(f, "Ctrl Z", null, 1300 + REPEAT + 10);
    expect(f.entries.map((e) => e.count)).toEqual([3, 1, 1]);
  });

  it("folds notes struck together into a chord, and a note later into an entry of its own", () => {
    let f = addNote(EMPTY, "C4", 0);
    f = addNote(f, "E4", 20);
    f = addNote(f, "G4", 40);
    f = addNote(f, "D4", 40 + CHORD);
    expect(f.entries.map((e) => [e.kind, e.text])).toEqual([["midi", "C4 E4 G4"], ["midi", "D4"]]);
    expect(addNote(addKey(EMPTY, "A", null, 0), "C4", 5).entries.map((e) => e.kind)).toEqual(["key", "midi"]);
  });

  it("keeps the last few, fades each over its last moments, then drops it", () => {
    let f = EMPTY;
    for (let i = 0; i < MAX + 3; i++) f = addKey(f, `K${i}`, null, i * REPEAT);
    expect(f.entries.map((e) => e.text)).toEqual(Array.from({ length: MAX }, (_, i) => `K${i + 3}`));
    const one = addKey(EMPTY, "A", null, 0);
    const e = one.entries[0]!;
    expect(opacityOf(e, 0)).toBe(1);
    expect(opacityOf(e, LINGER - FADE / 2)).toBeCloseTo(0.5);
    expect(expire(one, LINGER - 1).entries).toHaveLength(1);
    expect(expire(one, LINGER).entries).toHaveLength(0);
  });
});
