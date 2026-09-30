import 'server-only';

import {
	ActivationType,
	deriveDbcPoolAddress,
	DynamicBondingCurveClient,
	getPriceFromSqrtPrice,
	SwapMode,
	type PoolConfig,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, type Transaction } from '@solana/web3.js';
import BN from 'bn.js';

import { DBC_CONFIG, SITE_URL, SOLANA_RPC_URL } from '../config';
import { attesters, CHANNELS, MEMO_PROGRAM, ORIGIN_TAG, solanaOriginInstruction } from '../origin';
import type { Draft, TokenState } from '../types';
import { SOLANA_ECONOMICS } from './curve-config';

export const connection = new Connection(process.env.SOLANA_RPC_URL || SOLANA_RPC_URL, 'confirmed');
export const dbc = new DynamicBondingCurveClient(connection, 'confirmed');

const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

function configKey(): PublicKey {
	if (!DBC_CONFIG) throw new Error('Solana launches are not configured (NEXT_PUBLIC_DBC_CONFIG).');
	return new PublicKey(DBC_CONFIG);
}

export function metadataUri(draftId: string) {
	return `${SITE_URL}/api/metadata/${draftId}`;
}

/**
 * Builds the launch transaction for a draft. The pool is created with the paying wallet as creator
 * (the program requires the creator to sign), an optional first buy is bundled at the minimum fee,
 * and creator rights move to the draft's fee wallet in the same transaction when it differs. The
 * fresh mint keypair signs here; the payer's wallet adds the last signature.
 */
export async function buildLaunchTransaction(draft: Draft, payer: string) {
	const payerKey = new PublicKey(payer);
	const feeWallet = new PublicKey(draft.feeWallet);
	const config = configKey();
	const mint = Keypair.generate();
	const buyLamports = new BN(Math.round(Number(draft.initialBuy) * 1e9));

	const tx = await dbc.creator.createPoolWithFirstBuy({
		createPoolParam: {
			name: draft.name,
			symbol: draft.symbol,
			uri: metadataUri(draft.id),
			payer: payerKey,
			poolCreator: payerKey,
			config,
			baseMint: mint.publicKey,
		},
		firstBuyParam: buyLamports.gtn(0)
			? {
					buyer: payerKey,
					buyAmount: buyLamports,
					minimumAmountOut: new BN(1),
					referralTokenAccount: null,
				}
			: undefined,
	});

	const pool = deriveDbcPoolAddress(NATIVE_MINT, mint.publicKey, config);
	if (!feeWallet.equals(payerKey)) {
		// Built from the IDL directly: the SDK helper reads the pool first, and the pool only
		// exists once this very transaction lands.
		const transfer = await dbc.creator
			.getProgram()
			.methods.transferPoolCreator()
			.accountsPartial({ virtualPool: pool, config, creator: payerKey, newCreator: feeWallet })
			.instruction();
		tx.add(transfer);
	}

	// Provenance: a memo the platform attester must co-sign, in the transaction that creates the pool.
	const origin = solanaOriginInstruction(draft);
	if (origin) tx.add(origin.instruction);

	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
	tx.recentBlockhash = blockhash;
	tx.lastValidBlockHeight = lastValidBlockHeight;
	tx.feePayer = payerKey;
	tx.partialSign(mint);
	if (origin) tx.partialSign(origin.signer);

	return {
		transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
		mint: mint.publicKey.toBase58(),
		pool: pool.toBase58(),
		lastValidBlockHeight,
	};
}

/** Pools under our config live at a deterministic address, so reads never need a program scan. */
export function poolAddressForMint(mint: string) {
	return deriveDbcPoolAddress(NATIVE_MINT, new PublicKey(mint), configKey());
}

export async function findPoolByMint(mint: string) {
	const publicKey = poolAddressForMint(mint);
	const account = await dbc.state.getPool(publicKey);
	if (!account || !account.poolState.config.equals(configKey())) return null;
	return { publicKey, account };
}

/** Curve progress for many mints in one RPC round trip. */
export async function solanaProgressMany(mints: string[]) {
	const config = await poolConfig();
	const threshold = Number(config.migrationQuoteThreshold.toString());
	const pools = mints.map(poolAddressForMint);
	const accounts = await dbc.pool.getProgram().account.virtualPool.fetchMultiple(pools);
	return mints.map((mint, i) => {
		const state = accounts[i]?.poolState;
		if (!state) return { address: mint, progress: null, graduated: false };
		const migrated = Number(state.isMigrated) === 1;
		return {
			address: mint,
			graduated: migrated,
			progress: migrated ? 1 : Math.min(1, Number(state.quoteReserve.toString()) / threshold),
		};
	});
}

let cachedConfig: { value: PoolConfig; at: number } | null = null;
export async function poolConfig(): Promise<PoolConfig> {
	if (cachedConfig && Date.now() - cachedConfig.at < 5 * 60_000) return cachedConfig.value;
	const value = await dbc.state.getPoolConfig(configKey());
	if (!value) throw new Error('The configured DBC config account does not exist on this cluster.');
	cachedConfig = { value, at: Date.now() };
	return value;
}

export async function readSolanaTokenState(mint: string): Promise<TokenState | null> {
	const found = await findPoolByMint(mint);
	if (!found) return null;
	const pool = found.account.poolState;
	const config = await poolConfig();

	const threshold = Number(config.migrationQuoteThreshold.toString()) / 1e9;
	const raised = Number(pool.quoteReserve.toString()) / 1e9;
	const migrated = Number(pool.isMigrated) === 1;
	const price = getPriceFromSqrtPrice(pool.sqrtPrice, config.tokenDecimal, 9).toNumber();
	const supply = Number(config.postMigrationTokenSupply.toString()) / 10 ** config.tokenDecimal;
	const activation = Number(pool.activationPoint.toString());

	return {
		chain: 'solana',
		address: mint,
		graduated: migrated || Number(pool.migrationProgress) > 0,
		progress: migrated ? 1 : Math.min(1, raised / threshold),
		priceNative: price,
		marketCapNative: price * supply,
		raisedNative: migrated ? threshold : raised,
		targetNative: threshold,
		tradeFeeBps: SOLANA_ECONOMICS.tradeFeeBps,
		creatorShareBps: config.creatorTradingFeePercentage * 100,
		creatorFeesClaimableNative: Number(pool.creatorQuoteFee.toString()) / 1e9,
		feeWallet: pool.creator.toBase58(),
		creator: pool.creator.toBase58(),
		pool: found.publicKey.toBase58(),
		createdAt: activation > 1_000_000_000 ? new Date(activation * 1000).toISOString() : null,
	};
}

/** Every pool created under the partner config, for registry backfill. */
export async function listConfigPools() {
	const pools = await dbc.state.getPoolsByConfig(configKey());
	return pools.map(({ publicKey, account: { poolState } }) => ({
		pool: publicKey.toBase58(),
		mint: poolState.baseMint.toBase58(),
		creator: poolState.creator.toBase58(),
		migrated: Number(poolState.isMigrated) === 1,
		activation: Number(poolState.activationPoint.toString()),
	}));
}

/** Reads name / symbol / uri straight from the Metaplex metadata account. */
export async function readMintMetadata(mint: string) {
	const [address] = PublicKey.findProgramAddressSync(
		[Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()],
		METADATA_PROGRAM,
	);
	const info = await connection.getAccountInfo(address);
	if (!info) return null;
	const data = info.data;
	let offset = 1 + 32 + 32;
	const readString = () => {
		const length = data.readUInt32LE(offset);
		offset += 4;
		const value = data.subarray(offset, offset + length).toString('utf8').replace(/\0+$/, '');
		offset += length;
		return value;
	};
	return { name: readString(), symbol: readString(), uri: readString() };
}

export type SwapSide = 'buy' | 'sell';

async function currentPoint(config: PoolConfig) {
	if (config.activationType === ActivationType.Slot) return new BN(await connection.getSlot('confirmed'));
	const time = await connection.getBlockTime(await connection.getSlot('confirmed'));
	return new BN(time ?? Math.floor(Date.now() / 1000));
}

/** Exact-in quote on the curve. `amount` is in whole SOL (buy) or whole tokens (sell). */
export async function quoteSwap(mint: string, side: SwapSide, amount: number, slippageBps: number) {
	const found = await findPoolByMint(mint);
	if (!found) throw new Error('No curve for that token.');
	if (Number(found.account.poolState.isMigrated) === 1) throw new Error('This token has graduated off the curve.');
	const config = await poolConfig();
	const decimals = side === 'buy' ? 9 : config.tokenDecimal;
	const amountIn = new BN(Math.floor(amount * 10 ** decimals).toString());
	if (amountIn.lten(0)) throw new Error('Enter an amount above zero.');

	const quote = dbc.pool.swapQuote2({
		virtualPool: found.account,
		config,
		swapBaseForQuote: side === 'sell',
		hasReferral: false,
		eligibleForFirstSwapWithMinFee: false,
		currentPoint: await currentPoint(config),
		slippageBps,
		swapMode: SwapMode.ExactIn,
		amountIn,
	});
	const outDecimals = side === 'buy' ? config.tokenDecimal : 9;
	return {
		pool: found.publicKey,
		amountIn,
		minimumAmountOut: quote.minimumAmountOut ?? new BN(0),
		display: {
			amountOut: Number(quote.outputAmount.toString()) / 10 ** outDecimals,
			minimumAmountOut: Number((quote.minimumAmountOut ?? new BN(0)).toString()) / 10 ** outDecimals,
			fee: Number(quote.tradingFee.add(quote.protocolFee).toString()) / 1e9,
		},
	};
}

async function finalize(tx: Transaction, payer: PublicKey) {
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
	tx.recentBlockhash = blockhash;
	tx.lastValidBlockHeight = lastValidBlockHeight;
	tx.feePayer = payer;
	return {
		transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
		lastValidBlockHeight,
	};
}

export async function buildSwapTransaction(mint: string, owner: string, side: SwapSide, amount: number, slippageBps: number) {
	const ownerKey = new PublicKey(owner);
	const q = await quoteSwap(mint, side, amount, slippageBps);
	const tx = await dbc.pool.swap2({
		owner: ownerKey,
		pool: q.pool,
		swapBaseForQuote: side === 'sell',
		referralTokenAccount: null,
		swapMode: SwapMode.ExactIn,
		amountIn: q.amountIn,
		minimumAmountOut: q.minimumAmountOut,
	});
	return { ...(await finalize(tx, ownerKey)), quote: q.display };
}

/** Creator-fee claim; only the pool's current creator (the launch's fee wallet) can sign it. */
export async function buildCreatorClaimTransaction(mint: string, creator: string) {
	const creatorKey = new PublicKey(creator);
	const found = await findPoolByMint(mint);
	if (!found) throw new Error('No curve for that token.');
	if (!found.account.poolState.creator.equals(creatorKey)) {
		throw new Error('Only the fee wallet of this token can claim its creator fees.');
	}
	const u64Max = new BN('18446744073709551615');
	const tx = await dbc.creator.claimCreatorTradingFee({
		creator: creatorKey,
		payer: creatorKey,
		pool: found.publicKey,
		maxBaseAmount: u64Max,
		maxQuoteAmount: u64Max,
	});
	return finalize(tx, creatorKey);
}

/**
 * Reads the launch origin straight from chain: the mint's first transaction must carry our memo
 * with the attester as a signer. Returns null for launches the platform did not attest.
 */
export async function readSolanaOrigin(mint: string) {
	const attester = attesters().solana;
	if (!attester) return null;
	const signatures = await connection.getSignaturesForAddress(new PublicKey(mint), { limit: 1000 }, 'confirmed');
	const first = signatures.at(-1);
	if (!first) return null;
	const tx = await connection.getParsedTransaction(first.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
	if (!tx || tx.meta?.err) return null;
	const signed = new Set(tx.transaction.message.accountKeys.filter((k) => k.signer).map((k) => k.pubkey.toBase58()));
	if (!signed.has(attester)) return null;
	for (const ix of tx.transaction.message.instructions) {
		if (!ix.programId.equals(MEMO_PROGRAM) || !('parsed' in ix) || typeof ix.parsed !== 'string') continue;
		const [tag, version, channel, draftId] = ix.parsed.split(':');
		if (tag !== ORIGIN_TAG || version !== 'v1' || !(channel in CHANNELS)) continue;
		return {
			channel: CHANNELS[channel as keyof typeof CHANNELS],
			draftId: draftId ?? null,
			signature: first.signature,
		};
	}
	return null;
}
