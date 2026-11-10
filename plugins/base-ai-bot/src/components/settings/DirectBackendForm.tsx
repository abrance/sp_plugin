import type { Draft } from './draft.js';

export function DirectBackendForm(props: {
  draft: Draft;
  patch: (patch: Partial<Draft>) => void;
}) {
  const d = () => props.draft;

  return (
    <>
      <div class="bai-group">
        <div class="bai-group-title">
          <span>模型端点</span>
          <span
            class="bai-status"
            classList={{ 'bai-status-ok': d().apiKey.trim().length > 0 }}
            title={d().apiKey.trim().length > 0 ? '已设置 API key' : '尚未设置 API key'}
          >
            <i />
            {d().apiKey.trim().length > 0 ? '已设置密钥' : '未设置密钥'}
          </span>
        </div>

        <label class="bai-row">
          <span class="bai-row-label">API key</span>
          <input
            class="bai-row-control"
            type="password"
            placeholder="sk-…"
            autocomplete="off"
            value={d().apiKey}
            onInput={(e) => props.patch({ apiKey: e.currentTarget.value })}
          />
        </label>

        <label class="bai-row">
          <span class="bai-row-label">Base URL</span>
          <input
            class="bai-row-control"
            type="text"
            placeholder="https://api.openai.com/v1"
            value={d().baseUrl}
            onInput={(e) => props.patch({ baseUrl: e.currentTarget.value })}
          />
        </label>

        <label class="bai-row">
          <span class="bai-row-label">模型</span>
          <input
            class="bai-row-control"
            type="text"
            placeholder="gpt-4o"
            value={d().model}
            onInput={(e) => props.patch({ model: e.currentTarget.value })}
          />
        </label>

        <small class="bai-row-help">
          密钥只存本机（不参与同步、导出、备份）；任何 OpenAI 兼容端点都可以，记得带版本段。
        </small>
      </div>

      <div class="bai-group">
        <div class="bai-group-title">
          <span>生成参数</span>
        </div>

        <div class="bai-row bai-row-split">
          <label class="bai-row-half">
            <span class="bai-row-label">Max tokens</span>
            <input
              class="bai-row-control"
              type="number"
              min="256"
              max="32768"
              value={d().maxTokens}
              onInput={(e) => props.patch({ maxTokens: e.currentTarget.value })}
            />
          </label>
          <label class="bai-row-half">
            <span class="bai-row-label">Temperature</span>
            <input
              class="bai-row-control"
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={d().temperature}
              onInput={(e) => props.patch({ temperature: e.currentTarget.value })}
            />
          </label>
        </div>
      </div>

      <div class="bai-group">
        <div class="bai-group-title">
          <span>直连模式能做什么</span>
        </div>
        <small class="bai-row-help">
          插件自带的 30 个任务/项目/标签/计时工具 + 报表取数。改任务、计时、生成日报走这一套；
          需要读写文件或排查本机环境时切到「本机 Pi」。
        </small>
      </div>
    </>
  );
}
