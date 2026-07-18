// Error log collection (roadmap M11 §3): wraps console.error/warn and
// catches uncaught window errors / unhandled promise rejections, forwarding
// each one to the Rust `append_log` command so it lands in
// `$APPDATA/logs/app.log`. Users can then attach that file when reporting a
// bug instead of having to reproduce it in front of a developer.
//
// This is best-effort telemetry, not a critical path: every write is
// fire-and-forget (no await, errors swallowed) so a broken log pipe can
// never itself cause a visible failure, and several guards keep it from
// spamming the log file or recursing into itself.

import { invoke } from "@tauri-apps/api/core";

const DEDUPE_WINDOW_MS = 5000;
const MAX_WRITES_PER_MINUTE = 20;
const RATE_WINDOW_MS = 60_000;
const MAX_MESSAGE_LEN = 2000;

let installed = false;
// Recursion guard: set for the duration of a single append_log call so an
// error thrown while logging (e.g. from JSON.stringify or invoke itself)
// never triggers another log write.
let logging = false;

// message -> last-logged timestamp, for the 1-per-5s dedupe.
const lastSeen = new Map<string, number>();
// Timestamps (ms) of writes within the current rate-limit window.
let writeTimestamps: number[] = [];

function serializeArg(arg: unknown): string {
  if (arg instanceof Error) {
    const stackLines = (arg.stack ?? "").split("\n").slice(0, 3).join("\n");
    return `${arg.message}${stackLines ? `\n${stackLines}` : ""}`;
  }
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function buildLine(level: string, args: unknown[]): string {
  const message = args.map(serializeArg).join(" ").slice(0, MAX_MESSAGE_LEN);
  return `${new Date().toISOString()} [${level}] ${message}`;
}

function shouldSkip(dedupeKey: string): boolean {
  const now = Date.now();

  const last = lastSeen.get(dedupeKey);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) {
    return true;
  }
  lastSeen.set(dedupeKey, now);

  writeTimestamps = writeTimestamps.filter((ts) => now - ts < RATE_WINDOW_MS);
  if (writeTimestamps.length >= MAX_WRITES_PER_MINUTE) {
    return true;
  }
  writeTimestamps.push(now);
  return false;
}

function logLine(line: string) {
  if (logging) return; // recursion guard
  if (shouldSkip(line)) return;

  logging = true;
  try {
    // Fire-and-forget: never await, never let a rejection surface.
    void invoke("append_log", { line }).catch(() => {});
  } catch {
    // Swallow synchronous throws too (e.g. invoke not available outside Tauri).
  } finally {
    logging = false;
  }
}

/**
 * Installs the console/window hooks. Idempotent — safe to call more than
 * once (e.g. in tests or HMR) without double-wrapping console methods.
 */
export function initErrorLogging(): void {
  if (installed) return;
  installed = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalInfo = console.info.bind(console);

  console.error = (...args: unknown[]) => {
    originalError(...args);
    logLine(buildLine("error", args));
  };

  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    logLine(buildLine("warn", args));
  };

  // console.info is for deliberate, low-volume diagnostic breadcrumbs a
  // user might want to review later (e.g. the function-calling prototype's
  // round-trip log) — unlike error/warn it's opt-in per call site, so it's
  // wrapped the same way but expected to be used sparingly.
  console.info = (...args: unknown[]) => {
    originalInfo(...args);
    logLine(buildLine("info", args));
  };

  window.addEventListener("error", (event: ErrorEvent) => {
    const arg = event.error instanceof Error ? event.error : event.message;
    logLine(buildLine("error", [arg]));
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    logLine(buildLine("error", [event.reason]));
  });
}
