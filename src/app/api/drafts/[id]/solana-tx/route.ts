import { errorResponse, json } from '@/lib/http';
import { draftExpired, getDraft, LaunchError, setDraftMint } from '@/lib/launches';
import { buildLaunchTransaction } from '@/lib/solana/dbc';
import { isSolanaAddress } from '@/lib/validate';

export async function POST(req: Request, ctx: RouteContext<'/api/drafts/[id]/solana-tx'>) {
	try {
		const { id } = await ctx.params;
		const { payer } = (await req.json().catch(() => ({}))) as { payer?: string };
		if (!payer || !isSolanaAddress(payer)) throw new LaunchError('Connect a Solana wallet first.');

		const draft = await getDraft(id);
		if (!draft || draft.chain !== 'solana') throw new LaunchError('No Solana launch draft with that id.', 404);
		if (draft.launchId) throw new LaunchError('This token has already launched.', 409);
		if (draftExpired(draft)) throw new LaunchError('This launch preview has expired. Prepare a new one.', 410);

		const built = await buildLaunchTransaction(draft, payer);
		await setDraftMint(draft.id, built.mint);
		return json(built);
	} catch (error) {
		return errorResponse(error);
	}
}
