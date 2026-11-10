import { For, Show, createEffect } from 'solid-js';
import {
  dismissError,
  errors,
  isProcessing,
  pushError,
  sendChatMessage,
  sendLocalReport,
} from '../lib/chat.js';
import { messages } from '../lib/conversations.js';
import { prefillComposer } from '../lib/draft.js';
import { snack } from '../lib/host.js';
import { renderMarkdown } from '../lib/markdown.js';
import type { ReportPeriod } from '../lib/report.js';
import { stripAppContext, type ChatMessage } from '../lib/types.js';
import { IconAlert, IconCheck } from './Icons.js';

type Chip =
  | { label: string; kind: 'report'; period: ReportPeriod }
  | { label: string; kind: 'prompt'; text: string }
  | { label: string; kind: 'prefill'; text: string };

const CHIPS: Chip[] = [
  { label: '日报', kind: 'report', period: 'day' },
  { label: '周报', kind: 'report', period: 'week' },
  { label: '月度总结', kind: 'report', period: 'month' },
  { label: '我的任务', kind: 'prompt', text: 'Show me my open tasks' },
  { label: '新任务', kind: 'prefill', text: 'Create a task: ' },
];

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const isVisible = (message: ChatMessage): boolean => {
  if (message.role === 'tool') return false;
  if (message.role === 'assistant' && !message.content) return false;
  return true;
};

/** True while a streaming message already shows partial text. */
const hasStreamingText = (list: ChatMessage[]): boolean =>
  list.some((message) => message.streaming === true && (message.content ?? '').length > 0);

export async function copyMarkdown(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    snack('Markdown 已复制', 'SUCCESS');
  } catch {
    pushError('复制失败：浏览器拒绝对剪贴板的访问');
  }
}

export function ChatView() {
  let scroller: HTMLDivElement | undefined;

  createEffect(() => {
    messages().length;
    isProcessing();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });

  return (
    <div class="bai-chat" ref={scroller}>
      <Show
        when={messages().filter(isVisible).length > 0}
        fallback={
          <div class="bai-welcome">
            <div class="bai-welcome-icon">🤖</div>
            <h3>Base AI Bot</h3>
            <p>
              Ask in plain language — I can create, plan, tag, complete and track tasks for you,
              or assemble a 日报 / 周报 / 月度总结 from your workspace.
            </p>
            <div class="bai-quick-actions">
              <For each={CHIPS}>
                {(chip) => (
                  <button
                    class="bai-quick-action"
                    onClick={() => {
                      if (chip.kind === 'report') void sendLocalReport(chip.period);
                      else if (chip.kind === 'prefill') prefillComposer(chip.text);
                      else void sendChatMessage(chip.text);
                    }}
                  >
                    {chip.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        }
      >
        <For each={messages().filter(isVisible)}>
          {(message) => (
            <div class="bai-message" classList={{ 'bai-message-user': message.role === 'user' }}>
              <div
                class="bai-bubble"
                classList={{
                  'bai-bubble-user': message.role === 'user',
                  'bai-bubble-bot': message.role === 'assistant',
                }}
              >
                <Show
                  when={message.role === 'assistant'}
                  fallback={<span class="bai-plain">{stripAppContext(message.content ?? '')}</span>}
                >
                  <div innerHTML={renderMarkdown(message.content ?? '')} />

                  <Show when={message.report}>
                    {(report) => (
                      <div class="bai-report-actions">
                        <button
                          class="bai-chip-btn"
                          onClick={() => void copyMarkdown(message.content ?? '')}
                        >
                          复制 Markdown
                        </button>
                        <button
                          class="bai-chip-btn"
                          onClick={() =>
                            void sendChatMessage(
                              `请把上面的${report().label}报表改写得更自然、更像工作汇报，` +
                                '三个二级标题与项目符号列表结构保持不变。',
                            )
                          }
                        >
                          AI 改写
                        </button>
                      </div>
                    )}
                  </Show>

                  <Show when={message.actions && message.actions.length > 0}>
                    <div class="bai-actions">
                      <For each={message.actions}>
                        {(action) => (
                          <div
                            class="bai-action"
                            classList={{ 'bai-action-error': !action.ok }}
                            title={action.detail || action.name}
                          >
                            <Show when={action.ok} fallback={<IconAlert />}>
                              <IconCheck />
                            </Show>
                            <span class="bai-action-name">{action.name}</span>
                            <Show when={action.detail}>
                              <span class="bai-action-detail">{action.detail}</span>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>
              </div>
              <div class="bai-time">{timeLabel(message.ts)}</div>
            </div>
          )}
        </For>

        <Show when={isProcessing() && !hasStreamingText(messages())}>
          <div class="bai-message">
            <div class="bai-bubble bai-bubble-bot bai-thinking">
              <span class="bai-dots">
                <span />
                <span />
                <span />
              </span>
              Thinking…
            </div>
          </div>
        </Show>
      </Show>

      <For each={errors()}>
        {(error) => (
          <button class="bai-error" onClick={() => dismissError(error.id)}>
            ⚠ {error.message}
          </button>
        )}
      </For>
    </div>
  );
}
