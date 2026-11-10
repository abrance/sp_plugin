import { createDebouncedWriter, createLogger, readSyncedJson } from '@sp/plugin-kit';
import { createMemo, createSignal } from 'solid-js';
import type { ChatMessage, Conversation, ConversationsState } from './types.js';

const log = createLogger('base-ai-bot');

const CONVERSATIONS_KEY = 'conversations';
const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES = 60;

const writer = createDebouncedWriter(CONVERSATIONS_KEY, 500);

const [state, setState] = createSignal<ConversationsState>({ activeId: null, list: [] });
export { state as conversationsState };

export const activeConversation = createMemo<Conversation | null>(() => {
  const s = state();
  return s.list.find((c) => c.id === s.activeId) ?? null;
});

export const messages = createMemo<ChatMessage[]>(() => activeConversation()?.messages ?? []);

function persist(): void {
  writer.schedule(state());
}

function nextId(): string {
  return `conv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function makeConversation(title = 'New Chat'): Conversation {
  const now = Date.now();
  return { id: nextId(), title, createdAt: now, updatedAt: now, messages: [] };
}

export function createConversation(title?: string): Conversation {
  const conv = makeConversation(title);
  setState((s) => {
    const list = [conv, ...s.list].slice(0, MAX_CONVERSATIONS);
    return { activeId: conv.id, list };
  });
  persist();
  return conv;
}

export function switchConversation(id: string): void {
  setState((s) =>
    s.list.some((c) => c.id === id) ? { ...s, activeId: id } : s,
  );
  persist();
}

export function deleteConversation(id: string): void {
  setState((s) => {
    const list = s.list.filter((c) => c.id !== id);
    if (list.length === 0) {
      const fresh = makeConversation();
      return { activeId: fresh.id, list: [fresh] };
    }
    const activeId = s.activeId === id ? list[0]!.id : s.activeId;
    return { activeId, list };
  });
  persist();
}

export function renameConversation(id: string, title: string): void {
  setState((s) => ({
    ...s,
    list: s.list.map((c) =>
      c.id === id ? { ...c, title, updatedAt: Date.now() } : c,
    ),
  }));
  persist();
}

/** Applies `fn` to the active conversation and bumps `updatedAt`. */
function mutateActive(fn: (conv: Conversation) => Conversation): void {
  const activeId = state().activeId;
  if (!activeId) return;
  setState((s) => ({
    ...s,
    list: s.list.map((c) =>
      c.id === activeId ? { ...fn(c), updatedAt: Date.now() } : c,
    ),
  }));
  persist();
}

export function appendMessage(message: ChatMessage): void {
  mutateActive((c) => ({
    ...c,
    messages: [...c.messages, message].slice(-MAX_MESSAGES),
  }));
}

export function patchMessage(index: number, patch: Partial<ChatMessage>): void {
  mutateActive((c) => ({
    ...c,
    messages: c.messages.map((m, i) => (i === index ? { ...m, ...patch } : m)),
  }));
}

export function replaceMessage(index: number, message: ChatMessage): void {
  mutateActive((c) => ({
    ...c,
    messages: c.messages.map((m, i) => (i === index ? message : m)),
  }));
}

export function patchLastAssistant(patch: Partial<ChatMessage>): void {
  mutateActive((c) => {
    const messages = [...c.messages];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i]!;
      if (msg.role === 'assistant') {
        messages[i] = { ...msg, ...patch };
        break;
      }
    }
    return { ...c, messages };
  });
}

export function clearActiveMessages(): void {
  mutateActive((c) => ({ ...c, messages: [] }));
}

/** Titles the active conversation from its first user turn, once. */
export function autoTitleActive(): void {
  const active = activeConversation();
  if (!active || active.title !== 'New Chat') return;
  const firstUser = active.messages.find((m) => m.role === 'user');
  if (!firstUser?.content) return;
  const text = firstUser.content.split('\n\n---\n[App Context]')[0]?.trim() ?? '';
  if (!text) return;
  const title = text.length > 40 ? `${text.slice(0, 40)}...` : text;
  renameConversation(active.id, title);
}

export async function loadConversations(): Promise<void> {
  const stored = await readSyncedJson<ConversationsState>(CONVERSATIONS_KEY, {
    activeId: null,
    list: [],
  });
  const list = Array.isArray(stored.list) ? stored.list : [];
  if (list.length === 0) {
    const fresh = makeConversation();
    setState({ activeId: fresh.id, list: [fresh] });
    return;
  }
  const activeId = list.some((c) => c.id === stored.activeId)
    ? stored.activeId
    : list[0]!.id;
  setState({ activeId, list });
  log.debug('loaded conversations', list.length);
}

export async function flushConversations(): Promise<void> {
  await writer.flush();
}
