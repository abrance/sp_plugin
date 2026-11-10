import { createLogger } from '@sp/plugin-kit';
import { createSignal } from 'solid-js';
import { apiKey, config } from './config.js';
import { completeChat } from './llm.js';
import {
  activeConversation,
  appendMessage,
  autoTitleActive,
  messages,
  patchMessage,
  renameConversation,
} from './conversations.js';
import { buildAppContext, buildSystemPrompt } from './prompt.js';
import {
  buildReportMarkdown,
  collectReportData,
  reportDataForModel,
  type ReportPeriod,
} from './report.js';
import { describeToolCall, executeTool } from './tools.js';
import {
  abortPiRun,
  describePiTool,
  messageErrorMessage,
  messageRole,
  messageStopReason,
  messageText,
  messageThinking,
  pollPiRun,
  startPiRun,
  type PiEvent,
} from './piAgent.js';
import { APP_CONTEXT_MARKER, type ActionResult, type ToolCallRef } from './types.js';

const log = createLogger('base-ai-bot');
const MAX_ROUNDS = 10;
const PI_POLL_MS = 700;
const PI_MAX_RUNTIME_MS = 20 * 60 * 1000;

const [isProcessing, setProcessing] = createSignal(false);
export { isProcessing };

export interface UiError {
  id: number;
  message: string;
}

const [errors, setErrors] = createSignal<UiError[]>([]);
export { errors };

let errorSeq = 0;
export function pushError(message: string): void {
  errorSeq += 1;
  setErrors((list) => [...list, { id: errorSeq, message }]);
}
export function dismissError(id: number): void {
  setErrors((list) => list.filter((e) => e.id !== id));
}

let controller: AbortController | null = null;
let activePiRunId: string | null = null;
let piCancelled = false;

export function cancelChat(): void {
  if (activePiRunId) {
    piCancelled = true;
    void abortPiRun(activePiRunId);
    return;
  }
  controller?.abort();
}

function parseArgs(call: ToolCallRef): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    log.warn('could not parse tool arguments', call.function.name);
    return {};
  }
}

/**
 * Builds a report locally (no model call) and posts it as an assistant turn.
 * The message carries `report` so the UI can offer copy / AI-rewrite.
 */
export async function sendLocalReport(period: ReportPeriod): Promise<void> {
  if (isProcessing()) return;
  setProcessing(true);
  try {
    const data = await collectReportData(period);
    const active = activeConversation();
    if (active && active.title === 'New Chat') {
      renameConversation(active.id, `${data.prevLabel}/${data.curLabel}报表`);
    }
    appendMessage({
      role: 'assistant',
      content: buildReportMarkdown(data),
      ts: Date.now(),
      report: { period, label: `${data.prevLabel}/${data.curLabel}` },
    });
  } catch (err) {
    log.error('report build failed', err);
    pushError(`生成报表失败：${(err as Error).message}`);
  } finally {
    setProcessing(false);
  }
}

/** Entry point: routes the turn to the configured backend. */
export async function sendChatMessage(rawText: string): Promise<void> {
  const userText = rawText.trim();
  if (!userText || isProcessing()) return;

  if (config().agentMode === 'pi') {
    await sendPiTurn(userText);
    return;
  }
  await sendDirectTurn(userText);
}

// ------------------------------------------------------------------ direct mode

async function sendDirectTurn(userText: string): Promise<void> {
  const key = apiKey();
  if (!key) {
    pushError('Add your API key in settings first (gear icon).');
    return;
  }

  setProcessing(true);
  controller = new AbortController();
  const settings = config();

  try {
    const context = await buildAppContext();
    appendMessage({
      role: 'user',
      content: `${userText}${APP_CONTEXT_MARKER}${context}`,
      ts: Date.now(),
    });

    const actions: ActionResult[] = [];
    let round = 0;

    while (round < MAX_ROUNDS) {
      const reply = await completeChat({
        config: settings,
        apiKey: key,
        systemPrompt: buildSystemPrompt(),
        messages: messages(),
        signal: controller.signal,
      });
      round += 1;

      if (reply.tool_calls?.length) {
        appendMessage({
          role: 'assistant',
          content: reply.content ?? null,
          tool_calls: reply.tool_calls,
          ...(reply.reasoning_content ? { reasoning_content: reply.reasoning_content } : {}),
          ts: Date.now(),
        });

        for (const call of reply.tool_calls) {
          const args = parseArgs(call);
          const result = await executeTool(call.function.name, args);
          actions.push({
            name: call.function.name,
            args,
            ok: !('error' in result),
            detail: describeToolCall(call.function.name, args),
          });
          appendMessage({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 6000),
            ts: Date.now(),
          });
        }
        continue;
      }

      appendMessage({
        role: 'assistant',
        content: reply.content ?? '(no response)',
        origin: 'direct',
        ...(reply.reasoning_content ? { reasoning_content: reply.reasoning_content } : {}),
        ...(actions.length > 0 ? { actions } : {}),
        ts: Date.now(),
      });
      break;
    }

    if (round >= MAX_ROUNDS) {
      appendMessage({
        role: 'assistant',
        content: '_Stopped after the maximum number of tool rounds._',
        origin: 'direct',
        ...(actions.length > 0 ? { actions } : {}),
        ts: Date.now(),
      });
    }
  } catch (err) {
    const error = err as Error;
    if (error.name === 'AbortError') {
      appendMessage({ role: 'assistant', content: '_Cancelled._', ts: Date.now() });
    } else {
      log.error('chat failed', error);
      pushError(error.message || String(error));
    }
  } finally {
    controller = null;
    setProcessing(false);
    autoTitleActive();
  }
}

// --------------------------------------------------------------------- pi mode

const REPORT_HINTS: Array<{ period: ReportPeriod; pattern: RegExp }> = [
  { period: 'month', pattern: /月报|月度(总结|汇报|报告)|monthly/i },
  { period: 'week', pattern: /周报|weekly/i },
  { period: 'day', pattern: /日报|daily|今日(总结|汇报)/i },
];

const DECOMPOSE_INTENT = /拆解|拆分|拆一下|拆成|拆分任务|break\s*down|decompose/i;
const TRIAGE_INTENT = /估时|估算|多久|工时|打标签|加标签|优先级|important|urgent|分诊|\.triage/i;

const SKILL_HINTS = [
  '[本机 skill]',
  '任务相关能力已装在 ~/.pi/agent/skills/ 下，按需先读再动手：',
  '- sp-task-decompose：拆解流程（草案→「确认」→落库→撤销）',
  '- sp-task-triage：估算分档 / 执行类型标签判据 / 优先级保守规则；判断前先读它的 CORRECTIONS.md',
  '估算、执行类型、优先级一律按 sp-task-triage 判定；用户纠正后先改任务、再往 CORRECTIONS.md 追加一条样例。',
  '未确认（拆解类）之前不得调用任何写操作；需要写库时用 mcp__super_productivity 代理。',
].join('\n');

const REPORT_RULES = [
  '写报表规则（当用户要日报/周报/月度总结时）：',
  '- 严格三段，标题字面为 "## <previousPeriod>事项："（带冒号）、"## <currentPeriod>事项"、"## 风险和关注"（不带冒号）。',
  '- 每条以 "- " 开头，一段一个列表；空段写 "- （无）"。',
  '- 只用 [SP 报表数据] 里的事实，不要编造；不要表格、编号或额外段落。',
].join('\n');

/**
 * Pi has the file/bash tools but no Super Productivity tools, so a plain
 * "写日报" would only produce empty section titles. When the turn looks like a
 * report request, attach the same precomputed data the local report uses.
 */
async function buildReportDigest(userText: string): Promise<string | null> {
  const periods = [...new Set(
    REPORT_HINTS.filter((hint) => hint.pattern.test(userText)).map((hint) => hint.period),
  )];
  if (periods.length === 0) return null;

  const blocks: string[] = [];
  for (const period of periods) {
    try {
      const data = await collectReportData(period);
      blocks.push(JSON.stringify(reportDataForModel(data)));
    } catch (err) {
      log.warn('report digest failed', period, err);
    }
  }
  if (blocks.length === 0) return null;
  return `${blocks.join('\n')}\n\n${REPORT_RULES}`;
}

function piSessionIdFor(conversationId: string | null): string {
  const base = (conversationId ?? 'default').replace(/[^A-Za-z0-9._-]/g, '-');
  return `sp-${base}`;
}

interface PiTurnState {
  /** Text of finished assistant messages (a turn can contain several rounds). */
  committed: string;
  /** Text of the assistant message currently streaming. */
  current: string;
  thinking: string | null;
  actions: ActionResult[];
  errorMessage: string | null;
  aborted: boolean;
  settled: boolean;
  notes: string[];
}

function piDisplayText(state: PiTurnState): string {
  if (!state.current.trim()) return state.committed.trim();
  return `${state.committed ? `${state.committed.trim()}\n\n` : ''}${state.current.trim()}`;
}

function applyPiEvent(state: PiTurnState, event: PiEvent, index: number): void {
  switch (event.type) {
    case 'message_update': {
      const update = event.assistantMessageEvent as
        | { type?: string; delta?: string }
        | undefined;
      if (update?.type === 'text_delta' && typeof update.delta === 'string') {
        state.current += update.delta;
        patchLive(index, state);
      } else if (update?.type === 'thinking_delta' && typeof update.delta === 'string') {
        state.thinking = (state.thinking ?? '') + update.delta;
      }
      break;
    }
    case 'message_end': {
      const message = event.message;
      if (messageRole(message) !== 'assistant') break;
      const text = messageText(message);
      if (text.trim()) {
        state.committed = state.committed ? `${state.committed}\n\n${text.trim()}` : text.trim();
      }
      state.current = '';
      const thinking = messageThinking(message);
      if (thinking) state.thinking = thinking;
      const stopReason = messageStopReason(message);
      if (stopReason === 'error' || stopReason === 'aborted') {
        state.errorMessage = messageErrorMessage(message) ?? `stop reason: ${stopReason}`;
      }
      patchLive(index, state);
      break;
    }
    case 'tool_execution_end': {
      const toolName = typeof event.toolName === 'string' ? event.toolName : 'tool';
      const duration = typeof event.durationMs === 'number' ? event.durationMs : null;
      state.actions.push({
        name: toolName,
        args: {},
        ok: event.isError !== true,
        detail: [describePiTool(toolName, event.args), duration !== null ? `${duration}ms` : '']
          .filter(Boolean)
          .join(' · '),
      });
      patchLive(index, state);
      break;
    }
    case 'auto_retry_start': {
      const attempt = event.attempt ?? '?';
      const reason = typeof event.errorMessage === 'string' ? event.errorMessage : 'unknown';
      state.notes.push(`重试 ${String(attempt)}：${reason}`);
      break;
    }
    case 'compaction_start': {
      state.notes.push('上下文压缩中…');
      break;
    }
    case 'agent_settled': {
      state.settled = true;
      if (event.aborted === true) state.aborted = true;
      break;
    }
    default:
      break;
  }
}

let livePatchTimer: ReturnType<typeof setTimeout> | null = null;
let livePatchState: { index: number; state: PiTurnState } | null = null;

/** Throttles DOM-visible updates while deltas stream in. */
function patchLive(index: number, state: PiTurnState): void {
  livePatchState = { index, state };
  if (livePatchTimer) return;
  livePatchTimer = setTimeout(() => {
    livePatchTimer = null;
    const pending = livePatchState;
    if (!pending) return;
    patchStreamingMessage(pending.index, pending.state);
  }, 120);
}

function patchStreamingMessage(index: number, state: PiTurnState): void {
  patchMessage(index, {
    content: piDisplayText(state),
    ...(state.thinking ? { reasoning_content: state.thinking } : {}),
  });
}

async function sendPiTurn(userText: string): Promise<void> {
  const settings = config();
  const conversation = activeConversation();
  const sessionId = piSessionIdFor(conversation?.id ?? null);

  setProcessing(true);
  try {
    const context = await buildAppContext();
    appendMessage({
      role: 'user',
      content: `${userText}${APP_CONTEXT_MARKER}${context}`,
      ts: Date.now(),
    });

    const state: PiTurnState = {
      committed: '',
      current: '',
      thinking: null,
      actions: [],
      errorMessage: null,
      aborted: false,
      settled: false,
      notes: [],
    };

    const digest = await buildReportDigest(userText);
    const promptParts = [userText, '', '---', '[SP 工作区快照]', context];
    if (digest) promptParts.push('', '[SP 报表数据]（已按上一周期/当前周期统计）', digest);
    if (DECOMPOSE_INTENT.test(userText) || TRIAGE_INTENT.test(userText)) {
      promptParts.push('', SKILL_HINTS);
    }
    if (!settings.piTools.split(',').some((token) => token.trim().startsWith('mcp__')) &&
        !settings.piTools.split(',').map((t) => t.trim()).includes('*')) {
      promptParts.push(
        '',
        '[工具限制] 当前白名单没有 mcp__*（本机 MCP），你无法写入 Super Productivity。',
        '如需落库，请让用户在设置里勾选 mcp__super_productivity 或 mcp__*。',
      );
    }

    const run = await startPiRun({
      sessionId,
      prompt: promptParts.join('\n'),
      bin: settings.piBin.trim() || 'pi',
      cwd: settings.piCwd.trim() || '~',
      model: settings.piModel.trim(),
      tools: settings.piTools.trim(),
    });
    activePiRunId = run.runId;

    appendMessage({
      role: 'assistant',
      content: '',
      streaming: true,
      origin: 'pi',
      ts: Date.now(),
    });
    const index = messages().length - 1;

    let offset = 0;
    let lastSize = 0;
    let idlePollsAfterDeath = 0;
    const startedAt = Date.now();

    while (true) {
      if (Date.now() - startedAt > PI_MAX_RUNTIME_MS) {
        await abortPiRun(run.runId);
        state.errorMessage = '超过 20 分钟未结束，已终止';
        break;
      }

      const poll = await pollPiRun(run.runId, offset, lastSize);
      offset = poll.offset;
      lastSize = poll.size;
      for (const event of poll.events) applyPiEvent(state, event, index);
      if (poll.events.length > 0) patchStreamingMessage(index, state);

      if (state.settled) break;

      if (!poll.alive) {
        idlePollsAfterDeath += 1;
        // Give the file one more poll to flush the final records.
        if (idlePollsAfterDeath >= 2) {
          if (piCancelled) {
            state.aborted = true;
            break;
          }
          if (!piDisplayText(state) && !state.errorMessage) {
            state.errorMessage = poll.stderrTail || 'Pi 进程已退出但没有任何输出';
          } else if (state.errorMessage && poll.stderrTail) {
            state.errorMessage = `${state.errorMessage}\n${poll.stderrTail}`;
          }
          break;
        }
      } else {
        idlePollsAfterDeath = 0;
      }

      await new Promise((resolve) => setTimeout(resolve, PI_POLL_MS));
    }

    const text = piDisplayText(state);
    const contentParts: string[] = [text || (state.aborted ? '_已停止_' : '_（无输出）_')];
    if (state.notes.length > 0) {
      contentParts.push('', ...state.notes.map((note) => `> ${note}`));
    }
    if (state.aborted && text) contentParts.push('', '_已停止_');

    patchMessage(index, {
      content: contentParts.join('\n'),
      streaming: false,
      ...(state.thinking ? { reasoning_content: state.thinking } : {}),
      ...(state.actions.length > 0 ? { actions: state.actions } : {}),
    });

    if (state.errorMessage) pushError(`Pi: ${state.errorMessage}`);
    autoTitleActive();
  } catch (err) {
    log.error('pi turn failed', err);
    pushError(`Pi 模式失败：${(err as Error).message}`);
  } finally {
    activePiRunId = null;
    piCancelled = false;
    setProcessing(false);
  }
}
