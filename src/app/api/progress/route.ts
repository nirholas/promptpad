import { isAddress } from 'viem';

import { isChainKey } from '@/lib/config';
import { readProgressMany } from '@/lib/fees';
import { json } from '@/lib/http';
import { isSolanaAddress } from '@/lib/validate';

/** Batched curve progress for card grids: GET /api/progress?chain=solana&a=mint1,mint2 */
export async function GET(req: Request) {
	const url = new URL(req.url);
	const chain = url.searchParams.get('chain') ?? '';
	if (!isChainKey(chain)) return json({ error: 'Unknown chain.' }, { status: 400 });
	const valid = chain === 'robinhood' ? (a: string) => isAddress(a) : isSolanaAddress;
	const addresses = [...new Set((url.searchParams.get('a') ?? '').split(',').filter(valid))].slice(0, 50);
	try {
		const progress = await readProgressMany(chain, addresses);
		return json({ progress }, { headers: { 'cache-control': 'public, max-age=10, stale-while-revalidate=30' } });
	} catch (error) {
		console.error('progress read failed', chain, error);
		return json({ error: 'Chain data is temporarily unavailable.' }, { status: 503 });
	}
}
