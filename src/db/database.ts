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

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  const db = await getDb();
  await db.execute(sql, params);
  // Any write invalidates the entire cache — simple and safe
  cache.clear();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
