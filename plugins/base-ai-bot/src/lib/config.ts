import {
  createLogger,
  getSecret,
  readSyncedJson,
  setSecret,
  writeSyncedJson,
} from '@sp/plugin-kit';
import { createSignal } from 'solid-js';
import {
  DEFAULT_CONFIG,
  SECRET_API_KEY,
  type AppConfig,
} from './types.js';

const log = createLogger('base-ai-bot', import.meta.env.DEV);

const CONFIG_KEY = 'config';

/**
 * Non-secret settings live in synced plugin data (survives sync, export,
 * backup). The API key does not — see `apiKey.ts`.
 */
const [config, setConfig] = createSignal<AppConfig>(DEFAULT_CONFIG);
export { config };

const [apiKey, setApiKeySignal] = createSignal<string | null>(null);
export { apiKey };

export async function loadConfig(): Promise<void> {
  const stored = await readSyncedJson<Partial<AppConfig>>(CONFIG_KEY, {});
  setConfig({ ...DEFAULT_CONFIG, ...stored });
  try {
    setApiKeySignal(await getSecret(SECRET_API_KEY));
  } catch (err) {
    log.error('failed to read API key', err);
  }
}

export async function saveConfig(next: AppConfig, nextApiKey: string): Promise<void> {
  setConfig(next);
  await writeSyncedJson(CONFIG_KEY, next);
  await setSecret(SECRET_API_KEY, nextApiKey);
  setApiKeySignal(nextApiKey);
}
