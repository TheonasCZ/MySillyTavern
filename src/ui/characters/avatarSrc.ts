import { convertFileSrc } from "@tauri-apps/api/core";

/** Converts an absolute filesystem avatar path (as stored in
 * `characters.avatar_path`) into a URL the webview can load as an <img>
 * src. Returns undefined when there's no avatar, so callers can fall back
 * to a placeholder.
 *
 * Appends a cache-busting query parameter so the webview always reloads
 * the image when the path changes (on-disk replacement via overwrite, or
 * when a new file gets the same logical URL through the asset protocol). */
export function avatarSrc(path: string | null): string | undefined {
  if (!path) return undefined;
  return `${convertFileSrc(path)}?t=${Date.now()}`;
}
