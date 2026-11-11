/**
 * Host-side bridge loop (`plugin.js`).
 *
 * Lives in SP's renderer, not in the side panel, so the queue keeps draining
 * while the panel is closed. It is the single owner of the command queue: the
 * iframe only reads `state/plugin.json` for display and never polls.
 *
 * Config comes from the same persisted key the panel writes, so the panel's
 * "Accept commands" switch still governs the loop. A missing value means a
 * fresh install where the panel was never opened → defaults.
 */
import { BridgeRunner } from '../lib/runner.ts';
import type { RunnerEnv } from '../lib/runner.ts';
import { CONFIG_DEFAULTS, normalizeConfig } from '../lib/config-core.ts';
import type { BridgeConfig } from '../lib/config-core.ts';

export interface HostBridgeDeps extends RunnerEnv {
  version: string;
  /** Raw persisted config (string, parsed object or null) read through the host API. */
  loadConfig(): Promise<unknown>;
  /** How often the loop re-reads the persisted config to pick up panel changes. */
  superviseMs?: number;
}

export interface HostBridge {
  runner: BridgeRunner;
  config(): BridgeConfig;
  start(): Promise<void>;
  stop(): void;
  /** Test hook: refresh config, then drain the queue exactly once. */
  pump(): Promise<void>;
}

/** Normalises whatever the host hands back into a usable config. */
export async function readHostConfig(load: () => Promise<unknown>): Promise<BridgeConfig> {
  let raw: unknown = null;
  try {
    raw = await load();
  } catch {
    raw = null;
  }
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  return normalizeConfig((raw ?? null) as Partial<BridgeConfig> | null);
}

export function createHostBridge(deps: HostBridgeDeps): HostBridge {
  let config: BridgeConfig = { ...CONFIG_DEFAULTS };
  const runner = new BridgeRunner(deps.version, () => config, deps);
  let timer: ReturnType<typeof setInterval> | null = null;

  const sync = (next: BridgeConfig): void => {
    const changed = next.bridgeDir !== config.bridgeDir
      || next.pollMs !== config.pollMs
      || next.enabled !== config.enabled;
    if (changed) {
      config = next;
      runner.applyConfig(next);
      return;
    }
    if (!config.enabled) {
      if (runner.snapshot().running) runner.stop();
      return;
    }
    if (!runner.snapshot().running) runner.start();
  };

  const refresh = async (): Promise<void> => {
    sync(await readHostConfig(deps.loadConfig));
  };

  return {
    runner,
    config: () => ({ ...config }),
    async start(): Promise<void> {
      await refresh();
      if (!timer) timer = setInterval(() => void refresh(), deps.superviseMs ?? 1500);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
      runner.stop();
    },
    async pump(): Promise<void> {
      await refresh();
      await runner.runOnce();
    },
  };
}
