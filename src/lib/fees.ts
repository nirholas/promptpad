import 'server-only';

import { formatEther, type Address } from 'viem';

import { chainEnabled, isChainKey, type ChainKey } from './config';
import { evmProgressMany, readEvmTokenState, readFactoryConfig } from './evm/client';
import { markGraduated } from './launches';
import { SOLANA_ECONOMICS } from './solana/curve-config';
import { poolConfig, readSolanaTokenState, solanaProgressMany } from './solana/dbc';
import type { TokenState } from './types';

export type FeeSchedule = {
	chain: ChainKey;
	live: boolean;
	launchFee: number;
	tradeFeeBps: number;
	creatorShareBps: number;
	graduationFeeBps: number;
	graduationTarget: number;
	graduatesTo: string;
	antiSnipe: { startBps: number; seconds: number } | null;
	lpTerms: string;
	launchesPaused: boolean;
};

export async function feeSchedule(chain: ChainKey): Promise<FeeSchedule | null> {
	if (!chainEnabled(chain)) return null;
	if (chain === 'robinhood') {
		const c = await readFactoryConfig();
		return {
			chain,
			live: true,
			launchFee: Number(formatEther(c.launchFee)),
			tradeFeeBps: c.tradeFeeBps,
			creatorShareBps: c.creatorShareBps,
			graduationFeeBps: c.graduationFeeBps,
			graduationTarget: Number(formatEther(c.targetRaise)),
			graduatesTo: 'Uniswap v3 (1% pool, full range)',
			antiSnipe: null,
			lpTerms: 'Liquidity is held by the factory forever. Pool fees split creator / protocol at the creator share.',
			launchesPaused: c.launchesPaused,
		};
	}
	// Terms come from the partner config account on-chain; the fee curve's shape (anti-snipe window,
	// steady-state rate) is what scripts/solana-create-config.ts encoded into it.
	const c = await poolConfig();
	const e = SOLANA_ECONOMICS;
	return {
		chain,
		live: true,
		launchFee: Number(c.poolCreationFee.toString()) / 1e9,
		tradeFeeBps: e.tradeFeeBps,
		creatorShareBps: c.creatorTradingFeePercentage * 100,
		graduationFeeBps: c.migrationFeePercentage * 100,
		graduationTarget: Math.round(Number(c.migrationQuoteThreshold.toString()) / 1e7) / 100,
		graduatesTo: 'Meteora DAMM v2',
		antiSnipe: { startBps: e.antiSnipeStartBps, seconds: e.antiSnipeSeconds },
		lpTerms: `LP is permanently locked, ${c.creatorPermanentLockedLiquidityPercentage}% to the creator and ${c.partnerPermanentLockedLiquidityPercentage}% to the protocol; each side claims its own pool fees. Meteora keeps ${e.meteoraProtocolFeePercentage}% of every trade fee before the split.`,
		launchesPaused: false,
	};
}

export async function feeSchedules() {
	const [robinhood, solana] = await Promise.all([
		feeSchedule('robinhood').catch(() => null),
		feeSchedule('solana').catch(() => null),
	]);
	return { robinhood, solana };
}

const STATE_TTL_MS = 8_000;
const stateCache = new Map<string, { at: number; value: Promise<TokenState | null> }>();

/**
 * Live token state, shared across concurrent viewers for a few seconds so a busy page does not
 * multiply RPC load. Failed reads are not cached.
 */
export async function readTokenState(chain: string, address: string): Promise<TokenState | null> {
	if (!isChainKey(chain) || !chainEnabled(chain)) return null;
	const key = `${chain}:${address.toLowerCase()}`;
	const hit = stateCache.get(key);
	if (hit && Date.now() - hit.at < STATE_TTL_MS) return hit.value;

	const value = (async () => {
		const state =
			chain === 'robinhood' ? await readEvmTokenState(address as Address) : await readSolanaTokenState(address);
		if (state?.graduated) await markGraduated(chain, address, chain === 'robinhood' ? state.pool : null);
		return state;
	})();
	stateCache.set(key, { at: Date.now(), value });
	value.catch(() => stateCache.delete(key));
	if (stateCache.size > 5_000) {
		for (const [k, v] of stateCache) if (Date.now() - v.at > STATE_TTL_MS) stateCache.delete(k);
	}
	return value;
}

export async function readProgressMany(chain: ChainKey, addresses: string[]) {
	if (!chainEnabled(chain) || !addresses.length) return [];
	return chain === 'robinhood' ? evmProgressMany(addresses as Address[]) : solanaProgressMany(addresses);
}
