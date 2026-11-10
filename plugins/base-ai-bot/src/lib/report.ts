import { getApi, type Task } from '@sp/plugin-kit';

/**
 * Report windows follow one rule everywhere: **previous period vs current
 * period**. Day = yesterday/today, week = last week/this week (Mon–Sun),
 * month = last month/this month.
 */
export type ReportPeriod = 'day' | 'week' | 'month';

export interface PeriodWindow {
  prevStart: number;
  prevEnd: number;
  curStart: number;
  curEnd: number;
  prevLabel: string;
  curLabel: string;
}

export interface ReportItem {
  title: string;
  dueDay?: string | null;
  /** `done` = completed in the period, `progress` = tracked time in the period. */
  kind: 'done' | 'progress';
  /** Tracked milliseconds inside the period. */
  trackedMs: number;
}

export interface ReportData {
  period: ReportPeriod;
  prevLabel: string;
  curLabel: string;
  /** Everything touched in the previous period: completed or time-tracked. */
  previousItems: ReportItem[];
  /** Everything touched in the current period, plus what is planned for it. */
  currentItems: ReportItem[];
  risks: string[];
  stats: {
    previousCount: number;
    currentCount: number;
    /** Tasks that are on the plan for the current period. */
    plannedCount: number;
    trackedMsPrev: number;
    openCount: number;
    overdueCount: number;
  };
}

const DAY_MS = 86_400_000;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Monday-based week start (Chinese convention). */
function startOfWeek(date: Date): Date {
  const offset = (date.getDay() + 6) % 7;
  return addDays(startOfDay(date), -offset);
}

export function currentWindow(period: ReportPeriod, now = new Date()): PeriodWindow {
  if (period === 'day') {
    const curStart = startOfDay(now);
    const prevStart = addDays(curStart, -1);
    return {
      prevStart: prevStart.getTime(),
      prevEnd: curStart.getTime(),
      curStart: curStart.getTime(),
      curEnd: curStart.getTime() + DAY_MS,
      prevLabel: '昨日',
      curLabel: '今日',
    };
  }
  if (period === 'week') {
    const curStart = startOfWeek(now);
    const prevStart = addDays(curStart, -7);
    return {
      prevStart: prevStart.getTime(),
      prevEnd: curStart.getTime(),
      curStart: curStart.getTime(),
      curEnd: addDays(curStart, 7).getTime(),
      prevLabel: '上周',
      curLabel: '本周',
    };
  }
  const curStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    prevStart: prevStart.getTime(),
    prevEnd: curStart.getTime(),
    curStart: curStart.getTime(),
    curEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
    prevLabel: '上月',
    curLabel: '本月',
  };
}

/**
 * In Super Productivity 19.x the Today plan is NOT stored on `task.plannedAt`
 * (that field is dead — nothing reads it). The plan lives in the planner day
 * state and, for plugins, is only observable through the TODAY tag's `taskIds`.
 */
const TODAY_TAG_ID = 'TODAY';

const inWindow = (value: number | null | undefined, start: number, end: number): boolean =>
  typeof value === 'number' && value >= start && value < end;

function realDayOf(task: Task): string | null {
  if (task.dueDay) return task.dueDay;
  if (task.dueWithTime) return isoDay(new Date(task.dueWithTime));
  return null;
}

function trackedMsInWindow(task: Task, start: number, end: number): number {
  const perDay = task.timeSpentOnDay ?? {};
  let total = 0;
  for (const [day, ms] of Object.entries(perDay)) {
    const ts = new Date(`${day}T00:00:00`).getTime();
    if (ts >= start && ts < end) total += ms;
  }
  return total;
}

export async function collectReportData(
  period: ReportPeriod,
  now = new Date(),
): Promise<ReportData> {
  const api = getApi();
  const window = currentWindow(period, now);
  const [open, archived, tags] = await Promise.all([
    api.getTasks(),
    api.getArchivedTasks(),
    api.getAllTags().catch(() => []),
  ]);
  const todayPlanIds = new Set(
    tags.find((tag) => tag.id === TODAY_TAG_ID)?.taskIds ?? [],
  );

  const byId = new Map<string, Task>();
  for (const task of [...open, ...archived]) {
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  const all = [...byId.values()];

  const todayIso = isoDay(now);

  interface Scored {
    task: Task;
    doneInWindow: boolean;
    trackedMs: number;
    planned: boolean;
  }

  const score = (task: Task, start: number, end: number): Scored => ({
    task,
    doneInWindow: inWindow(task.doneOn, start, end),
    trackedMs: trackedMsInWindow(task, start, end),
    planned: false,
  });

  /** Completed inside the window, or any time tracked inside it. */
  const touched = (start: number, end: number): Scored[] =>
    all
      .map((task) => score(task, start, end))
      .filter((entry) => entry.doneInWindow || entry.trackedMs > 0);

  const toItems = (entries: Scored[]): ReportItem[] =>
    entries.map((entry) => ({
      title: entry.task.title,
      dueDay: realDayOf(entry.task),
      kind: entry.doneInWindow ? 'done' : 'progress',
      trackedMs: entry.trackedMs,
    }));

  const sortEntries = (entries: Scored[]): Scored[] =>
    [...entries].sort((a, b) => {
      if (a.doneInWindow !== b.doneInWindow) return a.doneInWindow ? -1 : 1;
      if (a.doneInWindow) return (a.task.doneOn ?? 0) - (b.task.doneOn ?? 0);
      return b.trackedMs - a.trackedMs;
    });

  // Previous period: finished work plus work that only got time.
  const previousItems = toItems(sortEntries(touched(window.prevStart, window.prevEnd)));

  // Current period: touched work + today's plan + (week/month) anything due in it.
  const plannedEntries: Scored[] = all
    .filter((task) => {
      if (task.isDone) return false;
      if (todayPlanIds.has(task.id)) return true;
      if (inWindow(task.plannedAt, window.curStart, window.curEnd)) return true;
      if (period === 'day') return false;
      const dueDay = realDayOf(task);
      if (!dueDay) return false;
      const dueTs = new Date(`${dueDay}T00:00:00`).getTime();
      return dueTs >= window.curStart && dueTs < window.curEnd;
    })
    .map((task) => ({ ...score(task, window.curStart, window.curEnd), planned: true }));

  const touchedCurrent = touched(window.curStart, window.curEnd);
  const touchedCurrentIds = new Set(touchedCurrent.map((entry) => entry.task.id));
  const currentEntries = sortEntries([
    ...touchedCurrent,
    ...plannedEntries.filter((entry) => !touchedCurrentIds.has(entry.task.id)),
  ]);

  const previousItemsCapped = capItems(previousItems);
  const currentItemsCapped = capItems(toItems(currentEntries));
  const planned = plannedEntries;

  const risks: string[] = [];
  /** One risk line per task: first matching category wins, so no duplicates. */
  const flagged = new Set<string>();

  const overdue = all
    .filter((t) => !t.isDone && !!realDayOf(t) && (realDayOf(t) as string) < todayIso)
    .sort((a, b) => (realDayOf(a) as string).localeCompare(realDayOf(b) as string));

  for (const task of overdue.slice(0, 5)) {
    const day = realDayOf(task) as string;
    const daysLate = Math.round(
      (new Date(`${todayIso}T00:00:00`).getTime() - new Date(`${day}T00:00:00`).getTime()) /
        DAY_MS,
    );
    flagged.add(task.id);
    risks.push(`逾期 ${daysLate} 天：${task.title}`);
  }
  if (overdue.length > 5) risks.push(`另有 ${overdue.length - 5} 个逾期任务未列出`);

  const deadlineSoon = all
    .filter((t) => {
      if (t.isDone || !t.deadlineDay || flagged.has(t.id)) return false;
      const dueTs = new Date(`${t.deadlineDay}T00:00:00`).getTime();
      return dueTs >= window.curStart && dueTs < window.curEnd;
    })
    .sort((a, b) => (a.deadlineDay as string).localeCompare(b.deadlineDay as string));
  for (const task of deadlineSoon.slice(0, 3)) {
    flagged.add(task.id);
    risks.push(`临近截止（${task.deadlineDay}）：${task.title}`);
  }

  const overBudget = all
    .filter(
      (t) =>
        !t.isDone &&
        !flagged.has(t.id) &&
        t.timeEstimate > 0 &&
        t.timeSpent > t.timeEstimate * 1.2,
    )
    .sort((a, b) => b.timeSpent / b.timeEstimate - a.timeSpent / a.timeEstimate);
  for (const task of overBudget.slice(0, 3)) {
    flagged.add(task.id);
    const pct = Math.round((task.timeSpent / task.timeEstimate) * 100);
    risks.push(`超出估算（${pct}%）：${task.title}`);
  }

  const unplannedInvested = all.filter(
    (t) =>
      !t.isDone &&
      !flagged.has(t.id) &&
      t.timeSpent > 0 &&
      !todayPlanIds.has(t.id) &&
      !t.plannedAt &&
      !realDayOf(t),
  );
  for (const task of unplannedInvested.slice(0, 3)) {
    flagged.add(task.id);
    risks.push(`已投入但未排期：${task.title}`);
  }

  if (planned.length === 0) {
    risks.push(`${window.curLabel}还没有任何计划任务`);
  }
  if (period === 'day' && todayPlanIds.size === 0) {
    risks.push('今天的计划清单（Today）是空的');
  }

  const trackedMsPrev = all.reduce(
    (sum, task) => sum + trackedMsInWindow(task, window.prevStart, window.prevEnd),
    0,
  );

  return {
    period,
    prevLabel: window.prevLabel,
    curLabel: window.curLabel,
    previousItems: previousItemsCapped,
    currentItems: currentItemsCapped,
    risks: risks.slice(0, 8),
    stats: {
      previousCount: previousItems.length,
      currentCount: currentEntries.length,
      plannedCount: planned.length,
      trackedMsPrev,
      openCount: all.filter((t) => !t.isDone).length,
      overdueCount: overdue.length,
    },
  };
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

const MAX_ITEMS_PER_SECTION = 20;

/** Caps a section and appends one summary line instead of silently dropping items. */
function capItems(items: ReportItem[]): ReportItem[] {
  if (items.length <= MAX_ITEMS_PER_SECTION) return items;
  const shown = items.slice(0, MAX_ITEMS_PER_SECTION);
  shown.push({
    title: `另有 ${items.length - MAX_ITEMS_PER_SECTION} 项未列出`,
    kind: 'progress',
    trackedMs: 0,
  });
  return shown;
}

/**
 * Fixed template — the section titles are literal, do not "improve" them:
 * `## 昨日事项：` has a colon, `## 今日事项` and `## 风险和关注` do not.
 */
export function buildReportMarkdown(data: ReportData): string {
  const section = (items: string[]): string =>
    items.length > 0 ? items.map((line) => `- ${line}`).join('\n') : '- （无）';

  return [
    `## ${data.prevLabel}事项：`,
    section(data.previousItems.map((item) => item.title)),
    '',
    `## ${data.curLabel}事项`,
    section(data.currentItems.map((item) => item.title)),
    '',
    '## 风险和关注',
    section(data.risks),
  ].join('\n');
}

/** Compact payload for the model; keeps counts and time, drops nothing useful. */
export function reportDataForModel(data: ReportData): Record<string, unknown> {
  return {
    period: data.period,
    previousPeriod: data.prevLabel,
    currentPeriod: data.curLabel,
    previousPeriodItems: data.previousItems.map((item) => ({
      title: item.title,
      kind: item.kind,
      tracked: formatDuration(item.trackedMs),
    })),
    currentPeriodItems: data.currentItems.map((item) => ({
      title: item.title,
      kind: item.kind,
      dueDay: item.dueDay ?? null,
      tracked: formatDuration(item.trackedMs),
    })),
    risks: data.risks,
    stats: { ...data.stats, trackedPrev: formatDuration(data.stats.trackedMsPrev) },
  };
}
