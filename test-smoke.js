#!/usr/bin/env node
/** Smoke test: load the published data and call each tool once through an in-memory MCP client. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from './src/server.js';

const [ct, st] = InMemoryTransport.createLinkedPair();
const server = buildServer();
await server.connect(st);
const client = new Client({ name: 'smoke', version: '1' });
await client.connect(ct);

const calls = [
  ['banjul_facets', {}],
  ['banjul_search', { query: '"free legal assistance" violation:7', limit: 2 }],
  ['banjul_search', { query: '', body: 'Commission', article: '14', finding: 'violation', limit: 2 }],
  ['banjul_get_decision', { doc_id: 'AfCHPR-D604', operative_only: true }],
  ['banjul_check', { text: 'The Commission held that all rights "generate at least four levels of duties for a State that undertakes to adhere to a rights regime" (SERAC v Nigeria, Communication 155/96, para 44). See also Kenyan Citizens Forum v Kenya, Communication 999/19.' }],
];
let failed = 0;
for (const [name, args] of calls) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  if (r.isError) failed++;
  console.log(`=== ${name} ${r.isError ? 'ERROR' : 'ok'}\n${text.slice(0, 700)}\n`);
}
await client.close();
process.exit(failed ? 1 : 0);
