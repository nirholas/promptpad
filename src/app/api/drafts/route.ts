import { clientIp, errorResponse, json } from '@/lib/http';
import { prepareLaunch } from '@/lib/prepare';

export async function POST(req: Request) {
	try {
		const body = await req.json().catch(() => ({}));
		const { draft, checkoutUrl } = await prepareLaunch(body, 'web', clientIp(req));
		return json({ draft, checkoutUrl }, { status: 201 });
	} catch (error) {
		return errorResponse(error);
	}
}
