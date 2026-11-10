/** Runtime-facing types for Base AI Bot. */

export interface AppConfig {
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
  /**
   * `direct` = call the configured OpenAI-compatible endpoint with plugin tools.
   * `pi` = hand the turn to the local Pi CLI (agent mode, see lib/piAgent.ts).
   */
  agentMode: 'direct' | 'pi';
  piBin: string;
  piCwd: string;
  piModel: string;
  piTools: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  maxTokens: 4096,
  temperature: 0.7,
  agentMode: 'direct',
  piBin: 'pi',
  piCwd: '~',
  piModel: '',
  piTools: 'read,grep,ls,memory_search,memory_add,mcp__*',
};

export const SECRET_API_KEY = 'apiKey';

export interface ToolCallRef {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** One executed tool call, kept for the action cards under an answer. */
export interface ActionResult {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  detail: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCallRef[];
  tool_call_id?: string;
  reasoning_content?: string;
  ts: number;
  /** Rendered as action cards; never sent back to the model. */
  actions?: ActionResult[];
  /** Locally built report (adds copy / rewrite affordances). */
  report?: { period: string; label: string };
  /** Set while a Pi agent run is streaming this message. */
  streaming?: boolean;
  /** Which backend produced this message. */
  origin?: 'direct' | 'pi';
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ConversationsState {
  activeId: string | null;
  list: Conversation[];
}

/** Marker the user bubble renders without. */
export const APP_CONTEXT_MARKER = '\n\n---\n[App Context]\n';

export function stripAppContext(content: string): string {
  const idx = content.indexOf(APP_CONTEXT_MARKER);
  return idx === -1 ? content : content.slice(0, idx);
}
