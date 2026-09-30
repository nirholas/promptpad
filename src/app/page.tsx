import { HeroCarousel, type HeroSlide } from '@/components/HeroCarousel';
import { StatBar } from '@/components/StatBar';
import { TokenBrowser } from '@/components/TokenBrowser';
import { chainEnabled, SITE_URL } from '@/lib/config';
import { feeSchedules } from '@/lib/fees';
import { formatBps } from '@/lib/format';
import { syncRegistry } from '@/lib/launches';

export const dynamic = 'force-dynamic';

export default async function Home(props: PageProps<'/'>) {
	const params = await props.searchParams;
	await syncRegistry().catch((error) => console.error('registry sync failed', error));
	const { robinhood, solana } = await feeSchedules();

	const slides: HeroSlide[] = [
		{
			id: 'prompt',
			eyebrow: 'claude connector',
			title: 'Launch a token from a prompt.',
			body: `Add ${SITE_URL.replace(/^https?:\/\//, '')}/mcp to Claude, describe the coin, sign the checkout link. Robinhood Chain or Solana. Creator fees go to your wallet, forever.`,
			cta: { href: '/launch', label: 'Launch Now' },
			secondary: { href: '/guide#claude', label: 'Add to Claude' },
			visual: {
				kind: 'terminal',
				lines: {
					you: 'launch a token called Night Owl, ticker $OWL, on solana. logo https://… fees to 7xKp…',
					out: 'preview ready: Night Owl ($OWL) on solana. open the checkout link to review the fee and sign with your wallet.',
				},
			},
		},
	];
	if (robinhood && chainEnabled('robinhood')) {
		slides.push({
			id: 'robinhood',
			eyebrow: 'robinhood chain',
			title: 'Curve to locked Uniswap pool.',
			body: `A fixed 1B supply sells on a bonding curve and graduates at ${robinhood.graduationTarget} ETH into a Uniswap v3 position nobody can pull. ${formatBps(robinhood.creatorShareBps)} of every trade fee goes to the creator.`,
			cta: { href: '/launch', label: 'Launch on Robinhood Chain' },
			visual: {
				kind: 'facts',
				facts: [
					{ label: 'launch fee', value: `${robinhood.launchFee} ETH` },
					{ label: 'trade fee', value: formatBps(robinhood.tradeFeeBps) },
					{ label: 'to creator', value: formatBps(robinhood.creatorShareBps) },
					{ label: 'graduates at', value: `${robinhood.graduationTarget} ETH` },
				],
				note: robinhood.antiSnipe ? `anti-snipe: ${formatBps(robinhood.antiSnipe.startBps)} buy tax falling to zero over ${robinhood.antiSnipe.seconds}s. no wallet is exempt.` : robinhood.lpTerms,
			},
		});
	}
	if (solana && chainEnabled('solana')) {
		slides.push({
			id: 'solana',
			eyebrow: 'solana · pump.fun',
			title: 'Born on pump.fun. Split locked.',
			body: 'Your coin, your first buy and a permanent 70 / 30 creator-fee split land in one atomic bundle. Nobody buys before you, and the split can never be changed.',
			cta: { href: '/launch', label: 'Launch on Solana' },
			visual: {
				kind: 'facts',
				facts: [
					{ label: 'launch fee', value: `${solana.launchFee} SOL` },
					{ label: 'trade fee', value: formatBps(solana.tradeFeeBps) },
					{ label: 'creator fee split', value: '70 / 30' },
					{ label: 'graduates at', value: `${solana.graduationTarget} SOL` },
				],
				note: 'trades on pump.fun from the first second, then graduates to PumpSwap.',
			},
		});
	}

	return (
		<div className="wrap">
			<HeroCarousel slides={slides} />
			<StatBar />
			<TokenBrowser params={params} basePath="/" />
		</div>
	);
}
