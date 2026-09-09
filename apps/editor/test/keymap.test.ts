/**
 * keyMatches' macOS guarantee: Option+letter arrives as a composed
 * symbol (alt+r = "®", alt+b = "∫"), so alt bindings on plain letters
 * must ALSO match the physical key code — without loosening anything
 * for non-alt bindings.
 */
import { describe, it, expect } from "vitest";
import { defaultKeymap, keyMatches } from "../src/keymap";

const km = defaultKeymap("qwerty");

describe("keyMatches on macOS alt composition", () => {
  it("alt bindings match the composed character by physical code", () => {
    expect(keyMatches(km["repeatBarlines"], { key: "®", shiftKey: false, altKey: true, code: "KeyR" })).toBe(true);
    expect(keyMatches(km["beam"], { key: "∫", shiftKey: false, altKey: true, code: "KeyB" })).toBe(true);
  });

  it("the plain e.key path still works (Windows/Linux alt+r)", () => {
    expect(keyMatches(km["repeatBarlines"], { key: "r", shiftKey: false, altKey: true, code: "KeyR" })).toBe(true);
  });

  it("the code fallback never fires without alt, or on the wrong key", () => {
    // plain r is REST, not repeat — code must not bypass the alt gate
    expect(keyMatches(km["repeatBarlines"], { key: "r", shiftKey: false, altKey: false, code: "KeyR" })).toBe(false);
    expect(keyMatches(km["rest"], { key: "®", shiftKey: false, altKey: true, code: "KeyR" })).toBe(false);
    expect(keyMatches(km["repeatBarlines"], { key: "†", shiftKey: false, altKey: true, code: "KeyT" })).toBe(false);
  });

  it("non-letter and non-alt bindings are untouched by codes", () => {
    expect(keyMatches(km["staccato"], { key: ",", shiftKey: false, altKey: false, code: "Comma" })).toBe(true);
    expect(keyMatches(km["staccato"], { key: "≤", shiftKey: false, altKey: true, code: "Comma" })).toBe(false);
  });
});
