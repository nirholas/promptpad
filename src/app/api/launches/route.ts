import { isChainKey } from '@/lib/config';
import { errorResponse, json } from '@/lib/http';
import { listLaunches, syncRegistry } from '@/lib/launches';

export async function GET(req: Request) {
	try {
		const url = new URL(req.url);
		const chain = url.searchParams.get('chain') ?? '';
		await syncRegistry().catch((error) => console.error('registry sync failed', error));
		const result = await listLaunches({
			chain: isChainKey(chain) ? chain : undefined,
			q: url.searchParams.get('q') ?? undefined,
			limit: Number(url.searchParams.get('limit') ?? 24),
			offset: Number(url.searchParams.get('offset') ?? 0),
		});
		return json(result, { headers: { 'cache-control': 'public, max-age=10, stale-while-revalidate=60' } });
	} catch (error) {
		return errorResponse(error);
	}
}
