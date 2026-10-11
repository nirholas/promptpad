import 'server-only';

import { getAddress, parseAbiItem, type Address, type Log } from 'viem';

import { PAD_FACTORY, PAD_FACTORY_BLOCK, ROBINHOOD_WETH } from '../config';
import { sql } from '../db';
import { evmClient } from '../evm/client';

/**
 * Robinhood Chain market indexer. Reads three log streams into the `trades` and `holders` tables:
 * the factory's Trade events (bonding-curve buys and sells), Uniswap v3 Swap events on graduated
 * pools, and ERC-20 Transfer events on every launched token (holder balances). One block cursor
 * covers all three, so a trade and the transfer it caused always land in the same sync.
 *
 * Runs on demand from token page reads, throttled through `sync_state` so every instance shares
 * one cadence, and bounded per run so a request never waits on a long backfill.
 */

const tradeEvent = parseAbiItem(
	'event Trade(address indexed token, address indexed trader, bool isBuy, uint256 ethAmount, uint256 tokenAmount, uint256 fee, uint256 ethReserve, uint256 tokensSold)',
);
const graduatedEvent = parseAbiItem(
	'event Graduated(address indexed token, address pool, uint256 lpTokenId, uint256 ethToLp, uint256 tokensToLp, uint256 tokensBurned)',
);
const createdEvent = parseAbiItem(
	'event TokenCreated(address indexed token, uint256 indexed index, address indexed creator, address feeRecipient, string name, string symbol, string image, string description)',
);
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const swapEvent = parseAbiItem(
	'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
);

// The public RPC answers getLogs over 48k blocks; stay under it.
const CHUNK = BigInt(40_000);
// At most this many chunks per run, so a cold backfill spreads across requests.
const MAX_CHUNKS_PER_RUN = 6;
const SYNC_EVERY_MS = 6_000;

const cursorKey = () => `evm_market_cursor:${PAD_FACTORY!.toLowerCase()}`;
const blockTimes = new Map<bigint, number>();

async function timestamps(blocks: bigint[]) {
	const missing = [...new Set(blocks)].filter((b) => !blockTimes.has(b));
	for (let i = 0; i < missing.length; i += 10) {
		await Promise.all(
			missing.slice(i, i + 10).map(async (blockNumber) => {
				const block = await evmClient.getBlock({ blockNumber });
				blockTimes.set(blockNumber, Number(block.timestamp));
			}),
		);
	}
}

type TradeRow = {
	token: string;
	tx: string;
	logIndex: number;
	block: bigint;
	trader: string;
	side: 'buy' | 'sell';
	venue: 'curve' | 'pool';
	nativeAmount: number;
	tokenAmount: number;
	priceNative: number;
	feeNative: number;
};

const wad = (v: bigint) => Number(v) / 1e18;

function curveTrade(log: Log<bigint, number, false, typeof tradeEvent>): TradeRow | null {
	const a = log.args;
	if (!a.token || !a.trader || a.tokenAmount === undefined || a.ethAmount === undefined || !log.transactionHash) return null;
	const tokens = wad(a.tokenAmount);
	const fee = wad(a.fee ?? BigInt(0));
	// Buys report ETH net of the fee and sells report ETH paid out after it, so both sides price at
	// the curve's own rate: net in per token for a buy, gross out per token for a sell.
	const eth = wad(a.ethAmount);
	const price = tokens > 0 ? (a.isBuy ? eth : eth + fee) / tokens : 0;
	return {
		token: a.token.toLowerCase(),
		tx: log.transactionHash,
		logIndex: log.logIndex ?? 0,
		block: log.blockNumber ?? BigInt(0),
		trader: a.trader.toLowerCase(),
		side: a.isBuy ? 'buy' : 'sell',
		venue: 'curve',
		nativeAmount: a.isBuy ? eth + fee : eth,
		tokenAmount: tokens,
		priceNative: price,
		feeNative: fee,
	};
}

type PoolInfo = { token: string; tokenIsToken0: boolean };

async function graduatedPools(): Promise<Map<string, PoolInfo>> {
	const rows = await sql<{ address: string; pool: string | null }>(
		`select address, pool from launches where chain = 'robinhood' and graduated = $1 and pool is not null`,
		[true],
	);
	const weth = ROBINHOOD_WETH.toLowerCase();
	return new Map(
		rows
			.filter((r) => r.pool)
			.map((r) => [r.pool!.toLowerCase(), { token: r.address.toLowerCase(), tokenIsToken0: r.address.toLowerCase() < weth }]),
	);
}

async function poolTrades(logs: Log<bigint, number, false, typeof swapEvent>[], pools: Map<string, PoolInfo>): Promise<TradeRow[]> {
	// The router is the Swap's sender and often its recipient too, so the trader is the account
	// that sent the transaction.
	const hashes = [...new Set(logs.map((l) => l.transactionHash!).filter(Boolean))];
	const senders = new Map<string, string>();
	for (let i = 0; i < hashes.length; i += 10) {
		await Promise.all(
			hashes.slice(i, i + 10).map(async (hash) => {
				const tx = await evmClient.getTransaction({ hash });
				senders.set(hash, tx.from.toLowerCase());
			}),
		);
	}
	const rows: TradeRow[] = [];
	for (const log of logs) {
		const info = pools.get(log.address.toLowerCase());
		const a = log.args;
		if (!info || a.amount0 === undefined || a.amount1 === undefined || !log.transactionHash) continue;
		// Pool deltas are from the pool's side: positive means the pool received it.
		const tokenDelta = info.tokenIsToken0 ? a.amount0 : a.amount1;
		const wethDelta = info.tokenIsToken0 ? a.amount1 : a.amount0;
		const isBuy = tokenDelta < BigInt(0);
		const tokens = wad(isBuy ? -tokenDelta : tokenDelta);
		const eth = wad(wethDelta < BigInt(0) ? -wethDelta : wethDelta);
		if (tokens === 0) continue;
		rows.push({
			token: info.token,
			tx: log.transactionHash,
			logIndex: log.logIndex ?? 0,
			block: log.blockNumber ?? BigInt(0),
			trader: senders.get(log.transactionHash) ?? (a.recipient ?? '').toLowerCase(),
			side: isBuy ? 'buy' : 'sell',
			venue: 'pool',
			nativeAmount: eth,
			tokenAmount: tokens,
			priceNative: eth / tokens,
			// The 1% pool fee is taken from the input side.
			feeNative: isBuy ? eth * 0.01 : 0,
		});
	}
	return rows;
}

async function writeTrades(rows: TradeRow[]) {
	for (let i = 0; i < rows.length; i += 7) {
		const batch = rows.slice(i, i + 7);
		const values: unknown[] = [];
		const tuples = batch.map((r, j) => {
			const o = j * 13;
			values.push(
				'robinhood',
				r.token,
				r.tx,
				r.logIndex,
				Number(r.block),
				blockTimes.get(r.block) ?? 0,
				r.trader,
				r.side,
				r.venue,
				r.nativeAmount,
				r.tokenAmount,
				r.priceNative,
				r.feeNative,
			);
			return `(${Array.from({ length: 13 }, (_, k) => `$${o + k + 1}`).join(', ')})`;
		});
		await sql(
			`insert into trades (chain, token, tx, log_index, block, ts, trader, side, venue, native_amount, token_amount, price_native, fee_native)
			 values ${tuples.join(', ')} on conflict (chain, tx, log_index) do nothing`,
			values,
		);
	}
}

async function applyTransfers(logs: Log<bigint, number, false, typeof transferEvent>[]) {
	const deltas = new Map<string, bigint>();
	const bump = (token: string, holder: string, v: bigint) => {
		const key = `${token}:${holder}`;
		deltas.set(key, (deltas.get(key) ?? BigInt(0)) + v);
	};
	for (const log of logs) {
		const { from, to, value } = log.args;
		if (!from || !to || value === undefined) continue;
		const token = log.address.toLowerCase();
		if (!/^0x0{40}$/.test(from)) bump(token, from.toLowerCase(), -value);
		if (!/^0x0{40}$/.test(to)) bump(token, to.toLowerCase(), value);
	}
	const entries = [...deltas.entries()].filter(([, v]) => v !== BigInt(0));
	for (const [key, delta] of entries) {
		const [token, holder] = key.split(':');
		const current = await sql<{ balance: string }>(
			`select balance from holders where chain = 'robinhood' and token = $1 and holder = $2`,
			[token, holder],
		);
		const next = BigInt(current[0]?.balance ?? '0') + delta;
		await sql(
			`insert into holders (chain, token, holder, balance) values ('robinhood', $1, $2, $3)
			 on conflict (chain, token, holder) do update set balance = excluded.balance`,
			[token, holder, (next < BigInt(0) ? BigInt(0) : next).toString()],
		);
	}
}

async function recordGraduations(logs: Log<bigint, number, false, typeof graduatedEvent>[]) {
	for (const log of logs) {
		if (!log.args.token || !log.args.pool) continue;
		await sql(`update launches set graduated = $1, pool = $2 where chain = 'robinhood' and lower(address) = lower($3)`, [
			true,
			getAddress(log.args.pool),
			log.args.token,
		]);
	}
}

/** Claim this sync slot through the database; returns false when another run went recently. */
async function claim(): Promise<boolean> {
	const now = new Date();
	const rows = await sql(
		`insert into sync_state (key, value, updated_at) values ('evm_market_lock', '0', $1)
		 on conflict (key) do update set updated_at = $1
		 where sync_state.updated_at < $2
		 returning key`,
		[now.toISOString(), new Date(now.getTime() - SYNC_EVERY_MS).toISOString()],
	);
	return rows.length > 0;
}

let inflight: Promise<void> | null = null;

/** Bring the market tables up to the chain head (bounded per call). Safe to call on every read. */
export function syncEvmMarket(): Promise<void> {
	if (!PAD_FACTORY) return Promise.resolve();
	inflight ??= run().finally(() => {
		inflight = null;
	});
	return inflight;
}

async function run() {
	if (!(await claim())) return;
	const factory = PAD_FACTORY as Address;
	const cursorRow = await sql<{ value: string }>('select value from sync_state where key = $1', [cursorKey()]);
	let from = cursorRow[0] ? BigInt(cursorRow[0].value) + BigInt(1) : PAD_FACTORY_BLOCK;
	const head = await evmClient.getBlockNumber();

	for (let chunk = 0; chunk < MAX_CHUNKS_PER_RUN && from <= head; chunk++) {
		const to = from + CHUNK - BigInt(1) > head ? head : from + CHUNK - BigInt(1);
		// Tokens the registry already knows, plus any created inside this range that it has not
		// recorded yet, so a new token's mint and first buy are never skipped.
		const [known, created] = await Promise.all([
			sql<{ address: string }>(`select address from launches where chain = 'robinhood'`),
			evmClient.getLogs({ address: factory, event: createdEvent, fromBlock: from, toBlock: to }),
		]);
		const tokens = [...new Set([...known.map((t) => t.address.toLowerCase()), ...created.map((l) => l.args.token!.toLowerCase())])];
		const pools = await graduatedPools();

		const [trades, graduations, transfers, swaps] = await Promise.all([
			evmClient.getLogs({ address: factory, event: tradeEvent, fromBlock: from, toBlock: to }),
			evmClient.getLogs({ address: factory, event: graduatedEvent, fromBlock: from, toBlock: to }),
			tokens.length
				? evmClient.getLogs({ address: tokens as Address[], event: transferEvent, fromBlock: from, toBlock: to })
				: Promise.resolve([]),
			pools.size
				? evmClient.getLogs({ address: [...pools.keys()] as Address[], event: swapEvent, fromBlock: from, toBlock: to })
				: Promise.resolve([]),
		]);

		await recordGraduations(graduations);
		const rows = [...trades.map(curveTrade).filter((r): r is TradeRow => r !== null), ...(await poolTrades(swaps, pools))];
		await timestamps(rows.map((r) => r.block));
		await writeTrades(rows);
		await applyTransfers(transfers);

		await sql(
			`insert into sync_state (key, value, updated_at) values ($1, $2, $3)
			 on conflict (key) do update set value = $2, updated_at = $3`,
			[cursorKey(), to.toString(), new Date().toISOString()],
		);
		from = to + BigInt(1);
	}
}
