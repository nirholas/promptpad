import { isAddress } from 'viem';

import { isChainKey } from '@/lib/config';
import { errorResponse, json } from '@/lib/http';
import { indexedChain, position, recentTrades } from '@/lib/market';

/** One wallet's history in a token: what it paid, what it took out, and its own trades. */
export async function GET(req: Request, ctx: RouteContext<'/api/tokens/[chain]/[address]/position'>) {
	try {
		const { chain, address } = await ctx.params;
		const wallet = new URL(req.url).searchParams.get('wallet') ?? '';
		if (!isChainKey(chain) || !indexedChain(chain)) return json({ error: 'No trade index for this chain.' }, { status: 404 });
		if (!isAddress(wallet)) return json({ error: 'wallet must be a 0x address.' }, { status: 400 });
		const [summary, trades] = await Promise.all([
			position(chain, address, wallet),
			recentTrades(chain, address, { trader: wallet, limit: 50 }),
		]);
		return json({ ...summary, trades }, { headers: { 'cache-control': 'no-store' } });
	} catch (error) {
		return errorResponse(error);
	}
}
