import type { Metadata } from 'next';
import Link from 'next/link';

import { TokenCard } from '@/components/TokenCard';
import { chainLabel, isChainKey } from '@/lib/config';
import { listLaunches, stats, syncRegistry } from '@/lib/launches';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
	title: 'Registry',
	description: 'Every token launched here, numbered in order, on Robinhood Chain and Solana.',
};

const PAGE_SIZE = 24;

export default async function RegistryPage(props: PageProps<'/registry'>) {
	const params = await props.searchParams;
	const chainParam = typeof params.chain === 'string' ? params.chain : '';
	const chain = isChainKey(chainParam) ? chainParam : undefined;
	const q = typeof params.q === 'string' ? params.q.slice(0, 64) : '';
	const page = Math.max(1, Number(typeof params.page === 'string' ? params.page : 1) || 1);

	await syncRegistry().catch((error) => console.error('registry sync failed', error));
	const [{ launches, total }, totals] = await Promise.all([
		listLaunches({ chain, q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
		stats(),
	]);
	const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const href = (next: Record<string, string | number | undefined>) => {
		const sp = new URLSearchParams();
		const merged = { chain, q: q || undefined, page: undefined, ...next };
		for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== '' && !(k === 'page' && String(v) === '1')) sp.set(k, String(v));
		const s = sp.toString();
		return s ? `/registry?${s}` : '/registry';
	};

	return (
		<div className="wrap">
			<div className="section-head" style={{ paddingTop: 48 }}>
				<div>
					<span className="eyebrow">numbered in order of birth</span>
					<h2>the registry</h2>
				</div>
				<p className="muted" style={{ fontSize: 14 }}>
					{totals.robinhood.launches} on {chainLabel('robinhood').toLowerCase()} ({totals.robinhood.graduated} graduated) · {totals.solana.launches} on{' '}
					{chainLabel('solana').toLowerCase()} ({totals.solana.graduated} graduated)
				</p>
			</div>

			<form className="toolbar" action="/registry" role="search">
				{chain ? <input type="hidden" name="chain" value={chain} /> : null}
				<label htmlFor="q" className="visually-hidden">
					Search by name, ticker or address
				</label>
				<input id="q" name="q" className="input" defaultValue={q} placeholder="search name, $ticker or address" />
				<nav className="segmented" aria-label="Filter by chain">
					{([undefined, 'robinhood', 'solana'] as const).map((c) => (
						<Link key={c ?? 'all'} href={href({ chain: c, page: 1 })} aria-current={chain === c ? 'page' : undefined}>
							{c ? chainLabel(c).toLowerCase() : 'all chains'}
						</Link>
					))}
				</nav>
			</form>

			{launches.length ? (
				<div className="token-grid">
					{launches.map((launch) => (
						<TokenCard key={launch.id} launch={launch} />
					))}
				</div>
			) : (
				<div className="empty">
					<h3>{q || chain ? 'no matches' : 'the registry is empty'}</h3>
					<p>{q || chain ? 'try a different search, or clear the filters.' : 'the first launch gets #00001.'}</p>
					<div className="cta-row" style={{ justifyContent: 'center' }}>
						{q || chain ? (
							<Link href="/registry" className="btn">
								clear filters
							</Link>
						) : null}
						<Link href="/launch" className="btn btn-primary">
							launch a token
						</Link>
					</div>
				</div>
			)}

			{pages > 1 ? (
				<nav className="pager" aria-label="Pages">
					{page > 1 ? (
						<Link className="btn btn-sm" href={href({ page: page - 1 })}>
							newer
						</Link>
					) : null}
					<span>
						page {page} of {pages}
					</span>
					{page < pages ? (
						<Link className="btn btn-sm" href={href({ page: page + 1 })}>
							older
						</Link>
					) : null}
				</nav>
			) : null}
		</div>
	);
}
