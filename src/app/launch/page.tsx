import type { Metadata } from 'next';

import { LaunchFlow } from '@/components/LaunchFlow';
import { WalletProviders } from '@/components/WalletProviders';
import { chainEnabled } from '@/lib/config';
import { feeSchedules } from '@/lib/fees';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
	title: 'Launch a token',
	description: 'Launch a token on Robinhood Chain or Solana: bonding curve, locked liquidity at graduation, creator fees to you.',
};

export default async function LaunchPage() {
	const fees = await feeSchedules();
	return (
		<div className="wrap">
			<WalletProviders>
				<LaunchFlow fees={fees} enabled={{ robinhood: chainEnabled('robinhood'), solana: chainEnabled('solana') }} />
			</WalletProviders>
		</div>
	);
}
