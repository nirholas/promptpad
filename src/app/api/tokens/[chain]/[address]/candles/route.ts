import { isChainKey } from '@/lib/config';
import { errorResponse, json } from '@/lib/http';
import { candles, freshen, indexedChain, INTERVALS, type IntervalKey } from '@/lib/market';

export async function GET(req: Request, ctx: RouteContext<'/api/tokens/[chain]/[address]/candles'>) {
	try {
		const { chain, address } = await ctx.params;
		if (!isChainKey(chain) || !indexedChain(chain)) return json({ error: 'No trade index for this chain.' }, { status: 404 });
		const interval = (new URL(req.url).searchParams.get('interval') ?? '5m') as IntervalKey;
		if (!(interval in INTERVALS)) {
			return json({ error: `interval must be one of ${Object.keys(INTERVALS).join(', ')}` }, { status: 400 });
		}
		await freshen(chain);
		return json({ interval, candles: await candles(chain, address, interval) }, { headers: { 'cache-control': 'public, max-age=5' } });
	} catch (error) {
		return errorResponse(error);
	}
}
