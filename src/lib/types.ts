import type { ChainKey } from './config';

/** Live on-chain state of a launched token, normalized across both chains. */
export type TokenState = {
	chain: ChainKey;
	address: string;
	graduated: boolean;
	/** 0..1 share of the curve sold. */
	progress: number;
	/** Spot price in the native asset (ETH or SOL) per whole token. */
	priceNative: number;
	marketCapNative: number;
	raisedNative: number;
	targetNative: number;
	tradeFeeBps: number;
	creatorShareBps: number;
	creatorFeesClaimableNative: number;
	feeWallet: string;
	creator: string;
	/** Curve pool on Solana; the graduated Uniswap pool on Robinhood Chain. */
	pool: string | null;
	createdAt: string | null;
};

export type Launch = {
	id: number;
	/** Gapless registry number, in order of recording. */
	number: number;
	chain: ChainKey;
	address: string;
	pool: string | null;
	name: string;
	symbol: string;
	image: string;
	description: string;
	creator: string;
	feeWallet: string;
	tx: string | null;
	source: 'web' | 'claude' | 'chain';
	graduated: boolean;
	createdAt: string;
};

export type Draft = {
	id: string;
	chain: ChainKey;
	name: string;
	symbol: string;
	image: string;
	description: string;
	feeWallet: string;
	initialBuy: string;
	source: 'web' | 'claude';
	mint: string | null;
	createdAt: string;
	expiresAt: string;
	launchId: number | null;
};
