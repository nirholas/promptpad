import { SITE_URL } from '@/lib/config';
import { errorResponse, json } from '@/lib/http';
import { getDraft } from '@/lib/launches';

/** Metaplex-standard off-chain metadata for Solana launches (the mint's `uri` points here). */
export async function GET(_req: Request, ctx: RouteContext<'/api/metadata/[id]'>) {
	try {
		const { id } = await ctx.params;
		const draft = await getDraft(id);
		if (!draft || draft.chain !== 'solana') return json({ error: 'Not found.' }, { status: 404 });
		const external = draft.mint ? `${SITE_URL}/t/solana/${draft.mint}` : SITE_URL;
		return json(
			{
				name: draft.name,
				symbol: draft.symbol,
				description: draft.description,
				image: draft.image,
				external_url: external,
				properties: { files: [{ uri: draft.image, type: 'image' }], category: 'image' },
			},
			{ headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } },
		);
	} catch (error) {
		return errorResponse(error);
	}
}
