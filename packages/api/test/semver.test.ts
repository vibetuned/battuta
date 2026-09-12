/**
 * satisfiesEngine follows npm's range semantics for the forms plugins
 * will actually write: exact, caret (0.x pins the minor), tilde, the
 * comparison operators, `*`, and space-separated conjunctions.
 */
import { describe, it, expect } from "vitest";
import { parseVersion, satisfiesEngine } from "../src/index";

describe("parseVersion", () => {
  it("reads x.y.z with optional v, prerelease and build", () => {
    expect(parseVersion("0.1.0")).toEqual({ major: 0, minor: 1, patch: 0 });
    expect(parseVersion("v1.2.3-beta.1+build.5")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("latest")).toBeNull();
  });
});

describe("satisfiesEngine", () => {
  it("caret on 0.x pins the minor (npm semantics)", () => {
    expect(satisfiesEngine("^0.1.0", "0.1.0")).toBe(true);
    expect(satisfiesEngine("^0.1.0", "0.1.7")).toBe(true);
    expect(satisfiesEngine("^0.1.0", "0.2.0")).toBe(false);
    expect(satisfiesEngine("^0.1.2", "0.1.1")).toBe(false);
    expect(satisfiesEngine("^0.0.3", "0.0.3")).toBe(true);
    expect(satisfiesEngine("^0.0.3", "0.0.4")).toBe(false);
  });

  it("caret on 1.x pins the major", () => {
    expect(satisfiesEngine("^1.0.0", "1.9.3")).toBe(true);
    expect(satisfiesEngine("^1.0.0", "2.0.0")).toBe(false);
    expect(satisfiesEngine("^1.2.0", "1.1.9")).toBe(false);
  });

  it("tilde pins major.minor", () => {
    expect(satisfiesEngine("~0.1.0", "0.1.9")).toBe(true);
    expect(satisfiesEngine("~0.1.0", "0.2.0")).toBe(false);
  });

  it("exact, operators, star and conjunctions", () => {
    expect(satisfiesEngine("0.1.0", "0.1.0")).toBe(true);
    expect(satisfiesEngine("=0.1.0", "0.1.1")).toBe(false);
    expect(satisfiesEngine(">=0.1.0", "0.3.0")).toBe(true);
    expect(satisfiesEngine(">0.1.0", "0.1.0")).toBe(false);
    expect(satisfiesEngine("<1.0.0", "0.9.9")).toBe(true);
    expect(satisfiesEngine("<=0.1.0", "0.1.1")).toBe(false);
    expect(satisfiesEngine("*", "7.7.7")).toBe(true);
    expect(satisfiesEngine("", "7.7.7")).toBe(true);
    expect(satisfiesEngine(">=0.1.0 <0.3.0", "0.2.5")).toBe(true);
    expect(satisfiesEngine(">=0.1.0 <0.3.0", "0.3.0")).toBe(false);
  });

  it("rejects garbage on either side", () => {
    expect(satisfiesEngine("^0.1.0", "nope")).toBe(false);
    expect(satisfiesEngine("banana", "0.1.0")).toBe(false);
  });
});
