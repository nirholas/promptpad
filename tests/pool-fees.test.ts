import BN from 'bn.js';
import { describe, expect, it } from 'vitest';

import { poolCreatorFeesFromAccount } from '@/lib/solana/pool-fees';

/** A PumpSwap pool account laid out as the October 2026 pump_amm IDL writes it (287 bytes). */
function poolAccount({ virtualQuoteReserves, protocolFees, creatorFees }: { virtualQuoteReserves: bigint; protocolFees: bigint; creatorFees: bigint }) {
	const data = Buffer.alloc(287);
	data.writeBigInt64LE(BigInt.asIntN(64, virtualQuoteReserves), 245);
	data.writeBigInt64LE(virtualQuoteReserves < 0n ? -1n : 0n, 253);
	data.writeBigUInt64LE(250n, 261);
	data.writeBigUInt64LE(protocolFees, 271);
	data.writeBigUInt64LE(creatorFees, 279);
	return data;
}

describe('poolCreatorFeesFromAccount', () => {
	it('reads the creator fee bucket, not the neighbouring protocol bucket or the signed reserves', () => {
		const data = poolAccount({ virtualQuoteReserves: -391_886n, protocolFees: 1_234_567n, creatorFees: 391_886n });
		expect(poolCreatorFeesFromAccount(data).toString()).toBe('391886');
	});

	it('reads the full u64 range', () => {
		const data = poolAccount({ virtualQuoteReserves: 0n, protocolFees: 0n, creatorFees: 2n ** 64n - 1n });
		expect(poolCreatorFeesFromAccount(data).eq(new BN('18446744073709551615'))).toBe(true);
	});

	it('treats a pool written before the upgrade (shorter layout) as holding nothing', () => {
		expect(poolCreatorFeesFromAccount(Buffer.alloc(245)).isZero()).toBe(true);
		expect(poolCreatorFeesFromAccount(Buffer.alloc(286)).isZero()).toBe(true);
	});

	it('tolerates fields appended after creator_fees', () => {
		const data = Buffer.concat([poolAccount({ virtualQuoteReserves: 5n, protocolFees: 7n, creatorFees: 42n }), Buffer.alloc(64, 0xff)]);
		expect(poolCreatorFeesFromAccount(data).toString()).toBe('42');
	});
});
