import 'server-only';

import { logoSeed } from './logo';
import { LogoMark, parseGeneratedLogo } from './logo-mark';
import { publicFetch } from './net';

const EMBEDDABLE = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * A token's logo as something a share card can draw: the generated mark inline, or the creator's
 * image fetched through the SSRF guard and inlined as a data URL. Anything else falls back to the
 * generated mark, so a card always renders.
 */
async function inlineImage(image: string): Promise<string | null> {
	try {
		const res = await publicFetch(image, { headers: { accept: 'image/png,image/jpeg,image/svg+xml' }, timeoutMs: 4_000 });
		const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
		if (!res.ok || !EMBEDDABLE.has(type)) {
			await res.body?.cancel();
			return null;
		}
		const bytes = new Uint8Array(await res.arrayBuffer());
		if (bytes.length > MAX_BYTES) return null;
		let binary = '';
		for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		return `data:${type};base64,${btoa(binary)}`;
	} catch {
		// Unreachable or unsafe logo link: the caller falls back to the generated mark.
		return null;
	}
}

export async function CardLogo({ image, symbol, name, size }: { image: string; symbol: string; name: string; size: number }) {
	const generated = parseGeneratedLogo(image);
	if (generated) return <LogoMark symbol={generated.symbol} seed={generated.seed} size={size} />;
	const src = image ? await inlineImage(image) : null;
	// eslint-disable-next-line @next/next/no-img-element
	if (src) return <img src={src} width={size} height={size} style={{ objectFit: 'cover' }} alt="" />;
	return <LogoMark symbol={symbol} seed={logoSeed(symbol, name)} size={size} />;
}
