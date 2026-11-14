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
 * For a port instead of stdin/stdout see `src/http.ts`.
 * stdout carries the MCP protocol, so every diagnostic goes to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CommandQueue, Mutex } from './queue.ts';
import { TOOLS } from './tools.ts';
import { createMcpServer, describePlugin, log } from './server.ts';

async function main(): Promise<void> {
  const queue = new CommandQueue();

  try {
    await queue.ensure();
    const swept = await queue.sweep();
    if (swept.commands > 0 || swept.responses > 0) {
      log(`swept ${swept.commands} stale command(s), ${swept.responses} old response(s)`);
    }
  } catch (error) {
    log(`bridge directory is not usable: ${(error as Error).message}`);
  }

  const server = createMcpServer(queue, new Mutex());
  await server.connect(new StdioServerTransport());

  log(
    `ready · dir=${queue.dirs.root} · tools=${TOOLS.length} · plugin=${await describePlugin(queue)}`,
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