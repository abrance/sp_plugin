import type { PluginApi, Project, Tag, Task, TaskUpdatePayload } from '@sp/plugin-kit';

export interface ActionContext {
  api: PluginApi;
  getCurrentTaskId(): string | null;
  log(message: string): void;
}

export type ActionHandler = (
  args: Record<string, unknown>,
  ctx: ActionContext,
) => Promise<unknown>;

const str = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const strList = (args: Record<string, unknown>, key: string): string[] => {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
};

const num = (args: Record<string, unknown>, key: string): number | undefined => {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const bool = (args: Record<string, unknown>, key: string): boolean | undefined => {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
};

function todayStr(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function summarize(task: Task, includeNotes = false) {
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    tagIds: task.tagIds,
    parentId: task.parentId ?? null,
    isDone: task.isDone,
    timeEstimate: task.timeEstimate,
    timeSpent: task.timeSpent,
    dueDay: task.dueDay ?? null,
    dueWithTime: task.dueWithTime ?? null,
    deadlineDay: task.deadlineDay ?? null,
    doneOn: task.doneOn ?? null,
    createdAt: task.created,
    ...(includeNotes ? { notes: task.notes ?? '' } : {}),
  };
}

function summarizeProject(project: Project) {
  return {
    id: project.id,
    title: project.title,
    color: project.theme?.primary ?? null,
    taskCount: project.taskIds?.length ?? 0,
    backlogCount: project.backlogTaskIds?.length ?? 0,
    isArchived: project.isArchived === true,
    isEnabledBacklog: project.isEnableBacklog === true,
  };
}

function summarizeTag(tag: Tag) {
  return {
    id: tag.id,
    title: tag.title,
    color: tag.color ?? null,
    taskCount: tag.taskIds?.length ?? 0,
  };
}

/** Accepts tag ids or (case-insensitive) tag titles; optionally creates missing ones. */
async function resolveTagIds(
  api: PluginApi,
  values: string[],
  createMissing: boolean,
): Promise<string[]> {
  if (values.length === 0) return [];
  const tags = await api.getAllTags();
  const byId = new Map(tags.map((t) => [t.id, t]));
  const byTitle = new Map(tags.map((t) => [t.title.trim().toLowerCase(), t]));
  const out: string[] = [];
  for (const value of values) {
    const direct = byId.get(value);
    if (direct) {
      out.push(direct.id);
      continue;
    }
    const named = byTitle.get(value.trim().toLowerCase());
    if (named) {
      out.push(named.id);
      continue;
    }
    if (!createMissing) {
      throw new Error(`unknown tag "${value}" — pass create_missing=true to create it`);
    }
    const created = await api.addTag({ title: value.trim() });
    byId.set(created, { id: created, title: value.trim() } as Tag);
    byTitle.set(value.trim().toLowerCase(), { id: created, title: value.trim() } as Tag);
    out.push(created);
  }
  return [...new Set(out)];
}

async function findTask(api: PluginApi, taskId: string, includeArchived = false): Promise<Task> {
  const tasks = await api.getTasks();
  const hit = tasks.find((t) => t.id === taskId);
  if (hit) return hit;
  if (includeArchived) {
    const archived = await api.getArchivedTasks();
    const old = archived.find((t) => t.id === taskId);
    if (old) return old;
  }
  throw new Error(`task ${taskId} not found — call get_tasks for current ids`);
}

async function planToday(api: PluginApi, taskIds: string[]): Promise<unknown> {
  api.dispatchAction({
    type: '[Task Shared] planTasksForToday',
    taskIds,
    today: todayStr(),
  });
  return { planned: taskIds.length, today: todayStr() };
}

export const ACTIONS: Record<string, ActionHandler> = {
  /** Liveness probe used by the bridge's health check and by the UI self-test. */
  async ping(_args, ctx) {
    const tasks = await ctx.api.getTasks();
    return { pong: true, openTasks: tasks.length, today: todayStr() };
  },

  async get_tasks(args, ctx) {
    const includeDone = bool(args, 'include_done') ?? false;
    const includeArchived = bool(args, 'include_archived') ?? false;
    const projectId = str(args, 'project_id');
    const tagRef = str(args, 'tag');
    const query = str(args, 'query')?.toLowerCase();
    const limit = Math.min(500, Math.max(1, num(args, 'limit') ?? 200));

    let tasks = includeArchived ? await ctx.api.getArchivedTasks() : await ctx.api.getTasks();
    if (!includeDone) tasks = tasks.filter((t) => !t.isDone);
    if (projectId) tasks = tasks.filter((t) => t.projectId === projectId);
    if (tagRef) {
      const [tagId] = tagRef === 'TODAY' ? ['TODAY'] : await resolveTagIds(ctx.api, [tagRef], false);
      tasks = tasks.filter((t) => t.tagIds.includes(tagId));
    }
    if (query) {
      tasks = tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          (t.notes ?? '').toLowerCase().includes(query),
      );
    }
    return {
      total: tasks.length,
      truncated: tasks.length > limit,
      tasks: tasks.slice(0, limit).map((t) => summarize(t)),
    };
  },

  async get_task(args, ctx) {
    const taskId = str(args, 'task_id');
    if (!taskId) throw new Error('task_id is required');
    const task = await findTask(ctx.api, taskId, bool(args, 'include_archived') ?? true);
    return {
      task: summarize(task, bool(args, 'include_notes') ?? true),
      subtaskIds: task.subTaskIds ?? [],
    };
  },

  async create_task(args, ctx) {
    const title = str(args, 'title');
    if (!title) throw new Error('title is required');
    const tagIds = [
      ...strList(args, 'tag_ids'),
      ...(await resolveTagIds(ctx.api, strList(args, 'tag_names'), bool(args, 'create_missing') ?? false)),
    ];
    const timeEstimate = num(args, 'time_estimate');
    const id = await ctx.api.addTask({
      title,
      notes: str(args, 'notes'),
      projectId: str(args, 'project_id') ?? null,
      parentId: str(args, 'parent_id') ?? null,
      tagIds: tagIds.length > 0 ? [...new Set(tagIds)] : undefined,
      timeEstimate,
      dueDay: str(args, 'due_day') ?? null,
    });
    if (bool(args, 'plan_today')) await planToday(ctx.api, [id]);
    return { id };
  },

  async update_task(args, ctx) {
    const taskId = str(args, 'task_id');
    if (!taskId) throw new Error('task_id is required');
    const updates: TaskUpdatePayload = {};
    const title = str(args, 'title');
    const notes = args['notes'];
    const isDone = bool(args, 'is_done');
    const timeEstimate = num(args, 'time_estimate');
    const timeSpent = num(args, 'time_spent');
    const projectId = str(args, 'project_id');
    const dueDay = args['due_day'];

    if (title !== undefined) updates.title = title;
    if (typeof notes === 'string') updates.notes = notes;
    if (isDone !== undefined) {
      updates.isDone = isDone;
      updates.doneOn = isDone ? Date.now() : null;
    }
    if (timeEstimate !== undefined) updates.timeEstimate = timeEstimate;
    if (timeSpent !== undefined) updates.timeSpent = timeSpent;
    if (projectId !== undefined) updates.projectId = projectId;
    if (typeof dueDay === 'string' || dueDay === null) updates.dueDay = dueDay;

    const addTags = await resolveTagIds(
      ctx.api,
      strList(args, 'add_tag_names'),
      bool(args, 'create_missing') ?? false,
    );
    const requestedTagIds = strList(args, 'tag_ids');
    const explicitTags =
      requestedTagIds.length > 0
        ? await resolveTagIds(ctx.api, requestedTagIds, bool(args, 'create_missing') ?? false)
        : [];
    if (explicitTags.length > 0 || addTags.length > 0) {
      const current = await findTask(ctx.api, taskId);
      const base = explicitTags.length > 0 ? explicitTags : current.tagIds;
      updates.tagIds = [...new Set([...base, ...addTags])];
    }

    if (Object.keys(updates).length === 0) throw new Error('nothing to update');
    await ctx.api.updateTask(taskId, updates);
    if (bool(args, 'plan_today') === true) await planToday(ctx.api, [taskId]);
    const after = await findTask(ctx.api, taskId);
    return { updated: summarize(after) };
  },

  async complete_task(args, ctx) {
    const taskId = str(args, 'task_id');
    if (!taskId) throw new Error('task_id is required');
    await findTask(ctx.api, taskId);
    await ctx.api.updateTask(taskId, { isDone: true, doneOn: Date.now() });
    return { id: taskId, isDone: true };
  },

  async delete_task(args, ctx) {
    const taskId = str(args, 'task_id');
    if (!taskId) throw new Error('task_id is required');
    await findTask(ctx.api, taskId);
    await ctx.api.deleteTask(taskId);
    return { deleted: taskId };
  },

  async reorder_tasks(args, ctx) {
    const taskIds = strList(args, 'task_ids');
    const contextId = str(args, 'context_id');
    const contextType = str(args, 'context_type') ?? 'project';
    if (taskIds.length === 0) throw new Error('task_ids is required');
    if (!contextId) throw new Error('context_id is required');
    if (contextType !== 'project' && contextType !== 'task') {
      throw new Error('context_type must be "project" or "task"');
    }
    await ctx.api.reorderTasks(taskIds, contextId, contextType);
    return { reordered: taskIds.length, contextId, contextType };
  },

  async get_projects(args, ctx) {
    const includeArchived = bool(args, 'include_archived') ?? true;
    const projects = await ctx.api.getAllProjects();
    const list = includeArchived ? projects : projects.filter((p) => !p.isArchived);
    return { total: list.length, projects: list.map(summarizeProject) };
  },

  async create_project(args, ctx) {
    const title = str(args, 'title');
    if (!title) throw new Error('title is required');
    const color = str(args, 'color');
    const id = await ctx.api.addProject({ title, theme: color ? { primary: color } : undefined });
    return { id };
  },

  async update_project(args, ctx) {
    const projectId = str(args, 'project_id');
    if (!projectId) throw new Error('project_id is required');
    const updates: Partial<Project> = {};
    const title = str(args, 'title');
    const color = str(args, 'color');
    if (title !== undefined) updates.title = title;
    if (color !== undefined) updates.theme = { primary: color };
    if (Object.keys(updates).length === 0) throw new Error('nothing to update');
    await ctx.api.updateProject(projectId, updates);
    return { updated: projectId };
  },

  async get_tags(_args, ctx) {
    const tags = await ctx.api.getAllTags();
    return {
      total: tags.length,
      tags: tags.map(summarizeTag),
      today: tags.find((t) => t.id === 'TODAY')?.taskIds ?? [],
    };
  },

  async create_tag(args, ctx) {
    const title = str(args, 'title');
    if (!title) throw new Error('title is required');
    const color = str(args, 'color');
    const id = await ctx.api.addTag({ title, color: color ?? null });
    return { id };
  },

  async update_tag(args, ctx) {
    const tagId = str(args, 'tag_id');
    if (!tagId) throw new Error('tag_id is required');
    const updates: Partial<Tag> = {};
    const title = str(args, 'title');
    const color = str(args, 'color');
    if (title !== undefined) updates.title = title;
    if (color !== undefined) updates.color = color;
    if (Object.keys(updates).length === 0) throw new Error('nothing to update');
    await ctx.api.updateTag(tagId, updates);
    return { updated: tagId };
  },

  async add_tag_to_task(args, ctx) {
    const taskId = str(args, 'task_id');
    if (!taskId) throw new Error('task_id is required');
    const values = [...strList(args, 'tags'), ...strList(args, 'tag_names')];
    if (values.length === 0) throw new Error('tags is required');
    const ids = await resolveTagIds(ctx.api, values, bool(args, 'create_missing') ?? false);
    const task = await findTask(ctx.api, taskId);
    const next = [...new Set([...task.tagIds, ...ids])];
    await ctx.api.updateTask(taskId, { tagIds: next });
    return { taskId, tagIds: next };
  },

  async remove_tag_from_task(args, ctx) {
    const taskId = str(args, 'task_id');
    if (!taskId) throw new Error('task_id is required');
    const values = [...strList(args, 'tags'), ...strList(args, 'tag_names')];
    if (values.length === 0) throw new Error('tags is required');
    const ids = await resolveTagIds(ctx.api, values, false);
    const task = await findTask(ctx.api, taskId);
    const next = task.tagIds.filter((id) => !ids.includes(id));
    await ctx.api.updateTask(taskId, { tagIds: next });
    return { taskId, tagIds: next };
  },

  async plan_tasks_today(args, ctx) {
    const taskIds = strList(args, 'task_ids');
    if (taskIds.length === 0) throw new Error('task_ids is required');
    return planToday(ctx.api, taskIds);
  },

  async remove_tasks_from_today(args, ctx) {
    const taskIds = strList(args, 'task_ids');
    if (taskIds.length === 0) throw new Error('task_ids is required');
    ctx.api.dispatchAction({ type: '[Task Shared] removeTasksFromTodayTag', taskIds });
    return { removed: taskIds.length };
  },

  async get_today(_args, ctx) {
    const [tasks, tags] = await Promise.all([ctx.api.getTasks(), ctx.api.getAllTags()]);
    const ids = tags.find((t) => t.id === 'TODAY')?.taskIds ?? [];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return {
      today: todayStr(),
      total: ids.length,
      tasks: ids
        .map((id) => byId.get(id))
        .filter((t): t is Task => !!t)
        .map((t) => summarize(t)),
    };
  },

  async start_task(args, ctx) {
    const taskId = str(args, 'task_id');
    if (!taskId) throw new Error('task_id is required');
    await findTask(ctx.api, taskId);
    ctx.api.dispatchAction({ type: '[Task] SetCurrentTask', id: taskId });
    return { started: taskId };
  },

  async stop_tracking(_args, ctx) {
    ctx.api.dispatchAction({ type: '[Task] UnsetCurrentTask' });
    return { stopped: true, wasTracking: ctx.getCurrentTaskId() };
  },

  /**
   * The active timer is not exposed by `getAppState()`; the plugin mirrors the
   * `currentTaskChange` hook instead (see runner.ts).
   */
  async get_current_task(_args, ctx) {
    const taskId = ctx.getCurrentTaskId();
    if (!taskId) return { task: null, tracked: false };
    const tasks = await ctx.api.getTasks();
    const task = tasks.find((t) => t.id === taskId);
    return { task: task ? summarize(task) : null, tracked: !!task, taskId };
  },

  async show_notification(args, ctx) {
    const message = str(args, 'message');
    if (!message) throw new Error('message is required');
    const type = (str(args, 'type') ?? 'info').toUpperCase();
    if (type === 'SUCCESS' || type === 'ERROR' || type === 'INFO' || type === 'WARNING') {
      ctx.api.showSnack({ msg: message, type });
    } else {
      throw new Error('type must be success, error, info or warning');
    }
    return { shown: message };
  },
};

export const ACTION_NAMES = Object.keys(ACTIONS).sort();
