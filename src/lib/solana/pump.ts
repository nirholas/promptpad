import 'server-only';

import {
	bondingCurveMarketCap,
	bondingCurvePda,
	computeFeesBps,
	feeSharingConfigPda,
	getBuyTokenAmountFromSolAmount,
	getBuyV3TokenAmountFromQuoteAmount,
	getSellSolAmountFromTokenAmount,
	isLegacyQuoteMint,
	normalizeQuoteMint,
	newBondingCurve,
	OnlinePumpSdk,
	PUMP_SDK,
	type BondingCurve,
	type Global,
	type FeeConfig,
} from '@pump-fun/pump-sdk';
import { getTokenMetadata, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
	Connection,
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
	type TransactionInstruction,
} from '@solana/web3.js';
import BN from 'bn.js';

import { SITE_URL, SOLANA_LAUNCH_FEE_SOL, SOLANA_RPC_URL, SOLANA_TREASURY } from '../config';
import { attesters, CHANNELS, MEMO_PROGRAM, ORIGIN_TAG, solanaOriginInstruction } from '../origin';
import type { Draft, TokenState } from '../types';
import { readPoolCreatorFees } from './pool-fees';

/**
 * Solana launches run on pump.fun: the coin is created on pump.fun's own bonding curve (and so
 * shows up on pump.fun and every terminal that indexes it), and the creator-fee stream is split
 * with pump.fun's fee-sharing config, which can be written once and is then locked forever.
 *
 * A launch is two transactions sent as one atomic Jito bundle:
 *   1. create the coin + the creator's first buy (so nobody can buy before them)
 *   2. launch fee + fee split (70% fee wallet / 30% platform) + provenance memo + Jito tip
 * They land together or not at all, so the split cannot be skipped.
 */

export const connection = new Connection(process.env.SOLANA_RPC_URL || SOLANA_RPC_URL, 'confirmed');
export const pump = new OnlinePumpSdk(connection);

export const CREATOR_SHARE_BPS = 7_000;
export const PLATFORM_SHARE_BPS = 3_000;

function treasury(): PublicKey {
	if (!SOLANA_TREASURY) throw new Error('Solana launches are not configured (NEXT_PUBLIC_SOLANA_TREASURY).');
	return new PublicKey(SOLANA_TREASURY);
}

/** Short metadata URI: the full URI is written into the create transaction, where every byte counts. */
export function metadataUri(draftId: string) {
	return `${SITE_URL}/m/${draftId}`;
}

let cached: { global: Global; feeConfig: FeeConfig | null; at: number } | null = null;
async function protocol() {
	if (cached && Date.now() - cached.at < 5 * 60_000) return cached;
	const [global, feeConfig] = await Promise.all([pump.fetchGlobal(), pump.fetchFeeConfig().catch(() => null)]);
	cached = { global, feeConfig, at: Date.now() };
	return cached;
}

// ---------------------------------------------------------------- Jito

const JITO = process.env.JITO_BLOCK_ENGINE_URL || 'https://mainnet.block-engine.jito.wtf';
let tipAccounts: { list: string[]; at: number } | null = null;

async function jitoTipAccount(): Promise<PublicKey> {
	if (!tipAccounts || Date.now() - tipAccounts.at > 60 * 60_000) {
		const res = await fetch(`${JITO}/api/v1/getTipAccounts`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTipAccounts', params: [] }),
			signal: AbortSignal.timeout(8_000),
		});
		const body = (await res.json()) as { result?: string[] };
		if (!body.result?.length) throw new Error('Jito returned no tip accounts.');
		tipAccounts = { list: body.result, at: Date.now() };
	}
	return new PublicKey(tipAccounts.list[Math.floor(Math.random() * tipAccounts.list.length)]);
}

/** A tip around the 75th percentile of recently landed tips, clamped to a sane band. */
async function jitoTipLamports(): Promise<number> {
	try {
		const res = await fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor', { signal: AbortSignal.timeout(5_000) });
		const [floor] = (await res.json()) as { landed_tips_75th_percentile?: number }[];
		const lamports = Math.round((floor?.landed_tips_75th_percentile ?? 0) * 1e9);
		return Math.min(Math.max(lamports, 10_000), 200_000);
	} catch {
		return 50_000;
	}
}

export async function sendBundle(transactions: string[]): Promise<string> {
	const res = await fetch(`${JITO}/api/v1/bundles`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [transactions, { encoding: 'base64' }] }),
		signal: AbortSignal.timeout(15_000),
	});
	const body = (await res.json()) as { result?: string; error?: { message?: string } };
	if (!body.result) throw new Error(body.error?.message || `Jito rejected the bundle (HTTP ${res.status}).`);
	return body.result;
}

// ---------------------------------------------------------------- launch

function serialize(tx: Transaction) {
	return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

/** `sweep_creator_fee` for a curve whose current creator is `creator`; `payer` signs (the creator by default). */
async function creatorFeeSweep(mint: PublicKey, creator: PublicKey, curveQuoteMint: PublicKey, payer: PublicKey = creator) {
	const quoteMint = normalizeQuoteMint(curveQuoteMint);
	const quoteTokenProgram = isLegacyQuoteMint(quoteMint) ? TOKEN_PROGRAM_ID : await pump.fetchQuoteTokenProgram(quoteMint);
	return PUMP_SDK.sweepCreatorFeeInstruction({ payer, mint, creator, quoteMint, quoteTokenProgram });
}

async function splitInstructions(draft: Draft, mint: PublicKey, creator: PublicKey, existing: BondingCurve | null): Promise<TransactionInstruction[]> {
	const platform = treasury();
	const feeWallet = new PublicKey(draft.feeWallet);
	const shareholders = feeWallet.equals(platform)
		? [{ address: platform, shareBps: 10_000 }]
		: [
				{ address: feeWallet, shareBps: CREATOR_SHARE_BPS },
				{ address: platform, shareBps: PLATFORM_SHARE_BPS },
			];
	// v3 trades leave the creator fee on the curve, and handing the curve to the sharing config fails
	// with 6095 CreatorFeesNotSwept while any is there. A coin resumed after an interrupted launch
	// may have been traded since, so its split starts with the sweep (it moves nothing when the
	// bucket is empty). A fresh launch needs none: the bundle's only trade is the creator's first
	// buy, which pays its fees out in the trade.
	const sweep = existing ? [await creatorFeeSweep(mint, creator, existing.quoteMint)] : [];
	return [
		...sweep,
		await PUMP_SDK.createFeeSharingConfig({ creator, mint, pool: null }),
		await PUMP_SDK.updateFeeShares({ authority: creator, mint, currentShareholders: [creator], newShareholders: shareholders }),
	];
}

/**
 * Builds the launch bundle for a draft. The fresh mint keypair and the attester sign here; the
 * launcher's wallet adds the final signatures to both transactions. If the coin already exists
 * but its fee split was never written (an interrupted non-bundle send), only the split is rebuilt
 * (opened by a creator-fee sweep, with the Jito tip in its own transaction ahead of it), so the
 * launch can be completed.
 */
export async function buildLaunchBundle(draft: Draft, payer: string, existingMint: string | null) {
	const payerKey = new PublicKey(payer);
	const { global, feeConfig } = await protocol();
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

	let mintKey: PublicKey;
	const transactions: string[] = [];
	const existing = existingMint ? await pump.fetchBondingCurve(new PublicKey(existingMint)).catch(() => null) : null;

	if (existing) {
		if (await connection.getAccountInfo(feeSharingConfigPda(new PublicKey(existingMint!)))) {
			throw new Error('This token has already launched.');
		}
		if (!existing.creator.equals(payerKey)) throw new Error('Connect the wallet that created this token to finish it.');
		mintKey = new PublicKey(existingMint!);
	} else {
		const mint = Keypair.generate();
		mintKey = mint.publicKey;
		const solAmount = new BN(Math.round(Number(draft.initialBuy) * 1e9));
		const create = solAmount.gtn(0)
			? await PUMP_SDK.createV2AndBuyInstructions({
					global,
					mint: mintKey,
					name: draft.name,
					symbol: draft.symbol,
					uri: metadataUri(draft.id),
					creator: payerKey,
					user: payerKey,
					solAmount,
					mayhemMode: false,
					amount: getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: solAmount, quoteMint: NATIVE_MINT }),
				})
			: [
					await PUMP_SDK.createV2Instruction({
						mint: mintKey,
						name: draft.name,
						symbol: draft.symbol,
						uri: metadataUri(draft.id),
						creator: payerKey,
						user: payerKey,
						mayhemMode: false,
					}),
				];
		const tx1 = new Transaction({ feePayer: payerKey, recentBlockhash: blockhash }).add(...create);
		tx1.partialSign(mint);
		transactions.push(serialize(tx1));
	}

	const tip = SystemProgram.transfer({ fromPubkey: payerKey, toPubkey: await jitoTipAccount(), lamports: await jitoTipLamports() });
	if (existing) {
		// A resumed split opens with the creator-fee sweep, which leaves no room for the tip in one
		// packet. The tip rides alone ahead of it in the same bundle, so the split stays atomic with its
		// sweep and remains the last transaction (the one the launch is confirmed by).
		transactions.push(serialize(new Transaction({ feePayer: payerKey, recentBlockhash: blockhash }).add(tip)));
	}

	const tx2 = new Transaction({ feePayer: payerKey, recentBlockhash: blockhash });
	if (SOLANA_LAUNCH_FEE_SOL > 0 && !existing) {
		tx2.add(SystemProgram.transfer({ fromPubkey: payerKey, toPubkey: treasury(), lamports: Math.round(SOLANA_LAUNCH_FEE_SOL * 1e9) }));
	}
	tx2.add(...(await splitInstructions(draft, mintKey, payerKey, existing)));
	const origin = solanaOriginInstruction(draft, mintKey.toBase58());
	if (origin) tx2.add(origin.instruction);
	if (!existing) tx2.add(tip);
	if (origin) tx2.partialSign(origin.signer);
	transactions.push(serialize(tx2));

	return { transactions, mint: mintKey.toBase58(), lastValidBlockHeight };
}

/** The coin exists and its fee split pays the draft's fee wallet and the platform. */
export async function verifyPumpLaunch(draft: Draft, mint: string) {
	const mintKey = new PublicKey(mint);
	const curve = await pump.fetchBondingCurve(mintKey).catch(() => null);
	if (!curve) return null;
	const config = await connection.getAccountInfo(feeSharingConfigPda(mintKey));
	if (!config) return { curve, split: false };
	const decoded = PUMP_SDK.decodeSharingConfig(config);
	const shares = new Map(decoded.shareholders.map((s) => [s.address.toBase58(), s.shareBps]));
	const platform = treasury().toBase58();
	const split =
		draft.feeWallet === platform
			? shares.get(platform) === 10_000
			: shares.get(draft.feeWallet) === CREATOR_SHARE_BPS && shares.get(platform) === PLATFORM_SHARE_BPS;
	return { curve, split };
}

// ---------------------------------------------------------------- provenance

/**
 * Parses a transaction for our attester-signed memo. Returns the launch it attests, or null.
 * Memo format: `<tag>:v1:<site|prompt>:<draftId>:<mint>`.
 */
export async function readOriginFromTransaction(signature: string) {
	const attester = attesters().solana;
	if (!attester) return null;
	const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
	if (!tx || tx.meta?.err) return null;
	const signed = new Set(tx.transaction.message.accountKeys.filter((k) => k.signer).map((k) => k.pubkey.toBase58()));
	if (!signed.has(attester)) return null;
	for (const ix of tx.transaction.message.instructions) {
		if (!ix.programId.equals(MEMO_PROGRAM) || !('parsed' in ix) || typeof ix.parsed !== 'string') continue;
		const [tag, version, channel, draftId, mint] = ix.parsed.split(':');
		if (tag !== ORIGIN_TAG || version !== 'v1' || !(channel in CHANNELS) || !mint) continue;
		return {
			channel: CHANNELS[channel as keyof typeof CHANNELS],
			draftId: draftId || null,
			mint,
			signature,
			blockTime: tx.blockTime ?? null,
		};
	}
	return null;
}

/**
 * Every launch this platform attested, newest first, read from the attester's own on-chain
 * history. This is the Solana registry index: it needs no database and no third-party indexer.
 */
export async function listAttestedLaunches(until: string | undefined, limit = 100) {
	const attester = attesters().solana;
	if (!attester) return { launches: [], newest: until };
	const sigs = await connection.getSignaturesForAddress(new PublicKey(attester), { until, limit }, 'confirmed');
	const launches = [];
	for (const s of sigs) {
		if (s.err) continue;
		const origin = await readOriginFromTransaction(s.signature).catch(() => null);
		if (origin) launches.push(origin);
	}
	return { launches, newest: sigs[0]?.signature ?? until };
}

export async function readPumpMetadata(mint: string) {
	const meta = await getTokenMetadata(connection, new PublicKey(mint), 'confirmed', TOKEN_2022_PROGRAM_ID).catch(() => null);
	return meta ? { name: meta.name, symbol: meta.symbol, uri: meta.uri } : null;
}

// ---------------------------------------------------------------- state

/** SOL a curve raises when its last real token sells, from the protocol's initial reserves. */
function graduationTargetSol(global: Global) {
	const vs = Number(global.initialVirtualSolReserves.toString());
	const vt = Number(global.initialVirtualTokenReserves.toString());
	const real = Number(global.initialRealTokenReserves.toString());
	return (vs * vt) / (vt - real) / 1e9 - vs / 1e9;
}

/** Fee rates a trade pays on this curve right now, in basis points of volume. */
function curveFees(global: Global, feeConfig: FeeConfig | null, curve: BondingCurve) {
	const fees = computeFeesBps({
		global,
		feeConfig,
		mintSupply: curve.tokenTotalSupply,
		virtualQuoteReserves: curve.virtualQuoteReserves,
		virtualTokenReserves: curve.virtualTokenReserves,
		quoteMint: curve.quoteMint,
		creatorFeeBps: curve.creatorFeeBps,
	});
	const protocolBps = Number(fees.protocolFeeBps.toString());
	const creatorBps = Number(fees.creatorFeeBps.toString());
	return { protocolBps, creatorBps, totalBps: protocolBps + creatorBps };
}

export async function pumpFeeTerms() {
	const { global, feeConfig } = await protocol();
	const fresh = newBondingCurve(global);
	return { ...curveFees(global, feeConfig, fresh), graduationTargetSol: graduationTargetSol(global), migrationFeeSol: Number(global.poolMigrationFee.toString()) / 1e9 };
}

async function graduatedPriceSol(mint: string): Promise<number | null> {
	try {
		const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, { signal: AbortSignal.timeout(5_000) });
		const pairs = (await res.json()) as { priceNative?: string; liquidity?: { usd?: number } }[];
		const best = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
		return best?.priceNative ? Number(best.priceNative) : null;
	} catch {
		return null;
	}
}

export async function readPumpTokenState(mint: string): Promise<TokenState | null> {
	const mintKey = new PublicKey(mint);
	const curve = await pump.fetchBondingCurve(mintKey).catch(() => null);
	if (!curve) return null;
	const { global, feeConfig } = await protocol();
	const sharing = await connection.getAccountInfo(feeSharingConfigPda(mintKey));
	const shareholders = sharing ? PUMP_SDK.decodeSharingConfig(sharing).shareholders : [];
	const feeWallet =
		shareholders.find((s) => s.address.toBase58() !== SOLANA_TREASURY)?.address.toBase58() ?? curve.creator.toBase58();

	const supply = Number(curve.tokenTotalSupply.toString()) / 1e6;
	const curvePrice = Number(curve.virtualQuoteReserves.toString()) / 1e9 / (Number(curve.virtualTokenReserves.toString()) / 1e6);
	const price = curve.complete ? ((await graduatedPriceSol(mint)) ?? curvePrice) : curvePrice;
	const initialReal = Number(global.initialRealTokenReserves.toString());
	const progress = curve.complete ? 1 : Math.min(1, Math.max(0, 1 - Number(curve.realTokenReserves.toString()) / initialReal));
	const fees = curveFees(global, feeConfig, curve);

	let claimable = 0;
	if (sharing) {
		// The distributable figure already includes creator fees v3 trades left on the curve. After
		// graduation, PumpSwap v2 trades leave theirs in the pool, which the payout sweeps first, so
		// they are added here.
		const [result, pooled] = await Promise.all([
			pump.getMinimumDistributableFee(mintKey).catch(() => null),
			curve.complete ? readPoolCreatorFees(connection, mintKey, curve.quoteMint).catch(() => new BN(0)) : new BN(0),
		]);
		claimable = ((result ? Number(result.distributableFees.toString()) : 0) + Number(pooled.toString())) / 1e9;
	}

	const target = graduationTargetSol(global);
	return {
		chain: 'solana',
		address: mint,
		graduated: curve.complete,
		progress,
		priceNative: price,
		marketCapNative: curve.complete
			? price * supply
			: Number(
					bondingCurveMarketCap({
						mintSupply: curve.tokenTotalSupply,
						virtualQuoteReserves: curve.virtualQuoteReserves,
						virtualTokenReserves: curve.virtualTokenReserves,
					}).toString(),
				) / 1e9,
		raisedNative: curve.complete ? target : Number(curve.realQuoteReserves.toString()) / 1e9,
		targetNative: target,
		tradeFeeBps: fees.totalBps,
		creatorShareBps: fees.totalBps ? Math.round((fees.creatorBps * CREATOR_SHARE_BPS) / fees.totalBps) : 0,
		creatorFeesClaimableNative: claimable * (CREATOR_SHARE_BPS / 10_000),
		feeWallet,
		creator: curve.creator.toBase58(),
		pool: null,
		createdAt: null,
	};
}

/** Live prices of graduated coins from their PumpSwap pools (DexScreener, up to 30 per call). */
async function graduatedPrices(mints: string[]): Promise<Map<string, number>> {
	const prices = new Map<string, number>();
	for (let i = 0; i < mints.length; i += 30) {
		try {
			const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mints.slice(i, i + 30).join(',')}`, {
				signal: AbortSignal.timeout(5_000),
			});
			const pairs = (await res.json()) as { baseToken?: { address?: string }; priceNative?: string; liquidity?: { usd?: number } }[];
			const best = new Map<string, { price: number; liquidity: number }>();
			for (const p of pairs) {
				const mint = p.baseToken?.address;
				if (!mint || !p.priceNative) continue;
				const liquidity = p.liquidity?.usd ?? 0;
				if ((best.get(mint)?.liquidity ?? -1) < liquidity) best.set(mint, { price: Number(p.priceNative), liquidity });
			}
			for (const [mint, v] of best) prices.set(mint, v.price);
		} catch {
			// Missing prices fall back to the curve's final price.
		}
	}
	return prices;
}

export async function pumpProgressMany(mints: string[]) {
	const { global } = await protocol();
	const initialReal = Number(global.initialRealTokenReserves.toString());
	const infos = await connection.getMultipleAccountsInfo(mints.map((m) => bondingCurvePda(new PublicKey(m))));
	const curves = infos.map((info) => (info ? PUMP_SDK.decodeBondingCurve(info) : null));
	const live = await graduatedPrices(mints.filter((_, i) => curves[i]?.complete));
	return mints.map((mint, i) => {
		const curve = curves[i];
		if (!curve) return { address: mint, progress: null, graduated: false, priceNative: null, marketCapNative: null };
		const supply = Number(curve.tokenTotalSupply.toString()) / 1e6;
		const curvePrice = Number(curve.virtualQuoteReserves.toString()) / 1e9 / (Number(curve.virtualTokenReserves.toString()) / 1e6);
		const price = curve.complete ? (live.get(mint) ?? curvePrice) : curvePrice;
		return {
			address: mint,
			graduated: curve.complete,
			progress: curve.complete ? 1 : Math.min(1, Math.max(0, 1 - Number(curve.realTokenReserves.toString()) / initialReal)),
			priceNative: price,
			marketCapNative: price * supply,
		};
	});
}

// ---------------------------------------------------------------- trading and payouts

export type SwapSide = 'buy' | 'sell';

async function tokenProgramFor(mint: PublicKey) {
	const info = await connection.getAccountInfo(mint);
	if (!info) throw new Error('Unknown token.');
	return info.owner;
}

/**
 * Bonding-curve trades use the v3 instructions (17 accounts; the protocol and creator fee stay on
 * the curve until a sweep pays them out). Cashback coins reject v3 with 6094
 * `CashbackCoinNotSupported`, and v3 always charges the fee-config schedule, so those coins (and a
 * fee config that could not be read) trade through v2, which pays the fees out in the trade.
 */
function tradesOnV3(curve: BondingCurve, feeConfig: FeeConfig | null): feeConfig is FeeConfig {
	return !curve.isCashbackCoin && feeConfig !== null;
}

/**
 * Everything a quote and the matching transaction need, read once. The owner only selects the
 * trader's token account; a quote without a wallet reads the same curve state.
 */
async function prepareSwap(mint: string, side: SwapSide, amount: number, owner: PublicKey | null) {
	const mintKey = new PublicKey(mint);
	const tokenProgram = await tokenProgramFor(mintKey);
	const state = await pump.fetchBuyState(mintKey, owner ?? PublicKey.default, tokenProgram).catch(() => null);
	if (!state) throw new Error('No curve for that token.');
	const curve = state.bondingCurve;
	if (curve.complete) throw new Error('This token has completed its curve. Trade it on pump.fun.');
	// Amounts here are SOL and lamports. A coin paired with another token takes that token as
	// payment, so a SOL amount would mean nothing to it.
	if (!isLegacyQuoteMint(curve.quoteMint)) throw new Error('This token is paired with another token, not SOL. Trade it on pump.fun.');
	const { global, feeConfig } = await protocol();
	const fees = curveFees(global, feeConfig, curve);
	const v3 = tradesOnV3(curve, feeConfig);
	const mintSupply = curve.tokenTotalSupply;

	if (side === 'buy') {
		const lamports = new BN(Math.floor(amount * 1e9));
		// A v3 buy that empties the curve keeps going (synthetic migration): the rest is bought from
		// the tokens the PumpSwap pool would receive, at that pool's opening price, so the quote
		// needs the curve's own token balance to price that part.
		const out = v3
			? getBuyV3TokenAmountFromQuoteAmount({ global, feeConfig, mintSupply, bondingCurve: curve, amount: lamports, curveBaseTokenBalance: state.curveBaseTokenBalance })
			: getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply, bondingCurve: curve, amount: lamports, quoteMint: curve.quoteMint });
		if (out.isZero()) throw new Error('That amount buys no tokens. Enter a larger amount.');
		return {
			state,
			tokenProgram,
			v3,
			amountIn: lamports,
			amountOut: out,
			display: {
				amountOut: Number(out.toString()) / 1e6,
				fee: (amount * fees.totalBps) / 10_000,
				completesCurve: out.gte(curve.realTokenReserves),
			},
		};
	}
	const tokens = new BN(Math.floor(amount * 1e6));
	const out = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply, bondingCurve: curve, amount: tokens });
	const sol = Number(out.toString()) / 1e9;
	return {
		state,
		tokenProgram,
		v3,
		amountIn: tokens,
		amountOut: out,
		display: { amountOut: sol, fee: (sol * fees.totalBps) / (10_000 - fees.totalBps), completesCurve: false },
	};
}

export async function quoteSwap(mint: string, side: SwapSide, amount: number) {
	return (await prepareSwap(mint, side, amount, null)).display;
}

async function finalize(ixs: TransactionInstruction[], payer: PublicKey) {
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
	const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(...ixs);
	return { transaction: serialize(tx), lastValidBlockHeight };
}

export async function buildSwapTransaction(mint: string, owner: string, side: SwapSide, amount: number, slippageBps: number) {
	const mintKey = new PublicKey(mint);
	const ownerKey = new PublicKey(owner);
	const { global } = await protocol();
	const q = await prepareSwap(mint, side, amount, ownerKey);
	const { bondingCurve, bondingCurveAccountInfo, associatedUserAccountInfo, quoteTokenProgram } = q.state;
	const trade = { bondingCurve, mint: mintKey, user: ownerKey, slippage: slippageBps / 100, tokenProgram: q.tokenProgram, quoteTokenProgram };
	let ixs: TransactionInstruction[];
	if (side === 'buy') {
		// Spend exactly what the trader typed and require the quoted tokens less slippage. On a mayhem
		// curve (no synthetic migration) a budget past the remaining supply buys what is left.
		ixs = q.v3
			? await PUMP_SDK.buyExactQuoteInV3Instructions({ ...trade, associatedUserAccountInfo, amount: q.amountOut, quoteAmount: q.amountIn, partialFill: bondingCurve.isMayhemMode })
			: await PUMP_SDK.buyV2Instructions({ ...trade, global, bondingCurveAccountInfo, associatedUserAccountInfo, amount: q.amountOut, quoteAmount: q.amountIn });
	} else {
		ixs = q.v3
			? await PUMP_SDK.sellV3Instructions({ ...trade, amount: q.amountIn, quoteAmount: q.amountOut })
			: await PUMP_SDK.sellV2Instructions({ ...trade, global, bondingCurveAccountInfo, amount: q.amountIn, quoteAmount: q.amountOut });
	}
	return { ...(await finalize(ixs, ownerKey)), quote: q.display };
}

/**
 * Pays accrued creator fees out to the split's shareholders. Permissionless: any wallet can crank it.
 * Since the October 2026 upgrade the v3 curve trades and PumpSwap v2 trades keep the creator fee on
 * the curve and in the pool, and distribution refuses to run while the curve still holds some, so
 * the SDK puts `sweep_creator_fee` (curve, then pool when it has migrated) ahead of the
 * consolidation and the distribution, all in this one transaction. The payer signs the sweeps.
 */
export async function buildPayoutTransaction(mint: string, payer: string) {
	const payerKey = new PublicKey(payer);
	const mintKey = new PublicKey(mint);
	const result = await pump.buildDistributeCreatorFeesInstructions(mintKey, { payer: payerKey });
	if (!result.instructions.length) throw new Error('Nothing to pay out yet.');
	// The SDK sweeps the curve only when its bucket held something as this was built. On a coin still
	// on its curve a trade can land between building and sending, and the distribution would then
	// fail with 6095, so the sweep goes in regardless: it moves nothing when the bucket is empty.
	if (!result.isGraduated && result.sweepCount === 0) {
		const curve = await pump.fetchBondingCurve(mintKey);
		if (!curve.complete) result.instructions.unshift(await creatorFeeSweep(mintKey, curve.creator, curve.quoteMint, payerKey));
	}
	return finalize(result.instructions, payerKey);
}
