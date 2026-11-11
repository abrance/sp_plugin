/**
 * Config shape and validation, with no runtime dependency on the plugin kit.
 *
 * The iframe panel (`config.ts`) and the host-side `plugin.js` both read the
 * same persisted key through different APIs (message bridge vs. host method),
 * so the key and the normalisation must live in one import-light module the
 * host bundle and the Node self-test can both load.
 */
import { BRIDGE_DIR_DEFAULT } from '../../../../packages/plugin-kit/src/bridge-protocol.ts';

export const CONFIG_KEY = 'sp-mcp-bridge:config';
export const LOG_KEY = 'sp-mcp-bridge:log';

export interface BridgeConfig {
  /** Directory shared with the agent-side bridge. `~` is expanded in the host script. */
  bridgeDir: string;
  /** How often the plugin drains the command queue. */
  pollMs: number;
  /** Polling off keeps the plugin installed but idle. */
  enabled: boolean;
}

export const CONFIG_DEFAULTS: BridgeConfig = {
  bridgeDir: BRIDGE_DIR_DEFAULT,
  pollMs: 800,
  enabled: true,
};

export const POLL_MIN_MS = 300;
export const POLL_MAX_MS = 5000;

export function normalizeConfig(raw: Partial<BridgeConfig> | null): BridgeConfig {
  const pollMs = Math.min(
    POLL_MAX_MS,
    Math.max(POLL_MIN_MS, Math.round(Number(raw?.pollMs) || CONFIG_DEFAULTS.pollMs)),
  );
  const dir = typeof raw?.bridgeDir === 'string' && raw.bridgeDir.trim().length > 0
    ? raw.bridgeDir.trim().replace(/\/+$/, '')
    : CONFIG_DEFAULTS.bridgeDir;
  return { bridgeDir: dir, pollMs, enabled: raw?.enabled !== false };
}
