import { isLegacyQuoteMint } from '@pump-fun/pump-sdk';
import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';

import type { Draft } from '@/lib/types';

// Read-only mainnet check of the production pump.fun launch builder: sizes, signatures, and
// simulation (signatures unchecked, nothing sent). Opt in with PUMP_SIM_PAYER=<funded address>.
const payer = process.env.PUMP_SIM_PAYER;

/** `sweep_creator_fee` instruction discriminator in the pump IDL. */
const SWEEP_CREATOR_FEE = '20f6bf3408c949ba';

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
			// The Jito tip, then the split opened by the creator-fee sweep (v3 trades since the coin was
			// created leave fees on the curve, and the split fails with 6095 until they are swept).
			expect(built.transactions).toHaveLength(2);
			const tx = Transaction.from(Buffer.from(built.transactions[1], 'base64'));
			// sweep_creator_fee, as listed in the pump IDL.
			expect(tx.instructions[0].data.subarray(0, 8).toString('hex')).toBe(SWEEP_CREATOR_FEE);
			const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
				sigVerify: false,
				replaceRecentBlockhash: true,
			});
			// An unfunded creator (no lamports at all reads as AccountNotFound) cannot pay; try the next coin.
			if (sim.value.err === 'AccountNotFound') continue;
			if (sim.value.err && /insufficient lamports/.test((sim.value.logs ?? []).join(' '))) continue;
			if (sim.value.err) console.error(sim.value.logs);
			expect(sim.value.err).toBeNull();
			expect(sim.value.logs?.some((l) => l.includes(`:v1:prompt:simulation01:${mint}`))).toBe(true);
			return;
		}
		throw new Error('No fresh pump.fun coin with a funded creator in the sample; rerun.');
	});

	it('buys with buy_exact_quote_in_v3 and sells back with sell_v3 on a live curve', async () => {
		vi.resetModules();
		const { buildSwapTransaction, connection, pump, quoteSwap } = await import('@/lib/solana/pump');
		const { PublicKey } = await import('@solana/web3.js');

		const recent = (await (
			await fetch('https://frontend-api-v3.pump.fun/coins?offset=0&limit=20&sort=created_timestamp&order=DESC&includeNsfw=false')
		).json()) as { mint: string }[];
		for (const { mint } of recent) {
			const curve = await pump.fetchBondingCurve(new PublicKey(mint)).catch(() => null);
			if (!curve || curve.complete || curve.isCashbackCoin || curve.isMayhemMode || !isLegacyQuoteMint(curve.quoteMint)) continue;
			const quote = await quoteSwap(mint, 'buy', 0.01);
			expect(quote.amountOut).toBeGreaterThan(0);
			// Fresh curves move between the quote and the simulation; 10% slippage keeps this a check of the
			// instructions rather than of the market.
			const buy = Transaction.from(Buffer.from((await buildSwapTransaction(mint, payer!, 'buy', 0.01, 1000)).transaction, 'base64'));
			const sell = Transaction.from(
				Buffer.from((await buildSwapTransaction(mint, payer!, 'sell', quote.amountOut / 2, 1000)).transaction, 'base64'),
			);
			const names = [...buy.instructions, ...sell.instructions].map((ix) => ix.data.subarray(0, 8).toString('hex'));
			// buy_exact_quote_in_v3 and sell_v3, as listed in the pump IDL.
			expect(names).toContain('e1f7501ed5b38488');
			expect(names).toContain('1c92de7726c469d5');
			// The sell reads the curve before the buy, so its minimum still holds after the buy moves the price.
			const both = new Transaction({ feePayer: buy.feePayer, recentBlockhash: buy.recentBlockhash }).add(...buy.instructions, ...sell.instructions);
			const sim = await connection.simulateTransaction(new VersionedTransaction(both.compileMessage()), {
				sigVerify: false,
				replaceRecentBlockhash: true,
			});
			if (sim.value.err) console.error(sim.value.logs);
			expect(sim.value.err).toBeNull();
			return;
		}
		throw new Error('No live SOL curve in the sample; rerun.');
	});

	it('falls back to buy_v2 and sell_v2 on a cashback coin', async (ctx) => {
		vi.resetModules();
		const { buildSwapTransaction, connection, pump, quoteSwap } = await import('@/lib/solana/pump');
		const { PublicKey } = await import('@solana/web3.js');

		// Cashback coins are rare among fresh launches, so look through the recently traded ones.
		const active = (await (
			await fetch('https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false')
		).json()) as { mint: string; complete: boolean }[];
		for (const { mint, complete } of active) {
			if (complete) continue;
			const curve = await pump.fetchBondingCurve(new PublicKey(mint)).catch(() => null);
			if (!curve || curve.complete || !curve.isCashbackCoin || !isLegacyQuoteMint(curve.quoteMint)) continue;
			const quote = await quoteSwap(mint, 'buy', 0.01);
			const buy = Transaction.from(Buffer.from((await buildSwapTransaction(mint, payer!, 'buy', 0.01, 1000)).transaction, 'base64'));
			const sell = Transaction.from(
				Buffer.from((await buildSwapTransaction(mint, payer!, 'sell', quote.amountOut / 2, 1000)).transaction, 'base64'),
			);
			const names = [...buy.instructions, ...sell.instructions].map((ix) => ix.data.subarray(0, 8).toString('hex'));
			// buy_v2 and sell_v2: v3 rejects cashback coins with 6094 CashbackCoinNotSupported.
			expect(names).toContain('b817ee6167c5d33d');
			expect(names).toContain('5df6823ce7e940b2');
			const both = new Transaction({ feePayer: buy.feePayer, recentBlockhash: buy.recentBlockhash }).add(...buy.instructions, ...sell.instructions);
			const sim = await connection.simulateTransaction(new VersionedTransaction(both.compileMessage()), {
				sigVerify: false,
				replaceRecentBlockhash: true,
			});
			if (sim.value.err) console.error(sim.value.logs);
			expect(sim.value.err).toBeNull();
			return;
		}
		ctx.skip('No cashback coin among the recently traded curves right now.');
	});

	it('pays out a live fee split with the creator-fee sweep in front of the distribution', async (ctx) => {
		vi.resetModules();
		const { buildPayoutTransaction, connection } = await import('@/lib/solana/pump');
		const { feeSharingConfigPda, PUMP_PROGRAM_ID } = await import('@pump-fun/pump-sdk');
		const { PublicKey } = await import('@solana/web3.js');

		// Any coin whose creator wrote a fee-sharing config stands in for one of ours: the payout is
		// permissionless, so the simulation payer can crank it.
		const active = (await (
			await fetch('https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false')
		).json()) as { mint: string; complete: boolean }[];
		for (const { mint, complete } of active) {
			if (complete || !(await connection.getAccountInfo(feeSharingConfigPda(new PublicKey(mint))))) continue;
			const built = await buildPayoutTransaction(mint, payer!).catch(() => null);
			if (!built) continue;
			const tx = Transaction.from(Buffer.from(built.transaction, 'base64'));
			// On a coin still on its curve the sweep is always first, even when the bucket was empty at
			// build time, so a trade landing before the send cannot fail the distribution with 6095.
			expect(tx.instructions[0].programId.equals(PUMP_PROGRAM_ID)).toBe(true);
			expect(tx.instructions[0].data.subarray(0, 8).toString('hex')).toBe(SWEEP_CREATOR_FEE);
			const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
				sigVerify: false,
				replaceRecentBlockhash: true,
			});
			if (sim.value.err) console.error(sim.value.logs);
			expect(sim.value.err).toBeNull();
			return;
		}
		ctx.skip('No recently traded curve with a fee-sharing config right now.');
	});
});
