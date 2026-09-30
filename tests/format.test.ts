import { describe, expect, it } from 'vitest';

import { formatAge, formatNative } from '@/lib/format';

describe('formatNative', () => {
	it.each([
		[1.01e-8, '0.0₇101 ETH'],
		[1e-8, '0.0₇1 ETH'],
		[2.1e-8, '0.0₇21 ETH'],
		[0.00005, '0.0₄5 ETH'],
		[0.0000039, '0.0₅39 ETH'],
		[0.0123, '0.0123 ETH'],
		[4.2, '4.200 ETH'],
		[21.04, '21.04 ETH'],
		[0, '0 ETH'],
	])('%s -> %s', (value, text) => {
		expect(formatNative(value, 'ETH')).toBe(text);
	});
});

describe('formatAge', () => {
	it('compacts ages like a terminal', () => {
		const now = Date.parse('2026-09-30T12:00:00Z');
		expect(formatAge('2026-09-30T11:59:15Z', now)).toBe('45s');
		expect(formatAge('2026-09-30T09:00:00Z', now)).toBe('3h');
		expect(formatAge('2026-09-19T12:00:00Z', now)).toBe('11d');
	});
});
