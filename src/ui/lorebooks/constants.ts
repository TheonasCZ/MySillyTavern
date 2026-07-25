export { inputStyle } from "../common/inputStyle";

export function csvToKeys(text: string): string[] {
  return text
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}
