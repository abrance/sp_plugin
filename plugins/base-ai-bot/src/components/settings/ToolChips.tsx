import { For, Show } from 'solid-js';

/** Tools Pi ships with that are worth offering as one-click chips. */
export const KNOWN_TOOLS: Array<{ name: string; hint: string }> = [
  { name: 'read', hint: '读文件' },
  { name: 'grep', hint: '搜索内容' },
  { name: 'ls', hint: '列目录' },
  { name: 'bash', hint: '执行命令（危险）' },
  { name: 'edit', hint: '改文件（危险）' },
  { name: 'write', hint: '写文件（危险）' },
  { name: 'memory_search', hint: '查本机记忆' },
  { name: 'memory_add', hint: '写本机记忆' },
  { name: 'mcp__super_productivity', hint: 'sp-mcp：读写 SP 任务（拆解、批量改）' },
  { name: 'mcp__*', hint: '全部已配置的 MCP 服务器' },
];

const DANGEROUS = new Set(['bash', 'edit', 'write']);

/** MCP access is what lets Pi write Super Productivity through sp-mcp. */
export const hasMcpAccess = (tokens: string[]): boolean =>
  tokens.includes('*') || tokens.some((token) => token.startsWith('mcp__'));

export function parseTools(value: string): string[] {
  return value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

export function toolsToString(tokens: string[]): string {
  return tokens.join(',');
}

/**
 * Tool allowlist as chips. `*` is a distinct state (everything allowed) rather
 * than a token that can be combined with named tools.
 */
export function ToolChips(props: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const isAll = () => props.value.includes('*');

  const toggle = (name: string) => {
    if (isAll()) {
      props.onChange([name]);
      return;
    }
    props.onChange(
      props.value.includes(name)
        ? props.value.filter((token) => token !== name)
        : [...props.value, name],
    );
  };

  const custom = () => props.value.filter((token) => token !== '*' && !KNOWN_TOOLS.some((t) => t.name === token));

  return (
    <div class="bai-chips">
      <For each={KNOWN_TOOLS}>
        {(tool) => (
          <button
            type="button"
            class="bai-chip"
            classList={{
              'bai-chip-on': !isAll() && props.value.includes(tool.name),
              'bai-chip-danger': DANGEROUS.has(tool.name),
            }}
            title={tool.hint}
            onClick={() => toggle(tool.name)}
          >
            {tool.name}
          </button>
        )}
      </For>

      <For each={custom()}>
        {(token) => (
          <button
            type="button"
            class="bai-chip bai-chip-on bai-chip-custom"
            title="自定义工具名"
            onClick={() => toggle(token)}
          >
            {token} ×
          </button>
        )}
      </For>

      <button
        type="button"
        class="bai-chip bai-chip-danger"
        classList={{ 'bai-chip-on': isAll() }}
        title="允许 Pi 使用全部工具，包括 bash / edit / write"
        onClick={() => props.onChange(isAll() ? ['read', 'grep', 'ls'] : ['*'])}
      >
        全部 *
      </button>
    </div>
  );
}

export function isAllTools(value: string[]): boolean {
  return value.includes('*');
}

export function hasDangerousTools(value: string[]): boolean {
  return isAllTools(value) || value.some((token) => DANGEROUS.has(token));
}

/** Keeps the state valid when the user unchecks everything. */
export function normalizeTools(value: string[]): string[] {
  const next = value.filter((token) => token.length > 0);
  return next.length > 0 ? next : ['read'];
}

export function ToolChipsHint(props: { all: boolean; dangerous: boolean }) {
  return (
    <Show
      when={props.dangerous}
      fallback={<small>只读组合最安全。Pi 不会逐个工具请求确认。</small>}
    >
      <small class="bai-warn-text">
        {props.all ? '全部工具已放开' : '含写操作工具'}：Pi 会直接执行命令/改文件，任务标题里的注入内容也会被执行。
      </small>
    </Show>
  );
}
