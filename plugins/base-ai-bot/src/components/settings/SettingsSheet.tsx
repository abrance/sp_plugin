import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { apiKey, config, saveConfig } from '../../lib/config.js';
import { pushError } from '../../lib/chat.js';
import { snack } from '../../lib/host.js';
import { DEFAULT_CONFIG } from '../../lib/types.js';
import { DirectBackendForm } from './DirectBackendForm.js';
import { PiBackendForm } from './PiBackendForm.js';
import {
  resetTab,
  sameDraft,
  toConfig,
  toDraft,
  type Draft,
} from './draft.js';

type Tab = 'direct' | 'pi';

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'direct', label: '直连模型', hint: '插件自带工具，需要 API key' },
  { id: 'pi', label: '本机 Pi', hint: '调用本机 pi CLI，具备本机全部能力' },
];

export function SettingsSheet(props: { onClose: () => void }) {
  const saved = toDraft(config(), apiKey());
  const [draft, setDraft] = createSignal<Draft>(saved);
  const [tab, setTab] = createSignal<Tab>(draft().agentMode);
  const [saving, setSaving] = createSignal(false);

  const patch = (next: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...next }));
  const dirty = createMemo(() => !sameDraft(draft(), toDraft(config(), apiKey())));

  const selectTab = (next: Tab) => {
    setTab(next);
    patch({ agentMode: next });
  };

  const handleKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onClose();
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKey);
    onCleanup(() => window.removeEventListener('keydown', handleKey));
  });

  /**
   * Applies immediately and closes at once; persistence runs in the background
   * with a timeout, so a stalled host bridge can never freeze this dialog.
   */
  const save = () => {
    const current = draft();
    if (current.agentMode === 'direct' && !current.apiKey.trim()) {
      pushError('直连模型需要 API key；也可以切到「本机 Pi」免密钥使用');
      return;
    }
    if (current.agentMode === 'pi' && current.piTools.length === 0) {
      pushError('Pi 工具白名单不能为空，至少留一个（例如 read）');
      return;
    }

    setSaving(true);
    const nextConfig = toConfig(current);
    props.onClose();
    void (async () => {
      try {
        await saveConfig(nextConfig, current.apiKey.trim());
        snack('设置已保存', 'SUCCESS');
      } catch (err) {
        pushError(`配置已生效，但写入持久化失败：${(err as Error).message}`);
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <div
      class="bai-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div class="bai-sheet">
        <header class="bai-sheet-head">
          <div>
            <h3>设置</h3>
            <p>选择对话后端，配置只对当前后端生效的字段。</p>
          </div>
          <button class="bai-icon-btn" title="关闭 (Esc)" onClick={() => props.onClose()}>
            ✕
          </button>
        </header>

        <div class="bai-tabs" role="tablist">
          <For each={TABS}>
            {(entry) => (
              <button
                type="button"
                role="tab"
                class="bai-tab"
                classList={{ 'bai-tab-active': tab() === entry.id }}
                aria-selected={tab() === entry.id}
                title={entry.hint}
                onClick={() => selectTab(entry.id)}
              >
                {entry.label}
              </button>
            )}
          </For>
        </div>

        <div class="bai-sheet-body">
          <Show when={tab() === 'direct'} fallback={<PiBackendForm draft={draft()} patch={patch} />}>
            <DirectBackendForm draft={draft()} patch={patch} />
          </Show>
        </div>

        <footer class="bai-sheet-foot">
          <button
            class="bai-btn bai-btn-ghost"
            onClick={() => setDraft((prev) => resetTab(prev, tab(), DEFAULT_CONFIG))}
          >
            恢复默认
          </button>
          <div class="bai-foot-right">
            <button class="bai-btn" onClick={() => props.onClose()}>
              取消
            </button>
            <button
              class="bai-btn bai-btn-primary"
              classList={{ 'bai-btn-dirty': dirty() }}
              disabled={saving()}
              onClick={() => save()}
            >
              {saving() ? '保存中…' : '保存'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
