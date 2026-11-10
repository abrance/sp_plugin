import type {
  ActiveWorkContext,
  DialogCfg,
  DialogResult,
  NotifyCfg,
  PluginAppState,
  PluginCreateTaskData,
  PluginHooks,
  Project,
  SnackCfg,
  Tag,
  Task,
  TaskUpdatePayload,
} from './types.js';

/**
 * The Plugin API surface available inside an `iFrame: true` plugin.
 *
 * This mirrors the exact allowlist Super Productivity 19.2.0 injects into
 * plugin iframes. Registration methods that take callbacks
 * (`registerHeaderButton`, `registerMenuEntry`, `registerShortcut`, …) are
 * deliberately absent — they throw in an iframe and must live in `plugin.js`.
 */
export interface PluginApi {
  // tasks
  getTasks(): Promise<Task[]>;
  getArchivedTasks(): Promise<Task[]>;
  getCurrentContextTasks(): Promise<Task[]>;
  getSelectedTask(): Promise<Task | null>;
  getFocusedTask(): Promise<Task | null>;
  selectTask(taskId: string): Promise<void>;
  reInitData(): Promise<void>;
  updateTask(taskId: string, updates: TaskUpdatePayload): Promise<void>;
  addTask(taskData: PluginCreateTaskData): Promise<string>;
  deleteTask(taskId: string): Promise<void>;
  batchUpdateForProject(request: { projectId: string; operations: unknown[] }): Promise<unknown>;
  reorderTasks(
    taskIds: string[],
    contextId: string,
    contextType: 'project' | 'task',
  ): Promise<void>;

  // projects & tags
  getAllProjects(): Promise<Project[]>;
  addProject(projectData: Partial<Project>): Promise<string>;
  updateProject(projectId: string, updates: Partial<Project>): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  getAllTags(): Promise<Tag[]>;
  addTag(tagData: Partial<Tag>): Promise<string>;
  updateTag(tagId: string, updates: Partial<Tag>): Promise<void>;

  // ui
  showSnack(snackCfg: SnackCfg): void;
  notify(notifyCfg: NotifyCfg): Promise<void>;
  openDialog(dialogCfg: DialogCfg): Promise<DialogResult>;
  showIndexHtmlAsView(): void;
  showIndexHtmlInSidePanel?(): void;
  showInWorkContext(): void;
  closeWorkContextView(): void;

  // state
  getActiveWorkContext(): Promise<ActiveWorkContext | null>;
  getAppState(): Promise<PluginAppState>;
  dispatchAction(action: { type: string; [key: string]: unknown }): void;

  // persistence (iframe exposes both names; `loadSyncedData` is an alias)
  persistDataSynced(dataStr: string, key?: string): Promise<void>;
  loadPersistedData(key?: string): Promise<string | null>;
  loadSyncedData?(key?: string): Promise<string | null>;

  // hooks
  registerHook(hook: PluginHooks | string, handler: (payload: never) => void): void;

  // counters
  setCounter(id: string, value: number): Promise<void>;
  getCounter(id: string): Promise<number | null>;
  incrementCounter(id: string, incrementBy?: number): Promise<number>;
  decrementCounter(id: string, decrementBy?: number): Promise<number>;
  deleteCounter(id: string): Promise<void>;
  getAllCounters(): Promise<{ [id: string]: number }>;

  // misc
  translate(key: string, params?: Record<string, string | number>): string;
  getCurrentLanguage(): string;
  executeNodeScript?(request: {
    script: string;
    timeout?: number;
    args?: unknown;
  }): Promise<{ success: boolean; result?: unknown; error?: string }>;
}

interface PluginApiGlobal {
  PluginAPI?: PluginApi;
}

/** Returns the injected API or throws a readable error. */
export function getApi(): PluginApi {
  const api = (globalThis as unknown as PluginApiGlobal).PluginAPI;
  if (!api) {
    throw new Error(
      '[sp-plugin-kit] PluginAPI is not injected yet — plugin must run inside Super Productivity',
    );
  }
  return api;
}

/** True when running inside Super Productivity (vs a plain `vite dev` page). */
export function hasApi(): boolean {
  return !!(globalThis as unknown as PluginApiGlobal).PluginAPI;
}

/** Resolves once the host has injected `PluginAPI`. */
export function waitForApi(timeoutMs = 10_000, pollMs = 50): Promise<PluginApi> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      const api = (globalThis as unknown as PluginApiGlobal).PluginAPI;
      if (api) return resolve(api);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('[sp-plugin-kit] timed out waiting for PluginAPI'));
      }
      setTimeout(tick, pollMs);
    };
    tick();
  });
}
