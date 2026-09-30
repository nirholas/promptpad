import type { Metadata } from 'next';
import Link from 'next/link';

import { CopyButton } from '@/components/CopyButton';
import { Faq } from '@/components/Faq';
import { FeeTable } from '@/components/FeeTable';
import { chainLabel, explorer, PAD_FACTORY, SITE_URL, SOLANA_TREASURY, type ChainKey } from '@/lib/config';
import { readFactoryAddresses } from '@/lib/evm/client';
import { FAQ } from '@/lib/faq';
import { feeSchedules } from '@/lib/fees';
import { attesters } from '@/lib/origin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
	title: 'Guide',
	description: 'How to launch a token from Claude or the site, what it costs, how fees flow, and what happens at graduation.',
};

const SECTIONS = [
	['claude', 'connect claude'],
	['prompt', 'what to say'],
	['checkout', 'sign'],
	['fees', 'fees'],
	['curve', 'the curve'],
	['after', 'after launch'],
	['contracts', 'contracts'],
	['provenance', 'provenance'],
	['tools', 'connector tools'],
	['faq', 'faq'],
] as const;

export default async function GuidePage() {
	const [schedules, rhAddresses] = await Promise.all([
		feeSchedules(),
		PAD_FACTORY ? readFactoryAddresses().catch(() => null) : Promise.resolve(null),
	]);
	const keys = attesters();
	const connectorUrl = `${SITE_URL}/mcp`;
	const rh = schedules.robinhood;
	const sol = schedules.solana;

	return (
		<div className="wrap" style={{ paddingTop: 48 }}>
			<article className="prose">
				<span className="eyebrow">guide</span>
				<h1>launch a token, start to finish</h1>
				<p>
					you need four things: a name, a ticker, a public https link to a logo, and the wallet that should earn the
					creator fees. everything else is fixed by the contracts, identical for every launch on a chain.
				</p>
				<nav className="toc" aria-label="On this page">
					{SECTIONS.map(([id, label]) => (
						<a key={id} href={`#${id}`}>
							{label}
						</a>
					))}
				</nav>

				<h2 id="claude">1. connect claude</h2>
				<p>this is a remote MCP connector. add it once and any claude chat can prepare launches.</p>
				<ol>
					<li>in claude, open settings, then connectors.</li>
					<li>choose add custom connector and paste the url below. no account, no api key.</li>
					<li>connect. the tools appear in any new chat.</li>
				</ol>
				<div className="connector-url" style={{ margin: '16px 0 8px' }}>
					<code>{connectorUrl}</code>
					<CopyButton value={connectorUrl} className="btn btn-primary btn-sm" />
				</div>
				<p className="muted" style={{ fontSize: 14 }}>
					the free claude plan allows one custom connector. prefer not to use claude? the <Link href="/launch">launcher</Link> does the
					same thing in a form.
				</p>

				<h2 id="prompt">2. what to say</h2>
				<p>plain words are fine. claude asks for anything missing instead of inventing it.</p>
				<pre>
					<code>
						launch a token called Night Owl, ticker $OWL, on solana.{'\n'}
						logo: https://example.com/owl.png{'\n'}
						send fees to 7xKpQ…your solana address{'\n'}
						description: for people who ship at 3am.
					</code>
				</pre>
				<p>
					on robinhood chain, give a 0x address as the fee wallet. you can also ask for an initial buy, for example
					&quot;and buy 0.05 ETH of it at launch&quot;. it happens inside the launch transaction, so nobody gets in before you.
				</p>
				<p>
					claude replies with a preview and a checkout link. before that link exists the service has already checked that
					the logo loads as an image, the ticker is not taken in the registry, and the fee wallet is a valid address for
					the chain.
				</p>

				<h2 id="checkout">3. sign</h2>
				<p>
					the checkout link is valid for 24 hours. open it, connect a wallet on the right chain, read the fee summary,
					and sign one transaction. that transaction pays the launch fee, creates the token, sets the fee wallet, and
					runs your initial buy if you asked for one. you pay network gas as usual.
				</p>
				<p>
					nothing is deployed and nothing is spent before you sign. if you close the tab after signing, reopen the
					link: it picks the launch back up.
				</p>

				<h2 id="fees">4. fees</h2>
				<p>
					launching is paid, and the terms are the same for everyone. the launch fee and a share of trading fees fund
					the platform; the creator share of every trade goes to the fee wallet forever.
				</p>
			</article>
			<div style={{ margin: '20px 0 8px' }}>
				<FeeTable schedules={schedules} />
			</div>
			<article className="prose">
				<h3>where each fee goes</h3>
				<ul>
					<li>
						<strong>launch fee</strong>: to the platform treasury, paid inside the launch transaction.
					</li>
					<li>
						<strong>robinhood chain</strong>: the 1% trade fee splits 70% to the fee wallet and 30% to the platform, on the
						curve and in the locked uniswap pool after graduation. there is no graduation fee: the whole raise goes into
						the pool. anyone can trigger a payout from the token page.
					</li>
					<li>
						<strong>solana</strong>: coins trade on pump.fun. pump.fun keeps its protocol fee; the creator fee is split 70% to
						the fee wallet and 30% to the platform by a fee-sharing config written at launch and locked forever, on the
						curve and on PumpSwap after graduation. anyone can trigger a payout.
					</li>
				</ul>
				<p>
					terms are snapshotted per token at launch on robinhood chain, so a later change to the platform&apos;s fee
					settings never touches a token that already exists. the contract caps them: trade fee at most 2%, launch fee at
					most 0.05 ETH, graduation fee at most 10%.
				</p>

				<h2 id="curve">5. the curve</h2>
				<h3>{chainLabel('robinhood').toLowerCase()}</h3>
				<p>
					1,000,000,000 tokens, fixed. 800M sell on a constant-product curve over virtual reserves; when the last of
					them sells, exactly {rh ? `${rh.graduationTarget} ETH` : 'the target raise'} has been raised. that same buy creates (or repairs)
					the 1% Uniswap v3 pool against WETH at the curve&apos;s final price and mints a full-range position owned by
					the launch contract, which has no way to withdraw it. unused supply from the reserve is burned.
					{PAD_FACTORY ? (
						<>
							{' '}
							the contract is{' '}
							<a href={explorer('robinhood', 'address', PAD_FACTORY)} className="mono" target="_blank" rel="noreferrer">
								{PAD_FACTORY}
							</a>
							.
						</>
					) : null}
				</p>
				<h3>{chainLabel('solana').toLowerCase()}</h3>
				<p>
					coins are created on pump.fun, so they appear on pump.fun and every solana terminal from the first second. the
					launch goes out as one atomic bundle: the coin, your first buy, the launch fee and the locked fee split land
					together or not at all, so nobody can buy before you and the split can never be skipped. at{' '}
					{sol ? `${sol.graduationTarget} SOL` : 'the curve target'} raised, pump.fun graduates the coin to PumpSwap and locks
					its liquidity.
				</p>

				<h2 id="after">6. after launch</h2>
				<ul>
					<li>every token has a page with live price, market cap, curve progress, a buy / sell panel and its fee payouts.</li>
					<li>
						creator fees: on robinhood chain anyone can press pay out and the ETH goes to the fee wallet. on solana the
						fee wallet connects and claims.
					</li>
					<li>
						every launch gets a registry number in order of birth. launches made straight against the contracts, outside
						this site, are picked up and numbered too.
					</li>
				</ul>

				<h2 id="contracts">7. contracts and addresses</h2>
				<p>
					every address the platform uses, read live from the chain. revenue only ever moves to the treasury, and the
					fee settings can only change within the caps written into the contract.
				</p>
				<h3>{chainLabel('robinhood').toLowerCase()}</h3>
				{PAD_FACTORY ? (
					<ul>
						<AddressRow chain="robinhood" label="launch contract (PadFactory)" value={PAD_FACTORY} />
						<AddressRow chain="robinhood" label="platform treasury" value={rhAddresses?.treasury ?? null} />
						<AddressRow chain="robinhood" label="owner (can change fees within the caps, pause launches)" value={rhAddresses?.owner ?? null} />
						{rhAddresses?.pendingOwner ? (
							<AddressRow chain="robinhood" label="ownership being handed to" value={rhAddresses.pendingOwner} />
						) : null}
						<AddressRow chain="robinhood" label="launch attester (signs prompt and site launches)" value={rhAddresses?.attester ?? keys.robinhood} />
					</ul>
				) : (
					<p className="muted">launches on robinhood chain are not open on this deployment yet.</p>
				)}
				<h3>{chainLabel('solana').toLowerCase()}</h3>
				{SOLANA_TREASURY ? (
					<ul>
						<AddressRow chain="solana" label="platform treasury" value={SOLANA_TREASURY} />
						<AddressRow chain="solana" label="launch attester (co-signs the provenance memo)" value={keys.solana} />
					</ul>
				) : (
					<p className="muted">launches on solana are not open on this deployment yet.</p>
				)}

				<h2 id="provenance">8. provenance: born from a prompt</h2>
				<p>
					every launch prepared here carries a signature from the platform&apos;s attester key, checked on-chain. on
					robinhood chain the launch contract verifies it and records the channel (site or prompt) in a{' '}
					<code>LaunchOrigin</code> event. on solana the pool-creation transaction carries a memo the attester must co-sign.
					so anyone can list every token born from a prompt from chain data alone, without trusting this site.
				</p>
				<p>
					the <Link href="/registry?origin=prompt">registry filter</Link> and the <a href="/api/launches?origin=prompt">json feed</a>{' '}
					use it, and <a href="/.well-known/launch-provenance.json">launch-provenance.json</a> publishes the keys and the
					verification recipe for other indexers.
				</p>

				<h2 id="tools">9. connector tools</h2>
				<p>what claude can call through {connectorUrl}:</p>
				<ul>
					<li>
						<code>launch_token</code>: validate a launch and return a preview plus checkout link. never spends anything.
					</li>
					<li>
						<code>launch_status</code>: whether a prepared launch was signed, and its token address once it was.
					</li>
					<li>
						<code>token_info</code>: live price, market cap and curve progress of a token.
					</li>
					<li>
						<code>recent_launches</code>: the registry, filterable by chain or search.
					</li>
					<li>
						<code>fee_schedule</code>: the fee terms per chain.
					</li>
				</ul>

				<h2 id="faq">10. faq</h2>
			</article>
			<div style={{ maxWidth: 720 }}>
				<Faq items={FAQ} />
			</div>
		</div>
	);
}

function AddressRow({ chain, label, value }: { chain: ChainKey; label: string; value: string | null }) {
	return (
		<li>
			{label}:{' '}
			{value ? (
				<a href={explorer(chain, 'address', value)} className="mono" target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>
					{value}
				</a>
			) : (
				<span className="muted">unavailable right now, reload in a moment</span>
			)}
		</li>
	);
}
