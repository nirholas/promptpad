import { explorer, PAD_FACTORY, type ChainKey } from '@/lib/config';
import { formatBps, formatPercent } from '@/lib/format';
import type { TokenState } from '@/lib/types';
import type { MarketData } from './MarketPanel';

type Check = { ok: boolean | null; title: string; detail: string; value?: string };

/**
 * What a trader checks before buying: the contract guarantees (fixed supply, no admin, locked
 * liquidity) and the live risks (concentration, the creator's bag). Guarantees come from the
 * contracts this platform deploys; risks come from the holder index.
 */
export function SafetyCard({ chain, state, data, attested }: { chain: ChainKey; state: TokenState; data: MarketData | null; attested: boolean }) {
	const holders = data?.holders;
	const creator = holders?.top.find((h) => h.label?.startsWith('creator'));
	const top10 = holders?.top10Share ?? null;

	const checks: Check[] =
		chain === 'robinhood'
			? [
					{ ok: true, title: 'fixed supply', detail: '1,000,000,000 tokens minted once at launch. the token has no mint function.' },
					{ ok: true, title: 'no owner controls', detail: 'no blacklist, pause, tax switch or upgrade path on the token contract.' },
					{ ok: true, title: 'liquidity locked forever', detail: 'at graduation the whole raise seeds a Uniswap v3 position the launch contract can never withdraw.' },
					{ ok: true, title: 'anti-snipe', detail: 'buys in the first 5 seconds pay a tax that falls from 99% to the normal fee. no wallet is exempt.' },
				]
			: [
					{ ok: true, title: 'mint authority revoked', detail: 'pump.fun creates the mint with a fixed supply and no mint authority.' },
					{ ok: true, title: 'liquidity locked', detail: 'pump.fun graduates the curve into PumpSwap and locks the liquidity.' },
					{ ok: true, title: 'fair launch', detail: "the coin and the creator's first buy land in one atomic bundle; nobody buys before the creator." },
				];

	checks.push({
		ok: top10 === null ? null : top10 < 0.3,
		title: 'top 10 holders',
		detail: top10 === null ? 'no wallets hold it yet besides the curve.' : top10 < 0.3 ? 'supply is spread out.' : 'a few wallets hold a large share. they can move the price hard.',
		value: top10 === null ? '-' : formatPercent(top10),
	});
	if (data?.indexed) {
		checks.push({
			ok: creator ? creator.share < 0.1 : true,
			title: 'creator holds',
			detail: creator ? (creator.share < 0.1 ? 'a modest creator position.' : 'the creator holds a large share of supply.') : 'the creator holds none of the supply.',
			value: creator ? formatPercent(creator.share, 2) : '0%',
		});
	}
	checks.push({
		ok: true,
		title: 'trade fee',
		detail: `${formatBps(state.creatorShareBps)} of it goes to the creator's fee wallet for as long as it trades.`,
		value: formatBps(state.tradeFeeBps),
	});
	checks.push({
		ok: attested ? true : null,
		title: 'launch provenance',
		detail: attested ? 'signed by the platform at launch and recorded on-chain.' : 'launched directly against the contracts, without a platform signature.',
	});

	return (
		<div className="card card-pad" style={{ display: 'grid', gap: 6 }}>
			<h2 className="caps">safety</h2>
			<div className="checks">
				{checks.map((c) => (
					<div key={c.title} className={`check ${c.ok === true ? 'ok' : c.ok === false ? 'warn' : ''}`}>
						<span className="mark" aria-hidden="true">
							{c.ok === true ? '✓' : c.ok === false ? '!' : '·'}
						</span>
						<div>
							<div>{c.title}</div>
							<p>{c.detail}</p>
						</div>
						{c.value ? <b>{c.value}</b> : <span />}
					</div>
				))}
			</div>
		</div>
	);
}

/** Every place a trader might want this token open: explorers, charts, terminals, scanners. */
export function TerminalLinks({ chain, address, pool }: { chain: ChainKey; address: string; pool: string | null }) {
	const links: [string, string, string][] =
		chain === 'solana'
			? [
					['pump.fun', `https://pump.fun/coin/${address}`, 'curve'],
					['GMGN', `https://gmgn.ai/sol/token/${address}`, 'terminal'],
					['Axiom', `https://axiom.trade/meme/${address}`, 'terminal'],
					['Photon', `https://photon-sol.tinyastro.io/en/lp/${address}`, 'terminal'],
					['DexScreener', `https://dexscreener.com/solana/${address}`, 'chart'],
					['DEXTools', `https://www.dextools.io/app/en/solana/pair-explorer/${pool ?? address}`, 'chart'],
					['Birdeye', `https://birdeye.so/token/${address}?chain=solana`, 'data'],
					['Jupiter', `https://jup.ag/swap/SOL-${address}`, 'swap'],
					['RugCheck', `https://rugcheck.xyz/tokens/${address}`, 'scan'],
					['Bubblemaps', `https://app.bubblemaps.io/sol/token/${address}`, 'holders'],
					['Solscan', explorer('solana', 'token', address), 'explorer'],
				]
			: [
					['Blockscout', explorer('robinhood', 'token', address), 'explorer'],
					['holders', `${explorer('robinhood', 'token', address)}?tab=holders`, 'explorer'],
					['contract', `${explorer('robinhood', 'address', address)}?tab=contract`, 'source'],
					...(PAD_FACTORY ? ([['launch contract', `${explorer('robinhood', 'address', PAD_FACTORY)}?tab=contract`, 'source']] as [string, string, string][]) : []),
					...(pool ? ([['uniswap pool', explorer('robinhood', 'address', pool), 'pool']] as [string, string, string][]) : []),
					['DexScreener', `https://dexscreener.com/search?q=${address}`, 'search'],
				];
	return (
		<div className="card card-pad" style={{ display: 'grid', gap: 10 }}>
			<h2 className="caps">open in</h2>
			<div className="link-grid">
				{links.map(([label, href, kind]) => (
					<a key={label} href={href} target="_blank" rel="noreferrer">
						{label}
						<span>{kind}</span>
					</a>
				))}
			</div>
		</div>
	);
}
