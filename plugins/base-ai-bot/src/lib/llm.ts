import type { AppConfig, ChatMessage, ToolCallRef } from './types.js';
import { toolSchemas } from './tools.js';

export interface AssistantMessage {
  content: string | null;
  tool_calls?: ToolCallRef[];
  reasoning_content?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: AssistantMessage }>;
  error?: { message?: string };
}

/** Drops local-only fields (`ts`, `actions`) before the payload leaves the plugin. */
function toApiMessage(message: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: message.role, content: message.content };
  if (message.tool_calls) out.tool_calls = message.tool_calls;
  if (message.tool_call_id) out.tool_call_id = message.tool_call_id;
  if (message.reasoning_content) out.reasoning_content = message.reasoning_content;
  return out;
}

export async function completeChat(params: {
  config: AppConfig;
  apiKey: string;
  systemPrompt: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): Promise<AssistantMessage> {
  const { config, apiKey, systemPrompt, messages, signal } = params;
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(toApiMessage),
    ],
    tools: toolSchemas,
    tool_choice: 'auto',
    max_tokens: config.maxTokens,
    temperature: config.temperature,
  };

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`API ${response.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error('Empty response from the model');
  return message;
}
