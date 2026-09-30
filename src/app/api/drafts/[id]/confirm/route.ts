import { errorResponse, json } from '@/lib/http';
import { getDraft, LaunchError, recordEvmLaunch, recordSolanaLaunch } from '@/lib/launches';

export async function POST(req: Request, ctx: RouteContext<'/api/drafts/[id]/confirm'>) {
	try {
		const { id } = await ctx.params;
		const body = (await req.json().catch(() => ({}))) as { txHash?: string; signature?: string };
		const draft = await getDraft(id);
		if (!draft) throw new LaunchError('No launch draft with that id.', 404);

		const launch =
			draft.chain === 'robinhood'
				? await recordEvmLaunch(String(body.txHash ?? ''), draft.id)
				: await recordSolanaLaunch(draft.id, typeof body.signature === 'string' ? body.signature : null);
		return json({ launch });
	} catch (error) {
		return errorResponse(error);
	}
}
