/**
 * Crash/close recovery storage: round-trips, and never lets a corrupt
 * blob poison startup.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { saveStoredSession, loadStoredSession, clearStoredSession, type StoredSession } from "../src/sessionStore";

// node env: a minimal localStorage
const backing = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, v),
  removeItem: (k: string) => void backing.delete(k),
};

beforeEach(() => backing.clear());

const session: StoredSession = {
  docs: [
    { name: "sonata", path: "/scores/sonata.mei", xml: "<mei/>", dirty: true },
    { name: "untitled-1", xml: "<mei/>", dirty: false },
  ],
  active: 1,
};

describe("session store", () => {
  it("round-trips docs, paths, dirty flags, and the active index", () => {
    saveStoredSession(session);
    expect(loadStoredSession()).toEqual(session);
  });

  it("clear removes it", () => {
    saveStoredSession(session);
    clearStoredSession();
    expect(loadStoredSession()).toBe(null);
  });

  it("returns null when nothing is stored", () => {
    expect(loadStoredSession()).toBe(null);
  });

  it("rejects corrupt or wrong-shape blobs instead of throwing", () => {
    backing.set("battuta.session.v1", "{not json");
    expect(loadStoredSession()).toBe(null);
    backing.set("battuta.session.v1", JSON.stringify({ docs: [{ name: 1, xml: 2 }], active: 0 }));
    expect(loadStoredSession()).toBe(null);
    backing.set("battuta.session.v1", JSON.stringify({ docs: "nope", active: 0 }));
    expect(loadStoredSession()).toBe(null);
  });
});
