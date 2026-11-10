import { For, Show, createSignal } from 'solid-js';
import { config } from '../lib/config.js';
import {
  activeConversation,
  conversationsState,
  createConversation,
  deleteConversation,
  renameConversation,
  switchConversation,
} from '../lib/conversations.js';
import { IconBot, IconChevron, IconPlus, IconSettings, IconTrash } from './Icons.js';

export function Header(props: { onOpenSettings: () => void }) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [renaming, setRenaming] = createSignal<string | null>(null);

  const closeMenu = () => {
    setMenuOpen(false);
    setRenaming(null);
  };

  const title = () => activeConversation()?.title ?? 'Base AI Bot';

  const startRename = (id: string, current: string) => {
    setRenaming(id);
    queueMicrotask(() => {
      const input = document.querySelector<HTMLInputElement>(
        `[data-rename-input="${id}"]`,
      );
      if (input) {
        input.value = current;
        input.focus();
        input.select();
      }
    });
  };

  const commitRename = (id: string, value: string) => {
    const next = value.trim();
    if (next) renameConversation(id, next);
    setRenaming(null);
  };

  return (
    <div class="bai-header">
      <div class="bai-header-main">
        <IconBot />
        <button
          class="bai-conv-toggle"
          title="Switch conversation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span class="bai-conv-title">{title()}</span>
          <IconChevron />
        </button>
        <span class="bai-model-badge">
          {config().agentMode === 'pi' ? 'Pi Agent' : config().model}
        </span>
      </div>

      <div class="bai-header-actions">
        <button
          class="bai-icon-btn"
          title="New chat"
          onClick={() => {
            const active = activeConversation();
            if (!active || active.messages.length > 0) createConversation();
            closeMenu();
          }}
        >
          <IconPlus size={15} />
        </button>
        <button
          class="bai-icon-btn"
          title="Settings"
          onClick={() => {
            closeMenu();
            props.onOpenSettings();
          }}
        >
          <IconSettings size={15} />
        </button>
      </div>

      <Show when={menuOpen()}>
        <div class="bai-menu-backdrop" onClick={closeMenu} />
        <div class="bai-menu">
          <For each={conversationsState().list}>
            {(conv) => (
              <div
                class="bai-menu-item"
                classList={{ 'bai-menu-item-active': conv.id === conversationsState().activeId }}
                onClick={() => {
                  if (renaming() === conv.id) return;
                  switchConversation(conv.id);
                  closeMenu();
                }}
              >
                <div class="bai-menu-item-body">
                  <Show
                    when={renaming() === conv.id}
                    fallback={
                      <div
                        class="bai-menu-item-title"
                        onDblClick={(e) => {
                          e.stopPropagation();
                          startRename(conv.id, conv.title);
                        }}
                      >
                        {conv.title}
                      </div>
                    }
                  >
                    <input
                      class="bai-rename-input"
                      data-rename-input={conv.id}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => commitRename(conv.id, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(conv.id, e.currentTarget.value);
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  </Show>
                  <div class="bai-menu-item-date">
                    {new Date(conv.updatedAt).toLocaleString()}
                  </div>
                </div>
                <button
                  class="bai-menu-item-delete"
                  title="Delete conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                >
                  <IconTrash />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
