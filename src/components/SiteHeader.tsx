import Link from 'next/link';

import { SITE_NAME } from '@/lib/config';
import { LogoMark } from './Logo';

export function SiteHeader() {
	return (
		<header className="site-header">
			<div className="wrap">
				<Link href="/" className="brand" aria-label={`${SITE_NAME} home`}>
					<LogoMark />
					<span>{SITE_NAME.toLowerCase()}</span>
				</Link>
				<nav className="nav" aria-label="Main">
					<Link href="/guide" className="hide-sm">
						guide
					</Link>
					<Link href="/registry">registry</Link>
					<Link href="/launch" className="btn btn-ink btn-sm" style={{ color: 'var(--bg)', marginLeft: 6 }}>
						launch
					</Link>
				</nav>
			</div>
		</header>
	);
}
