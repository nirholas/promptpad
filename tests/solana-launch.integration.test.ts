import { VersionedTransaction } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';

import type { Draft } from '@/lib/types';

// Read-only integration check against Solana mainnet: builds a real launch transaction with the
// production builder and simulates it (signatures unchecked, nothing sent). Opt in with
// SOLANA_SIM_CONFIG=<existing SOL-quoted DBC config> SOLANA_SIM_PAYER=<funded address>.
const config = process.env.SOLANA_SIM_CONFIG;
const payer = process.env.SOLANA_SIM_PAYER;

describe.skipIf(!config || !payer)('Solana launch transaction (mainnet simulation)', () => {
	it('creates the pool, bundles the first buy and hands creator rights to the fee wallet', async () => {
		vi.stubEnv('NEXT_PUBLIC_DBC_CONFIG', config!);
		vi.stubEnv('NEXT_PUBLIC_SOLANA_RPC_URL', process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
		vi.resetModules();
		const { buildLaunchTransaction, connection } = await import('@/lib/solana/dbc');

		const draft: Draft = {
			id: 'simulation01',
			chain: 'solana',
			name: 'Simulation Coin',
			symbol: 'SIMC',
			image: 'https://example.org/logo.png',
			description: 'simulated only',
			feeWallet: 'JBuNetso3yM9Ktwxn3RpoguRkx8QjnDov1tY7Zh9Wgwm',
			initialBuy: '0.01',
			source: 'web',
			mint: null,
			createdAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
			launchId: null,
		};
		const built = await buildLaunchTransaction(draft, payer!);
		const raw = Buffer.from(built.transaction, 'base64');
		expect(raw.length).toBeLessThanOrEqual(1232);

		const { Transaction } = await import('@solana/web3.js');
		const tx = Transaction.from(raw);
		const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
			sigVerify: false,
			replaceRecentBlockhash: true,
		});
		if (sim.value.err) console.error(sim.value.logs);
		expect(sim.value.err).toBeNull();
		expect(sim.value.logs?.some((l) => l.includes('Instruction: TransferPoolCreator'))).toBe(true);
		expect(sim.value.logs?.some((l) => /Instruction: Swap/.test(l))).toBe(true);
	});
});
