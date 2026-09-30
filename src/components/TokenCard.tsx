import Link from 'next/link';

import { formatAge, registryNumber } from '@/lib/format';
import type { Launch } from '@/lib/types';
import { ChainIcon } from './ChainBadge';
import { CopyButton } from './CopyButton';
import { CardMetrics } from './CurveProgress';
import { OriginChip } from './OriginChip';

export function TokenLogo({ src, alt, size, symbol }: { src: string; alt: string; size?: 'lg'; symbol?: string }) {
	return src ? (
		// Logos are arbitrary third-party hosts chosen by creators, so they bypass the image optimizer.
		// eslint-disable-next-line @next/next/no-img-element
		<img src={src} alt={alt} className={`token-logo ${size ?? ''}`} loading="lazy" referrerPolicy="no-referrer" />
	) : (
		<div className={`token-logo fallback ${size ?? ''}`} aria-hidden="true">
			{symbol?.slice(0, 2) ?? ''}
		</div>
	);
}

export function TokenCard({ launch }: { launch: Launch }) {
	const href = `/t/${launch.chain}/${launch.address}`;
	return (
		<article className="card tcard">
			<div className="tcard-head">
				<TokenLogo src={launch.image} alt="" symbol={launch.symbol} />
				<div style={{ minWidth: 0 }}>
					<div className="tcard-title">
						<Link href={href}>{launch.name}</Link>
						<CopyButton value={launch.address} label="copy address" className="copy-mini" icon />
					</div>
					<div className="tcard-sub">
						<span className="chip">${launch.symbol}</span>
						<span className="chip" title={launch.chain === 'robinhood' ? 'Robinhood Chain' : 'Solana'}>
							<span className="chain-badge" style={{ color: 'inherit', fontSize: 'inherit' }}>
								<ChainIcon chain={launch.chain} />
								{launch.chain === 'robinhood' ? 'robinhood' : 'solana'}
							</span>
						</span>
						<OriginChip launch={launch} />
					</div>
				</div>
				<span className="tcard-age" title={new Date(launch.createdAt).toUTCString()}>
					{formatAge(launch.createdAt)}
				</span>
			</div>
			<CardMetrics chain={launch.chain} address={launch.address} graduated={launch.graduated} />
			<div className="tcard-foot">
				<span>{registryNumber(launch.number)}</span>
				<Link href={href} className="link-arrow" style={{ position: 'relative' }}>
					Trade
				</Link>
			</div>
		</article>
	);
}
