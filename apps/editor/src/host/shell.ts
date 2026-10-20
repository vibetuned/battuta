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

/** The shell's bridge — files by path, folders, and (on desktop) native
 * dialogs and MIDI. Null in a browser. The tablet shells answer the
 * portable commands only; what opens a dialog goes through `./tablet`
 * there (phase 10, M1). */
export const tauriInvoke = (): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null => {
  if (typeof window === "undefined") return null;
  const t = (window as unknown as { __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__;
  return t?.core?.invoke ?? null;
};

/** OK/Cancel confirm that is actually VISIBLE in the shell: wry's own
 * window.confirm silently returns false there, so the shell asks through
 * a native dialog; browsers keep the built-in modal. */
export const confirmDialog = (message: string, title = "battuta"): Promise<boolean> => {
  // A WKWebView answers window.confirm with false without asking: the OS asks on a tablet.
  if (shellPlatform()?.mobile) return confirmOnTablet(message, title).catch(() => false);
  const invoke = tauriInvoke();
  if (!invoke) return Promise.resolve(window.confirm(message));
  return invoke("confirm_dialog", { title, message }).then(
    (r) => r === true,
    () => window.confirm(message), // dialog unavailable: last-ditch fallback
  );
};


/** True in the iPadOS and Android shells (phase 10). Their file paths —
 * the OS document picker and save sheet — load with `../tabletFiles` on
 * first use; only the confirm dialog, which plugins reach through
 * ctx.confirm, is the host's. */
export const onTablet = (): boolean => shellPlatform()?.mobile === true;

/** OK/Cancel through the OS — a WKWebView answers `window.confirm` with false without asking. */
async function confirmOnTablet(message: string, title: string): Promise<boolean> {
  const { confirm } = await import("@tauri-apps/plugin-dialog");
  return confirm(message, { title, kind: "warning" });
}
