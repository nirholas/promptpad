import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';

import type { Draft } from '@/lib/types';

// Read-only mainnet check of the production pump.fun launch builder: sizes, signatures, and
// simulation (signatures unchecked, nothing sent). Opt in with PUMP_SIM_PAYER=<funded address>.
const payer = process.env.PUMP_SIM_PAYER;

const draft = (over: Partial<Draft> = {}): Draft => ({
	id: 'simulation01',
	chain: 'solana',
	name: 'A'.repeat(32),
	symbol: 'ABCDEFGHIJ',
	image: 'https://example.org/logo.png',
	description: '',
	feeWallet: Keypair.generate().publicKey.toBase58(),
	initialBuy: '0.01',
	source: 'claude',
	mint: null,
	client: 'claude',
	createdAt: new Date().toISOString(),
	expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
	launchId: null,
	...over,
});

describe.skipIf(!payer)('pump.fun launch bundle (mainnet simulation)', () => {
	it('fits every transaction in one packet and simulates create + first buy', async () => {
		const attester = Keypair.generate();
		vi.stubEnv('NEXT_PUBLIC_SOLANA_TREASURY', Keypair.generate().publicKey.toBase58());
		vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://promptpad.ninabrekkerese.workers.dev');
		vi.stubEnv('ATTESTER_SOLANA_SECRET', JSON.stringify(Array.from(attester.secretKey)));
		vi.resetModules();
		const { buildLaunchBundle, connection } = await import('@/lib/solana/pump');

		const built = await buildLaunchBundle(draft(), payer!, null);
		expect(built.transactions).toHaveLength(2);
		const [tx1, tx2] = built.transactions.map((b) => Transaction.from(Buffer.from(b, 'base64')));
		for (const b of built.transactions) expect(Buffer.from(b, 'base64').length).toBeLessThanOrEqual(1232);
		// The mint signs the create; the attester signs the memo transaction.
		expect(tx1.signatures.some((s) => s.publicKey.toBase58() === built.mint && s.signature)).toBe(true);
		expect(tx2.signatures.some((s) => s.publicKey.equals(attester.publicKey) && s.signature)).toBe(true);

		const sim = await connection.simulateTransaction(new VersionedTransaction(tx1.compileMessage()), {
			sigVerify: false,
			replaceRecentBlockhash: true,
		});
		if (sim.value.err) console.error(sim.value.logs);
		expect(sim.value.err).toBeNull();
	});

	it('writes the locked 70/30 split, launch fee, memo and tip on a real coin', async () => {
		const attester = Keypair.generate();
		vi.stubEnv('NEXT_PUBLIC_SOLANA_TREASURY', Keypair.generate().publicKey.toBase58());
		vi.stubEnv('ATTESTER_SOLANA_SECRET', JSON.stringify(Array.from(attester.secretKey)));
		vi.resetModules();
		const { buildLaunchBundle, connection, pump } = await import('@/lib/solana/pump');
		const { feeSharingConfigPda } = await import('@pump-fun/pump-sdk');
		const { PublicKey } = await import('@solana/web3.js');

		// A coin created moments ago on pump.fun whose creator has not written a split yet stands in
		// for the coin our first transaction would have just created.
		const recent = (await (
			await fetch('https://frontend-api-v3.pump.fun/coins?offset=0&limit=10&sort=created_timestamp&order=DESC&includeNsfw=false')
		).json()) as { mint: string }[];
		for (const { mint } of recent) {
			const curve = await pump.fetchBondingCurve(new PublicKey(mint)).catch(() => null);
			if (!curve || curve.complete || (await connection.getAccountInfo(feeSharingConfigPda(new PublicKey(mint))))) continue;
			const built = await buildLaunchBundle(draft(), curve.creator.toBase58(), mint);
			expect(built.transactions).toHaveLength(1);
			const tx = Transaction.from(Buffer.from(built.transactions[0], 'base64'));
			const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
				sigVerify: false,
				replaceRecentBlockhash: true,
			});
			if (sim.value.err && /insufficient lamports/.test((sim.value.logs ?? []).join(' '))) continue;
			if (sim.value.err) console.error(sim.value.logs);
			expect(sim.value.err).toBeNull();
			expect(sim.value.logs?.some((l) => l.includes(`:v1:prompt:simulation01:${mint}`))).toBe(true);
			return;
		}
		throw new Error('No fresh pump.fun coin with a funded creator in the sample; rerun.');
	});
});
