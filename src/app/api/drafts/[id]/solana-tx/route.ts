import { errorResponse, json } from '@/lib/http';
import { draftExpired, getDraft, LaunchError, setDraftMint } from '@/lib/launches';
import { buildLaunchBundle } from '@/lib/solana/pump';
import { isSolanaAddress } from '@/lib/validate';

/** The launch bundle (create + first buy, then fee + split + memo + tip) for the payer to sign. */
export async function POST(req: Request, ctx: RouteContext<'/api/drafts/[id]/solana-tx'>) {
	try {
		const { id } = await ctx.params;
		const { payer } = (await req.json().catch(() => ({}))) as { payer?: string };
		if (!payer || !isSolanaAddress(payer)) throw new LaunchError('Connect a Solana wallet first.');

		const draft = await getDraft(id);
		if (!draft || draft.chain !== 'solana') throw new LaunchError('No Solana launch draft with that id.', 404);
		if (draft.launchId) throw new LaunchError('This token has already launched.', 409);
		if (draftExpired(draft) && !draft.mint) throw new LaunchError('This launch preview has expired. Prepare a new one.', 410);

		const built = await buildLaunchBundle(draft, payer, draft.mint).catch((e: Error) => {
			throw new LaunchError(e.message);
		});
		await setDraftMint(draft.id, built.mint);
		return json(built);
	} catch (error) {
		return errorResponse(error);
	}
}
