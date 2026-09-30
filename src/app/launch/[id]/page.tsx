import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LaunchFlow } from '@/components/LaunchFlow';
import { WalletProviders } from '@/components/WalletProviders';
import { chainEnabled } from '@/lib/config';
import { feeSchedules } from '@/lib/fees';
import { draftExpired, getDraft, getLaunchById } from '@/lib/launches';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: PageProps<'/launch/[id]'>): Promise<Metadata> {
	const { id } = await props.params;
	const draft = await getDraft(id);
	return draft
		? { title: `Launch ${draft.name} ($${draft.symbol})`, robots: { index: false } }
		: { title: 'Launch not found', robots: { index: false } };
}

export default async function CheckoutPage(props: PageProps<'/launch/[id]'>) {
	const { id } = await props.params;
	const draft = await getDraft(id);
	if (!draft) notFound();
	const [fees, launch] = await Promise.all([feeSchedules(), draft.launchId ? getLaunchById(draft.launchId) : null]);
	return (
		<div className="wrap">
			<WalletProviders>
				<LaunchFlow
					draft={draft}
					launch={launch}
					fees={fees}
					expired={!launch && draftExpired(draft)}
					enabled={{ robinhood: chainEnabled('robinhood'), solana: chainEnabled('solana') }}
				/>
			</WalletProviders>
		</div>
	);
}
