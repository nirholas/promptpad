import 'server-only';

import { createPublicClient, decodeEventLog, http, parseAbi, type Address, type Hash } from 'viem';

import { PAD_FACTORY, robinhoodChain, ROBINHOOD_WETH } from '../config';
import { padFactoryAbi, padTokenAbi } from './abi';
import type { TokenState } from '../types';

export const evmClient = createPublicClient({
	chain: robinhoodChain,
	transport: http(process.env.ROBINHOOD_RPC_URL || robinhoodChain.rpcUrls.default.http[0], {
		retryCount: 2,
		timeout: 15_000,
	}),
	batch: { multicall: true },
});

function factory(): Address {
	if (!PAD_FACTORY) throw new Error('Robinhood Chain launches are not configured (NEXT_PUBLIC_PAD_FACTORY).');
	return PAD_FACTORY;
}

export type EvmLaunchEvent = {
	/** Attested launch channel from `LaunchOrigin`: 0 direct, 1 site, 2 prompt. */
	channel: number;
	token: Address;
	index: number;
	creator: Address;
	feeRecipient: Address;
	name: string;
	symbol: string;
	image: string;
	description: string;
};

/** Reads the TokenCreated event out of a confirmed launch transaction. */
export async function readLaunchFromTx(hash: Hash): Promise<EvmLaunchEvent | null> {
	const receipt = await evmClient.getTransactionReceipt({ hash });
	if (receipt.status !== 'success') return null;
	let created: Omit<EvmLaunchEvent, 'channel'> | null = null;
	let channel = 0;
	for (const log of receipt.logs) {
		if (log.address.toLowerCase() !== factory().toLowerCase()) continue;
		try {
			const event = decodeEventLog({ abi: padFactoryAbi, data: log.data, topics: log.topics });
			if (event.eventName === 'LaunchOrigin') {
				channel = Number(event.args.channel);
				continue;
			}
			if (event.eventName !== 'TokenCreated') continue;
			const a = event.args;
			created = {
				token: a.token,
				index: Number(a.index),
				creator: a.creator,
				feeRecipient: a.feeRecipient,
				name: a.name,
				symbol: a.symbol,
				image: a.image,
				description: a.description,
			};
		} catch {
			continue;
		}
	}
	return created ? { ...created, channel } : null;
}

/** The attested channel the factory recorded for a token (0 when launched directly). */
export async function readEvmOrigin(token: Address) {
	const [channel, ref] = await evmClient.readContract({
		address: factory(),
		abi: padFactoryAbi,
		functionName: 'origins',
		args: [token],
	});
	return { channel: Number(channel), ref };
}

export async function readFactoryConfig() {
	const address = factory();
	const [launchFee, tradeFeeBps, creatorShareBps, graduationFeeBps, targetRaise, launchesPaused, tokenCount, snipeStartBps, snipeWindow] =
		await Promise.all([
			evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'launchFee' }),
			evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'tradeFeeBps' }),
			evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'creatorShareBps' }),
			evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'graduationFeeBps' }),
			evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'targetRaise' }),
			evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'launchesPaused' }),
			evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'tokenCount' }),
			evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'SNIPE_START_BPS' }),
			evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'SNIPE_WINDOW' }),
		]);
	return {
		launchFee,
		tradeFeeBps,
		creatorShareBps,
		graduationFeeBps,
		targetRaise,
		launchesPaused,
		tokenCount,
		snipeStartBps,
		snipeWindow: Number(snipeWindow),
	};
}

export async function readFactoryTokens(from: number, to: number): Promise<Address[]> {
	const address = factory();
	const indexes = Array.from({ length: Math.max(0, to - from) }, (_, i) => BigInt(from + i));
	return Promise.all(
		indexes.map((i) => evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'tokens', args: [i] })),
	);
}

export async function readTokenMetadata(token: Address) {
	const [name, symbol, image, description, creator] = await Promise.all([
		evmClient.readContract({ address: token, abi: padTokenAbi, functionName: 'name' }),
		evmClient.readContract({ address: token, abi: padTokenAbi, functionName: 'symbol' }),
		evmClient.readContract({ address: token, abi: padTokenAbi, functionName: 'image' }),
		evmClient.readContract({ address: token, abi: padTokenAbi, functionName: 'description' }),
		evmClient.readContract({ address: token, abi: padTokenAbi, functionName: 'creator' }),
	]);
	return { name, symbol, image, description, creator };
}

export async function readEvmTokenState(token: Address): Promise<TokenState | null> {
	const address = factory();
	const curve = await evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'getCurve', args: [token] });
	if (curve.createdAt === BigInt(0)) return null;

	const [price, owed, targetRaise, curveSupply, totalSupply] = await Promise.all([
		evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'priceWei', args: [token] }),
		evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'creatorFeesOwed', args: [token] }),
		evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'targetRaise' }),
		evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'CURVE_SUPPLY' }),
		evmClient.readContract({ address: token, abi: padTokenAbi, functionName: 'totalSupply' }),
	]);

	const priceNative = curve.graduated ? await poolPrice(curve.pool, token).catch(() => Number(price) / 1e18) : Number(price) / 1e18;
	const progress = curve.graduated ? 1 : Number((curve.tokensSold * BigInt(10_000)) / curveSupply) / 10_000;
	return {
		chain: 'robinhood',
		address: token,
		graduated: curve.graduated,
		progress,
		priceNative,
		marketCapNative: priceNative * (Number(totalSupply) / 1e18),
		raisedNative: curve.graduated ? Number(targetRaise) / 1e18 : Number(curve.ethReserve) / 1e18,
		targetNative: Number(targetRaise) / 1e18,
		tradeFeeBps: curve.tradeFeeBps,
		creatorShareBps: curve.creatorShareBps,
		creatorFeesClaimableNative: Number(owed) / 1e18,
		feeWallet: curve.feeRecipient,
		creator: curve.creator,
		pool: curve.graduated ? curve.pool : null,
		createdAt: new Date(Number(curve.createdAt) * 1000).toISOString(),
	};
}

const poolAbi = parseAbi(['function slot0() view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool)']);

/** Live ETH-per-token price from the graduated Uniswap v3 pool (both tokens have 18 decimals). */
async function poolPrice(pool: Address, token: Address) {
	const [sqrtPriceX96] = await evmClient.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' });
	const ratio = (Number(sqrtPriceX96) / 2 ** 96) ** 2;
	return token.toLowerCase() < ROBINHOOD_WETH.toLowerCase() ? ratio : 1 / ratio;
}

export type CardMetrics = {
	address: string;
	progress: number | null;
	graduated: boolean;
	priceNative: number | null;
	marketCapNative: number | null;
};

/** Progress, price and market cap for many tokens; viem batches the reads into multicalls. */
export async function evmProgressMany(tokens: Address[]): Promise<CardMetrics[]> {
	const address = factory();
	const [curves, curveSupply, virtualEth, virtualToken, targetRaise] = await Promise.all([
		Promise.all(
			tokens.map((token) =>
				evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'getCurve', args: [token] }).catch(() => null),
			),
		),
		evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'CURVE_SUPPLY' }),
		evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'virtualEth' }),
		evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'VIRTUAL_TOKEN' }),
		evmClient.readContract({ address, abi: padFactoryAbi, functionName: 'targetRaise' }),
	]);
	return Promise.all(
		tokens.map(async (token, i) => {
			const curve = curves[i];
			if (!curve || curve.createdAt === BigInt(0)) {
				return { address: token as string, progress: null, graduated: false, priceNative: null, marketCapNative: null };
			}
			const reserve = curve.graduated ? targetRaise : curve.ethReserve;
			const curvePrice = Number(virtualEth + reserve) / Number(virtualToken - curve.tokensSold);
			const price = curve.graduated ? await poolPrice(curve.pool, token).catch(() => curvePrice) : curvePrice;
			return {
				address: token as string,
				graduated: curve.graduated,
				progress: curve.graduated ? 1 : Number((curve.tokensSold * BigInt(10_000)) / curveSupply) / 10_000,
				priceNative: price,
				marketCapNative: price * 1_000_000_000,
			};
		}),
	);
}
