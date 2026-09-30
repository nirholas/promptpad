import Link from 'next/link';

import { ChainBadge } from '@/components/ChainBadge';
import { CopyButton } from '@/components/CopyButton';
import { Faq } from '@/components/Faq';
import { FeeTable } from '@/components/FeeTable';
import { TokenCard } from '@/components/TokenCard';
import { SITE_URL } from '@/lib/config';
import { FAQ } from '@/lib/faq';
import { feeSchedules } from '@/lib/fees';
import { listLaunches, syncRegistry } from '@/lib/launches';

export const dynamic = 'force-dynamic';

export default async function Home() {
	await syncRegistry().catch((error) => console.error('registry sync failed', error));
	const [{ launches, total }, schedules] = await Promise.all([listLaunches({ limit: 6 }), feeSchedules()]);
	const connectorUrl = `${SITE_URL}/mcp`;

	return (
		<>
			<section className="hero">
				<div className="wrap hero-grid">
					<div>
						<span className="eyebrow">claude connector + launchpad</span>
						<h1>
							launch a token <em>from a prompt.</em>
						</h1>
						<p className="lede">
							tell claude what you want, or fill in four fields here. it goes live on robinhood chain or solana
							on a bonding curve that graduates into locked liquidity. you sign it, and the creator fees are
							yours forever.
						</p>
						<div className="hero-chips">
							<ChainBadge chain="robinhood" />
							<ChainBadge chain="solana" />
							<span className="chip">creator fees to you</span>
							<span className="chip">liquidity locked at graduation</span>
						</div>
						<div className="cta-row">
							<Link href="/launch" className="btn btn-primary btn-lg">
								launch a token
							</Link>
							<a href="#claude" className="btn btn-lg">
								add to claude
							</a>
						</div>
					</div>

					<div className="card prompt-demo" aria-label="Example conversation in Claude">
						<span className="eyebrow">in claude, for example</span>
						<p className="bubble user">
							launch a token called Night Owl, ticker $OWL, on solana. logo is https://… and send fees to my
							wallet 7xKp…
						</p>
						<div className="bubble tool">
							<strong>preview ready.</strong> Night Owl ($OWL) on solana, fees to 7xKp…. open the checkout link to
							review the fee and sign with your wallet.
							<div className="preview-card">
								<div className="logo" aria-hidden="true" />
								<div>
									<div style={{ fontWeight: 700 }}>Night Owl</div>
									<div className="muted" style={{ fontSize: 13 }}>
										$OWL · valid 24h
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section className="section" id="claude">
				<div className="wrap">
					<div className="card connector">
						<div className="section-head" style={{ marginBottom: 4 }}>
							<div>
								<span className="eyebrow">remote mcp connector</span>
								<h2 style={{ fontSize: 28 }}>add it to claude once</h2>
							</div>
						</div>
						<div className="connector-url">
							<code>{connectorUrl}</code>
							<CopyButton value={connectorUrl} className="btn btn-primary btn-sm" />
						</div>
						<p className="muted" style={{ fontSize: 14 }}>
							in claude: settings, connectors, add custom connector, paste the url. no account and no api key.
							then just ask for a launch. <Link href="/guide#claude">step by step</Link>.
						</p>
					</div>
				</div>
			</section>

			<section className="section">
				<div className="wrap">
					<div className="section-head">
						<div>
							<span className="eyebrow">pick one</span>
							<h2>two ways to launch</h2>
						</div>
					</div>
					<div className="grid-2">
						<div className="card card-pad way">
							<span className="eyebrow">conversational</span>
							<h3>from claude</h3>
							<p className="muted">
								describe the token in plain words. claude checks the name, ticker, logo and fee wallet, then hands
								you a checkout link. you sign there.
							</p>
							<ul>
								<li className="chip">born in claude</li>
								<li className="chip">preview valid 24h</li>
							</ul>
							<div className="cta-row">
								<a href="#claude" className="btn">
									get the connector
								</a>
							</div>
						</div>
						<div className="card card-pad way">
							<span className="eyebrow">direct</span>
							<h3>from the site</h3>
							<p className="muted">
								connect a wallet, fill in the token, see the live preview and the exact fee, sign. under a minute on
								either chain.
							</p>
							<ul>
								<li className="chip">optional first buy in the same transaction</li>
							</ul>
							<div className="cta-row">
								<Link href="/launch" className="btn btn-ink">
									open the launcher
								</Link>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section className="section">
				<div className="wrap">
					<div className="section-head">
						<div>
							<span className="eyebrow">three steps</span>
							<h2>how it works</h2>
						</div>
						<Link href="/guide">read the full guide</Link>
					</div>
					<div className="grid-3">
						<div className="card card-pad step">
							<div className="step-n">1</div>
							<h3>describe it</h3>
							<p className="muted">name, ticker, a public logo link, and the wallet that should earn the fees.</p>
							<blockquote>launch $OWL on robinhood chain, logo at https://…, fees to 0x…</blockquote>
						</div>
						<div className="card card-pad step">
							<div className="step-n">2</div>
							<h3>check the preview</h3>
							<p className="muted">
								everything is validated before you pay: the logo loads, the ticker is free, the wallet is real.
							</p>
						</div>
						<div className="card card-pad step">
							<div className="step-n">3</div>
							<h3>sign</h3>
							<p className="muted">
								one transaction from your wallet. the token is live on the curve and in the registry right away.
							</p>
						</div>
					</div>
				</div>
			</section>

			<section className="section">
				<div className="wrap">
					<div className="section-head">
						<div>
							<span className="eyebrow">the registry</span>
							<h2>latest launches</h2>
						</div>
						{total > 0 ? <Link href="/registry">all {total} launches</Link> : null}
					</div>
					{launches.length ? (
						<div className="token-grid">
							{launches.map((launch) => (
								<TokenCard key={launch.id} launch={launch} />
							))}
						</div>
					) : (
						<div className="empty">
							<h3>no launches yet</h3>
							<p>the registry starts at #00001. it could be yours.</p>
							<Link href="/launch" className="btn btn-primary">
								launch the first token
							</Link>
						</div>
					)}
				</div>
			</section>

			<section className="section" id="fees">
				<div className="wrap">
					<div className="section-head">
						<div>
							<span className="eyebrow">enforced on-chain</span>
							<h2>fees, in full</h2>
						</div>
						<Link href="/guide#fees">how fees flow</Link>
					</div>
					<FeeTable schedules={schedules} />
				</div>
			</section>

			<section className="section">
				<div className="wrap">
					<div className="section-head">
						<div>
							<span className="eyebrow">before you ask</span>
							<h2>questions</h2>
						</div>
					</div>
					<Faq items={FAQ} />
				</div>
			</section>
		</>
	);
}
