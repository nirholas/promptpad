import { getAddress, isAddress } from 'viem';

import { errorResponse, json } from '@/lib/http';
import { draftExpired, getDraft, LaunchError } from '@/lib/launches';
import { signEvmOrigin } from '@/lib/origin';

/**
 * Platform attestation for a Robinhood Chain launch, bound to the wallet about to send it. The
 * factory verifies it on-chain and records the launch channel (site or prompt).
 */
export async function POST(req: Request, ctx: RouteContext<'/api/drafts/[id]/origin'>) {
	try {
		const { id } = await ctx.params;
		const { creator } = (await req.json().catch(() => ({}))) as { creator?: string };
		if (!creator || !isAddress(creator)) throw new LaunchError('Connect an EVM wallet first.');
		const draft = await getDraft(id);
		if (!draft || draft.chain !== 'robinhood') throw new LaunchError('No Robinhood Chain launch draft with that id.', 404);
		if (draft.launchId) throw new LaunchError('This token has already launched.', 409);
		if (draftExpired(draft)) throw new LaunchError('This launch preview has expired. Prepare a new one.', 410);
		const origin = await signEvmOrigin(draft, getAddress(creator));
		return json({ ...origin, deadline: origin.deadline.toString() });
	} catch (error) {
		return errorResponse(error);
	}
}
