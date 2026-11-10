import { getApi } from '@sp/plugin-kit';
import { currentTask, getWorkContext } from './host.js';

/**
 * Compact snapshot of the user's workspace, appended to every user turn so the
 * model can resolve names to ids without an extra round-trip.
 */
export async function buildAppContext(): Promise<string> {
  const api = getApi();
  try {
    const [tasks, projects, tags, context, selected] = await Promise.all([
      api.getCurrentContextTasks(),
      api.getAllProjects(),
      api.getAllTags(),
      getWorkContext(),
      api.getSelectedTask().catch(() => null),
    ]);
    const open = tasks.filter((t) => !t.isDone).slice(0, 30);
    const active = currentTask();
    return JSON.stringify({
      currentDate: new Date().toISOString().slice(0, 10),
      currentTime: new Date().toLocaleTimeString(),
      currentView: context ? { id: context.id, type: context.type, title: context.title } : null,
      currentTask: active ? { id: active.id, title: active.title } : null,
      selectedTask: selected
        ? {
            id: selected.id,
            title: selected.title,
            projectId: selected.projectId,
            parentId: selected.parentId ?? null,
            subTaskIds: selected.subTaskIds ?? [],
            timeEstimate: selected.timeEstimate,
            tagIds: selected.tagIds,
            notes: selected.notes ? String(selected.notes).slice(0, 400) : null,
          }
        : null,
      stats: { total: tasks.length, open: open.length },
      openTasks: open.map((t) => ({
        id: t.id,
        title: t.title,
        dueDay: t.dueDay ?? null,
        timeEstimate: t.timeEstimate,
      })),
      projects: projects.map((p) => ({
        id: p.id,
        title: p.title,
        taskCount: p.taskIds?.length ?? 0,
      })),
      tags: tags.map((t) => ({ id: t.id, title: t.title })),
    });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

const basePrompt = `You are Base AI Bot, an assistant embedded in Super Productivity, a task manager with time tracking.

You manage the user's tasks, projects, tags, timer and views through the provided tools.

Rules:
- Use tools for actions; never claim to have changed something you did not call a tool for.
- Fetch first when you need ids (tasks, projects, tags), then act.
- Confirm what you did in one short sentence. Match the user's language.
- Summarize tool results in human terms instead of dumping raw JSON.
- Time units: 30 min = 1800000 ms, 1 h = 3600000 ms.
- Budget: prefer one tool call over several when the API supports it.`;

export function buildSystemPrompt(): string {
  return `${basePrompt}
- Current date: ${new Date().toISOString().slice(0, 10)}

Reports (日报 / 周报 / 月度总结):
- Call get_report_data first, then write the report from that data. Do not invent items.
- Output exactly three sections, reusing the literal titles from the tool's markdownTemplate:
  "## <previous period>事项：" (ends with a colon), "## <current period>事项" and "## 风险和关注" (no colon).
- One "- " bullet per item. No tables, no numbering, no extra sections, no closing summary.`;
}
