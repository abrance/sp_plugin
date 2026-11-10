import {
  PluginHooks,
  createLogger,
  getApi,
  type ActiveWorkContext,
  type SnackType,
  type Task,
} from '@sp/plugin-kit';
import { createSignal } from 'solid-js';

const log = createLogger('base-ai-bot');

/**
 * The active timer is not part of `getAppState()`; the only way an iframe
 * plugin learns it is the `currentTaskChange` hook. We mirror it locally.
 */
const [currentTask, setCurrentTask] = createSignal<Task | null>(null);
export { currentTask };

export function snack(msg: string, type: SnackType = 'INFO'): void {
  getApi().showSnack({ msg, type });
}

export function registerHostHooks(): void {
  try {
    getApi().registerHook(PluginHooks.CURRENT_TASK_CHANGE, ((payload: {
      current: Task | null;
    }) => {
      setCurrentTask(payload.current);
    }) as never);
  } catch (err) {
    log.warn('could not register currentTaskChange hook', err);
  }
}

/** Starts the timer: setting the current task starts tracking when enabled. */
export function startTask(taskId: string): void {
  getApi().dispatchAction({ type: '[Task] SetCurrentTask', id: taskId });
}

/** Stops the timer (flushes tracked time in the host). */
export function stopTask(): void {
  getApi().dispatchAction({ type: '[Task] UnsetCurrentTask' });
}

/** Switches the active project/tag view. Resolves the context type first. */
export async function setActiveWorkContext(
  contextId: string,
): Promise<{ ok: true; type: 'PROJECT' | 'TAG' } | { ok: false; error: string }> {
  const api = getApi();
  const projects = await api.getAllProjects();
  const isProject = projects.some((p) => p.id === contextId);
  if (!isProject) {
    const tags = await api.getAllTags();
    if (!tags.some((t) => t.id === contextId)) {
      return { ok: false, error: `No project or tag with id ${contextId}` };
    }
  }
  getApi().dispatchAction({
    type: '[WorkContext] Set Active Work Context',
    activeId: contextId,
    activeType: isProject ? 'PROJECT' : 'TAG',
  });
  return { ok: true, type: isProject ? 'PROJECT' : 'TAG' };
}

export async function getWorkContext(): Promise<ActiveWorkContext | null> {
  return getApi().getActiveWorkContext();
}
