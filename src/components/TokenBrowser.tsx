import Link from 'next/link';

import { chainEnabled, isChainKey, type ChainKey } from '@/lib/config';
import { formatAge, registryNumber } from '@/lib/format';
import { listLaunches } from '@/lib/launches';
import { ChainIcon } from './ChainBadge';
import { RowMetrics } from './CurveProgress';
import { FilterBar } from './FilterBar';
import { OriginChip } from './OriginChip';
import { TokenCard, TokenLogo } from './TokenCard';

const PAGE_SIZE = 24;

export type BrowserParams = { [key: string]: string | string[] | undefined };

function one(v: string | string[] | undefined) {
	return typeof v === 'string' ? v : '';
}

/** The token grid / list with its filter bar, driven entirely by URL search params. */
export async function TokenBrowser({ params, basePath }: { params: BrowserParams; basePath: string }) {
	const chainParam = one(params.chain);
	const chain: ChainKey | undefined = isChainKey(chainParam) ? chainParam : undefined;
	const origin = one(params.origin) === 'prompt' ? 'prompt' : undefined;
	const sortParam = one(params.sort);
	const sort = sortParam === 'oldest' || sortParam === 'graduated' ? sortParam : 'newest';
	const q = one(params.q).slice(0, 64);
	const view = one(params.view) === 'list' ? 'list' : 'grid';
	const page = Math.max(1, Number(one(params.page)) || 1);

	const { launches, total } = await listLaunches({ chain, origin, sort, q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
	const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const href = (next: Record<string, string | number | undefined>) => {
		const merged: Record<string, string | number | undefined> = { chain, origin, sort: sort === 'newest' ? undefined : sort, q: q || undefined, view: view === 'grid' ? undefined : view, ...next };
		const sp = new URLSearchParams();
		for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== '' && !(k === 'page' && String(v) === '1')) sp.set(k, String(v));
		const s = sp.toString();
		return s ? `${basePath}?${s}` : basePath;
	};
	const filtered = Boolean(q || chain || origin);
	const anyOpen = chainEnabled('robinhood') || chainEnabled('solana');

	return (
		<section aria-label="Tokens">
			<FilterBar basePath={basePath} initial={{ sort, chain: chain ?? '', origin: origin ?? '', q, view }} gridHref={href({ view: undefined, page: 1 })} listHref={href({ view: 'list', page: 1 })} />

			{launches.length === 0 ? (
				<div className="empty">
					<h3>{filtered ? 'no matches' : 'no tokens yet'}</h3>
					<p>{filtered ? 'try a different search, or clear the filters.' : anyOpen ? 'the registry starts at #00001. it could be yours.' : 'launches open as soon as the contracts are live.'}</p>
					<div className="cta-row" style={{ justifyContent: 'center' }}>
						{filtered ? (
							<Link href={basePath} className="btn">
								clear filters
							</Link>
						) : null}
						<Link href="/launch" className="btn btn-primary">
							launch a token
						</Link>
					</div>
				</div>
			) : view === 'grid' ? (
				<div className="token-grid">
					{launches.map((launch) => (
						<TokenCard key={launch.id} launch={launch} />
					))}
				</div>
			) : (
				<div className="card table-scroll">
					<table className="token-table">
						<thead>
							<tr>
								<th>#</th>
								<th>token</th>
								<th>chain</th>
								<th>origin</th>
								<th>age</th>
								<th>price</th>
								<th>market cap</th>
								<th>curve</th>
							</tr>
						</thead>
						<tbody>
							{launches.map((l) => (
								<RowMetrics key={l.id} chain={l.chain} address={l.address} graduated={l.graduated}>
									<td className="muted">{registryNumber(l.number)}</td>
									<td>
										<div className="who">
											<TokenLogo src={l.image} alt="" symbol={l.symbol} />
											<div>
												<Link href={`/t/${l.chain}/${l.address}`}>{l.name}</Link>
												<div className="muted" style={{ fontFamily: 'var(--font-code)', fontSize: 12 }}>
													${l.symbol}
												</div>
											</div>
										</div>
									</td>
									<td>
										<span className="chain-badge">
											<ChainIcon chain={l.chain} />
										</span>
									</td>
									<td>
										<OriginChip launch={l} />
									</td>
									<td className="muted">{formatAge(l.createdAt)}</td>
								</RowMetrics>
							))}
						</tbody>
					</table>
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
						page {page} of {pages} · {total} tokens
					</span>
					{page < pages ? (
						<Link className="btn btn-sm" href={href({ page: page + 1 })}>
							older
						</Link>
					) : null}
				</nav>
			) : null}
		</section>
	);
}
