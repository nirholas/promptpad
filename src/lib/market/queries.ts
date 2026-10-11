import 'server-only';

import type { ChainKey } from '../config';
import { sql } from '../db';

/** Every token here has the same fixed supply on both chains. */
export const TOTAL_SUPPLY = 1_000_000_000;

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

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

export type MarketStats = {
	/** Percent change over each window; null when there is no trade to compare against. */
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

type TradeRow = {
	tx: string;
	ts: number | string;
	trader: string;
	side: 'buy' | 'sell';
	venue: 'curve' | 'pool';
	native_amount: number;
	token_amount: number;
	price_native: number;
};

const toTrade = (r: TradeRow): MarketTrade => ({
	tx: r.tx,
	ts: Number(r.ts),
	trader: r.trader,
	side: r.side,
	venue: r.venue,
	nativeAmount: Number(r.native_amount),
	tokenAmount: Number(r.token_amount),
	priceNative: Number(r.price_native),
});

export async function recentTrades(
	chain: ChainKey,
	token: string,
	opts: { limit?: number; before?: number; trader?: string } = {},
): Promise<MarketTrade[]> {
	const params: unknown[] = [chain, token.toLowerCase()];
	let where = 'chain = $1 and token = $2';
	if (opts.before) {
		params.push(opts.before);
		where += ` and ts < $${params.length}`;
	}
	if (opts.trader) {
		params.push(opts.trader.toLowerCase());
		where += ` and trader = $${params.length}`;
	}
	params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
	const rows = await sql<TradeRow>(
		`select tx, ts, trader, side, venue, native_amount, token_amount, price_native from trades
		 where ${where} order by ts desc, block desc, log_index desc limit $${params.length}`,
		params,
	);
	return rows.map(toTrade);
}

/** Price at or before a moment: the last trade before it, or the first trade if the token is younger. */
async function priceAt(chain: ChainKey, token: string, ts: number): Promise<number | null> {
	const before = await sql<{ price_native: number }>(
		`select price_native from trades where chain = $1 and token = $2 and ts <= $3 order by ts desc, block desc, log_index desc limit 1`,
		[chain, token, ts],
	);
	if (before[0]) return Number(before[0].price_native);
	const first = await sql<{ price_native: number }>(
		`select price_native from trades where chain = $1 and token = $2 order by ts asc, block asc, log_index asc limit 1`,
		[chain, token],
	);
	return first[0] ? Number(first[0].price_native) : null;
}

export async function marketStats(chain: ChainKey, tokenAddress: string, currentPrice: number | null): Promise<MarketStats> {
	const token = tokenAddress.toLowerCase();
	const now = Math.floor(Date.now() / 1000);
	const day = now - 86_400;

	const [agg, day24, ath, windows] = await Promise.all([
		sql<{ n: number | string; first: number | string | null; last: number | string | null }>(
			`select count(*) as n, min(ts) as first, max(ts) as last from trades where chain = $1 and token = $2`,
			[chain, token],
		),
		sql<{ side: string; n: number | string; vol: number | null; traders: number | string }>(
			`select side, count(*) as n, sum(native_amount) as vol, count(distinct trader) as traders
			 from trades where chain = $1 and token = $2 and ts >= $3 group by side`,
			[chain, token, day],
		),
		sql<{ price_native: number; ts: number | string }>(
			`select price_native, ts from trades where chain = $1 and token = $2 order by price_native desc limit 1`,
			[chain, token],
		),
		Promise.all([300, 3_600, 21_600, 86_400].map((w) => priceAt(chain, token, now - w))),
	]);

	const traders24 = await sql<{ traders: number | string }>(
		`select count(distinct trader) as traders from trades where chain = $1 and token = $2 and ts >= $3`,
		[chain, token, day],
	);
	const pct = (base: number | null) =>
		base && currentPrice !== null && base > 0 ? ((currentPrice - base) / base) * 100 : null;
	const buys = day24.find((r) => r.side === 'buy');
	const sells = day24.find((r) => r.side === 'sell');
	const athPrice = ath[0] ? Math.max(Number(ath[0].price_native), currentPrice ?? 0) : currentPrice;

	return {
		change: { m5: pct(windows[0]), h1: pct(windows[1]), h6: pct(windows[2]), h24: pct(windows[3]) },
		volume24hNative: Number(buys?.vol ?? 0) + Number(sells?.vol ?? 0),
		buys24h: Number(buys?.n ?? 0),
		sells24h: Number(sells?.n ?? 0),
		traders24h: Number(traders24[0]?.traders ?? 0),
		totalTrades: Number(agg[0]?.n ?? 0),
		athPriceNative: athPrice ?? null,
		athAt: ath[0] ? Number(ath[0].ts) : null,
		firstTradeAt: agg[0]?.first != null ? Number(agg[0].first) : null,
		lastTradeAt: agg[0]?.last != null ? Number(agg[0].last) : null,
	};
}

export const INTERVALS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3_600, '4h': 14_400, '1d': 86_400 } as const;
export type IntervalKey = keyof typeof INTERVALS;

/**
 * OHLCV candles from the trade log. Quiet stretches are filled with flat candles at the last
 * close, so a chart never compresses time and makes a slow token look busy.
 */
export async function candles(chain: ChainKey, tokenAddress: string, interval: IntervalKey, bars = 300): Promise<Candle[]> {
	const token = tokenAddress.toLowerCase();
	const step = INTERVALS[interval];
	const now = Math.floor(Date.now() / 1000);
	const since = Math.floor((now - step * bars) / step) * step;

	const [prior, rows] = await Promise.all([
		sql<{ price_native: number }>(
			`select price_native from trades where chain = $1 and token = $2 and ts < $3 order by ts desc, block desc, log_index desc limit 1`,
			[chain, token, since],
		),
		sql<{ ts: number | string; price_native: number; native_amount: number }>(
			`select ts, price_native, native_amount from trades where chain = $1 and token = $2 and ts >= $3
			 order by ts asc, block asc, log_index asc limit 20000`,
			[chain, token, since],
		),
	]);
	if (!rows.length && !prior[0]) return [];

	const buckets = new Map<number, Candle>();
	let last = prior[0] ? Number(prior[0].price_native) : Number(rows[0].price_native);
	for (const r of rows) {
		const t = Math.floor(Number(r.ts) / step) * step;
		const price = Number(r.price_native);
		const c = buckets.get(t);
		if (!c) buckets.set(t, { time: t, open: last, high: Math.max(last, price), low: Math.min(last, price), close: price, volume: Number(r.native_amount) });
		else {
			c.high = Math.max(c.high, price);
			c.low = Math.min(c.low, price);
			c.close = price;
			c.volume += Number(r.native_amount);
		}
		last = price;
	}

	const out: Candle[] = [];
	const firstTime = prior[0] ? since : Math.floor(Number(rows[0].ts) / step) * step;
	let close = prior[0] ? Number(prior[0].price_native) : Number(rows[0].price_native);
	const end = Math.floor(now / step) * step;
	for (let t = firstTime; t <= end; t += step) {
		const c = buckets.get(t);
		if (c) {
			out.push(c);
			close = c.close;
		} else out.push({ time: t, open: close, high: close, low: close, close, volume: 0 });
	}
	return out;
}

export type Holder = { address: string; balance: number; share: number; label: string | null };

export async function holders(
	chain: ChainKey,
	tokenAddress: string,
	labels: Record<string, string>,
	limit = 25,
): Promise<{ count: number; top: Holder[]; top10Share: number | null }> {
	const token = tokenAddress.toLowerCase();
	const rows = await sql<{ holder: string; balance: string }>(
		`select holder, balance from holders where chain = $1 and token = $2 and balance <> '0'`,
		[chain, token],
	);
	if (!rows.length) return { count: 0, top: [], top10Share: null };
	const all = rows
		.map((r) => ({ address: r.holder, balance: Number(BigInt(r.balance) / BigInt(1e9)) / 1e9 }))
		.sort((a, b) => b.balance - a.balance);
	const infra = new Set(Object.entries(labels).filter(([, l]) => l === 'bonding curve' || l === 'liquidity pool').map(([a]) => a));
	// Concentration counts real wallets only: the curve and the locked pool are not holders.
	const wallets = all.filter((h) => !infra.has(h.address));
	const top10 = wallets.slice(0, 10).reduce((s, h) => s + h.balance, 0);
	return {
		count: wallets.length,
		top: all.slice(0, limit).map((h) => ({ ...h, share: h.balance / TOTAL_SUPPLY, label: labels[h.address] ?? null })),
		top10Share: wallets.length ? top10 / TOTAL_SUPPLY : null,
	};
}

/** A wallet's position from its own trade history: net tokens, cost, realized proceeds. */
export async function position(chain: ChainKey, tokenAddress: string, trader: string) {
	const rows = await sql<{ side: string; native: number | null; tokens: number | null; n: number | string }>(
		`select side, sum(native_amount) as native, sum(token_amount) as tokens, count(*) as n
		 from trades where chain = $1 and token = $2 and trader = $3 group by side`,
		[chain, tokenAddress.toLowerCase(), trader.toLowerCase()],
	);
	const buy = rows.find((r) => r.side === 'buy');
	const sell = rows.find((r) => r.side === 'sell');
	const held = await sql<{ balance: string }>(`select balance from holders where chain = $1 and token = $2 and holder = $3`, [
		chain,
		tokenAddress.toLowerCase(),
		trader.toLowerCase(),
	]);
	return {
		balanceTokens: held[0] ? Number(BigInt(held[0].balance) / BigInt(1e9)) / 1e9 : 0,
		boughtNative: Number(buy?.native ?? 0),
		boughtTokens: Number(buy?.tokens ?? 0),
		soldNative: Number(sell?.native ?? 0),
		soldTokens: Number(sell?.tokens ?? 0),
		trades: Number(buy?.n ?? 0) + Number(sell?.n ?? 0),
	};
}
