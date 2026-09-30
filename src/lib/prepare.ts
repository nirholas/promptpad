import 'server-only';

import { SITE_URL } from './config';
import { createDraft, LaunchError } from './launches';
import { checkImageUrl } from './net';
import { allow } from './rate-limit';
import type { Draft } from './types';
import { launchInputSchema } from './validate';

export function checkoutUrl(draft: Pick<Draft, 'id'>) {
	return `${SITE_URL}/launch/${draft.id}`;
}

/** Validate, screen the logo, and store a launch draft. Shared by the site and the Claude connector. */
export async function prepareLaunch(raw: unknown, source: Draft['source'], requester: string) {
	const input = launchInputSchema.parse(raw);
	if (!allow(`draft:${requester}`, 20)) {
		throw new LaunchError('Too many launch previews from this connection. Try again within the hour.', 429);
	}
	const image = await checkImageUrl(input.image);
	if (!image.ok) throw new LaunchError(image.reason);
	const draft = await createDraft(input, source);
	return { draft, checkoutUrl: checkoutUrl(draft) };
}
