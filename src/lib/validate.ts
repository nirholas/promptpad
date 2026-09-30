import { PublicKey } from '@solana/web3.js';
import { getAddress, isAddress } from 'viem';
import { z } from 'zod';

import type { ChainKey } from './config';

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export const MAX_INITIAL_BUY: Record<ChainKey, number> = { robinhood: 4, solana: 80 };

export const launchInputSchema = z
	.object({
		chain: z.enum(['robinhood', 'solana']),
		name: z
			.string()
			.trim()
			.min(1, 'Name is required.')
			.refine((s) => byteLength(s) <= 32, 'Name must be 32 bytes or fewer.'),
		symbol: z
			.string()
			.trim()
			.transform((s) => s.replace(/^\$/, '').toUpperCase())
			.pipe(z.string().regex(/^[A-Z0-9]{1,10}$/, 'Ticker must be 1 to 10 letters or digits.')),
		image: z
			.string()
			.trim()
			.url('Logo must be a public https link to an image.')
			.refine((s) => s.startsWith('https://'), 'Logo must be served over https.')
			.refine((s) => s.length <= 512, 'Logo link must be 512 characters or fewer.'),
		description: z
			.string()
			.trim()
			.default('')
			.refine((s) => byteLength(s) <= 1000, 'Description must be 1000 bytes or fewer.'),
		feeWallet: z.string().trim().min(1, 'A fee wallet is required.'),
		initialBuy: z
			.string()
			.trim()
			.default('0')
			.refine((s) => /^\d+(\.\d+)?$/.test(s), 'Initial buy must be a number.'),
	})
	.superRefine((value, ctx) => {
		if (value.chain === 'robinhood' && !isAddress(value.feeWallet, { strict: false })) {
			ctx.addIssue({ code: 'custom', path: ['feeWallet'], message: 'Fee wallet must be an EVM address (0x...).' });
		}
		if (value.chain === 'solana' && !isSolanaAddress(value.feeWallet)) {
			ctx.addIssue({ code: 'custom', path: ['feeWallet'], message: 'Fee wallet must be a Solana address.' });
		}
		if (Number(value.initialBuy) > MAX_INITIAL_BUY[value.chain]) {
			ctx.addIssue({
				code: 'custom',
				path: ['initialBuy'],
				message: `Initial buy is capped at ${MAX_INITIAL_BUY[value.chain]} ${value.chain === 'robinhood' ? 'ETH' : 'SOL'}.`,
			});
		}
	})
	.transform((value) => ({
		...value,
		feeWallet: value.chain === 'robinhood' ? getAddress(value.feeWallet) : value.feeWallet,
	}));

export type LaunchInput = z.infer<typeof launchInputSchema>;

export function isSolanaAddress(value: string) {
	try {
		return new PublicKey(value).toBase58() === value;
	} catch {
		return false;
	}
}

export function firstIssue(error: z.ZodError) {
	const issue = error.issues[0];
	return issue ? issue.message : 'Invalid input.';
}
