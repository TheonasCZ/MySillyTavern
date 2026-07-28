import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:mysillytavern.db";
const CACHE_TTL = 5_000; // 5 seconds

let dbPromise: Promise<Database> | null = null;

/** Lazily opens (and caches) the single SQLite connection for the app. */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL);
  }
  return dbPromise;
}

// -- Query cache --
const cache = new Map<string, { data: unknown; expires: number }>();

function cacheKey(sql: string, params: unknown[]): string {
  return `${sql}|${JSON.stringify(params)}`;
}

/** Clear the entire cache. Called after any write (execute). */
export function invalidateCache(): void {
  cache.clear();
}

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const key = cacheKey(sql, params);
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) {
    return entry.data as T[];
  }
  const db = await getDb();
  const result = await db.select<T[]>(sql, params);
  cache.set(key, { data: result, expires: Date.now() + CACHE_TTL });
  return result;
}

// -- Write serialization --
// SQLite allows only one writer at a time for the whole file, even in WAL
// mode — it doesn't matter which table. Several call sites now fire
// fire-and-forget writes (memory pipeline logging, background memory work)
// that can land concurrently on tauri-plugin-sql's pooled connections; with
// no PRAGMA busy_timeout configured, a losing writer fails immediately
// instead of waiting, which surfaced as intermittent "disk I/O error"
// (SQLITE_IOERR_SHORT_READ) crashes. Chaining every write through this one
// promise queue guarantees at most one `db.execute()` call is ever in
// flight, so writers queue in JS instead of colliding in SQLite.
let writeQueue: Promise<unknown> = Promise.resolve();

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  const run = writeQueue.then(async () => {
    const db = await getDb();
    await db.execute(sql, params);
  });
  // Swallow so one failed write doesn't poison the chain for everyone queued
  // behind it — each caller still sees (and can handle) its own rejection.
  writeQueue = run.catch(() => {});
  await run;
  // Any write invalidates the entire cache — simple and safe
  cache.clear();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
