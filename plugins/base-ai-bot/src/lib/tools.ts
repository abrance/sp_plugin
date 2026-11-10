import { getApi, type Task, type TaskUpdatePayload } from '@sp/plugin-kit';
import {
  buildReportMarkdown,
  collectReportData,
  reportDataForModel,
  type ReportPeriod,
} from './report.js';
import { currentTask, setActiveWorkContext, snack, startTask, stopTask } from './host.js';

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
});

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const bool = (description: string) => ({ type: 'boolean', description });
const strArr = (description: string) => ({
  type: 'array',
  items: { type: 'string' },
  description,
});

export const toolSchemas: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'create_task',
      description:
        'Create a new task in Super Productivity. Tasks without a project go to the Inbox.',
      parameters: obj(
        {
          title: str('Task title'),
          notes: str('Task notes/description'),
          project_id: str('Project ID to assign the task to'),
          parent_id: str('Parent task ID when creating a subtask'),
          tag_ids: strArr('Tag IDs to assign'),
          due_day: str('Due date as YYYY-MM-DD'),
          time_estimate: num('Time estimate in milliseconds'),
        },
        ['title'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_tasks',
      description:
        'Get tasks with optional filters. By default returns open tasks only.',
      parameters: obj({
        project_id: str('Filter by project ID'),
        tag_id: str('Filter by tag ID'),
        include_done: bool('Include completed tasks (default false)'),
        include_archived: bool('Include archived tasks (default false)'),
        search_query: str('Case-insensitive title/notes search'),
        parents_only: bool('Exclude subtasks'),
        overdue: bool('Only tasks due before today'),
        unscheduled: bool('Only tasks without any date'),
        planned_for_today: bool('Only tasks planned for today'),
        recurring_only: bool('Only recurring tasks'),
      }),
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: 'Update an existing task. Pass only the fields to change.',
      parameters: obj(
        {
          task_id: str('Task ID to update'),
          title: str('New title'),
          notes: str('New notes'),
          is_done: bool('Mark done/undone'),
          due_day: str('Due date YYYY-MM-DD, or empty string to clear'),
          planned_at: num(
            'Unix ms timestamp to plan the task; null removes it from the plan',
          ),
          time_estimate: num('Time estimate in ms'),
          time_spent: num('Time spent in ms'),
          tag_ids: strArr('Replace all tags with this list'),
          project_id: str('Move to project'),
        },
        ['task_id'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Mark a single task as complete.',
      parameters: obj({ task_id: str('Task ID to complete') }, ['task_id']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: 'Permanently delete a task. Deleting a parent removes its subtasks.',
      parameters: obj({ task_id: str('Task ID to delete') }, ['task_id']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_tag_to_task',
      description: 'Add one tag to a task without touching its other tags.',
      parameters: obj(
        { task_id: str('Task ID'), tag_id: str('Tag ID to add') },
        ['task_id', 'tag_id'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_tag_from_task',
      description: 'Remove one tag from a task without touching its other tags.',
      parameters: obj(
        { task_id: str('Task ID'), tag_id: str('Tag ID to remove') },
        ['task_id', 'tag_id'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_task',
      description:
        'Get the time-tracked task. Returns null when no timer is running.',
      parameters: obj({}),
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_task',
      description:
        'Start the time tracker on a task. Cannot start a completed task.',
      parameters: obj({ task_id: str('Task ID to start tracking') }, ['task_id']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_task',
      description: 'Stop the running time tracker. Safe when no timer runs.',
      parameters: obj({}),
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_complete_tasks',
      description: 'Complete several tasks in one operation (max 100).',
      parameters: obj({ task_ids: strArr('Task IDs to complete') }, ['task_ids']),
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_update_tasks',
      description: 'Update several tasks with different changes (max 100).',
      parameters: obj(
        {
          updates: {
            type: 'array',
            description: 'Array of task updates',
            items: obj({
              task_id: str('Task ID to update'),
              title: str('New title'),
              notes: str('New notes'),
              due_day: str('Due date YYYY-MM-DD or empty to clear'),
              tag_ids: strArr('Replace all tags'),
              time_estimate: num('Time estimate in ms'),
              time_spent: num('Time spent in ms'),
            }),
          },
        },
        ['updates'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_task_to_project',
      description: 'Move a top-level task to another project.',
      parameters: obj(
        { task_id: str('Task ID to move'), project_id: str('Destination project ID') },
        ['task_id', 'project_id'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'reorder_tasks',
      description:
        'Reorder tasks inside a project, or subtasks inside a parent task. Provide the complete ordered id list.',
      parameters: obj(
        {
          task_ids: strArr('Complete ordered list of task IDs'),
          context_id: str('Project ID or parent task ID'),
          context_type: {
            type: 'string',
            enum: ['project', 'task'],
            description: 'Whether context_id is a project or a parent task',
          },
        },
        ['task_ids', 'context_id', 'context_type'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task_with_subtasks',
      description: 'Create a parent task and its subtasks in one operation.',
      parameters: obj(
        {
          title: str('Parent task title'),
          notes: str('Parent task notes'),
          project_id: str('Project ID for the parent'),
          tag_ids: strArr('Tag IDs for the parent'),
          subtasks: {
            type: 'array',
            description: 'Subtask definitions',
            items: obj({ title: str('Subtask title'), notes: str('Subtask notes') }),
          },
        },
        ['title', 'subtasks'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_tasks_for_today',
      description: 'Plan tasks for today (adds them to the Today view) or unplan them.',
      parameters: obj(
        {
          task_ids: strArr('Task IDs to plan/unplan'),
          unplan: bool('Remove from today instead of adding (default false)'),
        },
        ['task_ids'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_worklog',
      description:
        'Worklog summary for a date range: time per day/project/tag, tasks completed, estimate accuracy.',
      parameters: obj(
        { start_date: str('Start date YYYY-MM-DD'), end_date: str('End date YYYY-MM-DD') },
        ['start_date', 'end_date'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_projects',
      description: 'Get all projects.',
      parameters: obj({}),
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: 'Create a new project.',
      parameters: obj(
        {
          title: str('Project title'),
          description: str('Project description'),
          color: str('Project color hex code, e.g. #2196F3'),
        },
        ['title'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_project',
      description: 'Update an existing project.',
      parameters: obj(
        {
          project_id: str('Project ID to update'),
          title: str('New title'),
          color: str('New color hex code'),
        },
        ['project_id'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_tags',
      description: 'Get all tags.',
      parameters: obj({}),
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_tag',
      description: 'Create a new tag.',
      parameters: obj(
        { title: str('Tag title'), color: str('Tag color hex code, e.g. #FF9800') },
        ['title'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_tag',
      description: 'Update an existing tag.',
      parameters: obj(
        {
          tag_id: str('Tag ID to update'),
          title: str('New title'),
          color: str('New color hex code'),
          icon: str('New icon'),
        },
        ['tag_id'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_active_work_context',
      description: 'Switch the active view to a project or tag.',
      parameters: obj(
        { context_id: str('Project ID or tag ID to switch to') },
        ['context_id'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_notification',
      description: 'Show an in-app snackbar notification.',
      parameters: obj(
        {
          message: str('Notification text'),
          type: {
            type: 'string',
            enum: ['SUCCESS', 'INFO', 'WARNING', 'ERROR'],
            description: 'Notification type (default INFO)',
          },
        },
        ['message'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_report_data',
      description:
        'Report data for a daily/weekly/monthly summary: tasks completed in the previous period, tasks planned for the current period, and risks derived from the data. Call this, then write the report.',
      parameters: obj(
        {
          period: {
            type: 'string',
            enum: ['day', 'week', 'month'],
            description:
              'day = yesterday vs today, week = last week vs this week, month = last month vs this month',
          },
        },
        ['period'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_notification',
      description: 'Show an in-app snackbar notification.',
      parameters: obj(
        {
          message: str('Notification text'),
          type: {
            type: 'string',
            enum: ['SUCCESS', 'INFO', 'WARNING', 'ERROR'],
            description: 'Notification type (default INFO)',
          },
        },
        ['message'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_report_data',
      description:
        'Report data for a daily/weekly/monthly summary: tasks completed in the previous period, tasks planned for the current period, and risks derived from the data. Call this, then write the report.',
      parameters: obj(
        {
          period: {
            type: 'string',
            enum: ['day', 'week', 'month'],
            description:
              'day = yesterday vs today, week = last week vs this week, month = last month vs this month',
          },
        },
        ['period'],
      ),
    },
  },
];

type Args = Record<string, unknown>;

const text = (args: Args, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};
const numValue = (args: Args, key: string): number | undefined => {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};
const boolValue = (args: Args, key: string): boolean => args[key] === true;
const strList = (args: Args, key: string): string[] =>
  Array.isArray(args[key]) ? (args[key] as unknown[]).filter((v): v is string => typeof v === 'string') : [];

const todayIso = (): string => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const startOfToday = (): number => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

const summarizeTask = (task: Task) => ({
  id: task.id,
  title: task.title,
  isDone: task.isDone,
  projectId: task.projectId,
  parentId: task.parentId ?? null,
  tagIds: task.tagIds,
  dueDay: task.dueDay ?? null,
  plannedAt: task.plannedAt ?? null,
  timeEstimate: task.timeEstimate,
  timeSpent: task.timeSpent,
  notes: task.notes ? String(task.notes).slice(0, 300) : null,
  subTaskIds: task.subTaskIds,
  doneOn: task.doneOn ?? null,
});

async function findTask(taskId: string): Promise<Task | undefined> {
  const api = getApi();
  const [open, archived] = await Promise.all([api.getTasks(), api.getArchivedTasks()]);
  return [...open, ...archived].find((t) => t.id === taskId);
}

/**
 * Runs one tool call. Never throws: failures come back as `{ error }` so the
 * model can react and the UI can render a failed action card.
 */
export async function executeTool(name: string, args: Args): Promise<Record<string, unknown>> {
  const api = getApi();
  try {
    switch (name) {
      case 'create_task': {
        return {
          success: true,
          task_id: await api.addTask({
            title: text(args, 'title') ?? '(untitled)',
            notes: text(args, 'notes') ?? '',
            tagIds: strList(args, 'tag_ids'),
            projectId: text(args, 'project_id') ?? null,
            parentId: text(args, 'parent_id') ?? null,
            dueDay: text(args, 'due_day') ?? null,
            timeEstimate: numValue(args, 'time_estimate') ?? 0,
          }),
        };
      }

      case 'get_tasks': {
        const includeArchived = boolValue(args, 'include_archived');
        let tasks = includeArchived
          ? [...(await api.getTasks()), ...(await api.getArchivedTasks())]
          : await api.getTasks();
        if (!boolValue(args, 'include_done')) tasks = tasks.filter((t) => !t.isDone);
        const projectId = text(args, 'project_id');
        if (projectId) tasks = tasks.filter((t) => t.projectId === projectId);
        const tagId = text(args, 'tag_id');
        if (tagId) tasks = tasks.filter((t) => t.tagIds?.includes(tagId));
        const query = text(args, 'search_query')?.toLowerCase();
        if (query) {
          tasks = tasks.filter(
            (t) =>
              t.title?.toLowerCase().includes(query) ||
              (t.notes ? String(t.notes).toLowerCase().includes(query) : false),
          );
        }
        if (boolValue(args, 'parents_only')) tasks = tasks.filter((t) => !t.parentId);
        if (boolValue(args, 'overdue')) {
          const today = todayIso();
          tasks = tasks.filter((t) => !!t.dueDay && t.dueDay < today);
        }
        if (boolValue(args, 'unscheduled')) {
          tasks = tasks.filter((t) => !t.dueDay && !t.dueWithTime);
        }
        if (boolValue(args, 'planned_for_today')) {
          const from = startOfToday();
          const to = from + 86_400_000;
          tasks = tasks.filter(
            (t) => typeof t.plannedAt === 'number' && t.plannedAt >= from && t.plannedAt < to,
          );
        }
        if (boolValue(args, 'recurring_only')) {
          tasks = tasks.filter((t) => t.repeatCfgId != null);
        }
        return { tasks: tasks.map(summarizeTask) };
      }

      case 'update_task': {
        const taskId = text(args, 'task_id');
        if (!taskId) return { error: 'task_id is required' };
        const update: TaskUpdatePayload = {};
        if (args.title !== undefined) update.title = String(args.title);
        if (args.notes !== undefined) update.notes = String(args.notes);
        if (args.is_done !== undefined) {
          update.isDone = boolValue(args, 'is_done');
          update.doneOn = update.isDone ? Date.now() : null;
        }
        if (args.due_day !== undefined) update.dueDay = text(args, 'due_day') ?? null;
        if (args.planned_at !== undefined) {
          // 19.x has no task-level planned field; plan/unplan goes through the
          // planner actions that back the Today view.
          if (args.planned_at === null) {
            api.dispatchAction({ type: '[Task Shared] removeTasksFromTodayTag', taskIds: [taskId] });
          } else {
            api.dispatchAction({
              type: '[Task Shared] planTasksForToday',
              taskIds: [taskId],
              today: todayIso(),
            });
          }
        }
        if (args.time_estimate !== undefined) {
          update.timeEstimate = numValue(args, 'time_estimate');
        }
        if (args.time_spent !== undefined) update.timeSpent = numValue(args, 'time_spent');
        if (args.tag_ids !== undefined) update.tagIds = strList(args, 'tag_ids');
        if (args.project_id !== undefined) {
          update.projectId = text(args, 'project_id') ?? null;
        }
        await api.updateTask(taskId, update);
        return { success: true };
      }

      case 'complete_task': {
        const taskId = text(args, 'task_id');
        if (!taskId) return { error: 'task_id is required' };
        if (!(await findTask(taskId))) return { error: `Task not found: ${taskId}` };
        await api.updateTask(taskId, { isDone: true, doneOn: Date.now() });
        return { success: true };
      }

      case 'delete_task': {
        const taskId = text(args, 'task_id');
        if (!taskId) return { error: 'task_id is required' };
        await api.deleteTask(taskId);
        return { success: true };
      }

      case 'add_tag_to_task':
      case 'remove_tag_from_task': {
        const taskId = text(args, 'task_id');
        const tagId = text(args, 'tag_id');
        if (!taskId || !tagId) return { error: 'task_id and tag_id are required' };
        const task = await findTask(taskId);
        if (!task) return { error: `Task not found: ${taskId}` };
        const tags = [...(task.tagIds ?? [])];
        if (name === 'add_tag_to_task') {
          if (!tags.includes(tagId)) tags.push(tagId);
        } else {
          const idx = tags.indexOf(tagId);
          if (idx === -1) return { error: 'Tag is not on this task' };
          tags.splice(idx, 1);
        }
        await api.updateTask(taskId, { tagIds: tags });
        return { success: true, tagIds: tags };
      }

      case 'get_current_task': {
        const task = currentTask();
        return task ? { task: summarizeTask(task) } : { task: null };
      }

      case 'start_task': {
        const taskId = text(args, 'task_id');
        if (!taskId) return { error: 'task_id is required' };
        const task = await findTask(taskId);
        if (!task) return { error: `Task not found: ${taskId}` };
        if (task.isDone) return { error: 'Cannot start tracking a completed task' };
        startTask(taskId);
        return { success: true, task_id: taskId };
      }

      case 'stop_task': {
        stopTask();
        return { success: true };
      }

      case 'bulk_complete_tasks': {
        const ids = strList(args, 'task_ids').slice(0, 100);
        const results: Array<Record<string, unknown>> = [];
        for (const id of ids) {
          try {
            await api.updateTask(id, { isDone: true, doneOn: Date.now() });
            results.push({ task_id: id, success: true });
          } catch (err) {
            results.push({ task_id: id, success: false, error: (err as Error).message });
          }
        }
        return { results };
      }

      case 'bulk_update_tasks': {
        const updates = Array.isArray(args.updates)
          ? (args.updates as Args[]).slice(0, 100)
          : [];
        const results: Array<Record<string, unknown>> = [];
        for (const entry of updates) {
          const taskId = text(entry, 'task_id');
          if (!taskId) {
            results.push({ task_id: null, success: false, error: 'task_id is required' });
            continue;
          }
          const update: TaskUpdatePayload = {};
          if (entry.title !== undefined) update.title = String(entry.title);
          if (entry.notes !== undefined) update.notes = String(entry.notes);
          if (entry.due_day !== undefined) update.dueDay = text(entry, 'due_day') ?? null;
          if (entry.tag_ids !== undefined) update.tagIds = strList(entry, 'tag_ids');
          if (entry.time_estimate !== undefined) {
            update.timeEstimate = numValue(entry, 'time_estimate');
          }
          if (entry.time_spent !== undefined) update.timeSpent = numValue(entry, 'time_spent');
          try {
            await api.updateTask(taskId, update);
            results.push({ task_id: taskId, success: true });
          } catch (err) {
            results.push({ task_id: taskId, success: false, error: (err as Error).message });
          }
        }
        return { results };
      }

      case 'move_task_to_project': {
        const taskId = text(args, 'task_id');
        const projectId = text(args, 'project_id');
        if (!taskId || !projectId) return { error: 'task_id and project_id are required' };
        await api.updateTask(taskId, { projectId });
        return { success: true };
      }

      case 'reorder_tasks': {
        const ids = strList(args, 'task_ids');
        const contextId = text(args, 'context_id');
        // The host API calls the parent-task mode 'task' ('parent' was our old alias).
        const contextType =
          args.context_type === 'task' || args.context_type === 'parent' ? 'task' : 'project';
        if (!contextId || ids.length === 0) {
          return { error: 'context_id and task_ids are required' };
        }
        await api.reorderTasks(ids, contextId, contextType);
        return { success: true };
      }

      case 'create_task_with_subtasks': {
        const projectId = text(args, 'project_id') ?? null;
        const parentId = await api.addTask({
          title: text(args, 'title') ?? '(untitled)',
          notes: text(args, 'notes') ?? '',
          projectId,
          tagIds: strList(args, 'tag_ids'),
        });
        const subtaskIds: string[] = [];
        const subtasks = Array.isArray(args.subtasks) ? (args.subtasks as Args[]) : [];
        for (const sub of subtasks) {
          subtaskIds.push(
            await api.addTask({
              title: text(sub, 'title') ?? '(untitled)',
              notes: text(sub, 'notes') ?? '',
              parentId,
              projectId,
              tagIds: [],
            }),
          );
        }
        return { parent_id: parentId, subtask_ids: subtaskIds };
      }

      case 'plan_tasks_for_today': {
        const ids = strList(args, 'task_ids').slice(0, 100);
        if (ids.length === 0) return { error: 'task_ids is required' };
        if (boolValue(args, 'unplan')) {
          api.dispatchAction({ type: '[Task Shared] removeTasksFromTodayTag', taskIds: ids });
          return { success: true, unplanned: ids.length };
        }
        api.dispatchAction({
          type: '[Task Shared] planTasksForToday',
          taskIds: ids,
          today: todayIso(),
        });
        return { success: true, planned: ids.length };
      }

      case 'get_worklog': {
        const startDate = text(args, 'start_date');
        const endDate = text(args, 'end_date');
        if (!startDate || !endDate) return { error: 'start_date and end_date are required' };
        const all = [...(await api.getTasks()), ...(await api.getArchivedTasks())];
        const daily: Record<string, number> = {};
        const byProject: Record<string, number> = {};
        const byTag: Record<string, number> = {};
        let tasksCompleted = 0;
        let estimateMs = 0;
        let actualMs = 0;

        for (const task of all) {
          const perDay = task.timeSpentOnDay ?? {};
          for (const [day, ms] of Object.entries(perDay)) {
            if (day < startDate || day > endDate) continue;
            daily[day] = (daily[day] ?? 0) + ms;
            const projectKey = task.projectId ?? 'No Project';
            byProject[projectKey] = (byProject[projectKey] ?? 0) + ms;
            for (const tagId of task.tagIds ?? []) {
              byTag[tagId] = (byTag[tagId] ?? 0) + ms;
            }
          }
          if (task.isDone && task.doneOn) {
            const done = new Date(task.doneOn);
            const doneDay = `${done.getFullYear()}-${String(done.getMonth() + 1).padStart(2, '0')}-${String(done.getDate()).padStart(2, '0')}`;
            if (doneDay >= startDate && doneDay <= endDate) {
              tasksCompleted += 1;
              if (task.timeEstimate > 0) {
                estimateMs += task.timeEstimate;
                actualMs += task.timeSpent;
              }
            }
          }
        }

        return {
          dateRange: { start: startDate, end: endDate },
          daily,
          byProject,
          byTag,
          tasksCompleted,
          estimateAccuracy:
            estimateMs > 0
              ? { estimateMs, actualMs, ratio: actualMs / estimateMs }
              : null,
        };
      }

      case 'get_projects': {
        const projects = await api.getAllProjects();
        return {
          projects: projects.map((p) => ({
            id: p.id,
            title: p.title,
            taskCount: p.taskIds?.length ?? 0,
          })),
        };
      }

      case 'create_project': {
        const color = text(args, 'color');
        const projectId = await api.addProject({
          title: text(args, 'title') ?? '(untitled)',
          ...(color ? { theme: { primary: color } } : {}),
        } as Parameters<typeof api.addProject>[0]);
        return { success: true, project_id: projectId };
      }

      case 'update_project': {
        const projectId = text(args, 'project_id');
        if (!projectId) return { error: 'project_id is required' };
        const color = text(args, 'color');
        const title = text(args, 'title');
        await api.updateProject(projectId, {
          ...(title ? { title } : {}),
          ...(color ? { theme: { primary: color } } : {}),
        } as Parameters<typeof api.updateProject>[1]);
        return { success: true };
      }

      case 'get_tags': {
        const tags = await api.getAllTags();
        return {
          tags: tags.map((t) => ({ id: t.id, title: t.title, color: t.color, icon: t.icon })),
        };
      }

      case 'create_tag': {
        const color = text(args, 'color');
        const tagId = await api.addTag({
          title: text(args, 'title') ?? '(untitled)',
          ...(color ? { color } : {}),
        } as Parameters<typeof api.addTag>[0]);
        return { success: true, tag_id: tagId };
      }

      case 'update_tag': {
        const tagId = text(args, 'tag_id');
        if (!tagId) return { error: 'tag_id is required' };
        await api.updateTag(tagId, {
          ...(args.title !== undefined ? { title: String(args.title) } : {}),
          ...(args.color !== undefined ? { color: text(args, 'color') ?? null } : {}),
          ...(args.icon !== undefined ? { icon: text(args, 'icon') ?? null } : {}),
        } as Parameters<typeof api.updateTag>[1]);
        return { success: true };
      }

      case 'set_active_work_context': {
        const contextId = text(args, 'context_id');
        if (!contextId) return { error: 'context_id is required' };
        const result = await setActiveWorkContext(contextId);
        return result.ok ? { success: true, type: result.type } : { error: result.error };
      }

      case 'get_report_data': {
        const requested = args.period;
        const period: ReportPeriod =
          requested === 'week' || requested === 'month' ? requested : 'day';
        const data = await collectReportData(period);
        return {
          data: reportDataForModel(data),
          markdownTemplate: buildReportMarkdown(data),
          templateRules:
            'Keep the three literal section titles exactly as in markdownTemplate: the previous-period title ends with a colon, the current-period and risk titles do not. Use "- " bullets, no numbered lists, no tables.',
        };
      }

      case 'show_notification': {
        const type = args.type;
        const allowed = ['SUCCESS', 'INFO', 'WARNING', 'ERROR'] as const;
        const kind = allowed.find((t) => t === type) ?? 'INFO';
        snack(text(args, 'message') ?? '', kind);
        return { success: true };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: (err as Error).message ?? String(err) };
  }
}

/** One-line summary shown on the action card. */
export function describeToolCall(name: string, args: Args): string {
  const title = text(args, 'title');
  if (title) return title;
  const taskId = text(args, 'task_id');
  if (taskId) return taskId.slice(0, 10);
  const count = Array.isArray(args.task_ids) ? (args.task_ids as unknown[]).length : 0;
  if (count > 0) return `${count} tasks`;
  if (name === 'get_worklog') {
    return `${String(args.start_date ?? '?')} → ${String(args.end_date ?? '?')}`;
  }
  const query = text(args, 'search_query');
  if (query) return query;
  return '';
}
