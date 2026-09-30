import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ChainBadge } from '@/components/ChainBadge';
import { CopyButton } from '@/components/CopyButton';
import { OriginChip } from '@/components/OriginChip';
import { TokenDashboard } from '@/components/TokenDashboard';
import { TokenLogo } from '@/components/TokenCard';
import { WalletProviders } from '@/components/WalletProviders';
import { explorer, isChainKey, type ChainKey } from '@/lib/config';
import { readTokenState } from '@/lib/fees';
import { formatDate, registryNumber } from '@/lib/format';
import { getLaunch, syncRegistry } from '@/lib/launches';

export const dynamic = 'force-dynamic';

async function load(chain: string, address: string) {
	if (!isChainKey(chain)) return null;
	let launch = await getLaunch(chain, address);
	if (!launch) {
		// Launched against the contracts outside this site and not indexed yet.
		await syncRegistry().catch(() => undefined);
		launch = await getLaunch(chain, address);
	}
	if (!launch) return null;
	// A known launch whose chain read fails (RPC outage, rate limit) still renders; the dashboard
	// shows the outage and keeps retrying instead of pretending the token does not exist.
	const state = await readTokenState(chain, launch.address).catch((error) => {
		console.error('token state read failed', chain, launch.address, error);
		return null;
	});
	return { chain: chain as ChainKey, launch, state };
}

export async function generateMetadata(props: PageProps<'/t/[chain]/[address]'>): Promise<Metadata> {
	const { chain, address } = await props.params;
	if (!isChainKey(chain)) return { title: 'Token not found' };
	const launch = await getLaunch(chain, address);
	if (!launch) return { title: 'Token not found' };
	return {
		title: `${launch.name} ($${launch.symbol})`,
		description: launch.description || `${launch.name} on ${chain}, registry ${registryNumber(launch.number)}.`,
		openGraph: launch.image ? { images: [{ url: launch.image }] } : undefined,
	};
}

export default async function TokenPage(props: PageProps<'/t/[chain]/[address]'>) {
	const { chain, address } = await props.params;
	const data = await load(chain, address);
	if (!data) notFound();
	const { launch, state } = data;

	return (
		<div className="wrap">
			<section className="token-hero">
				<TokenLogo src={launch.image} alt={`${launch.name} logo`} size="lg" />
				<div style={{ minWidth: 0 }}>
					<h1>
						{launch.name} <span className="muted">${launch.symbol}</span>
					</h1>
					<div className="token-meta">
						<ChainBadge chain={launch.chain} />
						<span className="chip mono">{registryNumber(launch.number)}</span>
						<span className="chip">born {formatDate(launch.createdAt)}</span>
						<OriginChip launch={launch} />
						{state?.graduated || launch.graduated ? <span className="chip chip-good">graduated</span> : null}
					</div>
				</div>
				<div className="token-actions">
					<CopyButton value={launch.address} label="copy address" className="btn btn-sm" />
					<a className="btn btn-sm" href={explorer(launch.chain, 'token', launch.address)} target="_blank" rel="noreferrer">
						explorer
					</a>
					{launch.tx ? (
						<a className="btn btn-sm btn-ghost" href={explorer(launch.chain, 'tx', launch.tx)} target="_blank" rel="noreferrer">
							launch tx
						</a>
					) : null}
				</div>
			</section>
			<WalletProviders>
				<TokenDashboard chain={launch.chain} address={launch.address} symbol={launch.symbol} initial={state} description={launch.description} />
			</WalletProviders>
			<p className="muted" style={{ marginTop: 24, fontSize: 14 }}>
				<Link href="/registry">back to the registry</Link>
			</p>
		</div>
	);
}
