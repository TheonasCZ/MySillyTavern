// Error log collection (roadmap M11 §3, tiered logging follow-up): wraps
// console.debug/info/warn/error and catches uncaught window errors /
// unhandled promise rejections, forwarding each one to the Rust
// `append_log` command so it lands in `$APPDATA/logs/app.log`. Users can
// then attach that file when reporting a bug instead of having to
// reproduce it in front of a developer.
//
// The console passthrough always happens regardless of the configured
// level (DevTools shows everything); the configured minimum level (see
// `refreshLogLevel`/`getLogLevel`/`setLogLevel` below) only gates whether a
// given call also gets forwarded to the file.
//
// This is best-effort telemetry, not a critical path: every write is
// fire-and-forget (no await, errors swallowed) so a broken log pipe can
// never itself cause a visible failure, and several guards keep it from
// spamming the log file or recursing into itself.

import { invoke } from "@tauri-apps/api/core";
import { getLogLevel as getStoredLogLevel, setLogLevel as setStoredLogLevel, type LogLevel } from "./db/repositories/settingsRepo";

const DEDUPE_WINDOW_MS = 5000;
const MAX_WRITES_PER_MINUTE = 20;
const RATE_WINDOW_MS = 60_000;
const MAX_MESSAGE_LEN = 2000;

// Ascending severity. The configured minimum level gates which lines get
// forwarded to `append_log`/app.log — the console passthrough happens
// unconditionally regardless of this cache, so DevTools always shows
// everything.
const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const DEFAULT_LOG_LEVEL: LogLevel = "info";

// In-memory cache of the configured minimum level, so we don't hit the DB
// on every single log call. Populated by `refreshLogLevel()`, which should
// be called once at startup and again whenever the level is changed via
// Settings.
let cachedLogLevel: LogLevel = DEFAULT_LOG_LEVEL;

/** Re-reads the configured log level from settings and updates the
 *  in-memory cache used to gate file writes. Call once at startup
 *  (alongside `initErrorLogging()`) and again whenever the level is
 *  changed via the Settings UI so the change takes effect immediately. */
export async function refreshLogLevel(): Promise<void> {
  try {
    const level = await getStoredLogLevel();
    cachedLogLevel = level ?? DEFAULT_LOG_LEVEL;
  } catch {
    // Best-effort: keep whatever was cached before (or the default) if the
    // setting can't be read.
  }
}

/** Reads the current in-memory cached log level (does not hit the DB). */
export function getLogLevel(): LogLevel {
  return cachedLogLevel;
}

/** Persists a new minimum log level and immediately refreshes the
 *  in-memory cache so the change takes effect without a restart. */
export async function setLogLevel(level: LogLevel): Promise<void> {
  await setStoredLogLevel(level);
  await refreshLogLevel();
}

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

function logLine(level: LogLevel, line: string) {
  if (logging) return; // recursion guard
  if (LEVEL_RANK[level] < LEVEL_RANK[cachedLogLevel]) return; // below configured threshold
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
  const originalDebug = console.debug.bind(console);

  console.error = (...args: unknown[]) => {
    originalError(...args);
    logLine("error", buildLine("error", args));
  };

  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    logLine("warn", buildLine("warn", args));
  };

  // console.info is for deliberate, low-volume diagnostic breadcrumbs a
  // user might want to review later (e.g. the function-calling prototype's
  // round-trip log) — unlike error/warn it's opt-in per call site, so it's
  // wrapped the same way but expected to be used sparingly.
  console.info = (...args: unknown[]) => {
    originalInfo(...args);
    logLine("info", buildLine("info", args));
  };

  // console.debug is for verbose, only-useful-when-actively-debugging
  // breadcrumbs — gated out of app.log by default (min level "info") but
  // always visible in DevTools like the others.
  console.debug = (...args: unknown[]) => {
    originalDebug(...args);
    logLine("debug", buildLine("debug", args));
  };

  window.addEventListener("error", (event: ErrorEvent) => {
    const arg = event.error instanceof Error ? event.error : event.message;
    logLine("error", buildLine("error", [arg]));
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    logLine("error", buildLine("error", [event.reason]));
  });
}
