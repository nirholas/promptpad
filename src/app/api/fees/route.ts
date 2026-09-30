import { chainEnabled } from '@/lib/config';
import { feeSchedules } from '@/lib/fees';
import { errorResponse, json } from '@/lib/http';

export async function GET() {
	try {
		const fees = await feeSchedules();
		// A chain that is configured but failed to read must not be cached as closed.
		const degraded = (['robinhood', 'solana'] as const).some((c) => chainEnabled(c) && fees[c] === null);
		return json(fees, { headers: { 'cache-control': degraded ? 'no-store' : 'public, max-age=60' } });
	} catch (error) {
		return errorResponse(error);
	}
}
