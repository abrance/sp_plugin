import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { getApi, hasApi } from '@sp/plugin-kit';
import type { BridgePluginState } from '@sp/plugin-kit';
import type { Task } from '@sp/plugin-kit';
import manifest from '../manifest.json';
import { CONFIG_DEFAULTS, POLL_MAX_MS, POLL_MIN_MS, loadConfig, normalizeConfig, saveConfig } from './lib/config';
import type { BridgeConfig } from './lib/config';
import { ACTIONS } from './lib/actions';
import { runNode } from './lib/host';
import { STAT_SCRIPT } from './lib/scripts';
import type { DirStat } from './lib/runner';

const POLL_CHOICES = [400, 800, 1500, 3000];
const PANEL_REFRESH_MS = 1500;
const PLUGIN_STALE_MS = 10_000;

function ago(ms: number | null): string {
  if (!ms) return '—';
  const delta = Date.now() - ms;
  if (delta < 2000) return 'now';
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  return `${Math.round(delta / 60_000)}m ago`;
}

/**
 * Status panel only. The polling loop lives in the host `plugin.js` so it keeps
 * running after this iframe is destroyed; this page reads the heartbeat that
 * the host loop writes and edits the shared config.
 */
export default function App() {
  const [config, setConfig] = createSignal<BridgeConfig>(CONFIG_DEFAULTS);
  const [state, setState] = createSignal<BridgePluginState | null>(null);
  const [statAt, setStatAt] = createSignal<number | null>(null);
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

  const alive = () => {
    const heartbeat = state();
    if (!heartbeat || !statAt()) return false;
    return Date.now() - heartbeat.updatedAt < PLUGIN_STALE_MS;
  };

  const refreshState = async () => {
    try {
      const stat = await runNode<DirStat>(STAT_SCRIPT, [config().bridgeDir], 4000);
      setState(stat.pluginState ?? null);
      setStatAt(Date.now());
    } catch (error) {
      setState(null);
      setMessage(`state read failed: ${(error as Error).message}`);
    }
  };

  const refreshTasks = async () => {
    try {
      const api = getApi();
      const [tasks, tags] = await Promise.all([api.getTasks(), api.getAllTags()]);
      const ids = tags.find((t) => t.id === 'TODAY')?.taskIds ?? [];
      const byId = new Map(tasks.map((t) => [t.id, t]));
      setToday(ids.map((id) => byId.get(id)).filter((t): t is Task => !!t).slice(0, 8));
      const currentId = state()?.currentTaskId;
      setCurrentTask(currentId ? (byId.get(currentId) ?? null) : null);
    } catch {
      /* the panel is informational; failures surface in the message line */
    }
  };

  const apply = async (next: BridgeConfig) => {
    const normalized = normalizeConfig(next);
    setConfig(normalized);
    try {
      await saveConfig(normalized);
      setMessage('settings saved — the host loop picks them up within 1.5 s');
    } catch (error) {
      setMessage(`settings active but not saved: ${(error as Error).message}`);
    }
    void refreshState();
  };

  onMount(async () => {
    const loaded = await loadConfig();
    setConfig(loaded);
    setConfigured(true);
    void refreshState();
    void refreshTasks();
    const statePoll = setInterval(() => void refreshState(), PANEL_REFRESH_MS);
    const taskPoll = setInterval(() => void refreshTasks(), 5000);

    onCleanup(() => {
      clearInterval(statePoll);
      clearInterval(taskPoll);
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
            v{manifest.version} · host loop {alive() ? 'v1' : 'idle'}
          </p>
        </div>
        <span classList={{ 'smcp-chip': true, 'smcp-chip-on': alive() }}>
          {alive() ? 'polling' : 'stopped'}
        </span>
      </header>

      <section class="smcp-card">
        <div class="smcp-grid">
          <div>
            <span class="smcp-label">Processed</span>
            <strong>{state()?.stats.processed ?? 0}</strong>
          </div>
          <div>
            <span class="smcp-label">Errors</span>
            <strong>{state()?.stats.errors ?? 0}</strong>
          </div>
          <div>
            <span class="smcp-label">Expired</span>
            <strong>{state()?.stats.expired ?? 0}</strong>
          </div>
          <div>
            <span class="smcp-label">Last action</span>
            <strong>{state()?.lastAction ?? '—'}</strong>
          </div>
          <div>
            <span class="smcp-label">Heartbeat</span>
            <strong>{ago(state()?.updatedAt ?? null)}</strong>
          </div>
          <div>
            <span class="smcp-label">Interval</span>
            <strong>{state()?.pollMs ?? config().pollMs} ms</strong>
          </div>
        </div>
        <Show when={state()?.lastError}>
          {(error) => <p class="smcp-error">{error()}</p>}
        </Show>
        <p class="smcp-hint">
          Written by the host plugin, not this panel — closing the panel does not stop polling.
        </p>
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
                const stat = await runNode<DirStat>(STAT_SCRIPT, [config().bridgeDir], 4000);
                setMessage(
                  `dir ${stat.exists ? 'exists' : 'missing'} · ${stat.commands} queued · ${stat.responses} unanswered · host state ${stat.pluginState ? 'present' : 'absent'}`,
                );
              } catch (error) {
                setMessage(`check failed: ${(error as Error).message}`);
              }
            }}
          >
            Check folder
          </button>
          <button
            class="smcp-btn"
            onClick={async () => {
              try {
                const result = await ACTIONS['ping']!({}, {
                  api: getApi(),
                  getCurrentTaskId: () => state()?.currentTaskId ?? null,
                  log: () => undefined,
                });
                setMessage(`self-test ok: ${(result as { openTasks?: number }).openTasks ?? 0} open tasks`);
              } catch (error) {
                setMessage(`self-test failed: ${(error as Error).message}`);
              }
            }}
          >
            Test plugin API
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
            {state()?.currentTaskId ? state()!.currentTaskId!.slice(0, 8) : 'nothing tracked'}
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

      <p class="smcp-note">
        Permissions: this plugin reads and changes tasks, projects, tags and the timer, and runs local
        file scripts (nodeExecution, asks once) to exchange files with the agent process. It never
        sends your data anywhere by itself.
      </p>
    </div>
  );
}
