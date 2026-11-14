import { z } from 'zod';
import { CommandQueue } from './queue.ts';

export interface ToolDef {
  name: string;
  description: string;
  shape: Record<string, z.ZodTypeAny>;
  /** Action executed by the plugin; omitted for tools the bridge answers itself. */
  action?: string;
  /** Translates tool arguments into plugin action arguments. */
  map?: (args: Record<string, unknown>) => Record<string, unknown>;
  /** Bridge-local implementation (health/status), bypassing the plugin. */
  local?: (queue: CommandQueue) => Promise<unknown>;
}

const taskId = z.string().min(1).describe('Task id from get_tasks / create_task.');
const tags = z
  .array(z.string().min(1))
  .describe('Tag ids or (case-insensitive) tag titles.');

export const TOOLS: ToolDef[] = [
  {
    name: 'bridge_status',
    description:
      'Health of the plugin bridge: whether the plugin is polling, its version, counters and the queue folders. Call this first when a call fails.',
    shape: {},
    local: async (queue) => {
      const state = await queue.readPluginState();
      const age = state ? Date.now() - state.updatedAt : null;
      return {
        dir: queue.dirs.root,
        pluginState: state,
        heartbeatAgeMs: age,
        alive: !!state && state.enabled === true && age !== null && age < 10_000,
      };
    },
  },
  {
    name: 'get_tasks',
    description:
      'List tasks. Open tasks only by default. `tag` accepts a tag id/title or "TODAY" for the daily plan.',
    shape: {
      include_done: z.boolean().optional().describe('Also return completed tasks (default false).'),
      include_archived: z.boolean().optional().describe('Read the archive instead of active tasks.'),
      project_id: z.string().optional().describe('Only tasks of this project.'),
      tag: z.string().optional().describe('Only tasks with this tag, or "TODAY".'),
      query: z.string().optional().describe('Case-insensitive substring of title or notes.'),
      limit: z.number().int().min(1).max(500).optional().describe('Max rows (default 200).'),
    },
    action: 'get_tasks',
  },
  {
    name: 'get_task',
    description: 'One task by id, including notes and subtask ids.',
    shape: {
      task_id: taskId,
      include_notes: z.boolean().optional().describe('Include notes (default true).'),
      include_archived: z.boolean().optional().describe('Look in the archive too (default true).'),
    },
    action: 'get_task',
  },
  {
    name: 'create_task',
    description:
      'Create a task. `plan_today` also puts it on today\'s plan (the TODAY tag); `due_day` is a plain YYYY-MM-DD due date — they are different things.',
    shape: {
      title: z.string().min(1),
      notes: z.string().optional(),
      project_id: z.string().optional().describe('Target project; inbox when omitted.'),
      parent_id: z.string().optional().describe('Parent task id for a subtask.'),
      tag_ids: tags.optional(),
      tag_names: tags.optional(),
      create_missing: z.boolean().optional().describe('Create unknown tags (default false).'),
      time_estimate: z.number().int().min(0).optional().describe('Estimate in milliseconds.'),
      due_day: z.string().optional().describe('Due date YYYY-MM-DD.'),
      plan_today: z.boolean().optional().describe('Also add to today\'s plan.'),
    },
    action: 'create_task',
  },
  {
    name: 'update_task',
    description:
      'Patch a task. Only the fields you pass change; `tag_ids` replaces all tags while `add_tag_names` appends.',
    shape: {
      task_id: taskId,
      title: z.string().optional(),
      notes: z.string().optional(),
      is_done: z.boolean().optional().describe('Marks done (doneOn is set) or undone.'),
      time_estimate: z.number().int().min(0).optional().describe('Milliseconds.'),
      time_spent: z.number().int().min(0).optional().describe('Milliseconds.'),
      project_id: z.string().optional(),
      tag_ids: tags.optional().describe('Replace all tags with this list.'),
      add_tag_names: tags.optional().describe('Add these tags, keeping the existing ones.'),
      create_missing: z.boolean().optional(),
      due_day: z.string().nullable().optional().describe('Due date YYYY-MM-DD, null clears it.'),
      plan_today: z.boolean().optional().describe('Also add to today\'s plan.'),
    },
    action: 'update_task',
  },
  {
    name: 'complete_task',
    description: 'Mark a task done. Prefer this over delete_task.',
    shape: { task_id: taskId },
    action: 'complete_task',
  },
  {
    name: 'delete_task',
    description:
      'Permanently delete a task and its subtasks. Only for tasks created by mistake; otherwise use complete_task.',
    shape: { task_id: taskId },
    action: 'delete_task',
  },
  {
    name: 'reorder_tasks',
    description: 'Reorder tasks in a project (or subtasks in a parent). Pass the complete ordered id list.',
    shape: {
      task_ids: z.array(taskId).min(1).describe('Complete ordered list of task ids.'),
      context_id: z.string().min(1).describe('Project id, or the parent task id for subtasks.'),
      context_type: z.enum(['project', 'task']).optional().describe('Default "project".'),
    },
    action: 'reorder_tasks',
  },
  {
    name: 'get_projects',
    description: 'List projects with task counts.',
    shape: {
      include_archived: z.boolean().optional().describe('Include archived projects (default true).'),
    },
    action: 'get_projects',
  },
  {
    name: 'create_project',
    description: 'Create a project.',
    shape: {
      title: z.string().min(1),
      color: z.string().optional().describe('Hex colour, e.g. #4a90d9.'),
    },
    action: 'create_project',
  },
  {
    name: 'update_project',
    description: 'Rename or recolour a project.',
    shape: {
      project_id: z.string().min(1),
      title: z.string().optional(),
      color: z.string().optional(),
    },
    action: 'update_project',
  },
  {
    name: 'delete_project',
    description:
      'Delete a project. Super Productivity cascades: the tasks and backlog are moved, not deleted with it — check `get_projects` before this.',
    shape: { project_id: z.string().min(1) },
    action: 'delete_project',
  },
  {
    name: 'get_tags',
    description: 'List tags (including TODAY and its task ids).',
    shape: {},
    action: 'get_tags',
  },
  {
    name: 'create_tag',
    description: 'Create a tag.',
    shape: { title: z.string().min(1), color: z.string().optional() },
    action: 'create_tag',
  },
  {
    name: 'update_tag',
    description: 'Rename or recolour a tag.',
    shape: { tag_id: z.string().min(1), title: z.string().optional(), color: z.string().optional() },
    action: 'update_tag',
  },
  {
    name: 'add_tag_to_task',
    description: 'Add tags to a task without touching its other tags. Accepts names or ids.',
    shape: {
      task_id: taskId,
      tags,
      create_missing: z.boolean().optional().describe('Create unknown tags (default false).'),
    },
    action: 'add_tag_to_task',
  },
  {
    name: 'remove_tag_from_task',
    description: 'Remove tags from a task, leaving the rest alone.',
    shape: { task_id: taskId, tags },
    action: 'remove_tag_from_task',
  },
  {
    name: 'get_today',
    description: "Today's plan: the task ids in the TODAY tag, resolved to task summaries.",
    shape: {},
    action: 'get_today',
  },
  {
    name: 'plan_tasks_today',
    description:
      "Add tasks to today's plan (the TODAY tag). This is what the app's planner shows; task.plannedAt is unused in 19.2.0.",
    shape: { task_ids: z.array(taskId).min(1) },
    action: 'plan_tasks_today',
  },
  {
    name: 'remove_tasks_from_today',
    description: "Remove tasks from today's plan.",
    shape: { task_ids: z.array(taskId).min(1) },
    action: 'remove_tasks_from_today',
  },
  {
    name: 'get_current_task',
    description:
      'The task the timer is on. Super Productivity 19.2.0 does not expose the timer, so this mirrors the last currentTaskChange hook seen by the plugin (null until one fires).',
    shape: {},
    action: 'get_current_task',
  },
  {
    name: 'start_task',
    description: 'Start the timer on a task (starts tracking if time tracking is enabled).',
    shape: { task_id: taskId },
    action: 'start_task',
  },
  {
    name: 'stop_tracking',
    description: 'Pause the timer and flush the tracked time.',
    shape: {},
    action: 'stop_tracking',
  },
  {
    name: 'show_notification',
    description: 'Show a snack notification inside Super Productivity.',
    shape: {
      message: z.string().min(1),
      type: z.enum(['success', 'info', 'warning', 'error']).optional(),
    },
    action: 'show_notification',
  },
];
