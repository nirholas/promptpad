import 'server-only';

type Bucket = { tokens: number; updated: number };

const buckets = new Map<string, Bucket>();

/**
 * Per-key token bucket. In-process, which is the right size for one server; put a shared store in
 * front of it if the site ever runs on many instances.
 */
export function allow(key: string, perHour: number) {
	const now = Date.now();
	const refillPerMs = perHour / 3_600_000;
	const bucket = buckets.get(key) ?? { tokens: perHour, updated: now };
	bucket.tokens = Math.min(perHour, bucket.tokens + (now - bucket.updated) * refillPerMs);
	bucket.updated = now;
	if (bucket.tokens < 1) {
		buckets.set(key, bucket);
		return false;
	}
	bucket.tokens -= 1;
	buckets.set(key, bucket);
	if (buckets.size > 10_000) {
		for (const [k, b] of buckets) if (now - b.updated > 3_600_000) buckets.delete(k);
	}
	return true;
}
