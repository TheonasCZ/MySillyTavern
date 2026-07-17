/**
 * Android-safe wrappers for Tauri desktop-only plugins.
 *
 * On Android, `tauri-plugin-dialog` and `tauri-plugin-process` are excluded
 * (behind the `desktop-plugins` Cargo feature, disabled with
 * `--no-default-features`). The JS-side imports will fail at runtime.
 *
 * These wrappers catch import failures and return a "not available"
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
