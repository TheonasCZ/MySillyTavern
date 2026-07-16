import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

/** File-picker glue for World Info JSON import/export. Kept separate from
 * `worldInfoImport.ts` (which stays DB/Tauri-free for unit testing) — this
 * module is the only place that touches the file dialog + Rust file I/O
 * commands (`read_text_file` / `write_text_file`, see
 * `src-tauri/src/commands/files.rs`). */

/** Opens a native file picker restricted to `.json` and returns its text
 * content, or null if the user cancelled. */
export async function pickWorldInfoJsonFile(): Promise<string | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: "World Info (JSON)", extensions: ["json"] }],
  });
  if (!path || Array.isArray(path)) return null;
  return invoke<string>("read_text_file", { path });
}

/** Opens a native save dialog and writes `jsonText` there, or does nothing
 * if the user cancelled. Returns the chosen path, or null on cancel. */
export async function saveWorldInfoJsonFile(
  defaultFileName: string,
  jsonText: string,
): Promise<string | null> {
  const path = await save({
    defaultPath: defaultFileName,
    filters: [{ name: "World Info (JSON)", extensions: ["json"] }],
  });
  if (!path) return null;
  await invoke("write_text_file", { path, contents: jsonText });
  return path;
}
