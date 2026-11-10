import { Show, onMount } from 'solid-js';
import { cancelChat, isProcessing, pushError, sendChatMessage } from '../lib/chat.js';
import { apiKey, config } from '../lib/config.js';
import { draft, registerComposerFocus, setDraft } from '../lib/draft.js';
import { IconSend, IconStop } from './Icons.js';

export function Composer() {
  let textarea: HTMLTextAreaElement | undefined;

  const resize = () => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
  };

  onMount(() => {
    registerComposerFocus(() => {
      textarea?.focus();
      resize();
    });
  });

  const submit = () => {
    const text = draft();
    if (!text.trim()) return;
    if (!apiKey() && config().agentMode !== 'pi') {
      pushError('Add your API key in settings first (gear icon).');
      return;
    }
    setDraft('');
    queueMicrotask(resize);
    void sendChatMessage(text);
  };

  return (
    <div class="bai-composer">
      <textarea
        ref={textarea}
        class="bai-input"
        rows={1}
        placeholder={
          apiKey() || config().agentMode === 'pi'
            ? 'Ask about your tasks…'
            : 'Configure your API key first…'
        }
        value={draft()}
        onInput={(e) => {
          setDraft(e.currentTarget.value);
          resize();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Show
        when={isProcessing()}
        fallback={
          <button
            class="bai-send"
            title="Send (Enter)"
            disabled={!draft().trim()}
            onClick={submit}
          >
            <IconSend size={17} />
          </button>
        }
      >
        <button class="bai-send bai-send-stop" title="Stop" onClick={() => cancelChat()}>
          <IconStop size={17} />
        </button>
      </Show>
    </div>
  );
}
