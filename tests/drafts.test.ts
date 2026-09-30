import { beforeAll, describe, expect, it, vi } from 'vitest';

// Real embedded Postgres (PGlite, in memory); a factory address opens the Robinhood lane.
vi.stubEnv('NEXT_PUBLIC_PAD_FACTORY', '0x9a9edEA6C804F40d81B1Dc4ae551AFfbad2ec5Bb');

let mod: typeof import('@/lib/launches');
let validate: typeof import('@/lib/validate');

beforeAll(async () => {
	mod = await import('@/lib/launches');
	validate = await import('@/lib/validate');
});

const input = () =>
	validate.launchInputSchema.parse({
		chain: 'robinhood',
		name: 'Paper Crane',
		symbol: 'CRANE',
		image: 'https://example.org/crane.png',
		feeWallet: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
	});

describe('drafts', () => {
	it('stores a 24h draft with a readable id', async () => {
		const draft = await mod.createDraft(input(), 'claude');
		expect(draft.id).toMatch(/^[a-z2-9]{12}$/);
		expect(draft.source).toBe('claude');
		const hours = (new Date(draft.expiresAt).getTime() - new Date(draft.createdAt).getTime()) / 3_600_000;
		expect(Math.round(hours)).toBe(24);
		expect(mod.draftExpired(draft)).toBe(false);
		expect((await mod.getDraft(draft.id))?.symbol).toBe('CRANE');
	});

	it('refuses a closed chain', async () => {
		const solana = validate.launchInputSchema.parse({ ...input(), chain: 'solana', feeWallet: 'JBuNetso3yM9Ktwxn3RpoguRkx8QjnDov1tY7Zh9Wgwm' });
		await expect(mod.createDraft(solana, 'web')).rejects.toThrow(/not open/);
	});

	it('returns an empty registry before any launch', async () => {
		const { launches, total } = await mod.listLaunches({});
		expect(total).toBe(0);
		expect(launches).toEqual([]);
	});
});
