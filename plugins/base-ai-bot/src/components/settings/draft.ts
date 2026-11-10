import type { AppConfig } from '../../lib/types.js';
import { KNOWN_TOOLS, parseTools } from '../settings/ToolChips.js';

/** Editable copy of the settings; numeric inputs stay strings while editing. */
export interface Draft {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: string;
  temperature: string;
  agentMode: 'direct' | 'pi';
  piBin: string;
  piCwd: string;
  piModel: string;
  piTools: string[];
}

export function toDraft(config: AppConfig, apiKey: string | null): Draft {
  return {
    apiKey: apiKey ?? '',
    baseUrl: config.baseUrl,
    model: config.model,
    maxTokens: String(config.maxTokens),
    temperature: String(config.temperature),
    agentMode: config.agentMode === 'pi' ? 'pi' : 'direct',
    piBin: config.piBin,
    piCwd: config.piCwd,
    piModel: config.piModel,
    piTools: parseTools(config.piTools),
  };
}

export function toConfig(draft: Draft): AppConfig {
  const tokens = Number.parseInt(draft.maxTokens, 10);
  const temperature = Number.parseFloat(draft.temperature);
  return {
    baseUrl: draft.baseUrl.trim() || 'https://api.openai.com/v1',
    model: draft.model.trim() || 'gpt-4o',
    maxTokens: Number.isFinite(tokens) ? Math.min(Math.max(tokens, 256), 32768) : 4096,
    temperature: Number.isFinite(temperature)
      ? Math.min(Math.max(temperature, 0), 2)
      : 0.7,
    agentMode: draft.agentMode,
    piBin: draft.piBin.trim() || 'pi',
    piCwd: draft.piCwd.trim() || '~',
    piModel: draft.piModel.trim(),
    piTools: draft.piTools.length > 0 ? draft.piTools.join(',') : 'read',
  };
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Per-tab defaults: only that tab's fields are reset. */
export function resetTab(draft: Draft, tab: 'direct' | 'pi', defaults: AppConfig): Draft {
  if (tab === 'pi') {
    return {
      ...draft,
      piBin: defaults.piBin,
      piCwd: defaults.piCwd,
      piModel: defaults.piModel,
      piTools: parseTools(defaults.piTools),
    };
  }
  return {
    ...draft,
    baseUrl: defaults.baseUrl,
    model: defaults.model,
    maxTokens: String(defaults.maxTokens),
    temperature: String(defaults.temperature),
  };
}

const SUGGESTED = new Set(KNOWN_TOOLS.map((tool) => tool.name));

/** Unknown tool names are kept, so hand-written allowlists survive editing. */
export function unknownTools(tokens: string[]): string[] {
  return tokens.filter((token) => token !== '*' && !SUGGESTED.has(token));
}
