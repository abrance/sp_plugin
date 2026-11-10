import { createLogger, getApi } from '@sp/plugin-kit';

/**
 * Agent mode: hand a turn to the local Pi CLI (`pi --mode json`).
 *
 * Why this shape:
 * - `executeNodeScript` runs the script synchronously and caps at 300 s, while an
 *   agent turn can take longer and must stream. So the script only *starts* a
 *   detached `pi` process that writes JSONL events to a file, and the renderer
 *   polls that file.
 * - The spawned Node process has an empty environment (no PATH/HOME), so the
 *   start script rebuilds PATH (node bin dirs from nvm + standard dirs) and HOME
 *   before launching Pi. Pi's own `bash` tool inherits that PATH.
 * - Context continuity comes from Pi itself: one `--session-id` per SP
 *   conversation, created on first use and resumed afterwards.
 *
 * Protocol reference: pi docs `json.md` (session header, agent/turn/message/
 * tool events, `agent_settled`).
 */
const log = createLogger('base-ai-bot');

const RUNS_DIR = '~/.local/share/sp-base-ai-bot/runs';
const POLL_CHUNK_LIMIT = 400_000;

export interface PiRunHandle {
  runId: string;
  runDir: string;
  pid: number;
  startedAt: number;
}

export interface PiPollResult {
  /** Parsed JSONL events received since the given offset. */
  events: PiEvent[];
  /** Character offset to pass to the next poll. */
  offset: number;
  /** Byte size of the event file, pass back as `lastSize`. */
  size: number;
  alive: boolean;
  stderrTail: string;
}

export interface PiEvent {
  type: string;
  [key: string]: unknown;
}

const START_SCRIPT = `
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const home = os.homedir();
const expand = (value) => (value.startsWith('~') ? path.join(home, value.slice(1)) : value);

const runDir = path.join(expand(args[0]), String(args[1]));
const binArg = String(args[2] || 'pi');
const cwd = expand(String(args[3] || '~'));
const model = String(args[4] || '');
const tools = String(args[5] || '');
const sessionId = String(args[6] || '');
const prompt = String(args[7] || '');

fs.mkdirSync(runDir, { recursive: true });

// Rebuild a usable environment: the host spawns this script without PATH/HOME.
const pathDirs = [];
try {
  const nvmRoot = path.join(home, '.nvm', 'versions', 'node');
  for (const version of fs.readdirSync(nvmRoot)) {
    pathDirs.push(path.join(nvmRoot, version, 'bin'));
  }
} catch {}
for (const fallback of ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']) {
  pathDirs.push(fallback);
}

const env = {
  PATH: pathDirs.join(':'),
  HOME: home,
  NODE_ENV: 'production',
  TERM: 'dumb',
  LANG: process.env.LANG || 'C.UTF-8',
};

const eventsFile = path.join(runDir, 'events.jsonl');
const stderrFile = path.join(runDir, 'stderr.log');
fs.writeFileSync(eventsFile, '');
fs.writeFileSync(stderrFile, '');

const cliArgs = ['--mode', 'json', '--no-approve'];
if (model) cliArgs.push('--model', model);
if (tools && tools !== '*') cliArgs.push('--tools', tools);
if (sessionId) cliArgs.push('--session-id', sessionId);
cliArgs.push(prompt);

const outFd = fs.openSync(eventsFile, 'a');
const errFd = fs.openSync(stderrFile, 'a');
const child = cp.spawn(binArg, cliArgs, {
  cwd,
  env,
  detached: true,
  stdio: ['ignore', outFd, errFd],
});
child.unref();

fs.writeFileSync(
  path.join(runDir, 'meta.json'),
  JSON.stringify({
    pid: child.pid,
    startedAt: Date.now(),
    bin: binArg,
    cwd,
    model,
    tools,
    sessionId,
    command: [binArg].concat(cliArgs.slice(0, -1)).join(' '),
  }),
);

return { pid: child.pid || 0, runDir };
`;

const POLL_SCRIPT = `
const fs = require('fs');
const path = require('path');
const os = require('os');

// NOTE: this script runs in the host's VM sandbox (only fs/path/os/JSON/args are
// available — no Buffer, no process). Keep it to string APIs and /proc checks,
// otherwise it fails with "Buffer is not defined" / "process is not defined".

const home = os.homedir();
const expand = (value) => (value.startsWith('~') ? path.join(home, value.slice(1)) : value);
const runDir = path.join(expand(args[0]), String(args[1]));
const offset = Math.max(0, Number(args[2]) || 0);
const maxChunk = Math.min(Number(args[3]) || 400000, 2000000);
const lastSize = Number(args[4]) || 0;

let meta = {};
try {
  meta = JSON.parse(fs.readFileSync(path.join(runDir, 'meta.json'), 'utf8'));
} catch {}

// Liveness without process.kill: the pid's /proc entry disappears when it exits.
let alive = false;
if (meta.pid) {
  try {
    alive = fs.existsSync('/proc/' + meta.pid);
  } catch {
    alive = false;
  }
}

const eventsFile = path.join(runDir, 'events.jsonl');
let size = 0;
try {
  size = fs.statSync(eventsFile).size;
} catch {}

let stderrTail = '';
try {
  const errPath = path.join(runDir, 'stderr.log');
  const errSize = fs.statSync(errPath).size;
  if (errSize > 0) {
    const errAll = fs.readFileSync(errPath, 'utf8');
    stderrTail = errAll.slice(Math.max(0, errAll.length - 4000)).trim();
  }
} catch {}

// No new bytes since the previous poll: nothing to parse.
if (size <= lastSize) {
  return { lines: [], offset, alive, stderrTail, size };
}

let chunk = '';
try {
  const content = fs.readFileSync(eventsFile, 'utf8');
  chunk = content.slice(offset, offset + maxChunk);
} catch {}

// Consume only complete records; the tail may be a partial line.
const lastNewline = chunk.lastIndexOf('\\n');
const complete = lastNewline === -1 ? '' : chunk.slice(0, lastNewline + 1);
const lines = complete.split('\\n').filter((line) => line.length > 0);

return { lines, offset: offset + complete.length, alive, stderrTail, size };
`;

const ABORT_SCRIPT = `
const fs = require('fs');
const path = require('path');
const os = require('os');
// Requires child_process on purpose: that routes the script to the host's
// spawned-Node executor, which has process and Buffer. The VM sandbox does not.
const cp = require('child_process');

const home = os.homedir();
const expand = (value) => (value.startsWith('~') ? path.join(home, value.slice(1)) : value);
const runDir = path.join(expand(args[0]), String(args[1]));
const signal = String(args[2] || 'TERM').replace(/^SIG/, '');

let pid = 0;
try {
  pid = JSON.parse(fs.readFileSync(path.join(runDir, 'meta.json'), 'utf8')).pid || 0;
} catch {}
if (!pid) return { ok: false, reason: 'no pid' };

// The child was started detached, so the negative pid targets its process group.
const result = cp.spawnSync('/bin/kill', ['-' + signal, '--', '-' + String(pid)], {
  encoding: 'utf8',
});
return {
  ok: result.status === 0,
  pid,
  signal,
  status: result.status,
  stderr: (result.stderr || '').trim(),
};
`;

function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function runScript<T>(script: string, args: unknown[], timeout = 15000): Promise<T> {
  const api = getApi();
  if (!api.executeNodeScript) {
    throw new Error('nodeExecution 未授权：请在 Super Productivity 里允许 Base AI Bot 执行 Node 脚本');
  }
  const result = await api.executeNodeScript({ script, args, timeout });
  if (!result.success) throw new Error(result.error || 'Node script failed');
  return result.result as T;
}

export interface StartRunInput {
  sessionId: string;
  prompt: string;
  bin: string;
  cwd: string;
  model: string;
  tools: string;
}

export async function startPiRun(input: StartRunInput): Promise<PiRunHandle> {
  const runId = newRunId();
  const handle = await runScript<{ pid: number; runDir: string }>(START_SCRIPT, [
    RUNS_DIR,
    runId,
    input.bin,
    input.cwd,
    input.model,
    input.tools,
    input.sessionId,
    input.prompt,
  ]);
  log.debug('pi run started', runId, handle.pid);
  return { runId, runDir: handle.runDir, pid: handle.pid, startedAt: Date.now() };
}

export async function pollPiRun(
  runId: string,
  offset: number,
  lastSize = 0,
): Promise<PiPollResult> {
  const raw = await runScript<{
    lines?: string[];
    offset?: number;
    size?: number;
    alive?: boolean;
    stderrTail?: string;
  }>(POLL_SCRIPT, [RUNS_DIR, runId, offset, POLL_CHUNK_LIMIT, lastSize]);

  const events: PiEvent[] = [];
  for (const line of raw.lines ?? []) {
    try {
      events.push(JSON.parse(line) as PiEvent);
    } catch {
      // Ignore malformed records (truncated tail or non-JSON diagnostics).
    }
  }

  return {
    events,
    offset: raw.offset ?? offset,
    size: raw.size ?? lastSize,
    alive: !!raw.alive,
    stderrTail: raw.stderrTail ?? '',
  };
}

/** Starts a run and returns its handle plus parsed events helper. */
export async function abortPiRun(runId: string): Promise<void> {
  try {
    await runScript(ABORT_SCRIPT, [RUNS_DIR, runId, 'SIGTERM']);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await runScript(ABORT_SCRIPT, [RUNS_DIR, runId, 'SIGKILL']);
  } catch (err) {
    log.warn('abort failed', err);
  }
}

// ---------------------------------------------------------------- event helpers

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
}

/** Joins the text blocks of a Pi assistant message. */
export function messageText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as ContentBlock[])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}

export function messageThinking(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const thinking = (content as ContentBlock[])
    .filter((block) => block?.type === 'thinking' && typeof block.thinking === 'string')
    .map((block) => block.thinking as string)
    .join('');
  return thinking.length > 0 ? thinking : null;
}

export function messageRole(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const role = (message as { role?: unknown }).role;
  return typeof role === 'string' ? role : null;
}

export function messageStopReason(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const reason = (message as { stopReason?: unknown }).stopReason;
  return typeof reason === 'string' ? reason : null;
}

export function messageErrorMessage(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const value = (message as { errorMessage?: unknown }).errorMessage;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Compact one-line description of a tool call for the action card. */
export function describePiTool(toolName: string, args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const record = args as Record<string, unknown>;
  const candidate =
    record.command ?? record.path ?? record.pattern ?? record.query ?? record.file_path ?? record.url;
  if (typeof candidate === 'string') {
    return candidate.length > 80 ? `${candidate.slice(0, 80)}…` : candidate;
  }
  const keys = Object.keys(record);
  return keys.length > 0 ? keys.slice(0, 3).join(', ') : '';
}

export function toolResultText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const content = (result as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as ContentBlock[])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n');
}
