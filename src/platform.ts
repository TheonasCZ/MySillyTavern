/**
 * Android-safe wrappers for Tauri desktop-only plugins.
 *
 * On Android, `tauri-plugin-dialog`, `tauri-plugin-process` and
 * `tauri-plugin-updater` are excluded via target-conditional dependencies
 * in Cargo.toml, so the JS-side plugin calls fail at runtime.
 *
 * These wrappers catch those failures and return a "not available"
 * indication so callers can show an appropriate message.
 */

type FileDialogFilter = { name: string; extensions: string[] };

export interface FileDialogResult {
  path: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DialogModule = any;

let _dialogModule: DialogModule = null;

async function getDialog(): Promise<DialogModule> {
  if (_dialogModule) return _dialogModule;
  try {
    _dialogModule = await import("@tauri-apps/plugin-dialog");
    return _dialogModule;
  } catch {
    return null;
  }
}

/**
 * Show a confirmation dialog. On Tauri desktop, uses the native dialog plugin
 * (async, returns boolean). On Android / fallback, uses browser confirm().
 */
export async function showConfirm(message: string): Promise<boolean> {
  const dialog = await getDialog();
  if (dialog?.confirm) {
    return dialog.confirm(message);
  }
  // Fallback: native browser confirm (synchronous, but wrapped in Promise)
  return typeof window !== "undefined" ? window.confirm(message) : false;
}

/** Open a file/folder picker. Returns null on Android (not supported). */
export async function openDialog(opts?: Record<string, unknown>): Promise<string | null> {
  const dialog = await getDialog();
  if (!dialog) return null;
  const result = await dialog.open(opts);
  if (result === null || result === undefined) return null;
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result[0] ?? null;
  // FileDialogResult (Tauri v2)
  return (result as FileDialogResult).path ?? null;
}

/** Open a save dialog. Returns null on Android (not supported). */
export async function saveDialog(opts?: {
  filters?: FileDialogFilter[];
  defaultPath?: string;
}): Promise<string | null> {
  const dialog = await getDialog();
  if (!dialog) return null;
  return dialog.save(opts);
}

/** Restart the app. No-op on Android (process plugin excluded). */
export async function relaunchApp(): Promise<void> {
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch {
    // Android: process plugin not available — simply do nothing
  }
}

export interface AvailableUpdate {
  version: string;
  /** Downloads and installs the update; caller then calls relaunchApp(). */
  downloadAndInstall: () => Promise<void>;
}

/**
 * Check GitHub Releases for a newer version. Returns null when there is no
 * update, when the updater is unavailable (Android, dev build) or when the
 * check fails (offline) — callers can treat null as "nothing to do".
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      downloadAndInstall: async () => {
        await update.downloadAndInstall();
      },
    };
  } catch (err) {
    // Logged (not swallowed) — console.warn is forwarded to app.log by
    // src/logging.ts, so update-check failures are diagnosable without
    // needing devtools open on a released build.
    console.warn("checkForUpdate failed:", err);
    return null;
  }
}

let _openerModule: {
  openPath: (path: string) => Promise<void>;
  revealItemInDir: (path: string) => Promise<void>;
} | null = null;

async function getOpener() {
  if (_openerModule) return _openerModule;
  try {
    _openerModule = await import("@tauri-apps/plugin-opener");
    return _openerModule;
  } catch {
    return null;
  }
}

/** Open a path with the system handler. No-op on failure. */
export async function openPath(path: string): Promise<void> {
  const opener = await getOpener();
  if (!opener) return;
  try {
    await opener.openPath(path);
  } catch {
    // ignore
  }
}

/** Reveal a file in the system file manager. No-op on failure. */
export async function revealItemInDir(path: string): Promise<void> {
  const opener = await getOpener();
  if (!opener) return;
  try {
    await opener.revealItemInDir(path);
  } catch {
    // ignore
  }
}
