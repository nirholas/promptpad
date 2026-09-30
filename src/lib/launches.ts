import 'server-only';

import { randomBytes } from 'node:crypto';
import type { Address, Hash } from 'viem';

import { chainEnabled, DRAFT_TTL_HOURS, PAD_FACTORY, type ChainKey } from './config';
import { sql } from './db';
import { readEvmTokenState, readFactoryConfig, readFactoryTokens, readLaunchFromTx, readTokenMetadata } from './evm/client';
import { publicFetch } from './net';
import { findPoolByMint, listConfigPools, readMintMetadata } from './solana/dbc';
import type { Draft, Launch } from './types';
import type { LaunchInput } from './validate';

export class LaunchError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
	}
}

// ---------------------------------------------------------------- mapping

type DraftRow = {
	id: string;
	chain: ChainKey;
	name: string;
	symbol: string;
	image: string;
	description: string;
	fee_wallet: string;
	initial_buy: string;
	source: 'web' | 'claude';
	mint: string | null;
	created_at: Date | string;
	expires_at: Date | string;
	launch_id: number | null;
};

type LaunchRow = {
	id: number;
	number: number;
	chain: ChainKey;
	address: string;
	pool: string | null;
	name: string;
	symbol: string;
	image: string;
	description: string;
	creator: string;
	fee_wallet: string;
	tx: string | null;
	source: Launch['source'];
	graduated: boolean;
	created_at: Date | string;
};

const iso = (v: Date | string) => new Date(v).toISOString();

function toDraft(r: DraftRow): Draft {
	return {
		id: r.id,
		chain: r.chain,
		name: r.name,
		symbol: r.symbol,
		image: r.image,
		description: r.description,
		feeWallet: r.fee_wallet,
		initialBuy: r.initial_buy,
		source: r.source,
		mint: r.mint,
		createdAt: iso(r.created_at),
		expiresAt: iso(r.expires_at),
		launchId: r.launch_id,
	};
}

function toLaunch(r: LaunchRow): Launch {
	return {
		id: r.id,
		number: r.number,
		chain: r.chain,
		address: r.address,
		pool: r.pool,
		name: r.name,
		symbol: r.symbol,
		image: r.image,
		description: r.description,
		creator: r.creator,
		feeWallet: r.fee_wallet,
		tx: r.tx,
		source: r.source,
		graduated: r.graduated,
		createdAt: iso(r.created_at),
	};
}

// ---------------------------------------------------------------- drafts

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

function newDraftId() {
	const bytes = randomBytes(12);
	return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

export async function createDraft(input: LaunchInput, source: Draft['source']): Promise<Draft> {
	if (!chainEnabled(input.chain)) {
		throw new LaunchError(`Launches on ${input.chain} are not open yet on this deployment.`, 503);
	}
	const taken = await sql<{ number: number }>(
		'select number from launches where chain = $1 and lower(symbol) = lower($2) limit 1',
		[input.chain, input.symbol],
	);
	if (taken.length) throw new LaunchError(`$${input.symbol} is already in the registry as #${taken[0].number}.`, 409);

	const rows = await sql<DraftRow>(
		`insert into drafts (id, chain, name, symbol, image, description, fee_wallet, initial_buy, source, expires_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + ($10 || ' hours')::interval)
		 returning *`,
		[
			newDraftId(),
			input.chain,
			input.name,
			input.symbol,
			input.image,
			input.description,
			input.feeWallet,
			input.initialBuy,
			source,
			String(DRAFT_TTL_HOURS),
		],
	);
	return toDraft(rows[0]);
}

export async function getDraft(id: string): Promise<Draft | null> {
	const rows = await sql<DraftRow>('select * from drafts where id = $1', [id]);
	return rows[0] ? toDraft(rows[0]) : null;
}

export function draftExpired(draft: Draft) {
	return new Date(draft.expiresAt).getTime() < Date.now();
}

export async function setDraftMint(id: string, mint: string) {
	await sql('update drafts set mint = $2 where id = $1', [id, mint]);
}

// ---------------------------------------------------------------- recording launches

type NewLaunch = Omit<Launch, 'id' | 'number' | 'createdAt'> & { createdAt?: string; draftId?: string | null };

/**
 * Records a launch, or enriches the existing row for the same token (a launch the chain sync found
 * first gains its draft, transaction and source when the checkout confirms). Registry numbers are
 * gapless: a new row takes max + 1 under a unique constraint, and a concurrent insert that grabbed
 * the same number, or the same token, retries.
 */
async function insertLaunch(l: NewLaunch): Promise<Launch> {
	for (let attempt = 0; ; attempt++) {
		try {
			const launch = await upsertLaunchOnce(l);
			if (launch) {
				if (l.draftId) await sql('update drafts set launch_id = $2 where id = $1', [l.draftId, launch.id]);
				return launch;
			}
		} catch (error) {
			const code = (error as { code?: string }).code;
			if (code !== '23505' || attempt >= 5) throw error;
			continue;
		}
		if (attempt >= 5) throw new Error(`Could not record launch ${l.chain}:${l.address}.`);
	}
}

async function upsertLaunchOnce(l: NewLaunch): Promise<Launch | null> {
	const updated = await sql<LaunchRow>(
		`update launches set
			tx = coalesce(tx, $3),
			draft_id = coalesce(draft_id, $4),
			source = case when source = 'chain' then $5 else source end,
			pool = coalesce($6, pool)
		 where chain = $1 and address = $2
		 returning *`,
		[l.chain, l.address, l.tx, l.draftId ?? null, l.source, l.pool],
	);
	if (updated[0]) return toLaunch(updated[0]);

	const inserted = await sql<LaunchRow>(
		`insert into launches (chain, address, pool, name, symbol, image, description, creator, fee_wallet, tx, draft_id, source, graduated, created_at, number)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, coalesce($14::timestamptz, now()),
			(select coalesce(max(number), 0) + 1 from launches))
		 on conflict (chain, address) do nothing
		 returning *`,
		[
			l.chain,
			l.address,
			l.pool,
			l.name,
			l.symbol,
			l.image,
			l.description,
			l.creator,
			l.feeWallet,
			l.tx,
			l.draftId ?? null,
			l.source,
			l.graduated,
			l.createdAt ?? null,
		],
	);
	return inserted[0] ? toLaunch(inserted[0]) : null;
}

/** Verifies a Robinhood Chain launch transaction on-chain before it enters the registry. */
export async function recordEvmLaunch(txHash: string, draftId: string | null): Promise<Launch> {
	if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new LaunchError('That is not a transaction hash.');
	const event = await readLaunchFromTx(txHash as Hash).catch(() => null);
	if (!event) throw new LaunchError('No launch found in that transaction yet. It may still be confirming.', 404);

	let source: Launch['source'] = 'chain';
	if (draftId) {
		const draft = await getDraft(draftId);
		if (!draft) throw new LaunchError('Unknown launch draft.', 404);
		const matches =
			draft.chain === 'robinhood' &&
			draft.symbol === event.symbol &&
			draft.name === event.name &&
			draft.feeWallet.toLowerCase() === event.feeRecipient.toLowerCase();
		if (!matches) throw new LaunchError('That transaction launched a different token than this draft.', 409);
		source = draft.source;
	}

	return insertLaunch({
		chain: 'robinhood',
		address: event.token,
		pool: null,
		name: event.name,
		symbol: event.symbol,
		image: event.image,
		description: event.description,
		creator: event.creator,
		feeWallet: event.feeRecipient,
		tx: txHash,
		source,
		graduated: false,
		draftId,
	});
}

/** Confirms the draft's Solana pool exists under our partner config, then records it. */
export async function recordSolanaLaunch(draftId: string, signature: string | null): Promise<Launch> {
	const draft = await getDraft(draftId);
	if (!draft || draft.chain !== 'solana') throw new LaunchError('Unknown Solana launch draft.', 404);
	if (!draft.mint) throw new LaunchError('This draft has no launch transaction yet.', 409);
	const found = await findPoolByMint(draft.mint);
	if (!found) throw new LaunchError('The pool is not on-chain yet. It may still be confirming.', 404);

	return insertLaunch({
		chain: 'solana',
		address: draft.mint,
		pool: found.publicKey.toBase58(),
		name: draft.name,
		symbol: draft.symbol,
		image: draft.image,
		description: draft.description,
		creator: found.account.poolState.creator.toBase58(),
		feeWallet: draft.feeWallet,
		tx: signature,
		source: draft.source,
		graduated: false,
		draftId,
	});
}

// ---------------------------------------------------------------- reading

export async function listLaunches(opts: { chain?: ChainKey; limit?: number; offset?: number; q?: string } = {}) {
	const limit = Math.min(Math.max(opts.limit ?? 24, 1), 100);
	const offset = Math.max(opts.offset ?? 0, 0);
	const params: unknown[] = [];
	const where: string[] = [];
	if (opts.chain) {
		params.push(opts.chain);
		where.push(`chain = $${params.length}`);
	}
	if (opts.q?.trim()) {
		params.push(`%${opts.q.trim().replace(/^\$/, '').toLowerCase()}%`);
		where.push(`(lower(name) like $${params.length} or lower(symbol) like $${params.length} or lower(address) like $${params.length})`);
	}
	const clause = where.length ? `where ${where.join(' and ')}` : '';
	const [rows, count] = await Promise.all([
		sql<LaunchRow>(`select * from launches ${clause} order by number desc limit ${limit} offset ${offset}`, params),
		sql<{ n: string | number }>(`select count(*) as n from launches ${clause}`, params),
	]);
	return { launches: rows.map(toLaunch), total: Number(count[0]?.n ?? 0) };
}

export async function getLaunch(chain: ChainKey, address: string): Promise<Launch | null> {
	const rows = await sql<LaunchRow>('select * from launches where chain = $1 and lower(address) = lower($2)', [
		chain,
		address,
	]);
	return rows[0] ? toLaunch(rows[0]) : null;
}

export async function getLaunchById(id: number): Promise<Launch | null> {
	const rows = await sql<LaunchRow>('select * from launches where id = $1', [id]);
	return rows[0] ? toLaunch(rows[0]) : null;
}

export async function markGraduated(chain: ChainKey, address: string, pool: string | null) {
	await sql('update launches set graduated = true, pool = coalesce($3, pool) where chain = $1 and address = $2', [
		chain,
		address,
		pool,
	]);
}

export async function stats() {
	const rows = await sql<{ chain: ChainKey; n: string | number; g: string | number }>(
		'select chain, count(*) as n, count(*) filter (where graduated) as g from launches group by chain',
	);
	const by = Object.fromEntries(rows.map((r) => [r.chain, { launches: Number(r.n), graduated: Number(r.g) }]));
	return {
		robinhood: by.robinhood ?? { launches: 0, graduated: 0 },
		solana: by.solana ?? { launches: 0, graduated: 0 },
	};
}

// ---------------------------------------------------------------- chain backfill

const SYNC_INTERVAL_MS = 60_000;

/**
 * Pulls launches made directly against the contracts (outside this site) into the registry.
 * Throttled through the database so concurrent requests and instances share one cadence.
 */
export async function syncRegistry() {
	const claimed = await sql(
		`insert into sync_state (key, value, updated_at) values ('registry', '0', now())
		 on conflict (key) do update set updated_at = now()
		 where sync_state.updated_at < now() - ($1 || ' milliseconds')::interval
		 returning key`,
		[String(SYNC_INTERVAL_MS)],
	);
	if (!claimed.length) return;
	await Promise.allSettled([chainEnabled('robinhood') && syncEvm(), chainEnabled('solana') && syncSolana()]);
}

async function syncEvm() {
	if (!PAD_FACTORY) return;
	const cursorKey = `evm_cursor:${PAD_FACTORY.toLowerCase()}`;
	const cursorRow = await sql<{ value: string }>('select value from sync_state where key = $1', [cursorKey]);
	const from = Number(cursorRow[0]?.value ?? 0);
	const { tokenCount } = await readFactoryConfig();
	const to = Math.min(Number(tokenCount), from + 50);
	if (to > from) {
		const tokens = await readFactoryTokens(from, to);
		for (const token of tokens) {
			const exists = await getLaunch('robinhood', token);
			if (exists) continue;
			const [meta, state] = await Promise.all([readTokenMetadata(token), readEvmTokenState(token)]);
			if (!state) continue;
			// A launch signed from a checkout whose confirmation never reached us still belongs to its draft.
			const draft = await sql<{ id: string; source: Draft['source'] }>(
				`select id, source from drafts where chain = 'robinhood' and launch_id is null and name = $1 and symbol = $2
				 and lower(fee_wallet) = lower($3) order by created_at desc limit 1`,
				[meta.name, meta.symbol, state.feeWallet],
			);
			await insertLaunch({
				draftId: draft[0]?.id ?? null,
				chain: 'robinhood',
				address: token,
				pool: state.pool,
				name: meta.name,
				symbol: meta.symbol,
				image: meta.image,
				description: meta.description,
				creator: meta.creator,
				feeWallet: state.feeWallet,
				tx: null,
				source: draft[0]?.source ?? 'chain',
				graduated: state.graduated,
				createdAt: state.createdAt ?? undefined,
			});
		}
		await sql(
			`insert into sync_state (key, value) values ($1, $2)
			 on conflict (key) do update set value = excluded.value, updated_at = now()`,
			[cursorKey, String(to)],
		);
	}

	const open = await sql<{ address: string }>(
		`select address from launches where chain = 'robinhood' and not graduated order by id desc limit 25`,
	);
	for (const { address } of open) {
		const state = await readEvmTokenState(address as Address);
		if (state?.graduated) await markGraduated('robinhood', address, state.pool);
	}
}

async function syncSolana() {
	const pools = await listConfigPools();
	const known = new Set(
		(await sql<{ address: string }>(`select address from launches where chain = 'solana'`)).map((r) => r.address),
	);
	for (const p of pools) {
		if (known.has(p.mint)) {
			if (p.migrated) await markGraduated('solana', p.mint, p.pool);
			continue;
		}
		const draft = await sql<DraftRow>(`select * from drafts where chain = 'solana' and mint = $1`, [p.mint]);
		if (draft[0]) {
			await recordSolanaLaunch(draft[0].id, null);
			continue;
		}
		const meta = await readMintMetadata(p.mint);
		if (!meta) continue;
		const offchain = await fetchOffchainMetadata(meta.uri);
		await insertLaunch({
			chain: 'solana',
			address: p.mint,
			pool: p.pool,
			name: meta.name,
			symbol: meta.symbol,
			image: offchain.image,
			description: offchain.description,
			creator: p.creator,
			feeWallet: p.creator,
			tx: null,
			source: 'chain',
			graduated: p.migrated,
			createdAt: p.activation > 1_000_000_000 ? new Date(p.activation * 1000).toISOString() : undefined,
		});
	}
}

async function fetchOffchainMetadata(uri: string): Promise<{ image: string; description: string }> {
	try {
		const res = await publicFetch(uri, { headers: { accept: 'application/json' }, timeoutMs: 5_000 });
		if (!res.ok) return { image: '', description: '' };
		const body = (await res.json()) as { image?: unknown; description?: unknown };
		return {
			image: typeof body.image === 'string' && body.image.startsWith('https://') ? body.image : '',
			description: typeof body.description === 'string' ? body.description.slice(0, 1000) : '',
		};
	} catch {
		return { image: '', description: '' };
	}
}
