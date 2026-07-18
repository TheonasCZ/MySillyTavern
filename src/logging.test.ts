import { describe, it, expect, vi, beforeEach } from "vitest";

// `logging.ts` normally talks to the Tauri IPC bridge (`invoke`) and the
// SQLite-backed settings repo. Neither is available under plain Node/vitest,
// so both are mocked — this test only exercises the pure level-filtering
// logic (`refreshLogLevel`/`getLogLevel`/`setLogLevel` + the threshold check
// inside the wrapped console methods), not the actual file write.
const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

let storedLevel: string | null = null;
vi.mock("./db/repositories/settingsRepo", () => ({
  getLogLevel: vi.fn(async () => storedLevel),
  setLogLevel: vi.fn(async (level: string) => {
    storedLevel = level;
  }),
}));

import { getLogLevel, setLogLevel, refreshLogLevel, initErrorLogging } from "./logging";

describe("logging level filtering", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    storedLevel = null;
    // `initErrorLogging()` registers `window` listeners; under vitest's
    // plain Node environment (no jsdom) there is no global `window`, so
    // stub a minimal one just for that registration to succeed. Only the
    // console-wrapping half of `initErrorLogging` is under test here.
    if (typeof globalThis.window === "undefined") {
      (globalThis as unknown as { window: unknown }).window = { addEventListener: vi.fn() };
    }
  });

  it("defaults to info when no level is stored", async () => {
    await refreshLogLevel();
    expect(getLogLevel()).toBe("info");
  });

  it("caches the stored level after refreshLogLevel", async () => {
    await setLogLevel("error");
    expect(getLogLevel()).toBe("error");

    // A fresh refresh should keep reflecting the persisted value.
    await refreshLogLevel();
    expect(getLogLevel()).toBe("error");
  });

  it("forwards console calls at/above the configured level, skips below", async () => {
    initErrorLogging();
    await setLogLevel("warn");

    invokeMock.mockClear();
    console.debug("noisy debug line");
    console.info("routine info line");
    expect(invokeMock).not.toHaveBeenCalled();

    console.warn("a warning");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][0]).toBe("append_log");

    invokeMock.mockClear();
    console.error("an error");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("forwards everything when level is debug", async () => {
    initErrorLogging();
    await setLogLevel("debug");

    invokeMock.mockClear();
    // Use a unique message per call so the dedupe window (5s, keyed by the
    // full built line) doesn't suppress these as repeats of earlier calls
    // in this test file.
    console.debug("unique debug line for debug-level test");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
