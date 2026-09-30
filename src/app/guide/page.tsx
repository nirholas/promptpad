import type { Metadata } from 'next';
import Link from 'next/link';

import { CopyButton } from '@/components/CopyButton';
import { Faq } from '@/components/Faq';
import { FeeTable } from '@/components/FeeTable';
import { chainLabel, explorer, PAD_FACTORY, SITE_URL } from '@/lib/config';
import { FAQ } from '@/lib/faq';
import { feeSchedules } from '@/lib/fees';

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
	['tools', 'connector tools'],
	['faq', 'faq'],
] as const;

export default async function GuidePage() {
	const schedules = await feeSchedules();
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
						<strong>launch fee</strong>: to the platform treasury.
						{sol ? ' on solana, meteora keeps 10% of it at the protocol level.' : ''}
					</li>
					<li>
						<strong>trade fee</strong>: split between the fee wallet and the platform at the creator share.
						{sol ? ' on solana, meteora takes its protocol cut of every trade fee before the split.' : ''}
					</li>
					<li>
						<strong>graduation fee</strong>: a percentage of the raise, to the platform, taken when the curve completes.
					</li>
					<li>
						<strong>pool fees after graduation</strong>: the locked liquidity keeps earning. on robinhood chain anyone can
						trigger a collection from the token page, and it splits creator / platform like the trade fee. on solana the
						creator and the platform each hold their own permanently locked LP and claim their own fees.
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
					1,000,000,000 tokens with no mint authority and immutable metadata, on a Meteora Dynamic Bonding Curve. the
					trade fee opens high and decays over the first minute to stop bots sniping the launch; your own bundled
					initial buy pays the minimum fee. at {sol ? `${sol.graduationTarget} SOL` : 'the migration threshold'} raised, the pool migrates to
					Meteora DAMM v2 with 20% of supply and permanently locked liquidity.
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

				<h2 id="tools">7. connector tools</h2>
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

				<h2 id="faq">8. faq</h2>
			</article>
			<div style={{ maxWidth: 720 }}>
				<Faq items={FAQ} />
			</div>
		</div>
	);
}
