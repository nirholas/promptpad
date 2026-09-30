import Link from 'next/link';

import { SITE_NAME } from '@/lib/config';

export function SiteFooter() {
	return (
		<footer className="site-footer">
			<div className="wrap">
				<p>
					{SITE_NAME.toLowerCase()}: tokens launched from a prompt, on robinhood chain and solana. you sign every
					launch from your own wallet.
				</p>
				<nav aria-label="Footer">
					<Link href="/launch">launch</Link>
					<Link href="/registry">registry</Link>
					<Link href="/guide">guide</Link>
					<Link href="/guide#fees">fees</Link>
					<Link href="/guide#claude">connect claude</Link>
				</nav>
			</div>
		</footer>
	);
}
