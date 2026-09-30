import 'server-only';

import { formatEther, type Address } from 'viem';

import { chainEnabled, isChainKey, SOLANA_LAUNCH_FEE_SOL, type ChainKey } from './config';
import { evmProgressMany, readEvmTokenState, readFactoryConfig } from './evm/client';
import { markGraduated } from './launches';
import { CREATOR_SHARE_BPS, pumpFeeTerms, pumpProgressMany, readPumpTokenState } from './solana/pump';
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
			antiSnipe: { startBps: c.snipeStartBps, seconds: c.snipeWindow },
			lpTerms: `Liquidity is held by the factory forever. The pool's 1% fee keeps splitting ${c.creatorShareBps / 100}% creator / ${100 - c.creatorShareBps / 100}% protocol.`,
			launchesPaused: c.launchesPaused,
		};
	}
	// Terms come live from pump.fun's global fee config; the creator fee is split 70 / 30 between the
	// launch's fee wallet and the platform by a fee-sharing config that is locked at launch.
	const t = await pumpFeeTerms();
	return {
		chain,
		live: true,
		launchFee: SOLANA_LAUNCH_FEE_SOL,
		tradeFeeBps: t.totalBps,
		creatorShareBps: t.totalBps ? Math.round((t.creatorBps * CREATOR_SHARE_BPS) / t.totalBps) : 0,
		graduationFeeBps: 0,
		graduationTarget: Math.round(t.graduationTargetSol * 100) / 100,
		graduatesTo: 'PumpSwap',
		antiSnipe: null,
		lpTerms: `Trades on pump.fun's bonding curve, then PumpSwap. Of the ${t.totalBps / 100}% trade fee, pump.fun keeps ${t.protocolBps / 100}% and the ${t.creatorBps / 100}% creator fee is split 70% to the fee wallet and 30% to the platform, locked at launch. The creator's first buy lands in the same atomic bundle as the coin, so nobody can buy before them.`,
		launchesPaused: false,
	};
}

export async function feeSchedules() {
	const read = (chain: ChainKey) =>
		feeSchedule(chain).catch((error) => {
			console.error(`fee schedule read failed for ${chain}:`, error instanceof Error ? error.message : error);
			return null;
		});
	const [robinhood, solana] = await Promise.all([read('robinhood'), read('solana')]);
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
			chain === 'robinhood' ? await readEvmTokenState(address as Address) : await readPumpTokenState(address);
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
	return chain === 'robinhood' ? evmProgressMany(addresses as Address[]) : pumpProgressMany(addresses);
}
