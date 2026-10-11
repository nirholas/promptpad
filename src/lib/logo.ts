/**
 * Generated token marks. A launch without a logo gets a monochrome mark drawn from its ticker and
 * name, served as a PNG by /api/logo/[symbol]. The URL is fully deterministic, so the image written
 * on-chain renders the same forever without anything stored, and the launch form can preview the
 * exact mark before anyone signs.
 */

/** 32-bit FNV-1a over the name and ticker, as 8 hex chars. */
export function logoSeed(symbol: string, name: string): string {
	let hash = 0x811c9dc5;
	for (const byte of new TextEncoder().encode(`${symbol.toUpperCase()}\u0000${name.trim()}`)) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

export function generatedLogoPath(symbol: string, name: string): string {
	const ticker = symbol.replace(/^\$/, '').toUpperCase();
	return `/api/logo/${encodeURIComponent(ticker)}?v=${logoSeed(ticker, name)}`;
}

export const LOGO_SYMBOL = /^[A-Z0-9]{1,10}$/;
export const LOGO_SEED = /^[0-9a-f]{8}$/;

/** A small deterministic PRNG (mulberry32) so one seed always draws the same mark. */
export function prng(seedHex: string) {
	let a = parseInt(seedHex, 16) >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
