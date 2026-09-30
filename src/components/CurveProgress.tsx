'use client';

import { useEffect, useRef, useState } from 'react';

import type { ChainKey } from '@/lib/config';
import { formatPercent } from '@/lib/format';

type Progress = { progress: number | null; graduated: boolean };
type Pending = { resolve: (p: Progress) => void; reject: (e: Error) => void };

// Cards that scroll into view within the same tick share one request per chain.
const queues: Record<ChainKey, Map<string, Pending[]>> = { robinhood: new Map(), solana: new Map() };
const timers: Partial<Record<ChainKey, ReturnType<typeof setTimeout>>> = {};

function flush(chain: ChainKey) {
	const batch = queues[chain];
	queues[chain] = new Map();
	delete timers[chain];
	const addresses = [...batch.keys()];
	fetch(`/api/progress?chain=${chain}&a=${addresses.join(',')}`)
		.then(async (r) => {
			const body = (await r.json()) as { progress?: (Progress & { address: string })[]; error?: string };
			if (!r.ok || !body.progress) throw new Error(body.error || 'Progress unavailable.');
			const byAddress = new Map(body.progress.map((p) => [p.address.toLowerCase(), p]));
			for (const [address, waiters] of batch) {
				const p = byAddress.get(address.toLowerCase()) ?? { progress: null, graduated: false };
				waiters.forEach((w) => w.resolve(p));
			}
		})
		.catch((error: Error) => {
			for (const waiters of batch.values()) waiters.forEach((w) => w.reject(error));
		});
}

function requestProgress(chain: ChainKey, address: string) {
	return new Promise<Progress>((resolve, reject) => {
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

/** Live curve progress, fetched once the card scrolls into view. */
export function CurveProgress({
	chain,
	address,
	graduated,
}: {
	chain: ChainKey;
	address: string;
	graduated: boolean;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [state, setState] = useState<Progress | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		if (graduated) return;
		const el = ref.current;
		if (!el) return;
		let cancelled = false;
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((e) => e.isIntersecting)) return;
			observer.disconnect();
			requestProgress(chain, address)
				.then((p) => !cancelled && setState(p))
				.catch(() => !cancelled && setFailed(true));
		});
		observer.observe(el);
		return () => {
			cancelled = true;
			observer.disconnect();
		};
	}, [chain, address, graduated]);

	const done = graduated || state?.graduated;
	const progress = done ? 1 : (state?.progress ?? 0);
	const known = done || (state && state.progress !== null);
	return (
		<div ref={ref}>
			<div
				className={`progress ${done ? 'done' : ''}`}
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(progress * 100)}
				aria-label="Bonding curve progress"
			>
				<span style={{ width: `${known ? Math.max(progress * 100, 1.5) : 0}%` }} />
			</div>
			<div className="progress-label">
				{done ? (
					<span>graduated</span>
				) : known ? (
					<span>{formatPercent(progress)} to graduation</span>
				) : failed || state ? (
					<span>progress unavailable</span>
				) : (
					<span className="skeleton" style={{ width: 110, height: 12 }} />
				)}
			</div>
		</div>
	);
}
