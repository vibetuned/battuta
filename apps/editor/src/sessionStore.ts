/**
 * Crash/close recovery: the open tabs, serialized whole (MEI text,
 * names, disk paths, dirty flags), in one localStorage blob. The app
 * writes it debounced after every edit and once more on beforeunload;
 * on a fresh start the tabs come back exactly as they were — most
 * valuable in the shell, where closing the window is habitual, but the
 * browser build recovers the same way.
 */

export interface StoredDoc {
  name: string;
  path?: string;
  xml: string;
  dirty: boolean;
}

export interface StoredSession {
  docs: StoredDoc[];
  active: number;
}

const STORE = "battuta.session.v1";

export function saveStoredSession(s: StoredSession): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* quota or storage unavailable: recovery simply isn't offered */
  }
}

export function loadStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (!Array.isArray(s.docs) || s.docs.some((d) => typeof d.xml !== "string" || typeof d.name !== "string")) return null;
    return s;
  } catch {
    return null;
  }
}

export function clearStoredSession(): void {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
}
