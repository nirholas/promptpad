import { defineChain, type Address } from 'viem';

/**
 * Every tunable in one place. Public values are read through literal `process.env.NEXT_PUBLIC_*`
 * references so Next inlines them into the client bundle.
 */

export const SITE_NAME = 'Promptpad';
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

export type ChainKey = 'robinhood' | 'solana';
export const CHAINS: ChainKey[] = ['robinhood', 'solana'];

export function isChainKey(value: string): value is ChainKey {
	return value === 'robinhood' || value === 'solana';
}

// ---------------------------------------------------------------- Robinhood Chain

const robinhoodTestnet = process.env.NEXT_PUBLIC_ROBINHOOD_NETWORK === 'testnet';

export const robinhoodChain = robinhoodTestnet
	? defineChain({
			id: 46630,
			name: 'Robinhood Chain Testnet',
			nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
			rpcUrls: {
				default: {
					http: [process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || 'https://rpc.testnet.chain.robinhood.com'],
				},
			},
			blockExplorers: {
				default: { name: 'Blockscout', url: 'https://explorer.testnet.chain.robinhood.com' },
			},
			contracts: { multicall3: { address: '0xca11bde05977b3631167028862be2a173976ca11' } },
			testnet: true,
		})
	: defineChain({
			id: 4663,
			name: 'Robinhood Chain',
			nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
			rpcUrls: {
				default: {
					http: [process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'],
				},
			},
			blockExplorers: {
				default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
			},
			contracts: { multicall3: { address: '0xca11bde05977b3631167028862be2a173976ca11' } },
		});

const factory = process.env.NEXT_PUBLIC_PAD_FACTORY || '';
export const PAD_FACTORY: Address | null = /^0x[0-9a-fA-F]{40}$/.test(factory) ? (factory as Address) : null;

export const ROBINHOOD_WETH: Address = robinhoodTestnet
	? '0x7943e237c7F95DA44E0301572D358911207852Fa'
	: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';

export function robinhoodExplorer(kind: 'tx' | 'address' | 'token', value: string) {
	return `${robinhoodChain.blockExplorers.default.url}/${kind}/${value}`;
}

// ---------------------------------------------------------------- Solana

export const SOLANA_CLUSTER: 'mainnet-beta' | 'devnet' =
	process.env.NEXT_PUBLIC_SOLANA_CLUSTER === 'devnet' ? 'devnet' : 'mainnet-beta';

export const SOLANA_RPC_URL =
	process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
	(SOLANA_CLUSTER === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com');

/** Platform wallet that receives the Solana launch fee and the platform share of creator fees. */
const solanaTreasury = process.env.NEXT_PUBLIC_SOLANA_TREASURY || '';
export const SOLANA_TREASURY: string | null = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaTreasury) ? solanaTreasury : null;

/** Flat SOL launch fee, paid inside the launch bundle. */
export const SOLANA_LAUNCH_FEE_SOL = Number(process.env.NEXT_PUBLIC_SOLANA_LAUNCH_FEE_SOL ?? '0.01');

export function solanaExplorer(kind: 'tx' | 'address' | 'token', value: string) {
	const path = kind === 'tx' ? 'tx' : kind === 'token' ? 'token' : 'account';
	const cluster = SOLANA_CLUSTER === 'devnet' ? '?cluster=devnet' : '';
	return `https://solscan.io/${path}/${value}${cluster}`;
}

// ---------------------------------------------------------------- shared

export const DRAFT_TTL_HOURS = 24;

export function chainLabel(chain: ChainKey) {
	return chain === 'robinhood' ? robinhoodChain.name : SOLANA_CLUSTER === 'devnet' ? 'Solana Devnet' : 'Solana';
}

export function nativeSymbol(chain: ChainKey) {
	return chain === 'robinhood' ? 'ETH' : 'SOL';
}

export function explorer(chain: ChainKey, kind: 'tx' | 'address' | 'token', value: string) {
	return chain === 'robinhood' ? robinhoodExplorer(kind, value) : solanaExplorer(kind, value);
}

export function chainEnabled(chain: ChainKey) {
	return chain === 'robinhood' ? PAD_FACTORY !== null : SOLANA_TREASURY !== null;
}
