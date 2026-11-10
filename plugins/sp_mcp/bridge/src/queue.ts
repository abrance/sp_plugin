import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  BRIDGE_DIRS,
  PLUGIN_STALE_MS,
  isBridgeResponse,
} from '../../../../packages/plugin-kit/src/bridge-protocol.ts';
import type {
  BridgeCommand,
  BridgePluginState,
  BridgeResponse,
} from '../../../../packages/plugin-kit/src/bridge-protocol.ts';

const DEFAULT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 100;
const DEAD_COMMAND_MS = 10 * 60_000;
const OLD_RESPONSE_MS = 60 * 60_000;

export type BridgeErrorCode = 'plugin-down' | 'timeout' | 'plugin-error' | 'io';

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'BridgeError';
  }
}

export interface BridgeDirs {
  root: string;
  commands: string;
  responses: string;
  state: string;
}

/** `SP_MCP_BRIDGE_DIR` wins; otherwise the plugin's default of the same name. */
export function resolveDirs(): BridgeDirs {
  const raw = process.env['SP_MCP_BRIDGE_DIR']?.trim();
  const root =
    raw && raw.length > 0
      ? raw.startsWith('~')
        ? path.join(homedir(), raw.slice(1))
        : raw
      : path.join(homedir(), '.local', 'share', 'sp-mcp-bridge');
  return {
    root,
    commands: path.join(root, BRIDGE_DIRS.commands),
    responses: path.join(root, BRIDGE_DIRS.responses),
    state: path.join(root, BRIDGE_DIRS.state),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Serializes every call so only one command is in flight at a time. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export class CommandQueue {
  readonly dirs: BridgeDirs;
  private readonly timeoutMs: number;
  private readonly staleMs: number;

  constructor(dirs: BridgeDirs = resolveDirs(), options: { timeoutMs?: number; staleMs?: number } = {}) {
    this.dirs = dirs;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.staleMs = options.staleMs ?? PLUGIN_STALE_MS;
  }

  async ensure(): Promise<void> {
    await mkdir(this.dirs.commands, { recursive: true });
    await mkdir(this.dirs.responses, { recursive: true });
    await mkdir(this.dirs.state, { recursive: true });
  }

  /** Removes leftovers that would otherwise poison the queue after a crash. */
  async sweep(): Promise<{ commands: number; responses: number }> {
    await this.ensure();
    const now = Date.now();
    let commands = 0;
    let responses = 0;
    for (const [dir, maxAge] of [
      [this.dirs.commands, DEAD_COMMAND_MS],
      [this.dirs.responses, OLD_RESPONSE_MS],
    ] as const) {
      for (const name of await this.safeReaddir(dir)) {
        if (!name.endsWith('.json') && !name.endsWith('.tmp')) continue;
        const full = path.join(dir, name);
        try {
          const info = await stat(full);
          if (now - info.mtimeMs > maxAge) {
            await unlink(full);
            if (dir === this.dirs.commands) commands += 1;
            else responses += 1;
          }
        } catch {
          /* another process already removed it */
        }
      }
    }
    return { commands, responses };
  }

  async readPluginState(): Promise<BridgePluginState | null> {
    try {
      const raw = await readFile(path.join(this.dirs.state, 'plugin.json'), 'utf8');
      const parsed = JSON.parse(raw) as BridgePluginState;
      return typeof parsed?.updatedAt === 'number' ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Fails fast with a fixable message instead of waiting for a timeout. */
  async requirePlugin(): Promise<BridgePluginState> {
    const state = await this.readPluginState();
    if (!state) {
      throw new BridgeError(
        'plugin-down',
        `the sp_mcp plugin has never polled (${path.join(this.dirs.state, 'plugin.json')} missing). ` +
          'Enable it in Super Productivity and open its side panel once.',
      );
    }
    if (!state.enabled) {
      throw new BridgeError(
        'plugin-down',
        'the sp_mcp plugin is installed but polling is switched off in its side panel.',
      );
    }
    const age = Date.now() - state.updatedAt;
    if (age > this.staleMs) {
      throw new BridgeError(
        'plugin-down',
        `the sp_mcp plugin stopped polling ${Math.round(age / 1000)}s ago. ` +
          'Super Productivity is probably closed, or the side panel was disabled.',
      );
    }
    return state;
  }

  async call<T>(
    action: string,
    args: Record<string, unknown> = {},
    options: { timeoutMs?: number; retry?: boolean } = {},
  ): Promise<T> {
    await this.ensure();
    await this.requirePlugin();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    // Idempotent reads may retry once; mutations never do (a timed-out write may
    // still have run, and retrying would apply it twice).
    const retry = options.retry ?? action.startsWith('get_');

    try {
      return await this.dispatch<T>(action, args, timeoutMs);
    } catch (error) {
      if (!(error instanceof BridgeError) || error.code !== 'timeout' || !retry) throw error;
      const after = await this.readPluginState();
      if (!after || Date.now() - after.updatedAt > this.staleMs) throw error;
      return this.dispatch<T>(action, args, timeoutMs);
    }
  }

  private async dispatch<T>(action: string, args: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const command: BridgeCommand = { id, action, args, issuedAt: Date.now() };
    await this.writeCommand(command);
    const response = await this.awaitResponse(id, timeoutMs, action);
    if (!response.ok) {
      throw new BridgeError('plugin-error', response.error ?? `${action} failed in the plugin`);
    }
    return response.result as T;
  }

  private async writeCommand(command: BridgeCommand): Promise<void> {
    const target = path.join(this.dirs.commands, `${command.id}.json`);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, JSON.stringify(command), 'utf8');
    await rename(tmp, target);
  }

  private async awaitResponse(
    id: string,
    timeoutMs: number,
    action: string,
  ): Promise<BridgeResponse> {
    const file = path.join(this.dirs.responses, `${id}.json`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const raw = await readFile(file, 'utf8');
        const parsed: unknown = JSON.parse(raw);
        if (isBridgeResponse(parsed) && parsed.id === id) {
          await unlink(file).catch(() => undefined);
          return parsed;
        }
      } catch {
        /* not written yet */
      }
      await sleep(POLL_INTERVAL_MS);
    }

    // Give the plugin a last chance, then drop the command so it cannot run after
    // the caller has already been told the call failed.
    await sleep(200);
    const late = await readFile(file, 'utf8').catch(() => null);
    await unlink(path.join(this.dirs.commands, `${id}.json`)).catch(() => undefined);
    if (late) {
      await unlink(file).catch(() => undefined);
      const parsed: unknown = JSON.parse(late);
      if (isBridgeResponse(parsed)) {
        if (parsed.ok) return parsed;
        throw new BridgeError('plugin-error', parsed.error ?? `${action} failed in the plugin`);
      }
    }
    throw new BridgeError(
      'timeout',
      `${action} got no answer within ${timeoutMs} ms. The app may still have applied it — ` +
        'read the affected task before retrying.',
    );
  }

  private async safeReaddir(dir: string): Promise<string[]> {
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  }
}
