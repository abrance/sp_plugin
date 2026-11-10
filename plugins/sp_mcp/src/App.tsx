import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { getApi, hasApi } from '@sp/plugin-kit';
import type { Task } from '@sp/plugin-kit';
import manifest from '../manifest.json';
import { CONFIG_DEFAULTS, POLL_MAX_MS, POLL_MIN_MS, loadConfig, normalizeConfig, saveConfig } from './lib/config';
import type { BridgeConfig } from './lib/config';
import { BridgeRunner } from './lib/runner';
import type { LogEntry, RunnerStatus } from './lib/runner';

const POLL_CHOICES = [400, 800, 1500, 3000];

function ago(ms: number | null): string {
  if (!ms) return '—';
  const delta = Date.now() - ms;
  if (delta < 2000) return 'now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  return `${Math.round(delta / 60_000)}m ago`;
}

export default function App() {
  const [config, setConfig] = createSignal<BridgeConfig>(CONFIG_DEFAULTS);
  const [status, setStatus] = createSignal<RunnerStatus | null>(null);
  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [message, setMessage] = createSignal<string | null>(null);
  const [currentTask, setCurrentTask] = createSignal<Task | null>(null);
  const [today, setToday] = createSignal<Task[]>([]);
  const [configured, setConfigured] = createSignal(false);

  if (!hasApi()) {
    return (
      <div class="smcp-page">
        <h1 class="smcp-title">SP MCP Bridge</h1>
        <p class="smcp-note">
          No host API found. Open this plugin from Super Productivity (side panel), not in a plain
          browser.
        </p>
      </div>
    );
  }

  const runner = new BridgeRunner(manifest.version, () => config());

  const refreshSnapshot = () => {
    setStatus(runner.snapshot());
    setLogs(runner.logs());
  };

  const refreshTasks = async () => {
    try {
      const api = getApi();
      const [tasks, tags] = await Promise.all([api.getTasks(), api.getAllTags()]);
      const ids = tags.find((t) => t.id === 'TODAY')?.taskIds ?? [];
      const byId = new Map(tasks.map((t) => [t.id, t]));
      setToday(ids.map((id) => byId.get(id)).filter((t): t is Task => !!t).slice(0, 8));
      const currentId = status()?.currentTaskId;
      setCurrentTask(currentId ? (byId.get(currentId) ?? null) : null);
    } catch {
      /* the panel is informational; failures surface in the log */
    }
  };

  const apply = async (next: BridgeConfig) => {
    const normalized = normalizeConfig(next);
    setConfig(normalized);
    try {
      await saveConfig(normalized);
      setMessage('settings saved');
    } catch (error) {
      setMessage(`settings active but not saved: ${(error as Error).message}`);
    }
    runner.applyConfig(normalized);
  };

  onMount(async () => {
    const loaded = await loadConfig();
    setConfig(loaded);
    setConfigured(true);
    const unsubscribe = runner.subscribe(refreshSnapshot);
    const interval = setInterval(refreshSnapshot, 1000);

    try {
      const api = getApi();
      api.registerHook('currentTaskChange', (payload: unknown) => {
        const change = payload as { current?: Task | null };
        runner.setCurrentTaskId(change?.current?.id ?? null);
        void refreshTasks();
      });
      api.registerHook('taskComplete', () => {
        runner.push('info', 'task completed in the app');
        void refreshTasks();
      });
    } catch (error) {
      runner.push('err', `hook registration failed: ${(error as Error).message}`);
    }

    if (loaded.enabled) runner.start();
    void refreshTasks();
    const taskPoll = setInterval(() => void refreshTasks(), 5000);

    onCleanup(() => {
      unsubscribe();
      clearInterval(interval);
      clearInterval(taskPoll);
      runner.stop();
    });
  });

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(config().bridgeDir);
      setMessage('bridge path copied');
    } catch {
      setMessage('copy failed — select the path and copy it manually');
    }
  };

  return (
    <div class="smcp-page">
      <header class="smcp-header">
        <div>
          <h1 class="smcp-title">SP MCP Bridge</h1>
          <p class="smcp-sub">
            v{manifest.version} · protocol {status()?.running ? 'v1' : 'idle'}
          </p>
        </div>
        <span classList={{ 'smcp-chip': true, 'smcp-chip-on': !!status()?.running }}>
          {status()?.running ? 'polling' : 'stopped'}
        </span>
      </header>

      <section class="smcp-card">
        <div class="smcp-grid">
          <div>
            <span class="smcp-label">Queue</span>
            <strong>{status()?.queueDepth ?? 0}</strong>
          </div>
          <div>
            <span class="smcp-label">Processed</span>
            <strong>{status()?.processed ?? 0}</strong>
          </div>
          <div>
            <span class="smcp-label">Errors</span>
            <strong>{status()?.errors ?? 0}</strong>
          </div>
          <div>
            <span class="smcp-label">Expired</span>
            <strong>{status()?.expired ?? 0}</strong>
          </div>
          <div>
            <span class="smcp-label">Last action</span>
            <strong>{status()?.lastAction ?? '—'}</strong>
          </div>
          <div>
            <span class="smcp-label">Duration</span>
            <strong>{status()?.lastDurationMs != null ? `${status()!.lastDurationMs} ms` : '—'}</strong>
          </div>
          <div>
            <span class="smcp-label">Last poll</span>
            <strong>{ago(status()?.lastPollAt ?? null)}</strong>
          </div>
          <div>
            <span class="smcp-label">Interval</span>
            <strong>{config().pollMs} ms</strong>
          </div>
        </div>
        <Show when={status()?.lastError}>
          {(error) => <p class="smcp-error">{error()}</p>}
        </Show>
      </section>

      <section class="smcp-card">
        <label class="smcp-row">
          <input
            type="checkbox"
            checked={config().enabled}
            onChange={(event) => void apply({ ...config(), enabled: event.currentTarget.checked })}
          />
          <span>Accept commands from the agent bridge</span>
        </label>

        <label class="smcp-field">
          <span class="smcp-label">Bridge directory</span>
          <input
            class="smcp-input"
            value={config().bridgeDir}
            onInput={(event) => setConfig({ ...config(), bridgeDir: event.currentTarget.value })}
            onBlur={() => void apply(config())}
            spellcheck={false}
          />
        </label>

        <label class="smcp-field">
          <span class="smcp-label">Poll interval</span>
          <select
            class="smcp-input"
            value={String(config().pollMs)}
            onChange={(event) => void apply({ ...config(), pollMs: Number(event.currentTarget.value) })}
          >
            <For each={POLL_CHOICES}>
              {(ms) => <option value={String(ms)}>{ms} ms</option>}
            </For>
          </select>
          <span class="smcp-hint">
            {POLL_MIN_MS}–{POLL_MAX_MS} ms per host call. Lower reacts faster, higher is quieter.
          </span>
        </label>

        <div class="smcp-actions">
          <button class="smcp-btn" onClick={() => void copyPath()}>
            Copy path
          </button>
          <button
            class="smcp-btn"
            onClick={async () => {
              try {
                const stat = await runner.statDir();
                setMessage(
                  `dir ${stat.exists ? 'exists' : 'missing'} · ${stat.commands} queued · ${stat.responses} unanswered · plugin state ${stat.pluginState ? 'present' : 'absent'}`,
                );
              } catch (error) {
                setMessage(`check failed: ${(error as Error).message}`);
              }
            }}
          >
            Check folder
          </button>
          <button class="smcp-btn" onClick={() => void runner.selfTest().then(setMessage)}>
            Test plugin API
          </button>
          <button
            class="smcp-btn"
            onClick={() => {
              if (status()?.running) runner.stop();
              else runner.start();
              refreshSnapshot();
            }}
          >
            {status()?.running ? 'Stop' : 'Start'}
          </button>
        </div>

        <Show when={message()}>{(text) => <p class="smcp-hint">{text()}</p>}</Show>
        <Show when={!configured()}>
          <p class="smcp-hint">loading settings…</p>
        </Show>
      </section>

      <section class="smcp-card">
        <div class="smcp-row smcp-row-between">
          <span class="smcp-label">Current task</span>
          <span class="smcp-hint">
            {status()?.currentTaskId ? status()!.currentTaskId!.slice(0, 8) : 'nothing tracked'}
          </span>
        </div>
        <p class="smcp-current">
          {currentTask()?.title ?? 'The timer is not queryable in 19.2.0 — mirrored from the app hook.'}
        </p>
        <span class="smcp-label">Today ({today().length})</span>
        <ul class="smcp-list">
          <For each={today()} fallback={<li class="smcp-hint">nothing planned for today</li>}>
            {(task) => (
              <li>
                <span classList={{ 'smcp-done': task.isDone }}>{task.title}</span>
              </li>
            )}
          </For>
        </ul>
      </section>

      <section class="smcp-card">
        <span class="smcp-label">Recent activity</span>
        <ul class="smcp-log">
          <For each={logs()} fallback={<li class="smcp-hint">no activity yet</li>}>
            {(entry) => (
              <li classList={{ 'smcp-log-err': entry.kind === 'err', 'smcp-log-ok': entry.kind === 'ok' }}>
                <span class="smcp-time">
                  {new Date(entry.at).toLocaleTimeString(undefined, { hour12: false })}
                </span>
                {entry.text}
              </li>
            )}
          </For>
        </ul>
      </section>

      <p class="smcp-note">
        Permissions: this plugin reads and changes tasks, projects, tags and the timer, and runs local
        file scripts (nodeExecution, asks once) to exchange files with the agent process. It never
        sends your data anywhere by itself.
      </p>
    </div>
  );
}
