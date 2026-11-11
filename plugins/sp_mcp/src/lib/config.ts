import { readSyncedJson, writeSynced } from '@sp/plugin-kit';
import { CONFIG_KEY, normalizeConfig } from './config-core';
import type { BridgeConfig } from './config-core';

export {
  CONFIG_DEFAULTS,
  CONFIG_KEY,
  LOG_KEY,
  POLL_MAX_MS,
  POLL_MIN_MS,
  normalizeConfig,
} from './config-core';
export type { BridgeConfig } from './config-core';

export async function loadConfig(): Promise<BridgeConfig> {
  return normalizeConfig(await readSyncedJson<Partial<BridgeConfig>>(CONFIG_KEY, {}));
}

export async function saveConfig(config: BridgeConfig): Promise<void> {
  await writeSynced(CONFIG_KEY, JSON.stringify(config));
}
