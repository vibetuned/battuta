/**
 * The shell bridge and the dialogs that must be visible in every build.
 * Host services: the App and plugins (through ctx.confirm) both call
 * these; nothing else talks to __TAURI__ for dialogs.
 */
/** The shell the page runs in, as it said before the page loaded (lib.rs);
 * null in a browser. */
export const shellPlatform = (): { platform: string; mobile: boolean } | null => {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __BATTUTA_SHELL__?: { platform: string; mobile: boolean } }).__BATTUTA_SHELL__ ?? null;
};

/** The DESKTOP shell's bridge — native dialogs, files by path, MIDI,
 * folders. The tablet shells have none of those yet (phase 10) and take
 * the browser's paths, so on them this is null. */
export const tauriInvoke = (): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null => {
  if (typeof window === "undefined" || shellPlatform()?.mobile) return null;
  const t = (window as unknown as { __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__;
  return t?.core?.invoke ?? null;
};

/** OK/Cancel confirm that is actually VISIBLE in the shell: wry's own
 * window.confirm silently returns false there, so the shell asks through
 * a native dialog; browsers keep the built-in modal. */
export const confirmDialog = (message: string, title = "battuta"): Promise<boolean> => {
  const invoke = tauriInvoke();
  if (!invoke) return Promise.resolve(window.confirm(message));
  return invoke("confirm_dialog", { title, message }).then(
    (r) => r === true,
    () => window.confirm(message), // dialog unavailable: last-ditch fallback
  );
};
