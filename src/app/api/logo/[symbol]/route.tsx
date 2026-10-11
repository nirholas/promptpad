import { ImageResponse } from 'next/og';

import { LOGO_SEED, LOGO_SYMBOL } from '@/lib/logo';
import { LogoMark } from '@/lib/logo-mark';

const SIZE = 512;

/**
 * The generated mark for a launch without a logo, as a PNG every wallet and explorer can show.
 * Same symbol and seed, same image, forever; the URL is what goes on-chain.
 */
export async function GET(req: Request, ctx: RouteContext<'/api/logo/[symbol]'>) {
	const { symbol: raw } = await ctx.params;
	const symbol = decodeURIComponent(raw).toUpperCase();
	const seed = new URL(req.url).searchParams.get('v') ?? '';
	if (!LOGO_SYMBOL.test(symbol) || !LOGO_SEED.test(seed)) {
		return Response.json({ error: 'Expected /api/logo/<TICKER>?v=<8 hex chars>.' }, { status: 400 });
	}
	return new ImageResponse(<LogoMark symbol={symbol} seed={seed} size={SIZE} />, {
		width: SIZE,
		height: SIZE,
		headers: { 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*' },
	});
}
