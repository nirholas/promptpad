'use client';

import { useEffect, useState } from 'react';
import { useConnection } from 'wagmi';

import { explorer, nativeSymbol, type ChainKey } from '@/lib/config';
import { formatNative, formatPercent, formatTokens, shortAddress } from '@/lib/format';
import type { TokenState } from '@/lib/types';

export type MarketTrade = {
	tx: string;
	ts: number;
	trader: string;
	side: 'buy' | 'sell';
	venue: 'curve' | 'pool';
	nativeAmount: number;
	tokenAmount: number;
	priceNative: number;
};

export type MarketData = {
	indexed: boolean;
	usd: { ETH: number | null; SOL: number | null };
	stats?: {
		change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
		volume24hNative: number;
		buys24h: number;
		sells24h: number;
		traders24h: number;
		totalTrades: number;
		athPriceNative: number | null;
		athAt: number | null;
		firstTradeAt: number | null;
		lastTradeAt: number | null;
	};
	trades?: MarketTrade[];
	holders?: {
		count: number;
		top10Share: number | null;
		top: { address: string; balance: number; share: number; label: string | null }[];
	};
};

const TOTAL_SUPPLY = 1_000_000_000;

export function formatUsd(value: number | null | undefined) {
	if (value === null || value === undefined || !Number.isFinite(value)) return '-';
	const abs = Math.abs(value);
	if (abs >= 1000) return `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)}`;
	if (abs >= 1) return `$${value.toFixed(2)}`;
	return `$${formatNative(value)}`;
}

function ago(ts: number, now: number) {
	const s = Math.max(0, Math.floor(now / 1000 - ts));
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86_400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86_400)}d`;
}

function Change({ label, value }: { label: string; value: number | null }) {
	const cls = value === null ? '' : value > 0 ? 'up' : value < 0 ? 'down' : '';
	return (
		<span className="change">
			<em>{label}</em>
			<span className={cls}>{value === null ? '-' : `${value > 0 ? '+' : ''}${value.toFixed(value !== 0 && Math.abs(value) < 10 ? 2 : 1)}%`}</span>
		</span>
	);
}

/** Top-of-page numbers: price and market cap in USD and native, changes, volume, pressure, holders. */
export function MarketStrip({ chain, state, data }: { chain: ChainKey; state: TokenState; data: MarketData | null }) {
	const native = nativeSymbol(chain);
	const rate = data?.usd[native as 'ETH' | 'SOL'] ?? null;
	const stats = data?.stats;
	const buys = stats?.buys24h ?? 0;
	const sells = stats?.sells24h ?? 0;
	const total = buys + sells;
	return (
		<div style={{ display: 'grid', gap: 12 }}>
			<div className="ticker-strip">
				<div>
					<span>price</span>
					<strong>{rate ? formatUsd(state.priceNative * rate) : formatNative(state.priceNative, native)}</strong>
					<small>{formatNative(state.priceNative, native)}</small>
				</div>
				<div>
					<span>market cap</span>
					<strong>{rate ? formatUsd(state.marketCapNative * rate) : formatNative(state.marketCapNative, native)}</strong>
					<small>{formatNative(state.marketCapNative, native)}</small>
				</div>
				<div>
					<span>{state.graduated ? 'raised' : 'in curve'}</span>
					<strong>{rate ? formatUsd(state.raisedNative * rate) : formatNative(state.raisedNative, native)}</strong>
					<small>{formatNative(state.raisedNative, native)}</small>
				</div>
				{stats ? (
					<>
						<div>
							<span>24h volume</span>
							<strong>{rate ? formatUsd(stats.volume24hNative * rate) : formatNative(stats.volume24hNative, native)}</strong>
							<small>{formatNative(stats.volume24hNative, native)}</small>
						</div>
						<div>
							<span>holders</span>
							<strong>{data?.holders ? data.holders.count.toLocaleString('en-US') : '-'}</strong>
							<small>{data?.holders?.top10Share != null ? `top 10 hold ${formatPercent(data.holders.top10Share)}` : 'no holders yet'}</small>
						</div>
						<div>
							<span>all-time high</span>
							<strong>{stats.athPriceNative ? (rate ? formatUsd(stats.athPriceNative * TOTAL_SUPPLY * rate) : formatNative(stats.athPriceNative * TOTAL_SUPPLY, native)) : '-'}</strong>
							<small>market cap at peak</small>
						</div>
					</>
				) : null}
			</div>
			{stats ? (
				<div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }} className="strip-lower">
					<div className="change-row" aria-label="Price change">
						<Change label="5m" value={stats.change.m5} />
						<Change label="1h" value={stats.change.h1} />
						<Change label="6h" value={stats.change.h6} />
						<Change label="24h" value={stats.change.h24} />
					</div>
					<div className="pressure" aria-label={`24 hour trades: ${buys} buys, ${sells} sells`}>
						<div className="pressure-bar">
							<i style={{ width: total ? `${(buys / total) * 100}%` : '50%' }} />
							<i style={{ width: total ? `${(sells / total) * 100}%` : '50%' }} />
						</div>
						<div className="pressure-legend">
							<span className="up">{buys} buys</span>
							<span className="muted">{stats.traders24h} traders · 24h</span>
							<span className="down">{sells} sells</span>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}

type Filter = 'all' | 'buy' | 'sell' | 'large' | 'dev';

/** The trade tape, holders, and the connected wallet's position. */
export function MarketTabs({
	chain,
	address,
	symbol,
	state,
	data,
	creator,
}: {
	chain: ChainKey;
	address: string;
	symbol: string;
	state: TokenState;
	data: MarketData | null;
	creator: string;
}) {
	const [tab, setTab] = useState<'trades' | 'holders' | 'position'>('trades');
	const [filter, setFilter] = useState<Filter>('all');
	const native = nativeSymbol(chain);
	const rate = data?.usd[native as 'ETH' | 'SOL'] ?? null;
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 5_000);
		return () => clearInterval(t);
	}, []);

	// Trades from the last few seconds flash once as they land on the tape.
	const isFresh = (t: MarketTrade) => now / 1000 - t.ts < 12;

	if (!data?.indexed) return null;
	const trades = data.trades ?? [];
	const creatorLower = creator.toLowerCase();
	const largeCut = Math.max(0.05, (state.targetNative || 1) * 0.02);
	const shown = trades.filter((t) =>
		filter === 'all' ? true : filter === 'large' ? t.nativeAmount >= largeCut : filter === 'dev' ? t.trader === creatorLower : t.side === filter,
	);

	return (
		<div className="card card-pad" style={{ paddingTop: 6 }}>
			<div className="terminal-tabs" role="tablist" aria-label="Market data">
				<button role="tab" type="button" aria-selected={tab === 'trades'} onClick={() => setTab('trades')}>
					trades<small>{data.stats?.totalTrades ?? 0}</small>
				</button>
				<button role="tab" type="button" aria-selected={tab === 'holders'} onClick={() => setTab('holders')}>
					holders<small>{data.holders?.count ?? 0}</small>
				</button>
				<button role="tab" type="button" aria-selected={tab === 'position'} onClick={() => setTab('position')}>
					my position
				</button>
			</div>

			{tab === 'trades' ? (
				<>
					<div className="filter-row segmented" role="group" aria-label="Filter trades" style={{ border: 0, padding: '10px 0' }}>
						{(
							[
								['all', 'all'],
								['buy', 'buys'],
								['sell', 'sells'],
								['large', `≥ ${formatNative(largeCut)} ${native}`],
								['dev', 'creator'],
							] as const
						).map(([key, label]) => (
							<button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
								{label}
							</button>
						))}
					</div>
					{shown.length ? (
						<div className="tape-wrap">
							<table className="tape">
								<thead>
									<tr>
										<th>age</th>
										<th>type</th>
										<th className="num">{rate ? 'usd' : native.toLowerCase()}</th>
										<th className="num">{native.toLowerCase()}</th>
										<th className="num">${symbol.toLowerCase()}</th>
										<th className="num">mcap</th>
										<th>trader</th>
										<th>tx</th>
									</tr>
								</thead>
								<tbody>
									{shown.map((t) => {
										const id = `${t.tx}:${t.side}:${t.tokenAmount}`;
										return (
											<tr key={id} className={isFresh(t) ? 'fresh' : undefined}>
												<td className="muted">{ago(t.ts, now)}</td>
												<td className={t.side === 'buy' ? 'up' : 'down'}>
													{t.side}
													{t.venue === 'pool' ? <span className="muted"> · pool</span> : null}
												</td>
												<td className="num">{rate ? formatUsd(t.nativeAmount * rate) : formatNative(t.nativeAmount)}</td>
												<td className="num">{formatNative(t.nativeAmount)}</td>
												<td className="num">{formatTokens(t.tokenAmount)}</td>
												<td className="num">{rate ? formatUsd(t.priceNative * TOTAL_SUPPLY * rate) : formatNative(t.priceNative * TOTAL_SUPPLY)}</td>
												<td className="mono">
													<a href={explorer(chain, 'address', t.trader)} target="_blank" rel="noreferrer">
														{shortAddress(t.trader)}
													</a>
													{t.trader === creatorLower ? <span className="chip" style={{ marginLeft: 6 }}>creator</span> : null}
												</td>
												<td>
													<a href={explorer(chain, 'tx', t.tx)} target="_blank" rel="noreferrer" aria-label="View transaction">
														↗
													</a>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					) : (
						<p className="muted" style={{ padding: '18px 0' }}>
							{trades.length ? 'no trades match this filter.' : `no trades yet. the first buy of $${symbol} shows up here within seconds.`}
						</p>
					)}
				</>
			) : null}

			{tab === 'holders' ? <HoldersTable chain={chain} data={data} /> : null}
			{tab === 'position' ? <Position chain={chain} address={address} symbol={symbol} state={state} rate={rate} /> : null}
		</div>
	);
}

function HoldersTable({ chain, data }: { chain: ChainKey; data: MarketData }) {
	const top = data.holders?.top ?? [];
	if (!top.length) return <p className="muted" style={{ padding: '18px 0' }}>no holders indexed yet.</p>;
	return (
		<div className="tape-wrap">
			<table className="tape">
				<thead>
					<tr>
						<th>#</th>
						<th>holder</th>
						<th className="num">share</th>
						<th style={{ width: '30%' }} />
						<th className="num">tokens</th>
					</tr>
				</thead>
				<tbody>
					{top.map((h, i) => (
						<tr key={h.address}>
							<td className="muted">{i + 1}</td>
							<td className="mono">
								<a href={explorer(chain, 'address', h.address)} target="_blank" rel="noreferrer">
									{shortAddress(h.address)}
								</a>
								{h.label ? <span className="chip" style={{ marginLeft: 6 }}>{h.label}</span> : null}
							</td>
							<td className="num">{formatPercent(h.share, 2)}</td>
							<td>
								<span className="share-bar">
									<i style={{ width: `${Math.min(100, h.share * 100)}%` }} />
								</span>
							</td>
							<td className="num">{formatTokens(h.balance)}</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
				the bonding curve and the locked pool hold unsold and pooled supply; they are excluded from holder counts and concentration.
			</p>
		</div>
	);
}

type PositionData = {
	balanceTokens: number;
	boughtNative: number;
	boughtTokens: number;
	soldNative: number;
	soldTokens: number;
	trades: number;
};

function Position({ chain, address, symbol, state, rate }: { chain: ChainKey; address: string; symbol: string; state: TokenState; rate: number | null }) {
	const account = useConnection();
	const wallet = account.address;
	const [loaded, setLoaded] = useState<{ wallet: string; data: PositionData | null; error: boolean } | null>(null);
	const native = nativeSymbol(chain);

	useEffect(() => {
		if (!wallet) return;
		let cancelled = false;
		fetch(`/api/tokens/${chain}/${address}/position?wallet=${wallet}`, { cache: 'no-store' })
			.then(async (r) => {
				if (!r.ok) throw new Error(String(r.status));
				return (await r.json()) as PositionData;
			})
			.then((data) => !cancelled && setLoaded({ wallet, data, error: false }))
			.catch(() => !cancelled && setLoaded({ wallet, data: null, error: true }));
		return () => {
			cancelled = true;
		};
	}, [chain, address, wallet, state.priceNative]);

	if (!wallet) return <p className="muted" style={{ padding: '18px 0' }}>connect a wallet to see your holdings, cost and profit in ${symbol}.</p>;
	const current = loaded?.wallet === wallet ? loaded : null;
	if (!current) return <span className="skeleton" style={{ display: 'block', height: 120, margin: '14px 0' }} />;
	if (current.error || !current.data) return <p className="muted" style={{ padding: '18px 0' }}>your position could not load. it retries when the price updates.</p>;

	const p = current.data;
	if (!p.trades && !p.balanceTokens) return <p className="muted" style={{ padding: '18px 0' }}>this wallet has not traded ${symbol} yet.</p>;
	const value = p.balanceTokens * state.priceNative;
	const pnl = value + p.soldNative - p.boughtNative;
	const avg = p.boughtTokens ? p.boughtNative / p.boughtTokens : null;
	const money = (v: number) => (rate ? `${formatUsd(v * rate)} · ${formatNative(v, native)}` : formatNative(v, native));
	return (
		<dl className="kv" style={{ padding: '14px 0' }}>
			<dt>holding</dt>
			<dd>
				{formatTokens(p.balanceTokens)} ${symbol} ({formatPercent(p.balanceTokens / TOTAL_SUPPLY, 3)} of supply)
			</dd>
			<dt>value now</dt>
			<dd>{money(value)}</dd>
			<dt>bought</dt>
			<dd>{money(p.boughtNative)}</dd>
			<dt>sold</dt>
			<dd>{money(p.soldNative)}</dd>
			<dt>average entry</dt>
			<dd>{avg ? `${formatNative(avg * TOTAL_SUPPLY, native)} mcap` : '-'}</dd>
			<dt>profit and loss</dt>
			<dd className={pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''}>
				{pnl > 0 ? '+' : ''}
				{money(pnl)}
				{p.boughtNative ? ` (${pnl > 0 ? '+' : ''}${((pnl / p.boughtNative) * 100).toFixed(1)}%)` : ''}
			</dd>
			<dt>trades</dt>
			<dd>{p.trades}</dd>
		</dl>
	);
}
