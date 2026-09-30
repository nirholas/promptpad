import type { Metadata } from 'next';

import { StatBar } from '@/components/StatBar';
import { TokenBrowser } from '@/components/TokenBrowser';
import { syncRegistry } from '@/lib/launches';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
	title: 'Registry',
	description: 'Every token launched here, numbered in order, on Robinhood Chain and Solana.',
};

export default async function RegistryPage(props: PageProps<'/registry'>) {
	const params = await props.searchParams;
	await syncRegistry().catch((error) => console.error('registry sync failed', error));
	return (
		<div className="wrap">
			<div className="section-head" style={{ paddingTop: 40, marginBottom: 0 }}>
				<div>
					<span className="eyebrow">numbered in order of birth</span>
					<h2>The registry</h2>
				</div>
			</div>
			<StatBar />
			<TokenBrowser params={params} basePath="/registry" />
		</div>
	);
}
