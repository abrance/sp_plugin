// Relative paths (not the `@sp/plugin-kit` alias) so the Node self-test can
// import this module directly without a bundler.
import { getApi } from '../../../../packages/plugin-kit/src/api.ts';
import type { PluginApi } from '../../../../packages/plugin-kit/src/api.ts';
import {
  BRIDGE_PROTOCOL_VERSION,
  COMMAND_MAX_AGE_MS,
  isBridgeCommand,
} from '../../../../packages/plugin-kit/src/bridge-protocol.ts';
import type { BridgePluginState, BridgeResponse } from '../../../../packages/plugin-kit/src/bridge-protocol.ts';
import { ACTIONS } from './actions.ts';
import type { ActionContext } from './actions.ts';
import { runNode } from './host.ts';
import { COMMIT_SCRIPT, DRAIN_SCRIPT, STAT_SCRIPT } from './scripts.ts';
import type { BridgeConfig } from './config-core.ts';

interface DrainedCommand {
  file: string;
  cmd: unknown;
}

interface DrainResult {
  dir: string;
  commands: DrainedCommand[];
  rejected: number;
}

interface CommitEntry {
  id: string;
  commandFile: string | null;
  response: BridgeResponse;
}

export interface DirStat {
  dir: string;
  exists: boolean;
  commands: number;
  responses: number;
  pluginState: BridgePluginState | null;
}

export interface LogEntry {
  at: number;
  kind: 'ok' | 'err' | 'info';
  text: string;
}

export interface RunnerStatus {
  running: boolean;
  busy: boolean;
  dir: string;
  pollMs: number;
  processed: number;
  errors: number;
  expired: number;
  queueDepth: number;
  lastAction: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastPollAt: number | null;
  currentTaskId: string | null;
}

const MAX_COMMANDS_PER_TICK = 20;
const MAX_LOG = 40;

/**
 * Where the runner gets its plugin API and its file scripts. The iframe uses
 * the defaults; `plugin.js` injects the host-side `PluginAPI` instead, so the
 * exact same tick logic serves both and only one of them ever polls.
 */
export interface RunnerEnv {
  api(): PluginApi;
  runNode<T>(script: string, args: unknown[], timeoutMs?: number): Promise<T>;
}

const DEFAULT_ENV: RunnerEnv = { api: getApi, runNode };

/**
 * Drains the command queue, executes each command serially through the plugin
 * API and writes the responses back. One host call to read, at most one to
 * commit, so polling stays cheap and cannot overlap with itself.
 */
export class BridgeRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private busy = false;
  private currentTaskId: string | null = null;
  private lastHeartbeatAt = 0;
  private logEntries: LogEntry[] = [];
  private listeners = new Set<(status: RunnerStatus) => void>();
  private status: RunnerStatus;
  // Plain fields, not constructor parameter properties: `node selftest.mjs`
  // loads this file through Node's strip-only TypeScript mode.
  private readonly pluginVersion: string;
  private readonly getConfig: () => BridgeConfig;
  private readonly env: RunnerEnv;

  constructor(
    pluginVersion: string,
    getConfig: () => BridgeConfig,
    env: RunnerEnv = DEFAULT_ENV,
  ) {
    this.pluginVersion = pluginVersion;
    this.getConfig = getConfig;
    this.env = env;
    const config = getConfig();
    this.status = {
      running: false,
      busy: false,
      dir: config.bridgeDir,
      pollMs: config.pollMs,
      processed: 0,
      errors: 0,
      expired: 0,
      queueDepth: 0,
      lastAction: null,
      lastDurationMs: null,
      lastError: null,
      lastPollAt: null,
      currentTaskId: null,
    };
  }

  subscribe(listener: (status: RunnerStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): RunnerStatus {
    return { ...this.status };
  }

  logs(): LogEntry[] {
    return [...this.logEntries];
  }

  setCurrentTaskId(taskId: string | null): void {
    if (this.currentTaskId === taskId) return;
    this.currentTaskId = taskId;
    this.status.currentTaskId = taskId;
    this.push('info', taskId ? `current task → ${taskId}` : 'current task cleared');
    this.emit();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.status.running = true;
    this.emit();
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    this.status.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.push('info', 'polling stopped');
    this.emit();
  }

  /** Applies config changes (dir, interval, on/off) without a reload. */
  applyConfig(config: BridgeConfig): void {
    this.status.dir = config.bridgeDir;
    this.status.pollMs = config.pollMs;
    if (!config.enabled) {
      this.stop();
      return;
    }
    const wasRunning = this.running;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
    this.status.running = false;
    if (wasRunning || config.enabled) this.start();
  }

  push(kind: LogEntry['kind'], text: string): void {
    this.logEntries = [{ at: Date.now(), kind, text }, ...this.logEntries].slice(0, MAX_LOG);
  }

  async statDir(): Promise<DirStat> {
    const config = this.getConfig();
    return this.env.runNode<DirStat>(STAT_SCRIPT, [config.bridgeDir], 4000);
  }

  /** Runs exactly one queue drain, whether or not the loop is started. */
  async runOnce(): Promise<void> {
    await this.tick(true);
  }

  /** Proves the plugin API path works without any agent process attached. */
  async selfTest(): Promise<string> {
    try {
      const result = await ACTIONS['ping']!({}, this.context());
      const openTasks = (result as { openTasks?: number }).openTasks ?? 0;
      this.push('ok', `self-test ok — ${openTasks} open tasks`);
      this.emit();
      return `self-test ok: ${openTasks} open tasks`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError(message);
      return `self-test failed: ${message}`;
    }
  }

  private lastError(message: string): void {
    this.status.lastError = message;
    this.status.errors += 1;
    this.push('err', message);
    this.emit();
  }

  private context(): ActionContext {
    return {
      api: this.env.api(),
      getCurrentTaskId: () => this.currentTaskId,
      log: (message: string) => this.push('info', message),
    };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.tick();
    }, Math.max(0, delayMs));
  }

  private async tick(force = false): Promise<void> {
    if ((!this.running && !force) || this.busy) return;
    this.busy = true;
    this.status.busy = true;
    const config = this.getConfig();
    const entries: CommitEntry[] = [];
    let rejected = 0;

    try {
      const drained = await this.env.runNode<DrainResult>(DRAIN_SCRIPT, [config.bridgeDir], 4000);
      rejected = drained.rejected;
      this.status.queueDepth = drained.commands.length;

      const batch = drained.commands.slice(0, MAX_COMMANDS_PER_TICK);
      for (const item of batch) {
        entries.push(await this.executeOne(item));
      }
      // Anything left over is handled on the next tick; keep it visible.
      this.status.queueDepth = drained.commands.length - batch.length;

      const heartbeatDue = Date.now() - this.lastHeartbeatAt > 1500;
      if (entries.length > 0 || heartbeatDue) {
        await this.env.runNode(COMMIT_SCRIPT, [config.bridgeDir, entries, this.heartbeat(config)], 5000);
        this.lastHeartbeatAt = Date.now();
      }
      this.status.lastPollAt = Date.now();
      if (rejected > 0) this.push('err', `${rejected} unreadable command file(s) discarded`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A missing/unwritable bridge dir must not spam the log every 800 ms.
      if (this.status.lastError !== message) this.lastError(message);
    } finally {
      this.busy = false;
      this.status.busy = false;
      this.status.dir = config.bridgeDir;
      this.status.pollMs = config.pollMs;
      this.emit();
      if (this.running) this.schedule(config.pollMs);
    }
  }

  private async executeOne(item: DrainedCommand): Promise<CommitEntry> {
    const now = Date.now();
    if (!isBridgeCommand(item.cmd)) {
      const id = `invalid-${now}`;
      return {
        id,
        commandFile: item.file,
        response: {
          id,
          action: 'invalid',
          ok: false,
          error: 'malformed command envelope',
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
        },
      };
    }

    const command = item.cmd;
    const stale = now - command.issuedAt > COMMAND_MAX_AGE_MS;

    if (stale) {
      this.status.expired += 1;
      this.push('err', `${command.action}: expired before it ran`);
      return {
        id: command.id,
        commandFile: item.file,
        response: {
          id: command.id,
          action: command.action,
          ok: false,
          error: `command expired (issued ${Math.round((now - command.issuedAt) / 1000)}s ago; the app was probably closed)`,
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
        },
      };
    }

    const handler = ACTIONS[command.action];
    if (!handler) {
      const message = `unknown action "${command.action}"`;
      return {
        id: command.id,
        commandFile: item.file,
        response: {
          id: command.id,
          action: command.action,
          ok: false,
          error: `${message} — known: ${Object.keys(ACTIONS).sort().join(', ')}`,
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
        },
      };
    }

    try {
      const result = await handler(command.args ?? {}, this.context());
      const finishedAt = Date.now();
      this.status.processed += 1;
      this.status.lastAction = command.action;
      this.status.lastDurationMs = finishedAt - now;
      this.status.lastError = null;
      this.push('ok', `${command.action} (${finishedAt - now} ms)`);
      return {
        id: command.id,
        commandFile: item.file,
        response: {
          id: command.id,
          action: command.action,
          ok: true,
          result,
          startedAt: now,
          finishedAt,
          durationMs: finishedAt - now,
        },
      };
    } catch (error) {
      const finishedAt = Date.now();
      this.status.errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      this.status.lastAction = command.action;
      this.status.lastError = message;
      this.push('err', `${command.action}: ${message}`);
      return {
        id: command.id,
        commandFile: item.file,
        response: {
          id: command.id,
          action: command.action,
          ok: false,
          error: message,
          startedAt: now,
          finishedAt,
          durationMs: finishedAt - now,
        },
      };
    }
  }

  private heartbeat(config: BridgeConfig): BridgePluginState {
    return {
      protocol: BRIDGE_PROTOCOL_VERSION,
      pluginVersion: this.pluginVersion,
      updatedAt: Date.now(),
      pollMs: config.pollMs,
      enabled: config.enabled,
      currentTaskId: this.currentTaskId,
      lastAction: this.status.lastAction,
      lastError: this.status.lastError,
      stats: {
        processed: this.status.processed,
        errors: this.status.errors,
        expired: this.status.expired,
      },
    };
  }
}
