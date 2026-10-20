/**
 * The tablets' file paths (phase 10, M1), loaded on first use from the
 * App's open, save and export flows — this code and the dialog and fs
 * plugins never reach the startup bundle, the desktop's or the browser's.
 *
 * A tablet has no file system to browse the way a desktop does: battuta
 * keeps its scores in its own folder — the app's Documents, which the
 * shell hands out as the folder (`workspace_pick_folder`) and the Files
 * app shows as "On My iPad › battuta" — and goes through the OS for
 * everything outside it: the document picker to bring a score in, its
 * save sheet to send one out. Reading and writing by path inside
 * battuta's folder stays on the shell's own commands, as on desktop
 * (`save_score`, `workspace_create_file`, `file_mtime`).
 */
import { tauriInvoke } from "./host";

const dialog = () => import("@tauri-apps/plugin-dialog");
const fs = () => import("@tauri-apps/plugin-fs");

/** The file name of what the picker returned — a path, a file:// URL, or an Android content:// URI. */
async function nameOf(picked: string): Promise<string> {
  const { basename } = await import("@tauri-apps/api/path");
  try {
    return await basename(picked);
  } catch {
    return decodeURIComponent(picked.split(/[/:]/).pop() ?? "score");
  }
}

/**
 * The OS document picker; the chosen file's name and contents (bytes for
 * the formats read as bytes), or null when the picker is dismissed.
 *
 * Unfiltered on purpose: Android's picker filters by MIME type and drops
 * the extensions it has none for — `.mei` among them, so a filter showed
 * every `.xml` and hid battuta's own scores (2026-10-20). The extension
 * is checked here instead, before anything is read.
 */
export async function pickToImport(exts: readonly string[], binaryExts: readonly string[]): Promise<{ name: string; contents: string | ArrayBuffer } | null> {
  const { open } = await dialog();
  const picked = await open({ multiple: false, directory: false });
  if (typeof picked !== "string") return null;
  const name = await nameOf(picked);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!exts.includes(ext)) throw new Error(`${name} is not a score battuta opens (${exts.map((e) => `.${e}`).join(" ")})`);
  const { readFile } = await fs();
  const bytes = await readFile(picked);
  return { name, contents: binaryExts.includes(ext) ? bytes.buffer : new TextDecoder().decode(bytes) };
}

/** The OS save sheet: write `data` wherever the user puts it. False when dismissed. */
export async function saveWithSheet(filename: string, data: string | Uint8Array): Promise<boolean> {
  const { save } = await dialog();
  const ext = filename.split(".").pop() ?? "";
  const target = await save({ defaultPath: filename, ...(ext && { filters: [{ name: ext.toUpperCase(), extensions: [ext] }] }) });
  if (!target) return false;
  const { writeFile } = await fs();
  await writeFile(target, typeof data === "string" ? new TextEncoder().encode(data) : data);
  return true;
}

/**
 * Save a document into battuta's folder under its own name: `name.mei`,
 * else `name 2.mei`, `name 3.mei`… — never over an existing score. The
 * folder view renames it (✎) and a renamed open tab follows. Returns the
 * new file's path.
 */
export async function saveIntoFolder(name: string, contents: string): Promise<string> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("the shell is required to save");
  const folder = (await invoke("workspace_home", {})) as string | null;
  if (!folder) throw new Error("battuta's folder is not available");
  const base = name.replace(/\.mei$/i, "") || "untitled";
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base} ${n}`;
    try {
      return (await invoke("workspace_create_file", { path: folder, name: `${candidate}.mei`, contents })) as string;
    } catch (e) {
      if (!/exists/i.test(String(e))) throw e;
    }
  }
  throw new Error(`no free name for ${base}.mei`);
}

/** The system share sheet — AirDrop, Mail, another app. False when nothing was sent (iPadOS says; Android cannot tell). */
export async function shareFile(name: string, data: string | Uint8Array): Promise<boolean> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("the shell is required to share");
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return (await invoke("share_file", { name, bytes: Array.from(bytes) })) === true;
}
