import { defineConfig } from "vitest/config";

// Unit tests only cover pure logic modules (lorebook activation, World
// Info mapping, system prompt substitution) that intentionally avoid any
// Tauri/DB import, so a plain Node environment is enough — no jsdom, no
// Tauri runtime mocking needed.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
