/**
 * Wire protocol for the command-file bridge between an iframe plugin and an
 * external agent process (see `plugins/sp_mcp`).
 *
 * Deliberately dependency-free and DOM-free: both the plugin bundle and the
 * Node bridge import it.
 *
 * Layout under the bridge directory:
 *   commands/<id>.json   written by the agent, consumed and deleted by the plugin
 *   responses/<id>.json  written by the plugin, consumed and deleted by the agent
 *   state/plugin.json    plugin heartbeat, rewritten by the plugin while polling
 *
 * Files are always written to `<name>.tmp` and renamed, so a reader never sees
 * a partial document.
 */

export const BRIDGE_PROTOCOL_VERSION = 1;

/** Default directory; `~` is expanded by whichever side needs a real path. */
export const BRIDGE_DIR_DEFAULT = '~/.local/share/sp-mcp-bridge';

export const BRIDGE_DIRS = {
  commands: 'commands',
  responses: 'responses',
  state: 'state',
} as const;

/** A command is refused (answered with `expired`) when older than this. */
export const COMMAND_MAX_AGE_MS = 120_000;

/** No heartbeat for this long means the plugin is not polling. */
export const PLUGIN_STALE_MS = 10_000;

export interface BridgeCommand {
  id: string;
  /** Action name, e.g. `get_tasks`. */
  action: string;
  args?: Record<string, unknown>;
  issuedAt: number;
}

export interface BridgeResponse {
  id: string;
  action: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

export interface BridgePluginState {
  protocol: number;
  pluginVersion: string;
  /** Platform plugin hook heartbeats use the same clock as commands (unix ms). */
  updatedAt: number;
  pollMs: number;
  enabled: boolean;
  currentTaskId: string | null;
  lastAction: string | null;
  lastError: string | null;
  stats: { processed: number; errors: number; expired: number };
}

export function isBridgeResponse(value: unknown): value is BridgeResponse {
  const v = value as Partial<BridgeResponse> | null;
  return !!v && typeof v.id === 'string' && typeof v.ok === 'boolean';
}

export function isBridgeCommand(value: unknown): value is BridgeCommand {
  const v = value as Partial<BridgeCommand> | null;
  return (
    !!v && typeof v.id === 'string' && typeof v.action === 'string' && typeof v.issuedAt === 'number'
  );
}
