import { feeSchedules } from '@/lib/fees';
import { errorResponse, json } from '@/lib/http';

export async function GET() {
	try {
		return json(await feeSchedules(), { headers: { 'cache-control': 'public, max-age=60' } });
	} catch (error) {
		return errorResponse(error);
	}
}
