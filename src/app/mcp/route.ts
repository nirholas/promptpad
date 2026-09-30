import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

import { chainEnabled, chainLabel, explorer, isChainKey, nativeSymbol, SITE_NAME, SITE_URL } from '@/lib/config';
import { feeSchedule, readTokenState } from '@/lib/fees';
import { clientIp } from '@/lib/http';
import { draftExpired, getDraft, getLaunchById, LaunchError, listLaunches, syncRegistry } from '@/lib/launches';
import { prepareLaunch } from '@/lib/prepare';
import { firstIssue } from '@/lib/validate';

const INSTRUCTIONS = `${SITE_NAME} launches tokens on Robinhood Chain or Solana onto a bonding curve that graduates into a locked DEX pool.

Flow: call launch_token with the details the user gave you. It validates everything and returns a preview plus a checkout link valid for 24 hours. Show the user the preview and the link. The user opens the link, connects their own wallet, reviews the fee, and signs; nothing is launched and nothing is spent until they sign. Afterwards launch_status tells you the token address.

Never invent a name, ticker, logo or fee wallet: ask the user for anything missing. The fee wallet receives the creator's share of trading fees forever and cannot be changed after launch.`;

function text(value: string, structured?: Record<string, unknown>) {
	return {
		content: [{ type: 'text' as const, text: value }],
		...(structured ? { structuredContent: structured } : {}),
	};
}

function failure(message: string) {
	return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function describeError(error: unknown) {
	if (error instanceof z.ZodError) return firstIssue(error);
	if (error instanceof LaunchError) return error.message;
	console.error(error);
	return 'The launch service hit an unexpected error. Try again in a moment.';
}

/**
 * Which assistant is calling, from the request's User-Agent. Stored on the draft and shown on the
 * token ("born in claude"); the on-chain channel records "prompt" regardless of the client.
 */
function clientHint(headers: Record<string, string | string[] | undefined> | undefined): string | null {
	const raw = headers?.['user-agent'];
	const ua = (Array.isArray(raw) ? raw[0] : raw)?.trim();
	if (!ua) return null;
	if (/claude|anthropic/i.test(ua)) return 'claude';
	if (/chatgpt|openai/i.test(ua)) return 'chatgpt';
	if (/cursor/i.test(ua)) return 'cursor';
	return ua.slice(0, 120);
}

function buildServer(requester: string) {
	const server = new McpServer({ name: SITE_NAME.toLowerCase(), version: '1.0.0' }, { instructions: INSTRUCTIONS });

	server.registerTool(
		'launch_token',
		{
			title: 'Prepare a token launch',
			description:
				'Validate a new token and return a preview card plus a checkout link. The user signs and pays the launch fee from their own wallet at that link; this tool itself never spends or deploys anything.',
			inputSchema: {
				chain: z.enum(['robinhood', 'solana']).describe('robinhood = Robinhood Chain (ETH). solana = Solana (SOL).'),
				name: z.string().describe('Token name, up to 32 bytes.'),
				ticker: z.string().describe('Ticker, 1 to 10 letters or digits, without the $.'),
				logo_url: z.string().describe('Public https link to the logo image (png, jpg, gif, webp, svg).'),
				description: z.string().optional().describe('Optional one-paragraph description, up to 1000 bytes.'),
				fee_wallet: z
					.string()
					.describe('Wallet that receives the creator share of trading fees: a 0x address on Robinhood Chain, a Solana address on Solana.'),
				initial_buy: z
					.string()
					.optional()
					.describe('Optional amount of ETH or SOL the launcher buys in the launch transaction itself, e.g. "0.05".'),
			},
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
		},
		async (args, extra) => {
			try {
				const { draft, checkoutUrl } = await prepareLaunch(
					{
						chain: args.chain,
						name: args.name,
						symbol: args.ticker,
						image: args.logo_url,
						description: args.description ?? '',
						feeWallet: args.fee_wallet,
						initialBuy: args.initial_buy ?? '0',
					},
					'claude',
					requester,
					clientHint(extra.requestInfo?.headers),
				);
				const fees = await feeSchedule(draft.chain);
				const native = nativeSymbol(draft.chain);
				const lines = [
					`Preview: ${draft.name} ($${draft.symbol}) on ${chainLabel(draft.chain)}`,
					`Logo: ${draft.image}`,
					draft.description ? `Description: ${draft.description}` : null,
					`Fee wallet: ${draft.feeWallet}`,
					Number(draft.initialBuy) > 0 ? `Initial buy: ${draft.initialBuy} ${native}` : null,
					fees
						? `Launch fee: ${fees.launchFee} ${native}. Trade fee ${fees.tradeFeeBps / 100}%, creator share ${fees.creatorShareBps / 100}% of it. Graduates at ${fees.graduationTarget} ${native} raised into ${fees.graduatesTo}.`
						: null,
					'',
					`Open to review and sign with your wallet (valid 24 hours): ${checkoutUrl}`,
				].filter((l) => l !== null);
				return text(lines.join('\n'), {
					draftId: draft.id,
					checkoutUrl,
					chain: draft.chain,
					name: draft.name,
					ticker: draft.symbol,
					logoUrl: draft.image,
					feeWallet: draft.feeWallet,
					initialBuy: draft.initialBuy,
					expiresAt: draft.expiresAt,
					launchFee: fees?.launchFee ?? null,
				});
			} catch (error) {
				return failure(describeError(error));
			}
		},
	);

	server.registerTool(
		'launch_status',
		{
			title: 'Check a launch',
			description: 'Whether a prepared launch has been signed yet, and its token address and links once it has.',
			inputSchema: { draft_id: z.string().describe('The draftId returned by launch_token.') },
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async ({ draft_id }) => {
			try {
				const draft = await getDraft(draft_id);
				if (!draft) return failure('No launch with that id.');
				const launch = draft.launchId ? await getLaunchById(draft.launchId) : null;
				if (!launch) {
					const status = draftExpired(draft) ? 'expired' : 'awaiting signature';
					return text(`$${draft.symbol} is ${status}. Checkout: ${SITE_URL}/launch/${draft.id}`, { status });
				}
				const page = `${SITE_URL}/t/${launch.chain}/${launch.address}`;
				return text(
					[
						`$${launch.symbol} launched on ${chainLabel(launch.chain)} as registry #${launch.number}.`,
						`Token: ${launch.address}`,
						`Page: ${page}`,
						launch.tx ? `Transaction: ${explorer(launch.chain, 'tx', launch.tx)}` : null,
					]
						.filter(Boolean)
						.join('\n'),
					{ status: 'launched', registry: launch.number, address: launch.address, page, tx: launch.tx },
				);
			} catch (error) {
				return failure(describeError(error));
			}
		},
	);

	server.registerTool(
		'token_info',
		{
			title: 'Token stats',
			description: 'Live price, market cap, curve progress and graduation status of a token launched here.',
			inputSchema: {
				chain: z.enum(['robinhood', 'solana']),
				address: z.string().describe('Token address (0x... on Robinhood Chain, mint on Solana).'),
			},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async ({ chain, address }) => {
			try {
				const state = await readTokenState(chain, address);
				if (!state) return failure('No token launched here at that address.');
				const native = nativeSymbol(chain);
				return text(
					[
						`Price: ${state.priceNative.toPrecision(4)} ${native}`,
						`Market cap: ${state.marketCapNative.toFixed(3)} ${native}`,
						state.graduated
							? 'Graduated: trading on the DEX pool.'
							: `Curve: ${(state.progress * 100).toFixed(1)}% (${state.raisedNative.toFixed(3)} / ${Number(state.targetNative.toFixed(2))} ${native})`,
						`Creator fees waiting to claim: ${state.creatorFeesClaimableNative.toFixed(6)} ${native}`,
						`Page: ${SITE_URL}/t/${chain}/${address}`,
					].join('\n'),
					state as unknown as Record<string, unknown>,
				);
			} catch (error) {
				return failure(describeError(error));
			}
		},
	);

	server.registerTool(
		'recent_launches',
		{
			title: 'Registry',
			description: 'The most recent tokens in the registry, optionally filtered by chain or a search term.',
			inputSchema: {
				chain: z.enum(['robinhood', 'solana']).optional(),
				query: z.string().optional().describe('Match against name, ticker or address.'),
				limit: z.number().int().min(1).max(25).optional(),
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async ({ chain, query, limit }) => {
			try {
				await syncRegistry().catch(() => undefined);
				const { launches, total } = await listLaunches({ chain, q: query, limit: limit ?? 10 });
				if (!launches.length) return text('No launches match yet.', { total });
				const lines = launches.map(
					(l) =>
						`#${l.number} ${l.name} ($${l.symbol}) on ${chainLabel(l.chain)}${l.graduated ? ', graduated' : ''}: ${SITE_URL}/t/${l.chain}/${l.address}`,
				);
				return text(lines.join('\n'), { total, launches });
			} catch (error) {
				return failure(describeError(error));
			}
		},
	);

	server.registerTool(
		'fee_schedule',
		{
			title: 'Fees',
			description: 'Launch fee, trade fee, creator share and graduation terms on each chain.',
			inputSchema: { chain: z.enum(['robinhood', 'solana']).optional() },
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async ({ chain }) => {
			const chains = chain && isChainKey(chain) ? [chain] : (['robinhood', 'solana'] as const);
			const out: Record<string, unknown> = {};
			const lines: string[] = [];
			for (const c of chains) {
				if (!chainEnabled(c)) {
					lines.push(`${chainLabel(c)}: not open on this deployment yet.`);
					continue;
				}
				const f = await feeSchedule(c).catch(() => null);
				if (!f) continue;
				out[c] = f;
				const n = nativeSymbol(c);
				lines.push(
					`${chainLabel(c)}: launch ${f.launchFee} ${n}; trade fee ${f.tradeFeeBps / 100}% (creator ${f.creatorShareBps / 100}% of it)` +
						(f.antiSnipe ? `, opening at ${f.antiSnipe.startBps / 100}% and decaying over ${f.antiSnipe.seconds}s` : '') +
						`; graduation at ${f.graduationTarget} ${n} with a ${f.graduationFeeBps / 100}% fee into ${f.graduatesTo}. ${f.lpTerms}`,
				);
			}
			return text(lines.join('\n'), out);
		},
	);

	return server;
}

async function handle(req: Request) {
	const server = buildServer(clientIp(req));
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	await server.connect(transport);
	return transport.handleRequest(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
