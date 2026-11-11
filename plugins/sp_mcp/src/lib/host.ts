import { getApi } from '../../../../packages/plugin-kit/src/api.ts';
import type { PluginApi } from '../../../../packages/plugin-kit/src/api.ts';

/**
 * Wraps `executeNodeScript` for one API instance.
 *
 * The host nests the return value as `{ success, result }`; scripts in
 * `scripts.ts` return their payload directly, so callers get the payload.
 * Scripts stay inside the fs/path/os-only VM tier (no Buffer, no process, no
 * timers) so no child process is spawned and the 5 s tier limit is plenty.
 */
export function createNodeRunner(api: PluginApi) {
  return async function runNode<T>(script: string, args: unknown[], timeoutMs = 5000): Promise<T> {
    if (!api.executeNodeScript) {
      throw new Error('executeNodeScript is unavailable — the "nodeExecution" permission is missing');
    }
    const raw = await api.executeNodeScript({ script, args, timeout: timeoutMs });
    if (!raw || typeof raw !== 'object') throw new Error('node script returned no result');
    if (!raw.success) throw new Error(raw.error || 'node script failed');
    return raw.result as T;
  };
}

/** Same runner, resolved against whichever `PluginAPI` is injected right now. */
export async function runNode<T>(script: string, args: unknown[], timeoutMs = 5000): Promise<T> {
  return createNodeRunner(getApi())(script, args, timeoutMs);
}
