'use client';

import { useEffect, useRef, useState } from 'react';

import { nativeSymbol, type ChainKey } from '@/lib/config';
import { formatNative, formatPercent } from '@/lib/format';

export type Metrics = { progress: number | null; graduated: boolean; priceNative: number | null; marketCapNative: number | null };
type Pending = { resolve: (m: Metrics) => void; reject: (e: Error) => void };

// Cards that scroll into view in the same tick share one request per chain.
const queues: Record<ChainKey, Map<string, Pending[]>> = { robinhood: new Map(), solana: new Map() };
const timers: Partial<Record<ChainKey, ReturnType<typeof setTimeout>>> = {};

function flush(chain: ChainKey) {
	const batch = queues[chain];
	queues[chain] = new Map();
	delete timers[chain];
	fetch(`/api/progress?chain=${chain}&a=${[...batch.keys()].join(',')}`)
		.then(async (r) => {
			const body = (await r.json()) as { progress?: (Metrics & { address: string })[]; error?: string };
			if (!r.ok || !body.progress) throw new Error(body.error || 'Metrics unavailable.');
			const byAddress = new Map(body.progress.map((p) => [p.address.toLowerCase(), p]));
			for (const [address, waiters] of batch) {
				const m = byAddress.get(address.toLowerCase()) ?? { progress: null, graduated: false, priceNative: null, marketCapNative: null };
				waiters.forEach((w) => w.resolve(m));
			}
		})
		.catch((error: Error) => {
			for (const waiters of batch.values()) waiters.forEach((w) => w.reject(error));
		});
}

function request(chain: ChainKey, address: string) {
	return new Promise<Metrics>((resolve, reject) => {
		const list = queues[chain].get(address) ?? [];
		list.push({ resolve, reject });
		queues[chain].set(address, list);
		if (queues[chain].size >= 50) {
			clearTimeout(timers[chain]);
			flush(chain);
		} else {
			timers[chain] ??= setTimeout(() => flush(chain), 60);
		}
	});
}

/** Live card metrics, fetched once the element scrolls into view. */
function useMetrics(chain: ChainKey, address: string) {
	const ref = useRef<HTMLDivElement & HTMLTableRowElement>(null);
	const [metrics, setMetrics] = useState<Metrics | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		let cancelled = false;
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((e) => e.isIntersecting)) return;
			observer.disconnect();
			request(chain, address)
				.then((m) => !cancelled && setMetrics(m))
				.catch(() => !cancelled && setFailed(true));
		});
		observer.observe(el);
		return () => {
			cancelled = true;
			observer.disconnect();
		};
	}, [chain, address]);
	return { ref, metrics, failed };
}

function Value({ value, failed }: { value: string | null; failed: boolean }) {
	if (value !== null) return <strong>{value}</strong>;
	if (failed) return <strong className="muted">unavailable</strong>;
	return <span className="skeleton" style={{ width: 96, height: 18 }} />;
}

/** The price / market cap / curve block of a token card. */
export function CardMetrics({ chain, address, graduated }: { chain: ChainKey; address: string; graduated: boolean }) {
	const { ref, metrics, failed } = useMetrics(chain, address);
	const native = nativeSymbol(chain);
	const done = graduated || metrics?.graduated;
	const progress = done ? 1 : (metrics?.progress ?? null);
	return (
		<div ref={ref} style={{ display: 'grid', gap: 18 }}>
			<div className="metrics">
				<div>
					<span className="caps">price</span>
					<Value value={metrics?.priceNative != null ? formatNative(metrics.priceNative, native) : null} failed={failed} />
				</div>
				<div>
					<span className="caps">market cap</span>
					<Value value={metrics?.marketCapNative != null ? formatNative(metrics.marketCapNative, native) : null} failed={failed} />
				</div>
			</div>
			<div>
				<div
					className="progress"
					role="progressbar"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={progress !== null ? Math.round(progress * 100) : undefined}
					aria-label="Bonding curve progress"
				>
					<span style={{ width: `${progress !== null ? Math.max(progress * 100, 1) : 0}%` }} />
				</div>
				<div className="progress-label">
					<span>{done ? 'graduated' : progress !== null ? `${formatPercent(progress)} to graduation` : failed ? 'curve unavailable' : 'reading curve'}</span>
				</div>
			</div>
		</div>
	);
}

/** Table cells for the list view; the row element itself observes visibility. */
export function RowMetrics({ chain, address, graduated, children }: { chain: ChainKey; address: string; graduated: boolean; children: React.ReactNode }) {
	const { ref, metrics, failed } = useMetrics(chain, address);
	const native = nativeSymbol(chain);
	const done = graduated || metrics?.graduated;
	const cell = (v: string | null) => (v !== null ? v : failed ? 'unavailable' : <span className="skeleton" style={{ width: 72, height: 14 }} />);
	return (
		<tr ref={ref}>
			{children}
			<td>{cell(metrics?.priceNative != null ? formatNative(metrics.priceNative, native) : null)}</td>
			<td>{cell(metrics?.marketCapNative != null ? formatNative(metrics.marketCapNative, native) : null)}</td>
			<td>{done ? 'graduated' : cell(metrics?.progress != null ? formatPercent(metrics.progress) : null)}</td>
		</tr>
	);
}
