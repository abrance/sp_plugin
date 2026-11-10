import { Show, createSignal, onMount } from 'solid-js';
import { waitForApi } from '@sp/plugin-kit';
import { loadConfig } from './lib/config.js';
import { flushConversations, loadConversations } from './lib/conversations.js';
import { registerHostHooks } from './lib/host.js';
import { ChatView } from './components/ChatView.js';
import { Composer } from './components/Composer.js';
import { Header } from './components/Header.js';
import { SettingsSheet } from './components/settings/SettingsSheet.js';

export default function App() {
  const [ready, setReady] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [hostMissing, setHostMissing] = createSignal(false);

  onMount(async () => {
    try {
      await waitForApi(8000);
    } catch {
      setHostMissing(true);
      return;
    }
    registerHostHooks();
    await Promise.all([loadConfig(), loadConversations()]);
    setReady(true);
    window.addEventListener('beforeunload', () => {
      void flushConversations();
    });
  });

  return (
    <div class="bai-app">
      <Show
        when={!hostMissing()}
        fallback={
          <div class="bai-splash">
            <h3>No Super Productivity host</h3>
            <p>
              This UI is running outside the app. Install the built plugin zip from
              Settings → Plugins to use it.
            </p>
          </div>
        }
      >
        <Show
          when={ready()}
          fallback={
            <div class="bai-splash">
              <h3>Connecting…</h3>
            </div>
          }
        >
          <Header onOpenSettings={() => setSettingsOpen(true)} />
          <ChatView />
          <Composer />
          <Show when={settingsOpen()}>
            <SettingsSheet onClose={() => setSettingsOpen(false)} />
          </Show>
        </Show>
      </Show>
    </div>
  );
}
