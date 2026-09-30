import { errorResponse, json } from '@/lib/http';
import { draftExpired, getDraft, getLaunchById } from '@/lib/launches';

export async function GET(_req: Request, ctx: RouteContext<'/api/drafts/[id]'>) {
	try {
		const { id } = await ctx.params;
		const draft = await getDraft(id);
		if (!draft) return json({ error: 'No launch draft with that id.' }, { status: 404 });
		const launch = draft.launchId ? await getLaunchById(draft.launchId) : null;
		return json({ draft, launch, expired: !launch && draftExpired(draft) });
	} catch (error) {
		return errorResponse(error);
	}
}
