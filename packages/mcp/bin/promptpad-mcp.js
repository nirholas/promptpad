#!/usr/bin/env node
// Stdio bridge to the hosted MCP server, for clients that launch servers with `npx` (Claude
// Desktop, Cursor, Cline, Windsurf, ...). Tools are discovered from the remote server at startup,
// so this package never drifts from the live tool set.
//
//   PROMPTPAD_URL   remote endpoint; defaults to the production server below

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const VERSION = '0.1.0';
// Set at release time to the production /mcp endpoint.
const DEFAULT_URL = '';
const target = process.env.PROMPTPAD_URL || DEFAULT_URL;
if (!target) {
	console.error('Set PROMPTPAD_URL to the launchpad MCP endpoint, e.g. https://<your-domain>/mcp');
	process.exit(1);
}
const REMOTE = new URL(target);

let remote;
async function connectRemote() {
	if (remote) return remote;
	const client = new Client({ name: 'promptpad-mcp-bridge', version: VERSION });
	await client.connect(new StreamableHTTPClientTransport(REMOTE));
	remote = client;
	return client;
}

async function withRemote(fn) {
	try {
		return await fn(await connectRemote());
	} catch (error) {
		// One reconnect covers an expired session or a dropped connection; a second failure is real.
		remote = undefined;
		try {
			return await fn(await connectRemote());
		} catch {
			throw new Error(`Could not reach ${REMOTE.href}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

const server = new Server(
	{ name: 'promptpad', version: VERSION },
	{
		capabilities: { tools: {} },
		instructions:
			'Launch tokens on Robinhood Chain or Solana. launch_token validates a launch and returns a checkout link; the user signs and pays from their own wallet there. Nothing is deployed or spent before they sign.',
	},
);

server.setRequestHandler(ListToolsRequestSchema, async () => withRemote((c) => c.listTools()));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
	withRemote((c) => c.callTool({ name: request.params.name, arguments: request.params.arguments ?? {} })),
);

await server.connect(new StdioServerTransport());
