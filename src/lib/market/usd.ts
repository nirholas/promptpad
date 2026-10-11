import 'server-only';

/**
 * Spot USD prices for the two native assets, from Coinbase's public price endpoint (no key). Cached
 * per isolate for a minute; a failed read serves the last good price for up to an hour, and after
 * that the page shows native amounts only rather than a made-up conversion.
 */

type Asset = 'ETH' | 'SOL';
const TTL_MS = 60_000;
const STALE_MS = 60 * 60_000;
const cache = new Map<Asset, { at: number; value: number }>();

async function fetchSpot(asset: Asset): Promise<number> {
	const res = await fetch(`https://api.coinbase.com/v2/prices/${asset}-USD/spot`, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(4_000),
	});
	if (!res.ok) throw new Error(`coinbase ${asset} ${res.status}`);
	const body = (await res.json()) as { data?: { amount?: string } };
	const value = Number(body.data?.amount);
	if (!Number.isFinite(value) || value <= 0) throw new Error(`coinbase ${asset} returned no price`);
	return value;
}

export async function usdPrice(asset: Asset): Promise<number | null> {
	const hit = cache.get(asset);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
	try {
		const value = await fetchSpot(asset);
		cache.set(asset, { at: Date.now(), value });
		return value;
	} catch (error) {
		console.error('usd price read failed', asset, error instanceof Error ? error.message : error);
		return hit && Date.now() - hit.at < STALE_MS ? hit.value : null;
	}
}

export async function usdPrices() {
	const [eth, sol] = await Promise.all([usdPrice('ETH'), usdPrice('SOL')]);
	return { ETH: eth, SOL: sol };
}
