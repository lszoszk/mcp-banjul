#!/usr/bin/env node
/**
 * mcp-banjul — stdio entry point (Claude Code / Claude Desktop).
 * Diagnostics go to stderr so they don't corrupt the stdio JSON-RPC stream.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer, config } from './src/server.js';

const server = buildServer();
await server.connect(new StdioServerTransport());
console.error(`mcp-banjul (stdio) ready · data ${config.DATA_BASE}`);
