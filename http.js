#!/usr/bin/env node
/**
 * mcp-banjul — HTTP (Streamable HTTP) entry point, stateless (fresh server +
 * transport per POST). Runs on the VM behind nginx at /banjul-mcp/.
 *
 * Config (env): PORT (8015), HOST (127.0.0.1), MCP_AUTH_TOKEN (optional),
 * MCP_PUBLIC_PREFIX (default /banjul-mcp), plus DATA_BASE from src/engine.js.
 */
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer, config } from './src/server.js';
import { ready } from './src/engine.js';
ready().then(() => console.error('[banjul] data loaded')).catch((e) => console.error('[banjul] first load failed:', e.message));

const PORT = Number(process.env.PORT || 8015);
const HOST = process.env.HOST || '127.0.0.1';
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || '';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'mcp-banjul', transport: 'streamable-http', data: config.DATA_BASE });
});

function authorized(req) {
  if (!AUTH_TOKEN) return true;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.replace(/^Bearer\s+/i, '').trim() === AUTH_TOKEN) return true;
  return req.headers['x-api-key'] === AUTH_TOKEN;
}

const jsonRpcError = (res, status, code, message) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

app.post('/mcp', async (req, res) => {
  if (!authorized(req)) return jsonRpcError(res, 401, -32001, 'Unauthorized');
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp-http] request error:', err);
    if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal server error');
  }
});

const methodNotAllowed = (_req, res) =>
  jsonRpcError(res, 405, -32000, 'Method not allowed (stateless server: use POST /mcp).');
app.delete('/mcp', methodNotAllowed);

// A browser pasting the connector address gets a short page; MCP clients get the spec's 405.
const wantsHtml = (req) => String(req.headers.accept || '').includes('text/html');
const noticeHtml = (endpoint) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Banjul Researcher connector for AI assistants</title>
<style>body{margin:0;background:#f3f5f1;color:#1b2321;font:15px/1.6 ui-monospace,Menlo,monospace;border-top:6px solid #1d5a50}
main{max-width:640px;margin:0 auto;padding:48px 24px}h1{font:400 30px/1.15 Georgia,serif;margin:0 0 16px}
p{color:#3b4542;margin:0 0 14px}code{display:block;background:#e9ede6;border:1px solid #c5cdc1;padding:10px 12px;word-break:break-all;user-select:all}
a{color:#1d5a50}</style></head><body><main>
<h1>This address is a connector for AI assistants, not a web page.</h1>
<p>The connector works. Add this address as a custom connector in Claude, or in Claude Code:
<code>claude mcp add --transport http banjul ${endpoint} --scope user</code></p>
<code>${endpoint}</code>
<p>Read-only tools: paragraph-level search over the decisions of the African Commission and the African Court on Human and Peoples' Rights,
decisions verbatim with citations, and a citation check. In the browser: <a href="https://lszoszk.github.io/banjul-researcher/">lszoszk.github.io/banjul-researcher</a>.</p>
</main></body></html>`;
app.get(['/', '/mcp'], (req, res) => {
  if (!wantsHtml(req)) return methodNotAllowed(req, res);
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0];
  const prefix = String(req.headers['x-forwarded-prefix'] || process.env.MCP_PUBLIC_PREFIX || '/banjul-mcp').replace(/\/$/, '');
  res.type('html').send(noticeHtml(host ? `${proto}://${host}${prefix}/mcp` : `${prefix}/mcp`));
});

app.listen(PORT, HOST, () => {
  console.error(`mcp-banjul (http) listening on http://${HOST}:${PORT}/mcp · data ${config.DATA_BASE} · auth ${AUTH_TOKEN ? 'token-gated' : 'open (gate at proxy)'}`);
});
