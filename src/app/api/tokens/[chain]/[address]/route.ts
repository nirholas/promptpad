import { isChainKey } from '@/lib/config';
import { readTokenState } from '@/lib/fees';
import { errorResponse, json } from '@/lib/http';
import { getLaunch } from '@/lib/launches';

export async function GET(_req: Request, ctx: RouteContext<'/api/tokens/[chain]/[address]'>) {
	try {
		const { chain, address } = await ctx.params;
		if (!isChainKey(chain)) return json({ error: 'Unknown chain.' }, { status: 404 });
		const launch = await getLaunch(chain, address);
		let state;
		try {
			state = await readTokenState(chain, launch?.address ?? address);
		} catch (error) {
			console.error('token state read failed', chain, address, error);
			return json({ error: 'Chain data is temporarily unavailable.' }, { status: 503, headers: { 'retry-after': '5' } });
		}
		if (!state) return json({ error: 'No token launched here at that address.' }, { status: 404 });
		return json({ state, launch }, { headers: { 'cache-control': 'public, max-age=5' } });
	} catch (error) {
		return errorResponse(error);
	}
}
