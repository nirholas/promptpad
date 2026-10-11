import 'server-only';

import { PAD_FACTORY, type ChainKey } from '../config';
import type { Launch, TokenState } from '../types';
import { syncEvmMarket } from './evm';

export * from './queries';
export { usdPrices } from './usd';

/** Chains with a trade and holder index. Solana pages use pump.fun-aware third-party charts instead. */
export const indexedChain = (chain: ChainKey) => chain === 'robinhood';

/**
 * Catch the index up before a read, but never hold a request for long: a slow RPC leaves the page
 * on data a few seconds old and the next poll picks up the rest.
 */
export async function freshen(chain: ChainKey) {
	if (!indexedChain(chain)) return;
	await Promise.race([
		syncEvmMarket().catch((error) => console.error('market sync failed', error instanceof Error ? error.message : error)),
		new Promise((resolve) => setTimeout(resolve, 2_500)),
	]);
}

/** Names for the addresses a holder list should explain rather than show as anonymous wallets. */
export function holderLabels(launch: Launch, state: TokenState | null): Record<string, string> {
	const labels: Record<string, string> = {};
	if (PAD_FACTORY) labels[PAD_FACTORY.toLowerCase()] = 'bonding curve';
	const pool = state?.pool ?? launch.pool;
	if (pool) labels[pool.toLowerCase()] = 'liquidity pool';
	labels['0x000000000000000000000000000000000000dead'] = 'burned';
	if (launch.feeWallet) labels[launch.feeWallet.toLowerCase()] ??= 'fee wallet';
	if (launch.creator) labels[launch.creator.toLowerCase()] = labels[launch.creator.toLowerCase()] === 'fee wallet' ? 'creator, fee wallet' : 'creator';
	return labels;
}
