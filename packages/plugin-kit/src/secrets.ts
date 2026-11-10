/**
 * Local-only secret storage for iframe plugins.
 *
 * Super Productivity 19.2.0 exposes `setSecret`/`getSecret` only to host-side
 * `plugin.js`, not to the iframe bridge. Iframe plugins therefore use
 * `localStorage`, which lives in the app profile on this device only and is
 * never synced, exported or backed up.
 *
 * If `localStorage` is unavailable (locked-down runtime), values fall back to
 * memory for the session so the plugin keeps working without silently syncing
 * the credential.
 */

const PREFIX = 'sp-plugin:secret:';

const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = `${PREFIX}__probe__`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/** True when secrets persist across restarts on this device. */
export function isSecretPersistenceAvailable(): boolean {
  return storage() !== null;
}

export async function setSecret(key: string, value: string): Promise<void> {
  const ls = storage();
  if (ls) ls.setItem(PREFIX + key, value);
  else memory.set(key, value);
}

export async function getSecret(key: string): Promise<string | null> {
  const ls = storage();
  if (ls) return ls.getItem(PREFIX + key);
  return memory.get(key) ?? null;
}

export async function deleteSecret(key: string): Promise<void> {
  const ls = storage();
  if (ls) ls.removeItem(PREFIX + key);
  memory.delete(key);
}
