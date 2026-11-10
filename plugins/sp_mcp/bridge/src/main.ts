#!/usr/bin/env node
/**
 * sp_mcp bridge — stdio MCP server for Super Productivity.
 *
 * It does not talk to the app directly: every tool becomes a command file that
 * the `sp_mcp` plugin drains (it holds the real plugin API), so the agent side
 * needs no socket, no port and no credentials.
 *
 *   node src/main.ts        # Node >= 22.18 runs this TypeScript directly
 *
 * stdout carries the MCP protocol, so every diagnostic goes to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BridgeError, CommandQueue, Mutex } from './queue.ts';
import { TOOLS } from './tools.ts';

const VERSION = '0.1.0';

const log = (...parts: unknown[]): void => {
  console.error('[sp_mcp-bridge]', ...parts);
};

async function main(): Promise<void> {
  const queue = new CommandQueue();
  const mutex = new Mutex();

  try {
    await queue.ensure();
    const swept = await queue.sweep();
    if (swept.commands > 0 || swept.responses > 0) {
      log(`swept ${swept.commands} stale command(s), ${swept.responses} old response(s)`);
    }
  } catch (error) {
    log(`bridge directory is not usable: ${(error as Error).message}`);
  }

  const server = new McpServer({ name: 'super-productivity', version: VERSION });

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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const state = await queue.readPluginState();
  log(
    `ready · dir=${queue.dirs.root} · tools=${TOOLS.length} · plugin=${
      state ? `v${state.pluginVersion} last seen ${Math.round((Date.now() - state.updatedAt) / 1000)}s ago` : 'never seen'
    }`,
  );

  const shutdown = async (): Promise<void> => {
    log('shutting down');
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  log('fatal:', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
