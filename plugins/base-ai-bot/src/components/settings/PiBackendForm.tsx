import type { Draft } from './draft.js';
import { ToolChips, ToolChipsHint, hasDangerousTools, isAllTools } from './ToolChips.js';

export function PiBackendForm(props: {
  draft: Draft;
  patch: (patch: Partial<Draft>) => void;
}) {
  const d = () => props.draft;

  return (
    <>
      <div class="bai-group">
        <div class="bai-group-title">
          <span>Pi 运行时</span>
        </div>

        <label class="bai-row">
          <span class="bai-row-label">可执行文件</span>
          <input
            class="bai-row-control"
            type="text"
            placeholder="pi"
            value={d().piBin}
            onInput={(e) => props.patch({ piBin: e.currentTarget.value })}
          />
        </label>

        <label class="bai-row">
          <span class="bai-row-label">工作目录</span>
          <input
            class="bai-row-control"
            type="text"
            placeholder="~"
            value={d().piCwd}
            onInput={(e) => props.patch({ piCwd: e.currentTarget.value })}
          />
        </label>

        <label class="bai-row">
          <span class="bai-row-label">模型</span>
          <input
            class="bai-row-control"
            type="text"
            placeholder="留空 = Pi 自己的默认"
            value={d().piModel}
            onInput={(e) => props.patch({ piModel: e.currentTarget.value })}
          />
        </label>

        <small class="bai-row-help">
          cwd 决定 Pi 在哪个项目里工作（它会读那里的 AGENTS.md / skills）。名字不带路径时按 PATH
          查找，插件会自动补上 nvm 的 node bin 目录。
        </small>
        <small class="bai-row-help">
          max tokens / temperature 这类生成参数由 Pi 自己的模型配置决定，这里不重复设置。
        </small>
      </div>

      <div class="bai-group">
        <div class="bai-group-title">
          <span>工具白名单</span>
          <span class="bai-count">{isAllTools(d().piTools) ? '全部' : `${d().piTools.length} 个`}</span>
        </div>

        <ToolChips
          value={d().piTools}
          onChange={(next) => props.patch({ piTools: next })}
        />
        <ToolChipsHint all={isAllTools(d().piTools)} dangerous={hasDangerousTools(d().piTools)} />
        <small class="bai-row-help">
          要让它真正写 SP（拆解任务、批量改），白名单必须含 <code>mcp__super_productivity</code>
          或 <code>mcp__*</code>：Pi 是通过本机 sp-mcp 写 Super Productivity 的，自身没有 SP 工具。
        </small>
      </div>

      <div class="bai-group">
        <div class="bai-group-title">
          <span>会话</span>
        </div>
        <small class="bai-row-help">
          每个 SP 会话对应一个 Pi 会话（<code>--session-id sp-&lt;会话id&gt;</code>），历史存在 Pi
          自己的 session 目录，终端里 <code>pi -r</code> 也能打开。运行时固定带
          <code>--no-approve</code>，不会加载目标目录里需要授权的扩展。
        </small>
      </div>
    </>
  );
}
