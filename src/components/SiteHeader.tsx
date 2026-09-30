import Link from 'next/link';

import { chainEnabled, SITE_NAME, SITE_URL } from '@/lib/config';
import { HeaderNav, McpPill, ThemeToggle } from './HeaderControls';
import { LogoMark } from './Logo';

export function SiteHeader() {
	const live = (['robinhood', 'solana'] as const).filter((c) => chainEnabled(c));
	return (
		<header className="site-header">
			<div className="wrap">
				<Link href="/" className="brand" aria-label={`${SITE_NAME} home`}>
					<LogoMark />
					<span>{SITE_NAME.toLowerCase()}</span>
				</Link>
				<HeaderNav />
				<div className="header-right">
					<span className="pill ghost hide-md" title="Chains open for launches">
						<i className={`live-dot ${live.length ? '' : 'off'}`} aria-hidden="true" />
						{live.length === 2 ? 'robinhood chain · solana' : live.length === 1 ? (live[0] === 'robinhood' ? 'robinhood chain' : 'solana') : 'launches opening soon'}
					</span>
					<McpPill url={`${SITE_URL}/mcp`} />
					<ThemeToggle />
					<Link href="/launch" className="btn btn-primary hide-sm">
						Launch
					</Link>
				</div>
			</div>
		</header>
	);
}
