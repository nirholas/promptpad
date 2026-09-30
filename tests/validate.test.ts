import { describe, expect, it } from 'vitest';

import { launchInputSchema } from '@/lib/validate';

const base = {
	chain: 'robinhood',
	name: 'Night Owl',
	symbol: '$owl',
	image: 'https://example.org/owl.png',
	feeWallet: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
};

describe('launch input', () => {
	it('normalizes the ticker and checksums the EVM fee wallet', () => {
		const v = launchInputSchema.parse(base);
		expect(v.symbol).toBe('OWL');
		expect(v.feeWallet).toBe('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
		expect(v.initialBuy).toBe('0');
	});

	it('rejects a Solana address as a Robinhood fee wallet and vice versa', () => {
		expect(() => launchInputSchema.parse({ ...base, feeWallet: 'JBuNetso3yM9Ktwxn3RpoguRkx8QjnDov1tY7Zh9Wgwm' })).toThrow(/EVM address/);
		expect(() => launchInputSchema.parse({ ...base, chain: 'solana' })).toThrow(/Solana address/);
		expect(launchInputSchema.parse({ ...base, chain: 'solana', feeWallet: 'JBuNetso3yM9Ktwxn3RpoguRkx8QjnDov1tY7Zh9Wgwm' }).chain).toBe('solana');
	});

	it('enforces on-chain limits before anything is signed', () => {
		expect(() => launchInputSchema.parse({ ...base, name: 'x'.repeat(33) })).toThrow(/32 bytes/);
		expect(() => launchInputSchema.parse({ ...base, symbol: 'TOO-LONG-TICKER' })).toThrow(/Ticker/);
		expect(() => launchInputSchema.parse({ ...base, image: 'http://example.org/a.png' })).toThrow(/https/);
		expect(() => launchInputSchema.parse({ ...base, initialBuy: '5' })).toThrow(/capped/);
		expect(() => launchInputSchema.parse({ ...base, initialBuy: 'abc' })).toThrow(/number/);
	});
});
