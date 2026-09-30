import Link from 'next/link';

import type { FaqItem } from '@/components/Faq';

export const FAQ: FaqItem[] = [
	{
		q: 'what does it cost?',
		a: (
			<>
				a flat launch fee paid from your wallet when you sign, plus network gas. after that the token pays its own
				way: every trade carries a small fee, and part of it goes to your fee wallet. the full schedule is in the{' '}
				<Link href="/guide#fees">guide</Link>.
			</>
		),
	},
	{
		q: 'do i need a wallet to launch from claude?',
		a: 'yes, at the last step. claude prepares and checks everything and hands you a checkout link. you open it, connect your wallet, and sign. nothing is deployed and nothing is spent until you do.',
	},
	{
		q: 'who gets the fees?',
		a: 'the fee wallet you name at launch gets the creator share of every trade, on the curve and in the pool after graduation. it is written on-chain at birth and nobody, including us, can change it.',
	},
	{
		q: 'can the liquidity be pulled?',
		a: 'no. on robinhood chain the uniswap position is minted to the launch contract, which has no function to withdraw it. on solana the coin graduates on pump.fun, which locks its liquidity in PumpSwap.',
	},
	{
		q: 'robinhood chain or solana?',
		a: 'same idea on both: a fixed-supply token, a bonding curve, graduation into a locked pool, creator fees to you. pick the chain your community already lives on.',
	},
	{
		q: 'something went wrong. what now?',
		a: 'every launch is on-chain, so nothing is lost: the checkout page resumes where you left off, and the registry picks up any launch made against the contracts, even outside this site.',
	},
];
