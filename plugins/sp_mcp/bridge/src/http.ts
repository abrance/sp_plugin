#!/usr/bin/env node
/**
 * sp_mcp bridge — Streamable HTTP MCP server for Super Productivity.
 *
 * Same 24 tools as the stdio entry, same command-file contract with the plugin;
 * the only difference is that the transport is a port instead of stdin/stdout,
 * so any host on the network can drive one Super Productivity instance.
 *
 *   node src/http.ts
 *
 * Environment:
 *   SP_MCP_HTTP_HOST    bind address   (default 127.0.0.1)
 *   SP_MCP_HTTP_PORT    port           (default 3877)
 *   SP_MCP_HTTP_TOKEN   bearer token   (required when HOST is not loopback)
 *   SP_MCP_BRIDGE_DIR   shared queue   (default ~/.local/share/sp-mcp-bridge)
 *
 * Endpoints:
 *   POST/GET/DELETE /mcp   MCP Streamable HTTP
 *   GET /health            liveness only, no task data, no auth
 *
 * stdout carries nothing; every diagnostic goes to stderr.
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CommandQueue, Mutex } from './queue.ts';
import { TOOLS } from './tools.ts';
import { createMcpServer, describePlugin, log } from './server.ts';

const MAX_BODY_BYTES = 1024 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

const host = process.env['SP_MCP_HTTP_HOST']?.trim() || '127.0.0.1';
const port = Number(process.env['SP_MCP_HTTP_PORT']?.trim() || 3877);
const token = process.env['SP_MCP_HTTP_TOKEN']?.trim() || '';
const insecure = process.env['SP_MCP_HTTP_INSECURE'] === '1';

function authorised(req: IncomingMessage): boolean {
  if (!token) return true;
  const got = req.headers['authorization'];
  if (typeof got !== 'string') return false;
  const expected = Buffer.from(`Bearer ${token}`, 'utf8');
  const actual = Buffer.from(got, 'utf8');
  // Length leak is fine here; the token is fixed-length by construction.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

/** Reads at most MAX_BODY_BYTES and parses it; `undefined` when there is no body. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main(): Promise<void> {
  if (!LOOPBACK.has(host) && !token && !insecure) {
    log(
      `refusing to listen on ${host} without SP_MCP_HTTP_TOKEN — anyone who can reach that port ` +
        'could read and delete every task. Set a token, or bind 127.0.0.1 and use an ssh tunnel. ' +
        'Set SP_MCP_HTTP_INSECURE=1 to override (not recommended).',
    );
    process.exit(2);
  }

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

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      log('request failed:', error instanceof Error ? error.message : String(error));
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`);

    // Probes stay unauthenticated and expose no task data.
    if (url.pathname === '/health') {
      send(res, 200, { status: 'ok', tools: TOOLS.length });
      return;
    }

    if (url.pathname !== '/mcp') {
      send(res, 404, { error: 'not found', endpoints: ['/mcp', '/health'] });
      return;
    }

    if (!authorised(req)) {
      res.setHeader('www-authenticate', 'Bearer');
      send(res, 401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'POST') {
      let body: unknown;
      try {
        body = await readJson(req);
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : 'bad request body' });
        return;
      }
      await serve(req, res, body);
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      await serve(req, res, undefined);
      return;
    }

    res.setHeader('allow', 'GET, POST, DELETE');
    send(res, 405, { error: 'method not allowed' });
  }

  /**
   * Stateless: one server + one transport per request, sharing the process-wide
   * mutex and queue. No session bookkeeping, so nothing leaks between callers.
   */
  async function serve(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcp = createMcpServer(queue, mutex);
    res.on('close', () => {
      void transport.close().catch(() => undefined);
      void mcp.close().catch(() => undefined);
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  log(
    `http ready · http://${host}:${port}/mcp · dir=${queue.dirs.root} · tools=${TOOLS.length} · ` +
      `plugin=${await describePlugin(queue)} · auth=${token ? 'bearer' : 'none'}`,
  );

  const shutdown = (): void => {
    log('shutting down');
    server.close(() => process.exit(0));
    // Do not wait out keep-alive sockets.
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  log('fatal:', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});