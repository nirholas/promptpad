import Link from 'next/link';

import { formatDate, registryNumber } from '@/lib/format';
import type { Launch } from '@/lib/types';
import { ChainBadge } from './ChainBadge';
import { CurveProgress } from './CurveProgress';

export function TokenLogo({ src, alt, size }: { src: string; alt: string; size?: 'lg' }) {
	return src ? (
		// Logos are arbitrary third-party hosts chosen by creators, so they bypass the image optimizer.
		// eslint-disable-next-line @next/next/no-img-element
		<img src={src} alt={alt} className={`token-logo ${size ?? ''}`} loading="lazy" referrerPolicy="no-referrer" />
	) : (
		<div className={`token-logo ${size ?? ''}`} aria-hidden="true" />
	);
}

export function TokenCard({ launch }: { launch: Launch }) {
	return (
		<Link href={`/t/${launch.chain}/${launch.address}`} className="card token-card">
			<div className="token-card-top">
				<TokenLogo src={launch.image} alt={`${launch.name} logo`} />
				<div style={{ minWidth: 0 }}>
					<div className="token-name">{launch.name}</div>
					<div className="token-sym">${launch.symbol}</div>
				</div>
				<div className="token-no">
					{registryNumber(launch.number)}
					<br />
					{formatDate(launch.createdAt)}
				</div>
			</div>
			<p className="token-desc">{launch.description || 'no description.'}</p>
			<CurveProgress chain={launch.chain} address={launch.address} graduated={launch.graduated} />
			<div className="token-foot">
				<ChainBadge chain={launch.chain} />
				{launch.source === 'claude' ? <span className="chip chip-accent">born in claude</span> : null}
			</div>
		</Link>
	);
}
