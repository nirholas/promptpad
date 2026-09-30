'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Filters = { sort: string; chain: string; origin: string; q: string; view: string };

/** Sort, chain, origin and search, reflected into the URL so every view is shareable. */
export function FilterBar({ basePath, initial, gridHref, listHref }: { basePath: string; initial: Filters; gridHref: string; listHref: string }) {
	const router = useRouter();
	const [q, setQ] = useState(initial.q);
	const first = useRef(true);

	const go = (next: Partial<Filters>) => {
		const merged = { ...initial, q, ...next };
		const sp = new URLSearchParams();
		if (merged.sort && merged.sort !== 'newest') sp.set('sort', merged.sort);
		if (merged.chain) sp.set('chain', merged.chain);
		if (merged.origin) sp.set('origin', merged.origin);
		if (merged.q.trim()) sp.set('q', merged.q.trim());
		if (merged.view === 'list') sp.set('view', 'list');
		const s = sp.toString();
		router.push(s ? `${basePath}?${s}` : basePath, { scroll: false });
	};

	// Search applies as you type, debounced; the other controls apply immediately.
	useEffect(() => {
		if (first.current) {
			first.current = false;
			return;
		}
		const handle = setTimeout(() => go({ q }), 350);
		return () => clearTimeout(handle);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [q]);

	return (
		<form className="filters" role="search" onSubmit={(e) => { e.preventDefault(); go({ q }); }}>
			<label className="visually-hidden" htmlFor="f-sort">Sort</label>
			<select id="f-sort" className="select" value={initial.sort} onChange={(e) => go({ sort: e.target.value })}>
				<option value="newest">Newest</option>
				<option value="oldest">Oldest</option>
				<option value="graduated">Graduated first</option>
			</select>
			<label className="visually-hidden" htmlFor="f-chain">Chain</label>
			<select id="f-chain" className="select" value={initial.chain} onChange={(e) => go({ chain: e.target.value })}>
				<option value="">All chains</option>
				<option value="robinhood">Robinhood Chain</option>
				<option value="solana">Solana</option>
			</select>
			<label className="visually-hidden" htmlFor="f-origin">Origin</label>
			<select id="f-origin" className="select" value={initial.origin} onChange={(e) => go({ origin: e.target.value })}>
				<option value="">Any origin</option>
				<option value="prompt">Born from a prompt</option>
			</select>
			<label className="visually-hidden" htmlFor="f-q">Search name, ticker or address</label>
			<input id="f-q" className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ticker or address" autoComplete="off" />
			<div className="view-toggle" role="group" aria-label="View">
				<Link href={gridHref} aria-current={initial.view !== 'list'} aria-label="Grid view" scroll={false}>
					<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" /><rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" /></svg>
				</Link>
				<Link href={listHref} aria-current={initial.view === 'list'} aria-label="List view" scroll={false}>
					<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><rect x="1" y="2" width="14" height="2" rx="1" /><rect x="1" y="7" width="14" height="2" rx="1" /><rect x="1" y="12" width="14" height="2" rx="1" /></svg>
				</Link>
			</div>
		</form>
	);
}
