import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class PublicFetchError extends Error {}

/**
 * Fetches a user- or chain-supplied URL without letting it reach private infrastructure: https
 * only, every hop must resolve to a public address, and redirects are followed manually so each
 * one is re-checked.
 */
export async function publicFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
	let current = url;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		let parsed: URL;
		try {
			parsed = new URL(current);
		} catch {
			throw new PublicFetchError('The link is not a valid URL.');
		}
		if (parsed.protocol !== 'https:') throw new PublicFetchError('The link must use https.');
		if (!(await resolvesPublic(parsed.hostname))) throw new PublicFetchError('The link must point to a public host.');

		let res: Response;
		try {
			res = await fetch(parsed, {
				...init,
				redirect: 'manual',
				signal: AbortSignal.timeout(init.timeoutMs ?? 8_000),
			});
		} catch {
			throw new PublicFetchError('The link could not be reached.');
		}
		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get('location');
			await res.body?.cancel();
			if (!location) throw new PublicFetchError('The link redirects nowhere.');
			current = new URL(location, parsed).toString();
			continue;
		}
		return res;
	}
	throw new PublicFetchError('The link redirects too many times.');
}

export type ImageCheck = { ok: true; contentType: string } | { ok: false; reason: string };

/** Confirms a logo link is a public https image before it is written on-chain forever. */
export async function checkImageUrl(url: string): Promise<ImageCheck> {
	let res: Response;
	try {
		res = await publicFetch(url, { headers: { accept: 'image/*', range: 'bytes=0-1023' } });
	} catch (error) {
		return { ok: false, reason: `Logo: ${(error as Error).message}` };
	}
	await res.body?.cancel();
	if (!res.ok) return { ok: false, reason: `The logo link answered HTTP ${res.status}.` };

	const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
	if (!contentType.startsWith('image/')) {
		return { ok: false, reason: `The logo link serves ${contentType || 'unknown content'}, not an image.` };
	}
	const total = totalSize(res.headers);
	if (total !== null && total > MAX_IMAGE_BYTES) return { ok: false, reason: 'The logo must be 5 MB or smaller.' };
	return { ok: true, contentType };
}

function totalSize(headers: Headers): number | null {
	const match = headers.get('content-range')?.match(/\/(\d+)$/);
	if (match) return Number(match[1]);
	const length = headers.get('content-length');
	return length ? Number(length) : null;
}

async function resolvesPublic(hostname: string) {
	const host = hostname.replace(/^\[|\]$/g, '');
	let addresses: string[];
	if (isIP(host)) addresses = [host];
	else {
		try {
			addresses = (await lookup(host, { all: true })).map((a) => a.address);
		} catch {
			return false;
		}
	}
	return addresses.length > 0 && addresses.every((address) => !isPrivate(address));
}

function isPrivate(address: string): boolean {
	if (address.includes(':')) {
		const a = address.toLowerCase();
		if (a.startsWith('::ffff:')) return isPrivate(a.slice(7));
		return a === '::' || a === '::1' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80');
	}
	const [a, b] = address.split('.').map(Number);
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		a >= 224
	);
}
