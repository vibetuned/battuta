/**
 * The shell bridge and the dialogs that must be visible in every build.
 * Host services: the App and plugins (through ctx.confirm) both call
 * these; nothing else talks to __TAURI__ for dialogs.
 */
export const tauriInvoke = (): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null => {
  if (typeof window === "undefined") return null;
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
