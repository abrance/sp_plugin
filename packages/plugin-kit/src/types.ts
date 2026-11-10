/**
 * Vendored subset of `@super-productivity/plugin-api` types, pinned to the
 * Super Productivity version this repo targets (19.2.0).
 *
 * Source: super-productivity/packages/plugin-api/src/types.ts @ v19.2.0
 * Keep in sync when bumping `minSupVersion` in a plugin manifest.
 */

export interface PluginManifest {
  name: string;
  id: string;
  manifestVersion: number;
  version: string;
  minSupVersion: string;
  description?: string;
  hooks: PluginHooks[];
  permissions: string[];
  /** Exact hostnames allowed for `PluginAPI.request`; requires `"http"` permission. */
  allowedHosts?: string[];
  iFrame?: boolean;
  isSkipMenuEntry?: boolean;
  type?: 'standard' | 'issueProvider';
  assets?: string[];
  icon?: string;
  sidePanel?: boolean;
  uiKit?: boolean;
  jsonSchemaCfg?: string;
  i18n?: { languages: string[] };
}

export enum PluginHooks {
  TASK_CREATED = 'taskCreated',
  TASK_COMPLETE = 'taskComplete',
  TASK_UPDATE = 'taskUpdate',
  TASK_DELETE = 'taskDelete',
  CURRENT_TASK_CHANGE = 'currentTaskChange',
  FINISH_DAY = 'finishDay',
  LANGUAGE_CHANGE = 'languageChange',
  PERSISTED_DATA_CHANGED = 'persistedDataChanged',
  ACTION = 'action',
  ANY_TASK_UPDATE = 'anyTaskUpdate',
  PROJECT_LIST_UPDATE = 'projectListUpdate',
  WORK_CONTEXT_CHANGE = 'workContextChange',
}

export interface Task {
  id: string;
  title: string;
  notes?: string;
  timeEstimate: number;
  timeSpent: number;
  isDone: boolean;
  projectId: string | null;
  tagIds: string[];
  parentId?: string | null;
  created: number;
  updated?: number;
  subTaskIds: string[];

  timeSpentOnDay?: { [key: string]: number };
  doneOn?: number | null;
  attachments?: unknown[];
  remindAt?: number | null;
  dueDay?: string | null;
  dueWithTime?: number | null;
  /** Unix ms; today's start-of-day value means "planned for today". */
  plannedAt?: number | null;
  deadlineDay?: string | null;
  deadlineWithTime?: number | null;
  repeatCfgId?: string | null;

  issueId?: string | null;
  issueProviderId?: string | null;
  issueType?: unknown;
  issuePoints?: number | null;

  _hideSubTasksMode?: number;
}

export interface Project {
  id: string;
  title: string;
  theme: {
    primary?: string;
    isAutoContrast?: boolean;
    [key: string]: unknown;
  };
  isArchived?: boolean;
  created?: number;
  updated?: number;
  taskIds: string[];
  backlogTaskIds: string[];
  noteIds: string[];
  isEnableBacklog?: boolean;
  isHiddenFromMenu?: boolean;
  advancedCfg: unknown;
  icon?: string | null;
}

export interface Tag {
  id: string;
  title: string;
  color?: string | null;
  created: number;
  updated?: number;
  taskIds: string[];
  icon?: string | null;
  theme: unknown;
  advancedCfg: unknown;
}

/** Snapshot of the active work context at emit time. */
export interface ActiveWorkContext {
  id: string;
  type: 'PROJECT' | 'TAG' | 'TODAY';
  title: string;
  taskIds: string[];
}

export interface PluginCreateTaskData {
  title: string;
  projectId?: string | null;
  tagIds?: string[];
  notes?: string;
  timeEstimate?: number;
  parentId?: string | null;
  isDone?: boolean;
  /** Due date as ISO date string (YYYY-MM-DD) */
  dueDay?: string | null;
}

export type SnackType = 'SUCCESS' | 'ERROR' | 'INFO' | 'WARNING';

export interface SnackCfg {
  msg: string;
  type?: SnackType;
  ico?: string;
  action?: { label: string; onClick: () => void };
}

export interface NotifyCfg {
  title: string;
  body: string;
  ico?: string;
}

export interface DialogButtonCfg {
  label: string;
  color?: 'primary' | 'accent' | 'warn';
  raised?: boolean;
  onClick?: () => void;
}

export interface DialogCfg {
  title: string;
  htmlContent?: string;
  content?: string;
  buttons?: DialogButtonCfg[];
  okBtnLabel?: string;
  cancelBtnLabel?: string;
}

export type DialogResult = string | undefined;

/** Loose shape — the real payload is the app's exported JSON data. */
export type PluginAppState = Record<string, unknown>;

/** Fields the task update API accepts (plus a few pass-through fields). */
export type TaskUpdatePayload = Partial<
  Pick<
    Task,
    | 'title'
    | 'notes'
    | 'isDone'
    | 'timeEstimate'
    | 'timeSpent'
    | 'projectId'
    | 'tagIds'
    | 'dueDay'
    | 'dueWithTime'
    | 'plannedAt'
    | 'deadlineDay'
    | 'deadlineWithTime'
    | 'parentId'
    | 'subTaskIds'
  > & { doneOn: number | null }
>;
