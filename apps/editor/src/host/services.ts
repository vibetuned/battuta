/**
 * Host services behind the plugin context: notices, the per-plugin
 * settings namespace (inside the editor's settings blob, so it travels
 * with layout/zoom/etc.), the per-plugin storage namespace (its own web
 * storage key, for anything larger), and the enabled flag the Plugins
 * tab persists. Everything takes its backing store as a parameter so
 * the host runs in tests without a browser.
 */
import type { SettingsNamespace, StorageNamespace } from "@battuta/api";
import { loadSettings, saveSettings, type Settings } from "../settings";

export interface Notice {
  text: string;
  /** Monotonic, so the same text twice still notifies. */
  seq: number;
}

export interface SettingsIO {
  load(): Settings;
  save(patch: Partial<Settings>): void;
}

export const webSettings: SettingsIO = { load: loadSettings, save: saveSettings };

export function memorySettings(initial: Settings = {}): SettingsIO {
  let s = initial;
  return {
    load: () => s,
    save: (patch) => {
      s = { ...s, ...patch };
    },
  };
}

/** A plugin is on unless the user turned it off. */
export const isPluginEnabled = (io: SettingsIO, id: string): boolean => io.load().plugins?.[id]?.enabled ?? true;

export function setPluginEnabled(io: SettingsIO, id: string, on: boolean): void {
  const all = io.load().plugins ?? {};
  io.save({ plugins: { ...all, [id]: { ...(all[id] ?? {}), enabled: on } } });
}

export function pluginSettings(io: SettingsIO, id: string): SettingsNamespace {
  return {
    get<T>(key: string): T | undefined {
      return io.load().plugins?.[id]?.values?.[key] as T | undefined;
    },
    set(key: string, value: unknown): void {
      const all = io.load().plugins ?? {};
      const mine = all[id] ?? {};
      io.save({ plugins: { ...all, [id]: { ...mine, values: { ...(mine.values ?? {}), [key]: value } } } });
    },
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** localStorage when the platform has it (and allows it), memory otherwise. */
export function webStorage(): StorageLike {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* access denied: fall through */
  }
  return memoryStorage();
}

export function pluginStorage(backing: StorageLike, id: string): StorageNamespace {
  const KEY = `battuta.plugin.${id}.v1`;
  const read = (): Record<string, unknown> => {
    try {
      const raw = backing.getItem(KEY);
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const write = (obj: Record<string, unknown>): void => {
    try {
      backing.setItem(KEY, JSON.stringify(obj));
    } catch {
      /* quota or storage unavailable: the value lives for this session only */
    }
  };
  return {
    get<T>(key: string): T | undefined {
      return read()[key] as T | undefined;
    },
    set(key, value) {
      write({ ...read(), [key]: value });
    },
    remove(key) {
      const o = read();
      delete o[key];
      write(o);
    },
    clear() {
      try {
        backing.removeItem(KEY);
      } catch {
        /* ignore */
      }
    },
  };
}
