import 'server-only';

import {
	bondingCurveMarketCap,
	bondingCurvePda,
	computeFeesBps,
	feeSharingConfigPda,
	getBuyTokenAmountFromSolAmount,
	getSellSolAmountFromTokenAmount,
	newBondingCurve,
	OnlinePumpSdk,
	PUMP_SDK,
	type BondingCurve,
	type Global,
	type FeeConfig,
} from '@pump-fun/pump-sdk';
import { getTokenMetadata, NATIVE_MINT, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
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

async function splitInstructions(draft: Draft, mint: PublicKey, creator: PublicKey): Promise<TransactionInstruction[]> {
	const platform = treasury();
	const feeWallet = new PublicKey(draft.feeWallet);
	const shareholders = feeWallet.equals(platform)
		? [{ address: platform, shareBps: 10_000 }]
		: [
				{ address: feeWallet, shareBps: CREATOR_SHARE_BPS },
				{ address: platform, shareBps: PLATFORM_SHARE_BPS },
			];
	return [
		await PUMP_SDK.createFeeSharingConfig({ creator, mint, pool: null }),
		await PUMP_SDK.updateFeeShares({ authority: creator, mint, currentShareholders: [creator], newShareholders: shareholders }),
	];
}

/**
 * Builds the launch bundle for a draft. The fresh mint keypair and the attester sign here; the
 * launcher's wallet adds the final signatures to both transactions. If the coin already exists
 * but its fee split was never written (an interrupted non-bundle send), only the second
 * transaction is returned, so the launch can be completed.
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

	const tx2 = new Transaction({ feePayer: payerKey, recentBlockhash: blockhash });
	if (SOLANA_LAUNCH_FEE_SOL > 0 && !existing) {
		tx2.add(SystemProgram.transfer({ fromPubkey: payerKey, toPubkey: treasury(), lamports: Math.round(SOLANA_LAUNCH_FEE_SOL * 1e9) }));
	}
	tx2.add(...(await splitInstructions(draft, mintKey, payerKey)));
	const origin = solanaOriginInstruction(draft, mintKey.toBase58());
	if (origin) tx2.add(origin.instruction);
	tx2.add(SystemProgram.transfer({ fromPubkey: payerKey, toPubkey: await jitoTipAccount(), lamports: await jitoTipLamports() }));
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
		const result = await pump.getMinimumDistributableFee(mintKey).catch(() => null);
		claimable = result ? Number(result.distributableFees.toString()) / 1e9 : 0;
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

export async function pumpProgressMany(mints: string[]) {
	const { global } = await protocol();
	const initialReal = Number(global.initialRealTokenReserves.toString());
	const infos = await connection.getMultipleAccountsInfo(mints.map((m) => bondingCurvePda(new PublicKey(m))));
	return mints.map((mint, i) => {
		const info = infos[i];
		if (!info) return { address: mint, progress: null, graduated: false };
		const curve = PUMP_SDK.decodeBondingCurve(info);
		return {
			address: mint,
			graduated: curve.complete,
			progress: curve.complete ? 1 : Math.min(1, Math.max(0, 1 - Number(curve.realTokenReserves.toString()) / initialReal)),
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

export async function quoteSwap(mint: string, side: SwapSide, amount: number) {
	const mintKey = new PublicKey(mint);
	const curve = await pump.fetchBondingCurve(mintKey).catch(() => null);
	if (!curve) throw new Error('No curve for that token.');
	if (curve.complete) throw new Error('This token has graduated off the curve. Trade it on pump.fun.');
	const { global, feeConfig } = await protocol();
	const fees = curveFees(global, feeConfig, curve);
	if (side === 'buy') {
		const lamports = new BN(Math.floor(amount * 1e9));
		const out = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: curve.tokenTotalSupply, bondingCurve: curve, amount: lamports, quoteMint: curve.quoteMint });
		return { curve, amountIn: lamports, amountOut: out, display: { amountOut: Number(out.toString()) / 1e6, fee: (amount * fees.totalBps) / 10_000 } };
	}
	const tokens = new BN(Math.floor(amount * 1e6));
	const out = getSellSolAmountFromTokenAmount({ global, feeConfig, mintSupply: curve.tokenTotalSupply, bondingCurve: curve, amount: tokens });
	const sol = Number(out.toString()) / 1e9;
	return { curve, amountIn: tokens, amountOut: out, display: { amountOut: sol, fee: (sol * fees.totalBps) / (10_000 - fees.totalBps) } };
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
	const q = await quoteSwap(mint, side, amount);
	const tokenProgram = await tokenProgramFor(mintKey);
	const slippage = slippageBps / 100;
	const ixs =
		side === 'buy'
			? await (async () => {
					const state = await pump.fetchBuyState(mintKey, ownerKey, tokenProgram);
					return PUMP_SDK.buyInstructions({ global, ...state, mint: mintKey, user: ownerKey, amount: q.amountOut, solAmount: q.amountIn, slippage, tokenProgram });
				})()
			: await (async () => {
					const state = await pump.fetchSellState(mintKey, ownerKey, tokenProgram);
					return PUMP_SDK.sellInstructions({
						global,
						...state,
						mint: mintKey,
						user: ownerKey,
						amount: q.amountIn,
						solAmount: q.amountOut,
						slippage,
						tokenProgram,
						mayhemMode: state.bondingCurve.isMayhemMode,
						cashback: state.bondingCurve.isCashbackCoin,
					});
				})();
	return { ...(await finalize(ixs, ownerKey)), quote: q.display };
}

/** Pays accrued creator fees out to the split's shareholders. Permissionless: any wallet can crank it. */
export async function buildPayoutTransaction(mint: string, payer: string) {
	const payerKey = new PublicKey(payer);
	const result = await pump.buildDistributeCreatorFeesInstructions(new PublicKey(mint), { payer: payerKey });
	if (!result.instructions.length) throw new Error('Nothing to pay out yet.');
	return finalize(result.instructions, payerKey);
}

