/**
 * xml:id management. Ids are the universal currency of the system: every
 * event the editor can address must have one. Files from the corpus mostly
 * carry ids already; anything missing gets one on import.
 *
 * Ids are RANDOM (bt- + 8 base36 chars): counter-based enumeration kept
 * re-minting ids already present in files saved by earlier sessions, and
 * no seeding scheme survives every reload/copy path. 36^8 ≈ 2.8e12 makes
 * collisions a non-issue at document scale.
 */
import { CoreElement, childElements } from "./xml.js";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

const cryptoApi = (globalThis as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto;

/** Generate a fresh editor-assigned id (random, collision-negligible). */
export function newId(): string {
  const bytes = new Uint8Array(8);
  if (cryptoApi) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = "bt-";
  for (const b of bytes) out += ALPHABET[b % 36];
  return out;
}

/** Recursively assign xml:id to every element that lacks one. */
export function ensureIds(el: CoreElement): number {
  let assigned = 0;
  if (!el.attrs["xml:id"]) {
    el.attrs["xml:id"] = newId();
    assigned++;
  }
  for (const c of childElements(el)) assigned += ensureIds(c);
  return assigned;
}
