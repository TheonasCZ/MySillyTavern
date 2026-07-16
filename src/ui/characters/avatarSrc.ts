import { convertFileSrc } from "@tauri-apps/api/core";

/** Converts an absolute filesystem avatar path (as stored in
 * `characters.avatar_path`) into a URL the webview can load as an <img>
 * src. Returns undefined when there's no avatar, so callers can fall back
 * to a placeholder. */
export function avatarSrc(path: string | null): string | undefined {
  if (!path) return undefined;
  return convertFileSrc(path);
}
