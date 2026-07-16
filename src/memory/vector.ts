/** Pure vector helpers for the semantic memory layer — no DB/Tauri imports
 * so they're unit-testable. Vectors travel through SQLite as base64-encoded
 * little-endian f32 arrays (see migration 002). */

export function encodeVector(vec: number[] | Float32Array): string {
  const f32 = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function decodeVector(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/** Cosine similarity in [-1, 1]. Returns 0 for a dimension mismatch (e.g.
 * rows embedded by a different model) or a zero vector — such rows just
 * rank at the bottom instead of throwing. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
