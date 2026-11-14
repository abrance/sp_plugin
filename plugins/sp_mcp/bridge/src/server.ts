/**
 * Shared MCP server definition.
 *
 * The same 24 tools serve both transports:
 *   - `main.ts`  — stdio, for an agent launched on the same machine
 *   - `http.ts`  — Streamable HTTP, so any host on the LAN can drive SP
 *
 * Nothing here knows about either transport, which is why the two entries are
 * thin: they only build the request context and hand over to `server.connect`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BridgeError, CommandQueue, Mutex } from './queue.ts';
import { TOOLS } from './tools.ts';

export const VERSION = '0.1.0';
export const SERVER_NAME = 'super-productivity';

export const log = (...parts: unknown[]): void => {
  console.error('[sp_mcp-bridge]', ...parts);
};

/**
 * Registers every tool against `queue`. `mutex` is process-wide so concurrent
 * HTTP requests serialize the same way stdio calls do — one action per round
 * trip, no two writers inside SP at once.
 */
export function createMcpServer(queue: CommandQueue, mutex: Mutex): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.shape },
      async (args: Record<string, unknown>) => {
        try {
          const payload = tool.local
            ? await tool.local(queue)
            : await mutex.run(() =>
                queue.call<unknown>(
                  tool.action as string,
                  (tool.map ? tool.map(args) : args) ?? {},
                ),
              );
          return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
        } catch (error) {
          const text =
            error instanceof BridgeError
              ? `[${error.code}] ${error.message}`
              : error instanceof Error
                ? error.message
                : String(error);
          log(`${tool.name} failed: ${text}`);
          return { content: [{ type: 'text' as const, text }], isError: true };
        }
      },
    );
  }

  return server;
}

/** Startup summary shared by both transports. */
export async function describePlugin(queue: CommandQueue): Promise<string> {
  const state = await queue.readPluginState();
  return state
    ? `v${state.pluginVersion} last seen ${Math.round((Date.now() - state.updatedAt) / 1000)}s ago`
    : 'never seen';
}
