import { getApi } from './api.js';

/** The iframe bridge has a 30 s internal timeout; fail earlier and visibly. */
const DEFAULT_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${DEFAULT_TIMEOUT_MS} ms`));
    }, DEFAULT_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Synced key/value helpers.
 *
 * `persistDataSynced(data, key)` stores a string under a per-plugin key that is
 * synced, exported and backed up. Never put credentials here — use `secrets.ts`.
 */
export async function readSynced(key: string): Promise<string | null> {
  const api = getApi();
  const load = api.loadSyncedData ?? api.loadPersistedData;
  if (!load) throw new Error('[sp-plugin-kit] host exposes no persistent-data reader');
  return withTimeout(Promise.resolve(load.call(api, key)), `loadSyncedData(${key})`);
}

export async function writeSynced(key: string, value: string): Promise<void> {
  await withTimeout(
    Promise.resolve(getApi().persistDataSynced(value, key)),
    `persistDataSynced(${key})`,
  );
}

/** Reads and parses a JSON value, returning `fallback` when absent/invalid. */
export async function readSyncedJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await readSynced(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export async function writeSyncedJson(key: string, value: unknown): Promise<void> {
  await writeSynced(key, JSON.stringify(value));
}

/**
 * Creates a debounced writer for hot paths (e.g. streaming chat updates) so the
 * sync layer is not hit on every keystroke.
 */
export function createDebouncedWriter(key: string, delayMs = 400) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: unknown;
  let flushPromise: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending === undefined) return flushPromise;
    const value = pending;
    pending = undefined;
    flushPromise = writeSyncedJson(key, value).catch((err: unknown) => {
      console.error('[sp-plugin-kit] synced write failed', key, err);
    });
    return flushPromise;
  };

  const schedule = (value: unknown): void => {
    pending = value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), delayMs);
  };

  return { schedule, flush };
}
