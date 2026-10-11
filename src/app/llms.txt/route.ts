import { chainEnabled, PAD_FACTORY, SITE_NAME, SITE_URL } from '@/lib/config';

/**
 * llms.txt: a plain-text map of the site for AI agents, so an assistant that lands here finds the
 * connector, the tools and the public API without scraping pages.
 */
export function GET() {
	const lines = [
		`# ${SITE_NAME}`,
		'',
		'> Launch a token on Robinhood Chain or Solana from a prompt. An AI assistant prepares the launch over MCP; the user signs and pays from their own wallet at a checkout link. Tokens trade on a bonding curve and graduate into locked liquidity. The creator earns 70% of the trade fee forever.',
		'',
		'## Connect',
		'',
		`- MCP endpoint (streamable HTTP): ${SITE_URL}/mcp`,
		'- Claude: Settings, Connectors, Add custom connector, paste the endpoint.',
		`- Claude Code: claude mcp add --transport http promptpad ${SITE_URL}/mcp`,
		'- stdio clients: npx -y promptpad-mcp',
		'',
		'## MCP tools',
		'',
		'- launch_token: validate a launch (name, ticker, optional logo, fee wallet) and return a checkout link. Spends nothing.',
		'- launch_status: whether a prepared launch was signed, with the token address once it was.',
		'- token_info: live price, market cap, curve progress and claimable creator fees.',
		'- trade_link: a token page with a buy or sell prefilled for the user to sign.',
		'- recent_launches: the registry, filterable by chain or search.',
		'- fee_schedule: fee terms per chain, read from the chain.',
		'',
		'## Chains',
		'',
		`- Robinhood Chain (4663): ${chainEnabled('robinhood') ? `open. PadFactory ${PAD_FACTORY}` : 'not open on this deployment'}`,
		`- Solana: ${chainEnabled('solana') ? 'open, on pump.fun' : 'not open on this deployment'}`,
		'',
		'## Public API (JSON, no key)',
		'',
		`- ${SITE_URL}/api/launches?origin=prompt: launches born from a prompt (also ?chain=, ?q=, ?limit=)`,
		`- ${SITE_URL}/api/tokens/{chain}/{address}: live token state`,
		`- ${SITE_URL}/api/tokens/{chain}/{address}/market: 24h stats, recent trades, holders, USD rates`,
		`- ${SITE_URL}/api/tokens/{chain}/{address}/candles?interval=1m|5m|15m|1h|4h|1d: OHLCV`,
		`- ${SITE_URL}/api/fees: fee terms per chain`,
		`- ${SITE_URL}/.well-known/launch-provenance.json: how to verify a launch came from a prompt, from chain data alone`,
		'',
		'## Pages',
		'',
		`- ${SITE_URL}/registry: every launch, with a born-from-a-prompt filter`,
		`- ${SITE_URL}/guide: how launching, fees, graduation and provenance work`,
		`- ${SITE_URL}/t/{chain}/{address}: token page with chart, trades, holders and trading`,
		'',
	];
	return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
