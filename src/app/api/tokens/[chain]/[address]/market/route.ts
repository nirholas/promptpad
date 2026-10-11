import { isChainKey } from '@/lib/config';
import { readTokenState } from '@/lib/fees';
import { errorResponse, json } from '@/lib/http';
import { getLaunch } from '@/lib/launches';
import { freshen, holderLabels, holders, indexedChain, marketStats, recentTrades, usdPrices } from '@/lib/market';

/** Everything a token page shows beyond the live curve: stats, the trade tape, holders, USD rates. */
export async function GET(_req: Request, ctx: RouteContext<'/api/tokens/[chain]/[address]/market'>) {
	try {
		const { chain, address } = await ctx.params;
		if (!isChainKey(chain)) return json({ error: 'Unknown chain.' }, { status: 404 });
		const launch = await getLaunch(chain, address);
		if (!launch) return json({ error: 'No token launched here at that address.' }, { status: 404 });

		const [usd] = await Promise.all([usdPrices(), freshen(chain)]);
		if (!indexedChain(chain)) {
			return json({ indexed: false, usd }, { headers: { 'cache-control': 'public, max-age=10' } });
		}
		const state = await readTokenState(chain, launch.address).catch(() => null);
		const [stats, trades, holderData] = await Promise.all([
			marketStats(chain, launch.address, state?.priceNative ?? null),
			recentTrades(chain, launch.address, { limit: 60 }),
			holders(chain, launch.address, holderLabels(launch, state)),
		]);
		return json(
			{ indexed: true, usd, stats, trades, holders: holderData },
			{ headers: { 'cache-control': 'public, max-age=4' } },
		);
	} catch (error) {
		return errorResponse(error);
	}
}
