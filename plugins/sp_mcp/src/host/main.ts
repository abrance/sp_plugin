/**
 * `plugin.js` entry point — bundled to `plugin.js` and loaded by Super
 * Productivity at app start, whether or not the side panel is ever opened.
 *
 * The bundle runs inside `new Function('plugin', 'PluginAPI', …)`, so
 * `PluginAPI` is a free identifier that resolves to the host instance. Every
 * failure path logs and returns: a broken bridge must never stop SP booting.
 */
import manifest from '../../manifest.json';
import type { PluginApi } from '@sp/plugin-kit';
import { createNodeRunner } from '../lib/host.ts';
import { CONFIG_KEY } from '../lib/config-core.ts';
import { createHostBridge } from './bridge.ts';

const TAG = '[sp_mcp]';

interface HostApi {
  cfg?: { platform?: string };
  executeNodeScript?(request: {
    script: string;
    timeout?: number;
    args?: unknown;
  }): Promise<{ success: boolean; result?: unknown; error?: string }>;
  loadSyncedData?(key?: string): string | null | Promise<string | null>;
  registerHook?(hook: string, handler: (payload: never) => void): void;
  onReady?(callback: () => void): void;
  onUnload?(callback: () => void): void;
}

declare const PluginAPI: HostApi | undefined;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boot(api: HostApi): void {
  if (api.cfg?.platform !== 'desktop') {
    console.log(`${TAG} host loop is desktop-only (platform: ${api.cfg?.platform ?? 'unknown'}), idle`);
    return;
  }
  if (typeof api.executeNodeScript !== 'function') {
    console.log(`${TAG} executeNodeScript unavailable (nodeExecution not granted), idle`);
    return;
  }

  const pluginApi = api as unknown as PluginApi;
  const bridge = createHostBridge({
    version: manifest.version,
    api: () => pluginApi,
    runNode: createNodeRunner(pluginApi),
    loadConfig: () => Promise.resolve(api.loadSyncedData?.(CONFIG_KEY) ?? null),
  });

  try {
    api.registerHook?.('currentTaskChange', (payload: never) => {
      const change = payload as { current?: { id?: string } | null } | null;
      bridge.runner.setCurrentTaskId(change?.current?.id ?? null);
    });
    api.registerHook?.('taskComplete', () => {
      bridge.runner.push('info', 'task completed in the app');
    });
  } catch (error) {
    console.log(`${TAG} hook registration failed: ${message(error)}`);
  }

  api.onUnload?.(() => {
    bridge.stop();
    console.log(`${TAG} host loop stopped (plugin unloaded)`);
  });

  console.log(`${TAG} host loop starting — polling continues while the side panel is closed`);
  void bridge.start().catch((error) => {
    console.log(`${TAG} host loop failed to start: ${message(error)}`);
  });
}

try {
  if (typeof PluginAPI !== 'undefined' && PluginAPI) {
    if (typeof PluginAPI.onReady === 'function') PluginAPI.onReady(() => boot(PluginAPI));
    else boot(PluginAPI);
  } else {
    console.log(`${TAG} no PluginAPI, not running inside Super Productivity`);
  }
} catch (error) {
  console.log(`${TAG} host plugin failed: ${message(error)}`);
}
